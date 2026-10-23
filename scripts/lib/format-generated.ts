/**
 * Formats generated repository files (quality report, JSON Schemas) with the
 * project's Prettier config so `npm run format:check` stays green after a
 * rebuild. public/data is excluded from Prettier and is never touched here.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type * as Prettier from 'prettier';

export async function formatGeneratedFiles(paths: readonly string[]): Promise<string | null> {
  let prettier: typeof Prettier;
  try {
    prettier = await import('prettier');
  } catch {
    return 'prettier is not installed; generated docs/schemas were left unformatted';
  }
  for (const filepath of paths) {
    const options = (await prettier.resolveConfig(filepath)) ?? {};
    const text = readFileSync(filepath, 'utf8');
    const formatted = await prettier.format(text, { ...options, filepath });
    if (formatted !== text) writeFileSync(filepath, formatted);
  }
  return null;
}
