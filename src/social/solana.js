// Minimal Solana JSON-RPC client plus the swap parser that turns a wallet's
// transactions into buy/sell trades.
//
// The public RPC (api.mainnet-beta.solana.com) is heavily rate limited.
// For real use set SOLANA_RPC_URL to a provider URL (Helius, Triton, QuickNode).

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const LAMPORTS = 1e9;

// Quote assets: what a memecoin is bought with or sold for.
const QUOTES = { [WSOL]: 'SOL', [USDC]: 'USDC', [USDT]: 'USDT' };

function createRpc({ url, fetchImpl = fetch, minGapMs = 120 }) {
  let id = 0;
  let last = 0;
  let queue = Promise.resolve();

  // Space requests out a little so a public RPC does not throttle us.
  function call(method, params) {
    const run = async () => {
      const wait = last + minGapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`Solana RPC ${method} HTTP ${res.status}`);
      const body = await res.json();
      if (body.error) throw new Error(`Solana RPC ${method}: ${body.error.message || JSON.stringify(body.error)}`);
      return body.result;
    };
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }

  return {
    call,
    async getSolBalance(wallet) {
      const r = await call('getBalance', [wallet, { commitment: 'confirmed' }]);
      return r.value / LAMPORTS;
    },
    // Every SPL token the wallet holds (both token programs), amount > 0.
    async getTokenBalances(wallet) {
      const out = new Map();
      for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
        const r = await call('getTokenAccountsByOwner', [wallet, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
        for (const acc of r.value || []) {
          const info = acc.account?.data?.parsed?.info;
          const amount = Number(info?.tokenAmount?.uiAmountString ?? info?.tokenAmount?.uiAmount ?? 0);
          if (!info?.mint || !(amount > 0)) continue;
          out.set(info.mint, (out.get(info.mint) || 0) + amount);
        }
      }
      return out;
    },
    async getSignatures(wallet, { limit = 50, until, before } = {}) {
      const opts = { limit, commitment: 'confirmed' };
      if (until) opts.until = until;
      if (before) opts.before = before;
      return call('getSignaturesForAddress', [wallet, opts]);
    },
    async getTransaction(signature) {
      return call('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
    },
    async getLatestBlockhash() {
      const r = await call('getLatestBlockhash', [{ commitment: 'confirmed' }]);
      return r.value;
    },
  };
}

const keyOf = (k) => (typeof k === 'string' ? k : k?.pubkey);

// Turn one parsed transaction into the trades it contains for `wallet`.
// A trade = one non-quote token went one way and a quote asset (SOL, USDC,
// USDT) went the other. Transfers, airdrops and multi-token swaps are skipped.
function parseSwaps(tx, wallet) {
  if (!tx || !tx.meta || tx.meta.err) return [];
  const keys = (tx.transaction?.message?.accountKeys || []).map(keyOf);
  const walletIndex = keys.indexOf(wallet);

  const deltas = new Map();
  const add = (mint, v) => deltas.set(mint, (deltas.get(mint) || 0) + v);
  const amount = (b) => Number(b.uiTokenAmount?.uiAmountString ?? b.uiTokenAmount?.uiAmount ?? 0);
  for (const b of tx.meta.preTokenBalances || []) if (b.owner === wallet) add(b.mint, -amount(b));
  for (const b of tx.meta.postTokenBalances || []) if (b.owner === wallet) add(b.mint, amount(b));

  // Native SOL change, with the network fee added back if the wallet paid it.
  let solDelta = 0;
  if (walletIndex >= 0) {
    solDelta = (tx.meta.postBalances[walletIndex] - tx.meta.preBalances[walletIndex]) / LAMPORTS;
    if (walletIndex === 0) solDelta += (tx.meta.fee || 0) / LAMPORTS;
  }
  add(WSOL, solDelta);

  const EPS = 1e-9;
  const tokens = [...deltas].filter(([mint, v]) => !QUOTES[mint] && Math.abs(v) > EPS);
  if (tokens.length !== 1) return [];
  const [mint, tokenDelta] = tokens[0];
  const side = tokenDelta > 0 ? 'buy' : 'sell';

  // The quote leg moves the opposite way; pick the largest such move.
  let quote = null;
  for (const [qMint, symbol] of Object.entries(QUOTES)) {
    const v = deltas.get(qMint) || 0;
    const opposite = side === 'buy' ? v < -EPS : v > EPS;
    // Ignore dust SOL moves (rent, tips) under 0.0005 SOL.
    if (opposite && !(symbol === 'SOL' && Math.abs(v) < 0.0005) && (!quote || Math.abs(v) > quote.amount)) {
      quote = { mint: qMint, symbol, amount: Math.abs(v) };
    }
  }
  if (!quote) return [];

  return [{
    signature: tx.transaction.signatures[0],
    mint,
    side,
    tokenAmount: Math.abs(tokenDelta),
    quoteSymbol: quote.symbol,
    quoteAmount: quote.amount,
    blockTime: (tx.blockTime || 0) * 1000,
  }];
}

// Did this transaction send `lamports` of SOL from `from` to `to`?
function findSolTransfer(tx, from, to) {
  if (!tx || !tx.meta || tx.meta.err) return 0;
  const all = [...(tx.transaction?.message?.instructions || [])];
  for (const inner of tx.meta.innerInstructions || []) all.push(...(inner.instructions || []));
  let total = 0;
  for (const ix of all) {
    const info = ix.parsed?.info;
    if (ix.programId === SYSTEM_PROGRAM && ix.parsed?.type === 'transfer' && info?.source === from && info?.destination === to) {
      total += Number(info.lamports) || 0;
    }
  }
  return total;
}

module.exports = { createRpc, parseSwaps, findSolTransfer, WSOL, USDC, USDT, QUOTES, LAMPORTS };
