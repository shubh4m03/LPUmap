import { PanelSection } from '../settings/PanelSection.tsx';
import { Skeleton } from '../ui/index.ts';
import { useQualityReport, type QualityReport } from './useQualityReport.ts';

const STATUS_TEXT: Record<string, string> = { empty: 'None mapped', sparse: 'Sparse' };

/** Categories students look for most that the data covers poorly, from quality-report.json. */
export function QualitySummary() {
  const state = useQualityReport();
  return (
    <PanelSection
      title="Thin coverage"
      icon="warning"
      description="Important categories with few or no mapped records, from the dataset’s quality report."
    >
      {state.status === 'loading' ? (
        <Skeleton label="Loading the data quality report" className="h-16" />
      ) : null}
      {state.status === 'error' ? <p className="text-sm text-muted">{state.message}</p> : null}
      {state.status === 'ready' ? <ThinList report={state.report} /> : null}
    </PanelSection>
  );
}

function ThinList({ report }: { report: QualityReport }) {
  const thin = report.importantCategories.filter((c) => c.status === 'empty' || c.status === 'sparse');
  if (thin.length === 0) {
    return <p className="text-sm text-muted">The quality report lists no thinly covered categories.</p>;
  }
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {thin.map((c) => (
        <li key={c.id} className="flex justify-between gap-3">
          <span>{c.label}</span>
          <span className="shrink-0 text-muted">
            {c.total === 0
              ? (STATUS_TEXT[c.status] ?? c.status)
              : `${c.total} total, ${c.onCampus} on campus`}
          </span>
        </li>
      ))}
    </ul>
  );
}
