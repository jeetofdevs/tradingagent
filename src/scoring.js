// Decides whether a token is worth a (paper) buy.
// First hard safety filters, then a 0-100 score from market signals.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function evaluate(s, cfg) {
  const rejects = [];
  const txnsH1 = s.buysH1 + s.sellsH1;

  if (!(s.priceUsd > 0)) rejects.push('no price');
  if (s.liquidityUsd < cfg.minLiquidityUsd) rejects.push(`liquidity $${Math.round(s.liquidityUsd)} too low`);
  if (s.volH1 < cfg.minVolumeH1Usd) rejects.push(`1h volume $${Math.round(s.volH1)} too low`);
  if (s.ageMin < cfg.minAgeMin) rejects.push(`too new (${Math.round(s.ageMin)} min)`);
  if (s.ageMin > cfg.maxAgeHours * 60) rejects.push(`too old (${Math.round(s.ageMin / 60)} h)`);
  if (txnsH1 < cfg.minTxnsH1) rejects.push(`only ${txnsH1} trades in 1h`);
  // Buys but no sells usually means a honeypot: people cannot sell.
  if (s.buysH1 > 20 && s.sellsH1 === 0) rejects.push('no sells (possible honeypot)');
  if (s.liquidityUsd > 0 && s.fdv / s.liquidityUsd > cfg.maxFdvToLiquidity) {
    rejects.push(`thin pool for its value (FDV ${Math.round(s.fdv / s.liquidityUsd)}x liquidity)`);
  }
  if (s.chgH1 > cfg.maxPumpH1Pct) rejects.push(`already pumped ${Math.round(s.chgH1)}% in 1h`);
  if (s.chgM5 < -15) rejects.push(`dumping now (${Math.round(s.chgM5)}% in 5m)`);

  // Score parts (max 100)
  const buyRatio = txnsH1 > 0 ? s.buysH1 / txnsH1 : 0;
  const buyPressure = clamp((buyRatio - 0.45) / 0.25, 0, 1) * 25; // 45%..70% buys
  const momentum5m = s.chgM5 <= 0 ? 0 : clamp(1 - Math.abs(s.chgM5 - 6) / 12, 0, 1) * 20; // best near +6%
  const trend1h = s.chgH1 <= 0 ? 0 : clamp(1 - Math.abs(s.chgH1 - 35) / 70, 0, 1) * 20; // best near +35%
  const turnover = s.liquidityUsd > 0 ? clamp(s.volH1 / s.liquidityUsd / 2, 0, 1) * 20 : 0; // 2x/h = full
  const depth = clamp(Math.log10(Math.max(s.liquidityUsd, 1) / cfg.minLiquidityUsd) / 1.3, 0, 1) * 15;

  const score = Math.round(buyPressure + momentum5m + trend1h + turnover + depth);
  const parts = {
    buyPressure: Math.round(buyPressure),
    momentum5m: Math.round(momentum5m),
    trend1h: Math.round(trend1h),
    turnover: Math.round(turnover),
    depth: Math.round(depth),
  };

  if (rejects.length === 0 && score < cfg.minScore) rejects.push(`score ${score} below ${cfg.minScore}`);
  return { pass: rejects.length === 0, score, parts, rejects };
}

module.exports = { evaluate };
