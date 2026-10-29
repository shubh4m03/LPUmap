import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from '../../components/ui/index.ts';

interface Props {
  /** Changing it (e.g. the section name) clears a previous failure. */
  resetKey: string;
  children: ReactNode;
}

interface State {
  failedKey: string | null;
}

/**
 * Catches a section that failed to load (chunk download) or to render, and
 * shows a retry instead of a blank page. Nothing here hides a failed save:
 * API errors are values handled by the sections themselves.
 */
export class SectionBoundary extends Component<Props, State> {
  override state: State = { failedKey: null };

  static getDerivedStateFromError(): Partial<State> {
    return { failedKey: '__pending__' };
  }

  override componentDidCatch(_error: unknown, _info: ErrorInfo): void {
    this.setState({ failedKey: this.props.resetKey });
  }

  override render() {
    const { failedKey } = this.state;
    if (failedKey !== null && (failedKey === '__pending__' || failedKey === this.props.resetKey)) {
      return (
        <ErrorState
          className="m-4"
          title="This section could not be opened"
          message="It may not have downloaded completely. Reload the page to try again; nothing was changed."
          onRetry={() => window.location.reload()}
          retryLabel="Reload"
        />
      );
    }
    return this.props.children;
  }
}
