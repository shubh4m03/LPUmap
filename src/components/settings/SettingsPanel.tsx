/**
 * Settings & privacy panel: theme, search history, motion, local data,
 * privacy facts and version information. Opened with
 * `useAppStore.getState().openPanel('settings')`; it needs no app-store state.
 */
import type { JSX } from 'react';
import { useReducedMotion, useTheme, type ThemePreference } from '../../accessibility/index.ts';
import { useAtlas } from '../../app/data/atlas-context.ts';
import { APP_CONFIG } from '../../config/index.ts';
import { PRIVACY_FACTS, usePrivacySettings } from '../../privacy/index.ts';
import { formatDate } from '../place/index.ts';
import { SegmentedControl, Switch, useToast } from '../ui/index.ts';
import { APP_VERSION } from './app-version.ts';
import { ClearDataSection } from './ClearDataSection.tsx';
import { FactList, PanelSection } from './PanelSection.tsx';

const THEME_OPTIONS = [
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
] as const;

export function SettingsPanel(): JSX.Element {
  const { preference, resolved, setPreference } = useTheme();
  const reducedMotion = useReducedMotion();
  const saveHistory = usePrivacySettings((s) => s.saveHistory);
  const setSaveHistory = usePrivacySettings((s) => s.setSaveHistory);
  const { data } = useAtlas();
  const toast = useToast();

  const onHistoryChange = (on: boolean) => {
    setSaveHistory(on);
    toast.show({
      message: on
        ? 'Search history is on. Places you open will be remembered on this device.'
        : 'Search history is off. Your recent places were deleted from this device.',
    });
  };

  return (
    <div className="flex flex-col gap-6 p-4">
      <PanelSection title="Appearance" icon="sun">
        <SegmentedControl<ThemePreference>
          label="Theme"
          options={THEME_OPTIONS}
          value={preference}
          onChange={setPreference}
        />
        <p className="text-sm text-muted">
          {preference === 'system'
            ? `Following your device setting (currently ${resolved}).`
            : `Always ${resolved}.`}
        </p>
      </PanelSection>

      <PanelSection title="Motion" icon="compass">
        <p className="text-sm text-muted">
          {reducedMotion
            ? 'Your device asks for reduced motion, so map moves jump straight to their target and panel animations are minimised.'
            : 'Animations follow your device’s reduced-motion setting. Turn it on in your system settings to make map moves jump instead of glide.'}
        </p>
      </PanelSection>

      <PanelSection title="History" icon="history">
        <Switch
          checked={saveHistory}
          onCheckedChange={onHistoryChange}
          label="Save search history"
          description={`Remembers the last ${APP_CONFIG.search.maxRecent} places you opened, in this browser only. Turning this off deletes the current list.`}
        />
      </PanelSection>

      <ClearDataSection />

      <PanelSection title="Privacy" icon="info">
        <ul className="flex flex-col gap-3 text-sm">
          {PRIVACY_FACTS.map((f) => (
            <li key={f.id}>
              <p className="font-medium text-text">{f.title}</p>
              <p className="text-muted">{f.detail}</p>
            </li>
          ))}
        </ul>
      </PanelSection>

      <PanelSection title="Version" icon="settings">
        <FactList
          label="Version information"
          items={[
            ['App version', APP_VERSION],
            ['Dataset version', data.manifest.datasetVersion],
            ['Data retrieved', formatDate(data.manifest.builtFrom) ?? 'Not recorded'],
          ]}
        />
      </PanelSection>
    </div>
  );
}
