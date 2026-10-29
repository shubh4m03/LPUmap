/**
 * Wording of the Studio UI that is shared by several panels (and tested):
 * how to resolve each validation code (docs/BUILDING_STUDIO_DESIGN.md §6.2),
 * which codes can never be acknowledged, and the change list of a draft
 * against the published version. Pure.
 */
import { changedPaths } from '../editor.ts';
import type { StudioDraft, ValidationCode, ValidationIssue } from '../index.ts';

export const RESOLVE_HINTS: Readonly<Record<ValidationCode, string>> = {
  'geometry-invalid': 'Change the dimensions or shape parameters.',
  'dimension-out-of-range': 'Enter a value inside the publish range.',
  'outside-max-bounds': 'Move the building inside the map area.',
  'outside-campus':
    'Move it onto the campus, or do not publish it. Off-campus buildings are never shown; this cannot be acknowledged.',
  'unknown-category': 'Choose a category from the list.',
  'identity-required': 'Choose a category in the Info section (the name may stay empty).',
  'not-applicable': 'Clear the field, or use the right kind of record.',
  'verification-evidence': 'Complete the evidence, or set the status to unverified.',
  'unsupported-model': 'Apply a current template version, or wait for an app update that supports it.',
  'access-node-invalid': 'Pick another access point, or clear it (the building is then not routable).',
  'base-target-missing': 'Archive this record, or model the replacement building as a new building.',
  'base-fit-mismatch':
    'Adjust the model, use the existing footprint, or set "correct position" with a reason.',
  'boundary-crossing': 'Acknowledge with a reason, or move the building.',
  'boundary-uncertain': 'Acknowledging records your confirmation that it belongs to the campus; or move it.',
  'overlap-base-building':
    'Move or resize it, edit that building instead, or acknowledge (for example a canopy over a walkway).',
  'overlap-studio-building': 'Move or resize it, edit that building instead, or acknowledge.',
  'possible-duplicate': 'Edit that building instead; acknowledge only if they are different structures.',
  'height-floors-conflict': 'Adjust the height or floors, or acknowledge (for example a tall ground floor).',
  'outside-template-range': 'Acknowledge, or pick another template.',
  'base-footprint-replaced': 'Acknowledge (recorded in the history), or remove the position correction.',
  'nearby-path': 'For review only: nothing is connected.',
  'nearby-entrance': 'For review only: nothing is connected.',
  'geometry-guide': 'The building stays unverified until you confirm it from evidence.',
  'not-routable': 'Choose an access point if directions should be offered.',
};

export const SEVERITY_HEADINGS = {
  error: 'Errors (block publishing)',
  warning: 'Warnings (need an acknowledgement with a reason)',
  info: 'For review (no action needed)',
} as const;

/** Issues grouped by severity, in the validator's order (code, then path). */
export function groupIssues(
  issues: readonly ValidationIssue[],
): Record<ValidationIssue['severity'], ValidationIssue[]> {
  return {
    error: issues.filter((i) => i.severity === 'error'),
    warning: issues.filter((i) => i.severity === 'warning'),
    info: issues.filter((i) => i.severity === 'info'),
  };
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
  'model.anchor': 'Position',
  'model.rotationDeg': 'Rotation',
  'model.widthM': 'Width',
  'model.lengthM': 'Length',
  'model.heightM': 'Body height',
  'model.floors': 'Floors',
  'model.floorHeightM': 'Floor height',
  'model.baseOffsetM': 'Base above ground',
  'model.detailLevel': 'Detail level',
  'model.geometryGuide': 'Placement guide',
  'model.generatorId': 'Shape generator',
  'model.generatorVersion': 'Generator version',
  'identity.name': 'Name',
  'identity.aliases': 'Other names',
  'identity.categoryId': 'Category',
  'identity.subtype': 'Subtype',
  'identity.description': 'Description',
  'identity.notes': 'Private notes',
  'identity.directoryVisible': 'Listed in the directory',
  accessNodeId: 'Access point',
  positionCorrection: 'Position correction',
  templateRef: 'Template',
};

/** Readable label of a dot path ("model.roof.colour" → "Roof colour"). */
export function fieldLabel(path: string): string {
  const exact = FIELD_LABELS[path];
  if (exact) return exact;
  const prefix = Object.keys(FIELD_LABELS).find((k) => path.startsWith(`${k}.`));
  if (prefix) return FIELD_LABELS[prefix]!;
  const parts = path.split('.');
  if (parts[0] === 'model' && parts.length >= 3) {
    const group = { roof: 'Roof', facade: 'Façade', shape: 'Shape' }[parts[1]!] ?? parts[1]!;
    const field = parts
      .slice(2)
      .join(' ')
      .replace(/([A-Z])/g, ' $1')
      .toLowerCase();
    return `${group} ${field}`;
  }
  if (parts[0] === 'verification') return 'Verification';
  return path;
}

/**
 * Readable list of what changes in public when this draft is published:
 * field labels of every changed leaf against the published record (or
 * "first publication").
 */
export function changeList(published: StudioDraft | null, draft: StudioDraft): string[] {
  if (!published) return ['First publication of this building.'];
  const paths = [
    ...changedPaths(published.identity, draft.identity, 'identity'),
    ...changedPaths(published.model, draft.model, 'model'),
    ...changedPaths(published.verification, draft.verification, 'verification'),
    ...changedPaths(published.accessNodeId, draft.accessNodeId, 'accessNodeId'),
    ...changedPaths(published.templateRef, draft.templateRef, 'templateRef'),
    ...changedPaths(published.positionCorrection, draft.positionCorrection, 'positionCorrection'),
  ];
  const labels = [...new Set(paths.map(fieldLabel))];
  return labels.length > 0
    ? labels.map((l) => `${l} changed`)
    : ['No changes against the published version.'];
}

/** Value of a dot path in a draft, as short text for before/after tables. */
export function valueAt(draft: StudioDraft, path: string): string {
  let v: unknown = draft;
  for (const k of path.split('.')) {
    if (v === null || typeof v !== 'object') return '—';
    v = (v as Record<string, unknown>)[k];
  }
  if (v === undefined || v === null) return '—';
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'number' ? x.toFixed(6) : String(x))).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
