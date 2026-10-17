// Live market data from the public DexScreener API (no key needed).
// Rate limits: about 60 requests/min for the boost and profile lists,
// about 300 requests/min for pair lookups. One scan uses 3 + ceil(n/30).

const BASE = 'https://api.dexscreener.com';
const BATCH = 30;

async function getJson(url) {
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`DexScreener ${res.status} for ${url}`);
  return res.json();
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Turn a DexScreener pair into the flat snapshot the bot works with.
function toSnapshot(pair, now = Date.now()) {
  const tx = pair.txns || {};
  const vol = pair.volume || {};
  const chg = pair.priceChange || {};
  return {
    address: pair.baseToken?.address,
    symbol: pair.baseToken?.symbol || '?',
    name: pair.baseToken?.name || '',
    pairAddress: pair.pairAddress,
    dexId: pair.dexId,
    url: pair.url,
    priceUsd: toNumber(pair.priceUsd),
    liquidityUsd: toNumber(pair.liquidity?.usd),
    fdv: toNumber(pair.fdv),
    marketCap: toNumber(pair.marketCap),
    ageMin: pair.pairCreatedAt ? (now - pair.pairCreatedAt) / 60000 : 0,
    buysM5: toNumber(tx.m5?.buys),
    sellsM5: toNumber(tx.m5?.sells),
    buysH1: toNumber(tx.h1?.buys),
    sellsH1: toNumber(tx.h1?.sells),
    volM5: toNumber(vol.m5),
    volH1: toNumber(vol.h1),
    volH24: toNumber(vol.h24),
    chgM5: toNumber(chg.m5),
    chgH1: toNumber(chg.h1),
    chgH24: toNumber(chg.h24),
  };
}

// Keep the deepest pool per token, and only pools where the token is the
// base asset (otherwise priceUsd is the price of the other side).
function bestPairs(pairs, chain, now) {
  const best = new Map();
  for (const pair of pairs || []) {
    if (pair.chainId !== chain || !pair.baseToken?.address) continue;
    const snap = toSnapshot(pair, now);
    const current = best.get(snap.address);
    if (!current || snap.liquidityUsd > current.liquidityUsd) best.set(snap.address, snap);
  }
  return best;
}

function createDexScreenerSource({ chain }) {
  async function quotes(addresses) {
    const unique = [...new Set(addresses)];
    const result = new Map();
    for (let i = 0; i < unique.length; i += BATCH) {
      const batch = unique.slice(i, i + BATCH);
      const pairs = await getJson(`${BASE}/tokens/v1/${chain}/${batch.join(',')}`);
      for (const [addr, snap] of bestPairs(pairs, chain, Date.now())) result.set(addr, snap);
    }
    return result;
  }

  async function candidates() {
    const lists = await Promise.allSettled([
      getJson(`${BASE}/token-profiles/latest/v1`),
      getJson(`${BASE}/token-boosts/latest/v1`),
      getJson(`${BASE}/token-boosts/top/v1`),
    ]);
    const addresses = [];
    const failures = [];
    for (const list of lists) {
      if (list.status === 'rejected') {
        failures.push(list.reason.message);
        continue;
      }
      for (const item of Array.isArray(list.value) ? list.value : []) {
        if (item.chainId === chain && item.tokenAddress) addresses.push(item.tokenAddress);
      }
    }
    if (failures.length === lists.length) throw new Error(failures.join('; '));
    return [...(await quotes(addresses)).values()];
  }

  return { name: 'dexscreener', candidates, quotes };
}

module.exports = { createDexScreenerSource, toSnapshot, bestPairs };
