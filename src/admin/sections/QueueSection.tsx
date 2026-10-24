import { QueueList } from './queue/QueueList.tsx';
import { SuggestionDetail } from './queue/SuggestionDetail.tsx';
import type { AdminSectionProps } from './types.ts';

/** Moderation queue: /admin/queue (filters in the query) and /admin/queue/<suggestion id>. */
export default function QueueSection({ route, navigate }: AdminSectionProps) {
  return route.id ? (
    <SuggestionDetail key={route.id} id={route.id} navigate={navigate} />
  ) : (
    <QueueList query={route.query} navigate={navigate} />
  );
}
