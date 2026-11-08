import { expect, test } from 'vitest';
import { shortPaths } from './short-paths';

// The Changes file menu listed two `+page.svelte` rows no one could tell apart.
test('two files of one name read with the folders that tell them apart, the others by their name', () => {
  const names = shortPaths(['src/routes/a/+page.svelte', 'src/routes/b/+page.svelte', 'src/lib/api/contacts.ts', 'web/x/index.ts', 'app/x/index.ts']);
  expect([...names.values()]).toEqual(['a/+page.svelte', 'b/+page.svelte', 'contacts.ts', 'web/x/index.ts', 'app/x/index.ts']);
});

test('a path that is the tail of another stays whole', () => {
  expect([...shortPaths(['index.ts', 'src/index.ts']).values()]).toEqual(['index.ts', 'src/index.ts']);
});
