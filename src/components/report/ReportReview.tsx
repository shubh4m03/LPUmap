import { useEffect, useId, useRef } from 'react';
import { useAnnounce } from '../../accessibility/index.ts';
import { copyText, downloadText } from '../../feedback/index.ts';
import { safeExternalUrl } from '../../utils/safe-url.ts';
import { ExternalLink } from '../place/index.ts';
import { Button, Icon, cx, useToast } from '../ui/index.ts';
import { BUTTON_BASE } from '../ui/cx.ts';

const OSM_EDIT_HELP = 'https://www.openstreetmap.org/fixthemap';

export interface ReportReviewProps {
  text: string;
  /** Prefilled tracker link, or null when this build has no tracker configured. */
  issueUrl: string | null;
  datasetVersion: string;
  onEdit: () => void;
  onDiscard: () => void;
}

/**
 * Shows the exact report text and the ways to share it. Nothing is sent from
 * here: the user copies, downloads or opens the tracker link themselves.
 */
export function ReportReview({ text, issueUrl, datasetVersion, onEdit, onDiscard }: ReportReviewProps) {
  const previewId = useId();
  const toast = useToast();
  const announce = useAnnounce();
  const url = issueUrl ? safeExternalUrl(issueUrl) : null;
  const host = url ? new URL(url).host : null;
  const noticeRef = useRef<HTMLDivElement>(null);
  // The submit button that led here is gone; keep focus inside the dialog, on the key message.
  useEffect(() => noticeRef.current?.focus(), []);

  const copy = async () => {
    const ok = await copyText(text);
    toast.show(
      ok
        ? { message: 'Report copied to the clipboard.', tone: 'success' }
        : { message: 'Could not copy. Select the text above and copy it manually.', tone: 'warning' },
    );
  };

  const download = () => {
    const ok = downloadText(`lpu-atlas-correction-${datasetVersion}`, text);
    if (ok) announce('Report downloaded as a text file.');
    else
      toast.show({
        message: 'This browser could not save the file. Copy the text instead.',
        tone: 'warning',
      });
  };

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div
        ref={noticeRef}
        tabIndex={-1}
        className="flex gap-2 rounded-md border border-border bg-surface-sunken p-3 focus-visible:outline-2 focus-visible:outline-focus"
      >
        <Icon name="info" size={18} className="mt-0.5 shrink-0 text-muted" />
        <p>
          <strong>Nothing has been sent.</strong> This app has no server. Share the report yourself using one
          of the options below. It contains only what you typed, the place reference and the dataset version:
          no location or device details.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <p id={previewId} className="font-medium">
          Report text
        </p>
        <pre
          aria-labelledby={previewId}
          tabIndex={0}
          className="max-h-48 overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-xs whitespace-pre-wrap break-words text-text"
        >
          {text}
        </pre>
      </div>

      {url ? (
        <div className="flex flex-col gap-2">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={cx(
              BUTTON_BASE,
              'h-10 gap-2 self-start bg-accent px-4 text-sm text-accent-contrast hover:bg-accent-hover',
            )}
          >
            <Icon name="external" size={18} />
            Open prefilled report
            <span className="sr-only">(opens {host} in a new tab)</span>
          </a>
          <p className="text-muted">
            Opens the project’s public issue tracker ({host}) with this text filled in. You review and submit
            it there; anything posted there is public.
          </p>
        </div>
      ) : (
        <p className="text-muted">
          No public report tracker is configured for this copy of the app. Copy or download the report and
          pass it to whoever maintains it. Most map data comes from OpenStreetMap, so you can also{' '}
          <ExternalLink href={OSM_EDIT_HELP}>fix it in OpenStreetMap</ExternalLink>.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant={url ? 'secondary' : 'primary'} icon="check" onClick={copy}>
          Copy report
        </Button>
        <Button variant="secondary" icon="download" onClick={download}>
          Download .txt
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button variant="ghost" icon="chevron-left" onClick={onEdit}>
          Edit
        </Button>
        <Button variant="ghost" icon="trash" onClick={onDiscard}>
          Discard draft and close
        </Button>
      </div>
      <p className="text-xs text-muted">
        Until you discard it, the draft is kept in this browser tab’s session storage only.
      </p>
    </div>
  );
}
