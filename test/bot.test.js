const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../src/scoring');
const { computeStats, edgeCheck } = require('../src/stats');
const { createEngine } = require('../src/engine');
const { createMemoryStore } = require('../src/store');
const { bestPairs } = require('../src/sources/dexscreener');
const { createRugCheck } = require('../src/safety');
const { createMockSource } = require('../src/sources/mock');

function testConfig(overrides = {}) {
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) if (/^[A-Z_]+$/.test(k) && k !== 'PATH') delete process.env[k];
  const { loadConfig } = require('../src/config');
  const cfg = loadConfig();
  Object.assign(process.env, saved);
  return { ...cfg, ...overrides };
}

// A token that should pass every filter with a good score.
function goodToken(overrides = {}) {
  return {
    address: 'TOKEN1',
    symbol: 'GOOD',
    name: 'Good',
    url: 'https://dexscreener.com/solana/x',
    priceUsd: 0.001,
    liquidityUsd: 150000,
    fdv: 1500000,
    marketCap: 1500000,
    ageMin: 240,
    buysM5: 40,
    sellsM5: 25,
    buysH1: 400,
    sellsH1: 220,
    volM5: 20000,
    volH1: 250000,
    volH24: 900000,
    chgM5: 6,
    chgH1: 35,
    chgH24: 80,
    ...overrides,
  };
}

test('scoring: a healthy token passes', () => {
  const r = evaluate(goodToken(), testConfig());
  assert.equal(r.pass, true, r.rejects.join(', '));
  assert.ok(r.score >= 60);
});

test('scoring: rug signals are rejected', () => {
  const cfg = testConfig();
  assert.match(evaluate(goodToken({ liquidityUsd: 5000 }), cfg).rejects.join(), /liquidity/);
  assert.match(evaluate(goodToken({ sellsH1: 0 }), cfg).rejects.join(), /honeypot/);
  assert.match(evaluate(goodToken({ ageMin: 5 }), cfg).rejects.join(), /too new/);
  assert.match(evaluate(goodToken({ chgH1: 400 }), cfg).rejects.join(), /already pumped/);
  assert.match(evaluate(goodToken({ fdv: 150000 * 100 }), cfg).rejects.join(), /thin pool/);
});

test('stats: streaks, drawdown and expectancy', () => {
  const trades = [10, 20, -5, 30, 40, 50, -10].map((p) => ({ pnlUsd: p, pnlPct: p }));
  const equity = [{ v: 100 }, { v: 150 }, { v: 120 }, { v: 160 }];
  const s = computeStats(trades, equity, 100);
  assert.equal(s.bestWinStreak, 3);
  assert.equal(s.worstLossStreak, 1);
  assert.deepEqual(s.currentStreak, { type: 'loss', length: 1 });
  assert.equal(s.maxDrawdownPct, 20);
  assert.equal(s.expectancyUsd, 135 / 7);
  assert.equal(s.profitFactor, 150 / 15);
});

test('edge check: small samples are never called real', () => {
  assert.equal(edgeCheck([50, 60, 70]).verdict, 'not-enough-trades');
  const steady = Array.from({ length: 40 }, (_, i) => 5 + (i % 3));
  assert.equal(edgeCheck(steady).verdict, 'likely-real-edge');
  const noise = Array.from({ length: 40 }, (_, i) => (i % 2 ? 20 : -20));
  assert.equal(edgeCheck(noise).verdict, 'could-be-luck');
});

test('dexscreener: keeps deepest pool and ignores other chains', () => {
  const pair = (addr, liq, chainId = 'solana') => ({
    chainId,
    pairAddress: `${addr}-${liq}`,
    baseToken: { address: addr, symbol: addr },
    priceUsd: '0.5',
    liquidity: { usd: liq },
    txns: { h1: { buys: 1, sells: 2 } },
  });
  const best = bestPairs([pair('A', 10), pair('A', 50), pair('B', 5, 'ethereum')], 'solana', Date.now());
  assert.equal(best.size, 1);
  assert.equal(best.get('A').liquidityUsd, 50);
  assert.equal(best.get('A').priceUsd, 0.5);
  assert.equal(best.get('A').sellsH1, 2);
});

function fakeMarket(tokens) {
  const prices = new Map(tokens.map((t) => [t.address, t]));
  return {
    name: 'fake',
    set(addr, changes) {
      prices.set(addr, { ...prices.get(addr), ...changes });
    },
    remove(addr) {
      prices.delete(addr);
    },
    async candidates() {
      return [...prices.values()];
    },
    async quotes(addresses) {
      return new Map(addresses.filter((a) => prices.has(a)).map((a) => [a, prices.get(a)]));
    },
  };
}

const quiet = { log() {}, error() {} };

test('engine: buys, then takes profit, with fees on both sides', async () => {
  let clock = 1_000_000;
  const cfg = testConfig({ costPerSidePct: 1, positionSizePct: 10 });
  const market = fakeMarket([goodToken()]);
  const engine = createEngine({ cfg, source: market, store: createMemoryStore(), now: () => clock, log: quiet });

  await engine.tick();
  let s = engine.snapshot();
  assert.equal(s.positions.length, 1);
  assert.equal(s.positions[0].costUsd, 100);
  assert.equal(s.balanceUsd, 900);

  market.set('TOKEN1', { priceUsd: 0.002 }); // +100%
  clock += 60000;
  await engine.tick();
  s = engine.snapshot();
  assert.equal(s.positions.length, 0);
  assert.equal(s.trades[0].reason, 'take-profit');
  // 100 USD buys at 0.00101, sells at 0.00198
  const expected = (100 / 0.00101) * 0.00198 - 100;
  assert.ok(Math.abs(s.trades[0].pnlUsd - expected) < 1e-9);
  // Cooldown stops an instant re-buy of the same token.
  assert.equal(s.positions.length, 0);
});

test('engine: stop loss, trailing stop and liquidity pull', async () => {
  let clock = 0;
  const cfg = testConfig({ costPerSidePct: 0 });
  const market = fakeMarket([
    goodToken({ address: 'SL' }),
    goodToken({ address: 'TR' }),
    goodToken({ address: 'LQ' }),
  ]);
  const engine = createEngine({ cfg, source: market, store: createMemoryStore(), now: () => clock, log: quiet });
  await engine.tick();
  assert.equal(engine.snapshot().positions.length, 3);

  engine.pause();
  market.set('SL', { priceUsd: 0.0007 }); // -30%
  market.set('TR', { priceUsd: 0.0013 }); // +30%, arms trailing
  market.set('LQ', { liquidityUsd: 20000 }); // liquidity pulled
  clock += 60000;
  await engine.tick();
  market.set('TR', { priceUsd: 0.00105 }); // 19% under the peak
  clock += 60000;
  await engine.tick();

  const reasons = Object.fromEntries(engine.snapshot().trades.map((t) => [t.address, t.reason]));
  assert.deepEqual(reasons, { SL: 'stop-loss', LQ: 'liquidity-pulled', TR: 'trailing-stop' });
});

test('engine: a token that disappears is booked as a total loss', async () => {
  let clock = 0;
  const cfg = testConfig({ maxMissedQuotes: 2 });
  const market = fakeMarket([goodToken()]);
  const engine = createEngine({ cfg, source: market, store: createMemoryStore(), now: () => clock, log: quiet });
  await engine.tick();
  engine.pause();
  market.remove('TOKEN1');
  await engine.tick();
  await engine.tick();
  const [trade] = engine.snapshot().trades;
  assert.equal(trade.reason, 'no-quote');
  assert.equal(trade.pnlPct, -100);
});

test('engine: safety check blocks a risky token', async () => {
  const cfg = testConfig();
  const safety = { check: async () => ({ ok: false, reasons: ['rugcheck: Freeze Authority still enabled'] }) };
  const engine = createEngine({ cfg, source: fakeMarket([goodToken()]), safety, store: createMemoryStore(), log: quiet });
  await engine.tick();
  const s = engine.snapshot();
  assert.equal(s.positions.length, 0);
  assert.match(s.lastScan.top[0].rejects.join(), /Freeze Authority/);
});

test('engine: state survives a restart', async () => {
  const cfg = testConfig();
  const store = createMemoryStore();
  const a = createEngine({ cfg, source: fakeMarket([goodToken()]), store, log: quiet });
  await a.tick();
  const b = createEngine({ cfg, source: fakeMarket([goodToken()]), store, log: quiet });
  assert.equal(b.snapshot().positions.length, 1);
});

test('rugcheck: danger risks block, clean tokens pass, errors fail safe', async () => {
  const reply = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 500, json: async () => body });
  const danger = createRugCheck({ maxRiskScore: 50, fetchImpl: reply({ score_normalised: 10, risks: [{ name: 'Mint Authority still enabled', level: 'danger' }] }) });
  assert.equal((await danger.check('A')).ok, false);
  const clean = createRugCheck({ maxRiskScore: 50, fetchImpl: reply({ score_normalised: 5, risks: [{ name: 'Low holders', level: 'warn' }] }) });
  assert.equal((await clean.check('A')).ok, true);
  const high = createRugCheck({ maxRiskScore: 50, fetchImpl: reply({ score_normalised: 80, risks: [] }) });
  assert.equal((await high.check('A')).ok, false);
  const broken = createRugCheck({ maxRiskScore: 50, fetchImpl: reply({}, false) });
  assert.equal((await broken.check('A')).ok, false);
});

test('mock market: a long run keeps the books balanced', async () => {
  const cfg = testConfig({ minScore: 30, minAgeMin: 0, minTxnsH1: 0, minVolumeH1Usd: 0, minLiquidityUsd: 10000 });
  const engine = createEngine({ cfg, source: createMockSource({ seed: 7 }), store: createMemoryStore(), log: quiet });
  for (let i = 0; i < 300; i += 1) await engine.tick();
  const s = engine.snapshot();
  assert.ok(s.stats.trades > 0, 'expected some trades');
  const openCost = s.positions.reduce((a, p) => a + p.costUsd, 0);
  const closedPnl = s.trades.length === s.stats.trades ? s.stats.totalPnlUsd : null;
  assert.ok(s.balanceUsd >= 0);
  if (closedPnl !== null) assert.ok(Math.abs(s.balanceUsd + openCost - (1000 + closedPnl)) < 1e-6);
});

const { createJupiterFills } = require('../src/fills');
const { readiness } = require('../src/readiness');

test('jupiter fills: works out decimals and real fill prices', async () => {
  const calls = [];
  // Token price $0.001, 6 decimals, 3% lost to impact and fees each way.
  const fetchImpl = async (url) => {
    const q = new URL(url).searchParams;
    calls.push(Object.fromEntries(q));
    const amount = Number(q.get('amount'));
    const out = q.get('outputMint') === 'TOKEN1'
      ? Math.floor((amount / 1e6 / 0.001) * 1e6 * 0.97)
      : Math.floor((amount / 1e6) * 0.001 * 1e6 * 0.97);
    return { ok: true, json: async () => ({ outAmount: String(out) }) };
  };
  const fills = createJupiterFills({ baseUrl: 'https://example.test', fetchImpl });
  const buy = await fills.buy('TOKEN1', 100, 0.001);
  assert.equal(buy.decimals, 6);
  assert.ok(Math.abs(buy.tokens - 97000) < 1);
  assert.equal(calls[0].amount, '100000000'); // $100 in USDC base units
  const sell = await fills.sell('TOKEN1', buy.rawAmount);
  assert.ok(Math.abs(sell.usd - 97 * 0.97) < 0.01);
});

test('jupiter fills: no route is an error, not a free trade', async () => {
  const fills = createJupiterFills({ baseUrl: 'https://x.test', fetchImpl: async () => ({ ok: true, json: async () => ({ outAmount: '0' }) }) });
  await assert.rejects(fills.buy('T', 50, 0.01), /no route/);
});

function fakeFills({ lossPct = 3, fail = false } = {}) {
  const k = 1 - lossPct / 100;
  let market = null;
  return {
    name: 'jupiter',
    setMarket(m) { market = m; },
    async buy(mint, usd, ref) {
      if (fail) throw new Error('down');
      const tokens = (usd / ref) * k;
      return { tokens, rawAmount: String(Math.round(tokens * 1e6)), decimals: 6, priceUsd: usd / tokens };
    },
    async sell(mint, raw) {
      if (fail) throw new Error('down');
      const price = (await market.quotes([mint])).get(mint).priceUsd;
      return { usd: (Number(raw) / 1e6) * price * k };
    },
  };
}

test('engine: demo trades use real swap quotes on both sides', async () => {
  let clock = 0;
  const cfg = testConfig({ extraCostPerSidePct: 0, positionSizePct: 10 });
  const market = fakeMarket([goodToken()]);
  const fills = fakeFills({ lossPct: 3 });
  fills.setMarket(market);
  const engine = createEngine({ cfg, source: market, fills, store: createMemoryStore(), now: () => clock, log: quiet });
  await engine.tick();
  const [pos] = engine.snapshot().positions;
  assert.equal(pos.fill, 'jupiter');
  assert.ok(Math.abs(pos.entrySlippagePct - (1 / 0.97 - 1) * 100) < 1e-9);
  // Exit rules use the market price, so a 3% swap cost does not trip anything.
  engine.pause();
  market.set('TOKEN1', { priceUsd: 0.0017 }); // +70% market
  clock += 60000;
  await engine.tick();
  const [trade] = engine.snapshot().trades;
  assert.equal(trade.reason, 'take-profit');
  assert.equal(trade.exitFill, 'jupiter');
  const expected = 100 * 0.97 * 1.7 * 0.97 - 100;
  assert.ok(Math.abs(trade.pnlUsd - expected) < 1e-6);
});

test('engine: skips buys that a real swap would make too expensive', async () => {
  const cfg = testConfig({ maxEntrySlippagePct: 8 });
  const market = fakeMarket([goodToken()]);
  const engine = createEngine({ cfg, source: market, fills: fakeFills({ lossPct: 20 }), store: createMemoryStore(), log: quiet });
  await engine.tick();
  const s = engine.snapshot();
  assert.equal(s.positions.length, 0);
  assert.match(s.lastScan.top[0].rejects.join(), /price impact/);
});

test('engine: no Jupiter quote means no buy by default', async () => {
  const cfg = testConfig();
  const engine = createEngine({ cfg, source: fakeMarket([goodToken()]), fills: fakeFills({ fail: true }), store: createMemoryStore(), log: quiet });
  await engine.tick();
  const s = engine.snapshot();
  assert.equal(s.positions.length, 0);
  assert.match(s.lastScan.top[0].rejects.join(), /no Jupiter quote/);
});

test('readiness: nothing passes on day one, all pass for a proven record', () => {
  const day0 = readiness({ stats: computeStats([], [], 1000), trades: [], startedAt: 0, now: 0 });
  assert.equal(day0.ready, false);
  const trades = Array.from({ length: 60 }, (_, i) => ({
    pnlUsd: i % 4 === 0 ? -5 : 10,
    pnlPct: i % 4 === 0 ? -10 : 20,
    entryFill: 'jupiter',
    exitFill: 'jupiter',
  }));
  const equity = [{ v: 1000 }, { v: 1300 }];
  const r = readiness({ stats: computeStats(trades, equity, 1000), trades, startedAt: 0, now: 15 * 86400000 });
  assert.equal(r.ready, true, JSON.stringify(r.checks.filter((c) => !c.ok)));
});

const { createGrokAdvisor, parseVerdict, replyText } = require('../src/grok');

test('grok: reads the reply and validates the verdict', () => {
  const body = { output: [{ type: 'x_search_call' }, { type: 'message', content: [{ type: 'output_text', text: 'Here:\n{"decision":"SKIP","confidence":85,"sentiment":"bearish","summary":"Bot replies only","red_flags":["paid shills"]}' }] }] };
  const v = parseVerdict(replyText(body));
  assert.deepEqual(v, { decision: 'skip', confidence: 85, sentiment: 'bearish', summary: 'Bot replies only', redFlags: ['paid shills'] });
  assert.throws(() => parseVerdict('no json here'), /no JSON/);
  assert.throws(() => parseVerdict('{"decision":"maybe"}'), /not buy or skip/);
});

test('grok: sends x_search to the Responses API and caches per token', async () => {
  const sent = [];
  const fetchImpl = async (url, opts) => {
    sent.push({ url, body: JSON.parse(opts.body), auth: opts.headers.authorization });
    return { ok: true, json: async () => ({ output_text: '{"decision":"buy","confidence":70,"sentiment":"bullish","summary":"Organic","red_flags":[]}' }) };
  };
  const g = createGrokAdvisor({ apiKey: 'k', model: 'grok-test', fetchImpl });
  assert.equal(g.isCached('TOKEN1'), false);
  const v = await g.check(goodToken());
  await g.check(goodToken());
  assert.equal(v.decision, 'buy');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.x.ai/v1/responses');
  assert.equal(sent[0].auth, 'Bearer k');
  assert.deepEqual(sent[0].body.tools, [{ type: 'x_search' }]);
  assert.match(sent[0].body.input[1].content, /TOKEN1/);
  assert.equal(g.isCached('TOKEN1'), true);
});

function fakeGrok(verdict, { fail = false } = {}) {
  const calls = [];
  return {
    calls,
    isCached: () => false,
    async check(snap) {
      calls.push(snap.address);
      if (fail) throw new Error('xai down');
      return verdict;
    },
  };
}

test('engine: Grok veto blocks a buy and the blocked coin is followed', async () => {
  let clock = 0;
  const cfg = testConfig({ grokMode: 'veto' });
  const market = fakeMarket([goodToken()]);
  const grok = fakeGrok({ decision: 'skip', confidence: 80, sentiment: 'bearish', summary: 'Shilled by bots', redFlags: [] });
  const engine = createEngine({ cfg, source: market, grok, store: createMemoryStore(), now: () => clock, log: quiet });
  await engine.tick();
  let s = engine.snapshot();
  assert.equal(s.positions.length, 0);
  assert.match(s.lastScan.top[0].rejects.join(), /Grok: skip/);
  assert.equal(s.grok.vetoes, 1);
  market.set('TOKEN1', { priceUsd: 0.0005 }); // dumped 50% after the block
  clock += 31 * 60000;
  await engine.tick();
  s = engine.snapshot();
  assert.equal(s.grok.vetoesWouldHitStop, 1);
  assert.equal(s.grok.vetoesWouldHitTarget, 0);
  assert.equal(s.grok.vetoes, 1, 'same coin is not recorded twice');
});

test('engine: low-confidence buy from Grok is also blocked in veto mode', async () => {
  const cfg = testConfig({ grokMode: 'veto', grokMinConfidence: 60 });
  const grok = fakeGrok({ decision: 'buy', confidence: 40, sentiment: 'neutral', summary: 'Unclear', redFlags: [] });
  const engine = createEngine({ cfg, source: fakeMarket([goodToken()]), grok, store: createMemoryStore(), log: quiet });
  await engine.tick();
  assert.equal(engine.snapshot().positions.length, 0);
});

test('engine: Grok approval is recorded on the trade', async () => {
  const cfg = testConfig({ grokMode: 'veto' });
  const verdict = { decision: 'buy', confidence: 75, sentiment: 'bullish', summary: 'Real community', redFlags: [] };
  const engine = createEngine({ cfg, source: fakeMarket([goodToken()]), grok: fakeGrok(verdict), store: createMemoryStore(), log: quiet });
  await engine.tick();
  assert.equal(engine.snapshot().positions[0].grok.summary, 'Real community');
});

test('engine: Grok down = no buy in veto mode, buy anyway in advise mode', async () => {
  const veto = createEngine({ cfg: testConfig({ grokMode: 'veto' }), source: fakeMarket([goodToken()]), grok: fakeGrok(null, { fail: true }), store: createMemoryStore(), log: quiet });
  await veto.tick();
  assert.equal(veto.snapshot().positions.length, 0);
  const advise = createEngine({ cfg: testConfig({ grokMode: 'advise' }), source: fakeMarket([goodToken()]), grok: fakeGrok(null, { fail: true }), store: createMemoryStore(), log: quiet });
  await advise.tick();
  assert.equal(advise.snapshot().positions.length, 1);
});

test('engine: Grok calls per scan are capped', async () => {
  const cfg = testConfig({ grokMode: 'veto', grokMaxChecksPerScan: 2 });
  const tokens = ['A', 'B', 'C', 'D'].map((a) => goodToken({ address: a }));
  const grok = fakeGrok({ decision: 'skip', confidence: 90, sentiment: 'bearish', summary: 'no', redFlags: [] });
  const engine = createEngine({ cfg, source: fakeMarket(tokens), grok, store: createMemoryStore(), log: quiet });
  await engine.tick();
  assert.equal(grok.calls.length, 2);
  assert.ok(engine.snapshot().lastScan.top.some((c) => /waiting for a Grok check/.test(c.rejects.join())));
});
