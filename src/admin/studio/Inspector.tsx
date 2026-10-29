/**
 * The inspector (desktop right panel, mobile bottom sheet): properties of
 * the open model, and the server checks. With nothing open it explains how
 * to start.
 */
import { EmptyState, SegmentedControl } from '../../components/ui/index.ts';
import { currentValidation } from '../../building-studio/ui/index.ts';
import type { DetectionsFile } from '../../data/index.ts';
import { AppearanceSection } from './AppearancePanel.tsx';
import { DimensionsSection, PositionSection, ShapeSection } from './GeometryPanel.tsx';
import { StudioArtworkSection } from '../sections/artwork/StudioArtworkLinks.tsx';
import { CorrectionSection, IdentitySection, VerificationSection } from './InfoPanel.tsx';
import { SnapSection } from './SnapSection.tsx';
import { TemplateSection } from './TemplatePanel.tsx';
import { useStudioServices, useStudioState } from './studio-context.ts';
import { ValidationPanel } from './ValidationPanel.tsx';

export interface InspectorProps {
  showGuides: boolean;
  onShowGuides(v: boolean): void;
  detections: DetectionsFile | null;
  detectionsError: string | null;
}

type Tab = 'properties' | 'checks';

export function Inspector(props: InspectorProps) {
  const { store } = useStudioServices();
  const tab = useStudioState((s) => s.inspectorTab);
  const setTab = (t: Tab) => store.setState({ inspectorTab: t });
  const v = useStudioState((s) => {
    const r = currentValidation(s);
    return {
      open: s.editor.history !== null,
      placing: s.editor.placement !== null && s.editor.history === null,
      archived: s.editor.head?.status === 'archived',
      errors: r?.errorCount ?? null,
      warnings: r?.warningCount ?? null,
    };
  });
  if (!v.open && !v.placing)
    return (
      <EmptyState
        icon="building"
        title="Nothing open"
        description="Choose a template in the Library and place it, open one of your buildings, or use Select to pick a building on the map."
      />
    );
  if (v.placing) return <ValidationPanel />;
  const checksLabel =
    v.errors === null
      ? 'Checks'
      : `Checks (${v.errors} ${v.errors === 1 ? 'error' : 'errors'}, ${v.warnings} warn.)`;
  return (
    <div className="flex min-h-0 flex-col">
      <div className="sticky top-0 z-10 border-b border-border bg-surface-raised p-2">
        <SegmentedControl<Tab>
          label="Inspector view"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'properties', label: 'Properties' },
            { value: 'checks', label: checksLabel },
          ]}
        />
      </div>
      {v.archived ? (
        <p className="m-3 rounded-md bg-danger-soft p-2 text-sm text-danger">
          Archived: not on the public map. Restore it to edit or publish again.
        </p>
      ) : null}
      {tab === 'properties' ? (
        <div>
          <IdentitySection />
          <PositionSection />
          <DimensionsSection />
          <ShapeSection />
          <AppearanceSection />
          <VerificationSection />
          <StudioArtworkSection />
          <CorrectionSection />
          <TemplateSection />
          <SnapSection {...props} />
        </div>
      ) : (
        <ValidationPanel />
      )}
    </div>
  );
}
