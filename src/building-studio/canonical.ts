/**
 * Canonical JSON: object keys sorted at every level and undefined members
 * dropped, so equal values always give equal strings (used for stable hashes,
 * value equality in the command stack and deterministic tie-breaks). Pure.
 */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(',')}}`;
  }
  if (typeof v === 'number' && Object.is(v, -0)) return '0';
  return JSON.stringify(v) ?? 'null';
}

/** Value equality of JSON-like data (key order ignored). */
export const jsonEqual = (a: unknown, b: unknown): boolean =>
  a === b || canonicalJson(a) === canonicalJson(b);
