import { useAtlas } from '../../app/data/atlas-context.ts';
import { useAppStore } from '../../app/store/index.ts';
import { safeExternalUrl } from '../../utils/safe-url.ts';
import { ExternalLink } from '../place/index.ts';
import { PanelSection } from '../settings/PanelSection.tsx';
import { Badge, Button } from '../ui/index.ts';
import type { UnavailableService } from './info-sources.ts';

/**
 * A student service with no reliable public data: says so plainly, links the
 * official page as an external source, and offers a real in-app alternative
 * only when the data has records for it.
 */
export function UnavailableSection({ service }: { service: UnavailableService }) {
  const { locatedCounts } = useAtlas();
  const openCategory = useAppStore((s) => s.openCategory);
  const action = service.action;
  const actionCount = action ? (locatedCounts[action.categoryId] ?? 0) : 0;

  return (
    <PanelSection title={service.title} icon={service.icon}>
      <div className="flex flex-col gap-2 text-sm">
        <Badge tone="warning" icon="info" className="self-start">
          Not available
        </Badge>
        <p className="text-muted">No official public data source we can rely on. {service.finding}</p>
        <ul className="flex flex-col gap-1.5">
          {service.links.map((l) => {
            const url = safeExternalUrl(l.url);
            return url ? (
              <li key={l.url} className="flex flex-col">
                <ExternalLink href={url}>{l.label}</ExternalLink>
                <span className="text-xs text-muted">{l.note}</span>
              </li>
            ) : null;
          })}
        </ul>
        {action && actionCount > 0 ? (
          <Button
            size="sm"
            variant="secondary"
            icon="pin"
            className="self-start"
            onClick={() => openCategory(action.categoryId)}
          >
            {action.label} ({actionCount})
          </Button>
        ) : null}
      </div>
    </PanelSection>
  );
}
