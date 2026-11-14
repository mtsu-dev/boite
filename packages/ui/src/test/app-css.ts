import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** `app.css` as the browser gets it: every file it imports, inlined in order. */
export function appCss(): string {
  const index = join(import.meta.dirname, '..', 'app.css');
  return readFileSync(index, 'utf8').replace(/^@import '(.+)';$/gm, (_all, file: string) => readFileSync(join(dirname(index), file), 'utf8'));
}
