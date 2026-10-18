// Reads registered wallets' transactions from the chain and records swaps
// as trades. New trades (after a wallet registers) become feed posts when
// the user has trade sharing on. Older history is backfilled quietly.

const { parseSwaps } = require('./solana');

function createSyncer({ db, rpc, portfolio, cfg, now = () => Date.now(), log = console }) {
  const getUser = db.prepare('SELECT * FROM users WHERE wallet = ?');
  const dueUsers = db.prepare('SELECT wallet FROM users ORDER BY COALESCE(last_sync_at, 0) ASC LIMIT ?');
  const insertTrade = db.prepare(`INSERT OR IGNORE INTO trades
    (signature, wallet, mint, side, token_amount, quote_symbol, quote_amount, value_usd, price_usd, block_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertPost = db.prepare(`INSERT INTO posts (author, kind, body, trade_key, created_at) VALUES (?, 'trade', '', ?, ?)`);
  const markSynced = db.prepare('UPDATE users SET last_sync_at = ?, newest_signature = COALESCE(?, newest_signature), backfilled = 1 WHERE wallet = ?');

  const running = new Set();

  async function syncWallet(wallet) {
    if (running.has(wallet)) return { skipped: true };
    running.add(wallet);
    try {
      const user = getUser.get(wallet);
      if (!user) throw new Error('Wallet is not registered');
      const firstSync = !user.backfilled;

      const sigs = firstSync
        ? await rpc.getSignatures(wallet, { limit: cfg.syncBackfillTx })
        : await rpc.getSignatures(wallet, { limit: 100, until: user.newest_signature || undefined });

      let solUsd = null;
      const quoteUsd = async (symbol) => {
        if (symbol !== 'SOL') return 1; // USDC / USDT
        if (solUsd === null) solUsd = await portfolio.solPriceUsd();
        return solUsd;
      };

      let added = 0;
      const newMints = new Set();
      // Oldest first, so feed posts come out in order.
      for (const s of [...sigs].reverse()) {
        if (s.err) continue;
        const tx = await rpc.getTransaction(s.signature);
        for (const trade of parseSwaps(tx, wallet)) {
          const valueUsd = trade.quoteAmount * (await quoteUsd(trade.quoteSymbol));
          const result = insertTrade.run(
            trade.signature, wallet, trade.mint, trade.side, trade.tokenAmount, trade.quoteSymbol,
            trade.quoteAmount, valueUsd, valueUsd / trade.tokenAmount, trade.blockTime || now(),
          );
          if (result.changes === 0) continue;
          added += 1;
          newMints.add(trade.mint);
          if (!firstSync && user.share_trades) {
            insertPost.run(wallet, `${trade.signature}:${trade.mint}`, trade.blockTime || now());
          }
        }
      }
      // Fetch names and symbols for new tokens.
      if (newMints.size) await portfolio.prices([...newMints]).catch(() => {});
      markSynced.run(now(), sigs[0]?.signature || null, wallet);
      return { added, scanned: sigs.length, firstSync };
    } finally {
      running.delete(wallet);
    }
  }

  let timer = null;
  async function loop() {
    try {
      for (const { wallet } of dueUsers.all(cfg.syncWalletsPerRound)) {
        try {
          const r = await syncWallet(wallet);
          if (r.added) log.log(`sync ${wallet.slice(0, 6)}: +${r.added} trades`);
        } catch (err) {
          log.error(`sync ${wallet.slice(0, 6)}: ${err.message}`);
        }
      }
    } finally {
      timer = setTimeout(loop, cfg.syncIntervalSec * 1000);
    }
  }

  return {
    syncWallet,
    start() {
      timer = setTimeout(loop, 5000);
    },
    stop() {
      clearTimeout(timer);
    },
  };
}

module.exports = { createSyncer };
