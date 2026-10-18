# Launch kit

Graphics live in `public/brand/` and are also served by the site at `/brand/...`.

| File | Size | Use |
|---|---|---|
| `x-avatar.png` | 400×400 (2x) | X / Telegram profile picture |
| `x-header.png` | 1500×500 (2x) | X header. The bottom-left corner sits behind the profile picture on X, so keep that area empty |
| `launch-post.png` | 1600×900 (2x) | First post image, with the CA box |
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

Always copy the CA from the deploy transaction, never retype it. Check the
rendered image character by character before posting.

## First post (draft)

> Near Social is live 🟢
>
> The social network for NEAR traders where every profit is real:
> holdings, PnL and trades read straight from the chain. No screenshots.
>
> • Real on-chain PnL on every profile
> • Copy trades from top traders, you approve every swap
> • Tip any NEAR token, posts show $ received
>
> CA: YOUR_CONTRACT
> App: https://YOUR-SITE
>
> Community project, not affiliated with NEAR Foundation. Not financial advice. DYOR.

Before posting: double-check the CA, and say clearly what the token does or
does not do in the app (right now the app does not use it for anything).
