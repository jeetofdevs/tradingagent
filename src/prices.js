// NEAR token prices in USD.
// Primary: Ref Finance's public price list (one request covers every listed
// token). Fallback for tokens it does not list: DexScreener.

const REF_URL = 'https://indexer.ref.finance/list-token-price';
const DEX_URL = 'https://api.dexscreener.com/tokens/v1/near';
const CACHE_MS = 60000;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Deepest NEAR pool per token, where the token is the base asset.
function bestPairs(pairs) {
  const best = new Map();
  for (const pair of pairs || []) {
    const address = pair.baseToken?.address;
    if (pair.chainId !== 'near' || !address) continue;
    const snap = { priceUsd: num(pair.priceUsd), symbol: pair.baseToken.symbol || '', name: pair.baseToken.name || '', liquidityUsd: num(pair.liquidity?.usd) };
    const current = best.get(address);
    if (!current || snap.liquidityUsd > current.liquidityUsd) best.set(address, snap);
  }
  return best;
}

function createPriceSource({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  let ref = { t: 0, data: null };

  async function refList() {
    if (ref.data && now() - ref.t < CACHE_MS) return ref.data;
    const res = await fetchImpl(REF_URL, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Ref price list HTTP ${res.status}`);
    ref = { t: now(), data: await res.json() };
    return ref.data;
  }

  // contract -> { priceUsd, symbol, decimals? }
  return async function quotes(contracts) {
    const result = new Map();
    const unique = [...new Set(contracts)];
    let list = {};
    try {
      list = await refList();
    } catch {
      list = {};
    }
    const missing = [];
    for (const c of unique) {
      const p = list[c];
      if (p && num(p.price) > 0) result.set(c, { priceUsd: num(p.price), symbol: p.symbol || '', decimals: p.decimal ?? null });
      else missing.push(c);
    }
    for (let i = 0; i < missing.length; i += 30) {
      const batch = missing.slice(i, i + 30);
      try {
        const res = await fetchImpl(`${DEX_URL}/${batch.map(encodeURIComponent).join(',')}`, { signal: AbortSignal.timeout(15000) });
        if (res.ok) for (const [c, snap] of bestPairs(await res.json())) result.set(c, snap);
      } catch {
        // leave unpriced
      }
    }
    if (unique.length && result.size === 0 && !Object.keys(list).length) throw new Error('Price services unavailable');
    return result;
  };
}

module.exports = { createPriceSource, bestPairs };
