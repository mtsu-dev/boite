// No tracked text file may contain U+2014. A fixture that must carry one, such as
// recorded provider output, writes it as an escape (`\u2014` in JSON or a string).
// Git searches the index, so it decides what is text and reads a file kept in
// another working-tree-encoding as the UTF-8 blob it stores.

const EM_DASH = Buffer.from('\u2014');

/** `file:line:byte-column` of each em dash in the files Git tracks under `root`. */
export function checkEmDashes(root = process.cwd()): string[] {
  const found = Bun.spawnSync(['git', 'grep', '--cached', '-z', '-n', '--no-column', '--no-color', '-I', '-F', '-e', '\u2014'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  if (found.exitCode === 1) return [];
  if (found.exitCode !== 0) throw new Error(`git grep failed in ${root}: ${found.stderr.toString().trim()}`);

  // Some Git versions misreport later columns with -o --column. Count bytes in the matching line.
  const { stdout } = found;
  const errors: string[] = [];
  for (let recordStart = 0; recordStart < stdout.length;) {
    const pathEnd = stdout.indexOf(0, recordStart);
    const lineNumberEnd = stdout.indexOf(0, pathEnd + 1);
    const textStart = lineNumberEnd + 1;
    const textEnd = stdout.indexOf(0x0a, textStart);
    const path = stdout.toString('utf8', recordStart, pathEnd);
    const line = stdout.toString('ascii', pathEnd + 1, lineNumberEnd);
    const matchedLine = stdout.subarray(textStart, textEnd);
    for (let at = matchedLine.indexOf(EM_DASH); at !== -1; at = matchedLine.indexOf(EM_DASH, at + EM_DASH.length)) {
      errors.push(`${path}:${line}:${at + 1}: no-em-dash: replace U+2014 with a comma, colon, parentheses or a new sentence`);
    }
    recordStart = textEnd + 1;
  }
  return errors;
}

if (import.meta.main) {
  const errors = checkEmDashes();
  for (const error of errors) console.error(error);
  if (errors.length) process.exit(1);
  console.log('No em dash in any tracked file');
}
