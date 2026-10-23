/** Suspicious-change detection against a previous manifest, and the opt-in website link check. */
import type { Manifest, Place } from '../../src/data/schema.ts';
import type { IssueSink } from './validate-geometry.ts';

export function checkCounts(current: Manifest, previous: Manifest, threshold: number, c: IssueSink): void {
  for (const [key, prev] of Object.entries(previous.counts)) {
    const cur = current.counts[key];
    if (cur === undefined) c.warn('count-missing', `count "${key}" disappeared (was ${prev})`);
    else if (prev > 0 && Math.abs(cur - prev) / prev > threshold) {
      c.warn('count-change', `count "${key}" changed ${prev} → ${cur} (> ${Math.round(threshold * 100)}%)`);
    } else if (prev === 0 && cur > 0 && key.startsWith('graph:')) {
      c.warn('count-change', `count "${key}" changed 0 → ${cur}`);
    }
  }
}

export async function checkLinks(
  places: Place[],
  opts: { fetchImpl: typeof fetch; timeoutMs?: number },
  c: IssueSink,
): Promise<void> {
  const urls = [...new Set(places.flatMap((p) => (p.contact?.website ? [p.contact.website] : [])))].sort();
  for (const url of urls) {
    try {
      const res = await opts.fetchImpl(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10000),
      });
      if (!res.ok) c.warn('link', `${url} answered HTTP ${res.status}`);
    } catch (e) {
      c.warn('link', `${url} unreachable: ${(e as Error).message}`);
    }
  }
}
