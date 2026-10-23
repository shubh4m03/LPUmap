import { announce, type Politeness } from './announcer.ts';

export type AnnounceFn = (message: string, politeness?: Politeness) => void;

/** Returns a stable announcer. Requires `<LiveRegion />` to be mounted somewhere. */
export function useAnnounce(): AnnounceFn {
  return announce;
}
