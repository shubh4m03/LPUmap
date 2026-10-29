/**
 * Identity, access point, verification evidence and position correction of
 * the open draft (S3, S4, S5, S7). Nothing here is ever filled in for the
 * owner: an empty name stays empty (shown with the honest "Unnamed building"
 * label), an access point is only a suggestion until accepted, and Google
 * Maps / Earth / Street View URLs are refused with the reason.
 */
import { useMemo } from 'react';
import { Button } from '../../components/ui/index.ts';
import { APP_CONFIG } from '../../config/index.ts';
import { UNNAMED_STUDIO_BUILDING } from '../../building-studio/index.ts';
import {
  STUDIO_LIMITS,
  VERIFICATION_LABELS,
  VERIFICATION_STATUSES,
  type StudioDraft,
  type StudioIdentity,
  type VerificationDraft,
} from '../../building-studio/index.ts';
import {
  draftSchemaIssues,
  issuesAt,
  parseAliases,
  prohibitedSourceProblem,
  STUDIO_CATEGORY_OPTIONS,
  withVerificationStatus,
} from '../../building-studio/ui/index.ts';
import { useStudioAccessCandidates } from './access-pick-data.ts';
import { CheckField, NumberField, PanelSection, SelectField, TextField } from './controls.tsx';
import { useStudioServices, useStudioState } from './studio-context.ts';
import { useDraftEdit } from './useDraftEdit.ts';

const STATUS_TEXT: Readonly<Record<VerificationDraft['status'], string>> = {
  unverified: 'Unverified (illustrative)',
  'source-backed': 'Source-backed (cited evidence)',
  surveyed: 'Surveyed (site survey)',
};

const firstIssue = (issues: ReturnType<typeof draftSchemaIssues>, path: string) =>
  issuesAt(issues, path)[0]?.message ?? null;

export function IdentitySection() {
  const { draft, editable, edit, blur } = useDraftEdit();
  const targetId = useStudioState((s) => s.editor.targetId);
  const issues = useMemo(() => (draft ? draftSchemaIssues(draft) : []), [draft]);
  if (!draft) return null;
  if (targetId || !draft.identity)
    return (
      <PanelSection title="Info" id="studio-section-info">
        <p className="text-sm">
          Model of the existing building <code className="text-xs">{targetId}</code>.
        </p>
        <p className="text-xs text-muted">
          Its name, category, description and access point stay in the base-place override (Admin → Base-place
          overrides), so each field has one place where it is edited. Its public id stays {targetId}.
        </p>
      </PanelSection>
    );
  const id = draft.identity;
  const setId = (patch: Partial<StudioIdentity>, label: string, key?: string) =>
    edit((d) => (d.identity ? { ...d, identity: { ...d.identity, ...patch } } : d), label, key);
  return (
    <PanelSection title="Info" id="studio-section-info">
      <TextField
        label="Name"
        value={id.name ?? ''}
        disabled={!editable}
        maxLength={STUDIO_LIMITS.name.max}
        placeholder="Leave empty if the real name is not known"
        hint={`Empty is shown as “${UNNAMED_STUDIO_BUILDING}”. Never enter a name or block number you have not confirmed.`}
        error={firstIssue(issues, 'identity.name')}
        testId="studio-name"
        onChange={(v) => setId({ name: v === '' ? null : v }, 'Name', 'identity.name')}
        onBlur={blur}
      />
      <TextField
        label="Other names (comma-separated)"
        value={id.aliases.join(', ')}
        disabled={!editable}
        error={firstIssue(issues, 'identity.aliases')}
        onChange={(v) => setId({ aliases: parseAliases(v) }, 'Other names', 'identity.aliases')}
        onBlur={blur}
      />
      <SelectField
        label="Category"
        value={id.categoryId}
        disabled={!editable}
        options={STUDIO_CATEGORY_OPTIONS.map((c) => ({ value: c.id, label: c.label }))}
        onValue={(v) => setId({ categoryId: v }, 'Category')}
        hint="From the category registry. “Use not recorded” when the use is not known."
      />
      <TextField
        label="Subtype"
        value={id.subtype ?? ''}
        disabled={!editable}
        maxLength={STUDIO_LIMITS.subtype}
        error={firstIssue(issues, 'identity.subtype')}
        onChange={(v) => setId({ subtype: v === '' ? null : v }, 'Subtype', 'identity.subtype')}
        onBlur={blur}
      />
      <TextField
        label="Public description"
        multiline
        value={id.description ?? ''}
        disabled={!editable}
        maxLength={STUDIO_LIMITS.description}
        error={firstIssue(issues, 'identity.description')}
        onChange={(v) => setId({ description: v === '' ? null : v }, 'Description', 'identity.description')}
        onBlur={blur}
      />
      <TextField
        label="Private notes (never published)"
        multiline
        value={id.notes ?? ''}
        disabled={!editable}
        maxLength={STUDIO_LIMITS.notes}
        error={firstIssue(issues, 'identity.notes')}
        onChange={(v) => setId({ notes: v === '' ? null : v }, 'Private notes', 'identity.notes')}
        onBlur={blur}
      />
      <CheckField
        label="List in the directory and search"
        checked={id.directoryVisible}
        disabled={!editable}
        hint="Off: still drawn and selectable on the map, but not listed."
        onChange={(v) => setId({ directoryVisible: v }, v ? 'List in directory' : 'Hide from directory')}
      />
      <AccessField draft={draft} />
    </PanelSection>
  );
}

function AccessField({ draft }: { draft: StudioDraft }) {
  const { store } = useStudioServices();
  const { editable, edit, blur } = useDraftEdit();
  const maxM = APP_CONFIG.routing.maxPlaceConnectorM;
  const candidates = useStudioAccessCandidates();
  const picking = useStudioState((s) => s.accessPick !== null);
  const suggestion = candidates?.[0] ?? null;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2.5">
      <p className="text-xs font-medium text-muted">Access point (routing)</p>
      <p className="text-xs text-muted">
        Directions are offered only through a path node you choose; nothing is connected from the shape or the
        entrance marker. The server checks it (walkable, within {maxM} m of the footprint).
      </p>
      <NumberField
        label="Path node id"
        integer
        step={1}
        value={draft.accessNodeId ?? 0}
        disabled={!editable || draft.accessNodeId === null}
        onValue={(v) => {
          if (!Number.isInteger(v) || v < 0) return 'Enter a node id (a whole number ≥ 0).';
          edit((d) => ({ ...d, accessNodeId: v }), 'Access point', 'accessNodeId');
          return null;
        }}
        onBlur={blur}
        hint={draft.accessNodeId === null ? 'None: the building is not routable.' : undefined}
      />
      <div className="flex flex-wrap gap-2">
        {candidates && candidates.length > 0 ? (
          <Button
            size="sm"
            icon="locate"
            disabled={!editable || picking}
            title="Show the valid path nodes on the map and pick one near where you click"
            onClick={() => store.setState({ accessPick: { click: null } })}
            data-testid="studio-access-pick-start"
          >
            {picking ? 'Choosing on the map…' : 'Choose on the map'}
          </Button>
        ) : null}
        {suggestion && suggestion.nodeId !== draft.accessNodeId ? (
          <Button
            size="sm"
            disabled={!editable}
            onClick={() =>
              edit((d) => ({ ...d, accessNodeId: suggestion.nodeId }), 'Use suggested access point')
            }
          >
            Use nearest walkable node {suggestion.nodeId} ({suggestion.distanceM} m)
          </Button>
        ) : null}
        {!suggestion ? <p className="text-xs text-muted">No walkable path node within {maxM} m.</p> : null}
        {draft.accessNodeId !== null ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={!editable}
            onClick={() => edit((d) => ({ ...d, accessNodeId: null }), 'Clear access point')}
          >
            Clear access point
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function VerificationSection() {
  const { draft, editable, edit, blur } = useDraftEdit();
  const issues = useMemo(() => (draft ? draftSchemaIssues(draft) : []), [draft]);
  if (!draft) return null;
  const v = draft.verification;
  const setV = (next: VerificationDraft, label: string, key?: string) =>
    edit((d) => ({ ...d, verification: next }), label, key);
  return (
    <PanelSection title="Verification" id="studio-section-verification">
      <SelectField
        label="Evidence for this building"
        value={v.status}
        disabled={!editable}
        options={VERIFICATION_STATUSES.map((s) => ({ value: s, label: STATUS_TEXT[s] }))}
        onValue={(s) =>
          setV(withVerificationStatus(v, s as VerificationDraft['status']), 'Verification status')
        }
        hint={`Shown publicly as: “${VERIFICATION_LABELS[v.status]}”.`}
      />
      {v.status === 'source-backed' ? (
        <>
          <TextField
            label="Citation URL"
            type="url"
            value={v.citation.url}
            disabled={!editable}
            testId="studio-citation-url"
            error={
              prohibitedSourceProblem(v.citation.url, 'url') ??
              firstIssue(issues, 'verification.citation.url')
            }
            onChange={(url) =>
              setV({ ...v, citation: { ...v.citation, url } }, 'Citation URL', 'verification.citation.url')
            }
            onBlur={blur}
          />
          <TextField
            label="Citation title"
            value={v.citation.title}
            disabled={!editable}
            error={
              prohibitedSourceProblem(v.citation.title, 'text') ??
              firstIssue(issues, 'verification.citation.title')
            }
            onChange={(title) =>
              setV(
                { ...v, citation: { ...v.citation, title } },
                'Citation title',
                'verification.citation.title',
              )
            }
            onBlur={blur}
          />
          <TextField
            label="Accessed on"
            type="date"
            value={v.citation.accessedOn}
            disabled={!editable}
            error={firstIssue(issues, 'verification.citation.accessedOn')}
            onChange={(accessedOn) =>
              setV(
                { ...v, citation: { ...v.citation, accessedOn } },
                'Access date',
                'verification.citation.accessedOn',
              )
            }
            onBlur={blur}
          />
        </>
      ) : null}
      {v.status === 'surveyed' ? (
        <TextField
          label="Survey date"
          type="date"
          value={v.surveyDate}
          disabled={!editable}
          error={firstIssue(issues, 'verification.surveyDate')}
          onChange={(surveyDate) => setV({ ...v, surveyDate }, 'Survey date', 'verification.surveyDate')}
          onBlur={blur}
        />
      ) : null}
      {v.status !== 'unverified' ? (
        <TextField
          label="What the evidence shows (at least 10 characters)"
          multiline
          value={v.note}
          disabled={!editable}
          error={prohibitedSourceProblem(v.note, 'text') ?? firstIssue(issues, 'verification.note')}
          onChange={(note) => setV({ ...v, note }, 'Evidence note', 'verification.note')}
          onBlur={blur}
        />
      ) : null}
      <p className="text-xs text-muted">
        Google Maps, Google Earth and Street View are never a source: their terms forbid deriving map data
        from them. Google Open Buildings (a separately licensed dataset) is allowed.
      </p>
    </PanelSection>
  );
}

export function CorrectionSection() {
  const { draft, editable, edit, blur } = useDraftEdit();
  const targetId = useStudioState((s) => s.editor.targetId);
  const issues = useMemo(() => (draft ? draftSchemaIssues(draft) : []), [draft]);
  if (!draft || !targetId) return null;
  const prism = draft.model.generatorId === 'footprint-prism';
  const c = draft.positionCorrection;
  return (
    <PanelSection title="Position correction" id="studio-section-correction" defaultOpen={c !== null}>
      <p className="text-xs text-muted">
        The mapped footprint stays authoritative. Only if it is wrong may a generated model replace it, with a
        reason (recorded in the history and needing an acknowledged warning).
      </p>
      {prism ? (
        <p className="text-xs text-muted">
          This model uses the mapped footprint itself. Apply a template first to model a different footprint.
        </p>
      ) : (
        <>
          <CheckField
            label="The mapped footprint is wrong: replace it with this model's footprint"
            checked={c !== null}
            disabled={!editable}
            onChange={(on) =>
              edit(
                (d) => ({ ...d, positionCorrection: on ? { reason: '' } : null }),
                on ? 'Correct position' : 'Remove position correction',
              )
            }
          />
          {c ? (
            <TextField
              label="Reason (at least 10 characters)"
              multiline
              value={c.reason}
              disabled={!editable}
              error={
                prohibitedSourceProblem(c.reason, 'text') ?? firstIssue(issues, 'positionCorrection.reason')
              }
              onChange={(reason) =>
                edit(
                  (d) => ({ ...d, positionCorrection: { reason } }),
                  'Correction reason',
                  'positionCorrection.reason',
                )
              }
              onBlur={blur}
            />
          ) : null}
        </>
      )}
    </PanelSection>
  );
}
