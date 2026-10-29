import type { ReactNode } from 'react';
import { Button } from '../../components/ui/index.ts';
import { ErrorState } from '../../components/ui/index.ts';
import { Spinner } from '../../components/ui/index.ts';
import { useAdminSession, useAdminSessionClient } from '../context.ts';
import type { SessionInfo } from '../api/schemas.ts';
import { LoginForm } from './LoginForm.tsx';

function Centered({ children }: { children: ReactNode }) {
  return (
    <main id="admin-main" className="flex min-h-dvh items-center justify-center bg-surface p-4 text-text">
      {children}
    </main>
  );
}

/**
 * Renders `children(session)` ONLY in the `signed-in` state (the server has
 * confirmed the session). Every other state shows what is needed: the login
 * form (password mode), the Access notice, the not-configured notice or an
 * error with a retry — never a blank screen and never admin controls.
 */
export function SessionGate({ children }: { children: (session: SessionInfo) => ReactNode }) {
  const state = useAdminSession();
  const client = useAdminSessionClient();

  switch (state.status) {
    case 'signed-in':
      return <>{children(state.session)}</>;
    case 'checking':
      return (
        <Centered>
          <Spinner label="Checking your admin session…" />
        </Centered>
      );
    case 'signed-out':
      return (
        <Centered>
          <LoginForm busy={state.busy} message={state.message} onSubmit={(p) => void client.login(p)} />
        </Centered>
      );
    case 'access-required':
      return (
        <Centered>
          <div className="flex max-w-md flex-col items-start gap-3 rounded-lg border border-border bg-surface-raised p-6">
            <h1 className="text-xl font-semibold">Sign-in required</h1>
            <p className="text-sm text-muted">{state.message}</p>
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </Centered>
      );
    case 'not-configured':
      return (
        <Centered>
          <div className="flex max-w-md flex-col gap-3 rounded-lg border border-border bg-surface-raised p-6">
            <h1 className="text-xl font-semibold">Administration unavailable</h1>
            <p className="text-sm text-muted">{state.message}</p>
          </div>
        </Centered>
      );
    case 'error':
      return (
        <Centered>
          <ErrorState
            title="Could not check your admin session"
            message={state.message}
            onRetry={() => void client.check()}
          />
        </Centered>
      );
  }
}
