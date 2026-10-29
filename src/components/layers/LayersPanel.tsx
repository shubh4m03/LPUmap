import { useTheme } from '../../accessibility/index.ts';
import { groupCount } from '../../app/commands.ts';
import { useAtlas } from '../../app/data/atlas-context.ts';
import { useAppStore } from '../../app/store/index.ts';
import { categoriesInGroup, LAYER_GROUPS, type LayerGroupId } from '../../config/index.ts';
import { APP_CONFIG } from '../../config/index.ts';
import { Button, Icon, Switch, iconForCategory } from '../ui/index.ts';
import { BuildingLegend } from './BuildingLegend.tsx';
import { OPTIONAL_LAYER_TEXT } from './optional-layer-text.ts';

/** "None mapped yet", or the total with a per-category breakdown, all derived from data. */
function countText(group: LayerGroupId, counts: Record<string, number>): string {
  const n = groupCount(group, counts);
  if (n === 0) return 'None mapped yet';
  const parts = categoriesInGroup(group)
    .filter((c) => (counts[c.id] ?? 0) > 0)
    .map((c) => `${c.label} ${counts[c.id]}`);
  return parts.length > 1 ? `${n} on the map: ${parts.join(' · ')}` : `${n} on the map`;
}

const OPTIONAL = APP_CONFIG.optionalLayers;

/** Layer toggles with counts derived from the dataset, label switch and height legend. */
export function LayersPanel() {
  const { locatedCounts, studioModels } = useAtlas();
  const { resolved } = useTheme();
  const visibleGroups = useAppStore((s) => s.visibleGroups);
  const setGroupVisible = useAppStore((s) => s.setGroupVisible);
  const showLabels = useAppStore((s) => s.showLabels);
  const setShowLabels = useAppStore((s) => s.setShowLabels);
  const mode3d = useAppStore((s) => s.mode3d);
  const setMode3d = useAppStore((s) => s.setMode3d);
  const restoreDefaults = useAppStore((s) => s.restoreDefaults);
  const nearby = useAppStore((s) => s.showNearbyOutsideCampus);
  const setNearby = useAppStore((s) => s.setShowNearbyOutsideCampus);
  const detected = useAppStore((s) => s.showDetectedFootprints);
  const setDetected = useAppStore((s) => s.setShowDetectedFootprints);
  const overview = useAppStore((s) => s.viewMode === 'isometric');

  return (
    <div className="flex flex-col gap-5 p-4">
      <section aria-labelledby="layers-places" className="flex flex-col gap-3">
        <h3 id="layers-places" className="text-sm font-semibold text-muted">
          Places on the map
        </h3>
        <ul className="flex flex-col gap-3">
          {LAYER_GROUPS.map((group) => {
            const icon = iconForCategory(categoriesInGroup(group.id)[0]?.icon ?? 'pin');
            return (
              <li key={group.id}>
                <Switch
                  checked={visibleGroups.has(group.id)}
                  onCheckedChange={(v) => setGroupVisible(group.id, v)}
                  label={
                    <span className="inline-flex items-center gap-2">
                      <Icon name={icon} size={18} className="text-muted" />
                      {group.label}
                    </span>
                  }
                  description={countText(group.id, locatedCounts)}
                />
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="layers-optional" className="flex flex-col gap-3 border-t border-border pt-4">
        <h3 id="layers-optional" className="text-sm font-semibold text-muted">
          Optional layers (off by default)
        </h3>
        <Switch
          checked={nearby}
          onCheckedChange={setNearby}
          label={OPTIONAL.nearbyOutsideCampus.label}
          description={OPTIONAL_LAYER_TEXT.nearbyOutsideCampus}
        />
        <Switch
          checked={detected}
          onCheckedChange={setDetected}
          label={OPTIONAL.detectedFootprints.label}
          description={OPTIONAL_LAYER_TEXT.detectedFootprints}
        />
        {overview && (nearby || detected) ? (
          <p className="text-sm text-muted">The isometric overview does not draw these layers.</p>
        ) : null}
      </section>

      <section aria-labelledby="layers-display" className="flex flex-col gap-3 border-t border-border pt-4">
        <h3 id="layers-display" className="text-sm font-semibold text-muted">
          Display
        </h3>
        <Switch checked={showLabels} onCheckedChange={setShowLabels} label="Show labels" />
        <Switch
          checked={mode3d}
          onCheckedChange={setMode3d}
          label="3D buildings"
          description="Extruded footprints; heights are measured, estimated or placeholders (see legend)."
        />
        <Button variant="secondary" icon="reset" className="self-start" onClick={restoreDefaults}>
          Restore defaults
        </Button>
      </section>

      <BuildingLegend theme={resolved} studioModels={studioModels.length > 0} detectedFootprints={detected} />
    </div>
  );
}
