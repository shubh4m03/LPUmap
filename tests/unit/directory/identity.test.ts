import { describe, expect, it } from 'vitest';
import { verifiedOfficialName } from '../../../src/directory/identity.ts';

describe('verifiedOfficialName (one rule for every "Official name")', () => {
  it('is the name only when its provenance is verified', () => {
    expect(
      verifiedOfficialName({ name: 'Central Library', provenance: { verificationStatus: 'verified' } }),
    ).toBe('Central Library');
  });
  it('is null for an unverified name or no name (a map display name is never official)', () => {
    expect(
      verifiedOfficialName({ name: 'Block 34', provenance: { verificationStatus: 'unverified' } }),
    ).toBeNull();
    expect(verifiedOfficialName({ name: null, provenance: { verificationStatus: 'verified' } })).toBeNull();
  });
});
