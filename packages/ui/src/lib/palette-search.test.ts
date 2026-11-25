import { expect, test } from 'vitest';
import { matchThreadFields, type ThreadField } from './palette-search';

const fields: ThreadField[] = [
  { field: 'title', text: 'Fix VS Code sidePanel' },
  { field: 'project', text: 'Arasoft' },
  { field: 'model', text: 'Opus 5.5' },
  { field: 'model', text: 'claude-opus-5-5' },
  { field: 'branch', text: 'feat/résumé' },
  { field: 'pr', text: '#123' },
];

test('matches across project and model, with the model as the hint', () => {
  const expected = {
    titleRanges: [],
    matchHint: { field: 'model', text: 'Opus 5.5', ranges: [{ start: 0, end: 4 }] },
  };
  expect(matchThreadFields('opus arasoft', fields)).toMatchObject(expected);
  expect(matchThreadFields('arasoft OPUS', fields)).toMatchObject(expected);
});

test('matches joined words, camel case starts, exact phrases and accents', () => {
  expect(matchThreadFields('vscode panel', fields)?.titleRanges).toEqual([{ start: 4, end: 11 }, { start: 16, end: 21 }]);
  expect(matchThreadFields('"fix vs code" resume', fields)).toMatchObject({
    titleRanges: [{ start: 0, end: 11 }],
    matchHint: { field: 'branch', text: 'feat/résumé', ranges: [{ start: 5, end: 11 }] },
  });
  expect(matchThreadFields('"code fix"', fields)).toBeNull();
  expect(matchThreadFields('"opus arasoft"', fields)).toBeNull();
  expect(matchThreadFields('resume', [{ field: 'title', text: 'Pre\u0301parer un re\u0301sume\u0301' }])?.titleRanges)
    .toEqual([{ start: 13, end: 21 }]);
});

test('tolerates one edit or a swap and keeps pull request numbers exact', () => {
  for (const typo of ['arasoftt', 'arsoft', 'arasoat', 'raasoft', 'arasfot']) {
    expect(matchThreadFields(typo, fields)?.matchHint?.field).toBe('project');
  }
  expect(matchThreadFields('xrasoft', fields)).toBeNull();
  expect(matchThreadFields('#123', fields)?.matchHint?.field).toBe('pr');
  expect(matchThreadFields('#12', fields)).toBeNull();
  expect(matchThreadFields('#124', fields)).toBeNull();
});
