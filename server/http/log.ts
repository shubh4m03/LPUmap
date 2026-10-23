/**
 * Structured logging with a closed field set. By construction it cannot log
 * request bodies, cookies, auth headers, tokens, IP addresses or
 * coordinates: callers pass only the whitelisted scalar fields below, and
 * free-text error messages are scrubbed before output.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  /** Static event name, e.g. 'request', 'login-failed'. */
  event: string;
  method?: string;
  /** Route pattern (e.g. '/suggestions/:id'), never the raw URL. */
  route?: string;
  status?: number;
  code?: string;
  ms?: number;
  /** Static reason string chosen by the caller (never user input). */
  reason?: string;
  errorName?: string;
  errorMessage?: string;
}

const ALLOWED: ReadonlyArray<keyof LogFields> = [
  'event',
  'method',
  'route',
  'status',
  'code',
  'ms',
  'reason',
  'errorName',
  'errorMessage',
];

/**
 * Removes anything that could identify a person or a place from free text:
 * numbers (coordinates, IPs, ids), IPv6-like groups, emails, long tokens.
 */
export function scrubText(text: string): string {
  return text
    .slice(0, 300)
    .replace(/[^\s@]+@[^\s@]+/g, '[email]')
    .replace(/\b[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}\b/gi, '[addr]')
    .replace(/[A-Za-z0-9_\-+/=]{24,}/g, '[token]')
    .replace(/\d+(\.\d+)?/g, '#');
}

export type LogSink = (level: LogLevel, line: string) => void;

const consoleSink: LogSink = (level, line) => {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
};

let sink: LogSink = consoleSink;

/** Test hook: redirect log output. Returns a restore function. */
export function setLogSink(next: LogSink): () => void {
  const prev = sink;
  sink = next;
  return () => {
    sink = prev;
  };
}

export function log(level: LogLevel, fields: LogFields): void {
  const out: Record<string, string | number> = { level };
  for (const key of ALLOWED) {
    const value = fields[key];
    if (value === undefined) continue;
    if (typeof value === 'number') out[key] = Number.isFinite(value) ? Math.round(value) : 0;
    else out[key] = key === 'errorMessage' ? scrubText(value) : String(value).slice(0, 120);
  }
  sink(level, JSON.stringify(out));
}

export function logError(event: string, err: unknown, extra: Omit<LogFields, 'event'> = {}): void {
  const name = err instanceof Error ? err.name : typeof err;
  const message = err instanceof Error ? err.message : '';
  log('error', { ...extra, event, errorName: name, errorMessage: message });
}
