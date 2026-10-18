# Near Social

![Near Social logo](public/logo.svg)

**The social network for NEAR traders where every profile is backed by the
chain.** Sign in with a NEAR wallet and your profile shows what you hold,
your profit and your trade history, read straight from NEAR. Post, reply,
like, repost, follow, and tip anyone in NEAR.

See [ROADMAP.md](ROADMAP.md) for the plan, architecture and security notes.

## Features

| Feature | How it works |
|---|---|
| Sign in | Meteor, HOT, Intear, HERE or MyNearWallet signs a message (NEP-413). Free, not a transaction |
| Profile | Name, bio, X handle, followers, following, tips received |
| Holdings | Native NEAR + every fungible token, priced in USD |
| Profit | Realized + unrealized PnL per token (average-cost method), win rate |
| Trade history | Swaps found in the account's token transfers (NEAR/USDC/USDT ↔ token) |
| Recent trades | Every member's buys and sells, newest first |
| Feed | Latest and Following tabs; members' new trades auto-posted (can be turned off) |
| Like, repost, reply, follow | Like X / Near Social |
| Tip | NEAR sent account-to-account; the server checks it on-chain before it shows |
| Leaderboard | Members ranked by profit on recorded trades |
| People | Search by name, X handle or account |
| Roadmap | In-app page and ROADMAP.md |

Dark and light mode, works on desktop and phone.

## Run locally

```bash
npm install
DATA_DIR=./data npm run seed   # optional: sample people, posts and trades
npm run dev                    # http://localhost:3000
npm test
```

Needs Node 22.13 or newer (uses the built-in `node:sqlite`).

The NEAR wallet code is pre-built into `public/vendor/near-wallet.js`.
After changing `wallet/entry.js` or upgrading wallet packages, rebuild it
with `npm run build:wallet`.

## Deploy on Railway

1. **New Project → Deploy from GitHub repo** → pick this repo and branch.
   Railway detects Node and runs `npm start`.
2. **Settings → Networking → Generate Domain** for the website URL.
3. **Attach a volume** at `/data` and add `DATA_DIR=/data`. The database
   (accounts, posts, likes, trades, tips) lives there.
4. **Variables:** set `SESSION_SECRET` to a long random string. Without it
   everyone is logged out on every restart.
5. Optional: `NEARBLOCKS_API_KEY` (from nearblocks.io) if trade sync hits
   rate limits as the site grows.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `APP_NAME` | `Near Social` | Site name |
| `DATA_DIR` | `./data` | Where `social.db` is stored |
| `SESSION_SECRET` | (random each start) | Signs login cookies |
| `NEAR_RPC_URL` | `https://rpc.mainnet.fastnear.com` | NEAR RPC: balances, keys, tips |
| `FASTNEAR_API_URL` | `https://api.fastnear.com` | Which tokens an account holds |
| `NEARBLOCKS_API_URL` | `https://api.nearblocks.io` | Token transfer history (trades) |
| `NEARBLOCKS_API_KEY` | (empty) | Optional, raises NearBlocks rate limits |
| `MIN_TIP_NEAR` | `0.01` | Smallest tip accepted |
| `SYNC_INTERVAL_SEC` | `300` | How often members are checked for new trades |
| `SYNC_BACKFILL_EVENTS` | `100` | Token events read when an account joins |
| `SYNC_ACCOUNTS_PER_ROUND` | `10` | Accounts checked per round |

Prices come from Ref Finance's public price list, with DexScreener as a
fallback.

## How sign-in works

1. The server gives the browser a message, a random 32-byte nonce and the
   site name.
2. The wallet signs them with NEP-413 (`signMessage`). Nothing is sent to the
   chain and nothing is spent.
3. The server checks the ed25519 signature, then asks NEAR RPC that the key
   is a **full-access key of that account**. Without that check anyone could
   claim any name.
4. A signed, HttpOnly session cookie keeps you logged in for 30 days.

## How profit is calculated

Trades are swaps found in a member's token transfers: one token in and NEAR,
USDC or USDT out, or the reverse. Paying with native NEAR shows up as wNEAR
being minted and sent, so mint and burn events of quote tokens are ignored.
For each token, the average-cost method gives:

- **Realized** = sell proceeds − average cost of the tokens sold
- **Unrealized** = current value of tokens still held − their average cost

Dollar values use the NEAR price when each trade was recorded. Sells of
tokens bought before the account joined are flagged as estimates.

## Project layout

```
src/server.js     Express app, security headers, startup
src/routes.js     HTTP API (auth, posts, likes, reposts, follows, tips, trades)
src/auth.js       NEAR sign-in: NEP-413 check, full-access key check, sessions
src/near.js       NEAR RPC, FastNEAR and NearBlocks clients; swap parser; tip check
src/portfolio.js  Holdings and profit
src/prices.js     Ref Finance + DexScreener prices
src/sync.js       Background job that reads members' new trades
src/db.js         SQLite schema
public/           The website (plain HTML, CSS and JS) and logo
wallet/           Source for the NEAR wallet bundle
test/             Tests (node --test)
```

Not financial advice. Memecoins are extremely risky.
