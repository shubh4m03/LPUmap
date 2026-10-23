import { useEffect, useState } from 'react';
import { z } from 'zod';
import { DATA_FILES, defaultDataBaseUrl } from '../../data/index.ts';

/** The parts of public/data/quality-report.json the About panel summarises. */
const qualitySchema = z.object({
  importantCategories: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      total: z.number().int().nonnegative(),
      onCampus: z.number().int().nonnegative(),
      status: z.string(),
    }),
  ),
  notes: z.array(z.string()).optional(),
});

export type QualityReport = z.infer<typeof qualitySchema>;

export type QualityState =
  { status: 'loading' } | { status: 'ready'; report: QualityReport } | { status: 'error'; message: string };

/**
 * Fetches the dataset's quality report lazily (only while the About panel is
 * open). It is a first-party file from the same origin and is precached for
 * offline use; failure is reported, never papered over.
 */
export function useQualityReport(fetchImpl: typeof fetch = fetch): QualityState {
  const [state, setState] = useState<QualityState>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    fetchImpl(`${defaultDataBaseUrl()}${DATA_FILES.quality}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = qualitySchema.safeParse(await res.json());
        if (!parsed.success) throw new Error('unexpected format');
        setState({ status: 'ready', report: parsed.data });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const reason = err instanceof Error ? err.message : 'unknown error';
        setState({ status: 'error', message: `The data quality report could not be loaded (${reason}).` });
      });
    return () => controller.abort();
  }, [fetchImpl]);
  return state;
}
