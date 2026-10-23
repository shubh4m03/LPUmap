/**
 * WebGL capability probe. MapLibre cannot render anything without WebGL, so
 * the app uses this to decide between the map and its list-based fallback.
 *
 * MapLibre GL JS 6 creates only a WebGL2 context (it throws on a WebGL1-only
 * browser), so a WebGL1 context does not count as support: reporting it would
 * promise a map that then fails to start.
 */

let cached: boolean | null = null;

function probe(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    // Release the probe context immediately so it does not count towards the browser's context limit.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** True when a WebGL2 context (what MapLibre GL JS 6 requires) can be created. The result is cached. */
export function supportsWebGL(): boolean {
  if (cached === null) cached = probe();
  return cached;
}

/** Clears the cached probe result (tests only). */
export function resetWebGLSupportCache(): void {
  cached = null;
}
