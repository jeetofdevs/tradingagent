# Near Social Roadmap

**Near Social is the social network for Solana traders where every profile is
backed by the chain.** Holdings, profit and trade history come from each
member's wallet, so nobody can fake a PnL screenshot. On top of that sits
the social layer: posts, replies, likes, reposts, follows and SOL tips.

## Why it can win

| Problem today | Near Social |
|---|---|
| "I made 50x" screenshots are easy to fake | PnL is computed from on-chain swaps |
| Following a trader on X shows tweets, not trades | Their buys and sells appear in your feed automatically |
| Tipping a good call means copying an address | One-click SOL tip, verified on-chain |
| Signal groups hide their losses | Every member's losses are on their profile too |

## Phases

### Phase 1 · Foundation (shipped)
- Sign in with Phantom, Solflare or Backpack (signed message, never a transaction)
- Profiles: name, bio, X handle, followers and following
- Posts, replies, likes, reposts, follows; Latest and Following feeds

### Phase 2 · On-chain profiles (shipped)
- Live token holdings for every member, priced in USD
- Profit per token: realized, unrealized, win rate
- Trade history parsed from each wallet's swaps
- Recent trades across all members, auto-posted to the feed (can be turned off)
- Leaderboard and people search

### Phase 3 · Tips (shipped)
- Tip any post or profile in SOL, wallet to wallet
- Every tip verified on-chain before it shows
- Tip history on each profile

### Phase 4 · Signal (next)
- Alerts when wallets you follow buy or sell
- Token pages: which members hold it, their average entry, total member PnL
- Notifications for likes, reposts, replies, follows and tips
- Helius webhooks for instant trade sync instead of polling

### Phase 5 · Creator economy
- Token-gated groups (hold X of a token to join)
- Creator stats: tips received, followers gained per call
- Verified badges for KOLs and project team wallets
- Installable mobile app (PWA) with push notifications

### Phase 6 · Open and on-chain
- Posts stored on Arweave or a Solana program so profiles are portable
- Public API for profiles, PnL and trade feeds
- Multi-chain wallets

## Architecture

```
Browser (plain JS)  ── wallet signs a login message / approves SOL tips
   │
Express server (Railway)
   ├─ Social API  ── SQLite (node:sqlite) on the Railway volume
   ├─ Wallet sync ── Solana RPC: signatures → parsed transactions → swaps
   └─ Portfolio   ── RPC token balances + DexScreener prices
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
