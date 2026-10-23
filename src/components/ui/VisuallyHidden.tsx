import type { ReactNode } from 'react';

/** Text available to assistive technology but not shown on screen. */
export function VisuallyHidden({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <span id={id} className="sr-only">
      {children}
    </span>
  );
}

/** Keyboard key hint, e.g. <Kbd>/</Kbd>. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded-sm border border-border-strong bg-surface-sunken px-1.5 font-mono text-xs leading-5 text-muted">
      {children}
    </kbd>
  );
}
