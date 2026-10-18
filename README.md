# Near Social

**The social network for Solana traders where every profile is backed by
the chain.** Connect a wallet and your profile shows what you hold, your
profit and your trade history, read straight from Solana. Post, reply,
like, repost, follow, and tip anyone in SOL.

See [ROADMAP.md](ROADMAP.md) for the plan, architecture and security notes.

## Features

| Feature | How it works |
|---|---|
| Sign in | Phantom, Solflare or Backpack signs a text message (free, not a transaction) |
| Profile | Name, bio, X handle, followers, following, tips received |
| Holdings | Live SOL and token balances from Solana RPC, priced with DexScreener |
| Profit | Realized + unrealized PnL per token (average-cost method), win rate |
| Trade history | Swaps parsed from the wallet's transactions (SOL/USDC/USDT ↔ token) |
| Recent trades | Every member's buys and sells, newest first |
| Feed | Latest and Following tabs; members' new trades auto-posted (can be turned off) |
| Like, repost, reply, follow | Like Near Social / X |
| Tip | SOL sent wallet-to-wallet; the server checks it on-chain before it shows |
| Leaderboard | Members ranked by profit on recorded trades |
| People | Search by name, X handle or wallet |
| Roadmap | In-app page and ROADMAP.md |

Works on desktop and phone (in a wallet app's browser), light and dark mode.

## Run locally

```bash
npm install
DATA_DIR=./data npm run seed   # optional: sample people, posts and trades
npm run dev                    # http://localhost:3000
npm test
```

Needs Node 22.13 or newer (uses the built-in `node:sqlite`).

## Deploy on Railway

1. **New Project → Deploy from GitHub repo** → pick this repo and branch.
   Railway detects Node and runs `npm start`.
2. **Settings → Networking → Generate Domain** for the website URL.
3. **Attach a volume** at `/data` and add `DATA_DIR=/data`. The database
   (users, posts, likes, trades, tips) lives there.
4. **Variables:**
   - `SESSION_SECRET`: a long random string. Without it everyone is logged
     out on every restart.
   - `SOLANA_RPC_URL`: a provider URL, for example a free Helius RPC URL.
     The public RPC is heavily rate limited.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `APP_NAME` | `Near Social` | Site name |
| `DATA_DIR` | `./data` | Where `social.db` is stored |
| `SESSION_SECRET` | (random each start) | Signs login cookies |
| `SOLANA_RPC_URL` | public mainnet RPC | Solana RPC endpoint |
| `MIN_TIP_SOL` | `0.001` | Smallest tip accepted |
| `SYNC_INTERVAL_SEC` | `300` | How often members' wallets are checked for new trades |
| `SYNC_BACKFILL_TX` | `40` | Transactions read when a wallet joins |
| `SYNC_WALLETS_PER_ROUND` | `10` | Wallets checked per round |

## How profit is calculated

Trades are swaps found in a member's transactions: one token in and SOL,
USDC or USDT out, or the reverse. Transfers and airdrops are ignored. For
each token, the average-cost method gives:

- **Realized** = sell proceeds − average cost of the tokens sold
- **Unrealized** = current value of tokens still held − their average cost

Dollar values use the SOL price when each trade was recorded. Sells of
tokens bought before the wallet joined are flagged as estimates, because
their cost is unknown.

## Project layout

```
src/server.js     Express app, security headers, startup
src/routes.js     HTTP API (auth, posts, likes, reposts, follows, tips, trades)
src/auth.js       Wallet sign-in: nonce, ed25519 check, signed session cookie
src/db.js         SQLite schema
src/solana.js     Solana RPC client, swap parser, tip transfer check
src/portfolio.js  Holdings and profit
src/prices.js     DexScreener prices
src/sync.js       Background job that reads members' new trades
public/           The website (plain HTML, CSS and JS, no build step)
scripts/          Demo data seeder
test/             Tests (node --test)
```

Not financial advice. Memecoins are extremely risky.
