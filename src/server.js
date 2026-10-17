const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { loadConfig } = require('./config');
const { createEngine } = require('./engine');
const { createFileStore } = require('./store');
const { createDexScreenerSource } = require('./sources/dexscreener');
const { createMockSource } = require('./sources/mock');
const { createRugCheck } = require('./safety');

const cfg = loadConfig();
const isMock = cfg.dataSource === 'mock';
const source = isMock ? createMockSource() : createDexScreenerSource({ chain: cfg.chain });
// RugCheck only covers Solana tokens, and mock tokens do not exist on-chain.
const safety = cfg.rugCheck && !isMock && cfg.chain === 'solana'
  ? createRugCheck({ maxRiskScore: cfg.maxRugRiskScore })
  : null;
const engine = createEngine({ cfg, source, safety, store: createFileStore(cfg.dataDir) });

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

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
    `Paper trading bot on port ${cfg.port} | source=${source.name} chain=${cfg.chain} rugcheck=${safety ? 'on' : 'off'}`,
  );
  loop();
});

function shutdown() {
  clearTimeout(timer);
  engine.save();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
