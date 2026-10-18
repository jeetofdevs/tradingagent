// Token prices from the public DexScreener API (no key needed, about
// 300 requests/min). Up to 30 tokens per request.

const BASE = 'https://api.dexscreener.com';
const BATCH = 30;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Keep the deepest pool per token, and only pools where the token is the
// base asset (otherwise priceUsd is the other side's price).
function bestPairs(pairs, chain) {
  const best = new Map();
  for (const pair of pairs || []) {
    const address = pair.baseToken?.address;
    if (pair.chainId !== chain || !address) continue;
    const snap = {
      address,
      symbol: pair.baseToken.symbol || '',
      name: pair.baseToken.name || '',
      priceUsd: num(pair.priceUsd),
      liquidityUsd: num(pair.liquidity?.usd),
      url: pair.url || null,
    };
    const current = best.get(address);
    if (!current || snap.liquidityUsd > current.liquidityUsd) best.set(address, snap);
  }
  return best;
}

function createPriceSource({ chain = 'solana', fetchImpl = fetch } = {}) {
  return async function quotes(addresses) {
    const unique = [...new Set(addresses)];
    const result = new Map();
    for (let i = 0; i < unique.length; i += BATCH) {
      const batch = unique.slice(i, i + BATCH);
      const res = await fetchImpl(`${BASE}/tokens/v1/${chain}/${batch.join(',')}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
      for (const [addr, snap] of bestPairs(await res.json(), chain)) result.set(addr, snap);
    }
    return result;
  };
}

module.exports = { createPriceSource, bestPairs };
