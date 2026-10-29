/**
 * "Suggest a missing place" panel (desktop side panel / mobile sheet).
 * Step 1 places the point on the map (click + drag on desktop, centre pin on
 * phones, or the map centre from the keyboard); step 2 is the form; step 3
 * is the server's answer. "Submitted for review" is shown only after the
 * server confirmed it, and it never says the place is on the map.
 */
import { useCallback, useEffect, useId, useRef, type FormEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAnnounce, useIsMobile } from '../../accessibility/index.ts';
import { cameraOf, getMapController } from '../../app/map-controller.ts';
import { useAppStore } from '../../app/store/index.ts';
import { isMapViewMode } from '../../app/view-mode.ts';
import { LIMITS } from '../../community/index.ts';
import { ASSIGNABLE_CATEGORY_IDS } from '../../community/index.ts';
import { getCategory } from '../../config/index.ts';
import { Button, Icon, TextInput, cx } from '../ui/index.ts';
import { roundPoint } from './useSuggestEditing.ts';
import {
  OUTSIDE_AREA_MESSAGE,
  SUGGEST_FIELD_ORDER,
  serverIssueErrors,
  validateSuggestion,
  type SuggestField,
} from './suggest-model.ts';
import { useSuggestStore } from './suggest-store.ts';
import { submitSuggestion, waitText, type SubmitOutcome } from './submit.ts';

const CATEGORY_OPTIONS = ASSIGNABLE_CATEGORY_IDS.map((id) => ({ id, label: getCategory(id).label })).sort(
  (a, b) => a.label.localeCompare(b.label),
);

const FIELD = cx(
  'w-full rounded-md border border-border-strong bg-surface-sunken px-3 text-base text-text',
  'aria-invalid:border-danger focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus',
);

const fmt = (p: readonly number[]) => `${p[1]!.toFixed(6)}, ${p[0]!.toFixed(6)}`;

export function SuggestPanel() {
  const step = useSuggestStore((s) => s.step);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Each step starts with its heading focused, so keyboard and screen-reader users land on it.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);
  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      {step === 'place' ? <PlaceStep headingRef={headingRef} /> : null}
      {step === 'details' ? <DetailsStep headingRef={headingRef} /> : null}
      {step === 'submitted' ? <SubmittedStep headingRef={headingRef} /> : null}
    </div>
  );
}

type HeadingRef = { headingRef: React.RefObject<HTMLHeadingElement | null> };

function StepHeading({ headingRef, n, children }: HeadingRef & { n?: number; children: string }) {
  return (
    <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-text outline-none">
      {n ? <span className="text-muted">Step {n} of 2 · </span> : null}
      {children}
    </h2>
  );
}

function PlaceStep({ headingRef }: HeadingRef) {
  const mobile = useIsMobile();
  const announce = useAnnounce();
  const { point, reticleCenter } = useSuggestStore(
    useShallow((s) => ({ point: s.point, reticleCenter: s.reticleCenter })),
  );
  const { viewMode, lastMapMode, mapUnavailable, listMode } = useAppStore(
    useShallow((s) => ({
      viewMode: s.viewMode,
      lastMapMode: s.lastMapMode,
      mapUnavailable: s.mapUnavailable,
      listMode: s.listMode,
    })),
  );
  const closePanel = useAppStore((s) => s.closePanel);
  const store = useSuggestStore.getState;

  if (listMode || mapUnavailable) {
    return (
      <>
        <StepHeading headingRef={headingRef}>Suggest a missing place</StepHeading>
        <p className="text-sm text-text">
          Placing a suggestion needs the interactive map, which is not available here
          {mapUnavailable ? ` (${mapUnavailable})` : ''}. Please try again on a device or browser that can
          show the map.
        </p>
        <Button onClick={closePanel}>Close</Button>
      </>
    );
  }
  if (!isMapViewMode(viewMode)) {
    return (
      <>
        <StepHeading headingRef={headingRef} n={1}>
          Where is it?
        </StepHeading>
        <p className="text-sm text-text">
          The point is placed on the map. Switch from the overview to the map to place it.
        </p>
        <Button
          variant="primary"
          icon="map-2d"
          onClick={() => useAppStore.getState().setViewMode(lastMapMode)}
        >
          Show the map
        </Button>
        <Button variant="ghost" onClick={closePanel}>
          Cancel
        </Button>
      </>
    );
  }

  const useCentre = () => {
    const c = getMapController();
    const cam = c ? cameraOf(c) : null;
    if (cam) {
      store().setPoint(roundPoint(cam.center));
      announce('Point placed at the map centre.');
    }
  };

  if (mobile) {
    return (
      <>
        <StepHeading headingRef={headingRef} n={1}>
          Where is it?
        </StepHeading>
        <p className="text-sm text-text">
          Move the map until the centre pin is on the place, then tap “Use this position”.
        </p>
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            size="lg"
            icon="pin"
            disabled={!reticleCenter}
            onClick={() => {
              if (!reticleCenter) return;
              store().setPoint(reticleCenter);
              store().setStep('details');
            }}
          >
            Use this position
          </Button>
          <Button size="lg" variant="ghost" onClick={closePanel}>
            Cancel
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <StepHeading headingRef={headingRef} n={1}>
        Where is it?
      </StepHeading>
      <p className="text-sm text-text">
        Click the map where the place is. Drag the marker to adjust it. Keyboard: move the map with the arrow
        keys, then use the map centre.
      </p>
      <p className="text-sm text-muted" aria-live="polite">
        {point ? `Marker at ${fmt(point)}.` : 'No point placed yet.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button icon="pin" onClick={useCentre}>
          Use the map centre
        </Button>
        <Button variant="primary" disabled={!point} onClick={() => store().setStep('details')}>
          Continue
        </Button>
        <Button variant="ghost" onClick={closePanel}>
          Cancel
        </Button>
      </div>
    </>
  );
}

function outcomeMessage(o: SubmitOutcome): { title: string; text: string } | null {
  switch (o.kind) {
    case 'submitted':
      return null;
    case 'rate-limited':
      return {
        title: 'Too many suggestions from this connection',
        text: `To prevent spam, only a few suggestions are accepted at a time. Nothing was saved. Please try again in ${waitText(o.retryAfterS)}.`,
      };
    case 'invalid':
      return {
        title: 'Some details need fixing',
        text: 'Nothing was saved. Check the highlighted fields and send it again.',
      };
    case 'outside-area':
      return { title: 'Outside the map area', text: `${OUTSIDE_AREA_MESSAGE} Nothing was saved.` };
    case 'too-large':
      return {
        title: 'Too long',
        text: 'The suggestion is longer than the server accepts. Shorten the description and try again.',
      };
    case 'refused':
      return {
        title: 'The request was refused',
        text: 'A security check refused it before it was saved. Reload the page and try again.',
      };
    case 'no-api':
      return {
        title: 'Suggestions are not available on this version of the site',
        text: 'This copy of the atlas runs without its server, so suggestions cannot be received here. Nothing was sent.',
      };
    case 'unavailable':
      return {
        title: 'Suggestions are temporarily unavailable',
        text: 'The server could not accept suggestions right now. Nothing was saved. Please try again later.',
      };
    case 'unknown':
      return {
        title: 'No confirmation received',
        text: 'The suggestion was sent, but no confirmation came back, so it is not known whether it was received. If you send it again it may arrive twice.',
      };
  }
}

function DetailsStep({ headingRef }: HeadingRef) {
  const id = useId();
  const announce = useAnnounce();
  const { point, values, errors, submitting, outcome } = useSuggestStore(
    useShallow((s) => ({
      point: s.point,
      values: s.values,
      errors: s.errors,
      submitting: s.submitting,
      outcome: s.outcome,
    })),
  );
  const closePanel = useAppStore((s) => s.closePanel);
  const store = useSuggestStore.getState;
  const refs = useRef<Partial<Record<SuggestField, HTMLElement | null>>>({});
  const reg = useCallback(
    (k: SuggestField) => (el: HTMLElement | null) => {
      refs.current[k] = el;
    },
    [],
  );
  // A new failure message is scrolled into view once (it sits below the form).
  const revealOnMount = useCallback(
    (el: HTMLElement | null) => el?.scrollIntoView?.({ block: 'nearest' }),
    [],
  );
  const focusFirst = (errs: Partial<Record<SuggestField, string>>) => {
    const first = SUGGEST_FIELD_ORDER.find((k) => errs[k]);
    if (first) refs.current[first]?.focus();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const v = validateSuggestion(values, point);
    if (!v.ok) {
      store().setErrors(v.errors);
      store().setOutcome(null);
      announce('Some details need fixing.');
      focusFirst(v.errors);
      return;
    }
    store().setErrors({});
    store().setOutcome(null);
    store().setSubmitting(true);
    const result = await submitSuggestion(v.body);
    store().setSubmitting(false);
    store().setOutcome(result);
    if (result.kind === 'submitted') {
      store().setStep('submitted');
      announce('Submitted for review. It is not on the public map until it is approved.');
      return;
    }
    if (result.kind === 'invalid') {
      const errs = serverIssueErrors(result.issues);
      store().setErrors(errs);
      focusFirst(errs);
    }
    if (result.kind === 'outside-area') store().setErrors({ location: OUTSIDE_AREA_MESSAGE });
    const m = outcomeMessage(result);
    if (m) announce(m.title);
  };

  const failure = outcome ? outcomeMessage(outcome) : null;
  const err = (k: SuggestField) => errors[k];
  const ids = (k: string) => `${id}-${k}`;

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
      <StepHeading headingRef={headingRef} n={2}>
        About the place
      </StepHeading>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-sunken p-3 text-sm">
        <span className="flex items-center gap-2 text-text">
          <Icon name="pin" size={18} className="text-muted" />
          {point ? fmt(point) : 'No point placed'}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={submitting}
          ref={reg('location')}
          onClick={() => store().setStep('place')}
        >
          Change position
        </Button>
      </div>
      {err('location') ? (
        <p role="alert" className="text-sm text-danger">
          {err('location')}
        </p>
      ) : null}

      <TextInput
        ref={reg('name')}
        label="Name"
        required
        autoComplete="off"
        maxLength={LIMITS.name.max}
        value={values.name}
        onChange={(e) => store().setValues({ name: e.target.value })}
        error={err('name')}
        disabled={submitting}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids('cat')} className="text-sm font-medium text-text">
          Kind of place
        </label>
        <select
          ref={reg('categoryId')}
          id={ids('cat')}
          required
          value={values.categoryId}
          onChange={(e) => store().setValues({ categoryId: e.target.value })}
          aria-invalid={err('categoryId') ? true : undefined}
          aria-describedby={err('categoryId') ? ids('cat-error') : undefined}
          disabled={submitting}
          className={cx(FIELD, 'h-11')}
        >
          <option value="">Choose…</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        {err('categoryId') ? (
          <p id={ids('cat-error')} className="text-sm text-danger">
            {err('categoryId')}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids('desc')} className="text-sm font-medium text-text">
          Description (optional)
        </label>
        <textarea
          ref={reg('description')}
          id={ids('desc')}
          rows={3}
          maxLength={LIMITS.description}
          value={values.description}
          onChange={(e) => store().setValues({ description: e.target.value })}
          aria-invalid={err('description') ? true : undefined}
          aria-describedby={`${ids('desc-hint')}${err('description') ? ` ${ids('desc-error')}` : ''}`}
          disabled={submitting}
          className={cx(FIELD, 'py-2')}
        />
        <p id={ids('desc-hint')} className="text-sm text-muted">
          What is it, and what can people find there?
        </p>
        {err('description') ? (
          <p id={ids('desc-error')} className="text-sm text-danger">
            {err('description')}
          </p>
        ) : null}
      </div>
      <TextInput
        ref={reg('landmark')}
        label="Nearby landmark (optional)"
        hint="For example “ground floor, next to the main entrance”."
        autoComplete="off"
        maxLength={LIMITS.landmark}
        value={values.landmark}
        onChange={(e) => store().setValues({ landmark: e.target.value })}
        error={err('landmark')}
        disabled={submitting}
      />
      <TextInput
        ref={reg('evidenceUrl')}
        label="Evidence link (optional)"
        hint="A public page that shows the place, e.g. an official notice. Not a personal profile."
        type="url"
        inputMode="url"
        autoComplete="off"
        maxLength={LIMITS.url}
        value={values.evidenceUrl}
        onChange={(e) => store().setValues({ evidenceUrl: e.target.value })}
        error={err('evidenceUrl')}
        disabled={submitting}
      />
      {/* Honeypot: invisible to people and assistive technology; bots that fill it are discarded by the server. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden" inert>
        <label htmlFor={ids('website')}>Leave this field empty</label>
        <input
          id={ids('website')}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={(e) => store().setValues({ website: e.target.value })}
        />
      </div>

      <p className="text-sm text-muted">
        The site owner reviews every suggestion before anything is added to the map. Do not include personal
        information. No account or contact details are collected, so you will not get a reply.
      </p>
      {failure ? (
        <div
          key={outcome?.kind}
          ref={revealOnMount}
          role="alert"
          className="flex flex-col gap-1 rounded-md border border-danger/40 bg-danger-soft p-3 text-sm text-text"
        >
          <p className="font-semibold">{failure.title}</p>
          <p>{failure.text}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="lg" loading={submitting} icon="check">
          {outcome?.kind === 'unknown' ? 'Send again' : 'Send for review'}
        </Button>
        <Button size="lg" variant="ghost" onClick={closePanel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function SubmittedStep({ headingRef }: HeadingRef) {
  const outcome = useSuggestStore((s) => s.outcome);
  const closePanel = useAppStore((s) => s.closePanel);
  if (outcome?.kind !== 'submitted') return null;
  return (
    <div role="status" className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <Icon name="check" size={22} className="mt-0.5 shrink-0 text-success" />
        <StepHeading headingRef={headingRef}>Submitted for review</StepHeading>
      </div>
      <p className="text-sm text-text">{outcome.message}</p>
      <p className="text-sm text-muted">
        Reference: <code className="break-all text-text">{outcome.reference}</code>
      </p>
      {outcome.possibleDuplicates.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-sunken p-3 text-sm">
          <p className="font-medium text-text">Similar places already nearby</p>
          <p className="text-muted">The reviewer will check whether your suggestion is one of these:</p>
          <ul className="list-disc ps-5 text-text">
            {outcome.possibleDuplicates.map((d) => (
              <li key={`${d.kind}:${d.id}`}>
                {d.name} ({Math.round(d.distanceM)} m away)
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon="plus" onClick={() => useSuggestStore.getState().reset()}>
          Suggest another place
        </Button>
        <Button variant="ghost" onClick={closePanel}>
          Close
        </Button>
      </div>
    </div>
  );
}
