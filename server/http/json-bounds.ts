/**
 * Structural bounds for parsed JSON bodies, checked BEFORE schema validation
 * so a hostile body cannot make Zod (or later geometry code) walk an
 * unbounded structure. JSON.parse already turns NaN/Infinity literals into
 * syntax errors, but an overflowing literal such as `1e999` parses to
 * Infinity — rejected here, as is any non-finite number.
 */
import { HttpError } from './errors.ts';

export interface JsonBounds {
  /** Maximum nesting depth (the top-level value is depth 1). */
  maxDepth: number;
  /** Maximum elements in any one array. */
  maxArrayLength: number;
  /** Maximum keys in any one object. */
  maxObjectKeys: number;
  /** Maximum values in the whole document. */
  maxNodes: number;
}

/** Studio bodies: the deepest legal shape (a template variant's roof) is depth 6. */
export const STUDIO_JSON_BOUNDS: JsonBounds = {
  maxDepth: 12,
  maxArrayLength: 512,
  maxObjectKeys: 64,
  maxNodes: 8192,
};

const reject = (message: string): never => {
  throw new HttpError('invalid', `Request body is invalid: ${message}`, {
    issues: [{ path: '(root)', message }],
  });
};

/** Throws HttpError('invalid') when `value` exceeds `bounds` or holds a non-finite number. */
export function assertJsonBounds(value: unknown, bounds: JsonBounds = STUDIO_JSON_BOUNDS): void {
  let nodes = 0;
  // Iterative walk: a deeply nested body must not exhaust the call stack before it is rejected.
  const stack: { v: unknown; depth: number }[] = [{ v: value, depth: 1 }];
  while (stack.length > 0) {
    const { v, depth } = stack.pop()!;
    nodes += 1;
    if (nodes > bounds.maxNodes) reject(`more than ${bounds.maxNodes} values`);
    if (depth > bounds.maxDepth) reject(`nested deeper than ${bounds.maxDepth} levels`);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) reject('numbers must be finite');
    } else if (Array.isArray(v)) {
      if (v.length > bounds.maxArrayLength) reject(`an array has more than ${bounds.maxArrayLength} items`);
      for (const item of v) stack.push({ v: item, depth: depth + 1 });
    } else if (v !== null && typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length > bounds.maxObjectKeys) reject(`an object has more than ${bounds.maxObjectKeys} keys`);
      for (const k of keys) stack.push({ v: (v as Record<string, unknown>)[k], depth: depth + 1 });
    }
  }
}
