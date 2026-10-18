// Sign in with a Solana wallet: the server hands out a one-time message,
// the wallet signs it, the server checks the ed25519 signature. No
// passwords, and no transaction is involved.

const crypto = require('crypto');

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const INDEX = Object.fromEntries([...ALPHABET].map((c, i) => [c, i]));

function base58Decode(text) {
  if (typeof text !== 'string' || text.length === 0) throw new Error('empty base58');
  let n = 0n;
  for (const ch of text) {
    const v = INDEX[ch];
    if (v === undefined) throw new Error('bad base58 character');
    n = n * 58n + BigInt(v);
  }
  const bytes = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of text) {
    if (ch !== '1') break;
    bytes.unshift(0);
  }
  return Buffer.from(bytes);
}

function base58Encode(buf) {
  let n = BigInt(`0x${Buffer.from(buf).toString('hex') || '0'}`);
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

// A Solana wallet address is a base58 ed25519 public key (32 bytes).
function isWallet(text) {
  if (typeof text !== 'string' || text.length < 32 || text.length > 44) return false;
  try {
    return base58Decode(text).length === 32;
  } catch {
    return false;
  }
}

function verifySignature(wallet, message, signature) {
  const pub = base58Decode(wallet);
  // Strings are base64 (what the browser sends); bytes are used as is.
  const sig = typeof signature === 'string' ? Buffer.from(signature, 'base64') : Buffer.from(signature);
  if (pub.length !== 32 || sig.length !== 64) return false;
  const key = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: pub.toString('base64url') }, format: 'jwk' });
  return crypto.verify(null, Buffer.from(message, 'utf8'), key, sig);
}

const CHALLENGE_TTL_MS = 5 * 60000;

function createAuth({ db, appName, secret, now = () => Date.now() }) {
  const sessionSecret = secret || crypto.randomBytes(32).toString('hex');
  const insertNonce = db.prepare('INSERT INTO nonces (nonce, wallet, message, expires_at) VALUES (?, ?, ?, ?)');
  const takeNonce = db.prepare('DELETE FROM nonces WHERE nonce = ? RETURNING wallet, message, expires_at');
  const purge = db.prepare('DELETE FROM nonces WHERE expires_at < ?');

  function challenge(wallet, host) {
    if (!isWallet(wallet)) throw new Error('Not a valid Solana wallet address');
    purge.run(now());
    const nonce = crypto.randomBytes(16).toString('hex');
    const message = [
      `${appName} wants you to sign in with your Solana wallet:`,
      wallet,
      '',
      'This only proves you own the wallet. It is not a transaction and costs nothing.',
      '',
      `Site: ${host}`,
      `Nonce: ${nonce}`,
      `Issued: ${new Date(now()).toISOString()}`,
    ].join('\n');
    insertNonce.run(nonce, wallet, message, now() + CHALLENGE_TTL_MS);
    return { nonce, message };
  }

  // Returns the wallet on success, throws on failure. Nonces are single use.
  function verify(nonce, signature) {
    const row = takeNonce.get(String(nonce || ''));
    if (!row) throw new Error('Sign-in request expired. Try again.');
    if (row.expires_at < now()) throw new Error('Sign-in request expired. Try again.');
    let ok = false;
    try {
      ok = verifySignature(row.wallet, row.message, signature);
    } catch {
      ok = false;
    }
    if (!ok) throw new Error('Signature does not match this wallet');
    return row.wallet;
  }

  // Stateless session token: wallet.expiry.hmac
  const SESSION_MS = 30 * 24 * 60 * 60000;
  const mac = (data) => crypto.createHmac('sha256', sessionSecret).update(data).digest('base64url');

  function issueSession(wallet) {
    const data = `${wallet}.${now() + SESSION_MS}`;
    return `${data}.${mac(data)}`;
  }

  function readSession(token) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [wallet, expiry, given] = parts;
    const expected = mac(`${wallet}.${expiry}`);
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    if (Number(expiry) < now()) return null;
    return wallet;
  }

  return { challenge, verify, issueSession, readSession, sessionMaxAgeMs: SESSION_MS };
}

module.exports = { createAuth, base58Decode, base58Encode, isWallet, verifySignature };
