// Node globals some wallet packages expect in the browser.
import { Buffer } from 'buffer';
export { Buffer };
export const process = { env: { NODE_ENV: 'production' }, browser: true, version: '', nextTick: (fn, ...a) => Promise.resolve().then(() => fn(...a)) };
