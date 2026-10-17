// The paper-trading loop: check open positions for exits, then scan for
// new entries. No real orders are ever sent.

const { evaluate } = require('./scoring');
const { computeStats } = require('./stats');

const MAX_TRADES = 5000;
const MAX_EQUITY_POINTS = 2000;
const MAX_ERRORS = 20;

function freshState(cfg, now) {
  return {
    version: 1,
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
    ticks: 0,
  };
}

function createEngine({ cfg, source, store, safety = null, now = () => Date.now(), log = console }) {
  let state = store.load() || freshState(cfg, now());
  let busy = false;

  const cost = cfg.costPerSidePct / 100;

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

  function closePosition(pos, priceUsd, reason) {
    const exitPrice = priceUsd * (1 - cost);
    const proceeds = pos.qty * exitPrice;
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
      costUsd: pos.costUsd,
      proceedsUsd: proceeds,
      pnlUsd,
      pnlPct: (pnlUsd / pos.costUsd) * 100,
      peakPct: (pos.peakPriceUsd / pos.entryPriceUsd - 1) * 100,
      reason,
      score: pos.score,
    });
    if (state.trades.length > MAX_TRADES) state.trades.splice(0, state.trades.length - MAX_TRADES);
    state.cooldowns[pos.address] = now() + cfg.cooldownMin * 60000;
    state.positions = state.positions.filter((p) => p !== pos);
    log.log(`SELL ${pos.symbol} ${reason} pnl ${pnlUsd.toFixed(2)} USD`);
  }

  function exitReason(pos, q) {
    const changePct = (q.priceUsd / pos.entryPriceUsd - 1) * 100;
    const peakGainPct = (pos.peakPriceUsd / pos.entryPriceUsd - 1) * 100;
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
        if (pos.missedQuotes >= cfg.maxMissedQuotes) closePosition(pos, 0, 'no-quote');
        continue;
      }
      pos.missedQuotes = 0;
      pos.lastPriceUsd = q.priceUsd;
      pos.lastLiquidityUsd = q.liquidityUsd;
      pos.peakPriceUsd = Math.max(pos.peakPriceUsd, q.priceUsd);
      const reason = exitReason(pos, q);
      if (reason) closePosition(pos, q.priceUsd, reason);
    }
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
      const entryPrice = snap.priceUsd * (1 + cost);
      state.balanceUsd -= size;
      state.positions.push({
        address: snap.address,
        symbol: snap.symbol,
        name: snap.name,
        url: snap.url,
        openedAt: t,
        costUsd: size,
        qty: size / entryPrice,
        entryPriceUsd: entryPrice,
        lastPriceUsd: snap.priceUsd,
        peakPriceUsd: snap.priceUsd,
        entryLiquidityUsd: snap.liquidityUsd,
        lastLiquidityUsd: snap.liquidityUsd,
        score: result.score,
        missedQuotes: 0,
      });
      held.add(snap.address);
      bought.push(snap.address);
      log.log(`BUY ${snap.symbol} score ${result.score} size ${size.toFixed(2)} USD`);
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
        bought: bought.includes(snap.address),
      })),
    };
  }

  function recordEquity() {
    state.equity.push({ t: now(), v: equity() });
    if (state.equity.length > MAX_EQUITY_POINTS) {
      // Keep the shape of the whole history by thinning older points.
      state.equity = state.equity.filter((_, i) => i % 2 === 0 || i === state.equity.length - 1);
    }
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      try {
        await updatePositions();
      } catch (err) {
        recordError('update positions', err);
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
    } finally {
      busy = false;
    }
  }

  function snapshot() {
    return {
      mode: 'paper',
      source: source.name,
      chain: cfg.chain,
      safetyCheck: safety ? 'rugcheck' : 'off',
      startedAt: state.startedAt,
      lastTickAt: state.lastTickAt || null,
      ticks: state.ticks,
      paused: state.paused,
      balanceUsd: state.balanceUsd,
      equityUsd: equity(),
      startBalanceUsd: state.startBalanceUsd,
      stats: computeStats(state.trades, state.equity, state.startBalanceUsd),
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
        minScore: cfg.minScore,
        minLiquidityUsd: cfg.minLiquidityUsd,
      },
    };
  }

  return {
    tick,
    snapshot,
    pause() {
      state.paused = true;
      store.save(state);
    },
    resume() {
      state.paused = false;
      store.save(state);
    },
    reset() {
      state = freshState(cfg, now());
      store.save(state);
    },
    async closeAll() {
      if (state.positions.length === 0) return;
      const quotes = await source.quotes(state.positions.map((p) => p.address));
      for (const pos of [...state.positions]) {
        const q = quotes.get(pos.address);
        closePosition(pos, q?.priceUsd > 0 ? q.priceUsd : pos.lastPriceUsd, 'manual');
      }
      store.save(state);
    },
    save: () => store.save(state),
  };
}

module.exports = { createEngine };
