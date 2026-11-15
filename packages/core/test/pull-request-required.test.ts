import { expect, test } from 'bun:test';
import { RequiredContexts } from '../src/pull-request-required.ts';

test('a private repository whose plan has no branch rules requires nothing, read once per TTL and never logged', async () => {
  // What gh prints for a private repository on GitHub Free, seen 780 times in two days of one owner's log.
  const refusal = 'gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)';
  const loads: string[] = [];
  const logs: string[] = [];
  const required = new RequiredContexts(60_000, 1);
  const load = async (path: string) => { loads.push(path); throw new Error(refusal); };
  expect(await required.of('o/r#main', 'o/r', 'main', load, (line) => logs.push(line))).toEqual([]);
  await Bun.sleep(5);
  expect(await required.of('o/r#main', 'o/r', 'main', load, (line) => logs.push(line))).toEqual([]);
  expect(loads).toEqual(['repos/o/r/rules/branches/main?per_page=100', 'repos/o/r/branches/main']);
  expect(logs).toEqual([]);
});
