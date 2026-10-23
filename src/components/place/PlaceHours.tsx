import { useNow } from '../../app/hooks/useNow.ts';
import type { Place } from '../../data/index.ts';
import {
  evaluateHours,
  formatScheduleLines,
  parseOpeningHours,
  type HoursState,
} from '../../facilities/index.ts';
import { Badge, type BadgeTone } from '../ui/index.ts';
import { DetailSection } from './DetailSection.tsx';

const STATE_BADGE: Record<HoursState, { text: string; tone: BadgeTone }> = {
  open: { text: 'Open', tone: 'success' },
  closed: { text: 'Closed', tone: 'neutral' },
  unknown: { text: 'Hours unknown', tone: 'neutral' },
  stale: { text: 'May be outdated', tone: 'warning' },
};

/** Opening hours per the published value. Never a live status. */
export function PlaceHours({ place }: { place: Place }) {
  const now = useNow(60_000);
  const raw = place.openingHours;
  const evaluation = evaluateHours(raw, new Date(now), { retrievedAt: place.provenance.retrievedAt });
  const parsed = raw ? parseOpeningHours(raw) : null;
  const badge = STATE_BADGE[evaluation.state];

  return (
    <DetailSection title="Opening hours" icon="clock">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={badge.tone}>{badge.text}</Badge>
        <span className="text-sm text-text">{evaluation.label}</span>
      </div>
      {evaluation.reason ? <p className="mt-1 text-sm text-muted">{evaluation.reason}</p> : null}
      {raw && !parsed ? (
        <p className="mt-2 text-sm text-muted">
          Published as: <span className="font-mono text-text">{raw}</span>
        </p>
      ) : null}
      {parsed ? (
        <ul className="mt-2 space-y-0.5 text-sm text-text" aria-label="Weekly published hours">
          {formatScheduleLines(parsed).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {raw ? (
        <p className="mt-2 text-xs text-subtle">
          Times are India Standard Time, per published hours — not a live open or closed status.
        </p>
      ) : null}
    </DetailSection>
  );
}
