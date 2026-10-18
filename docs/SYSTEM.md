# Near Social: how the system works

Near Social is a social network for NEAR traders. Every profile is backed
by the chain: holdings, profit and trade history come from the member's
NEAR account, so nobody can fake a PnL screenshot. On top sits the social
layer: posts, replies, likes, reposts, follows and NEAR tips.

## User flow

1. **Connect.** Pick a NEAR wallet (Meteor, HOT, Intear, HERE, MyNearWallet)
   and sign a short message. No transaction, no fee.
2. **Profile fills itself.** Holdings, profit and trade history are read
   from the NEAR blockchain.
3. **Post and follow.** Share calls, reply, like, repost, follow traders;
   their new trades appear in your feed.
4. **Tip.** Send NEAR to a post or profile, wallet to wallet. The site
   checks the transfer on-chain before showing it.

## What lives where

| On-chain (public, permanent) | Off-chain (this server) |
|---|---|
| NEAR account and its keys | Profile name, bio, X handle |
| Token balances and every swap | Posts, replies, likes, reposts, follows |
| Tips (real NEAR transfers) | Cached copy of trades, for speed |

## Compared with other on-chain social apps

| | Near Social (this app) | Near Social (BOS) | Farcaster | Lens |
|---|---|---|---|---|
| Chain | NEAR | NEAR | Ethereum L2 (Optimism) | Lens Chain |
| Sign in | NEAR wallet | NEAR wallet | Farcaster account | Lens profile |
| Profit and holdings on profile | Yes, from chain | No | No | No |
| Trades auto-posted to feed | Yes | No | No | No |
| Tips in native token | Yes (NEAR) | Via apps | Via apps | Via apps |
| Posts stored | Server | On-chain (SocialDB) | Hubs (off-chain network) | Lens Chain + storage network |

Feature summary only; other apps change often.

## Fees

None. Signing in, posting and liking are free. Tips go 100% to the person
tipped.

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
