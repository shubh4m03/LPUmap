import type { LngLat } from '../data/schema.ts';

/** One position fix. Held in memory only — never logged, persisted or sent. */
export interface GeoSample {
  lngLat: LngLat;
  /** 95 % confidence radius reported by the device, metres. */
  accuracyM: number;
  /** Epoch milliseconds when the fix was taken. */
  timestamp: number;
  speedMps: number | null;
  headingDeg: number | null;
}

export type GeoStatus =
  'idle' | 'requesting' | 'active' | 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'error';

export type SampleRejection = 'invalid' | 'low-accuracy' | 'stale' | 'out-of-order' | 'implausible-jump';

export type SampleClassification = { accepted: true } | { accepted: false; reason: SampleRejection };
