import { EmptyState } from '../../components/ui/EmptyState.tsx';

/** Honest stand-in for a section whose screen is not built yet (never fake data). */
export function SectionPlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 md:p-6">
      <h1 className="text-xl font-semibold text-text">{title}</h1>
      <EmptyState icon="settings" title="This screen is not built yet" description={description} />
    </div>
  );
}
