import { EXPERIMENT_IDS, EXPERIMENT_STAGES } from '@boite/contracts';
import { expect, test } from 'vitest';
import { experimentCopy } from './experiment-copy';

test('every experiment with a switch has its words, and a finished feature has none', () => {
  const copy = experimentCopy();
  for (const id of EXPERIMENT_IDS) {
    if (EXPERIMENT_STAGES[id] === 'experimental') expect(copy[id]?.title, id).toBeTruthy();
    else expect(copy[id], id).toBeUndefined();
  }
});
