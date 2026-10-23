import { Icon, Spinner } from '../../components/ui/index.ts';
import { APP_CONFIG } from '../../config/index.ts';

export function LoadingScreen() {
  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-4 bg-surface px-6 text-center text-text">
      <span
        aria-hidden="true"
        className="inline-flex size-14 items-center justify-center rounded-xl bg-accent-soft text-accent-text"
      >
        <Icon name="school" size={30} />
      </span>
      <div>
        <h1 className="text-xl font-semibold">{APP_CONFIG.brand.name}</h1>
        <p className="text-sm text-muted">{APP_CONFIG.brand.institution}</p>
      </div>
      <Spinner label="Loading campus data…" />
    </main>
  );
}
