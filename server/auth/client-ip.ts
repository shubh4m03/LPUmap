/**
 * Canonical client key for rate limiting, derived from CF-Connecting-IP.
 *
 * - IPv4: dotted quad with leading zeros removed.
 * - IPv4-mapped IPv6 (::ffff:a.b.c.d, ::ffff:xxxx:xxxx): the IPv4.
 * - Other IPv6: the /64 prefix — a single subscriber usually owns a whole /64,
 *   so per-address buckets would let one client rotate through 2^64 addresses.
 * Anything unparsable is lower-cased and kept as-is (still one bucket).
 * Raw addresses never leave this module except as HMAC input.
 */

function canonicalIpv4(s: string): string | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => !Number.isInteger(n) || n > 255)) return null;
  return nums.join('.');
}

/** Expands an IPv6 address to 8 numeric groups; null when malformed. */
function ipv6Groups(s: string): number[] | null {
  let text = s;
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(':');
  if (text.includes('.', lastColon)) {
    const v4 = canonicalIpv4(text.slice(lastColon + 1));
    if (!v4) return null;
    const [a, b, c, d] = v4.split('.').map(Number) as [number, number, number, number];
    tail = [(a << 8) | b, (c << 8) | d];
    text = `${text.slice(0, lastColon + 1)}x`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (h: string): number[] | null => {
    if (h === '') return [];
    const out: number[] = [];
    for (const g of h.split(':')) {
      if (g === 'x') continue;
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  if (!head || !rest) return null;
  const explicit = head.length + rest.length + tail.length;
  if (halves.length === 1) {
    return explicit === 8 ? [...head, ...tail] : null;
  }
  if (explicit > 7) return null;
  return [...head, ...new Array<number>(8 - explicit).fill(0), ...rest, ...tail];
}

export function canonicalClient(raw: string): string {
  const s = raw.trim().toLowerCase();
  const v4 = canonicalIpv4(s);
  if (v4) return v4;
  if (!s.includes(':')) return s;
  const groups = ipv6Groups(s.replace(/%.*$/, ''));
  if (!groups) return s;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [hi, lo] = [groups[6]!, groups[7]!];
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}
