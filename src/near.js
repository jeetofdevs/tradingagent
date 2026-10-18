// NEAR data access:
// - NEAR RPC (FastNEAR's free endpoint by default): balances, access keys,
//   token metadata, transaction status.
// - FastNEAR API: which fungible tokens an account holds.
// - NearBlocks API: an account's token transfer history, used to find swaps.

const YOCTO = 1e24;

// Quote assets: what tokens are bought with or sold for on NEAR.
const QUOTES = {
  'wrap.near': 'NEAR',
  '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1': 'USDC',
  'usdt.tether-token.near': 'USDT',
  'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near': 'USDC.e',
  'dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near': 'USDT.e',
};
const WNEAR = 'wrap.near';

function createNear({ rpcUrl, fastnearUrl, nearblocksUrl, nearblocksKey = '', fetchImpl = fetch }) {
  async function getJson(url, opts = {}) {
    const res = await fetchImpl(url, { ...opts, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`);
    return res.json();
  }

  async function rpc(method, params) {
    const body = await getJson(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'app', method, params }),
    });
    if (body.error) {
      const err = new Error(`NEAR RPC ${method}: ${body.error.cause?.name || body.error.message || 'error'}`);
      err.cause = body.error.cause?.name;
      throw err;
    }
    return body.result;
  }

  return {
    rpc,

    // Liquid NEAR balance.
    async nearBalance(accountId) {
      const r = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: accountId });
      return Number(BigInt(r.amount)) / YOCTO;
    },

    // 'FullAccess', 'FunctionCall', or null if the key is not on the account.
    async accessKeyPermission(accountId, publicKey) {
      try {
        const r = await rpc('query', { request_type: 'view_access_key', finality: 'final', account_id: accountId, public_key: publicKey });
        return r.permission === 'FullAccess' ? 'FullAccess' : 'FunctionCall';
      } catch (err) {
        if (/UNKNOWN_ACCESS_KEY|UNKNOWN_ACCOUNT/.test(err.cause || err.message)) return null;
        throw err;
      }
    },

    async ftMetadata(contract) {
      const r = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: contract, method_name: 'ft_metadata', args_base64: 'e30=' });
      return JSON.parse(Buffer.from(r.result).toString('utf8'));
    },

    // Map contract -> raw balance string, for tokens with a balance above 0.
    async ftBalances(accountId) {
      const r = await getJson(`${fastnearUrl}/v1/account/${encodeURIComponent(accountId)}/ft`);
      const out = new Map();
      for (const t of r.tokens || []) {
        if (t.contract_id && t.balance && BigInt(t.balance) > 0n) out.set(t.contract_id, t.balance);
      }
      return out;
    },

    // Token transfer events for an account, newest first.
    async ftEvents(accountId, { cursor = null, perPage = 100 } = {}) {
      const q = new URLSearchParams({ per_page: String(perPage), order: 'desc' });
      if (cursor) q.set('cursor', cursor);
      const headers = { accept: 'application/json' };
      if (nearblocksKey) headers.authorization = `Bearer ${nearblocksKey}`;
      const r = await getJson(`${nearblocksUrl}/v1/account/${encodeURIComponent(accountId)}/ft-txns?${q}`, { headers });
      return { events: r.txns || [], cursor: r.cursor || null };
    },

    // Final transaction result, or null if the network does not know it yet.
    async txStatus(hash, senderId) {
      try {
        return await rpc('tx', { tx_hash: hash, sender_account_id: senderId, wait_until: 'EXECUTED_OPTIMISTIC' });
      } catch (err) {
        if (/UNKNOWN_TRANSACTION|TIMEOUT_ERROR/.test(err.cause || err.message)) return null;
        throw err;
      }
    },

    // Read-only contract call; returns parsed JSON (or null).
    async view(contract, method, args = {}) {
      const r = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
      const text = Buffer.from(r.result).toString('utf8');
      return text ? JSON.parse(text) : null;
    },

    async blockTimeMs(blockHash) {
      const r = await rpc('block', { block_id: blockHash });
      return Number(BigInt(r.header.timestamp) / 1000000n);
    },
  };
}

const toUnits = (raw, decimals) => Number(BigInt(raw)) / 10 ** decimals;

// Group an account's token transfer events by transaction and keep the ones
// that are swaps: one non-quote token moved one way and a quote asset
// (NEAR, USDC, USDT) moved the other way.
//
// Paying with native NEAR shows up as wNEAR being minted and then sent, so
// mint and burn events of quote tokens are ignored; only real transfers count.
function parseFtEvents(events, accountId) {
  const byTx = new Map();
  for (const e of events) {
    if (!e.transaction_hash || !e.ft || !e.ft.contract) continue;
    if (e.affected_account_id && e.affected_account_id !== accountId) continue;
    if (!byTx.has(e.transaction_hash)) byTx.set(e.transaction_hash, []);
    byTx.get(e.transaction_hash).push(e);
  }

  const trades = [];
  for (const [hash, list] of byTx) {
    const deltas = new Map();
    const meta = new Map();
    let time = 0;
    for (const e of list) {
      const contract = e.ft.contract;
      const cause = String(e.cause || e.event_kind || '').toUpperCase();
      if (QUOTES[contract] && (cause.includes('MINT') || cause.includes('BURN'))) continue;
      const decimals = Number(e.ft.decimals ?? 0);
      let amount;
      try {
        amount = toUnits(String(e.delta_amount).split('.')[0], decimals);
      } catch {
        continue;
      }
      deltas.set(contract, (deltas.get(contract) || 0) + amount);
      meta.set(contract, { symbol: e.ft.symbol || '', name: e.ft.name || '', decimals });
      time = Math.max(time, Math.floor(Number(BigInt(e.block_timestamp || 0) / 1000000n)));
    }

    const EPS = 1e-12;
    const tokens = [...deltas].filter(([c, v]) => !QUOTES[c] && Math.abs(v) > EPS);
    if (tokens.length !== 1) continue;
    const [contract, tokenDelta] = tokens[0];
    const side = tokenDelta > 0 ? 'buy' : 'sell';
    let quote = null;
    for (const [qc, symbol] of Object.entries(QUOTES)) {
      const v = deltas.get(qc) || 0;
      const opposite = side === 'buy' ? v < -EPS : v > EPS;
      if (opposite && (!quote || Math.abs(v) > quote.amount)) quote = { symbol, amount: Math.abs(v) };
    }
    if (!quote) continue;
    trades.push({
      signature: hash,
      mint: contract,
      symbol: meta.get(contract).symbol,
      name: meta.get(contract).name,
      decimals: meta.get(contract).decimals,
      side,
      tokenAmount: Math.abs(tokenDelta),
      quoteSymbol: quote.symbol,
      quoteAmount: quote.amount,
      blockTime: time,
    });
  }
  return trades;
}

// NEAR sent from `from` to `to` by a successful transaction, in NEAR.
function findNearTransfer(tx, from, to) {
  if (!tx || !tx.transaction || !tx.status || tx.status.SuccessValue === undefined) return 0;
  if (tx.transaction.signer_id !== from || tx.transaction.receiver_id !== to) return 0;
  let yocto = 0n;
  for (const a of tx.transaction.actions || []) {
    if (a && a.Transfer && a.Transfer.deposit) yocto += BigInt(a.Transfer.deposit);
  }
  return Number(yocto) / YOCTO;
}

// Raw amount of `token` moved from `from` to `to` by a successful
// transaction, read from the token contract's NEP-141 ft_transfer events
// (the token itself logs these only when the transfer really happened).
function findFtTransfer(tx, token, from, to) {
  if (!tx || !tx.transaction || !tx.status || tx.status.SuccessValue === undefined) return 0n;
  if (tx.transaction.signer_id !== from) return 0n;
  let total = 0n;
  for (const r of tx.receipts_outcome || []) {
    const o = r.outcome || {};
    if (o.executor_id !== token || (o.status && o.status.Failure)) continue;
    for (const log of o.logs || []) {
      if (!log.startsWith('EVENT_JSON:')) continue;
      let ev;
      try {
        ev = JSON.parse(log.slice('EVENT_JSON:'.length));
      } catch {
        continue;
      }
      if (ev.standard !== 'nep141' || ev.event !== 'ft_transfer') continue;
      for (const d of ev.data || []) {
        if (d.old_owner_id === from && d.new_owner_id === to) total += BigInt(d.amount || 0);
      }
    }
  }
  return total;
}

module.exports = { createNear, parseFtEvents, findNearTransfer, findFtTransfer, QUOTES, WNEAR, YOCTO, toUnits };
