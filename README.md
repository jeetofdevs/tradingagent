# Memecoin Paper Bot

A Solana memecoin trading bot with a web dashboard. It watches new and
trending tokens on DexScreener, filters out likely rugs, scores the rest, and
**paper trades** them: every buy and sell is simulated at live prices with
fees and slippage. No wallet, no private key, no real money.

Run it for a few weeks. If the dashboard's **Edge check** says "Likely real
edge" after 30+ trades, the strategy might be worth trading for real. Most
memecoin strategies never get there.

## What it does

Every scan (default every 60 s):

1. **Check open positions** and sell on the first rule that hits:
   take profit, stop loss, trailing stop, liquidity pulled, or max hold time.
   A token that disappears from the data is booked as a total loss.
2. **Find candidates** from DexScreener's latest token profiles and boosts on
   Solana, using the deepest pool for each token.
3. **Hard filters** (any one rejects): too little liquidity or volume, too new
   or too old, too few trades, buys with no sells (possible honeypot), market
   value far above pool depth, already pumped, or dumping right now.
4. **Score 0 to 100** from buy pressure, 5-minute momentum, 1-hour trend,
   volume turnover, and pool depth. Buys only at or above `MIN_SCORE`.
5. **Safety check** with [RugCheck](https://rugcheck.xyz) before each buy:
   mint authority still on, freeze authority on, unlocked liquidity, and other
   "danger" risks. If the check cannot run, the bot skips the token.

The dashboard shows equity, win rate, average result per trade, profit factor,
max drawdown, win and loss streaks, an edge check (is the result better than
luck?), open positions, closed trades, and why each scanned token was or was
not bought.

## Deploy on Railway

1. Push this repo to GitHub (already done if you are reading this there).
2. On [railway.com](https://railway.com): **New Project → Deploy from GitHub
   repo** → pick this repo. Railway detects Node and runs `npm start`.
3. **Settings → Networking → Generate Domain** to get the website URL.
4. **Add a volume** so trade history survives redeploys: right-click the
   service → **Attach Volume**, mount path `/data`. Then add the variable
   `DATA_DIR=/data`.
5. **Variables** (optional): set `ADMIN_TOKEN` to a long random string to turn
   on the Pause, Resume, Sell all and Reset buttons. Without it the dashboard
   is read-only. Change any setting below the same way.

Anyone with the URL can view the dashboard. Only someone with `ADMIN_TOKEN`
can press the buttons.

## Run locally

```bash
npm install
npm run dev        # fake market, scans every 3 s, http://localhost:3000
npm start          # real Solana data from DexScreener
npm test
```

## Settings

All optional, set as environment variables.

| Variable | Default | Meaning |
|---|---|---|
| `DATA_SOURCE` | `dexscreener` | `mock` for a fake market (testing) |
| `CHAIN` | `solana` | DexScreener chain id |
| `SCAN_INTERVAL_SEC` | `60` | Seconds between scans |
| `DATA_DIR` | `./data` | Where `state.json` is saved |
| `ADMIN_TOKEN` | (empty) | Turns on dashboard controls |
| `START_BALANCE_USD` | `1000` | Paper starting balance |
| `POSITION_SIZE_PCT` | `5` | % of equity per trade |
| `MAX_OPEN_POSITIONS` | `5` | Max trades open at once |
| `COST_PER_SIDE_PCT` | `1.5` | Fees + slippage charged on buy and on sell |
| `TAKE_PROFIT_PCT` | `60` | Sell at this gain |
| `STOP_LOSS_PCT` | `25` | Sell at this loss |
| `TRAILING_ARM_PCT` | `20` | Gain needed before the trailing stop starts |
| `TRAILING_STOP_PCT` | `15` | Sell after this drop from the peak |
| `MAX_HOLD_MIN` | `180` | Sell after this many minutes |
| `LIQUIDITY_PULL_PCT` | `50` | Sell if pool liquidity drops this much |
| `COOLDOWN_MIN` | `360` | Wait before buying the same token again |
| `MIN_LIQUIDITY_USD` | `25000` | Minimum pool liquidity |
| `MIN_VOLUME_H1_USD` | `20000` | Minimum 1-hour volume |
| `MIN_TXNS_H1` | `60` | Minimum trades in the last hour |
| `MIN_AGE_MIN` | `20` | Skip pools younger than this |
| `MAX_AGE_HOURS` | `72` | Skip pools older than this |
| `MAX_FDV_TO_LIQUIDITY` | `40` | Skip if valuation is this many times the pool |
| `MAX_PUMP_H1_PCT` | `150` | Skip if it already rose this much in 1 hour |
| `MIN_SCORE` | `60` | Minimum score to buy |
| `RUGCHECK` | `on` | `off` to skip the RugCheck safety check |
| `MAX_RUG_RISK_SCORE` | `50` | RugCheck normalised risk score limit |

## Honest limits

- **Paper fills are optimistic.** Real memecoin trades can slip far more than
  1.5%, and stop losses fill below the trigger in a fast dump. The bot only
  sees prices once per scan.
- **DexScreener data lags** on-chain trades by seconds. Snipers and insiders
  will always be faster.
- **Most memecoins go to zero.** Treat good paper results with suspicion until
  the edge check holds up over many trades.
- Live trading (a real wallet swapping through Jupiter) is not built in.
