/**
 * Building Studio (Creative Mode, owner spec B; docs/BUILDING_STUDIO_DESIGN.md).
 * /admin/studio            → the workspace (library, buildings, map)
 * /admin/studio/<stu:id>   → that record, loaded from the server (reload-safe)
 *
 * Desktop: level-editor layout — toolbar, collapsible library/buildings
 * panel, the map with handles, collapsible inspector. Mobile: the map with
 * a centre reticle while placing, large step buttons, a bottom-sheet
 * inspector and large Save / Cancel buttons.
 *
 * Guards: the state badge is always visible; a `beforeunload` prompt is
 * active while changes are unsaved, and unsaved edits are also kept in this
 * browser for crash recovery (cleared on save, discard and logout).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsMobile, useReducedMotion, useTheme } from '../../accessibility/index.ts';
import {
  BottomSheet,
  Button,
  Dialog,
  ErrorState,
  IconButton,
  SegmentedControl,
  Spinner,
} from '../../components/ui/index.ts';
import { cx } from '../../components/ui/cx.ts';
import { APP_CONFIG } from '../../config/index.ts';
import type { MapController } from '../../map/index.ts';
import type { MapControllerWithCamera } from '../../map/types.ts';
import { currentDraft, shouldGuardUnload } from '../../building-studio/editor-state.ts';
import { createStudioActions } from '../../building-studio/ui/actions.ts';
import { builtInLibraryItems, libraryItems } from '../../building-studio/ui/library.ts';
import {
  checkTarget,
  createStudioStore,
  currentValidation,
  useStudio,
} from '../../building-studio/ui/store.ts';
import type { TemplateDefinition } from '../../building-studio/schema.ts';
import type { BoundaryReviewFile, DetectionsFile, LngLat } from '../../data/index.ts';
import { describeAdminError } from '../api/errors.ts';
import { useAdminApi } from '../context.ts';
import type { AdminSectionProps } from '../sections/types.ts';
import { AssetBrowser } from './AssetBrowser.tsx';
import { StepControls } from './GeometryPanel.tsx';
import { Inspector } from './Inspector.tsx';
import { IsoCheck } from './IsoCheck.tsx';
import { PlacementBar } from './PlacementBar.tsx';
import { RecordList } from './RecordList.tsx';
import { StateBadge } from './StateBadge.tsx';
import { StudioBanners } from './StudioBanners.tsx';
import {
  StudioContext,
  useStudioServices,
  useStudioState,
  type LibraryState,
  type StudioServices,
} from './studio-context.ts';
import { StudioDialogs } from './StudioDialogs.tsx';
import { StudioMap, type PickedBuilding } from './StudioMap.tsx';
import { ActionBar, ToolRail, type StudioDialog } from './StudioToolbar.tsx';
import { useStudioMapData } from './useStudioMapData.ts';

const VALIDATE_DELAY_MS = 600;
const RECOVERY_DELAY_MS = 400;
const PLACEMENT_ZOOM = 17.5;
/** Below these window widths the library / inspector panels start collapsed. */
const WIDE_PANELS_PX = 1100;
const INSPECTOR_PX = 960;
const viewportWidth = () => (typeof window === 'undefined' ? 1440 : window.innerWidth);

type LeftTab = 'library' | 'buildings';

const isTextTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export default function StudioSection({ route, navigate }: AdminSectionProps) {
  const api = useAdminApi();
  const isMobile = useIsMobile();
  const reducedMotion = useReducedMotion();
  const { resolved: theme } = useTheme();
  const map = useStudioMapData();
  const refreshMap = map.refresh;
  const [store] = useState(() => createStudioStore());
  const actions = useMemo(
    () =>
      createStudioActions({
        api: api.studio,
        store,
        onRecordChange: (id) => navigate({ section: 'studio', id }),
        onPublicationChange: refreshMap,
      }),
    [api, store, navigate, refreshMap],
  );

  // --- the template library (server: code + owner templates; built-in fallback) ---
  const [library, setLibrary] = useState<LibraryState>(() => ({
    status: 'loading',
    items: builtInLibraryItems(),
  }));
  const [libraryAttempt, setLibraryAttempt] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    void api.studio.library({ signal: ctl.signal }).then((r) => {
      if (ctl.signal.aborted) return;
      if (r.ok) setLibrary({ status: 'ready', items: libraryItems(r.data.templates) });
      else if (r.error.kind !== 'aborted')
        setLibrary({
          status: 'fallback',
          items: builtInLibraryItems(),
          message: `Only the built-in templates are shown: ${describeAdminError(r.error)}`,
        });
    });
    return () => ctl.abort();
  }, [api, libraryAttempt]);

  // --- route ↔ open record ---
  // Acts only when the URL's record changes (not when callbacks are re-created): after a first
  // save the store already holds the new record a moment before the URL names it.
  const routeId = route.id;
  const handledRoute = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (handledRoute.current === routeId) return;
    handledRoute.current = routeId;
    const s = store.getState();
    if (routeId) {
      if (s.editor.head?.id === routeId || s.editor.pending?.op === 'load') return;
      void actions.open(routeId);
    } else if (s.editor.head) {
      actions.persistRecovery();
      store.dispatch({ type: 'exit' });
    } else if (!s.editor.history && !s.editor.placement) {
      actions.checkNewRecovery();
    }
  }, [routeId, actions, store]);

  // --- live server check (debounced) and crash recovery (debounced) ---
  useEffect(() => {
    let validateTimer: ReturnType<typeof setTimeout> | undefined;
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
    let lastSubject: unknown = null;
    let lastTarget: string | null = null;
    let lastPresent: unknown = null;
    const onChange = () => {
      const s = store.getState();
      const subject = s.editor.history?.present ?? s.editor.placement?.model ?? null;
      const target = s.editor.placement?.targetId ?? s.editor.targetId;
      if (!s.editor.dragging && (subject !== lastSubject || target !== lastTarget)) {
        lastSubject = subject;
        lastTarget = target;
        clearTimeout(validateTimer);
        if (subject && checkTarget(s) && !currentValidation(s))
          validateTimer = setTimeout(() => {
            if (!currentValidation(store.getState())) void actions.validate();
          }, VALIDATE_DELAY_MS);
      }
      const present = s.editor.history?.present ?? null;
      if (present !== lastPresent) {
        lastPresent = present;
        clearTimeout(recoveryTimer);
        if (present && shouldGuardUnload(s.editor))
          recoveryTimer = setTimeout(() => actions.persistRecovery(), RECOVERY_DELAY_MS);
        // Back to exactly what the server holds (e.g. redo after undo): nothing left to recover.
        else if (present) actions.forgetRecoveryIfClean();
      }
    };
    onChange();
    const unsub = store.subscribe(onChange);
    return () => {
      unsub();
      clearTimeout(validateTimer);
      clearTimeout(recoveryTimer);
      actions.cancelValidation();
    };
  }, [store, actions]);

  // --- beforeunload guard while changes are unsaved (S10) ---
  const guard = useStudio(store, (s) => shouldGuardUnload(s.editor));
  useEffect(() => {
    if (!guard) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      actions.persistRecovery();
      e.preventDefault();
      // Legacy browsers need a value to show the prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [guard, actions]);

  // --- keyboard: undo / redo / cancel placement ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTextTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        store.dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.dispatch({ type: 'redo' });
      } else if (
        e.key === 'Escape' &&
        store.getState().editor.placement &&
        !store.getState().editor.history
      ) {
        store.dispatch({ type: 'placement/cancel' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  const ready = map.status === 'ready' ? map : null;
  const baseData = ready?.data ?? null;
  const baseFootprint = useCallback(
    (id: string): LngLat[][] | null => {
      const f = baseData?.buildings.features.find((x) => x.properties.id === id);
      return f && f.geometry.type === 'Polygon' ? (f.geometry.coordinates as LngLat[][]) : null;
    },
    [baseData],
  );
  const reloadLibrary = useCallback(() => setLibraryAttempt((a) => a + 1), []);
  const services = useMemo<StudioServices>(
    () => ({ store, actions, library, reloadLibrary, data: baseData, isMobile, baseFootprint }),
    [store, actions, library, reloadLibrary, baseData, isMobile, baseFootprint],
  );

  return (
    <StudioContext value={services}>
      <StudioWorkspace
        map={map}
        theme={theme}
        reducedMotion={reducedMotion}
        onOpenRecord={(id) => navigate({ section: 'studio', id })}
      />
    </StudioContext>
  );
}

interface WorkspaceProps {
  map: ReturnType<typeof useStudioMapData>;
  theme: 'light' | 'dark';
  reducedMotion: boolean;
  onOpenRecord(id: string): void;
}

function StudioWorkspace({ map, theme, reducedMotion, onOpenRecord }: WorkspaceProps) {
  const { store, actions, library, isMobile } = useStudioServices();
  const [dialog, setDialog] = useState<StudioDialog>(null);
  // Narrow desktop layouts (tablets) start with the side panels collapsed so the map keeps its room.
  const [leftOpen, setLeftOpen] = useState(() => viewportWidth() >= WIDE_PANELS_PX);
  const [rightOpen, setRightOpen] = useState(() => viewportWidth() >= INSPECTOR_PX);
  const [leftTab, setLeftTab] = useState<LeftTab>('library');
  const [mobilePanel, setMobilePanel] = useState<'library' | 'buildings' | 'inspector' | 'steps' | null>(
    null,
  );
  const [mode3d, setMode3d] = useState(true);
  const [isoOpen, setIsoOpen] = useState(false);
  const [picked, setPicked] = useState<PickedBuilding | null>(null);
  const [pendingOpen, setPendingOpen] = useState<string | null>(null);
  const controller = useRef<MapController | null>(null);

  // Optional guides and the boundary review (loaded on first use).
  const [showGuides, setShowGuides] = useState(false);
  const [detections, setDetections] = useState<DetectionsFile | null>(null);
  const [detectionsError, setDetectionsError] = useState<string | null>(null);
  const [review, setReview] = useState<BoundaryReviewFile | null>(null);
  const optional = map.status === 'ready' ? map.optional : null;
  useEffect(() => {
    if (!showGuides || detections || !optional) return;
    let cancelled = false;
    optional.detections().then(
      (d) => !cancelled && setDetections(d),
      () => !cancelled && setDetectionsError('The detected footprints could not be loaded.'),
    );
    return () => {
      cancelled = true;
    };
  }, [showGuides, detections, optional]);
  useEffect(() => {
    if (!isoOpen || review || !optional) return;
    let cancelled = false;
    optional.boundaryReview().then(
      (r) => !cancelled && setReview(r),
      () => undefined, // The check then runs without review sections (stated by the merge result).
    );
    return () => {
      cancelled = true;
    };
  }, [isoOpen, review, optional]);

  const v = useStudioState((s) => ({
    open: s.editor.history !== null,
    placing: s.editor.placement !== null && s.editor.history === null,
    dirty: shouldGuardUnload(s.editor),
    recordKey: s.editor.head?.id ?? s.editor.targetId ?? null,
    headId: s.editor.head?.id ?? null,
    templateRef: s.editor.placement?.templateRef ?? null,
    pending: s.editor.pending !== null,
    loading: s.editor.pending?.op === 'load',
  }));

  // Fly to a record when it is opened (not on every edit).
  useEffect(() => {
    const anchor = currentDraft(store.getState().editor)?.model.anchor;
    if (v.recordKey && anchor) controller.current?.flyTo(anchor, PLACEMENT_ZOOM);
  }, [v.recordKey, store]);

  const placingName = useMemo(() => {
    if (!v.templateRef) return '';
    const item = library.items.find((i) => i.definition.id === v.templateRef!.templateId);
    const variant = item?.definition.variants.find((x) => x.id === v.templateRef!.variantId);
    return item ? `${item.definition.name}${variant ? ` (${variant.name})` : ''}` : v.templateRef.templateId;
  }, [v.templateRef, library.items]);

  const place = (def: TemplateDefinition, variantId: string) => {
    const c = controller.current;
    const cam = c && 'getCamera' in c ? (c as MapControllerWithCamera).getCamera() : null;
    const anchor: LngLat = cam?.center ?? [APP_CONFIG.map.center[0], APP_CONFIG.map.center[1]];
    if (actions.startPlacement(def, variantId, anchor)) {
      setMobilePanel(null);
      setPicked(null);
      // Close enough to see a single building being placed.
      if (c && (cam?.zoom ?? 0) < PLACEMENT_ZOOM) c.flyTo(anchor, PLACEMENT_ZOOM);
    }
  };

  const openRecord = (id: string) => {
    if (v.dirty) setPendingOpen(id);
    else {
      onOpenRecord(id);
      setMobilePanel(null);
    }
  };

  /** Brings a ground point into view (close enough to see one building). */
  const focusMap = useCallback((anchor: LngLat) => {
    const c = controller.current;
    const cam = c && 'getCamera' in c ? (c as MapControllerWithCamera).getCamera() : null;
    c?.flyTo(anchor, Math.max(cam?.zoom ?? 0, PLACEMENT_ZOOM));
  }, []);
  const onController = useCallback(
    (c: MapController | null) => {
      controller.current = c;
      // The map finished loading after a placement or a record was opened: show it.
      const e = store.getState().editor;
      const anchor = e.placement?.model.anchor ?? currentDraft(e)?.model.anchor;
      if (c && anchor) focusMap(anchor);
    },
    [store, focusMap],
  );
  const [fatal, setFatal] = useState<string | null>(null);

  const addDisabledReason = v.dirty
    ? 'Save or cancel the open changes before placing another building.'
    : v.pending
      ? 'Wait for the current request to finish.'
      : null;

  const leftPanel = (tab: LeftTab) =>
    tab === 'library' ? (
      <AssetBrowser onPlace={place} disabledReason={addDisabledReason} />
    ) : (
      <RecordList openId={v.headId} refreshKey={`${v.headId}:${v.pending}`} onOpen={openRecord} />
    );

  const mapArea = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <StudioBanners note={map.status === 'ready' ? map.publicationNote : null} />
      <div className="relative min-h-0 flex-1" aria-busy={v.loading || undefined}>
        {map.status === 'loading' ? (
          <div className="flex h-full items-center justify-center">
            <Spinner label="Loading the campus map…" />
          </div>
        ) : map.status === 'error' ? (
          <ErrorState title="The map could not be loaded" message={map.message} onRetry={map.refresh} />
        ) : fatal ? (
          <ErrorState
            title="The map cannot run in this browser"
            message={`${fatal} The Studio needs WebGL to edit on the map.`}
          />
        ) : (
          <StudioMap
            data={map.data}
            studioModels={map.studioModels}
            theme={theme}
            reducedMotion={reducedMotion}
            mode3d={mode3d}
            showGuides={showGuides}
            detections={detections}
            onPick={setPicked}
            onController={onController}
            onFatal={setFatal}
          />
        )}
        {!isMobile && map.status === 'ready' ? (
          <div className="absolute start-2 top-2 z-(--ds-z-controls)">
            <ToolRail
              onOpenLibrary={() => {
                setLeftOpen(true);
                setLeftTab('library');
              }}
            />
          </div>
        ) : null}
        {map.status === 'ready' && !(isMobile && mobilePanel === 'steps') ? (
          <div className="absolute end-2 top-2 z-(--ds-z-controls) flex flex-col items-end gap-1.5">
            <div className="rounded-lg bg-surface-raised p-1 shadow-2">
              <SegmentedControl<'3d' | '2d'>
                label="Map view"
                value={mode3d ? '3d' : '2d'}
                onChange={(m) => setMode3d(m === '3d')}
                options={[
                  { value: '3d', label: '3D' },
                  { value: '2d', label: '2D' },
                ]}
              />
            </div>
            <Button
              size="sm"
              variant={isoOpen ? 'primary' : 'secondary'}
              aria-pressed={isoOpen}
              disabled={!v.open}
              title={v.open ? 'Show the draft in the isometric overview' : 'Open or place a building first'}
              onClick={() => setIsoOpen((o) => !o)}
              data-testid="studio-iso-toggle"
            >
              Isometric check
            </Button>
          </div>
        ) : null}
        {picked && !v.placing ? (
          <PickedCard
            picked={picked}
            blocked={v.dirty}
            onClose={() => setPicked(null)}
            onOpen={(id) => {
              setPicked(null);
              openRecord(id);
            }}
          />
        ) : null}
        {v.placing && !isMobile ? (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 z-(--ds-z-controls) flex justify-center">
            <PlacementBar templateName={placingName} onFocus={focusMap} />
          </div>
        ) : null}
        {isoOpen && v.open && map.status === 'ready' ? (
          <IsoCheck
            data={map.data}
            studioModels={map.studioModels}
            review={review}
            theme={theme}
            reducedMotion={reducedMotion}
            onClose={() => setIsoOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );

  const dialogs = (
    <>
      <StudioDialogs dialog={dialog} onClose={() => setDialog(null)} />
      {pendingOpen ? (
        <Dialog
          open
          onClose={() => setPendingOpen(null)}
          title="Discard unsaved changes?"
          description="Opening another building drops your unsaved changes (the last saved draft on the server is kept)."
          footer={
            <>
              <Button variant="ghost" onClick={() => setPendingOpen(null)}>
                Keep editing
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const id = pendingOpen;
                  actions.discardLocalChanges();
                  setPendingOpen(null);
                  onOpenRecord(id);
                  setMobilePanel(null);
                }}
              >
                Discard and open
              </Button>
            </>
          }
        />
      ) : null}
    </>
  );

  const openDialog = (d: StudioDialog) => {
    const s = store.getState();
    if (s.editor.lastError && !s.editor.conflict) store.dispatch({ type: 'error/dismiss' });
    setDialog(d);
  };

  if (isMobile)
    return (
      <div className="absolute inset-0 flex flex-col" data-testid="studio-workspace" data-layout="mobile">
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-3 py-1.5">
          <div className="min-w-0 flex-1">
            <StateBadge compact />
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setMobilePanel('library')}
            disabled={v.placing}
          >
            Library
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setMobilePanel('buildings')}>
            Buildings
          </Button>
        </div>
        {mapArea}
        {v.placing ? (
          <div className="shrink-0 border-t border-border bg-surface-raised p-2">
            <PlacementBar templateName={placingName} onFocus={focusMap} />
          </div>
        ) : v.open ? (
          <MobileDock
            onInspector={() => setMobilePanel('inspector')}
            onSteps={() => setMobilePanel((p) => (p === 'steps' ? null : 'steps'))}
            stepsOpen={mobilePanel === 'steps'}
            onDialog={openDialog}
          />
        ) : null}
        <BottomSheet
          open={mobilePanel === 'library' || mobilePanel === 'buildings'}
          onClose={() => setMobilePanel(null)}
          title={mobilePanel === 'library' ? 'Template library' : 'Your buildings'}
          defaultSnap="full"
        >
          <div className="flex h-full min-h-0 flex-col">
            {leftPanel(mobilePanel === 'library' ? 'library' : 'buildings')}
          </div>
        </BottomSheet>
        <BottomSheet
          open={mobilePanel === 'inspector'}
          onClose={() => setMobilePanel(null)}
          title="Properties"
          defaultSnap="half"
        >
          <Inspector
            showGuides={showGuides}
            onShowGuides={setShowGuides}
            detections={detections}
            detectionsError={detectionsError}
          />
          <MobileMoreActions onDialog={openDialog} />
        </BottomSheet>
        {dialogs}
      </div>
    );

  return (
    <div className="absolute inset-0 flex flex-col" data-testid="studio-workspace" data-layout="desktop">
      <div className="flex shrink-0 items-center gap-x-2 gap-y-1 border-b border-border bg-surface-raised px-2 py-1.5">
        <IconButton
          icon="layers"
          label={leftOpen ? 'Hide the library panel' : 'Show the library panel'}
          size="sm"
          aria-expanded={leftOpen}
          aria-controls="studio-left-panel"
          onClick={() => setLeftOpen((o) => !o)}
        />
        <div className="min-w-0 shrink">
          <StateBadge />
        </div>
        <div className="flex min-w-0 flex-1 justify-end">
          <ActionBar onDialog={openDialog} />
        </div>
        <IconButton
          icon="settings"
          label={rightOpen ? 'Hide the inspector' : 'Show the inspector'}
          size="sm"
          aria-expanded={rightOpen}
          aria-controls="studio-inspector"
          onClick={() => setRightOpen((o) => !o)}
        />
      </div>
      <div className="flex min-h-0 flex-1">
        <aside
          id="studio-left-panel"
          aria-label="Library and buildings"
          hidden={!leftOpen}
          className="flex w-72 shrink-0 flex-col border-e border-border bg-surface-raised"
        >
          <div className="border-b border-border p-2">
            <SegmentedControl<LeftTab>
              label="Left panel"
              value={leftTab}
              onChange={setLeftTab}
              options={[
                { value: 'library', label: 'Library' },
                { value: 'buildings', label: 'Buildings' },
              ]}
            />
          </div>
          {leftPanel(leftTab)}
        </aside>
        {mapArea}
        <aside
          id="studio-inspector"
          aria-label="Inspector"
          hidden={!rightOpen}
          className={cx('w-[22rem] shrink-0 overflow-y-auto border-s border-border bg-surface-raised')}
        >
          <Inspector
            showGuides={showGuides}
            onShowGuides={setShowGuides}
            detections={detections}
            detectionsError={detectionsError}
          />
        </aside>
      </div>
      {dialogs}
    </div>
  );
}

function PickedCard(props: {
  picked: PickedBuilding;
  blocked: boolean;
  onClose(): void;
  onOpen(id: string): void;
}) {
  const { actions, data } = useStudioServices();
  const [busy, setBusy] = useState(false);
  const { picked } = props;
  const feature = data?.buildings.features.find((f) => f.properties.id === picked.id);
  return (
    <section
      aria-label="Selected building"
      data-testid="studio-picked"
      className="absolute start-2 bottom-2 z-(--ds-z-controls) flex w-[min(22rem,calc(100%-1rem))] flex-col gap-2 rounded-xl border border-border bg-surface-raised p-3 shadow-3"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{picked.label}</h2>
          <p className="text-xs text-muted">{picked.id}</p>
        </div>
        <Button size="sm" variant="ghost" icon="close" aria-label="Close" onClick={props.onClose} />
      </div>
      {picked.kind === 'studio' ? (
        <Button size="sm" variant="primary" onClick={() => props.onOpen(picked.id)}>
          Open in the Studio
        </Button>
      ) : (
        <>
          <p className="text-xs text-muted">
            Model this mapped building: its footprint stays authoritative and its public id stays {picked.id}.
          </p>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={props.blocked || !feature}
            title={props.blocked ? 'Save or cancel the open changes first.' : undefined}
            onClick={() => {
              if (!feature || feature.geometry.type !== 'Polygon') return;
              setBusy(true);
              void actions
                .modelBaseBuilding(
                  picked.id,
                  feature.geometry.coordinates as LngLat[][],
                  feature.properties.renderHeightM,
                )
                .finally(() => {
                  setBusy(false);
                  props.onClose();
                });
            }}
          >
            Model this building
          </Button>
          {feature && feature.geometry.type !== 'Polygon' ? (
            <p className="text-xs text-warning">
              This building has a multi-part footprint, which the Studio cannot model yet.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function MobileDock(props: {
  onInspector(): void;
  onSteps(): void;
  stepsOpen: boolean;
  onDialog(d: StudioDialog): void;
}) {
  const { actions } = useStudioServices();
  const v = useStudioState((s) => ({
    dirty: shouldGuardUnload(s.editor),
    pending: s.editor.pending !== null,
    archived: s.editor.head?.status === 'archived',
  }));
  return (
    <div
      className="shrink-0 border-t border-border bg-surface-raised p-2 pb-[calc(0.5rem+var(--ds-safe-bottom))]"
      data-testid="studio-mobile-dock"
    >
      {props.stepsOpen ? (
        <div className="mb-2 max-h-[45dvh] overflow-y-auto rounded-lg border border-border p-2">
          <StepControls />
        </div>
      ) : null}
      <div className="mb-2 grid grid-cols-2 gap-2">
        <Button
          size="md"
          variant="secondary"
          aria-expanded={props.stepsOpen}
          onClick={props.onSteps}
          disabled={v.archived}
        >
          {props.stepsOpen ? 'Hide move buttons' : 'Move / rotate / size'}
        </Button>
        <Button
          size="md"
          variant="secondary"
          onClick={props.onInspector}
          data-testid="studio-open-properties"
        >
          Properties
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="lg"
          variant="ghost"
          disabled={!v.dirty || v.pending}
          onClick={() => props.onDialog('cancel')}
        >
          Cancel
        </Button>
        <Button
          size="lg"
          variant="primary"
          icon="check"
          disabled={!v.dirty || v.pending || v.archived}
          onClick={() => void actions.saveDraft()}
          data-testid="studio-mobile-save"
        >
          Save
        </Button>
      </div>
    </div>
  );
}

/** On a phone, the record actions live at the end of the properties sheet. */
function MobileMoreActions({ onDialog }: { onDialog(d: StudioDialog): void }) {
  return (
    <div className="border-t border-border p-3">
      <ActionBar onDialog={onDialog} />
    </div>
  );
}
