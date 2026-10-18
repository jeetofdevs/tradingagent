// All settings come from environment variables, with safe defaults.

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Setting ${name} must be a number, got "${raw}"`);
  return value;
}

function str(name, fallback) {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

function loadConfig() {
  return {
    port: num('PORT', 3000),
    appName: str('APP_NAME', 'Near Social'),
    dataDir: str('DATA_DIR', './data'),
    // Signs login cookies. Set it in production, or everyone is logged out on each restart.
    sessionSecret: str('SESSION_SECRET', ''),
    // NEAR data sources (free public endpoints by default).
    nearRpcUrl: str('NEAR_RPC_URL', 'https://rpc.mainnet.fastnear.com'),
    fastnearUrl: str('FASTNEAR_API_URL', 'https://api.fastnear.com'),
    nearblocksUrl: str('NEARBLOCKS_API_URL', 'https://api.nearblocks.io'),
    nearblocksKey: str('NEARBLOCKS_API_KEY', ''), // optional, raises the rate limit
    minTipNear: num('MIN_TIP_NEAR', 0.01),
    // Copy trades open this swap page. {from} and {to} are token contracts, or "near".
    swapUrl: str('COPY_SWAP_URL', 'https://app.ref.finance/#{from}|{to}'),
    copyCostPct: num('COPY_COST_PCT', 1), // swap cost per side used in copy simulations
    syncIntervalSec: num('SYNC_INTERVAL_SEC', 300),
    syncBackfillEvents: num('SYNC_BACKFILL_EVENTS', 100), // token events read when an account joins
    syncAccountsPerRound: num('SYNC_ACCOUNTS_PER_ROUND', 10),
  };
}

module.exports = { loadConfig };
