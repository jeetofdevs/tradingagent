// Realistic demo fills. Instead of a flat cost, ask Jupiter (Solana's main
// swap router) what a real swap of this size would return right now. That
// includes pool fees and price impact on thin memecoin pools. Nothing is
// signed or sent: a quote is read-only.
//
// Buy:  quote USDC -> token for the trade size; tokens received = fill.
// Sell: quote token -> USDC for the exact raw amount held; USDC out = fill.

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS = 6;

function createJupiterFills({ baseUrl, slippageBps = 2000, fetchImpl = fetch }) {
  async function quote(inputMint, outputMint, rawAmount) {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: String(rawAmount),
      slippageBps: String(slippageBps),
      restrictIntermediateTokens: 'true',
    });
    const res = await fetchImpl(`${baseUrl}/quote?${params}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Jupiter quote HTTP ${res.status}`);
    const body = await res.json();
    const out = BigInt(body.outAmount ?? 0);
    if (out <= 0n) throw new Error('Jupiter returned no route');
    return out;
  }

  return {
    name: 'jupiter',

    // usd: dollars to spend. refPriceUsd: DexScreener price, used only to
    // work out the token's decimals, which the quote does not include.
    async buy(mint, usd, refPriceUsd) {
      const rawIn = BigInt(Math.round(usd * 10 ** USDC_DECIMALS));
      const rawOut = await quote(USDC, mint, rawIn);
      const expectedTokens = usd / refPriceUsd;
      // rawOut = tokens * 10^decimals. Impact and fees shrink rawOut a bit,
      // which rounding absorbs unless the trade loses over ~68%.
      const decimals = Math.round(Math.log10(Number(rawOut) / expectedTokens));
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 12) {
        throw new Error(`could not work out token decimals (${decimals})`);
      }
      const tokens = Number(rawOut) / 10 ** decimals;
      return { tokens, rawAmount: rawOut.toString(), decimals, priceUsd: usd / tokens };
    },

    async sell(mint, rawAmount) {
      const rawOut = await quote(mint, USDC, BigInt(rawAmount));
      return { usd: Number(rawOut) / 10 ** USDC_DECIMALS };
    },
  };
}

module.exports = { createJupiterFills, USDC };
