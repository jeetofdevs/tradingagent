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
    // The public RPC is rate limited; use a provider URL (Helius, Triton, QuickNode) for real traffic.
    solanaRpcUrl: str('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com'),
    minTipSol: num('MIN_TIP_SOL', 0.001),
    syncIntervalSec: num('SYNC_INTERVAL_SEC', 300),
    syncBackfillTx: num('SYNC_BACKFILL_TX', 40), // transactions read when a wallet joins
    syncWalletsPerRound: num('SYNC_WALLETS_PER_ROUND', 10),
  };
}

module.exports = { loadConfig };
