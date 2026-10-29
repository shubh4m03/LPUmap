import { describe, expect, it } from 'vitest';
import {
  paceFootnote,
  PROFILE_COPY,
  PROFILE_ORDER,
} from '../../../src/components/directions/directions-model.ts';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { PROFILE_IDS } from '../../../src/routing/profiles.ts';

// G-20: pushing a bicycle is part of the Cycle profile (the router has no "push" profile); the
// picker offers exactly the router's profiles and says truthfully where and how fast you push.
describe('push-a-bike exposure', () => {
  it('the travel-mode picker offers exactly the profiles the router implements', () => {
    expect([...PROFILE_ORDER].sort()).toEqual([...PROFILE_IDS].sort());
    expect(Object.keys(PROFILE_COPY).sort()).toEqual([...PROFILE_IDS].sort());
  });

  it('Cycle says the bike is walked where the map says to push, at the configured push speed', () => {
    expect(PROFILE_COPY.cycle.description).toMatch(/walks the bike where the map says to push/);
    const kmh = (APP_CONFIG.routing.pushBikeSpeedMps * 3.6).toFixed(1);
    expect(paceFootnote('cycle')).toContain(`${kmh} km/h where you push the bike`);
  });
});
