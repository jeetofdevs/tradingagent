// Sign in with a NEAR wallet using NEP-413 (signMessage).
//
// 1. The server issues a message, a random 32-byte nonce and a recipient.
// 2. The wallet signs them (no transaction, nothing is spent) and returns
//    { accountId, publicKey, signature }.
// 3. The server checks the ed25519 signature over the NEP-413 payload, then
//    asks the NEAR RPC that publicKey is a FULL ACCESS key of accountId.
//    Without step 3 anyone could claim any account name.

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

// NEAR account IDs: named (alice.near, app.tg) or implicit (64 hex chars).
const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
function isAccountId(id) {
  return typeof id === 'string' && id.length >= 2 && id.length <= 64 && ACCOUNT_RE.test(id);
}

const NEP413_TAG = 2147483648 + 413;

function borshString(s) {
  const bytes = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
}

// sha256 of the NEP-413 payload: tag, then borsh { message, nonce[32], recipient, callbackUrl? }.
function nep413Hash({ message, nonce, recipient, callbackUrl = null }) {
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(NEP413_TAG);
  const parts = [tag, borshString(message), Buffer.from(nonce), borshString(recipient)];
  parts.push(callbackUrl == null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), borshString(callbackUrl)]));
  return crypto.createHash('sha256').update(Buffer.concat(parts)).digest();
}

function decodePublicKey(publicKey) {
  const [type, data] = String(publicKey).split(':');
  if (type !== 'ed25519' || !data) throw new Error('Only ed25519 keys are supported');
  const raw = base58Decode(data);
  if (raw.length !== 32) throw new Error('Bad public key');
  return raw;
}

function decodeSignature(signature) {
  let sig = Buffer.from(String(signature), 'base64');
  if (sig.length !== 64) sig = base58Decode(String(signature)); // a few wallets use base58
  if (sig.length !== 64) throw new Error('Bad signature');
  return sig;
}

function verifyNep413({ publicKey, signature, message, nonce, recipient, callbackUrl }) {
  const key = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: decodePublicKey(publicKey).toString('base64url') }, format: 'jwk' });
  return crypto.verify(null, nep413Hash({ message, nonce, recipient, callbackUrl }), key, decodeSignature(signature));
}

const CHALLENGE_TTL_MS = 10 * 60000;

function createAuth({ db, near, appName, secret, now = () => Date.now() }) {
  const sessionSecret = secret || crypto.randomBytes(32).toString('hex');
  const insertNonce = db.prepare('INSERT INTO nonces (nonce, recipient, message, expires_at) VALUES (?, ?, ?, ?)');
  const takeNonce = db.prepare('DELETE FROM nonces WHERE nonce = ? RETURNING recipient, message, expires_at');
  const purge = db.prepare('DELETE FROM nonces WHERE expires_at < ?');

  function challenge(host) {
    purge.run(now());
    const nonce = crypto.randomBytes(32).toString('base64');
    const recipient = String(host || appName).slice(0, 100);
    const message = `Sign in to ${appName}\n\nThis proves you own this NEAR account. It is not a transaction and costs nothing.\n\nIssued: ${new Date(now()).toISOString()}`;
    insertNonce.run(nonce, recipient, message, now() + CHALLENGE_TTL_MS);
    return { nonce, message, recipient };
  }

  // Returns the account ID on success, throws on failure. Nonces are single use.
  async function verify({ nonce, accountId, publicKey, signature, callbackUrl }) {
    const row = takeNonce.get(String(nonce || ''));
    if (!row || row.expires_at < now()) throw new Error('Sign-in request expired. Try again.');
    if (!isAccountId(accountId)) throw new Error('Not a valid NEAR account');
    const base = { publicKey, signature, message: row.message, nonce: Buffer.from(nonce, 'base64'), recipient: row.recipient };
    // Browser wallets (MyNearWallet) include the callback URL in what they sign; extensions do not.
    let ok = false;
    for (const cb of [null, typeof callbackUrl === 'string' ? callbackUrl : null]) {
      try {
        if (verifyNep413({ ...base, callbackUrl: cb })) ok = true;
      } catch {
        // try the next form
      }
      if (ok || cb === null && !callbackUrl) break;
    }
    if (!ok) throw new Error('Signature check failed');
    const permission = await near.accessKeyPermission(accountId, publicKey);
    if (permission !== 'FullAccess') throw new Error('That key is not a full-access key of this account');
    return accountId;
  }

  // Stateless session token: base64url(account).expiry.hmac
  const SESSION_MS = 30 * 24 * 60 * 60000;
  const mac = (data) => crypto.createHmac('sha256', sessionSecret).update(data).digest('base64url');

  function issueSession(accountId) {
    const data = `${Buffer.from(accountId).toString('base64url')}.${now() + SESSION_MS}`;
    return `${data}.${mac(data)}`;
  }

  function readSession(token) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [acc, expiry, given] = parts;
    const a = Buffer.from(given);
    const b = Buffer.from(mac(`${acc}.${expiry}`));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    if (Number(expiry) < now()) return null;
    const accountId = Buffer.from(acc, 'base64url').toString();
    return isAccountId(accountId) ? accountId : null;
  }

  return { challenge, verify, issueSession, readSession, sessionMaxAgeMs: SESSION_MS };
}

module.exports = { createAuth, isAccountId, nep413Hash, verifyNep413, base58Encode, base58Decode };
