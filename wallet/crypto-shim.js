// Browser stand-in for Node's crypto.randomBytes (used by HERE wallet).
import { Buffer } from 'buffer';
export function randomBytes(n) {
  return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n)));
}
export default { randomBytes };
