// No tracked text file may contain U+2014. A fixture that must carry one, such as
// recorded provider output, writes it as an escape (`\u2014` in JSON or a string).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const EM_DASH = Buffer.from('\u2014');

/** `line:column` of each em dash in a text buffer; a buffer with a NUL byte is binary and skipped. */
export function emDashes(data: Buffer): string[] {
  if (data.subarray(0, 8000).includes(0)) return [];
  const found: string[] = [];
  let line = 1;
  let lineStart = 0;
  let scanned = 0;
  for (let at = data.indexOf(EM_DASH); at !== -1; at = data.indexOf(EM_DASH, at + EM_DASH.length)) {
    for (let i = scanned; i < at; i++) if (data[i] === 0x0a) { line++; lineStart = i + 1; }
    scanned = at;
    found.push(`${line}:${data.subarray(lineStart, at).toString('utf8').length + 1}`);
  }
  return found;
}

export function checkEmDashes(root = process.cwd()): string[] {
  const listed = Bun.spawnSync(['git', 'ls-files', '-z'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  if (listed.exitCode !== 0) throw new Error(`git ls-files failed in ${root}: ${listed.stderr.toString().trim()}`);
  return listed.stdout.toString().split('\0').filter(Boolean).flatMap((file) => {
    let data: Buffer;
    try { data = readFileSync(join(root, file)); } catch { return []; } // Deleted but still staged.
    return emDashes(data).map((at) => `${file}:${at}: no-em-dash: replace U+2014 with a comma, colon, parentheses or a new sentence`);
  });
}

if (import.meta.main) {
  const errors = checkEmDashes();
  for (const error of errors) console.error(error);
  if (errors.length) process.exit(1);
  console.log('No em dash in any tracked file');
}
