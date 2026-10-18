const path = require('path');
const express = require('express');
const { loadConfig } = require('./config');
const { openDb } = require('./db');
const { createAuth } = require('./auth');
const { createRpc } = require('./solana');
const { createPriceSource } = require('./prices');
const { createPortfolio } = require('./portfolio');
const { createSyncer } = require('./sync');
const { createSocialRouter } = require('./routes');

const cfg = loadConfig();
const db = openDb(cfg.dataDir);
if (!cfg.sessionSecret) console.warn('SESSION_SECRET is not set: users will be logged out on every restart.');

const auth = createAuth({ db, appName: cfg.appName, secret: cfg.sessionSecret });
const rpc = createRpc({ url: cfg.solanaRpcUrl });
const portfolio = createPortfolio({ db, rpc, quotes: createPriceSource({ chain: 'solana' }) });
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
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', createSocialRouter({ db, auth, rpc, portfolio, syncer, cfg }));

const server = app.listen(cfg.port, () => {
  console.log(`${cfg.appName} on port ${cfg.port}`);
  syncer.start();
});

function shutdown() {
  syncer.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
