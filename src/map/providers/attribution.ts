/**
 * Attribution text for imagery providers. MapLibre's attribution control takes
 * HTML, so provider parts are escaped here and only https links survive; the
 * React notice renders the same parts as text nodes.
 */
import type { LngLat } from '../../data/index.ts';
import type { AttributionPart, ImageryProvider, ProviderAttribution } from './types.ts';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The href when it is an absolute https URL, else null (never javascript:, data: or relative). */
export function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function partHtml(part: AttributionPart): string {
  const href = safeHref(part.href);
  const text = escapeHtml(part.text);
  return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
}

/**
 * One line for MapLibre's attribution control. The "Powered by" fragment and
 * the link right after it are joined with a space; other parts with " | ".
 */
export function attributionHtml(attribution: ProviderAttribution): string {
  const out: string[] = [];
  let glue = false;
  for (const part of attribution.parts) {
    const html = partHtml(part);
    if (glue && out.length > 0) out[out.length - 1] += html;
    else out.push(html);
    glue = /\s$/.test(part.text) && !part.href;
  }
  return out.join(' | ');
}

/** Plain-text form (tests, screen readers, copy). */
export function attributionText(attribution: ProviderAttribution): string {
  const out: string[] = [];
  let glue = false;
  for (const part of attribution.parts) {
    if (glue && out.length > 0) out[out.length - 1] += part.text;
    else out.push(part.text);
    glue = /\s$/.test(part.text) && !part.href;
  }
  return out.join(' | ');
}

/**
 * The capture-date sentence for the current view, only where it was verified;
 * elsewhere an honest "not verified" line; null when the provider has no date.
 */
export function imageryDateLine(provider: ImageryProvider, center: LngLat | null): string | null {
  const date = provider.imageryDate;
  if (!date) return null;
  const [w, s, e, n] = date.verifiedBounds;
  const inside = center !== null && center[0] >= w && center[0] <= e && center[1] >= s && center[1] <= n;
  return inside ? date.statement : 'Capture date not verified for this part of the map.';
}
