/** Compare plain wire or journal values without serializing their large strings. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a), right = Object.keys(b);
  if (left.length !== right.length) return false;
  return left.every(key => Object.hasOwn(b, key) && sameValue(Reflect.get(a, key), Reflect.get(b, key)));
}
