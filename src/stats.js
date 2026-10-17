// Performance numbers from closed trades and the equity curve.
// Win rate alone misleads, so this also reports expectancy, profit factor,
// max drawdown, and whether the result could just be luck.

// Is the average trade return clearly above zero, or within the noise?
// Uses a one-sample t-statistic on per-trade % returns.
function edgeCheck(returnsPct, minTrades = 30) {
  const n = returnsPct.length;
  if (n < minTrades) {
    return { verdict: 'not-enough-trades', trades: n, needed: minTrades, tStat: null };
  }
  const mean = returnsPct.reduce((a, b) => a + b, 0) / n;
  const variance = returnsPct.reduce((a, r) => a + (r - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  const tStat = sd > 0 ? mean / (sd / Math.sqrt(n)) : mean > 0 ? Infinity : 0;
  let verdict = 'could-be-luck';
  if (tStat >= 2) verdict = 'likely-real-edge';
  else if (tStat <= -2) verdict = 'likely-losing';
  return { verdict, trades: n, needed: minTrades, tStat, meanReturnPct: mean };
}

function computeStats(trades, equity, startBalance) {
  const n = trades.length;
  const wins = trades.filter((t) => t.pnlUsd > 0);
  const losses = trades.filter((t) => t.pnlUsd <= 0);
  const sum = (arr, key) => arr.reduce((acc, t) => acc + t[key], 0);

  const grossWin = sum(wins, 'pnlUsd');
  const grossLoss = -sum(losses, 'pnlUsd');

  let bestWinStreak = 0;
  let worstLossStreak = 0;
  let run = 0;
  let runType = null;
  for (const t of trades) {
    const type = t.pnlUsd > 0 ? 'win' : 'loss';
    run = type === runType ? run + 1 : 1;
    runType = type;
    if (type === 'win') bestWinStreak = Math.max(bestWinStreak, run);
    else worstLossStreak = Math.max(worstLossStreak, run);
  }

  let peak = startBalance;
  let maxDrawdownPct = 0;
  for (const point of equity) {
    peak = Math.max(peak, point.v);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - point.v) / peak) * 100);
  }

  const current = equity.length ? equity[equity.length - 1].v : startBalance;
  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    winRatePct: n ? (wins.length / n) * 100 : 0,
    totalPnlUsd: sum(trades, 'pnlUsd'),
    returnPct: startBalance ? ((current - startBalance) / startBalance) * 100 : 0,
    expectancyUsd: n ? sum(trades, 'pnlUsd') / n : 0,
    avgWinPct: wins.length ? sum(wins, 'pnlPct') / wins.length : 0,
    avgLossPct: losses.length ? sum(losses, 'pnlPct') / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? null : 0, // null = no losses yet
    bestWinStreak,
    worstLossStreak,
    currentStreak: runType ? { type: runType, length: run } : null,
    maxDrawdownPct,
    edge: edgeCheck(trades.map((t) => t.pnlPct)),
  };
}

module.exports = { computeStats, edgeCheck };
