import { useId, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button.tsx';
import { TextInput } from '../../components/ui/TextInput.tsx';

export interface LoginFormProps {
  busy: boolean;
  /** Why the form is shown (wrong password, ended session…), or null. */
  message: string | null;
  onSubmit(password: string): void;
}

/** Password-mode sign-in. The password is sent once and never stored by the page. */
export function LoginForm({ busy, message, onSubmit }: LoginFormProps) {
  const [password, setPassword] = useState('');
  const messageId = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || password.length === 0) return;
    onSubmit(password);
    setPassword('');
  };
  return (
    <form
      onSubmit={submit}
      aria-describedby={message ? messageId : undefined}
      className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border bg-surface-raised p-6 shadow-2"
    >
      <h1 className="text-xl font-semibold text-text">Sign in to Campus Atlas admin</h1>
      {message ? (
        <p id={messageId} role="alert" className="text-sm text-text">
          {message}
        </p>
      ) : null}
      <TextInput
        label="Owner password"
        type="password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={busy}
      />
      <Button type="submit" variant="primary" loading={busy} disabled={password.length === 0}>
        Sign in
      </Button>
    </form>
  );
}
