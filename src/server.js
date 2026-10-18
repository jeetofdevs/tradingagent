const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { loadConfig } = require('./config');
const { createEngine } = require('./engine');
const { createFileStore } = require('./store');
const { createDexScreenerSource } = require('./sources/dexscreener');
const { createMockSource } = require('./sources/mock');
const { createRugCheck } = require('./safety');
const { createJupiterFills } = require('./fills');
const { createGrokAdvisor } = require('./grok');
const { openDb } = require('./social/db');
const { createAuth } = require('./social/auth');
const { createRpc } = require('./social/solana');
const { createPortfolio } = require('./social/portfolio');
const { createSyncer } = require('./social/sync');
const { createSocialRouter } = require('./social/routes');

const cfg = loadConfig();
if (cfg.tradingMode !== 'demo') {
  console.error(`TRADING_MODE=${cfg.tradingMode} is not supported. Only the demo fund exists; live trading is not built.`);
  process.exit(1);
}
const isMock = cfg.dataSource === 'mock';
const source = isMock ? createMockSource() : createDexScreenerSource({ chain: cfg.chain });
// RugCheck only covers Solana tokens, and mock tokens do not exist on-chain.
const safety = cfg.rugCheck && !isMock && cfg.chain === 'solana'
  ? createRugCheck({ maxRiskScore: cfg.maxRugRiskScore })
  : null;
// Jupiter quotes are for real Solana tokens only.
const fills = cfg.jupiterFills && !isMock && cfg.chain === 'solana'
  ? createJupiterFills({ baseUrl: cfg.jupiterBaseUrl })
  : null;
if (!['off', 'advise', 'veto'].includes(cfg.grokMode)) {
  console.error(`GROK_MODE must be off, advise or veto (got "${cfg.grokMode}")`);
  process.exit(1);
}
if (cfg.grokMode !== 'off' && !cfg.xaiApiKey) {
  console.error('GROK_MODE is on but XAI_API_KEY is not set. Add the key or set GROK_MODE=off.');
  process.exit(1);
}
// Grok searches X for real tokens only; skip it on the mock market.
const grok = cfg.grokMode !== 'off' && !isMock
  ? createGrokAdvisor({ apiKey: cfg.xaiApiKey, model: cfg.grokModel, baseUrl: cfg.grokBaseUrl })
  : null;
const engine = createEngine({ cfg, source, safety, fills, grok, store: createFileStore(cfg.dataDir) });

// ---- social layer ----
const db = openDb(cfg.dataDir);
if (!cfg.sessionSecret) console.warn('SESSION_SECRET is not set: users will be logged out on every restart.');
const auth = createAuth({ db, appName: cfg.appName, secret: cfg.sessionSecret });
const rpc = createRpc({ url: cfg.solanaRpcUrl });
// Wallet prices always use real DexScreener data, even when the bot runs on the mock market.
const priceSource = isMock ? createDexScreenerSource({ chain: 'solana' }) : source;
const portfolio = createPortfolio({ db, rpc, quotes: (mints) => priceSource.quotes(mints) });
const syncer = createSyncer({ db, rpc, portfolio, cfg });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Railway sits behind a proxy
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/bot', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'bot.html')));
app.use('/api', createSocialRouter({ db, auth, rpc, portfolio, syncer, cfg }));

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/api/state', (_req, res) => res.json({ ...engine.snapshot(), controlsEnabled: Boolean(cfg.adminToken) }));

function tokenMatches(given) {
  if (!cfg.adminToken || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(cfg.adminToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const actions = {
  pause: () => engine.pause(),
  resume: () => engine.resume(),
  'close-all': () => engine.closeAll(),
  reset: () => engine.reset(),
};

app.post('/api/control/:action', async (req, res) => {
  if (!cfg.adminToken) return res.status(403).json({ error: 'Controls are off. Set ADMIN_TOKEN to turn them on.' });
  if (!tokenMatches(req.get('x-admin-token'))) return res.status(401).json({ error: 'Wrong admin token' });
  const action = actions[req.params.action];
  if (!action) return res.status(404).json({ error: 'Unknown action' });
  try {
    await action();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

let timer = null;
async function loop() {
  await engine.tick();
  timer = setTimeout(loop, cfg.scanIntervalSec * 1000);
}

const server = app.listen(cfg.port, () => {
  console.log(
    `Demo trading bot on port ${cfg.port} | source=${source.name} chain=${cfg.chain} rugcheck=${safety ? 'on' : 'off'} fills=${fills ? 'jupiter' : 'fixed'} grok=${grok ? cfg.grokMode : 'off'}`,
  );
  loop();
  syncer.start();
});

function shutdown() {
  clearTimeout(timer);
  syncer.stop();
  engine.save();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
