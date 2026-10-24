/** The queue filters the owner last viewed (for "Back to the queue"); memory only. */
let lastQueueQuery: Record<string, string> = {};
export function rememberQueueQuery(q: Record<string, string>): void {
  lastQueueQuery = q;
}
/** The filters of the list the owner came from (for "Back to the queue"). */
export const rememberedQueueQuery = (): Record<string, string> => lastQueueQuery;
