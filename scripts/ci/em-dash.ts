// No tracked text file may contain U+2014. A fixture that must carry one, such as
// recorded provider output, writes it as an escape (`\u2014` in JSON or a string).
// Git searches the index, so it decides what is text and reads a file kept in
// another working-tree-encoding as the UTF-8 blob it stores.

/** `file:line:byte-column` of each em dash in the files Git tracks under `root`. */
export function checkEmDashes(root = process.cwd()): string[] {
  const found = Bun.spawnSync(['git', '-c', 'core.quotepath=off', 'grep', '--cached', '-z', '-o', '-n', '--column', '-I', '-F', '-e', '\u2014'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  if (found.exitCode === 1) return [];
  if (found.exitCode !== 0) throw new Error(`git grep failed in ${root}: ${found.stderr.toString().trim()}`);
  return found.stdout.toString().split('\n').filter(Boolean).map((match) => {
    const [file, line, column] = match.split('\0');
    return `${file}:${line}:${column}: no-em-dash: replace U+2014 with a comma, colon, parentheses or a new sentence`;
  });
}

if (import.meta.main) {
  const errors = checkEmDashes();
  for (const error of errors) console.error(error);
  if (errors.length) process.exit(1);
  console.log('No em dash in any tracked file');
}
