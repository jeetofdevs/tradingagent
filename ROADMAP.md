# Near Social Roadmap

**Near Social is the social network for NEAR traders where every profile is
backed by the chain.** Holdings, profit and trade history come from each
member's wallet, so nobody can fake a PnL screenshot. On top of that sits
the social layer: posts, replies, likes, reposts, follows and NEAR tips.

## Why it can win

| Problem today | Near Social |
|---|---|
| "I made 50x" screenshots are easy to fake | PnL is computed from on-chain swaps |
| Following a trader on X shows tweets, not trades | Their buys and sells appear in your feed automatically |
| Tipping a good call means copying an account name | One-tap NEAR tip, verified on-chain |
| Signal groups hide their losses | Every member's losses are on their profile too |

## Phases

### Phase 1 · Foundation (shipped)
- Sign in with Meteor, HOT, Intear, HERE or MyNearWallet (NEP-413 signed message, never a transaction)
- Profiles: name, bio, X handle, followers and following
- Posts, replies, likes, reposts, follows; Latest and Following feeds

### Phase 2 · On-chain profiles (shipped)
- Live token holdings for every member, priced in USD
- Profit per token: realized, unrealized, win rate
- Trade history parsed from each account's swaps
- Recent trades across all members, auto-posted to the feed (can be turned off)
- Leaderboard and people search

### Phase 3 · Tips (shipped)
- Tip any post or profile in NEAR, account to account
- Every tip verified on-chain before it shows
- Tip history on each profile

### Phase 4 · Signal (next)
- Alerts when wallets you follow buy or sell
- Token pages: which members hold it, their average entry, total member PnL
- Notifications for likes, reposts, replies, follows and tips
- Faster trade sync (indexer streams instead of polling)

### Phase 5 · Creator economy
- Token-gated groups (hold X of a token to join)
- Creator stats: tips received, followers gained per call
- Verified badges for KOLs and project team wallets
- Installable mobile app (PWA) with push notifications

### Phase 6 · Open and on-chain
- Posts stored on-chain (NEAR SocialDB) so profiles are portable
- Public API for profiles, PnL and trade feeds
- Chain signatures: show holdings from other chains on the same profile

## Architecture

```
Browser (plain JS + NEAR wallet bundle)
   │  wallet signs a NEP-413 login message / approves NEAR tips
Express server (Railway)
   ├─ Social API  ── SQLite (node:sqlite) on the Railway volume
   ├─ Sync        ── NearBlocks token transfers → swaps → trades
   ├─ Portfolio   ── NEAR RPC + FastNEAR balances, Ref Finance prices
   └─ Tips        ── NEAR RPC transaction status
```

- **Trades** are swaps found in a member's token transfers: one token in and
  NEAR, USDC or USDT out, or the reverse. Plain transfers are ignored.
- **Profit** uses the average-cost method on recorded trades. Dollar values
  use the NEAR price when each trade was recorded.

## Security

- Login: NEP-413 signature, then a check that the key is a full-access key
  of the claimed account; single-use nonce; signed HttpOnly cookie
  (`SESSION_SECRET`), 30-day expiry.
- Every write needs the session plus an `X-Requested-With` header, which
  blocks cross-site forged requests.
- All user text is escaped in the browser; only `https://` links become
  links. Token icons are shown only if they are images.
- Tips count only after the server finds a successful NEAR transfer from
  the tipper to the receiver on-chain, once per transaction.
- Rate limits on sign-in, posting, reposting and manual sync.

## Known limits

- Public NearBlocks and FastNEAR endpoints have rate limits. Add a
  `NEARBLOCKS_API_KEY` as the member count grows.
- When an account joins, its last 100 token events are read; older history
  is not included.
- Swaps routed through two non-quote tokens in one transaction are skipped.
