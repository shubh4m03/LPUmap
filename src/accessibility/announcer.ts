/**
 * App-wide screen-reader announcer. `<LiveRegion />` (mounted once near the root)
 * subscribes and renders the current messages; `announce()` / `useAnnounce()` publish.
 * Each message gets a fresh id so repeating the same text is announced again.
 */

export type Politeness = 'polite' | 'assertive';

export interface Announcement {
  id: number;
  text: string;
}

export type AnnouncerState = Record<Politeness, Announcement | null>;

let state: AnnouncerState = { polite: null, assertive: null };
let nextId = 1;
const listeners = new Set<() => void>();

export function getAnnouncerState(): AnnouncerState {
  return state;
}

export function subscribeAnnouncer(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function announce(message: string, politeness: Politeness = 'polite'): void {
  const text = message.trim();
  if (!text) return;
  state = { ...state, [politeness]: { id: nextId++, text } };
  listeners.forEach((l) => l());
}

export function clearAnnouncements(): void {
  state = { polite: null, assertive: null };
  listeners.forEach((l) => l());
}
