// HTTP API for the social layer.

const express = require('express');
const { isAccountId } = require('./auth');
const { findNearTransfer } = require('./near');
const { simulateCopy } = require('./copy');

const COOKIE = 'sid';
const MAX_POST = 500;
const PAGE = 20;

function createSocialRouter({ db, auth, near, portfolio, syncer, cfg, now = () => Date.now() }) {
  const router = express.Router();
  router.use(express.json({ limit: '20kb' }));

  // ---- small helpers -------------------------------------------------------

  const fail = (res, status, error) => res.status(status).json({ error });
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  function readCookie(req, name) {
    for (const part of String(req.headers.cookie || '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === name) return decodeURIComponent(v.join('='));
    }
    return null;
  }

  // Who is calling (null if signed out).
  router.use((req, _res, next) => {
    req.wallet = auth.readSession(readCookie(req, COOKIE));
    next();
  });

  // Writes need a session and a custom header. Browsers will not send that
  // header cross-site without CORS, which blocks forged requests (CSRF).
  function requireUser(req, res, next) {
    if (req.get('x-requested-with') !== 'app') return fail(res, 403, 'Missing request header');
    if (!req.wallet) return fail(res, 401, 'Connect your wallet first');
    if (!getUser.get(req.wallet)) return fail(res, 401, 'Account is not registered');
    next();
  }

  // Per-wallet rate limits, in memory.
  const hits = new Map();
  function limit(key, max, windowMs) {
    const t = now();
    const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
    if (list.length >= max) return false;
    list.push(t);
    hits.set(key, list);
    return true;
  }

  const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);

  // ---- statements ----------------------------------------------------------

  const getUser = db.prepare('SELECT * FROM users WHERE wallet = ?');
  const insertUser = db.prepare('INSERT OR IGNORE INTO users (wallet, created_at) VALUES (?, ?)');
  const updateUser = db.prepare('UPDATE users SET name = ?, bio = ?, x_handle = ?, share_trades = ? WHERE wallet = ?');
  const getPost = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted = 0');

  function publicUser(u) {
    if (!u) return null;
    return { wallet: u.wallet, name: u.name, bio: u.bio, xHandle: u.x_handle, createdAt: u.created_at };
  }

  // Attach authors, counts, viewer state, originals and trades to posts.
  function hydrate(rows, viewer) {
    if (rows.length === 0) return [];
    const ids = new Set(rows.map((r) => r.id));
    const refIds = rows.filter((r) => r.ref_post_id).map((r) => r.ref_post_id);
    const refs = new Map();
    for (const id of refIds) {
      const p = getPost.get(id);
      if (p) {
        refs.set(id, p);
        ids.add(id);
      }
    }
    const list = [...ids];
    const marks = list.map(() => '?').join(',');
    const count = (sql) => new Map(db.prepare(sql.replace('$IDS', marks)).all(...list).map((r) => [r.id, r.n]));
    const likes = count('SELECT post_id id, COUNT(*) n FROM likes WHERE post_id IN ($IDS) GROUP BY post_id');
    const reposts = count("SELECT ref_post_id id, COUNT(*) n FROM posts WHERE kind = 'repost' AND deleted = 0 AND ref_post_id IN ($IDS) GROUP BY ref_post_id");
    const replies = count("SELECT ref_post_id id, COUNT(*) n FROM posts WHERE kind = 'reply' AND deleted = 0 AND ref_post_id IN ($IDS) GROUP BY ref_post_id");
    const tips = count('SELECT post_id id, SUM(amount) n FROM tips WHERE post_id IN ($IDS) GROUP BY post_id');
    const mine = (sql) => (viewer ? new Set(db.prepare(sql.replace('$IDS', marks)).all(viewer, ...list).map((r) => r.id)) : new Set());
    const liked = mine('SELECT post_id id FROM likes WHERE wallet = ? AND post_id IN ($IDS)');
    const reposted = mine("SELECT ref_post_id id FROM posts WHERE author = ? AND kind = 'repost' AND deleted = 0 AND ref_post_id IN ($IDS)");

    const users = new Map();
    const user = (w) => {
      if (!users.has(w)) users.set(w, publicUser(getUser.get(w)));
      return users.get(w);
    };
    const tradeOf = (key) => {
      if (!key) return null;
      const idx = key.lastIndexOf(':');
      const t = db.prepare(`SELECT t.*, k.symbol, k.name, k.icon FROM trades t LEFT JOIN tokens k ON k.mint = t.mint
        WHERE t.signature = ? AND t.mint = ?`).get(key.slice(0, idx), key.slice(idx + 1));
      return t ? tradeOut(t) : null;
    };
    const shape = (p) => ({
      id: p.id,
      kind: p.kind,
      author: user(p.author),
      body: p.body,
      createdAt: p.created_at,
      replyTo: p.kind === 'reply' ? p.ref_post_id : null,
      trade: p.kind === 'trade' ? tradeOf(p.trade_key) : null,
      likes: likes.get(p.id) || 0,
      reposts: reposts.get(p.id) || 0,
      replies: replies.get(p.id) || 0,
      tipsNear: tips.get(p.id) || 0,
      liked: liked.has(p.id),
      reposted: reposted.has(p.id),
      mine: viewer === p.author,
    });

    const out = [];
    for (const r of rows) {
      if (r.kind === 'repost') {
        const original = refs.get(r.ref_post_id);
        if (!original) continue; // original deleted
        out.push({ ...shape(original), repostedBy: user(r.author), repostId: r.id, feedTime: r.created_at });
      } else {
        out.push({ ...shape(r), feedTime: r.created_at });
      }
    }
    return out;
  }

  function tradeOut(t) {
    return {
      signature: t.signature,
      wallet: t.wallet,
      mint: t.mint,
      symbol: t.symbol || '',
      name: t.name || '',
      icon: t.icon || null,
      side: t.side,
      tokenAmount: t.token_amount,
      quoteSymbol: t.quote_symbol,
      quoteAmount: t.quote_amount,
      valueUsd: t.value_usd,
      priceUsd: t.price_usd,
      time: t.block_time,
    };
  }

  // Feed cursor: "<created_at>_<id>" of the last item seen.
  function cursorClause(before) {
    const m = /^(\d+)_(\d+)$/.exec(String(before || ''));
    if (!m) return { sql: '', args: [] };
    return { sql: 'AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))', args: [Number(m[1]), Number(m[1]), Number(m[2])] };
  }

  // ---- config & auth -------------------------------------------------------

  router.get('/config', (_req, res) => {
    res.json({ appName: cfg.appName, minTipNear: cfg.minTipNear, network: 'mainnet' });
  });

  router.post('/auth/challenge', (req, res) => {
    if (!limit(`challenge:${req.ip}`, 20, 60000)) return fail(res, 429, 'Too many attempts, wait a minute');
    res.json(auth.challenge(req.get('host') || cfg.appName));
  });

  router.post('/auth/verify', wrap(async (req, res) => {
    if (req.get('x-requested-with') !== 'app') return fail(res, 403, 'Missing request header');
    let wallet;
    try {
      wallet = await auth.verify({
        nonce: req.body?.nonce,
        accountId: String(req.body?.accountId || ''),
        publicKey: String(req.body?.publicKey || ''),
        signature: String(req.body?.signature || ''),
        callbackUrl: req.body?.callbackUrl,
      });
    } catch (err) {
      return fail(res, 401, err.message);
    }
    const isNew = insertUser.run(wallet, now()).changes > 0;
    const secure = req.secure || req.get('x-forwarded-proto') === 'https';
    res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(auth.issueSession(wallet))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(auth.sessionMaxAgeMs / 1000)}${secure ? '; Secure' : ''}`);
    if (isNew) syncer.syncAccount(wallet).catch(() => {}); // backfill trade history
    res.json({ user: publicUser(getUser.get(wallet)), isNew });
  }));

  router.post('/auth/logout', (_req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    const u = req.wallet && getUser.get(req.wallet);
    res.json({ user: u ? { ...publicUser(u), shareTrades: Boolean(u.share_trades) } : null });
  });

  router.put('/me', requireUser, (req, res) => {
    const name = clean(req.body?.name, 40);
    const bio = clean(req.body?.bio, 280);
    const xHandle = clean(req.body?.xHandle, 15).replace(/^@/, '');
    if (xHandle && !/^[A-Za-z0-9_]{1,15}$/.test(xHandle)) return fail(res, 400, 'X handle can only use letters, numbers and _');
    updateUser.run(name, bio, xHandle, req.body?.shareTrades === false ? 0 : 1, req.wallet);
    res.json({ user: publicUser(getUser.get(req.wallet)) });
  });

  // ---- posts ---------------------------------------------------------------

  router.get('/feed', (req, res) => {
    const tab = req.query.tab === 'following' ? 'following' : 'latest';
    if (tab === 'following' && !req.wallet) return res.json({ posts: [], next: null });
    const c = cursorClause(req.query.before);
    const follow = tab === 'following'
      ? 'AND (p.author = ? OR p.author IN (SELECT followee FROM follows WHERE follower = ?))'
      : '';
    const args = tab === 'following' ? [req.wallet, req.wallet] : [];
    const rows = db.prepare(`SELECT p.* FROM posts p WHERE p.deleted = 0 AND p.kind IN ('post', 'repost', 'trade')
      ${follow} ${c.sql} ORDER BY p.created_at DESC, p.id DESC LIMIT ${PAGE}`).all(...args, ...c.args);
    const last = rows[rows.length - 1];
    res.json({ posts: hydrate(rows, req.wallet), next: rows.length === PAGE ? `${last.created_at}_${last.id}` : null });
  });

  router.post('/posts', requireUser, (req, res) => {
    const body = clean(req.body?.body, MAX_POST + 1);
    if (!body) return fail(res, 400, 'Write something first');
    if (body.length > MAX_POST) return fail(res, 400, `Posts are limited to ${MAX_POST} characters`);
    if (!limit(`post:${req.wallet}`, 10, 10 * 60000)) return fail(res, 429, 'Slow down: max 10 posts per 10 minutes');
    let kind = 'post';
    let ref = null;
    if (req.body?.replyTo != null) {
      const parent = getPost.get(Number(req.body.replyTo));
      if (!parent) return fail(res, 404, 'That post no longer exists');
      kind = 'reply';
      ref = parent.kind === 'repost' ? parent.ref_post_id : parent.id;
    }
    const { lastInsertRowid } = db.prepare('INSERT INTO posts (author, kind, body, ref_post_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(req.wallet, kind, body, ref, now());
    res.json({ post: hydrate([getPost.get(Number(lastInsertRowid))], req.wallet)[0] });
  });

  router.get('/posts/:id', (req, res) => {
    const p = getPost.get(Number(req.params.id));
    if (!p || p.kind === 'repost') return fail(res, 404, 'Post not found');
    const replies = db.prepare("SELECT * FROM posts WHERE kind = 'reply' AND deleted = 0 AND ref_post_id = ? ORDER BY created_at ASC LIMIT 200").all(p.id);
    const parent = p.kind === 'reply' ? getPost.get(p.ref_post_id) : null;
    res.json({
      post: hydrate([p], req.wallet)[0],
      parent: parent ? hydrate([parent], req.wallet)[0] : null,
      replies: hydrate(replies, req.wallet),
    });
  });

  router.delete('/posts/:id', requireUser, (req, res) => {
    const p = getPost.get(Number(req.params.id));
    if (!p) return fail(res, 404, 'Post not found');
    if (p.author !== req.wallet) return fail(res, 403, 'You can only delete your own posts');
    db.prepare('UPDATE posts SET deleted = 1 WHERE id = ?').run(p.id);
    res.json({ ok: true });
  });

  router.post('/posts/:id/like', requireUser, (req, res) => {
    const p = getPost.get(Number(req.params.id));
    if (!p || p.kind === 'repost') return fail(res, 404, 'Post not found');
    const removed = db.prepare('DELETE FROM likes WHERE post_id = ? AND wallet = ?').run(p.id, req.wallet).changes;
    if (!removed) db.prepare('INSERT INTO likes (post_id, wallet, created_at) VALUES (?, ?, ?)').run(p.id, req.wallet, now());
    const n = db.prepare('SELECT COUNT(*) n FROM likes WHERE post_id = ?').get(p.id).n;
    res.json({ liked: !removed, likes: n });
  });

  router.post('/posts/:id/repost', requireUser, (req, res) => {
    const p = getPost.get(Number(req.params.id));
    if (!p || p.kind === 'repost') return fail(res, 404, 'Post not found');
    const removed = db.prepare("UPDATE posts SET deleted = 1 WHERE author = ? AND kind = 'repost' AND ref_post_id = ? AND deleted = 0")
      .run(req.wallet, p.id).changes;
    if (!removed) {
      if (!limit(`repost:${req.wallet}`, 30, 10 * 60000)) return fail(res, 429, 'Slow down a little');
      db.prepare("INSERT INTO posts (author, kind, ref_post_id, created_at) VALUES (?, 'repost', ?, ?)").run(req.wallet, p.id, now());
    }
    const n = db.prepare("SELECT COUNT(*) n FROM posts WHERE kind = 'repost' AND deleted = 0 AND ref_post_id = ?").get(p.id).n;
    res.json({ reposted: !removed, reposts: n });
  });

  // ---- users ---------------------------------------------------------------

  function requireWalletParam(req, res, next) {
    if (!isAccountId(req.params.wallet)) return fail(res, 400, 'Not a valid NEAR account');
    next();
  }

  router.get('/users', (req, res) => {
    const q = clean(req.query.q, 44);
    const rows = q
      ? db.prepare("SELECT * FROM users WHERE name LIKE ? OR wallet LIKE ? OR x_handle LIKE ? ORDER BY created_at DESC LIMIT 30")
        .all(`%${q}%`, `${q}%`, `%${q}%`)
      : db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 30').all();
    res.json({ users: rows.map(publicUser) });
  });

  router.get('/users/:wallet', requireWalletParam, (req, res) => {
    const u = getUser.get(req.params.wallet);
    if (!u) return fail(res, 404, 'This wallet has not joined yet');
    const w = u.wallet;
    const one = (sql, ...a) => db.prepare(sql).get(...a).n;
    res.json({
      user: publicUser(u),
      followers: one('SELECT COUNT(*) n FROM follows WHERE followee = ?', w),
      following: one('SELECT COUNT(*) n FROM follows WHERE follower = ?', w),
      posts: one("SELECT COUNT(*) n FROM posts WHERE author = ? AND deleted = 0 AND kind IN ('post', 'trade')", w),
      trades: one('SELECT COUNT(*) n FROM trades WHERE wallet = ?', w),
      tipsReceivedNear: one('SELECT COALESCE(SUM(amount), 0) n FROM tips WHERE to_wallet = ?', w),
      isFollowing: req.wallet ? Boolean(db.prepare('SELECT 1 FROM follows WHERE follower = ? AND followee = ?').get(req.wallet, w)) : false,
      copying: req.wallet ? (db.prepare('SELECT amount_usd amountUsd, created_at since FROM copies WHERE follower = ? AND leader = ?').get(req.wallet, w) || null) : null,
      copiers: one('SELECT COUNT(*) n FROM copies WHERE leader = ?', w),
      lastSyncAt: u.last_sync_at,
      isMe: req.wallet === w,
    });
  });

  router.get('/users/:wallet/posts', requireWalletParam, (req, res) => {
    const c = cursorClause(req.query.before);
    const rows = db.prepare(`SELECT p.* FROM posts p WHERE p.author = ? AND p.deleted = 0 AND p.kind IN ('post', 'repost', 'trade', 'reply')
      ${c.sql} ORDER BY p.created_at DESC, p.id DESC LIMIT ${PAGE}`).all(req.params.wallet, ...c.args);
    const last = rows[rows.length - 1];
    res.json({ posts: hydrate(rows, req.wallet), next: rows.length === PAGE ? `${last.created_at}_${last.id}` : null });
  });

  router.post('/users/:wallet/follow', requireWalletParam, requireUser, (req, res) => {
    const target = req.params.wallet;
    if (target === req.wallet) return fail(res, 400, 'You cannot follow yourself');
    if (!getUser.get(target)) return fail(res, 404, 'This wallet has not joined yet');
    const removed = db.prepare('DELETE FROM follows WHERE follower = ? AND followee = ?').run(req.wallet, target).changes;
    if (!removed) db.prepare('INSERT INTO follows (follower, followee, created_at) VALUES (?, ?, ?)').run(req.wallet, target, now());
    res.json({ following: !removed });
  });

  router.get('/users/:wallet/holdings', requireWalletParam, wrap(async (req, res) => {
    if (!getUser.get(req.params.wallet)) return fail(res, 404, 'This wallet has not joined yet');
    const h = await portfolio.holdings(req.params.wallet);
    res.json(h);
  }));

  router.get('/users/:wallet/pnl', requireWalletParam, wrap(async (req, res) => {
    if (!getUser.get(req.params.wallet)) return fail(res, 404, 'This wallet has not joined yet');
    let held = null;
    try {
      const h = await portfolio.holdings(req.params.wallet);
      held = new Map(h.tokens.map((t) => [t.mint, t.amount]));
    } catch {
      held = null; // fall back to tracked amounts
    }
    res.json(await portfolio.pnl(req.params.wallet, held));
  }));

  router.get('/users/:wallet/trades', requireWalletParam, (req, res) => {
    const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
    const rows = db.prepare(`SELECT t.*, k.symbol, k.name, k.icon FROM trades t LEFT JOIN tokens k ON k.mint = t.mint
      WHERE t.wallet = ? AND t.block_time < ? ORDER BY t.block_time DESC LIMIT 50`).all(req.params.wallet, before);
    res.json({ trades: rows.map(tradeOut), next: rows.length === 50 ? rows[rows.length - 1].block_time : null });
  });

  router.post('/users/:wallet/sync', requireWalletParam, requireUser, wrap(async (req, res) => {
    if (req.params.wallet !== req.wallet) return fail(res, 403, 'You can only refresh your own wallet');
    if (!limit(`sync:${req.wallet}`, 1, 60000)) return fail(res, 429, 'You can refresh once a minute');
    const r = await syncer.syncAccount(req.wallet);
    await portfolio.holdings(req.wallet, { fresh: true }).catch(() => {});
    res.json(r);
  }));

  // ---- trades & leaderboard -------------------------------------------------

  router.get('/trades/recent', (req, res) => {
    const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
    const rows = db.prepare(`SELECT t.*, k.symbol, k.name, k.icon FROM trades t LEFT JOIN tokens k ON k.mint = t.mint
      WHERE t.block_time < ? ORDER BY t.block_time DESC LIMIT 50`).all(before);
    const users = new Map();
    res.json({
      trades: rows.map((t) => {
        if (!users.has(t.wallet)) users.set(t.wallet, publicUser(getUser.get(t.wallet)));
        return { ...tradeOut(t), user: users.get(t.wallet) };
      }),
      next: rows.length === 50 ? rows[rows.length - 1].block_time : null,
    });
  });

  let board = { t: 0, rows: [] };
  router.get('/leaderboard', wrap(async (_req, res) => {
    if (now() - board.t > 5 * 60000) {
      const wallets = db.prepare('SELECT DISTINCT wallet FROM trades LIMIT 200').all().map((r) => r.wallet);
      const rows = [];
      for (const w of wallets) {
        try {
          const p = await portfolio.pnl(w);
          const copy30 = await copySim(w, { amountUsd: 100, since: now() - 30 * DAY });
          rows.push({ user: publicUser(getUser.get(w)), totalUsd: p.totalUsd, realizedUsd: p.realizedUsd, winRatePct: p.winRatePct, closedPositions: p.closedPositions, volumeUsd: p.volumeUsd, best: p.best, estimate: p.estimate, trades: tradesOf.all(w).length, copiers: db.prepare('SELECT COUNT(*) n FROM copies WHERE leader = ?').get(w).n, copy30: { totalUsd: copy30.totalUsd, returnPct: copy30.returnPct, copiedBuys: copy30.copiedBuys } });
        } catch {
          // skip wallets whose prices fail
        }
      }
      rows.sort((a, b) => b.totalUsd - a.totalUsd);
      board = { t: now(), rows: rows.slice(0, 100) };
    }
    res.json({ updatedAt: board.t, rows: board.rows });
  }));

  // ---- copy trading ------------------------------------------------------------

  const DAY = 24 * 60 * 60000;
  const tradesOf = db.prepare('SELECT * FROM trades WHERE wallet = ? ORDER BY block_time ASC');

  async function priceMap(mints) {
    if (!mints.length) return new Map();
    try {
      const snaps = await portfolio.prices(mints);
      return new Map([...snaps].map(([m, sn]) => [m, sn.priceUsd]));
    } catch {
      return new Map();
    }
  }

  async function copySim(leader, { amountUsd, since }) {
    const trades = tradesOf.all(leader);
    const mints = [...new Set(trades.filter((t) => t.block_time >= since).map((t) => t.mint))];
    return simulateCopy(trades, { amountUsd, since, costPct: copyCost }, await priceMap(mints));
  }

  const swapTemplate = cfg.swapUrl || 'https://app.ref.finance/#{from}|{to}';
  const copyCost = cfg.copyCostPct ?? 1;
  const swapLink = (from, to) => swapTemplate.replace('{from}', encodeURIComponent(from)).replace('{to}', encodeURIComponent(to));

  function signalOut(t) {
    return {
      ...tradeOut(t),
      user: publicUser(getUser.get(t.wallet)),
      swapUrl: t.side === 'buy' ? swapLink('near', t.mint) : swapLink(t.mint, 'near'),
    };
  }

  // "What if I had copied this trader?" Defaults: last 30 days, $100 per buy.
  router.get('/users/:wallet/copy-sim', requireWalletParam, wrap(async (req, res) => {
    if (!getUser.get(req.params.wallet)) return fail(res, 404, 'This account has not joined yet');
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const amountUsd = Math.min(100000, Math.max(1, Number(req.query.amount) || 100));
    const sim = await copySim(req.params.wallet, { amountUsd, since: now() - days * DAY });
    for (const t of sim.tokens) {
      const meta = db.prepare('SELECT symbol, icon FROM tokens WHERE mint = ?').get(t.mint);
      t.symbol = meta?.symbol || '';
      t.icon = meta?.icon || null;
    }
    res.json({ days, ...sim });
  }));

  // Your copy list, how each copy is doing, and the latest signals.
  router.get('/copy', requireUser, wrap(async (req, res) => {
    const rows = db.prepare('SELECT * FROM copies WHERE follower = ? ORDER BY created_at DESC').all(req.wallet);
    const copies = [];
    for (const c of rows) {
      const sim = await copySim(c.leader, { amountUsd: c.amount_usd, since: c.created_at });
      copies.push({ leader: publicUser(getUser.get(c.leader)), amountUsd: c.amount_usd, since: c.created_at, ...sim, tokens: undefined });
    }
    let signals = [];
    if (rows.length) {
      const clauses = rows.map(() => '(t.wallet = ? AND t.block_time >= ?)').join(' OR ');
      const args = rows.flatMap((c) => [c.leader, c.created_at]);
      signals = db.prepare(`SELECT t.*, k.symbol, k.name, k.icon FROM trades t LEFT JOIN tokens k ON k.mint = t.mint
        WHERE ${clauses} ORDER BY t.block_time DESC LIMIT 60`).all(...args).map(signalOut);
      const amountBy = new Map(rows.map((c) => [c.leader, c.amount_usd]));
      for (const sg of signals) sg.yourAmountUsd = amountBy.get(sg.wallet);
    }
    let nearUsd = null;
    try {
      nearUsd = await portfolio.nearPriceUsd();
    } catch {
      nearUsd = null;
    }
    res.json({ copies, signals, nearUsd, costPct: copyCost });
  }));

  router.put('/copy/:wallet', requireWalletParam, requireUser, (req, res) => {
    const leader = req.params.wallet;
    if (leader === req.wallet) return fail(res, 400, 'You cannot copy yourself');
    if (!getUser.get(leader)) return fail(res, 404, 'This account has not joined yet');
    const amountUsd = Number(req.body?.amountUsd);
    if (!(amountUsd >= 1 && amountUsd <= 100000)) return fail(res, 400, 'Amount per trade must be between $1 and $100,000');
    const count = db.prepare('SELECT COUNT(*) n FROM copies WHERE follower = ?').get(req.wallet).n;
    const exists = db.prepare('SELECT 1 FROM copies WHERE follower = ? AND leader = ?').get(req.wallet, leader);
    if (!exists && count >= 20) return fail(res, 400, 'You can copy up to 20 traders');
    db.prepare(`INSERT INTO copies (follower, leader, amount_usd, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(follower, leader) DO UPDATE SET amount_usd = excluded.amount_usd`).run(req.wallet, leader, amountUsd, now());
    // Copying implies following, so their posts show up too.
    db.prepare('INSERT OR IGNORE INTO follows (follower, followee, created_at) VALUES (?, ?, ?)').run(req.wallet, leader, now());
    res.json({ copying: true, amountUsd });
  });

  router.delete('/copy/:wallet', requireWalletParam, requireUser, (req, res) => {
    db.prepare('DELETE FROM copies WHERE follower = ? AND leader = ?').run(req.wallet, req.params.wallet);
    res.json({ copying: false });
  });

  // ---- tokens ------------------------------------------------------------------

  router.get('/tokens/:contract', wrap(async (req, res) => {
    const contract = req.params.contract;
    if (!isAccountId(contract)) return fail(res, 400, 'Not a valid token contract');
    let meta = db.prepare('SELECT * FROM tokens WHERE mint = ?').get(contract);
    if (!meta) {
      try {
        meta = await portfolio.tokenMeta(contract);
      } catch {
        return fail(res, 404, 'Token not found');
      }
    }
    const price = (await priceMap([contract])).get(contract) || null;
    const trades = db.prepare(`SELECT t.*, k.symbol, k.name, k.icon FROM trades t LEFT JOIN tokens k ON k.mint = t.mint
      WHERE t.mint = ? ORDER BY t.block_time DESC LIMIT 200`).all(contract);
    // Per member: net position and profit on this token (average cost).
    const byMember = new Map();
    for (const t of [...trades].reverse()) {
      if (!byMember.has(t.wallet)) byMember.set(t.wallet, { qty: 0, cost: 0, realized: 0, bought: 0, sold: 0, buys: 0, sells: 0, last: 0 });
      const m = byMember.get(t.wallet);
      m.last = t.block_time;
      if (t.side === 'buy') {
        m.qty += t.token_amount; m.cost += t.value_usd || 0; m.bought += t.value_usd || 0; m.buys += 1;
      } else {
        m.sells += 1; m.sold += t.value_usd || 0;
        const q = Math.min(t.token_amount, m.qty);
        if (q > 0) {
          const avg = m.cost / m.qty;
          m.realized += (t.value_usd || 0) * (q / t.token_amount) - avg * q;
          m.cost -= avg * q; m.qty -= q;
        }
      }
    }
    const members = [...byMember].map(([w, m]) => {
      const unrealized = price && m.qty > 0 ? m.qty * price - m.cost : 0;
      return { user: publicUser(getUser.get(w)), holding: m.qty, avgEntryUsd: m.qty > 0 ? m.cost / m.qty : null, boughtUsd: m.bought, soldUsd: m.sold, realizedUsd: m.realized, unrealizedUsd: unrealized, totalUsd: m.realized + unrealized, buys: m.buys, sells: m.sells, lastTradeAt: m.last };
    }).sort((a, b) => b.totalUsd - a.totalUsd);
    const day = trades.filter((t) => t.block_time > now() - DAY);
    res.json({
      token: { mint: contract, symbol: meta.symbol || '', name: meta.name || '', icon: meta.icon || null, priceUsd: price },
      stats: {
        members: members.length,
        holders: members.filter((m) => m.holding > 0).length,
        buys24h: day.filter((t) => t.side === 'buy').length,
        sells24h: day.filter((t) => t.side === 'sell').length,
        volume24hUsd: day.reduce((a, t) => a + (t.value_usd || 0), 0),
        memberProfitUsd: members.reduce((a, m) => a + m.totalUsd, 0),
      },
      members,
      trades: trades.slice(0, 50).map(tradeOut).map((t) => ({ ...t, user: publicUser(getUser.get(t.wallet)) })),
      swap: { buyUrl: swapLink('near', contract), sellUrl: swapLink(contract, 'near') },
    });
  }));

  // ---- tips ------------------------------------------------------------------

  // The browser sends NEAR with the user's wallet, then reports the
  // transaction hash. The server checks the transfer on-chain first.
  router.post('/tips', requireUser, wrap(async (req, res) => {
    const hash = String(req.body?.txHash || '');
    const to = String(req.body?.to || '');
    if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash)) return fail(res, 400, 'Bad transaction hash');
    if (!getUser.get(to)) return fail(res, 404, 'Tips can only go to registered accounts');
    if (to === req.wallet) return fail(res, 400, 'You cannot tip yourself');
    let postId = null;
    if (req.body?.postId != null) {
      const p = getPost.get(Number(req.body.postId));
      if (!p || p.author !== to) return fail(res, 400, 'That post does not belong to this account');
      postId = p.id;
    }
    if (db.prepare('SELECT 1 FROM tips WHERE signature = ?').get(hash)) return fail(res, 409, 'This tip is already recorded');

    const tx = await near.txStatus(hash, req.wallet);
    if (!tx) return res.status(202).json({ pending: true, message: 'Waiting for the transaction to finish' });
    const amount = findNearTransfer(tx, req.wallet, to);
    if (amount < cfg.minTipNear) return fail(res, 400, `No transfer of at least ${cfg.minTipNear} NEAR from you to them in that transaction`);
    const blockHash = tx.transaction_outcome?.block_hash;
    if (blockHash) {
      const t = await near.blockTimeMs(blockHash);
      if (now() - t > 60 * 60000) return fail(res, 400, 'That transaction is too old to count as a tip');
    }
    db.prepare('INSERT INTO tips (signature, from_wallet, to_wallet, post_id, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(hash, req.wallet, to, postId, amount, now());
    res.json({ ok: true, near: amount });
  }));

  router.get('/users/:wallet/tips', requireWalletParam, (req, res) => {
    const rows = db.prepare('SELECT * FROM tips WHERE to_wallet = ? OR from_wallet = ? ORDER BY created_at DESC LIMIT 50')
      .all(req.params.wallet, req.params.wallet);
    res.json({
      tips: rows.map((t) => ({
        txHash: t.signature,
        from: publicUser(getUser.get(t.from_wallet)) || { wallet: t.from_wallet },
        to: publicUser(getUser.get(t.to_wallet)) || { wallet: t.to_wallet },
        postId: t.post_id,
        near: t.amount,
        createdAt: t.created_at,
      })),
    });
  });

  // Errors from RPC or price services: tell the browser, keep running.
  // eslint-disable-next-line no-unused-vars
  router.use((err, _req, res, _next) => {
    console.error('social api:', err.message);
    fail(res, 502, `Upstream error: ${err.message}`);
  });

  return router;
}

module.exports = { createSocialRouter };
