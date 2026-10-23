import { Suspense, type ReactNode } from 'react';
import { Spinner } from '../ui/index.ts';

/** Suspense boundary for a lazily loaded panel body: a labelled status while it loads. */
export function PanelSuspense({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center p-6">
          <Spinner label={label} />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
