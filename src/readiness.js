// "Ready for real money?" checklist. Every item must pass before it is worth
// even considering a live wallet. This only reports; it unlocks nothing.

const DAY = 24 * 60 * 60 * 1000;

function readiness({ stats, trades, startedAt, now }) {
  const days = (now - startedAt) / DAY;
  const realFills = trades.filter((t) => t.entryFill === 'jupiter' && t.exitFill === 'jupiter').length;
  const realShare = trades.length ? realFills / trades.length : 0;

  const checks = [
    {
      label: 'At least 50 closed trades',
      ok: stats.trades >= 50,
      detail: `${stats.trades} so far`,
    },
    {
      label: 'Running at least 14 days',
      ok: days >= 14,
      detail: `${days.toFixed(1)} days`,
    },
    {
      label: 'Average trade makes money after costs',
      ok: stats.trades > 0 && stats.expectancyUsd > 0,
      detail: stats.trades ? `${stats.expectancyUsd < 0 ? '-' : ''}$${Math.abs(stats.expectancyUsd).toFixed(2)} per trade` : 'no trades yet',
    },
    {
      label: 'Edge check says "likely real edge"',
      ok: stats.edge.verdict === 'likely-real-edge',
      detail: stats.edge.tStat === null ? 'needs 30+ trades' : `t = ${stats.edge.tStat.toFixed(2)}`,
    },
    {
      label: 'Worst drawdown under 30%',
      ok: stats.maxDrawdownPct < 30,
      detail: `-${stats.maxDrawdownPct.toFixed(1)}%`,
    },
    {
      label: 'At least 80% of trades priced with real Jupiter quotes',
      ok: trades.length > 0 && realShare >= 0.8,
      detail: `${Math.round(realShare * 100)}%`,
    },
  ];

  return { ready: checks.every((c) => c.ok), passed: checks.filter((c) => c.ok).length, checks };
}

module.exports = { readiness };
