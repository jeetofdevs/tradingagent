// Browser stand-in for Node's util.format (used by a schema helper).
export function format(f, ...args) {
  let i = 0;
  return String(f).replace(/%[sdj%]/g, (m) => (m === '%%' ? '%' : m === '%j' ? JSON.stringify(args[i++]) : String(args[i++])));
}
export default { format };
