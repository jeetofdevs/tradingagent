// What a wallet holds right now, and how its trades have done.
//
// Holdings come straight from the chain (SOL + every SPL token account).
// Profit uses the trades this site has recorded for the wallet, with
// average-cost accounting per token:
//   realized   = sell proceeds - average cost of the tokens sold
//   unrealized = value of tokens still held - their average cost
// Trades made before the site started tracking a wallet are only partly
// known, so the numbers are labelled as estimates.

const { WSOL } = require('./solana');

const PRICE_TTL_MS = 60000;
const HOLDINGS_TTL_MS = 2 * 60000;

function createPortfolio({ db, rpc, quotes, now = () => Date.now() }) {
  const priceCache = new Map(); // mint -> { t, snap }
  const holdingsCache = new Map(); // wallet -> { t, value }

  const upsertToken = db.prepare(`INSERT INTO tokens (mint, symbol, name, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(mint) DO UPDATE SET symbol = excluded.symbol, name = excluded.name, updated_at = excluded.updated_at`);
  const tradesFor = db.prepare('SELECT * FROM trades WHERE wallet = ? ORDER BY block_time ASC, signature ASC');
  const tokenRow = db.prepare('SELECT symbol, name FROM tokens WHERE mint = ?');

  // Prices for many mints at once, cached for a minute.
  async function prices(mints) {
    const result = new Map();
    const missing = [];
    for (const mint of new Set(mints)) {
      const hit = priceCache.get(mint);
      if (hit && now() - hit.t < PRICE_TTL_MS) {
        if (hit.snap) result.set(mint, hit.snap);
      } else {
        missing.push(mint);
      }
    }
    if (missing.length) {
      const fresh = await quotes(missing);
      for (const mint of missing) {
        const snap = fresh.get(mint) || null;
        priceCache.set(mint, { t: now(), snap });
        if (snap) {
          result.set(mint, snap);
          upsertToken.run(mint, String(snap.symbol || '').slice(0, 20), String(snap.name || '').slice(0, 60), now());
        }
      }
    }
    return result;
  }

  async function solPriceUsd() {
    const p = await prices([WSOL]);
    const usd = p.get(WSOL)?.priceUsd;
    if (!(usd > 0)) throw new Error('SOL price unavailable');
    return usd;
  }

  async function holdings(wallet, { fresh = false } = {}) {
    const hit = holdingsCache.get(wallet);
    if (!fresh && hit && now() - hit.t < HOLDINGS_TTL_MS) return hit.value;

    const [sol, tokens] = await Promise.all([rpc.getSolBalance(wallet), rpc.getTokenBalances(wallet)]);
    const priced = await prices([WSOL, ...tokens.keys()]);
    const solUsd = priced.get(WSOL)?.priceUsd || null;

    const rows = [{
      mint: WSOL,
      symbol: 'SOL',
      name: 'Solana',
      amount: sol,
      priceUsd: solUsd,
      valueUsd: solUsd ? sol * solUsd : null,
      url: null,
    }];
    for (const [mint, amount] of tokens) {
      const snap = priced.get(mint);
      rows.push({
        mint,
        symbol: snap?.symbol || '',
        name: snap?.name || '',
        amount,
        priceUsd: snap?.priceUsd || null,
        valueUsd: snap?.priceUsd ? amount * snap.priceUsd : null,
        url: snap?.url || null,
      });
    }
    rows.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
    const value = {
      wallet,
      updatedAt: now(),
      totalUsd: rows.reduce((acc, r) => acc + (r.valueUsd || 0), 0),
      tokens: rows,
      unpriced: rows.filter((r) => r.valueUsd === null).length,
    };
    holdingsCache.set(wallet, { t: now(), value });
    return value;
  }

  // Profit per token from recorded trades. `held` (mint -> amount) lets the
  // caller use real on-chain balances; otherwise tracked amounts are used.
  async function pnl(wallet, held = null) {
    const byMint = new Map();
    for (const t of tradesFor.all(wallet)) {
      if (!byMint.has(t.mint)) {
        byMint.set(t.mint, { mint: t.mint, qty: 0, cost: 0, realizedUsd: 0, boughtUsd: 0, soldUsd: 0, buys: 0, sells: 0, partial: false, lastTradeAt: 0 });
      }
      const p = byMint.get(t.mint);
      const usd = t.value_usd || 0;
      p.lastTradeAt = t.block_time;
      if (t.side === 'buy') {
        p.qty += t.token_amount;
        p.cost += usd;
        p.boughtUsd += usd;
        p.buys += 1;
      } else {
        p.sells += 1;
        p.soldUsd += usd;
        const sold = Math.min(t.token_amount, p.qty);
        if (t.token_amount > p.qty * 1.0001) p.partial = true; // sold tokens we never saw bought
        if (sold > 0) {
          const avg = p.cost / p.qty;
          const share = sold / t.token_amount;
          p.realizedUsd += usd * share - avg * sold;
          p.cost -= avg * sold;
          p.qty -= sold;
        }
      }
    }

    const open = [...byMint.values()].filter((p) => p.qty > 0).map((p) => p.mint);
    // If prices are down, still report realized profit; open positions count as 0.
    let priced = new Map();
    let pricesUnavailable = false;
    if (open.length) {
      try {
        priced = await prices(open);
      } catch {
        pricesUnavailable = true;
      }
    }

    const tokens = [];
    for (const p of byMint.values()) {
      const snap = priced.get(p.mint);
      let amount = p.qty;
      if (held) amount = Math.min(p.qty, held.get(p.mint) || 0);
      const costLeft = p.qty > 0 ? (p.cost * amount) / p.qty : 0;
      const valueNow = snap?.priceUsd ? amount * snap.priceUsd : null;
      const unrealizedUsd = valueNow === null ? 0 : valueNow - costLeft;
      const symbolRow = tokenRow.get(p.mint);
      tokens.push({
        mint: p.mint,
        symbol: snap?.symbol || symbolRow?.symbol || '',
        name: snap?.name || symbolRow?.name || '',
        buys: p.buys,
        sells: p.sells,
        boughtUsd: p.boughtUsd,
        soldUsd: p.soldUsd,
        holding: amount,
        valueNowUsd: valueNow,
        realizedUsd: p.realizedUsd,
        unrealizedUsd,
        totalUsd: p.realizedUsd + unrealizedUsd,
        closed: amount <= 0,
        partial: p.partial,
        lastTradeAt: p.lastTradeAt,
      });
    }
    tokens.sort((a, b) => b.lastTradeAt - a.lastTradeAt);

    const closed = tokens.filter((t) => t.closed && t.sells > 0);
    const wins = closed.filter((t) => t.realizedUsd > 0);
    const sum = (k) => tokens.reduce((acc, t) => acc + t[k], 0);
    const best = [...tokens].sort((a, b) => b.totalUsd - a.totalUsd)[0] || null;
    return {
      wallet,
      tokens,
      realizedUsd: sum('realizedUsd'),
      unrealizedUsd: sum('unrealizedUsd'),
      totalUsd: sum('realizedUsd') + sum('unrealizedUsd'),
      volumeUsd: sum('boughtUsd') + sum('soldUsd'),
      closedPositions: closed.length,
      wins: wins.length,
      winRatePct: closed.length ? (wins.length / closed.length) * 100 : 0,
      best: best && best.totalUsd > 0 ? { symbol: best.symbol, mint: best.mint, totalUsd: best.totalUsd } : null,
      estimate: tokens.some((t) => t.partial) || pricesUnavailable,
      pricesUnavailable,
    };
  }

  return { prices, solPriceUsd, holdings, pnl };
}

module.exports = { createPortfolio };
