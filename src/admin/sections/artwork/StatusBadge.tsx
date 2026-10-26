import { Badge } from '../../../components/ui/Badge.tsx';
import type { AssociationStatus } from '../../../isometric-art/schema.ts';
import { STATUS_LABELS } from './artwork-model.ts';

const TONES = { verified: 'success', approximate: 'warning', unresolved: 'neutral' } as const;

/** Association status as text + tone (colour is never the only signal). */
export function StatusBadge({ status }: { status: AssociationStatus }) {
  return <Badge tone={TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}
