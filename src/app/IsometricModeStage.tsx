import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAnnounce } from '../accessibility/index.ts';
import { useAtlas } from './data/atlas-context.ts';
import { setMapController } from './map-controller.ts';
import { placeEndpoint, routeBlockReason } from './place-actions.ts';
import { useAppStore } from './store/index.ts';
import { resolveIsometricVariant, type IsometricVariant } from './view-mode.ts';
import { SegmentedControl, useToast } from '../components/ui/index.ts';
import type { MapPadding } from '../map/index.ts';
import { verifiedOfficialName } from '../directory/index.ts';
import { ArtworkDetailCard, type LinkedBuildingInfo } from '../isometric-art/view/index.ts';
import { ArtworkLegend } from '../isometric-art/view/index.ts';
import { buildArtModel, legendLabels, subjectsForSelection, type ArtModel } from '../isometric-art/index.ts';
import { IllustratedOverview, NARROW_PX, type ArtController } from '../isometric-art/view/index.ts';
import { artImageSources } from '../isometric-art/index.ts';
import type { EffectiveArtworkAssociation } from '../isometric-art/index.ts';
import { ARTWORK_UNAVAILABLE_REASON, artworkUrl } from '../isometric-art/index.ts';
import { ILLUSTRATION_DISCLAIMER, type IsometricArtManifest } from '../isometric-art/index.ts';
import { unconfirmedMatchLabel } from '../isometric-art/index.ts';
import {
  setIllustratedShown,
  setRequestedIsometricVariant,
  useRequestedIsometricVariant,
} from './isometric-variant.ts';

/** Space the variant switch takes above a stage's own top-left controls (CSS px). */
export const VARIANT_SWITCH_SPACE = 56;

const VARIANT_OPTIONS: readonly { value: IsometricVariant; label: string }[] = [
  { value: 'illustrated', label: 'Illustrated' },
  { value: 'map-accurate', label: 'Map-accurate' },
];

export interface IsometricModeStageProps {
  reducedMotion: boolean;
  padding: MapPadding;
  /** The map-accurate overview (src/app/IsoStudioStage), given the padding left for it. */
  renderMapAccurate(padding: MapPadding): ReactNode;
}

function VariantSwitch({
  value,
  illustratedUnavailable,
}: {
  value: IsometricVariant;
  illustratedUnavailable: boolean;
}) {
  return (
    <div
      className="pointer-events-auto rounded-lg bg-surface-raised whitespace-nowrap shadow-2"
      data-testid="iso-variant-switch"
    >
      <SegmentedControl<IsometricVariant>
        label="Overview style"
        options={VARIANT_OPTIONS.map((o) => ({
          ...o,
          disabled: o.value === 'illustrated' && illustratedUnavailable,
        }))}
        value={value}
        onChange={(v) => setRequestedIsometricVariant(v)}
      />
    </div>
  );
}

/**
 * The isometric mode (`?view=iso`) with its two variants
 * (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §3): the Illustrated overview
 * (default; the owner's artwork with clickable outlines) and the Map-accurate
 * isometric drawing. When the artwork cannot be loaded the map-accurate
 * drawing is shown and the reason announced — never a blank stage.
 */
export function IsometricModeStage({ reducedMotion, padding, renderMapAccurate }: IsometricModeStageProps) {
  const requested = useRequestedIsometricVariant();
  const announce = useAnnounce();
  // Loaded once with the dataset and merged with the owner's decisions (src/app/data/artwork.ts).
  const { artwork } = useAtlas();
  const [imageFailed, setImageFailed] = useState(false);

  const artworkUnavailable =
    artwork.manifest === null
      ? (artwork.unavailableReason ?? ARTWORK_UNAVAILABLE_REASON)
      : imageFailed
        ? ARTWORK_UNAVAILABLE_REASON
        : null;
  const resolved = resolveIsometricVariant(requested, { artworkUnavailable });

  // Say why the illustration is not shown (once per reason).
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (resolved.reason && announced.current !== resolved.reason) {
      announced.current = resolved.reason;
      announce(resolved.reason);
    }
  }, [announce, resolved.reason]);

  const onImageError = useCallback(() => setImageFailed(true), []);

  if (resolved.variant === 'map-accurate') {
    const below = { ...padding, top: padding.top + VARIANT_SWITCH_SPACE };
    return (
      <div className="relative h-full w-full" data-iso-variant="map-accurate">
        {renderMapAccurate(below)}
        <div
          className="pointer-events-none absolute flex flex-col items-start gap-2"
          style={{ top: padding.top + 12, left: padding.left + 12, right: padding.right + 12 }}
        >
          <VariantSwitch value="map-accurate" illustratedUnavailable={artworkUnavailable !== null} />
          {resolved.reason ? (
            <p
              role="status"
              className="pointer-events-auto max-w-sm rounded-md border border-border bg-surface-raised px-2 py-1 text-xs text-text shadow-1"
              data-testid="art-unavailable"
            >
              {resolved.reason}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (artwork.manifest === null) return null; // unreachable: resolved to map-accurate above

  return (
    <IllustratedStage
      key="illustrated"
      manifest={artwork.manifest}
      associations={artwork.associations}
      reducedMotion={reducedMotion}
      padding={padding}
      onImageError={onImageError}
      toolbar={<VariantSwitch value="illustrated" illustratedUnavailable={false} />}
    />
  );
}

interface IllustratedStageProps {
  manifest: IsometricArtManifest;
  associations: ReadonlyMap<string, EffectiveArtworkAssociation>;
  reducedMotion: boolean;
  padding: MapPadding;
  onImageError(): void;
  toolbar: ReactNode;
}

/** The illustrated overview wired to the app store (selection, focus requests, map controller). */
function IllustratedStage({
  manifest,
  associations,
  reducedMotion,
  padding,
  onImageError,
  toolbar,
}: IllustratedStageProps) {
  const { getPlace, directory, buildingDirectory } = useAtlas();
  const announce = useAnnounce();
  const toast = useToast();
  const { selectedPlaceId, focusRequest, detailsOpen } = useAppStore(
    useShallow((s) => ({
      selectedPlaceId: s.selectedPlaceId,
      focusRequest: s.focusRequest,
      detailsOpen: s.activePanel === 'details',
    })),
  );
  const model: ArtModel = useMemo(() => buildArtModel(manifest, associations), [associations, manifest]);
  const [controller, setController] = useState<ArtController | null>(null);
  /** The subject the user picked last (a building can be depicted by several verified subjects). */
  const [picked, setPicked] = useState<string | null>(null);
  const selectedSubjectIds = useMemo(
    () => subjectsForSelection(model, selectedPlaceId),
    [model, selectedPlaceId],
  );
  const activeSubjectId =
    picked !== null && selectedSubjectIds.includes(picked) ? picked : (selectedSubjectIds[0] ?? null);

  useEffect(() => {
    announce(`Illustrated overview. ${ILLUSTRATION_DISCLAIMER}`);
  }, [announce]);

  // Routes and map picking are handed over to a map view while this is shown (useViewModeSync).
  useEffect(() => {
    setIllustratedShown(true);
    return () => setIllustratedShown(false);
  }, []);

  const onReady = useCallback((c: ArtController) => {
    setController(c);
    // Not geographic: it never takes a map camera and keeps the carried one for the next map view.
    setMapController(c, { geographic: false });
  }, []);
  useEffect(() => () => setMapController(null), []);

  // Focus requests of the app: reset, or a place/subject chosen in search or the directory.
  useEffect(() => {
    if (!controller || !focusRequest) return;
    if (focusRequest.kind === 'reset') controller.resetView();
    else if (focusRequest.kind === 'place') {
      const subjects = subjectsForSelection(model, focusRequest.placeId);
      if (subjects[0]) controller.frameSubject(subjects[0]);
    }
    // 'fit' and 'point' are geographic: the illustration is not geographically exact.
  }, [controller, focusRequest, model]);

  const onSelectSubject = useCallback(
    (subjectId: string | null) => {
      const s = useAppStore.getState();
      if (subjectId === null) {
        setPicked(null);
        if (s.selectedPlaceId) s.clearSelection();
        return;
      }
      const sv = model.bySubject.get(subjectId);
      if (!sv) return;
      setPicked(subjectId);
      const verified = sv.association.status === 'verified' ? sv.association.buildingId : null;
      // A verified subject IS its map building: the app selection is that building's id (one
      // identity in every view). Anything else selects the artwork entry's own `art:` id.
      s.selectPlace(verified ?? subjectId, { focus: false, openDetails: false });
      announce(`Selected on the illustration: ${sv.title}.`);
    },
    [announce, model],
  );

  const toMap = useCallback(() => {
    const s = useAppStore.getState();
    s.setViewMode(s.lastMapMode, { reason: 'user' });
  }, []);

  const linkedBuilding = useCallback(
    (buildingId: string): LinkedBuildingInfo | null => {
      const p = getPlace(buildingId);
      if (!p) return null;
      // Only a block label CITED to an official source (src/directory officialBlock), never an artwork number.
      const official = buildingDirectory.byId.get(buildingId)?.officialBlock ?? null;
      return {
        mapName: p.displayName,
        officialName: verifiedOfficialName(p),
        officialBlockLabel: official?.label ?? null,
      };
    },
    [buildingDirectory, getPlace],
  );

  const onShowOnMap = useCallback(
    (buildingId: string) => {
      toMap();
      useAppStore.getState().selectPlace(buildingId, { focus: true });
    },
    [toMap],
  );

  const onDirections = useCallback(
    (buildingId: string) => {
      const place = getPlace(buildingId);
      if (!place) return;
      const blocked = routeBlockReason(place, directory);
      const endpoint = placeEndpoint(place);
      if (blocked || !endpoint) {
        toast.show({ message: blocked ?? 'This building cannot be routed to.', tone: 'warning' });
        return;
      }
      toMap();
      const s = useAppStore.getState();
      s.selectPlace(buildingId, { focus: true, openDetails: false });
      s.setDestination(endpoint);
      s.openPanel('directions');
    },
    [directory, getPlace, toMap, toast],
  );

  const onShowUnconfirmedMatch = useCallback(
    (buildingId: string) => {
      const name = getPlace(buildingId)?.displayName ?? 'the candidate building';
      toMap();
      // Framed and outlined as "Unconfirmed match" (dashed): never selected (it is not this
      // item's identity) and never routed to.
      useAppStore.getState().showUnconfirmedMatch(buildingId, unconfirmedMatchLabel(name));
      toast.show({
        message: `Showing an unconfirmed match on the map: ${name}. It is not confirmed to be the illustrated building, so no directions are offered for it.`,
        tone: 'warning',
        durationMs: 9000,
      });
    },
    [getPlace, toMap, toast],
  );

  const selectedPlace = selectedPlaceId ? getPlace(selectedPlaceId) : undefined;
  const notice =
    selectedPlace && selectedSubjectIds.length === 0 ? (
      <p
        role="status"
        className="pointer-events-auto max-w-sm rounded-md border border-border bg-surface-raised px-2 py-1 text-xs text-text shadow-1"
        data-testid="art-not-linked"
      >
        “{selectedPlace.displayName}” is not linked to the illustration yet. Switch to a map view to see it.
      </p>
    ) : null;

  const narrow = typeof window !== 'undefined' && window.innerWidth < NARROW_PX;
  // The details panel (side panel on larger screens, sheet on a phone; opened from search, the
  // directory or a link) already shows the selected item: a second card beside or over it would
  // only repeat it and cover the outline.
  const card =
    activeSubjectId && !detailsOpen ? (
      <ArtworkDetailCard
        model={model}
        subjectId={activeSubjectId}
        compact={narrow}
        onClose={() => onSelectSubject(null)}
        onSelectSubject={(id) => {
          onSelectSubject(id);
          controller?.frameSubject(id);
        }}
        onShowOnMap={onShowOnMap}
        onDirections={onDirections}
        onShowUnconfirmedMatch={onShowUnconfirmedMatch}
        linkedBuilding={linkedBuilding}
      />
    ) : null;

  const sources = useMemo(() => artImageSources(model.master, model.space), [model]);
  const legendImage = sources.previews[sources.previews.length - 1] ?? sources.full;

  return (
    <IllustratedOverview
      model={model}
      reducedMotion={reducedMotion}
      padding={padding}
      selectedSubjectIds={selectedSubjectIds}
      onSelectSubject={onSelectSubject}
      onReady={onReady}
      onImageError={onImageError}
      toolbar={toolbar}
      notice={notice}
      card={card}
      legend={
        legendImage ? (
          <ArtworkLegend
            imageUrl={artworkUrl(legendImage.url)}
            space={model.space}
            labels={legendLabels(model.master)}
          />
        ) : null
      }
    />
  );
}
