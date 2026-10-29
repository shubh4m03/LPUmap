/**
 * Isometric check: the open draft drawn by the real isometric overview
 * (the same faces as Realistic 3D, S1), merged exactly as the public app
 * would after publishing — so an off-campus or held-for-review footprint is
 * reported, not drawn. Preview only: nothing is saved or published.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/index.ts';
import { IsoView } from '../../isometric/index.ts';
import type { IsoController } from '../../isometric/index.ts';
import { isoStudioModel } from '../../isometric/studio.ts';
import type { StudioRenderModel } from '../../building-studio/index.ts';
import { currentDraft } from '../../building-studio/editor.ts';
import { isoPreview } from '../../building-studio/ui/index.ts';
import { previewFootprint } from '../../building-studio/ui/index.ts';
import type { BoundaryReviewFile, CampusData } from '../../data/index.ts';
import { useStudioServices, useStudioState } from './studio-context.ts';

const PADDING = { top: 16, right: 16, bottom: 16, left: 16 };

export interface IsoCheckProps {
  data: CampusData;
  studioModels: readonly StudioRenderModel[];
  review: BoundaryReviewFile | null;
  theme: 'light' | 'dark';
  reducedMotion: boolean;
  onClose(): void;
}

export function IsoCheck({ data, studioModels, review, theme, reducedMotion, onClose }: IsoCheckProps) {
  const { baseFootprint } = useStudioServices();
  const v = useStudioState((s) => ({
    draft: currentDraft(s.editor),
    recordId: s.editor.head?.id ?? null,
    targetId: s.editor.targetId,
  }));
  const result = useMemo(() => {
    if (!v.draft) return null;
    const base = v.targetId ? baseFootprint(v.targetId) : null;
    const fp = previewFootprint(v.draft.model, base);
    if (!fp.ok) return { ok: false as const, message: `No footprint can be derived: ${fp.message}` };
    return isoPreview({
      data,
      draft: v.draft,
      recordId: v.recordId,
      targetId: v.targetId,
      footprint: fp.footprint,
      areaM2: fp.areaM2,
      ...(review ? { reviewSections: review.sections, curatedDecisions: review.decisions } : {}),
    });
  }, [v.draft, v.recordId, v.targetId, data, review, baseFootprint]);

  const models = useMemo(() => {
    if (!result?.ok) return [];
    const others = studioModels.filter((m) => m.publicId !== result.publicId);
    return [...others, ...result.models].map((m) =>
      isoStudioModel(m, { baseFootprint: m.footprint.coordinates }),
    );
  }, [result, studioModels]);

  const [controller, setController] = useState<IsoController | null>(null);
  const onReady = useCallback((c: IsoController) => setController(c), []);
  const anchor = v.draft?.model.anchor ?? null;
  const publicId = result?.ok ? result.publicId : null;
  useEffect(() => {
    if (controller && anchor) controller.flyTo(anchor, 18);
    // Only when the check opens or another building is checked, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, publicId]);

  return (
    <section
      aria-label="Isometric check"
      data-testid="studio-iso-check"
      className="absolute inset-2 z-(--ds-z-panels) flex flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-3"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="flex-1 text-sm font-semibold">Isometric check (preview only, not published)</h2>
        <Button size="sm" variant="ghost" icon="close" onClick={onClose}>
          Close
        </Button>
      </header>
      {result && !result.ok ? (
        <p role="status" className="p-4 text-sm text-warning">
          {result.message}
        </p>
      ) : null}
      {result?.ok ? (
        <div className="relative min-h-0 flex-1">
          <IsoView
            data={result.data}
            studioModels={models}
            theme={theme}
            reducedMotion={reducedMotion}
            showLabels
            selectedId={result.publicId}
            route={null}
            padding={PADDING}
            onSelect={noop}
            onReady={onReady}
          />
        </div>
      ) : null}
    </section>
  );
}

function noop(): void {}
