import { useMemo } from 'react';
import { useAtlas } from '../../app/data/atlas-context.ts';
import { useAppStore } from '../../app/store/index.ts';
import type { RoutePreference } from '../../routing/index.ts';
import { SegmentedControl } from '../ui/index.ts';
import { PREFERENCE_COPY, PROFILE_COPY, PROFILE_ORDER, preferenceMatters } from './directions-model.ts';

const PROFILE_OPTIONS = PROFILE_ORDER.map((id) => ({
  value: id,
  label: PROFILE_COPY[id].label,
  icon: PROFILE_COPY[id].icon,
}));

const PREFERENCE_OPTIONS: ReadonlyArray<{ value: RoutePreference; label: string }> = [
  { value: 'shortest', label: 'Shortest' },
  { value: 'fastest', label: 'Least time' },
];

/**
 * Travel mode plus, only when it changes the answer for this trip, the
 * shortest / least-time preference.
 */
export function ProfilePicker({ locked }: { locked: boolean }) {
  const { router } = useAtlas();
  const profile = useAppStore((s) => s.profile);
  const preference = useAppStore((s) => s.preference);
  const origin = useAppStore((s) => s.origin);
  const destination = useAppStore((s) => s.destination);

  const showPreference = useMemo(
    () => (origin && destination ? preferenceMatters(router, origin, destination, profile) : false),
    [router, origin, destination, profile],
  );

  const options = locked
    ? PROFILE_OPTIONS.map((o) => ({ ...o, disabled: o.value !== profile }))
    : PROFILE_OPTIONS;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <SegmentedControl
          label="Travel mode"
          options={options}
          value={profile}
          onChange={(p) => useAppStore.getState().setProfile(p)}
          className="w-full [&>button]:flex-1"
        />
        <p className="text-sm text-muted">{PROFILE_COPY[profile].description}</p>
      </div>
      {showPreference ? (
        <div className="flex flex-col gap-1.5">
          <SegmentedControl
            label="Route preference"
            options={
              locked
                ? PREFERENCE_OPTIONS.map((o) => ({ ...o, disabled: o.value !== preference }))
                : PREFERENCE_OPTIONS
            }
            value={preference}
            onChange={(p) => useAppStore.getState().setPreference(p)}
            className="self-start"
          />
          <p className="text-xs text-muted">
            The shortest and the quickest route differ for this trip. {PREFERENCE_COPY[profile]}
          </p>
        </div>
      ) : null}
    </div>
  );
}
