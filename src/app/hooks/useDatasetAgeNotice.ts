import { useEffect } from 'react';
import { useToast } from '../../components/ui/index.ts';
import { useAtlas } from '../data/atlas-context.ts';
import { datasetAge, datasetAgeWarning } from '../data/dataset-age.ts';

/** Shown at most once per page load, however often the shell re-mounts. */
let shown = false;

/** Test seam. */
export function resetDatasetAgeNotice(): void {
  shown = false;
}

/** At start-up: a warning toast when the dataset is older than APP_CONFIG.cache.datasetStaleDays (G-18). */
export function useDatasetAgeNotice(): void {
  const { data } = useAtlas();
  const toast = useToast();
  const builtFrom = data.manifest.builtFrom;
  useEffect(() => {
    if (shown) return;
    const message = datasetAgeWarning(datasetAge(builtFrom));
    if (!message) return;
    shown = true;
    toast.show({ message, tone: 'warning', durationMs: 12000 });
  }, [builtFrom, toast]);
}
