/** Minimal `--flag value` / `--switch` argument parser for the data scripts. */
export interface ParsedArgs {
  values: Record<string, string>;
  flags: Set<string>;
}

export function parseArgs(
  argv: readonly string[],
  valued: readonly string[],
  switches: readonly string[],
): ParsedArgs {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const [rawKey, inline] = arg.split(/=(.*)/s, 2) as [string, string | undefined];
    const key = rawKey.replace(/^--/, '');
    if (!rawKey.startsWith('--')) throw new Error(`Unexpected argument "${arg}"`);
    if (switches.includes(key)) {
      flags.add(key);
    } else if (valued.includes(key)) {
      const v = inline ?? argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`--${key} needs a value`);
      values[key] = v;
    } else {
      throw new Error(
        `Unknown option --${key}. Known: ${[...valued, ...switches].map((k) => `--${k}`).join(', ')}`,
      );
    }
  }
  return { values, flags };
}
