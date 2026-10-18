// Fills a local database with sample people, posts and trades so the site
// can be previewed without real wallets. Usage: DATA_DIR=./data node scripts/seed-demo.js
const crypto = require('crypto');
const { openDb } = require('../src/social/db');
const { base58Encode } = require('../src/social/auth');

const db = openDb(process.env.DATA_DIR || './data');
const now = Date.now();
const wallet = () => base58Encode(crypto.randomBytes(32));
const people = [
  ['Ansem Jr', 'Early on everything. Mostly wrong, sometimes very right.', 'ansemjr'],
  ['Trench Queen', 'Memecoin researcher. RugCheck before I ape.', 'trenchqueen'],
  ['SolDegen', 'Bot builder. Paper trading until the edge is real.', ''],
  ['Cupsey Fan', '', 'cupseyfan'],
].map(([name, bio, x]) => ({ wallet: wallet(), name, bio, x }));
const insUser = db.prepare('INSERT OR IGNORE INTO users (wallet, name, bio, x_handle, created_at, backfilled) VALUES (?, ?, ?, ?, ?, 1)');
people.forEach((p, i) => insUser.run(p.wallet, p.name, p.bio, p.x, now - (30 - i) * 86400000));

const tokens = [['BonkMint111111111111111111111111111111111111', 'BONK', 'Bonk'], ['WifMint1111111111111111111111111111111111111', 'WIF', 'dogwifhat'], ['PopcatMint11111111111111111111111111111111111', 'POPCAT', 'Popcat']];
const insTok = db.prepare('INSERT OR IGNORE INTO tokens (mint, symbol, name, updated_at) VALUES (?, ?, ?, ?)');
tokens.forEach(([m, s, n]) => insTok.run(m, s, n, now));

const insTrade = db.prepare('INSERT OR IGNORE INTO trades VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
const insPost = db.prepare('INSERT INTO posts (author, kind, body, ref_post_id, trade_key, created_at) VALUES (?, ?, ?, ?, ?, ?)');
let k = 0;
for (const p of people) {
  for (const [mint] of tokens) {
    const sig = base58Encode(crypto.randomBytes(64));
    const t = now - (k += 1) * 23 * 60000;
    const sol = +(0.5 + Math.random() * 3).toFixed(2);
    insTrade.run(sig, p.wallet, mint, 'buy', 100000 * sol, 'SOL', sol, sol * 150, 0.0015, t);
    insPost.run(p.wallet, 'trade', '', null, `${sig}:${mint}`, t);
    if (k % 2) {
      const sig2 = base58Encode(crypto.randomBytes(64));
      const out = +(sol * (0.6 + Math.random() * 1.4)).toFixed(2);
      insTrade.run(sig2, p.wallet, mint, 'sell', 100000 * sol, 'SOL', out, out * 150, 0.0015, t + 9 * 60000);
      insPost.run(p.wallet, 'trade', '', null, `${sig2}:${mint}`, t + 9 * 60000);
    }
  }
}
const first = insPost.run(people[1].wallet, 'post', 'Checked $WIF holders before buying: top 10 own 18%, LP burned, mint revoked. Sized small anyway. https://rugcheck.xyz', null, null, now - 40 * 60000).lastInsertRowid;
insPost.run(people[0].wallet, 'post', 'gm trenches. Who is still holding $BONK from the first run?', null, null, now - 15 * 60000);
insPost.run(people[2].wallet, 'reply', 'This is the way. Wish more people did this.', first, null, now - 30 * 60000);
insPost.run(people[3].wallet, 'repost', '', first, null, now - 20 * 60000);
db.prepare('INSERT OR IGNORE INTO likes VALUES (?, ?, ?)').run(first, people[0].wallet, now);
db.prepare('INSERT OR IGNORE INTO follows VALUES (?, ?, ?)').run(people[0].wallet, people[1].wallet, now);
console.log(`Seeded ${people.length} people. Example profile: #/u/${people[1].wallet}`);
