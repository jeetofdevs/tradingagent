// All settings come from environment variables so they can be changed on
// Railway without touching code. Every value has a safe default.

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Setting ${name} must be a number, got "${raw}"`);
  }
  return value;
}

function str(name, fallback) {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

function loadConfig() {
  return {
    port: num('PORT', 3000),
    dataDir: str('DATA_DIR', './data'),
    adminToken: str('ADMIN_TOKEN', ''),

    // Market data
    dataSource: str('DATA_SOURCE', 'dexscreener'), // 'dexscreener' or 'mock'
    chain: str('CHAIN', 'solana'),
    scanIntervalSec: num('SCAN_INTERVAL_SEC', 60),

    // Only 'demo' exists. Live trading is not built.
    tradingMode: str('TRADING_MODE', 'demo'),

    // Demo fund
    startBalanceUsd: num('START_BALANCE_USD', 1000),
    positionSizePct: num('POSITION_SIZE_PCT', 5), // % of equity per trade
    minTradeUsd: num('MIN_TRADE_USD', 10),
    maxOpenPositions: num('MAX_OPEN_POSITIONS', 5),
    // Flat fees + slippage per side, in %. Used when Jupiter quotes are off
    // or fail, and to estimate the value of open positions.
    costPerSidePct: num('COST_PER_SIDE_PCT', 1.5),

    // Realistic fills from Jupiter quotes (read-only, nothing is sent).
    jupiterFills: str('JUPITER_FILLS', 'on') !== 'off',
    jupiterBaseUrl: str('JUPITER_BASE_URL', 'https://lite-api.jup.ag/swap/v1'),
    // Network and priority fees on top of the quote, per side, in %.
    extraCostPerSidePct: num('EXTRA_COST_PER_SIDE_PCT', 0.5),
    // Skip a buy if the real swap would lose more than this on entry.
    maxEntrySlippagePct: num('MAX_ENTRY_SLIPPAGE_PCT', 8),
    // 'on' = skip buys when no Jupiter quote. 'off' = fall back to flat cost.
    requireRealFills: str('REQUIRE_REAL_FILLS', 'on') !== 'off',

    // Exits
    takeProfitPct: num('TAKE_PROFIT_PCT', 60),
    stopLossPct: num('STOP_LOSS_PCT', 25),
    trailingArmPct: num('TRAILING_ARM_PCT', 20), // gain needed before trailing starts
    trailingStopPct: num('TRAILING_STOP_PCT', 15), // drop from the peak that sells
    maxHoldMin: num('MAX_HOLD_MIN', 180),
    liquidityPullPct: num('LIQUIDITY_PULL_PCT', 50), // sell if liquidity falls this much
    maxMissedQuotes: num('MAX_MISSED_QUOTES', 10),
    cooldownMin: num('COOLDOWN_MIN', 360), // wait before re-buying the same token

    // Entry filters
    minLiquidityUsd: num('MIN_LIQUIDITY_USD', 25000),
    minVolumeH1Usd: num('MIN_VOLUME_H1_USD', 20000),
    minAgeMin: num('MIN_AGE_MIN', 20),
    maxAgeHours: num('MAX_AGE_HOURS', 72),
    maxFdvToLiquidity: num('MAX_FDV_TO_LIQUIDITY', 40),
    maxPumpH1Pct: num('MAX_PUMP_H1_PCT', 150), // skip tokens that already ran this much
    minTxnsH1: num('MIN_TXNS_H1', 60),
    minScore: num('MIN_SCORE', 60),

    // Safety check before each buy (RugCheck). 'on' or 'off'.
    rugCheck: str('RUGCHECK', 'on') !== 'off',
    maxRugRiskScore: num('MAX_RUG_RISK_SCORE', 50), // RugCheck normalised score, 0 = safest
  };
}

module.exports = { loadConfig };
