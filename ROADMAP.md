# SolCircle Roadmap

**SolCircle is the social network for Solana traders where every profile is
backed by the chain.** Holdings, profit and trade history come from each
member's wallet, so nobody can fake a PnL screenshot. On top of that sits
the usual social layer: posts, replies, likes, reposts, follows and SOL
tips, plus a demo-fund memecoin bot whose every call is public.

The name is a placeholder; set `APP_NAME` to rebrand.

## Why it can win

| Problem today | SolCircle |
|---|---|
| "I made 50x" screenshots are easy to fake | PnL is computed from on-chain swaps |
| Following a trader on X shows tweets, not trades | Their buys and sells appear in your feed automatically |
| Tipping a good call means copying an address | One-click SOL tip, verified on-chain |
| Bots and signal groups hide their losses | The demo bot shows every trade, win rate, drawdown and an edge-vs-luck test |

## Phases

### Phase 1 · Trading engine (shipped)
- Solana memecoin scanner on live DexScreener data
- Rug filters, RugCheck safety check
- Demo fund priced with real Jupiter swap quotes
- Grok second opinion that reads X before each buy, scored on its own calls
- "Ready for real money?" checklist; live trading locked out

### Phase 2 · Social layer (shipped)
- Sign in with Phantom, Solflare or Backpack (signed message, never a transaction)
- Posts, replies, likes, reposts, follows; Latest and Following feeds
- SOL tips wallet-to-wallet, checked on-chain before they show
- Profiles with live holdings, profit (realized and unrealized) and trade history
- Recent trades feed across all members, leaderboard, people search
- Members' new swaps auto-posted to the feed (can be turned off)

### Phase 3 · Signal (next)
- Copy-trade alerts: notify when wallets you follow buy or sell
- Token pages: which members hold it, their average entry, total member PnL
- The demo bot posts its own buys and sells to the feed as a member
- Notifications for likes, reposts, replies, follows and tips
- Helius webhooks for instant trade sync instead of polling

### Phase 4 · Creator economy
- Token-gated groups (hold X of a token to join)
- Creator stats: tips received, followers gained per call
- Verified badges for KOLs and project team wallets
- Installable mobile app (PWA) with push notifications

### Phase 5 · Open and on-chain
- Posts stored on Arweave or a Solana program so profiles are portable
- Public API for profiles, PnL and trade feeds
- Live trading for the bot, only after the demo passes every readiness check
  for several weeks, with strict per-trade and daily loss limits

## Architecture

```
Browser (plain JS)  ── wallet signs a login message / approves SOL tips
   │
Express server (Railway)
   ├─ Social API  ── SQLite (node:sqlite) on the Railway volume
   ├─ Wallet sync ── Solana RPC: signatures → parsed transactions → swaps
   ├─ Portfolio   ── RPC token balances + DexScreener prices
   └─ Demo bot    ── DexScreener, RugCheck, Jupiter quotes, Grok (xAI)
```

- **Trades** are swaps found in a member's transactions: one token in and
  SOL, USDC or USDT out, or the reverse. Transfers and airdrops are ignored.
- **Profit** uses the average-cost method on recorded trades. Dollar values
  use the SOL price when each trade was recorded. Sells of tokens bought
  before a wallet joined are flagged as estimates.

## Security

- Login: one-time nonce, ed25519 signature check, signed HttpOnly cookie
  (`SESSION_SECRET`), 30-day expiry.
- Every write needs the session plus an `X-Requested-With` header, which
  blocks cross-site forged requests.
- All user text is escaped in the browser; only `https://` links become links.
- Tips are recorded only after the server finds a matching SOL transfer
  from the tipper to the receiver on-chain, once per signature.
- Rate limits on sign-in, posting, reposting and manual sync.
- The browser Solana library is loaded with a Subresource Integrity hash.

## Known limits

- The public Solana RPC is rate limited. Set `SOLANA_RPC_URL` to a provider
  (Helius, Triton, QuickNode) before inviting many users.
- Sync reads the last 40 transactions when a wallet joins, then every new
  one. Older history is not included.
- Multi-hop swaps through two non-quote tokens in one transaction are skipped.
