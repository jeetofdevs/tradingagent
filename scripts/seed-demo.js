// Fills a local database with sample people, posts and trades so the site
// can be previewed without real wallets. Usage: DATA_DIR=./data npm run seed
const crypto = require('crypto');
const { openDb } = require('../src/db');
const { base58Encode } = require('../src/auth');

const db = openDb(process.env.DATA_DIR || './data');
const now = Date.now();
const people = [
  ['ansem-jr.near', 'Ansem Jr', 'Early on everything. Mostly wrong, sometimes very right.', 'ansemjr'],
  ['trenchqueen.near', 'Trench Queen', 'NEAR memecoin researcher. Check holders before you ape.', 'trenchqueen'],
  ['neardegen.tg', 'NEAR Degen', 'HOT wallet maxi. Paper hands, diamond heart.', ''],
  ['blackdragon-fan.near', 'Dragon Rider', '', 'dragonrider'],
].map(([wallet, name, bio, x]) => ({ wallet, name, bio, x }));
const insUser = db.prepare('INSERT OR IGNORE INTO users (wallet, name, bio, x_handle, created_at, backfilled) VALUES (?, ?, ?, ?, ?, 1)');
people.forEach((p, i) => insUser.run(p.wallet, p.name, p.bio, p.x, now - (30 - i) * 86400000));

const tokens = [['blackdragon.tkn.near', 'BLACKDRAGON', 'Black Dragon'], ['token.lonkingnearsucks.near', 'LONK', 'Lonk'], ['ftv2.nekotoken.near', 'NEKO', 'Neko']];
const insTok = db.prepare('INSERT OR IGNORE INTO tokens (mint, symbol, name, decimals, updated_at) VALUES (?, ?, ?, 18, ?)');
tokens.forEach(([m, s, n]) => insTok.run(m, s, n, now));

const insTrade = db.prepare('INSERT OR IGNORE INTO trades VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
const insPost = db.prepare('INSERT INTO posts (author, kind, body, ref_post_id, trade_key, created_at) VALUES (?, ?, ?, ?, ?, ?)');
const hash = () => base58Encode(crypto.randomBytes(32));
let k = 0;
for (const p of people) {
  for (const [mint] of tokens) {
    const t = now - (k += 1) * 23 * 60000;
    const near = +(2 + Math.random() * 30).toFixed(2);
    const h1 = hash();
    insTrade.run(h1, p.wallet, mint, 'buy', 1000000 * near, 'NEAR', near, near * 5, near * 5 / (1000000 * near), t);
    insPost.run(p.wallet, 'trade', '', null, `${h1}:${mint}`, t);
    if (k % 2) {
      const out = +(near * (0.6 + Math.random() * 1.4)).toFixed(2);
      const h2 = hash();
      insTrade.run(h2, p.wallet, mint, 'sell', 1000000 * near, 'NEAR', out, out * 5, out * 5 / (1000000 * near), t + 9 * 60000);
      insPost.run(p.wallet, 'trade', '', null, `${h2}:${mint}`, t + 9 * 60000);
    }
  }
}
const first = insPost.run(people[1].wallet, 'post', 'Checked $BLACKDRAGON holders before buying: top 10 hold 21%, no mint function, liquidity on Ref. Sized small anyway. https://nearblocks.io', null, null, now - 40 * 60000).lastInsertRowid;
insPost.run(people[0].wallet, 'post', 'gm NEAR. Who is still holding $LONK from the first run? @trenchqueen.near you were early', null, null, now - 15 * 60000);
insPost.run(people[2].wallet, 'reply', 'This is the way. More people should do this.', first, null, now - 30 * 60000);
insPost.run(people[3].wallet, 'repost', '', first, null, now - 20 * 60000);
db.prepare('INSERT OR IGNORE INTO likes VALUES (?, ?, ?)').run(first, people[0].wallet, now);
db.prepare('INSERT OR IGNORE INTO follows VALUES (?, ?, ?)').run(people[0].wallet, people[1].wallet, now);
const insTip = db.prepare('INSERT OR IGNORE INTO tips (signature, from_wallet, to_wallet, post_id, token, symbol, amount, usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
insTip.run(hash(), people[0].wallet, people[1].wallet, first, 'near', 'NEAR', 2.5, 12.8, now);
insTip.run(hash(), people[2].wallet, people[1].wallet, first, 'blackdragon.tkn.near', 'BLACKDRAGON', 5000000000, 20.5, now);
console.log(`Seeded ${people.length} people. Example profile: #/u/${people[1].wallet}`);
