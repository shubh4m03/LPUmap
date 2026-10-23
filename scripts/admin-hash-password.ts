/**
 * Prints a PBKDF2 hash for OWNER_PASSWORD_HASH. Reads the password from stdin
 * (no echo on a TTY; piped input accepted for CI) and prints only the hash —
 * the password is never echoed or logged.
 *
 *   npm run admin:hash-password
 *   printf '%s' "$PASSWORD" | npm run --silent admin:hash-password
 */
import { stdin, stdout, stderr, exit } from 'node:process';
import { MIN_PASSWORD_LENGTH, hashPassword } from '../server/auth/password.ts';

async function readPiped(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
}

function readTty(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const done = (err?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stderr.write('\n');
      if (err) reject(err);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return done();
        if (ch === '\u0003') return done(new Error('Cancelled'));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  let password: string;
  if (stdin.isTTY) {
    password = await readTty('Owner password (input hidden): ');
    const again = await readTty('Repeat password: ');
    if (again !== password) {
      stderr.write('Passwords do not match.\n');
      exit(1);
    }
  } else {
    password = await readPiped();
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    stderr.write(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.\n`);
    exit(1);
  }
  stdout.write(`${await hashPassword(password)}\n`);
}

main().catch((err: unknown) => {
  stderr.write(`${err instanceof Error ? err.message : 'Failed'}\n`);
  exit(1);
});
