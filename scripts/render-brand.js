// Renders the social-media graphics in public/brand/ to PNG files.
//
//   npx -y playwright@1.56.1 install chromium   (once, if you have no browser)
//   node scripts/render-brand.js --ca=token.near --url=https://your-site.app
//
// Needs the site running locally (npm run dev) or pass --base=https://your-site.app.
// Writes public/brand/x-avatar.png, x-header.png, launch-post.png, og.png and the
// thread images thread-2-how-it-works.png and thread-3-safety.png.

const path = require('path');

const arg = (name, fallback = '') => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=') || fallback;

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }
  const base = arg('base', 'http://localhost:3000').replace(/\/$/, '');
  const q = new URLSearchParams();
  if (arg('ca')) q.set('ca', arg('ca'));
  if (arg('url')) q.set('url', arg('url'));
  const jobs = [
    ['avatar.html', 'x-avatar.png', 400, 400],
    ['header.html', 'x-header.png', 1500, 500],
    [`launch.html?${q}`, 'launch-post.png', 1600, 900],
    ['og.html', 'og.png', 1200, 630],
    ['thread-how.html', 'thread-2-how-it-works.png', 1600, 900],
    ['thread-safety.html', 'thread-3-safety.png', 1600, 900],
  ];
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  for (const [src, out, w, h] of jobs) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${base}/brand/${src}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const file = path.join(__dirname, '..', 'public', 'brand', out);
    await page.locator('#art').screenshot({ path: file });
    console.log('wrote', path.relative(process.cwd(), file));
  }
  await browser.close();
})();
