import { Button, ErrorState } from '../../components/ui/index.ts';
import { APP_CONFIG } from '../../config/index.ts';
import type { DatasetErrorCode } from '../../data/index.ts';

export interface DataErrorScreenProps {
  code: DatasetErrorCode | 'unknown';
  onRetry(): void;
}

const MESSAGES: Record<
  Exclude<DataErrorScreenProps['code'], 'schema-version'>,
  { title: string; message: string }
> = {
  network: {
    title: 'Campus data could not be downloaded',
    message: 'Check your internet connection and try again. Once loaded, the map also works offline.',
  },
  invalid: {
    title: 'Campus data failed its integrity check',
    message:
      'The downloaded data did not match the expected format, so it was not used. Try again; if this keeps happening, the published dataset may be damaged.',
  },
  unknown: {
    title: 'Campus data could not be loaded',
    message: 'Something unexpected went wrong while loading. Try again.',
  },
};

export function DataErrorScreen({ code, onRetry }: DataErrorScreenProps) {
  return (
    <main className="flex min-h-full flex-col items-center justify-center bg-surface px-4 text-text">
      <h1 className="sr-only">{APP_CONFIG.brand.name}</h1>
      {code === 'schema-version' ? (
        <div role="alert" className="flex max-w-md flex-col items-center gap-3 text-center">
          <p className="text-base font-semibold">A newer data format is available — reload</p>
          <p className="text-sm text-muted">
            The campus data was updated in a format this version of the app cannot read. Reloading fetches the
            matching app version.
          </p>
          <Button variant="primary" icon="reset" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      ) : (
        <ErrorState title={MESSAGES[code].title} message={MESSAGES[code].message} onRetry={onRetry} />
      )}
    </main>
  );
}
