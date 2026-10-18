const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const { openDb } = require('../src/db');
const { createAuth, isAccountId, nep413Hash, verifyNep413, base58Encode, base58Decode } = require('../src/auth');
const { parseFtEvents, findNearTransfer, findFtTransfer, WNEAR } = require('../src/near');
const { createPortfolio, safeIcon } = require('../src/portfolio');
const { createSyncer } = require('../src/sync');
const { createSocialRouter } = require('../src/routes');
const { bestPairs } = require('../src/prices');

const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const TOKEN = 'blackdragon.tkn.near';

// A NEAR account with an ed25519 full-access key that signs like a wallet.
function newAccount(accountId) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = `ed25519:${base58Encode(Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url'))}`;
  return {
    accountId,
    publicKey: pub,
    // What a NEP-413 wallet returns from signMessage.
    signMessage({ message, nonce, recipient, callbackUrl = null }) {
      const sig = crypto.sign(null, nep413Hash({ message, nonce: Buffer.from(nonce, 'base64'), recipient, callbackUrl }), privateKey);
      return { accountId, publicKey: pub, signature: sig.toString('base64') };
    },
  };
}

// Fake NEAR access: accounts own the keys registered here.
function fakeNear({ keys = {}, events = {}, txs = {} } = {}) {
  return {
    accessKeyPermission: async (acc, pk) => (keys[acc] && keys[acc][pk]) || null,
    nearBalance: async () => 12,
    ftBalances: async () => new Map([[TOKEN, '5000000000000000000000']]), // 5000 with 18 decimals
    ftMetadata: async () => ({ symbol: 'BLACKDRAGON', name: 'Black Dragon', decimals: 18, icon: 'javascript:alert(1)' }),
    ftEvents: async (acc) => ({ events: [...(events[acc] || [])].sort((a, b) => Number(BigInt(b.block_timestamp) - BigInt(a.block_timestamp))), cursor: null }),
    txStatus: async (hash) => txs[hash] || null,
    blockTimeMs: async () => Date.now(),
  };
}

const ns = (ms) => String(BigInt(ms) * 1000000n);
function ftEvent({ account, hash, contract, delta, decimals = 24, cause = 'TRANSFER', time = 1700000000000, symbol = 'X' }) {
  return { affected_account_id: account, transaction_hash: hash, delta_amount: String(delta), cause, block_timestamp: ns(time), ft: { contract, decimals, symbol, name: symbol } };
}
const yocto = (near) => (BigInt(Math.round(near * 1e6)) * 10n ** 18n).toString();
const e18 = (n) => (BigInt(n) * 10n ** 18n).toString();

// A buy paid in native NEAR: wNEAR minted, sent to the DEX, token received.
function nearBuy(account, hash, near, tokens, time) {
  return [
    ftEvent({ account, hash, contract: WNEAR, delta: yocto(near), cause: 'MINT', time, symbol: 'wNEAR' }),
    ftEvent({ account, hash, contract: WNEAR, delta: `-${yocto(near)}`, time, symbol: 'wNEAR' }),
    ftEvent({ account, hash, contract: TOKEN, delta: e18(tokens), decimals: 18, time, symbol: 'BLACKDRAGON' }),
  ];
}
function nearSell(account, hash, near, tokens, time) {
  return [
    ftEvent({ account, hash, contract: TOKEN, delta: `-${e18(tokens)}`, decimals: 18, time, symbol: 'BLACKDRAGON' }),
    ftEvent({ account, hash, contract: WNEAR, delta: yocto(near), time, symbol: 'wNEAR' }),
    ftEvent({ account, hash, contract: WNEAR, delta: `-${yocto(near)}`, cause: 'BURN', time, symbol: 'wNEAR' }),
  ];
}

test('auth: NEAR account names', () => {
  for (const ok of ['alice.near', 'bob.tg', 'a-b_c.sub.near', 'ab', 'f'.repeat(64)]) assert.equal(isAccountId(ok), true, ok);
  for (const bad of ['A.near', 'a', 'alice..near', '.near', 'alice.near.', 'a@b.near', 'x'.repeat(65)]) assert.equal(isAccountId(bad), false, bad);
  const raw = crypto.randomBytes(32);
  assert.deepEqual(base58Decode(base58Encode(raw)), raw);
});

test('auth: NEP-413 signature check, with and without a callback URL', () => {
  const alice = newAccount('alice.near');
  const params = { message: 'hi', nonce: crypto.randomBytes(32).toString('base64'), recipient: 'example.com' };
  const signed = alice.signMessage(params);
  const base = { ...params, nonce: Buffer.from(params.nonce, 'base64'), publicKey: alice.publicKey, signature: signed.signature };
  assert.equal(verifyNep413(base), true);
  assert.equal(verifyNep413({ ...base, message: 'other' }), false);
  const withCb = alice.signMessage({ ...params, callbackUrl: 'https://x.test/' });
  assert.equal(verifyNep413({ ...base, signature: withCb.signature, callbackUrl: 'https://x.test/' }), true);
  assert.equal(verifyNep413({ ...base, signature: withCb.signature }), false);
});

test('auth: needs a full-access key of that exact account, nonce works once', async () => {
  const alice = newAccount('alice.near');
  const mallory = newAccount('mallory.near');
  const keys = { 'alice.near': { [alice.publicKey]: 'FullAccess' }, 'mallory.near': { [mallory.publicKey]: 'FullAccess' } };
  const auth = createAuth({ db: openDb(null), near: fakeNear({ keys }), appName: 'T', secret: 's' });

  const c1 = auth.challenge('example.com');
  assert.equal(await auth.verify({ nonce: c1.nonce, ...alice.signMessage(c1) }), 'alice.near');
  await assert.rejects(auth.verify({ nonce: c1.nonce, ...alice.signMessage(c1) }), /expired/);

  // Mallory signs with her own key but claims to be alice.
  const c2 = auth.challenge('example.com');
  await assert.rejects(auth.verify({ nonce: c2.nonce, ...mallory.signMessage(c2), accountId: 'alice.near' }), /not a full-access key/);

  // Browser wallets sign the callback URL too.
  const c3 = auth.challenge('example.com');
  const signed = alice.signMessage({ ...c3, callbackUrl: 'https://example.com/' });
  assert.equal(await auth.verify({ nonce: c3.nonce, ...signed, callbackUrl: 'https://example.com/' }), 'alice.near');
});

test('auth: sessions are signed and expire', () => {
  let t = 0;
  const auth = createAuth({ db: openDb(null), near: fakeNear(), appName: 'T', secret: 'k', now: () => t });
  const token = auth.issueSession('alice.near');
  assert.equal(auth.readSession(token), 'alice.near');
  const [, exp, mac] = token.split('.');
  assert.equal(auth.readSession(`${Buffer.from('bob.near').toString('base64url')}.${exp}.${mac}`), null);
  t += 31 * 24 * 3600 * 1000;
  assert.equal(auth.readSession(token), null);
});

test('swaps: NEAR buy, NEAR sell, USDC buy; transfers ignored', () => {
  const a = 'alice.near';
  const [buy] = parseFtEvents(nearBuy(a, 'H1', 2, 1000, 1), a);
  assert.equal(buy.side, 'buy');
  assert.equal(buy.mint, TOKEN);
  assert.equal(buy.quoteSymbol, 'NEAR');
  assert.ok(Math.abs(buy.quoteAmount - 2) < 1e-9, 'mint is not counted, the transfer out is');
  assert.equal(buy.tokenAmount, 1000);

  const [sell] = parseFtEvents(nearSell(a, 'H2', 3, 1000, 2), a);
  assert.equal(sell.side, 'sell');
  assert.ok(Math.abs(sell.quoteAmount - 3) < 1e-9);

  const usdcBuy = parseFtEvents([
    ftEvent({ account: a, hash: 'H3', contract: USDC, delta: '-25000000', decimals: 6 }),
    ftEvent({ account: a, hash: 'H3', contract: TOKEN, delta: e18(10), decimals: 18 }),
  ], a);
  assert.equal(usdcBuy[0].quoteSymbol, 'USDC');
  assert.equal(usdcBuy[0].quoteAmount, 25);

  // Receiving a token with no payment (airdrop) or a plain transfer is not a trade.
  assert.deepEqual(parseFtEvents([ftEvent({ account: a, hash: 'H4', contract: TOKEN, delta: e18(5), decimals: 18 })], a), []);
});

test('tips: only a successful transfer from sender to receiver counts', () => {
  const tx = (signer, receiver, deposit, status = { SuccessValue: '' }) => ({ status, transaction: { signer_id: signer, receiver_id: receiver, actions: [{ Transfer: { deposit } }] } });
  assert.equal(findNearTransfer(tx('a.near', 'b.near', yocto(0.5)), 'a.near', 'b.near'), 0.5);
  assert.equal(findNearTransfer(tx('a.near', 'c.near', yocto(0.5)), 'a.near', 'b.near'), 0);
  assert.equal(findNearTransfer(tx('a.near', 'b.near', yocto(0.5), { Failure: {} }), 'a.near', 'b.near'), 0);
});

test('prices and icons', () => {
  const best = bestPairs([
    { chainId: 'near', baseToken: { address: 'x.near', symbol: 'X' }, priceUsd: '2', liquidity: { usd: 10 } },
    { chainId: 'near', baseToken: { address: 'x.near', symbol: 'X' }, priceUsd: '3', liquidity: { usd: 99 } },
    { chainId: 'solana', baseToken: { address: 'y', symbol: 'Y' }, priceUsd: '1', liquidity: { usd: 99 } },
  ]);
  assert.equal(best.size, 1);
  assert.equal(best.get('x.near').priceUsd, 3);
  assert.equal(safeIcon('javascript:alert(1)'), null);
  assert.equal(safeIcon('data:text/html,<script>'), null);
  assert.ok(safeIcon('data:image/svg+xml;base64,AAAA'));
});

const priceFeed = (prices) => async (cs) => new Map(cs.filter((c) => prices[c]).map((c) => [c, { priceUsd: prices[c], symbol: c === WNEAR ? 'wNEAR' : 'BLACKDRAGON' }]));

test('portfolio: average-cost profit with realized and unrealized parts', async () => {
  const db = openDb(null);
  db.prepare('INSERT INTO users (wallet, created_at) VALUES (?, 0)').run('alice.near');
  const ins = db.prepare('INSERT INTO trades VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  ins.run('h1', 'alice.near', TOKEN, 'buy', 1000, 'NEAR', 20, 100, 0.1, 1);
  ins.run('h2', 'alice.near', TOKEN, 'buy', 1000, 'NEAR', 60, 300, 0.3, 2); // avg $0.20
  ins.run('h3', 'alice.near', TOKEN, 'sell', 500, 'NEAR', 50, 250, 0.5, 3); // +$150
  const p = await createPortfolio({ db, near: fakeNear(), quotes: priceFeed({ [TOKEN]: 0.4 }) }).pnl('alice.near');
  assert.ok(Math.abs(p.realizedUsd - 150) < 1e-9);
  assert.ok(Math.abs(p.unrealizedUsd - 300) < 1e-9);
  assert.equal(p.estimate, false);
});

// ---- full API flow ----

async function startApp(nearFake) {
  const db = openDb(null);
  const cfg = { appName: 'Near Social', minTipNear: 0.01, syncBackfillEvents: 100, syncIntervalSec: 999, syncAccountsPerRound: 10 };
  const auth = createAuth({ db, near: nearFake, appName: cfg.appName, secret: 'x' });
  const portfolio = createPortfolio({ db, near: nearFake, quotes: priceFeed({ [WNEAR]: 5, [TOKEN]: 0.01 }) });
  const syncer = createSyncer({ db, near: nearFake, portfolio, cfg, log: { log() {}, error() {} } });
  const app = express();
  app.use('/api', createSocialRouter({ db, auth, near: nearFake, portfolio, syncer, cfg }));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function client(account) {
    let cookie = '';
    const call = async (path, { method = 'GET', body, header = true } = {}) => {
      const res = await fetch(base + path, {
        method,
        headers: { ...(header ? { 'x-requested-with': 'app' } : {}), 'content-type': 'application/json', cookie },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json(), cookie };
    };
    if (account) {
      const c = (await call('/auth/challenge', { method: 'POST', body: {} })).body;
      const v = await call('/auth/verify', { method: 'POST', body: { nonce: c.nonce, ...account.signMessage(c) } });
      assert.equal(v.status, 200, JSON.stringify(v.body));
    }
    return call;
  }
  return { db, syncer, client, base, close: () => new Promise((r) => server.close(r)) };
}

function world(...accounts) {
  const keys = {};
  for (const a of accounts) keys[a.accountId] = { [a.publicKey]: 'FullAccess' };
  return { keys, events: {}, txs: {} };
}

test('api: sign in, profile, post, like, repost, reply, follow, delete', async () => {
  const alice = newAccount('alice.near');
  const bob = newAccount('bob.near');
  const app = await startApp(fakeNear(world(alice, bob)));
  try {
    const a = await app.client(alice);
    const b = await app.client(bob);
    const anon = await app.client(null);
    assert.equal((await a('/me')).body.user.wallet, 'alice.near');
    assert.equal((await a('/me', { method: 'PUT', body: { name: 'Alice', bio: 'gm', xHandle: '@alice' } })).body.user.xHandle, 'alice');

    const post = (await a('/posts', { method: 'POST', body: { body: 'Aping $BLACKDRAGON <script>' } })).body.post;
    assert.equal((await anon('/posts', { method: 'POST', body: { body: 'hi' } })).status, 401);
    assert.equal((await a('/posts', { method: 'POST', body: { body: 'x' }, header: false })).status, 403);

    assert.equal((await b(`/posts/${post.id}/like`, { method: 'POST' })).body.likes, 1);
    assert.equal((await b(`/posts/${post.id}/repost`, { method: 'POST' })).body.reposts, 1);
    await b('/posts', { method: 'POST', body: { body: 'nice', replyTo: post.id } });
    assert.equal((await b('/users/alice.near/follow', { method: 'POST' })).body.following, true);

    const feed = (await b('/feed')).body.posts;
    assert.equal(feed[0].repostedBy.wallet, 'bob.near');
    assert.equal(feed[0].liked, true);
    assert.equal(feed[0].replies, 1);
    assert.equal((await anon('/users/alice.near')).body.followers, 1);
    assert.equal((await anon('/users/NOT_VALID')).status, 400);

    assert.equal((await b(`/posts/${post.id}`, { method: 'DELETE' })).status, 403);
    await a(`/posts/${post.id}`, { method: 'DELETE' });
    assert.equal((await anon('/feed')).body.posts.some((p) => p.id === post.id), false);
  } finally {
    await app.close();
  }
});

test('api: trades, auto trade posts, holdings, profit, leaderboard', async () => {
  const alice = newAccount('alice.near');
  const w = world(alice);
  w.events['alice.near'] = nearBuy('alice.near', 'Hbuy', 2, 1000, Date.now() - 3600000);
  const app = await startApp(fakeNear(w));
  try {
    const a = await app.client(alice);
    await new Promise((r) => setTimeout(r, 50)); // first sync runs after joining
    assert.equal((await a('/users/alice.near/trades')).body.trades.length, 1);
    assert.equal((await a('/feed')).body.posts.length, 0, 'old history is not posted');

    w.events['alice.near'].push(...nearSell('alice.near', 'Hsell', 6, 1000, Date.now() - 1000));
    await app.syncer.syncAccount('alice.near');
    const trades = (await a('/users/alice.near/trades')).body.trades;
    assert.equal(trades.length, 2);
    assert.equal(trades[0].symbol, 'BLACKDRAGON');
    const feed = (await a('/feed')).body.posts;
    assert.equal(feed[0].kind, 'trade');
    assert.equal(feed[0].trade.side, 'sell');

    const h = (await a('/users/alice.near/holdings')).body;
    assert.equal(h.totalUsd, 12 * 5 + 5000 * 0.01);
    assert.equal(h.tokens.find((t) => t.mint === TOKEN).icon, null, 'unsafe icon dropped');

    const pnl = (await a('/users/alice.near/pnl')).body;
    assert.equal(pnl.realizedUsd, 6 * 5 - 2 * 5);
    assert.equal((await a('/leaderboard')).body.rows[0].user.wallet, 'alice.near');
  } finally {
    await app.close();
  }
});

test('api: tips are checked on-chain before they count', async () => {
  const alice = newAccount('alice.near');
  const bob = newAccount('bob.near');
  const w = world(alice, bob);
  const app = await startApp(fakeNear(w));
  const hash = base58Encode(crypto.randomBytes(32));
  const tx = (signer, receiver, near) => ({ status: { SuccessValue: '' }, transaction_outcome: { block_hash: 'b' }, transaction: { signer_id: signer, receiver_id: receiver, actions: [{ Transfer: { deposit: yocto(near) } }] } });
  try {
    const a = await app.client(alice);
    const b = await app.client(bob);
    const post = (await b('/posts', { method: 'POST', body: { body: 'tip me' } })).body.post;
    assert.equal((await a('/tips', { method: 'POST', body: { txHash: hash, to: 'bob.near' } })).status, 202);
    w.txs[hash] = tx('alice.near', 'carol.near', 1);
    assert.equal((await a('/tips', { method: 'POST', body: { txHash: hash, to: 'bob.near' } })).status, 400);
    w.txs[hash] = tx('alice.near', 'bob.near', 0.5);
    const ok = await a('/tips', { method: 'POST', body: { txHash: hash, to: 'bob.near', postId: post.id } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.amount, 0.5);
    assert.equal(ok.body.usd, 2.5, '0.5 NEAR at $5');
    assert.equal((await a('/tips', { method: 'POST', body: { txHash: hash, to: 'bob.near' } })).status, 409);
    assert.equal((await a('/users/bob.near')).body.tipsReceivedUsd, 2.5);
    assert.equal((await a('/feed')).body.posts.find((p) => p.id === post.id).tipsUsd, 2.5);
  } finally {
    await app.close();
  }
});

const { simulateCopy } = require('../src/copy');

test('copy sim: mirrors buys at your size and sells the same fraction', () => {
  const T = (side, qty, usd, time, mint = TOKEN) => ({ side, token_amount: qty, value_usd: usd, block_time: time, mint });
  const trades = [
    T('buy', 500, 50, 1), // before copying: ignored
    T('buy', 1000, 100, 10), // leader buys at $0.10
    T('sell', 500, 150, 20), // leader sells half at $0.30
    T('sell', 500, 25, 30), // leader sells the rest at $0.05
  ];
  const half = simulateCopy(trades.slice(0, 3), { amountUsd: 200, since: 5, costPct: 0 });
  assert.equal(half.copiedBuys, 1);
  assert.equal(half.investedUsd, 200);
  // Follower bought 2000 tokens; leader sold half -> follower sells 1000 @ $0.30 = $300 for $100 of cost.
  assert.ok(Math.abs(half.realizedUsd - 200) < 1e-9, String(half.realizedUsd));
  // Then the leader sells the rest -> follower sells 1000 @ $0.05 = $50 for the last $100 of cost.
  const full = simulateCopy(trades, { amountUsd: 200, since: 5, costPct: 0 }, new Map());
  assert.equal(full.closedPositions, 1);
  assert.ok(Math.abs(full.totalUsd - (200 - 50)) < 1e-9, `total ${full.totalUsd}`);
  assert.ok(Math.abs(full.returnPct - 75) < 1e-9);
  // Swap costs reduce the result.
  assert.ok(simulateCopy(trades, { amountUsd: 200, since: 5, costPct: 1 }).totalUsd < full.totalUsd);
});

test('copy sim: open positions are valued at the current price', () => {
  const sim = simulateCopy([{ side: 'buy', token_amount: 100, value_usd: 10, block_time: 1, mint: TOKEN }], { amountUsd: 50, costPct: 0 }, new Map([[TOKEN, 0.3]]));
  assert.ok(Math.abs(sim.unrealizedUsd - (500 * 0.3 - 50)) < 1e-9);
  assert.equal(sim.closedPositions, 0);
});

test('api: copy a trader, see signals with swap links, stop copying; token page', async () => {
  const alice = newAccount('alice.near');
  const bob = newAccount('bob.near');
  const w = world(alice, bob);
  const app = await startApp(fakeNear(w));
  try {
    const a = await app.client(alice);
    const b = await app.client(bob);
    assert.equal((await b('/copy/alice.near', { method: 'PUT', body: { amountUsd: 0 } })).status, 400);
    assert.equal((await b('/copy/bob.near', { method: 'PUT', body: { amountUsd: 50 } })).status, 400, 'no self-copy');
    assert.equal((await b('/copy/alice.near', { method: 'PUT', body: { amountUsd: 50 } })).body.copying, true);
    assert.equal((await b('/users/alice.near')).body.copying.amountUsd, 50);
    assert.equal((await b('/users/alice.near')).body.isFollowing, true, 'copying also follows');

    // Alice trades after Bob starts copying.
    w.events['alice.near'] = [...nearBuy('alice.near', 'Hc1', 10, 1000, Date.now() + 1000)];
    app.db.prepare('UPDATE users SET backfilled = 1 WHERE wallet = ?').run('alice.near');
    await app.syncer.syncAccount('alice.near');
    const copyRes = await b('/copy');
    const copy = copyRes.body;
    assert.equal(copyRes.status, 200, JSON.stringify(copy));
    assert.equal(copy.copies.length, 1);
    assert.equal(copy.copies[0].copiedBuys, 1);
    assert.equal(copy.signals.length, 1);
    assert.equal(copy.signals[0].side, 'buy');
    assert.equal(copy.signals[0].yourAmountUsd, 50);
    assert.match(copy.signals[0].swapUrl, /near%7C|near\|/i);
    assert.match(copy.signals[0].swapUrl, /blackdragon/);

    const sim = (await a('/users/alice.near/copy-sim?days=30&amount=100')).body;
    assert.equal(sim.copiedBuys, 1);
    assert.equal(sim.investedUsd, 100);

    const token = (await a(`/tokens/${TOKEN}`)).body;
    assert.equal(token.token.symbol, 'BLACKDRAGON');
    assert.equal(token.members[0].user.wallet, 'alice.near');
    assert.equal(token.stats.buys24h >= 1, true);
    assert.match(token.swap.buyUrl, /blackdragon/);

    const board = (await a('/leaderboard')).body.rows;
    assert.equal(board[0].copiers, 1);
    assert.ok(board[0].copy30);

    assert.equal((await b('/copy/alice.near', { method: 'DELETE' })).body.copying, false);
    assert.equal((await b('/copy')).body.copies.length, 0);
  } finally {
    await app.close();
  }
});

const ftTx = (token, from, to, raw, { ok = true, executor = token } = {}) => ({
  status: ok ? { SuccessValue: '' } : { Failure: {} },
  transaction_outcome: { block_hash: 'b' },
  transaction: { signer_id: from, receiver_id: token, actions: [] },
  receipts_outcome: [{ outcome: { executor_id: executor, status: { SuccessValue: '' }, logs: [`EVENT_JSON:${JSON.stringify({ standard: 'nep141', version: '1.0.0', event: 'ft_transfer', data: [{ old_owner_id: from, new_owner_id: to, amount: raw }] })}`] } }],
});

test('token tips: only real NEP-141 transfer events from the token contract count', () => {
  assert.equal(findFtTransfer(ftTx(TOKEN, 'a.near', 'b.near', '500'), TOKEN, 'a.near', 'b.near'), 500n);
  assert.equal(findFtTransfer(ftTx(TOKEN, 'a.near', 'b.near', '500', { executor: 'evil.near' }), TOKEN, 'a.near', 'b.near'), 0n, 'event from another contract');
  assert.equal(findFtTransfer(ftTx(TOKEN, 'a.near', 'c.near', '500'), TOKEN, 'a.near', 'b.near'), 0n);
  assert.equal(findFtTransfer(ftTx(TOKEN, 'a.near', 'b.near', '500', { ok: false }), TOKEN, 'a.near', 'b.near'), 0n);
});

test('api: tip with any token shows its dollar value on the post', async () => {
  const alice = newAccount('alice.near');
  const bob = newAccount('bob.near');
  const w = world(alice, bob);
  const fake = fakeNear(w);
  fake.view = async (contract, method) => (method === 'storage_balance_of' ? null : { min: '1250000000000000000000' });
  const app = await startApp(fake);
  const hash = base58Encode(crypto.randomBytes(32));
  try {
    const a = await app.client(alice);
    const b = await app.client(bob);
    const post = (await b('/posts', { method: 'POST', body: { body: 'tip me tokens' } })).body.post;
    const prep = (await a(`/tips/prepare?token=${TOKEN}&to=bob.near`)).body;
    assert.equal(prep.registered, false);
    assert.equal(prep.decimals, 18);
    assert.equal(prep.storageDeposit, '1250000000000000000000');
    // 2000 tokens (18 decimals) at $0.01 = $20
    w.txs[hash] = ftTx(TOKEN, 'alice.near', 'bob.near', e18(2000));
    const r = await a('/tips', { method: 'POST', body: { txHash: hash, to: 'bob.near', postId: post.id, token: TOKEN } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.amount, 2000);
    assert.equal(r.body.usd, 20);
    assert.equal(r.body.symbol, 'BLACKDRAGON');
    const p = (await a('/feed')).body.posts.find((x) => x.id === post.id);
    assert.equal(p.tipsUsd, 20);
    assert.equal(p.tipCount, 1);
    const tips = (await a('/users/bob.near/tips')).body.tips;
    assert.equal(tips[0].symbol, 'BLACKDRAGON');
    assert.equal((await a('/stats')).body.tipsUsd, 20);
  } finally {
    await app.close();
  }
});

test('api: profile picture upload accepts real images only and serves them safely', async () => {
  const alice = newAccount('alice.near');
  const app = await startApp(fakeNear(world(alice)));
  try {
    const a = await app.client(alice);
    const base = app.base;
    const cookie = (await a('/me')).cookie;
    const put = (bytes, type) => fetch(`${base}/me/avatar`, { method: 'PUT', headers: { 'x-requested-with': 'app', 'content-type': type, cookie }, body: bytes });
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(200)]);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

    assert.equal((await put(svg, 'image/svg+xml')).status, 400, 'SVG rejected');
    assert.equal((await put(Buffer.alloc(500 * 1024, 1), 'image/png')).status, 413, 'too big');
    const ok = await put(png, 'image/png');
    assert.equal(ok.status, 200);
    const { user } = await ok.json();
    assert.match(user.avatarUrl, /^\/api\/avatar\/alice\.near\?v=1$/);

    const img = await fetch(`${base.replace(/\/api$/, '')}${user.avatarUrl}`);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), png);
    assert.equal((await a('/users/alice.near')).body.user.avatarUrl, user.avatarUrl);

    const anonPut = await fetch(`${base}/me/avatar`, { method: 'PUT', headers: { 'x-requested-with': 'app', 'content-type': 'image/png' }, body: png });
    assert.equal(anonPut.status, 401);
    assert.equal((await a('/me/avatar', { method: 'DELETE' })).body.user.avatarUrl, null);
  } finally {
    await app.close();
  }
});
