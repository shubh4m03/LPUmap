/**
 * The published artwork manifest (public/isometric-art/manifest.json) for
 * the admin, through the shared loader (src/isometric-art/manifest-loader.ts).
 * Loaded once per page and shared; a failure is not cached and is shown as
 * an error with a retry, never as an empty list.
 */
import { useEffect, useState } from 'react';
import { loadIsometricArtManifest, type ManifestLoadResult } from '../../../isometric-art/manifest-loader.ts';
import type { IsometricArtManifest } from '../../../isometric-art/schema.ts';

let pending: Promise<ManifestLoadResult> | null = null;

export function loadAdminArtworkManifest(
  load: () => Promise<ManifestLoadResult> = () => loadIsometricArtManifest(),
): Promise<ManifestLoadResult> {
  if (!pending) {
    const p = load();
    pending = p;
    void p.then(
      (r) => {
        if (!r.ok && pending === p) pending = null;
      },
      () => {
        if (pending === p) pending = null;
      },
    );
  }
  return pending;
}

/** Test hook: forget the cached manifest. */
export function resetAdminArtworkManifest(): void {
  pending = null;
}

export const ARTWORK_MANIFEST_FAILED =
  'The illustration manifest could not be loaded, so the artwork items cannot be shown. Check your connection and try again.';

export type ArtworkManifestState =
  | { status: 'loading' }
  | { status: 'ready'; manifest: IsometricArtManifest }
  | { status: 'error'; message: string; retry(): void };

export function useArtworkManifest(): ArtworkManifestState {
  const [state, setState] = useState<ArtworkManifestState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const fail = () =>
      setState({
        status: 'error',
        message: ARTWORK_MANIFEST_FAILED,
        retry: () => {
          setState({ status: 'loading' });
          setAttempt((n) => n + 1);
        },
      });
    loadAdminArtworkManifest().then(
      (r) => {
        if (cancelled) return;
        if (r.ok) setState({ status: 'ready', manifest: r.manifest });
        else fail();
      },
      () => {
        if (!cancelled) fail();
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  return state;
}
