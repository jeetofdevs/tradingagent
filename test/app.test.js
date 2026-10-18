const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const { openDb } = require('../src/db');
const { createAuth, base58Encode, base58Decode, isWallet, verifySignature } = require('../src/auth');
const { parseSwaps, findSolTransfer, WSOL, USDC } = require('../src/solana');
const { createPortfolio } = require('../src/portfolio');
const { createSyncer } = require('../src/sync');
const { createSocialRouter } = require('../src/routes');

function newWallet() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  return { address: base58Encode(raw), sign: (msg) => crypto.sign(null, Buffer.from(msg), privateKey) };
}

const MINT = 'BonkmintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1';

// A parsed transaction shaped like Solana RPC jsonParsed output.
function swapTx({ wallet, sig = 'sig1', solBefore = 10, solAfter = 9, tokenBefore = 0, tokenAfter = 1000, mint = MINT, fee = 5000, time = 1700000000, quoteMint = null, quoteBefore = 0, quoteAfter = 0 }) {
  const pre = [];
  const post = [];
  if (tokenBefore) pre.push({ owner: wallet, mint, uiTokenAmount: { uiAmountString: String(tokenBefore) } });
  if (tokenAfter) post.push({ owner: wallet, mint, uiTokenAmount: { uiAmountString: String(tokenAfter) } });
  if (quoteMint) {
    pre.push({ owner: wallet, mint: quoteMint, uiTokenAmount: { uiAmountString: String(quoteBefore) } });
    post.push({ owner: wallet, mint: quoteMint, uiTokenAmount: { uiAmountString: String(quoteAfter) } });
  }
  // Some other account's balances in the pool: must be ignored.
  pre.push({ owner: 'Pool111111111111111111111111111111111111111', mint, uiTokenAmount: { uiAmountString: '999999' } });
  return {
    blockTime: time,
    transaction: { signatures: [sig], message: { accountKeys: [{ pubkey: wallet }, { pubkey: 'Pool111111111111111111111111111111111111111' }], instructions: [] } },
    meta: { err: null, fee, preBalances: [solBefore * 1e9, 0], postBalances: [solAfter * 1e9 - fee, 0], preTokenBalances: pre, postTokenBalances: post, innerInstructions: [] },
  };
}

test('auth: base58 round trip and wallet check', () => {
  const w = newWallet();
  assert.equal(base58Decode(w.address).length, 32);
  assert.equal(base58Encode(base58Decode(w.address)), w.address);
  assert.equal(isWallet(w.address), true);
  assert.equal(isWallet('not a wallet'), false);
  assert.equal(isWallet('0OIl' + 'a'.repeat(40)), false);
});

test('auth: only the real wallet can sign in, and each challenge works once', () => {
  const db = openDb(null);
  const auth = createAuth({ db, appName: 'Test', secret: 's' });
  const alice = newWallet();
  const mallory = newWallet();
  const { nonce, message } = auth.challenge(alice.address, 'example.com');
  assert.match(message, /not a transaction/);
  assert.throws(() => auth.verify(nonce, mallory.sign(message).toString('base64')), /does not match/);
  const c2 = auth.challenge(alice.address, 'example.com');
  assert.equal(auth.verify(c2.nonce, alice.sign(c2.message).toString('base64')), alice.address);
  assert.throws(() => auth.verify(c2.nonce, alice.sign(c2.message).toString('base64')), /expired/);
  assert.equal(verifySignature(alice.address, 'hi', alice.sign('hi')), true);
});

test('auth: sessions are signed and expire', () => {
  let t = 0;
  const auth = createAuth({ db: openDb(null), appName: 'T', secret: 'secret', now: () => t });
  const token = auth.issueSession('WalletA');
  assert.equal(auth.readSession(token), 'WalletA');
  assert.equal(auth.readSession(token.replace('WalletA', 'WalletB')), null);
  assert.equal(auth.readSession('junk'), null);
  t += 31 * 24 * 3600 * 1000;
  assert.equal(auth.readSession(token), null);
});

test('swaps: SOL buy, SOL sell, USDC buy, and non-swaps', () => {
  const w = 'Wallet1111111111111111111111111111111111111';
  const [buy] = parseSwaps(swapTx({ wallet: w }), w);
  assert.equal(buy.side, 'buy');
  assert.equal(buy.mint, MINT);
  assert.equal(buy.tokenAmount, 1000);
  assert.equal(buy.quoteSymbol, 'SOL');
  assert.ok(Math.abs(buy.quoteAmount - 1) < 1e-9, 'network fee is not counted as cost');

  const [sell] = parseSwaps(swapTx({ wallet: w, solBefore: 9, solAfter: 11, tokenBefore: 1000, tokenAfter: 0 }), w);
  assert.equal(sell.side, 'sell');
  assert.ok(Math.abs(sell.quoteAmount - 2) < 1e-9);

  const [usdcBuy] = parseSwaps(swapTx({ wallet: w, solAfter: 10, quoteMint: USDC, quoteBefore: 50, quoteAfter: 0 }), w);
  assert.equal(usdcBuy.quoteSymbol, 'USDC');
  assert.equal(usdcBuy.quoteAmount, 50);

  // Receiving tokens with no payment is an airdrop, not a buy.
  assert.deepEqual(parseSwaps(swapTx({ wallet: w, solAfter: 10 }), w), []);
  // Failed transactions are ignored.
  const failed = swapTx({ wallet: w });
  failed.meta.err = { InstructionError: [0, 'x'] };
  assert.deepEqual(parseSwaps(failed, w), []);
  // Wrapped SOL is a quote, never a "token" bought.
  assert.deepEqual(parseSwaps(swapTx({ wallet: w, mint: WSOL }), w), []);
});

test('tips: finds a SOL transfer between the right wallets only', () => {
  const tx = {
    meta: { err: null, innerInstructions: [] },
    transaction: { message: { instructions: [
      { programId: '11111111111111111111111111111111', parsed: { type: 'transfer', info: { source: 'A', destination: 'B', lamports: 5000000 } } },
      { programId: '11111111111111111111111111111111', parsed: { type: 'transfer', info: { source: 'A', destination: 'C', lamports: 9 } } },
    ] } },
  };
  assert.equal(findSolTransfer(tx, 'A', 'B'), 5000000);
  assert.equal(findSolTransfer(tx, 'B', 'A'), 0);
});

function priceFeed(prices) {
  return async (mints) => new Map(mints.filter((m) => prices[m]).map((m) => [m, { priceUsd: prices[m], symbol: m === WSOL ? 'SOL' : 'BONK', name: 'n', url: '' }]));
}

test('portfolio: average-cost profit with realized and unrealized parts', async () => {
  const db = openDb(null);
  const w = 'Wallet1111111111111111111111111111111111111';
  db.prepare('INSERT INTO users (wallet, created_at) VALUES (?, 0)').run(w);
  const ins = db.prepare('INSERT INTO trades VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  ins.run('s1', w, MINT, 'buy', 1000, 'SOL', 1, 100, 0.1, 1); // 1000 @ $0.10
  ins.run('s2', w, MINT, 'buy', 1000, 'SOL', 2, 300, 0.3, 2); // 1000 @ $0.30 -> avg $0.20
  ins.run('s3', w, MINT, 'sell', 500, 'SOL', 1, 250, 0.5, 3); // sell 500 @ $0.50 -> +$150
  const p = await createPortfolio({ db, rpc: {}, quotes: priceFeed({ [MINT]: 0.4 }) }).pnl(w);
  const [t] = p.tokens;
  assert.ok(Math.abs(t.realizedUsd - 150) < 1e-9);
  assert.ok(Math.abs(t.unrealizedUsd - (1500 * 0.4 - 1500 * 0.2)) < 1e-9); // +300
  assert.ok(Math.abs(p.totalUsd - 450) < 1e-9);
  assert.equal(p.estimate, false);
  assert.equal(p.tokens[0].symbol, 'BONK');
});

test('portfolio: selling tokens bought before joining is flagged as an estimate', async () => {
  const db = openDb(null);
  const w = 'Wallet1111111111111111111111111111111111111';
  db.prepare('INSERT INTO users (wallet, created_at) VALUES (?, 0)').run(w);
  db.prepare('INSERT INTO trades VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('s1', w, MINT, 'sell', 100, 'SOL', 1, 150, 1.5, 1);
  const p = await createPortfolio({ db, rpc: {}, quotes: priceFeed({}) }).pnl(w);
  assert.equal(p.estimate, true);
  assert.equal(p.realizedUsd, 0, 'unknown cost is not counted as profit');
});

// ---- full API flow with a fake chain ----

function fakeRpc(txs, transfers = {}) {
  return {
    getSolBalance: async () => 3,
    getTokenBalances: async () => new Map([[MINT, 1000]]),
    getSignatures: async (_w, { until } = {}) => {
      const list = [...txs].reverse().map((t) => ({ signature: t.transaction.signatures[0], err: null }));
      const cut = until ? list.findIndex((s) => s.signature === until) : -1;
      return cut >= 0 ? list.slice(0, cut) : list;
    },
    getTransaction: async (sig) => txs.find((t) => t.transaction.signatures[0] === sig) || transfers[sig] || null,
    getLatestBlockhash: async () => ({ blockhash: 'hash', lastValidBlockHeight: 1 }),
  };
}

async function startApp({ rpc }) {
  const db = openDb(null);
  const cfg = { appName: 'TestCircle', minTipSol: 0.001, syncBackfillTx: 40, syncIntervalSec: 999, syncWalletsPerRound: 10 };
  const auth = createAuth({ db, appName: cfg.appName, secret: 'x' });
  const portfolio = createPortfolio({ db, rpc, quotes: priceFeed({ [WSOL]: 150, [MINT]: 0.002 }) });
  const syncer = createSyncer({ db, rpc, portfolio, cfg, log: { log() {}, error() {} } });
  const app = express();
  app.use('/api', createSocialRouter({ db, auth, rpc, portfolio, syncer, cfg }));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function client(wallet) {
    let cookie = '';
    const call = async (path, { method = 'GET', body, header = true } = {}) => {
      const res = await fetch(base + path, {
        method,
        headers: { ...(header ? { 'x-requested-with': 'app' } : {}), 'content-type': 'application/json', cookie },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json() };
    };
    if (wallet) {
      const c = await call('/auth/challenge', { method: 'POST', body: { wallet: wallet.address } });
      const v = await call('/auth/verify', { method: 'POST', body: { nonce: c.body.nonce, signature: wallet.sign(c.body.message).toString('base64') } });
      assert.equal(v.status, 200, JSON.stringify(v.body));
    }
    return call;
  }
  return { db, syncer, client, close: () => new Promise((r) => server.close(r)) };
}

test('api: sign in, profile, post, like, repost, reply, follow', async () => {
  const app = await startApp({ rpc: fakeRpc([]) });
  try {
    const alice = newWallet();
    const bob = newWallet();
    const a = await app.client(alice);
    const b = await app.client(bob);
    const anon = await app.client(null);

    assert.equal((await a('/me')).body.user.wallet, alice.address);
    assert.equal((await a('/me', { method: 'PUT', body: { name: 'Alice', bio: 'gm', xHandle: '@alice_sol' } })).body.user.xHandle, 'alice_sol');
    assert.equal((await a('/me', { method: 'PUT', body: { xHandle: 'bad handle!' } })).status, 400);

    const post = (await a('/posts', { method: 'POST', body: { body: 'Aping $BONK <script>' } })).body.post;
    assert.equal(post.body, 'Aping $BONK <script>', 'stored as text; the page escapes it');
    assert.equal((await anon('/posts', { method: 'POST', body: { body: 'hi' } })).status, 401);
    assert.equal((await a('/posts', { method: 'POST', body: { body: 'x'.repeat(501) } })).status, 400);
    assert.equal((await a('/posts', { method: 'POST', body: { body: 'no header' }, header: false })).status, 403, 'CSRF header required');

    assert.equal((await b(`/posts/${post.id}/like`, { method: 'POST' })).body.likes, 1);
    assert.equal((await b(`/posts/${post.id}/repost`, { method: 'POST' })).body.reposts, 1);
    await b('/posts', { method: 'POST', body: { body: 'nice entry', replyTo: post.id } });
    assert.equal((await b(`/users/${alice.address}/follow`, { method: 'POST' })).body.following, true);

    const feed = (await b('/feed')).body.posts;
    assert.equal(feed[0].repostedBy.wallet, bob.address, 'repost shows at the top of the feed');
    assert.equal(feed[0].id, post.id);
    assert.equal(feed[0].liked, true);
    assert.equal(feed[0].replies, 1);
    assert.equal((await b('/feed?tab=following')).body.posts.length >= 1, true);

    const prof = (await anon(`/users/${alice.address}`)).body;
    assert.equal(prof.followers, 1);
    assert.equal(prof.user.name, 'Alice');

    // Only the author can delete; deleting hides reposts too.
    assert.equal((await b(`/posts/${post.id}`, { method: 'DELETE' })).status, 403);
    await a(`/posts/${post.id}`, { method: 'DELETE' });
    assert.equal((await anon('/feed')).body.posts.some((p) => p.id === post.id), false);
  } finally {
    await app.close();
  }
});

test('api: trade history, auto trade posts, holdings, profit and leaderboard', async () => {
  const alice = newWallet();
  const txs = [swapTx({ wallet: alice.address, sig: 'old1', solBefore: 10, solAfter: 9, tokenAfter: 1000, time: 1700000000 })];
  const rpc = fakeRpc(txs);
  const app = await startApp({ rpc });
  try {
    const a = await app.client(alice);
    await new Promise((r) => setTimeout(r, 50)); // first sync runs right after joining
    let trades = (await a(`/users/${alice.address}/trades`)).body.trades;
    assert.equal(trades.length, 1);
    assert.equal(trades[0].valueUsd, 150, '1 SOL at $150');
    assert.equal((await a('/feed')).body.posts.length, 0, 'old history is not spammed into the feed');

    // A new swap after joining becomes a feed post.
    txs.push(swapTx({ wallet: alice.address, sig: 'new1', solBefore: 9, solAfter: 12, tokenBefore: 1000, tokenAfter: 0, time: 1700000600 }));
    await app.syncer.syncWallet(alice.address);
    trades = (await a(`/users/${alice.address}/trades`)).body.trades;
    assert.equal(trades.length, 2);
    const feed = (await a('/feed')).body.posts;
    assert.equal(feed[0].kind, 'trade');
    assert.equal(feed[0].trade.side, 'sell');
    assert.equal((await a('/trades/recent')).body.trades.length, 2);

    const holdings = (await a(`/users/${alice.address}/holdings`)).body;
    assert.equal(holdings.totalUsd, 3 * 150 + 1000 * 0.002);

    const pnl = (await a(`/users/${alice.address}/pnl`)).body;
    assert.equal(pnl.realizedUsd, 3 * 150 - 150, 'bought for 1 SOL, sold for 3 SOL');
    assert.equal(pnl.winRatePct, 100);

    const board = (await a('/leaderboard')).body.rows;
    assert.equal(board[0].user.wallet, alice.address);
  } finally {
    await app.close();
  }
});

test('api: tips are checked on-chain before they count', async () => {
  const alice = newWallet();
  const bob = newWallet();
  const sig = '5'.repeat(88);
  const transfer = (from, to, lamports) => ({
    blockTime: Math.floor(Date.now() / 1000),
    meta: { err: null, innerInstructions: [] },
    transaction: { signatures: [sig], message: { instructions: [{ programId: '11111111111111111111111111111111', parsed: { type: 'transfer', info: { source: from, destination: to, lamports } } }] } },
  });
  const transfers = {};
  const app = await startApp({ rpc: fakeRpc([], transfers) });
  try {
    const a = await app.client(alice);
    await app.client(bob);
    const post = (await (await app.client(bob))('/posts', { method: 'POST', body: { body: 'tip me' } })).body.post;

    // Not on-chain yet: pending.
    assert.equal((await a('/tips', { method: 'POST', body: { signature: sig, to: bob.address } })).status, 202);
    // Wrong direction: rejected.
    transfers[sig] = transfer(bob.address, alice.address, 1e8);
    assert.equal((await a('/tips', { method: 'POST', body: { signature: sig, to: bob.address } })).status, 400);
    // Real transfer: recorded once.
    transfers[sig] = transfer(alice.address, bob.address, 5e7);
    const ok = await a('/tips', { method: 'POST', body: { signature: sig, to: bob.address, postId: post.id } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.sol, 0.05);
    assert.equal((await a('/tips', { method: 'POST', body: { signature: sig, to: bob.address } })).status, 409);
    assert.equal((await a(`/users/${bob.address}`)).body.tipsReceivedSol, 0.05);
    assert.equal((await a('/feed')).body.posts.find((p) => p.id === post.id).tipsSol, 0.05);
  } finally {
    await app.close();
  }
});

const { bestPairs } = require('../src/prices');

test('prices: keeps the deepest pool and ignores other chains', () => {
  const pair = (addr, liq, chainId = 'solana') => ({ chainId, baseToken: { address: addr, symbol: addr }, priceUsd: '0.5', liquidity: { usd: liq } });
  const best = bestPairs([pair('A', 10), pair('A', 50), pair('B', 5, 'ethereum')], 'solana');
  assert.equal(best.size, 1);
  assert.equal(best.get('A').liquidityUsd, 50);
  assert.equal(best.get('A').priceUsd, 0.5);
});
