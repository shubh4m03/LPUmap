/**
 * One artwork subject: its exact printed labels, the original artwork (the
 * master with the subject's outlines, its vignettes), the candidate
 * footprints on a small map, the current link and the owner's decision form
 * (building, status, REQUIRED evidence for "verified", note for
 * "approximate"), reset to the curated baseline, and the audit history.
 * Saving publishes through the publication feed: the public map shows it
 * after a refresh. The artwork files are never written from here.
 */
import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { Badge } from '../../../components/ui/Badge.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { Spinner } from '../../../components/ui/Spinner.tsx';
import { TextInput } from '../../../components/ui/TextInput.tsx';
import { useToast } from '../../../components/ui/toast-context.ts';
import {
  ASSOCIATION_STATUSES,
  EVIDENCE_KINDS,
  type ArtSubject,
  type AssociationStatus,
  type IsometricArtManifest,
} from '../../../isometric-art/schema.ts';
import type { ArtworkAssociationDetail } from '../../api/artwork.ts';
import { useAdminApi } from '../../context.ts';
import { useAdminCampusData } from '../../data/campus-data.ts';
import { useAction } from '../../hooks/useAction.ts';
import { useResource } from '../../hooks/useResource.ts';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard.ts';
import type { AdminNavigate } from '../../router.ts';
import { adminHref } from '../../routes.ts';
import { ActionDialog } from '../../ui/ActionDialog.tsx';
import { ErrorNotice } from '../../ui/ErrorNotice.tsx';
import { SelectField, TextArea } from '../../ui/fields.tsx';
import { formatDateTime } from '../../ui/format.ts';
import { onInAppClick } from '../../ui/links.ts';
import { Facts, Page, Section } from '../../ui/Page.tsx';
import { actionLabel } from '../audit/audit-model.ts';
import { MasterHotspotPreview, OriginalImage } from './ArtworkImages.tsx';
import {
  EVIDENCE_KIND_LABELS,
  NUMBER_NOTE,
  SOURCE_LABELS,
  STATUS_DESCRIPTIONS,
  STATUS_LABELS,
  associationWriteBody,
  emptyEvidence,
  formFrom,
  issuesToFieldErrors,
  sameForm,
  subjectLabels,
  subjectTitle,
  todayUtc,
  validateAssociationForm,
  type AssociationFormValues,
  type EvidenceDraft,
  type EvidenceKind,
} from './artwork-model.ts';
import { campusBuildingIndex } from './candidate-map.ts';
import { CandidateMap } from './CandidateMap.tsx';
import { StatusBadge } from './StatusBadge.tsx';

type Back = { href: string; label: string; onNavigate(): void };

export function AssociationEditor({
  subjectId,
  manifest,
  navigate,
  back,
}: {
  subjectId: string;
  manifest: IsometricArtManifest;
  navigate: AdminNavigate;
  back: Back;
}) {
  const api = useAdminApi();
  const detail = useResource(`artwork:${subjectId}`, (signal) =>
    api.artwork.getAssociation(subjectId, { signal }),
  );
  const subject = manifest.subjects.find((s) => s.subjectId === subjectId) ?? null;
  const d = detail.state.data;
  if (!d) {
    return (
      <Page title={subject ? <Exact text={subjectTitle(subject)} /> : subjectId} back={back}>
        {detail.state.status === 'error' ? (
          <ErrorNotice
            error={detail.state.error}
            title="Could not load this artwork item"
            onReload={detail.state.error.kind === 'not-found' ? undefined : detail.reload}
          />
        ) : (
          <div className="flex justify-center py-8">
            <Spinner label="Loading…" />
          </div>
        )}
      </Page>
    );
  }
  return (
    <SubjectPage
      key={`${subjectId}:${d.decision?.revision ?? 0}`}
      detail={d}
      subject={subject}
      manifest={manifest}
      navigate={navigate}
      back={back}
      onReload={detail.reload}
    />
  );
}

/** Printed text exactly as stored: whitespace preserved (e.g. the double space in "CAMPUS CAFE  &"). */
export function Exact({ text }: { text: string }) {
  return (
    <span className="break-words whitespace-pre-wrap" data-exact-label>
      {text}
    </span>
  );
}

function SubjectPage({
  detail,
  subject,
  manifest,
  navigate,
  back,
  onReload,
}: {
  detail: ArtworkAssociationDetail;
  subject: ArtSubject | null;
  manifest: IsometricArtManifest;
  navigate: AdminNavigate;
  back: Back;
  onReload(): void;
}) {
  const e = detail.effective;
  const history = (
    <a
      className="w-fit text-sm font-medium text-accent-text underline"
      href={adminHref({ section: 'audit', query: { entity: 'artwork', entityId: detail.subjectId } })}
      onClick={onInAppClick(() =>
        navigate({ section: 'audit', query: { entity: 'artwork', entityId: detail.subjectId } }),
      )}
    >
      Open in History
    </a>
  );
  if (!subject) {
    return (
      <Page
        title={detail.subjectId}
        back={back}
        description={<Badge tone="warning">Not in the illustration registry</Badge>}
      >
        <Section title="Stored decision (not applied)">
          <p className="text-sm text-text">
            This subject is not in the current illustration registry, so the stored decision is not applied
            anywhere. You can reset it to remove it.
          </p>
          <CurrentLink detail={detail} />
          <ResetButton detail={detail} onDone={onReload} />
          {history}
        </Section>
      </Page>
    );
  }
  return (
    <Page
      title={<Exact text={subjectTitle(subject)} />}
      back={back}
      wide
      description={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={e.status} />
          <Badge tone="neutral">{SOURCE_LABELS[e.source]}</Badge>
          <code className="text-xs">{subject.subjectId}</code>
        </span>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <LabelsSection subject={subject} />
          <Section title="On the overview illustration">
            {subject.hotspotIds.length === 0 ? (
              <p className="text-sm text-muted">
                This item has no outline on the overview; it appears only in the vignette below.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <MasterHotspotPreview
                  manifest={manifest}
                  hotspotIds={subject.hotspotIds}
                  label={`Overview illustration with the outline of ${subject.subjectId}`}
                />
                <MasterHotspotPreview
                  manifest={manifest}
                  hotspotIds={subject.hotspotIds}
                  zoom
                  label={`Close-up of the outline of ${subject.subjectId} on the overview illustration`}
                />
              </div>
            )}
            <p className="text-xs text-muted">
              The original artwork, unchanged. Outlines use the same transform as the image; a dashed outline
              still needs manual review. The illustration is schematic and not geographically exact.
            </p>
          </Section>
          {subject.vignetteAssetIds.length > 0 ? (
            <Section title="Vignettes">
              {subject.vignetteAssetIds.map((id) => (
                <OriginalImage key={id} manifest={manifest} assetId={id} lazy />
              ))}
            </Section>
          ) : null}
          {subject.needsManualVerification.length > 0 ? (
            <Section title="Needs manual verification">
              <ul className="list-disc ps-5 text-sm text-text">
                {subject.needsManualVerification.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Section title="Current link">
            <CurrentLink detail={detail} />
            <ResetButton detail={detail} onDone={onReload} />
          </Section>
          <DecisionForm detail={detail} onSaved={onReload} />
          <Section title="History" actions={history}>
            {detail.history.length === 0 ? (
              <p className="text-sm text-muted">No change has been recorded for this item.</p>
            ) : (
              <ol className="flex flex-col gap-1 text-sm" aria-label="Change history (oldest first)">
                {detail.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap gap-x-2">
                    <span className="text-muted">{formatDateTime(h.at)}</span>
                    <span className="font-medium text-text">{actionLabel(h.action)}</span>
                    <span className="text-muted">by {h.actor}</span>
                    {h.outcome !== 'success' ? <Badge tone="warning">{h.outcome}</Badge> : null}
                    {h.detail ? <span className="text-muted">— {h.detail}</span> : null}
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      </div>
    </Page>
  );
}

function LabelsSection({ subject }: { subject: ArtSubject }) {
  const rows = subjectLabels(subject);
  return (
    <Section title="Printed labels (exact)">
      {subject.displayHold ? (
        <p className="rounded-md border border-border bg-warning-soft p-3 text-sm text-text">
          Held from public display until you decide: {subject.displayHold.reason}
        </p>
      ) : null}
      {subject.artworkNumber !== null ? (
        <p className="text-sm text-text">
          Illustration number <strong>{subject.artworkNumber}</strong> —{' '}
          <span className="text-muted">{NUMBER_NOTE}</span>
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No label is printed for this item.</p>
      ) : (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(8rem,max-content)_1fr]">
          {rows.map((r) => (
            <div key={`${r.role}:${r.quote.ref}:${r.quote.text}`} className="contents">
              <dt className="font-medium text-muted">{r.role}</dt>
              <dd className="min-w-0 text-text">
                <Exact text={r.quote.text} /> <code className="text-xs text-muted">{r.quote.ref}</code>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {subject.aliases.length > 0 ? (
        <p className="text-xs text-muted">
          Search-only spellings (never shown as the label): {subject.aliases.join(', ')}
        </p>
      ) : null}
    </Section>
  );
}

function CurrentLink({ detail }: { detail: ArtworkAssociationDetail }) {
  const e = detail.effective;
  const d = detail.decision;
  return (
    <Facts
      items={[
        ['Status', STATUS_LABELS[e.status]],
        [
          'Building',
          e.buildingId ? (
            <code className="break-all">{e.buildingId}</code>
          ) : e.unconfirmedMatchId ? (
            <span>
              Unconfirmed match: <code className="break-all">{e.unconfirmedMatchId}</code> (never routed)
            </span>
          ) : (
            'None (no map location)'
          ),
        ],
        ['Source', SOURCE_LABELS[e.source]],
        [
          'Evidence',
          e.evidence.length === 0 ? null : (
            <ul className="list-disc ps-5">
              {e.evidence.map((ev, i) => (
                <li key={i}>
                  {EVIDENCE_KIND_LABELS[ev.kind]}, {ev.date}: {ev.description}
                  {ev.url ? (
                    <>
                      {' '}
                      <a
                        className="break-all text-accent-text underline"
                        href={ev.url}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {ev.url}
                      </a>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ),
        ],
        ['Curated reason', e.reason],
        ['Private note', d?.note ?? null],
        [
          'Last changed',
          d ? `${formatDateTime(d.updatedAt)} by ${d.updatedBy} (revision ${d.revision})` : null,
        ],
      ]}
    />
  );
}

function ResetButton({ detail, onDone }: { detail: ArtworkAssociationDetail; onDone(): void }) {
  const api = useAdminApi();
  const toast = useToast();
  const action = useAction();
  const [open, setOpen] = useState(false);
  const d = detail.decision;
  if (!d) return null;
  return (
    <>
      <Button variant="secondary" icon="reset" className="w-fit" onClick={() => setOpen(true)}>
        Reset to the curated baseline…
      </Button>
      <ActionDialog
        open={open}
        title="Reset to the curated baseline?"
        description="Your decision is removed and the curated baseline applies again. The decision stays in the history."
        confirmLabel="Reset"
        danger
        busy={action.busy}
        error={action.error}
        errorTitle="Could not reset"
        onReload={() => {
          setOpen(false);
          onDone();
        }}
        onClose={() => {
          action.clear();
          setOpen(false);
        }}
        onConfirm={async () => {
          const r = await action.run(() =>
            api.artwork.resetAssociation(detail.subjectId, { expectedRevision: d.revision }),
          );
          if (r) {
            setOpen(false);
            toast.show({
              message: 'Reset and published. The public map shows it after a refresh.',
              tone: 'success',
            });
            onDone();
          }
        }}
      />
    </>
  );
}

function DecisionForm({ detail, onSaved }: { detail: ArtworkAssociationDetail; onSaved(): void }) {
  const api = useAdminApi();
  const toast = useToast();
  const campus = useAdminCampusData();
  const index = useMemo(
    () => (campus.status === 'ready' ? campusBuildingIndex(campus.data) : null),
    [campus],
  );
  const initial = useMemo(() => formFrom(detail), [detail]);
  const [v, setV] = useState<AssociationFormValues>(initial);
  const [touched, setTouched] = useState(false);
  const [buildingQuery, setBuildingQuery] = useState('');
  const save = useAction();
  const today = todayUtc();
  const dirty = !sameForm(v, initial);
  useUnsavedGuard(dirty);

  const buildingKnown = useCallback(
    (id: string) => id.startsWith('stu:') || index === null || index.has(id),
    [index],
  );
  const clientErrors = validateAssociationForm(v, { today, buildingKnown });
  const serverErrors =
    save.error && (save.error.kind === 'unprocessable' || save.error.kind === 'invalid')
      ? issuesToFieldErrors(save.error.issues)
      : {};
  const errors: Record<string, string> = touched ? { ...serverErrors, ...clientErrors } : serverErrors;
  const set = (patch: Partial<AssociationFormValues>) => setV((cur) => ({ ...cur, ...patch }));
  const setEvidence = (i: number, patch: Partial<EvidenceDraft>) =>
    setV((cur) => ({ ...cur, evidence: cur.evidence.map((e, j) => (j === i ? { ...e, ...patch } : e)) }));
  const pick = useCallback((id: string) => setV((cur) => ({ ...cur, buildingId: id })), []);

  const matches = useMemo(() => {
    const q = buildingQuery.trim().toLowerCase();
    if (!index || q.length < 2) return [];
    return [...index.values()]
      .filter((b) => b.id.toLowerCase().includes(q) || b.displayName.toLowerCase().includes(q))
      .slice(0, 12);
  }, [index, buildingQuery]);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setTouched(true);
    if (Object.keys(clientErrors).length > 0) return;
    const body = associationWriteBody(v, detail.decision?.revision ?? null);
    const r = await save.run(() => api.artwork.putAssociation(detail.subjectId, body));
    if (r) {
      toast.show({
        message: 'Saved and published. The public map shows it after a refresh.',
        tone: 'success',
      });
      onSaved();
    }
  };

  const selected = v.buildingId.trim();
  const selectedName = index?.get(selected)?.displayName ?? null;
  const needsBuilding = v.status !== 'unresolved';

  return (
    <Section title="Set the link">
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate aria-label="Artwork link decision">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-text">Status</legend>
          {ASSOCIATION_STATUSES.map((s: AssociationStatus) => (
            <label key={s} className="flex items-start gap-3 rounded-md border border-border p-2">
              <input
                type="radio"
                name="artwork-status"
                value={s}
                checked={v.status === s}
                onChange={() => set({ status: s })}
                className="mt-1 h-5 w-5"
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium text-text">{STATUS_LABELS[s]}</span>
                <span className="text-xs text-muted">{STATUS_DESCRIPTIONS[s]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {needsBuilding ? (
          <div className="flex flex-col gap-3">
            <TextInput
              label="Campus building id"
              value={v.buildingId}
              onChange={(e) => set({ buildingId: e.target.value })}
              hint={
                selected && selectedName
                  ? `Chosen: ${selectedName}`
                  : 'Choose a candidate below, click a building on the map, or search by name or id.'
              }
              error={errors.buildingId}
              spellCheck={false}
              autoComplete="off"
            />
            <TextInput
              label="Search campus buildings"
              value={buildingQuery}
              onChange={(e) => setBuildingQuery(e.target.value)}
              hint={campus.status === 'error' ? campus.message : 'Type at least 2 characters.'}
            />
            {matches.length > 0 ? (
              <ul className="flex flex-col gap-1" aria-label="Matching campus buildings">
                {matches.map((b) => (
                  <li key={b.id}>
                    <Button size="sm" variant="ghost" onClick={() => pick(b.id)}>
                      {b.displayName} · {b.id}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <CandidateMap
              campus={campus}
              candidates={detail.effective.candidateFootprints}
              selectedId={selected || null}
              onPick={pick}
              disabled={save.busy}
            />
          </div>
        ) : (
          <p className="text-sm text-muted">Unresolved: no building and no map location.</p>
        )}

        {needsBuilding ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium text-text">
              Evidence {v.status === 'verified' ? '(required for verified)' : '(optional)'}
            </legend>
            {errors.evidence ? (
              <p role="alert" className="text-sm text-danger">
                {errors.evidence}
              </p>
            ) : null}
            {v.evidence.map((e, i) => (
              <div
                key={i}
                className="flex flex-col gap-2 rounded-md border border-border p-3"
                aria-label={`Evidence ${i + 1}`}
                role="group"
              >
                <SelectField
                  label="Kind"
                  value={e.kind}
                  onChange={(x) => setEvidence(i, { kind: x.target.value as EvidenceKind })}
                  options={EVIDENCE_KINDS.map((k) => ({ value: k, label: EVIDENCE_KIND_LABELS[k] }))}
                />
                <TextArea
                  label={
                    e.kind === 'site-sign'
                      ? 'What the sign photo shows'
                      : e.kind === 'owner-statement'
                        ? 'Your statement'
                        : 'Document and where it says so'
                  }
                  value={e.description}
                  rows={2}
                  maxLength={500}
                  onChange={(x) => setEvidence(i, { description: x.target.value })}
                  error={errors[`evidence.${i}.description`]}
                />
                <TextInput
                  label={e.kind === 'official-document' ? 'Document URL (required)' : 'URL (optional)'}
                  type="url"
                  value={e.url}
                  onChange={(x) => setEvidence(i, { url: x.target.value })}
                  error={errors[`evidence.${i}.url`]}
                />
                <TextInput
                  label="Date"
                  type="date"
                  value={e.date}
                  max={today}
                  onChange={(x) => setEvidence(i, { date: x.target.value })}
                  error={errors[`evidence.${i}.date`]}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  className="w-fit"
                  onClick={() =>
                    setV((cur) => ({ ...cur, evidence: cur.evidence.filter((_, j) => j !== i) }))
                  }
                >
                  Remove this evidence
                </Button>
              </div>
            ))}
            {v.evidence.length < 10 ? (
              <Button
                size="sm"
                variant="secondary"
                icon="plus"
                className="w-fit"
                onClick={() =>
                  setV((cur) => ({ ...cur, evidence: [...cur.evidence, emptyEvidence('site-sign', today)] }))
                }
              >
                Add evidence
              </Button>
            ) : null}
          </fieldset>
        ) : null}

        <TextArea
          label={
            v.status === 'approximate'
              ? 'Private note (required: why only approximate)'
              : 'Private note (optional)'
          }
          hint="Admin only; never published."
          value={v.note}
          rows={3}
          maxLength={1000}
          onChange={(x) => set({ note: x.target.value })}
          error={errors.note}
        />

        {save.error && save.error.kind !== 'unprocessable' && save.error.kind !== 'invalid' ? (
          <ErrorNotice error={save.error} title="Could not save" onReload={onSaved} />
        ) : save.error ? (
          <ErrorNotice error={save.error} title="The server refused these values" />
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            loading={save.busy}
            disabled={!dirty && detail.decision !== null}
          >
            {v.status === 'verified' ? 'Save as verified' : 'Save'}
          </Button>
          <Button
            variant="ghost"
            disabled={!dirty || save.busy}
            onClick={() => {
              setV(initial);
              setTouched(false);
              save.clear();
            }}
          >
            Discard changes
          </Button>
        </div>
      </form>
    </Section>
  );
}
