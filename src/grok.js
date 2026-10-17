// Grok as a second opinion before each buy. Grok searches X for the token
// (contract address and ticker) and judges the crowd: real community or
// bots, paid shills, rug or scam reports, hype rising or fading.
//
// It never sizes trades or overrides exits. In 'veto' mode a "skip" from
// Grok blocks the buy; in 'advise' mode its view is only recorded.
//
// API: xAI Responses API with the x_search tool (the old Live Search on
// chat completions was removed). Needs XAI_API_KEY.

const CACHE_MS = 60 * 60000;

const SYSTEM = `You are a skeptical Solana memecoin risk analyst helping a trading bot.
Use X search to look up the token by its contract address and its $TICKER.
Judge only what you find on X in the last 24 hours:
- Is there a real, organic community, or mostly bots, copy-paste replies and paid shills?
- Any reports of rug pulls, scams, dev selling, bundled or sniped supply, or copycat tokens?
- Is attention rising, flat or fading?
- Are credible accounts talking about it, or only new / low-follower accounts?
If you find little or nothing, that is a reason to skip.
Reply with ONLY a JSON object, no other text:
{"decision":"buy"|"skip","confidence":0-100,"sentiment":"bullish"|"neutral"|"bearish","summary":"one short sentence","red_flags":["..."]}`;

function describe(snap) {
  const n = (v) => Math.round(v).toLocaleString('en-US');
  return [
    `Token: ${snap.name} ($${snap.symbol})`,
    `Contract address (Solana): ${snap.address}`,
    `Price: $${snap.priceUsd}`,
    `Liquidity: $${n(snap.liquidityUsd)}, FDV: $${n(snap.fdv)}`,
    `Pool age: ${Math.round(snap.ageMin)} minutes`,
    `Price change: 5m ${snap.chgM5}%, 1h ${snap.chgH1}%, 24h ${snap.chgH24}%`,
    `Last hour: ${snap.buysH1} buys, ${snap.sellsH1} sells, $${n(snap.volH1)} volume`,
    'Should the bot buy a small position now?',
  ].join('\n');
}

// Pull the reply text out of a Responses API body.
function replyText(body) {
  if (typeof body.output_text === 'string' && body.output_text) return body.output_text;
  const parts = [];
  for (const item of body.output || []) {
    for (const c of item.content || []) {
      if ((c.type === 'output_text' || c.type === 'text') && typeof c.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('\n');
}

function parseVerdict(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Grok reply had no JSON');
  const raw = JSON.parse(match[0]);
  const decision = String(raw.decision || '').toLowerCase();
  if (decision !== 'buy' && decision !== 'skip') throw new Error(`Grok decision "${raw.decision}" is not buy or skip`);
  const confidence = Math.max(0, Math.min(100, Number(raw.confidence) || 0));
  const sentiment = ['bullish', 'neutral', 'bearish'].includes(raw.sentiment) ? raw.sentiment : 'neutral';
  const flags = Array.isArray(raw.red_flags) ? raw.red_flags : Array.isArray(raw.redFlags) ? raw.redFlags : [];
  return {
    decision,
    confidence,
    sentiment,
    summary: String(raw.summary || '').slice(0, 300),
    redFlags: flags.map((f) => String(f).slice(0, 120)).slice(0, 5),
  };
}

function createGrokAdvisor({ apiKey, model, baseUrl = 'https://api.x.ai/v1', fetchImpl = fetch, now = () => Date.now() }) {
  const cache = new Map();

  async function check(snap) {
    const hit = cache.get(snap.address);
    if (hit && now() - hit.t < CACHE_MS) return { ...hit.verdict, cached: true };

    const res = await fetchImpl(`${baseUrl}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        input: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: describe(snap) },
        ],
        tools: [{ type: 'x_search' }],
      }),
      // X search runs several rounds and can take close to a minute.
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`Grok HTTP ${res.status} ${detail}`);
    }
    const verdict = parseVerdict(replyText(await res.json()));
    cache.set(snap.address, { t: now(), verdict });
    return verdict;
  }

  function isCached(address) {
    const hit = cache.get(address);
    return Boolean(hit && now() - hit.t < CACHE_MS);
  }

  return { name: `grok (${model})`, check, isCached };
}

module.exports = { createGrokAdvisor, parseVerdict, replyText };
