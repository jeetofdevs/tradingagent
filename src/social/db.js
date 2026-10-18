// SQLite database for the social layer (Node's built-in node:sqlite).
// On Railway it lives on the same volume as the bot state (DATA_DIR).

const fs = require('fs');
const path = require('path');

// node:sqlite prints an "experimental" warning once; it is stable enough here.
const originalEmit = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  if (String(warning).includes('SQLite')) return;
  originalEmit.call(process, warning, ...rest);
};
const { DatabaseSync } = require('node:sqlite');
process.emitWarning = originalEmit;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  wallet TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  x_handle TEXT NOT NULL DEFAULT '',
  share_trades INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_sync_at INTEGER,
  newest_signature TEXT,
  backfilled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS nonces (
  nonce TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author TEXT NOT NULL REFERENCES users(wallet),
  kind TEXT NOT NULL CHECK (kind IN ('post', 'reply', 'repost', 'trade')),
  body TEXT NOT NULL DEFAULT '',
  ref_post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  trade_key TEXT,
  created_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS posts_author ON posts(author, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_ref ON posts(ref_post_id);
CREATE UNIQUE INDEX IF NOT EXISTS posts_one_repost ON posts(author, ref_post_id) WHERE kind = 'repost' AND deleted = 0;

CREATE TABLE IF NOT EXISTS likes (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  wallet TEXT NOT NULL REFERENCES users(wallet),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, wallet)
);

CREATE TABLE IF NOT EXISTS follows (
  follower TEXT NOT NULL REFERENCES users(wallet),
  followee TEXT NOT NULL REFERENCES users(wallet),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower, followee)
);

CREATE TABLE IF NOT EXISTS tips (
  signature TEXT PRIMARY KEY,
  from_wallet TEXT NOT NULL,
  to_wallet TEXT NOT NULL,
  post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  lamports INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tips_to ON tips(to_wallet);
CREATE INDEX IF NOT EXISTS tips_post ON tips(post_id);

CREATE TABLE IF NOT EXISTS trades (
  signature TEXT NOT NULL,
  wallet TEXT NOT NULL REFERENCES users(wallet),
  mint TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  token_amount REAL NOT NULL,
  quote_symbol TEXT NOT NULL,
  quote_amount REAL NOT NULL,
  value_usd REAL,
  price_usd REAL,
  block_time INTEGER NOT NULL,
  PRIMARY KEY (signature, wallet, mint)
);
CREATE INDEX IF NOT EXISTS trades_wallet ON trades(wallet, block_time DESC);
CREATE INDEX IF NOT EXISTS trades_time ON trades(block_time DESC);

CREATE TABLE IF NOT EXISTS tokens (
  mint TEXT PRIMARY KEY,
  symbol TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
`;

function openDb(dataDir) {
  let file = ':memory:';
  if (dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    file = path.join(dataDir, 'social.db');
  }
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb };
