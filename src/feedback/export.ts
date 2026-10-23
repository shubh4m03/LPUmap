/**
 * User-initiated export of a correction report. Nothing is sent anywhere:
 * the text goes to the clipboard or a local file.
 */

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  try {
    area.select();
    // Deprecated, but the only fallback where the async Clipboard API is unavailable.
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/** Resolves true only when the text reached the clipboard. */
export async function copyText(text: string): Promise<boolean> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or insecure context: try the legacy path.
    }
  }
  return legacyCopy(text);
}

/** Restricts a download name to safe characters and ensures a .txt extension. */
export function safeFilename(name: string): string {
  const base = name
    .replace(/\.txt$/i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return `${base || 'correction'}.txt`;
}

/** Triggers a local download of a UTF-8 text file. Returns false if the browser cannot. */
export function downloadText(filename: string, text: string): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  try {
    const href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = safeFilename(filename);
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoke after the click has been handled so the download is not cancelled.
    setTimeout(() => URL.revokeObjectURL(href), 0);
    return true;
  } catch {
    return false;
  }
}
