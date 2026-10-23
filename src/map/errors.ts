/** Human-readable map failure messages. Never include coordinates or raw URLs. */

export const MAP_MESSAGES = {
  webglUnavailable:
    'Your browser could not start the map (WebGL unavailable). Search and the place list still work without it.',
  contextLost:
    'The map’s graphics were interrupted by the browser (WebGL context lost). Reload the page if the map stays blank; search and the place list still work.',
  dataError: 'Some campus map data could not be drawn. Search and the place list still work.',
  styleError:
    'The map ran into a problem while drawing. Try reloading the page; search and the place list still work.',
} as const;

interface ErrorLike {
  error?: { message?: string; url?: string } | null;
  sourceId?: string;
}

/**
 * Maps a MapLibre `error` event to a message for the user, or null when the
 * error is not worth interrupting them for. A missing glyph range only blanks
 * characters outside the self-hosted ranges (see public/fonts/SOURCE.md).
 */
export function classifyMapError(ev: ErrorLike): string | null {
  const url = ev.error?.url ?? '';
  const message = ev.error?.message ?? '';
  if (url.includes('/fonts/') || /glyph/i.test(message)) return null;
  if (ev.sourceId) return MAP_MESSAGES.dataError;
  return MAP_MESSAGES.styleError;
}
