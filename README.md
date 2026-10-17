# Memecoin Demo Bot

A Solana memecoin trading bot with a web dashboard. It watches new and
trending tokens on DexScreener, filters out likely rugs, scores the rest, and
trades them with a **demo fund**: real prices, the real strategy, and each
buy and sell priced with a real Jupiter swap quote for that exact size. No
wallet, no private key, no real money. Live trading is not built, and the
server refuses to start with any `TRADING_MODE` other than `demo`.

Run it for a few weeks. The dashboard's **Ready for real money?** checklist
turns green only when all of these hold: 50+ closed trades, 14+ days running,
positive average trade after costs, the edge check says "likely real edge",
worst drawdown under 30%, and 80%+ of trades priced with real Jupiter quotes.
Most memecoin strategies never get there.

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
6. **Price the demo buy** with a Jupiter quote (USDC → token) for the exact
   size, plus 0.5% for network fees. If the swap would lose more than 8% to
   price impact, it skips the token. When selling, it quotes the exact token
   amount back to USDC. Quotes are read-only; nothing is signed or sent.

7. **Grok second opinion** (optional, needs `XAI_API_KEY`). Grok searches X
   for the token's contract address and ticker and judges the crowd: organic
   community or bots, paid shills, rug or scam reports, hype rising or fading.
   It answers buy or skip with a confidence. In `veto` mode a skip, or a buy
   under 60% confidence, blocks the trade. Grok never sizes trades or changes
   exits. The bot follows every coin Grok blocked for 3 hours, so the
   dashboard shows whether Grok's calls saved money or cost it.

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
npm run dev        # fake market, flat costs, scans every 3 s, http://localhost:3000
npm start          # real Solana data, RugCheck and Jupiter quotes
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
| `TRADING_MODE` | `demo` | Only `demo` exists; anything else refuses to start |
| `JUPITER_FILLS` | `on` | Price demo buys and sells with real Jupiter quotes |
| `JUPITER_BASE_URL` | `https://lite-api.jup.ag/swap/v1` | Jupiter quote API |
| `EXTRA_COST_PER_SIDE_PCT` | `0.5` | Network and priority fees on top of the quote |
| `MAX_ENTRY_SLIPPAGE_PCT` | `8` | Skip a buy that would lose more than this on entry |
| `REQUIRE_REAL_FILLS` | `on` | `off` = use the flat cost when Jupiter fails, instead of skipping |
| `COST_PER_SIDE_PCT` | `1.5` | Flat cost per side when Jupiter is off, and for valuing open positions |
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
| `XAI_API_KEY` | (empty) | xAI API key. Turns on the Grok check |
| `GROK_MODE` | `veto` with a key, else `off` | `veto` = can block buys, `advise` = only records its view, `off` |
| `GROK_MODEL` | `grok-4.7` | xAI model name |
| `GROK_MIN_CONFIDENCE` | `60` | Veto mode: a buy needs at least this confidence |
| `GROK_MAX_CHECKS_PER_SCAN` | `2` | Caps Grok calls (cost and time) per scan |
| `MAX_RUG_RISK_SCORE` | `50` | RugCheck normalised risk score limit |

## Honest limits

- **Demo fills are still a bit optimistic.** A Jupiter quote is what the swap
  would get at that moment; a real swap lands a second or two later, and in a
  fast dump the stop loss fills below the trigger. The bot only sees prices
  once per scan.
- **DexScreener data lags** on-chain trades by seconds. Snipers and insiders
  will always be faster.
- **Most memecoins go to zero.** Treat good paper results with suspicion until
  the edge check holds up over many trades.
- **Grok costs money per check** and each one can take up to a minute,
  because X search runs several rounds. Checks only happen for coins that
  already passed every other filter, at most 2 per scan, cached for 1 hour.
- **Grok can be wrong or fooled.** Shill campaigns are built to look organic.
  Judge it by the "Blocked, then dumped / pumped" numbers, not by its tone.
- Live trading (a real wallet swapping through Jupiter) is not built in.
