// Reads registered accounts' token transfers from NearBlocks and records
// swaps as trades. Trades after an account joins become feed posts (if the
// user shares trades). History from before joining is backfilled quietly.

const { parseFtEvents } = require('./near');

const MAX_PAGES = 3;

function createSyncer({ db, near, portfolio, cfg, now = () => Date.now(), log = console }) {
  const getUser = db.prepare('SELECT * FROM users WHERE wallet = ?');
  const dueUsers = db.prepare('SELECT wallet FROM users ORDER BY COALESCE(last_sync_at, 0) ASC LIMIT ?');
  const insertTrade = db.prepare(`INSERT OR IGNORE INTO trades
    (signature, wallet, mint, side, token_amount, quote_symbol, quote_amount, value_usd, price_usd, block_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertPost = db.prepare(`INSERT INTO posts (author, kind, body, trade_key, created_at) VALUES (?, 'trade', '', ?, ?)`);
  const markSynced = db.prepare('UPDATE users SET last_sync_at = ?, last_event_ts = MAX(last_event_ts, ?), backfilled = 1 WHERE wallet = ?');

  const running = new Set();

  async function syncAccount(accountId) {
    if (running.has(accountId)) return { skipped: true };
    running.add(accountId);
    try {
      const user = getUser.get(accountId);
      if (!user) throw new Error('Account is not registered');
      const firstSync = !user.backfilled;

      // Newest events first; stop once we reach what we already saw.
      const events = [];
      let cursor = null;
      for (let page = 0; page < (firstSync ? 1 : MAX_PAGES); page += 1) {
        const r = await near.ftEvents(accountId, { cursor, perPage: firstSync ? cfg.syncBackfillEvents : 100 });
        events.push(...r.events);
        const oldest = r.events[r.events.length - 1];
        const oldestMs = oldest ? Number(BigInt(oldest.block_timestamp || 0) / 1000000n) : 0;
        if (!r.cursor || r.events.length === 0 || oldestMs <= user.last_event_ts) break;
        cursor = r.cursor;
      }

      let nearUsd = null;
      const quoteUsd = async (symbol) => {
        if (symbol !== 'NEAR') return 1; // stablecoins
        if (nearUsd === null) nearUsd = await portfolio.nearPriceUsd();
        return nearUsd;
      };

      let added = 0;
      let newest = 0;
      const trades = parseFtEvents(events, accountId).sort((a, b) => a.blockTime - b.blockTime);
      for (const t of trades) {
        newest = Math.max(newest, t.blockTime);
        if (t.blockTime <= user.last_event_ts) continue;
        portfolio.rememberToken(t.mint, { symbol: t.symbol, name: t.name, decimals: t.decimals });
        const valueUsd = t.quoteAmount * (await quoteUsd(t.quoteSymbol));
        const r = insertTrade.run(t.signature, accountId, t.mint, t.side, t.tokenAmount, t.quoteSymbol, t.quoteAmount, valueUsd, valueUsd / t.tokenAmount, t.blockTime || now());
        if (r.changes === 0) continue;
        added += 1;
        if (!firstSync && user.share_trades) insertPost.run(accountId, `${t.signature}:${t.mint}`, t.blockTime || now());
      }
      for (const e of events) newest = Math.max(newest, Number(BigInt(e.block_timestamp || 0) / 1000000n));
      markSynced.run(now(), newest, accountId);
      return { added, scanned: events.length, firstSync };
    } finally {
      running.delete(accountId);
    }
  }

  let timer = null;
  async function loop() {
    try {
      for (const { wallet } of dueUsers.all(cfg.syncAccountsPerRound)) {
        try {
          const r = await syncAccount(wallet);
          if (r.added) log.log(`sync ${wallet}: +${r.added} trades`);
        } catch (err) {
          log.error(`sync ${wallet}: ${err.message}`);
        }
      }
    } finally {
      timer = setTimeout(loop, cfg.syncIntervalSec * 1000);
    }
  }

  return {
    syncAccount,
    start() {
      timer = setTimeout(loop, 5000);
    },
    stop() {
      clearTimeout(timer);
    },
  };
}

module.exports = { createSyncer };
