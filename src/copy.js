// Copy trading, simulated: "if I had copied this trader with $X per buy,
// how would I be doing?"
//
// Rules, applied to the leader's recorded trades from `since` onward:
// - Every leader buy: the follower buys `amountUsd` of the same token at the
//   same price, minus a swap cost.
// - Every leader sell: the follower sells the same fraction of their copied
//   position (sell half -> follower sells half), minus a swap cost.
// - Sells of tokens the leader bought before `since` are ignored, because
//   the follower never copied those buys.
//
// Nothing here trades for real. Real copies are swaps the user approves in
// their own wallet.

function simulateCopy(trades, { amountUsd = 100, since = 0, costPct = 1 } = {}, prices = new Map()) {
  const c = costPct / 100;
  const byToken = new Map();
  let copiedBuys = 0;
  let copiedSells = 0;

  const sorted = [...trades].sort((a, b) => a.block_time - b.block_time);
  for (const t of sorted) {
    if (t.block_time < since || !(t.token_amount > 0) || !(t.value_usd > 0)) continue;
    if (!byToken.has(t.mint)) byToken.set(t.mint, { mint: t.mint, leaderQty: 0, qty: 0, cost: 0, invested: 0, realized: 0, sells: 0 });
    const p = byToken.get(t.mint);
    const price = t.value_usd / t.token_amount;
    if (t.side === 'buy') {
      p.leaderQty += t.token_amount;
      p.qty += (amountUsd * (1 - c)) / price;
      p.cost += amountUsd;
      p.invested += amountUsd;
      copiedBuys += 1;
    } else {
      if (p.leaderQty <= 0 || p.qty <= 0) continue;
      const fraction = Math.min(1, t.token_amount / p.leaderQty);
      const sellQty = p.qty * fraction;
      const costPart = p.cost * fraction;
      p.realized += sellQty * price * (1 - c) - costPart;
      p.cost -= costPart;
      p.qty -= sellQty;
      p.leaderQty = Math.max(0, p.leaderQty - t.token_amount);
      p.sells += 1;
      copiedSells += 1;
    }
  }

  let realizedUsd = 0;
  let unrealizedUsd = 0;
  let investedUsd = 0;
  let openValueUsd = 0;
  let closed = 0;
  let wins = 0;
  const tokens = [];
  for (const p of byToken.values()) {
    if (p.invested === 0) continue;
    const priceNow = prices.get(p.mint);
    const open = p.qty > 1e-12;
    const valueNow = open && priceNow > 0 ? p.qty * priceNow * (1 - c) : 0;
    const unrealized = open && priceNow > 0 ? valueNow - p.cost : 0;
    realizedUsd += p.realized;
    unrealizedUsd += unrealized;
    investedUsd += p.invested;
    openValueUsd += valueNow;
    if (!open) {
      closed += 1;
      if (p.realized > 0) wins += 1;
    }
    tokens.push({ mint: p.mint, investedUsd: p.invested, realizedUsd: p.realized, unrealizedUsd: unrealized, totalUsd: p.realized + unrealized, open });
  }
  const totalUsd = realizedUsd + unrealizedUsd;
  return {
    amountUsd,
    since,
    copiedBuys,
    copiedSells,
    investedUsd,
    realizedUsd,
    unrealizedUsd,
    totalUsd,
    openValueUsd,
    returnPct: investedUsd > 0 ? (totalUsd / investedUsd) * 100 : 0,
    closedPositions: closed,
    winRatePct: closed ? (wins / closed) * 100 : 0,
    tokens: tokens.sort((a, b) => b.totalUsd - a.totalUsd),
  };
}

module.exports = { simulateCopy };
