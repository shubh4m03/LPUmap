import { useRef, useState } from 'react';
import { useFavorites, useRecents } from '../../favorites/index.ts';
import { usePrivacySettings } from '../../privacy/index.ts';
import { Button, Dialog, useToast } from '../ui/index.ts';
import { PanelSection } from './PanelSection.tsx';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Clear all local data" with a confirmation dialog; nothing is removed without it. */
export function ClearDataSection() {
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const favoriteCount = useFavorites((s) => s.ids.length);
  const recentCount = useRecents((s) => s.ids.length);
  const clearAllLocalData = usePrivacySettings((s) => s.clearAllLocalData);
  const toast = useToast();

  const open = () => setConfirming(true);
  const close = () => setConfirming(false);

  const confirm = () => {
    // Every in-memory store (favourites, recents, drafts, theme) resets via registerLocalDataReset.
    clearAllLocalData();
    close();
    toast.show({
      message:
        'Cleared: saved places, recent places, settings and any correction draft were deleted from this device.',
      tone: 'success',
    });
  };

  return (
    <PanelSection
      title="Data on this device"
      icon="trash"
      description={`Right now: ${plural(favoriteCount, 'saved place', 'saved places')} and ${plural(
        recentCount,
        'recent place',
        'recent places',
      )}, plus your settings.`}
    >
      <Button variant="danger" icon="trash" className="self-start" onClick={open}>
        Clear all local data
      </Button>
      <Dialog
        open={confirming}
        onClose={close}
        title="Clear all local data?"
        size="sm"
        initialFocus={cancelRef}
        footer={
          <>
            <Button ref={cancelRef} variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button variant="danger" icon="trash" onClick={confirm}>
              Clear data
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2 text-sm">
          <p>This deletes everything this app stored in this browser:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>{plural(favoriteCount, 'saved place', 'saved places')}</li>
            <li>{plural(recentCount, 'recent place', 'recent places')}</li>
            <li>Theme and history settings (back to their defaults)</li>
            <li>Any unsent correction draft</li>
          </ul>
          <p className="text-muted">
            It cannot be undone. The offline copy of the app and campus data contains no personal data and is
            kept so the map still works offline.
          </p>
        </div>
      </Dialog>
    </PanelSection>
  );
}
