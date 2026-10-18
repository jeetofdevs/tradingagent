// What a NEAR account holds right now, and how its trades have done.
//
// Holdings: native NEAR (RPC) + every fungible token (FastNEAR), priced in USD.
// Profit: average-cost accounting per token on the swaps this site recorded:
//   realized   = sell proceeds - average cost of the tokens sold
//   unrealized = value of tokens still held - their average cost
// Sells of tokens bought before the account joined are flagged as estimates.

const { WNEAR, toUnits } = require('./near');

const PRICE_TTL_MS = 60000;
const HOLDINGS_TTL_MS = 2 * 60000;
const MAX_ICON = 20000;

// Only show token icons that cannot run code: images as data URIs or https.
function safeIcon(icon) {
  if (typeof icon !== 'string' || icon.length > MAX_ICON) return null;
  if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml)[;,]/i.test(icon) || /^https:\/\//i.test(icon)) return icon;
  return null;
}

function createPortfolio({ db, near, quotes, now = () => Date.now() }) {
  const priceCache = new Map();
  const holdingsCache = new Map();

  const getToken = db.prepare('SELECT * FROM tokens WHERE mint = ?');
  const upsertToken = db.prepare(`INSERT INTO tokens (mint, symbol, name, decimals, icon, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(mint) DO UPDATE SET
      symbol = CASE WHEN excluded.symbol != '' THEN excluded.symbol ELSE tokens.symbol END,
      name = CASE WHEN excluded.name != '' THEN excluded.name ELSE tokens.name END,
      decimals = COALESCE(excluded.decimals, tokens.decimals),
      icon = COALESCE(excluded.icon, tokens.icon),
      updated_at = excluded.updated_at`);
  const tradesFor = db.prepare('SELECT * FROM trades WHERE wallet = ? ORDER BY block_time ASC, signature ASC');

  function rememberToken(contract, { symbol = '', name = '', decimals = null, icon = null }) {
    upsertToken.run(contract, String(symbol).slice(0, 20), String(name).slice(0, 60), decimals, safeIcon(icon), now());
  }

  // Name, symbol, decimals and icon, from the database or the token contract.
  async function tokenMeta(contract) {
    const row = getToken.get(contract);
    if (row && row.decimals != null) return row;
    const m = await near.ftMetadata(contract);
    rememberToken(contract, { symbol: m.symbol, name: m.name, decimals: m.decimals, icon: m.icon });
    return getToken.get(contract);
  }

  async function prices(contracts) {
    const result = new Map();
    const missing = [];
    for (const c of new Set(contracts)) {
      const hit = priceCache.get(c);
      if (hit && now() - hit.t < PRICE_TTL_MS) {
        if (hit.snap) result.set(c, hit.snap);
      } else missing.push(c);
    }
    if (missing.length) {
      const fresh = await quotes(missing);
      for (const c of missing) {
        const snap = fresh.get(c) || null;
        priceCache.set(c, { t: now(), snap });
        if (snap) result.set(c, snap);
      }
    }
    return result;
  }

  async function nearPriceUsd() {
    const usd = (await prices([WNEAR])).get(WNEAR)?.priceUsd;
    if (!(usd > 0)) throw new Error('NEAR price unavailable');
    return usd;
  }

  async function holdings(accountId, { fresh = false } = {}) {
    const hit = holdingsCache.get(accountId);
    if (!fresh && hit && now() - hit.t < HOLDINGS_TTL_MS) return hit.value;

    const [nearAmount, balances] = await Promise.all([near.nearBalance(accountId), near.ftBalances(accountId)]);
    const priced = await prices([WNEAR, ...balances.keys()]).catch(() => new Map());
    const nearUsd = priced.get(WNEAR)?.priceUsd || null;

    const rows = [{ mint: 'near', symbol: 'NEAR', name: 'NEAR', icon: null, amount: nearAmount, priceUsd: nearUsd, valueUsd: nearUsd ? nearAmount * nearUsd : null }];
    for (const [contract, raw] of balances) {
      let meta;
      try {
        meta = await tokenMeta(contract);
      } catch {
        continue; // not a standard token contract
      }
      const amount = toUnits(raw, meta.decimals || 0);
      const p = priced.get(contract);
      rows.push({
        mint: contract,
        symbol: meta.symbol || p?.symbol || '',
        name: meta.name || '',
        icon: meta.icon || null,
        amount,
        priceUsd: p?.priceUsd || null,
        valueUsd: p?.priceUsd ? amount * p.priceUsd : null,
      });
    }
    rows.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
    const value = {
      account: accountId,
      updatedAt: now(),
      totalUsd: rows.reduce((acc, r) => acc + (r.valueUsd || 0), 0),
      tokens: rows,
      unpriced: rows.filter((r) => r.valueUsd === null).length,
    };
    holdingsCache.set(accountId, { t: now(), value });
    return value;
  }

  // Profit per token from recorded trades. `held` (contract -> amount) lets
  // the caller use real balances; otherwise tracked amounts are used.
  async function pnl(accountId, held = null) {
    const byToken = new Map();
    for (const t of tradesFor.all(accountId)) {
      if (!byToken.has(t.mint)) {
        byToken.set(t.mint, { mint: t.mint, qty: 0, cost: 0, realizedUsd: 0, boughtUsd: 0, soldUsd: 0, buys: 0, sells: 0, partial: false, lastTradeAt: 0 });
      }
      const p = byToken.get(t.mint);
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
        if (t.token_amount > p.qty * 1.0001) p.partial = true; // sold tokens never seen bought
        if (sold > 0) {
          const avg = p.cost / p.qty;
          p.realizedUsd += usd * (sold / t.token_amount) - avg * sold;
          p.cost -= avg * sold;
          p.qty -= sold;
        }
      }
    }

    const open = [...byToken.values()].filter((p) => p.qty > 0).map((p) => p.mint);
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
    for (const p of byToken.values()) {
      const snap = priced.get(p.mint);
      const amount = held ? Math.min(p.qty, held.get(p.mint) || 0) : p.qty;
      const costLeft = p.qty > 0 ? (p.cost * amount) / p.qty : 0;
      const valueNow = snap?.priceUsd ? amount * snap.priceUsd : null;
      const unrealizedUsd = valueNow === null ? 0 : valueNow - costLeft;
      const meta = getToken.get(p.mint);
      tokens.push({
        mint: p.mint,
        symbol: meta?.symbol || snap?.symbol || '',
        name: meta?.name || '',
        icon: meta?.icon || null,
        buys: p.buys,
        sells: p.sells,
        boughtUsd: p.boughtUsd,
        soldUsd: p.soldUsd,
        holding: amount,
        valueNowUsd: valueNow,
        realizedUsd: p.realizedUsd,
        unrealizedUsd,
        totalUsd: p.realizedUsd + unrealizedUsd,
        closed: amount <= 1e-12,
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
      account: accountId,
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

  return { prices, nearPriceUsd, holdings, pnl, rememberToken, tokenMeta };
}

module.exports = { createPortfolio, safeIcon };
