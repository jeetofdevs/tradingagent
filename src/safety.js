// Optional token safety check via RugCheck (https://rugcheck.xyz), free and
// keyless. It flags things price data cannot show: mint authority still on
// (creator can print more), freeze authority on (creator can lock wallets),
// unlocked liquidity, and concentrated holders.
//
// Fails safe: if the check cannot run, the token is not bought.

const BASE = 'https://api.rugcheck.xyz/v1/tokens';
const CACHE_MS = 30 * 60000;

function createRugCheck({ maxRiskScore, fetchImpl = fetch, now = () => Date.now() }) {
  const cache = new Map();

  async function check(address) {
    const hit = cache.get(address);
    if (hit && now() - hit.t < CACHE_MS) return hit.result;

    let result;
    try {
      const res = await fetchImpl(`${BASE}/${encodeURIComponent(address)}/report/summary`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`RugCheck HTTP ${res.status}`);
      const report = await res.json();
      const risks = Array.isArray(report.risks) ? report.risks : [];
      const dangers = risks.filter((r) => String(r.level).toLowerCase() === 'danger').map((r) => r.name);
      const score = Number(report.score_normalised ?? report.scoreNormalised);
      const reasons = dangers.map((d) => `rugcheck: ${d}`);
      if (Number.isFinite(score) && score > maxRiskScore) reasons.push(`rugcheck risk ${score} above ${maxRiskScore}`);
      result = { ok: reasons.length === 0, reasons, score: Number.isFinite(score) ? score : null };
    } catch (err) {
      result = { ok: false, reasons: [`safety check failed (${err.message})`], score: null };
      // Retry failures sooner than successes.
      cache.set(address, { t: now() - CACHE_MS + 2 * 60000, result });
      return result;
    }
    cache.set(address, { t: now(), result });
    return result;
  }

  return { check };
}

module.exports = { createRugCheck };
