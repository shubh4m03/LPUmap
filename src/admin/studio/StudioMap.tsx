/**
 * The Studio map: the campus (with the current publication) in Realistic 3D
 * or 2D, plus the editing layer of the map-editing contract. While the
 * Studio is shown, map clicks NEVER select a place (they go to the editor);
 * a handle drag suspends pan/rotate; leaving the Studio unmounts all of it.
 *
 *  - the model being edited is drawn by the studio custom layer as a
 *    translucent preview (its published copy and its old extrusion are left
 *    out meanwhile, so nothing is drawn twice);
 *  - desktop: handles + click-to-place; mobile: a centre reticle while
 *    placing, step buttons afterwards;
 *  - choosing the access point on the map: the valid path nodes are drawn,
 *    handles are hidden and a click only lists the nodes near it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon, useNoticeToast } from '../../components/ui/index.ts';
import { MapView, type MapController } from '../../map/index.ts';
import type { EditPointerEvent, HandleDragEvent, MapEditingProps } from '../../map/editing/index.ts';
import type { StudioRenderModel } from '../../building-studio/index.ts';
import { currentDraft } from '../../building-studio/editor.ts';
import type { CampusData, DetectionsFile, LngLat } from '../../data/index.ts';
import type { ModelConfigV1 } from '../../building-studio/index.ts';
import { applyHandleDrag, editHandles, type HandleSet } from '../../building-studio/ui/index.ts';
import { previewCollection, previewRenderSource } from '../../building-studio/ui/index.ts';
import { currentValidation } from '../../building-studio/ui/index.ts';
import { nearestDetection } from '../../building-studio/ui/index.ts';
import { accessPickFeatures, useStudioAccessCandidates } from './access-pick-data.ts';
import { useStudioServices, useStudioState } from './studio-context.ts';
import '../../app/maplibre-worker.ts';

const NO_GROUPS = new Set<never>();

export interface PickedBuilding {
  id: string;
  label: string;
  kind: 'studio' | 'base';
}

export interface StudioMapProps {
  data: CampusData;
  studioModels: readonly StudioRenderModel[];
  theme: 'light' | 'dark';
  reducedMotion: boolean;
  mode3d: boolean;
  showGuides: boolean;
  detections: DetectionsFile | null;
  onPick(b: PickedBuilding | null): void;
  onController(c: MapController | null): void;
  onFatal(message: string): void;
}

const HANDLES_FOR_TOOL: Readonly<Record<string, HandleSet>> = {
  select: 'all',
  add: 'move',
  move: 'move',
  rotate: 'rotate',
  resize: 'resize',
  appearance: 'none',
  info: 'none',
};

export function StudioMap(props: StudioMapProps) {
  const { store, isMobile, baseFootprint } = useStudioServices();
  const { data, studioModels } = props;
  const v = useStudioState((s) => ({
    placement: s.editor.placement,
    model: s.editor.placement?.model ?? currentDraft(s.editor)?.model ?? null,
    open: s.editor.history !== null,
    tool: s.editor.tool,
    archived: s.editor.head?.status === 'archived',
    targetId: s.editor.placement?.targetId ?? s.editor.targetId,
    recordId: s.editor.head?.id ?? null,
    invalid: (currentValidation(s)?.errorCount ?? 0) > 0,
    proposal: s.proposal?.model ?? null,
    issues: currentValidation(s)?.issues ?? null,
    selectedId: s.editor.selectedId,
    pick: s.accessPick,
    accessNodeId: currentDraft(s.editor)?.accessNodeId ?? null,
  }));
  const accessCandidates = useStudioAccessCandidates();
  const picking = v.pick !== null && accessCandidates !== null;
  const editingPublicId = v.open || v.placement ? (v.targetId ?? v.recordId) : null;
  const base = useMemo(() => (v.targetId ? baseFootprint(v.targetId) : null), [v.targetId, baseFootprint]);

  // Leave the edited building's own published model and old extrusion out while it is open.
  const shownData = useMemo<CampusData>(() => {
    if (!editingPublicId) return data;
    return {
      ...data,
      buildings: {
        ...data.buildings,
        features: data.buildings.features.filter((f) => f.properties.id !== editingPublicId),
      },
    };
  }, [data, editingPublicId]);
  const shownModels = useMemo(
    () => (editingPublicId ? studioModels.filter((m) => m.publicId !== editingPublicId) : studioModels),
    [studioModels, editingPublicId],
  );

  const guide = useMemo(
    () =>
      props.showGuides && props.detections && v.model ? nearestDetection(props.detections, v.model) : null,
    [props.showGuides, props.detections, v.model],
  );
  const warningOutlines = useMemo(() => {
    if (!v.issues) return [];
    const ids = new Set(
      v.issues
        .filter(
          (i) =>
            i.code === 'overlap-base-building' ||
            i.code === 'overlap-studio-building' ||
            i.code === 'possible-duplicate',
        )
        .map((i) => i.data.id)
        .filter((id): id is string => typeof id === 'string'),
    );
    return data.buildings.features
      .filter((f) => ids.has(f.properties.id) && f.geometry.type === 'Polygon')
      .map((f) => ({ id: f.properties.id, coordinates: f.geometry.coordinates as LngLat[][] }));
  }, [v.issues, data.buildings]);

  const preview = useMemo(() => {
    if (!v.model) return null;
    const c = previewCollection({
      model: v.model,
      baseFootprint: base,
      invalid: v.invalid,
      proposal: v.proposal,
      guide,
      warnings: warningOutlines,
    });
    if (!picking || !accessCandidates) return c;
    return {
      ...c,
      features: [
        ...c.features,
        ...accessPickFeatures(accessCandidates, v.accessNodeId, v.pick?.click ?? null),
      ],
    };
  }, [
    v.model,
    base,
    v.invalid,
    v.proposal,
    guide,
    warningOutlines,
    picking,
    accessCandidates,
    v.accessNodeId,
    v.pick,
  ]);
  const previewModel = useMemo(
    () =>
      v.model
        ? previewRenderSource(v.model, {
            publicId: editingPublicId ?? 'studio-preview',
            recordId: v.recordId,
            baseFootprint: base,
          })
        : null,
    [v.model, editingPublicId, v.recordId, base],
  );
  const handleSet: HandleSet =
    v.placement && !v.open ? 'all' : v.open && !v.archived ? (HANDLES_FOR_TOOL[v.tool] ?? 'none') : 'none';
  const handles = useMemo(
    () => (v.model && !isMobile && !picking ? editHandles(v.model, handleSet) : []),
    [v.model, handleSet, isMobile, picking],
  );

  // Drag: every move recomputes from the model at drag start (one undo command per drag, S9).
  const dragBase = useRef<ModelConfigV1 | null>(null);
  const onHandleDrag = useCallback(
    (e: HandleDragEvent) => {
      const s = store.getState();
      const placing = s.editor.placement !== null && s.editor.history === null;
      if (e.phase === 'start') {
        dragBase.current = placing ? s.editor.placement!.model : (currentDraft(s.editor)?.model ?? null);
        if (!placing) store.dispatch({ type: 'gesture/begin', label: `Drag ${e.kind}` });
        return;
      }
      const baseModel = dragBase.current;
      if (!baseModel) return;
      if (e.phase === 'cancel') {
        if (placing) store.dispatch({ type: 'placement/update', model: baseModel });
        else store.dispatch({ type: 'gesture/cancel' });
        dragBase.current = null;
        return;
      }
      const next = applyHandleDrag(baseModel, e);
      if (placing) store.dispatch({ type: 'placement/update', model: next });
      else {
        const d = currentDraft(store.getState().editor);
        if (d) store.dispatch({ type: 'edit', draft: { ...d, model: next }, label: `Drag ${e.kind}` });
      }
      if (e.phase === 'end') {
        if (!placing) store.dispatch({ type: 'gesture/end' });
        dragBase.current = null;
      }
    },
    [store],
  );

  const { onPick } = props;
  const onPointer = useCallback(
    (e: EditPointerEvent) => {
      const s = store.getState();
      // Choosing the access point: a click only lists the valid nodes near it (never moves or selects).
      if (s.accessPick && s.editor.history) {
        store.setState({ accessPick: { click: [e.lngLat[0], e.lngLat[1]] } });
        return;
      }
      if (s.editor.placement && !s.editor.history) {
        store.dispatch({ type: 'placement/move', anchor: e.lngLat });
        return;
      }
      if (s.editor.tool !== 'select' || s.editor.dragging) return;
      const id = e.placeId;
      if (!id) {
        onPick(null);
        return;
      }
      const feature = data.buildings.features.find((f) => f.properties.id === id);
      const host = feature ? null : data.places.find((p) => p.id === id)?.buildingId;
      const fid = feature ? id : host;
      const f = fid ? data.buildings.features.find((x) => x.properties.id === fid) : undefined;
      if (!f) {
        onPick(null);
        return;
      }
      store.dispatch({ type: 'select', id: f.properties.id });
      onPick({
        id: f.properties.id,
        label: f.properties.name ?? f.properties.displayName,
        kind: f.properties.id.startsWith('stu:') ? 'studio' : 'base',
      });
    },
    [store, data, onPick],
  );

  const onReticleChange = useCallback(
    (center: LngLat) => {
      const s = store.getState();
      if (s.editor.placement && !s.editor.history) store.dispatch({ type: 'placement/move', anchor: center });
    },
    [store],
  );

  const editing = useMemo<MapEditingProps>(
    () => ({
      input: isMobile && v.placement && !v.open ? 'reticle' : 'pointer',
      preview,
      previewModel,
      handles,
      onPointer,
      onHandleDrag,
      onReticleChange,
    }),
    [isMobile, v.placement, v.open, preview, previewModel, handles, onPointer, onHandleDrag, onReticleChange],
  );

  const [problem, setProblem] = useState<string | null>(null);
  const onRenderNotice = useNoticeToast();
  const { onController, onFatal } = props;
  const onReady = useCallback((c: MapController) => onController(c), [onController]);
  useEffect(() => () => onController(null), [onController]);
  const onError = useCallback(
    (message: string) => {
      if (/webgl/i.test(message)) onFatal(message);
      else setProblem(message);
    },
    [onFatal],
  );

  return (
    <div className="relative h-full w-full" data-testid="studio-map">
      <MapView
        data={shownData}
        theme={props.theme}
        mode3d={props.mode3d}
        reducedMotion={props.reducedMotion}
        visibleGroups={NO_GROUPS}
        showLabels
        selectedPlaceId={v.open || v.placement ? null : v.selectedId}
        route={null}
        userLocation={null}
        studioModels={shownModels}
        studioOpen
        showDetectedFootprints={props.showGuides}
        detections={props.detections}
        onSelectPlace={noop}
        onReady={onReady}
        onError={onError}
        editing={editing}
        onRenderNotice={onRenderNotice}
      />
      {problem ? (
        <div
          role="alert"
          className="absolute inset-x-3 bottom-3 z-(--ds-z-controls) mx-auto flex max-w-md items-center gap-2 rounded-lg border border-border bg-surface-raised p-3 text-sm shadow-2"
        >
          <Icon name="warning" className="text-warning" />
          <p className="min-w-0 flex-1">{problem}</p>
          <Button size="sm" variant="ghost" onClick={() => setProblem(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function noop(): void {}
