# Launch kit

Graphics live in `public/brand/` and are also served by the site at `/brand/...`.

| File | Size | Use |
|---|---|---|
| `x-avatar.png` | 400×400 (2x) | X / Telegram profile picture |
| `x-header.png` | 1500×500 (2x) | X header. The bottom-left corner sits behind the profile picture on X, so keep that area empty |
| `launch-post.png` | 1600×900 (2x) | First post image, with the CA box |
| `thread-2-how-it-works.png` | 1600×900 (2x) | Image for post 2 of the thread |
| `thread-3-safety.png` | 1600×900 (2x) | Image for post 3 of the thread |
| `og.png` | 1200×630 (2x) | Link preview when the site URL is shared |

## Put the real CA on the launch image

Option A, in a browser: open
`https://YOUR-SITE/brand/launch.html?ca=YOUR_CONTRACT&url=https://YOUR-SITE`
at a 1600×900 window and take a screenshot.

Option B, re-render all PNGs:

```bash
npm i -D playwright && npx playwright install chromium
npm run dev    # in another terminal
node scripts/render-brand.js --ca=YOUR_CONTRACT --url=https://YOUR-SITE
```

`launch-post.png` in this repo is already rendered with `--ca=social-2.nearlytrade.near --url=x.com/nearsocialfun`.

Always copy the CA from the deploy transaction, never retype it. Check the
rendered image character by character before posting.

## First post: a 3-post thread

Lengths checked against X's 280-character limit (emoji count as 2, links as 23).
With a short named CA (like `name.tkn.near`) the first post is about 236
characters. With a 64-character CA it is 281, so drop "No screenshots."

**Post 1** (attach `launch-post.png` with the real CA, then pin it)

```
Near Social is live 🟢

Where every NEAR trader's profit is real, read straight from the chain. No screenshots.

📊 On-chain PnL
🔁 Copy trades
💸 Tip any token

CA: YOUR_CA
🌐 https://YOUR-SITE

Community project. NFA
```

**Post 2** (reply to post 1, attach `thread-2-how-it-works.png`)

```
How it works 👇

1. Connect your NEAR wallet (signing a message, no fee)
2. Your holdings, profit & trade history fill in by themselves
3. Post, follow, copy the best traders, tip in any token

Every number comes from the chain, not from a screenshot.
```

**Post 3** (reply to post 2, attach `thread-3-safety.png`)

```
Safety first:

• Copy trading never touches your funds. You approve every swap
• Tips go wallet to wallet, verified on-chain
• Always copy the CA from this account only

Community project, not affiliated with NEAR Foundation. Not financial advice. DYOR.
```

**X bio** (127 of 160 characters)

```
The social network for NEAR traders. Real on-chain PnL, copy trades, tip any token. Community project, not NEAR Foundation. NFA
```

Before posting: copy the CA from the deploy transaction (never retype it),
check it on the image character by character, and say honestly what the
token does in the app (right now the app does not use it for anything).
