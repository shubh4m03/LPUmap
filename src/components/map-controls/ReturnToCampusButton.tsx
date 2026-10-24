import type { CSSProperties } from 'react';
import { useAppStore } from '../../app/store/index.ts';
import { Button } from '../ui/Button.tsx';
import { cx } from '../ui/cx.ts';

export const RETURN_TO_CAMPUS_LABEL = 'Back to campus';

/**
 * Shown while no part of the campus is on screen (every map mode and size):
 * one tap glides back to the whole-campus view (a jump with reduced motion).
 */
export function ReturnToCampusButton({ className, style }: { className?: string; style?: CSSProperties }) {
  const requestFocus = useAppStore((s) => s.requestFocus);
  return (
    <Button
      variant="secondary"
      size="sm"
      icon="reset"
      style={style}
      className={cx('shadow-2 pointer-coarse:min-h-11', className)}
      onClick={() => requestFocus({ kind: 'reset' })}
    >
      {RETURN_TO_CAMPUS_LABEL}
    </Button>
  );
}
