// A fake market for local testing when the real API is not reachable.
// Prices follow a random walk; some tokens pump, some rug.

function createMockSource({ seed = 42, tokens = 25 } = {}) {
  let state = seed >>> 0;
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };

  const market = new Map();
  let counter = 0;

  function spawn(now) {
    counter += 1;
    const address = `MOCK${String(counter).padStart(4, '0')}pump`;
    const liquidity = 15000 + rand() * 200000;
    market.set(address, {
      address,
      symbol: `MEME${counter}`,
      name: `Mock Meme ${counter}`,
      pairAddress: `PAIR${counter}`,
      dexId: 'raydium',
      url: '',
      createdAt: now - (10 + rand() * 3000) * 60000,
      priceUsd: 0.00001 + rand() * 0.001,
      liquidityUsd: liquidity,
      drift: (rand() - 0.45) * 0.08,
      rugged: false,
      hist: [],
    });
  }

  function step(now) {
    while (market.size < tokens) spawn(now);
    for (const token of market.values()) {
      if (token.rugged) continue;
      if (rand() < 0.01) {
        token.rugged = true;
        token.priceUsd *= 0.05;
        token.liquidityUsd *= 0.05;
      } else {
        const move = token.drift + (rand() - 0.5) * 0.2;
        token.priceUsd = Math.max(1e-9, token.priceUsd * (1 + move));
        token.liquidityUsd = Math.max(1000, token.liquidityUsd * (1 + move / 3));
        if (rand() < 0.1) token.drift = (rand() - 0.45) * 0.08;
      }
      token.hist.push(token.priceUsd);
      if (token.hist.length > 60) token.hist.shift();
    }
    // Retire dead tokens so new ones appear.
    for (const [addr, token] of market) {
      if (token.rugged && rand() < 0.2) market.delete(addr);
    }
  }

  function snapshot(token, now) {
    const h = token.hist;
    const pct = (back) => (h.length > back ? (token.priceUsd / h[h.length - 1 - back] - 1) * 100 : 0);
    const buys = Math.round(40 + rand() * 300);
    const sells = token.rugged ? 0 : Math.round(buys * (0.5 + rand() * 0.8));
    return {
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      pairAddress: token.pairAddress,
      dexId: token.dexId,
      url: token.url,
      priceUsd: token.priceUsd,
      liquidityUsd: token.liquidityUsd,
      fdv: token.liquidityUsd * (3 + rand() * 30),
      marketCap: token.liquidityUsd * 3,
      ageMin: (now - token.createdAt) / 60000,
      buysM5: Math.round(buys / 12),
      sellsM5: Math.round(sells / 12),
      buysH1: buys,
      sellsH1: sells,
      volM5: token.liquidityUsd * rand() * 0.1,
      volH1: token.liquidityUsd * (0.1 + rand()),
      volH24: token.liquidityUsd * (1 + rand() * 10),
      chgM5: pct(1),
      chgH1: pct(12),
      chgH24: pct(59),
    };
  }

  return {
    name: 'mock',
    async candidates() {
      const now = Date.now();
      step(now);
      return [...market.values()].map((t) => snapshot(t, now));
    },
    async quotes(addresses) {
      const now = Date.now();
      const result = new Map();
      for (const addr of addresses) {
        const token = market.get(addr);
        if (token) result.set(addr, snapshot(token, now));
      }
      return result;
    },
  };
}

module.exports = { createMockSource };
