// The demo-trading loop: check open positions for exits, then scan for new
// entries. Prices and strategy are real; the money is a demo fund. No order
// is ever signed or sent.
//
// Fills: with Jupiter quotes on, each demo buy and sell is priced at what a
// real swap of that size would get right now. Without them (or if a quote
// fails) a flat COST_PER_SIDE_PCT is charged instead.

const { evaluate } = require('./scoring');
const { computeStats } = require('./stats');
const { readiness } = require('./readiness');

const MAX_TRADES = 5000;
const MAX_EQUITY_POINTS = 2000;
const MAX_ERRORS = 20;

function freshState(cfg, now) {
  return {
    version: 2,
    startedAt: now,
    startBalanceUsd: cfg.startBalanceUsd,
    balanceUsd: cfg.startBalanceUsd,
    paused: false,
    positions: [],
    trades: [],
    equity: [{ t: now, v: cfg.startBalanceUsd }],
    cooldowns: {},
    lastScan: null,
    errors: [],
    vetoes: [],
    ticks: 0,
  };
}

function createEngine({ cfg, source, store, safety = null, fills = null, grok = null, now = () => Date.now(), log = console }) {
  let state = store.load() || freshState(cfg, now());
  state.vetoes = state.vetoes || [];

  // One thing at a time: the loop and dashboard buttons share this lock.
  let lock = Promise.resolve();
  const exclusive = (fn) => {
    const run = lock.then(fn, fn);
    lock = run.catch(() => {});
    return run;
  };

  const cost = cfg.costPerSidePct / 100;
  const extra = cfg.extraCostPerSidePct / 100;

  // Market value if sold now. Uses the flat cost as a rough exit estimate.
  function positionValue(pos) {
    return pos.qty * pos.lastPriceUsd * (1 - cost);
  }

  function equity() {
    return state.balanceUsd + state.positions.reduce((acc, p) => acc + positionValue(p), 0);
  }

  function recordError(where, err) {
    const message = `${where}: ${err.message || err}`;
    log.error(message);
    state.errors.unshift({ t: now(), message });
    state.errors.length = Math.min(state.errors.length, MAX_ERRORS);
  }

  // Market price at entry, without fills. Exit rules are measured from this.
  const entryMarket = (pos) => pos.entryMarketPriceUsd ?? pos.entryPriceUsd;

  async function sellProceeds(pos, marketPriceUsd) {
    if (!(marketPriceUsd > 0)) return { usd: 0, fill: 'none' };
    if (fills && pos.rawAmount) {
      try {
        const { usd } = await fills.sell(pos.address, pos.rawAmount);
        return { usd: usd * (1 - extra), fill: 'jupiter' };
      } catch (err) {
        recordError(`sell quote ${pos.symbol}`, err);
        return { usd: pos.qty * marketPriceUsd * (1 - cost), fill: 'fixed-fallback' };
      }
    }
    return { usd: pos.qty * marketPriceUsd * (1 - cost), fill: 'fixed' };
  }

  async function closePosition(pos, marketPriceUsd, reason) {
    const { usd: proceeds, fill } = await sellProceeds(pos, marketPriceUsd);
    const exitPrice = pos.qty > 0 ? proceeds / pos.qty : 0;
    state.balanceUsd += proceeds;
    const pnlUsd = proceeds - pos.costUsd;
    state.trades.push({
      address: pos.address,
      symbol: pos.symbol,
      url: pos.url,
      openedAt: pos.openedAt,
      closedAt: now(),
      entryPriceUsd: pos.entryPriceUsd,
      exitPriceUsd: exitPrice,
      entryMarketPriceUsd: entryMarket(pos),
      exitMarketPriceUsd: marketPriceUsd,
      entryFill: pos.fill || 'fixed',
      exitFill: fill,
      entrySlippagePct: pos.entrySlippagePct ?? cfg.costPerSidePct,
      exitSlippagePct: marketPriceUsd > 0 ? (1 - exitPrice / marketPriceUsd) * 100 : 100,
      costUsd: pos.costUsd,
      proceedsUsd: proceeds,
      pnlUsd,
      pnlPct: (pnlUsd / pos.costUsd) * 100,
      peakPct: (pos.peakPriceUsd / entryMarket(pos) - 1) * 100,
      reason,
      score: pos.score,
      grok: pos.grok || null,
    });
    if (state.trades.length > MAX_TRADES) state.trades.splice(0, state.trades.length - MAX_TRADES);
    state.cooldowns[pos.address] = now() + cfg.cooldownMin * 60000;
    state.positions = state.positions.filter((p) => p !== pos);
    log.log(`SELL ${pos.symbol} ${reason} pnl ${pnlUsd.toFixed(2)} USD (${fill})`);
  }

  function exitReason(pos, q) {
    const base = entryMarket(pos);
    const changePct = (q.priceUsd / base - 1) * 100;
    const peakGainPct = (pos.peakPriceUsd / base - 1) * 100;
    if (changePct <= -cfg.stopLossPct) return 'stop-loss';
    if (changePct >= cfg.takeProfitPct) return 'take-profit';
    if (peakGainPct >= cfg.trailingArmPct && q.priceUsd <= pos.peakPriceUsd * (1 - cfg.trailingStopPct / 100)) {
      return 'trailing-stop';
    }
    if (pos.entryLiquidityUsd > 0 && q.liquidityUsd < pos.entryLiquidityUsd * (1 - cfg.liquidityPullPct / 100)) {
      return 'liquidity-pulled';
    }
    if (now() - pos.openedAt >= cfg.maxHoldMin * 60000) return 'time-exit';
    return null;
  }

  async function updatePositions() {
    if (state.positions.length === 0) return;
    const quotes = await source.quotes(state.positions.map((p) => p.address));
    for (const pos of [...state.positions]) {
      const q = quotes.get(pos.address);
      if (!q || !(q.priceUsd > 0)) {
        pos.missedQuotes = (pos.missedQuotes || 0) + 1;
        // A token that vanished is usually a rug. Count it as a total loss
        // rather than pretending we sold at the last price.
        if (pos.missedQuotes >= cfg.maxMissedQuotes) await closePosition(pos, 0, 'no-quote');
        continue;
      }
      pos.missedQuotes = 0;
      pos.lastPriceUsd = q.priceUsd;
      pos.lastLiquidityUsd = q.liquidityUsd;
      pos.peakPriceUsd = Math.max(pos.peakPriceUsd, q.priceUsd);
      const reason = exitReason(pos, q);
      if (reason) await closePosition(pos, q.priceUsd, reason);
    }
  }

  // Price a demo buy. Returns null (with a reason) when it should be skipped.
  async function priceBuy(snap, size) {
    if (fills) {
      try {
        const f = await fills.buy(snap.address, size, snap.priceUsd);
        const tokens = f.tokens * (1 - extra);
        const slippagePct = (size / tokens / snap.priceUsd - 1) * 100;
        if (slippagePct > cfg.maxEntrySlippagePct) {
          return { skip: `real swap would lose ${slippagePct.toFixed(1)}% to price impact and fees` };
        }
        return { tokens, rawAmount: f.rawAmount, decimals: f.decimals, slippagePct, fill: 'jupiter' };
      } catch (err) {
        recordError(`buy quote ${snap.symbol}`, err);
        if (cfg.requireRealFills) return { skip: `no Jupiter quote (${err.message})` };
      }
    }
    const tokens = size / (snap.priceUsd * (1 + cost));
    return { tokens, rawAmount: null, slippagePct: cfg.costPerSidePct, fill: fills ? 'fixed-fallback' : 'fixed' };
  }

  async function scanAndEnter() {
    const candidates = await source.candidates();
    const held = new Set(state.positions.map((p) => p.address));
    const t = now();
    for (const [addr, until] of Object.entries(state.cooldowns)) if (until <= t) delete state.cooldowns[addr];

    const evaluated = candidates
      .map((snap) => ({ snap, result: evaluate(snap, cfg) }))
      .sort((a, b) => b.result.score - a.result.score);

    const bought = [];
    let grokCalls = 0;
    for (const { snap, result } of evaluated) {
      if (state.positions.length >= cfg.maxOpenPositions) break;
      if (!result.pass || held.has(snap.address) || state.cooldowns[snap.address]) continue;
      if (safety) {
        const verdict = await safety.check(snap.address);
        if (!verdict.ok) {
          result.pass = false;
          result.rejects.push(...verdict.reasons);
          continue;
        }
      }
      const size = Math.min(state.balanceUsd, (equity() * cfg.positionSizePct) / 100);
      if (size < cfg.minTradeUsd) break;

      const priced = await priceBuy(snap, size);
      if (priced.skip) {
        result.pass = false;
        result.rejects.push(priced.skip);
        continue;
      }

      let grokVerdict = null;
      if (grok) {
        if (!grok.isCached(snap.address) && grokCalls >= cfg.grokMaxChecksPerScan) {
          result.rejects.push('waiting for a Grok check (next scan)');
          result.pass = false;
          continue;
        }
        if (!grok.isCached(snap.address)) grokCalls += 1;
        try {
          grokVerdict = await grok.check(snap);
        } catch (err) {
          recordError(`grok ${snap.symbol}`, err);
          if (cfg.grokMode === 'veto') {
            result.pass = false;
            result.rejects.push(`Grok check failed (${err.message.slice(0, 80)})`);
            continue;
          }
        }
        result.grok = grokVerdict;
        const approved = grokVerdict && grokVerdict.decision === 'buy' && grokVerdict.confidence >= cfg.grokMinConfidence;
        if (cfg.grokMode === 'veto' && !approved) {
          result.pass = false;
          result.rejects.push(`Grok: skip (${grokVerdict.confidence}%) ${grokVerdict.summary}`);
          recordVeto(snap, grokVerdict);
          continue;
        }
      }

      state.balanceUsd -= size;
      state.positions.push({
        address: snap.address,
        symbol: snap.symbol,
        name: snap.name,
        url: snap.url,
        openedAt: t,
        costUsd: size,
        qty: priced.tokens,
        rawAmount: priced.rawAmount,
        decimals: priced.decimals ?? null,
        fill: priced.fill,
        entrySlippagePct: priced.slippagePct,
        entryPriceUsd: size / priced.tokens,
        entryMarketPriceUsd: snap.priceUsd,
        lastPriceUsd: snap.priceUsd,
        peakPriceUsd: snap.priceUsd,
        entryLiquidityUsd: snap.liquidityUsd,
        lastLiquidityUsd: snap.liquidityUsd,
        score: result.score,
        grok: grokVerdict,
        missedQuotes: 0,
      });
      held.add(snap.address);
      bought.push(snap.address);
      log.log(`BUY ${snap.symbol} score ${result.score} size ${size.toFixed(2)} USD (${priced.fill})`);
    }

    state.lastScan = {
      t,
      total: evaluated.length,
      passed: evaluated.filter((e) => e.result.pass).length,
      bought: bought.length,
      top: evaluated.slice(0, 25).map(({ snap, result }) => ({
        address: snap.address,
        symbol: snap.symbol,
        url: snap.url,
        priceUsd: snap.priceUsd,
        liquidityUsd: snap.liquidityUsd,
        volH1: snap.volH1,
        chgM5: snap.chgM5,
        chgH1: snap.chgH1,
        ageMin: snap.ageMin,
        score: result.score,
        parts: result.parts,
        pass: result.pass,
        rejects: result.rejects,
        grok: result.grok || null,
        bought: bought.includes(snap.address),
      })),
    };
  }

  // Follow coins Grok blocked, to see whether skipping them helped.
  const VETO_WATCH_MS = 3 * 60 * 60000;
  function recordVeto(snap, verdict) {
    if (state.vetoes.some((v) => v.address === snap.address && now() - v.t < VETO_WATCH_MS)) return;
    state.vetoes.unshift({
      address: snap.address,
      symbol: snap.symbol,
      url: snap.url,
      t: now(),
      priceUsd: snap.priceUsd,
      lastPriceUsd: snap.priceUsd,
      maxPriceUsd: snap.priceUsd,
      minPriceUsd: snap.priceUsd,
      confidence: verdict.confidence,
      sentiment: verdict.sentiment,
      summary: verdict.summary,
      redFlags: verdict.redFlags,
    });
    state.vetoes.length = Math.min(state.vetoes.length, 50);
  }

  async function trackVetoes() {
    const watching = state.vetoes.filter((v) => now() - v.t < VETO_WATCH_MS);
    if (watching.length === 0) return;
    const quotes = await source.quotes(watching.map((v) => v.address));
    for (const v of watching) {
      const q = quotes.get(v.address);
      const price = q && q.priceUsd > 0 ? q.priceUsd : 0;
      v.lastPriceUsd = price;
      v.maxPriceUsd = Math.max(v.maxPriceUsd, price);
      v.minPriceUsd = Math.min(v.minPriceUsd, price);
    }
  }

  function grokSummary() {
    const judged = state.trades.filter((t) => t.grok);
    const wins = judged.filter((t) => t.pnlUsd > 0).length;
    const done = state.vetoes.filter((v) => now() - v.t >= 30 * 60000);
    const change = (v) => (v.lastPriceUsd / v.priceUsd - 1) * 100;
    return {
      mode: grok ? cfg.grokMode : 'off',
      model: grok ? cfg.grokModel : null,
      tradesJudged: judged.length,
      winRatePct: judged.length ? (wins / judged.length) * 100 : 0,
      vetoes: state.vetoes.length,
      // Of blocked coins older than 30 min: would they have hit our stop or target?
      vetoesWouldHitStop: done.filter((v) => (v.minPriceUsd / v.priceUsd - 1) * 100 <= -cfg.stopLossPct).length,
      vetoesWouldHitTarget: done.filter((v) => (v.maxPriceUsd / v.priceUsd - 1) * 100 >= cfg.takeProfitPct).length,
      vetoesScored: done.length,
      avgChangeSinceVetoPct: done.length ? done.reduce((a, v) => a + change(v), 0) / done.length : 0,
      recentVetoes: state.vetoes.slice(0, 15).map((v) => ({ ...v, changePct: change(v) })),
    };
  }

  function recordEquity() {
    state.equity.push({ t: now(), v: equity() });
    if (state.equity.length > MAX_EQUITY_POINTS) {
      // Keep the shape of the whole history by thinning older points.
      state.equity = state.equity.filter((_, i) => i % 2 === 0 || i === state.equity.length - 1);
    }
  }

  async function tickOnce() {
    try {
      await updatePositions();
    } catch (err) {
      recordError('update positions', err);
    }
    try {
      await trackVetoes();
    } catch (err) {
      recordError('track Grok vetoes', err);
    }
    if (!state.paused) {
      try {
        await scanAndEnter();
      } catch (err) {
        recordError('scan', err);
      }
    }
    recordEquity();
    state.ticks += 1;
    state.lastTickAt = now();
    store.save(state);
  }

  function snapshot() {
    const stats = computeStats(state.trades, state.equity, state.startBalanceUsd);
    return {
      mode: 'demo',
      source: source.name,
      chain: cfg.chain,
      safetyCheck: safety ? 'rugcheck' : 'off',
      fills: fills ? fills.name : 'fixed',
      grok: grokSummary(),
      startedAt: state.startedAt,
      lastTickAt: state.lastTickAt || null,
      ticks: state.ticks,
      paused: state.paused,
      balanceUsd: state.balanceUsd,
      equityUsd: equity(),
      startBalanceUsd: state.startBalanceUsd,
      stats,
      readiness: readiness({ stats, trades: state.trades, startedAt: state.startedAt, now: now() }),
      positions: state.positions.map((p) => ({
        ...p,
        valueUsd: positionValue(p),
        pnlPct: (positionValue(p) / p.costUsd - 1) * 100,
      })),
      trades: state.trades.slice(-100).reverse(),
      equity: state.equity,
      lastScan: state.lastScan,
      errors: state.errors,
      settings: {
        scanIntervalSec: cfg.scanIntervalSec,
        positionSizePct: cfg.positionSizePct,
        maxOpenPositions: cfg.maxOpenPositions,
        takeProfitPct: cfg.takeProfitPct,
        stopLossPct: cfg.stopLossPct,
        trailingArmPct: cfg.trailingArmPct,
        trailingStopPct: cfg.trailingStopPct,
        maxHoldMin: cfg.maxHoldMin,
        costPerSidePct: cfg.costPerSidePct,
        extraCostPerSidePct: cfg.extraCostPerSidePct,
        maxEntrySlippagePct: cfg.maxEntrySlippagePct,
        minScore: cfg.minScore,
        minLiquidityUsd: cfg.minLiquidityUsd,
      },
    };
  }

  return {
    tick: () => exclusive(tickOnce),
    snapshot,
    pause: () =>
      exclusive(() => {
        state.paused = true;
        store.save(state);
      }),
    resume: () =>
      exclusive(() => {
        state.paused = false;
        store.save(state);
      }),
    reset: () =>
      exclusive(() => {
        state = freshState(cfg, now());
        store.save(state);
      }),
    closeAll: () =>
      exclusive(async () => {
        if (state.positions.length === 0) return;
        const quotes = await source.quotes(state.positions.map((p) => p.address));
        for (const pos of [...state.positions]) {
          const q = quotes.get(pos.address);
          await closePosition(pos, q?.priceUsd > 0 ? q.priceUsd : pos.lastPriceUsd, 'manual');
        }
        store.save(state);
      }),
    save: () => store.save(state),
  };
}

module.exports = { createEngine };
