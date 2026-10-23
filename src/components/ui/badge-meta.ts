import type { VerificationStatus } from '../../data/schema.ts';
import type { IconName } from '../icons/icon-paths.ts';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

/** Text, tone and icon for each data verification status (see src/data/schema.ts). */
export const VERIFICATION_BADGE: Record<
  VerificationStatus,
  { label: string; tone: BadgeTone; icon: IconName; description: string }
> = {
  verified: {
    label: 'Verified',
    tone: 'success',
    icon: 'check',
    description: 'Checked against an authoritative source or an on-site survey.',
  },
  imported: {
    label: 'Imported',
    tone: 'info',
    icon: 'download',
    description: 'Imported from an open data source such as OpenStreetMap; not independently checked.',
  },
  estimated: {
    label: 'Estimated',
    tone: 'warning',
    icon: 'info',
    description: 'Derived or estimated, not measured.',
  },
  unverified: {
    label: 'Unverified',
    tone: 'neutral',
    icon: 'warning',
    description: 'Not yet verified; treat with caution.',
  },
};
