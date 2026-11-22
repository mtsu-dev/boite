import { expect, test } from 'bun:test';
import { TRANSFER } from './pr-report.test.ts';
import { judge } from './transfer.ts';

test('growth above a ceiling fails until the body explains it', () => {
  const grown = { ...TRANSFER, opencode: { ...TRANSFER.opencode, snapshot: 3_000 } };
  const failed = judge(grown, TRANSFER, '`bbbbbbbb` (main thread-transfer artifact)', undefined);
  expect(failed.errors).toEqual(['OpenCode snapshot: 3,000, ceiling 2,164 (main 2,143). Shrink what the change sends, or say what grows and why under a "## Thread transfer" heading in the pull request body, then rerun this job.']);
  expect(failed.report).toContain('Base: `bbbbbbbb` (main thread-transfer artifact).');
  const explained = judge(grown, TRANSFER, 'main', 'The reopened page now carries <b>tool</b> titles.');
  expect(explained.errors).toEqual([]);
  expect(explained.report).toContain('explained in the body: The reopened page now carries &#60;b&#62;tool&#60;/b&#62; titles.');
  expect(judge(grown, null, 'none', undefined)).toMatchObject({ errors: [] });
});
