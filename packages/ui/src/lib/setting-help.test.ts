/**
 * `boite state settings` prints what each setting does in the words of its
 * Settings page, in English. The core cannot import the UI, so contracts hold
 * a copy of `settingHelp` (`setting-help.ts`); this test fails when the two
 * part, and `UPDATE_SETTING_HELP=1` rewrites the copy.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXPERIMENT_IDS, REQUESTABLE_SETTING_KEYS, SETTING_HELP, type RequestableKey } from '@boite/contracts';
import { expect, test } from 'vitest';
import { settingHelp } from './setting-requests';

function expected(): Record<string, string> {
  const keys: RequestableKey[] = [...REQUESTABLE_SETTING_KEYS, ...EXPERIMENT_IDS.map(id => `experiment.${id}` as const)];
  const table: Record<string, string> = {};
  for (const key of keys) {
    const help = settingHelp(key);
    if (help !== null) table[key] = help;
  }
  return table;
}

test('the help boite state settings prints is the English Settings pages show', () => {
  const table = expected();
  if (process.env.UPDATE_SETTING_HELP === '1') {
    const body = Object.entries(table).map(([key, text]) => `  ${JSON.stringify(key)}: ${JSON.stringify(text)},`).join('\n');
    writeFileSync(resolve(process.cwd(), '../contracts/src/setting-help.ts'), `/**
 * What each setting does, as its Settings page explains it in English
 * (\`settingHelp\` in packages/ui/src/lib/setting-requests.ts), for
 * \`boite state settings\`. A setting its page explains only by its name has
 * no entry. Written by packages/ui/src/lib/setting-help.test.ts with
 * UPDATE_SETTING_HELP=1, which fails when this copy and the app part.
 */
export const SETTING_HELP: Readonly<Record<string, string>> = {
${body}
};
`);
    return;
  }
  expect(SETTING_HELP, 'run UPDATE_SETTING_HELP=1 bunx vitest run src/lib/setting-help.test.ts in packages/ui').toEqual(table);
});
