import { expect, test } from 'vitest';
import type { Message } from '@boite/contracts';
import { BLOCK_GAP, ESTIMATE, GAP, SlotClasses, SlotTotals, THUMB_HEIGHT, estimateSlot, gapChanged, slotGap } from './message-window';

test('a measured slot carries the gap its row keeps above it, and a changed seam asks for a new measure', () => {
  expect(slotGap(null, false)).toBe(GAP);
  expect(slotGap(null, true)).toBe(BLOCK_GAP);
  expect(slotGap('block', false)).toBe(BLOCK_GAP);
  // A message carrying on its turn keeps the same block gap as a cut message's rest.
  expect(slotGap('part', false)).toBe(BLOCK_GAP);
  const node = document.createElement('article');
  // Never measured: nothing to correct yet.
  expect(gapChanged(node, 'part', false)).toBe(false);
  node.dataset['gap'] = String(GAP);
  // An older page landed above: the row now joins the message over it.
  expect(gapChanged(node, 'part', false)).toBe(true);
  expect(gapChanged(node, null, false)).toBe(false);
});

test('an unmeasured row is estimated from its length class, and a class measured once is worth its mean', () => {
  const said = (role: Message['role'], chars: number, id = 'm'): Message => ({ id, threadId: 't', turnId: 'u', role, state: 'complete', createdAt: 0, parts: [{ type: 'text', text: 'x'.repeat(chars) }] });
  const classes = new SlotClasses();
  // A short reply stays at the fixed estimate; a 30 KB answer is worth its lines, not 80 px.
  expect(estimateSlot(said('assistant', 40), classes)).toBe(ESTIMATE);
  const long = estimateSlot(said('assistant', 30_000), classes);
  expect(long).toBeGreaterThan(5000);
  // Two answers of the same class measured at 6,000 and 8,000 px: a third one is worth their mean.
  classes.learn(said('assistant', 20_000), 6000);
  classes.learn(said('assistant', 24_000), 8000);
  expect(estimateSlot(said('assistant', 30_000), classes)).toBe(7000);
  // Another role or another power of two is another class.
  expect(estimateSlot(said('user', 30_000), classes)).toBe(long);
  expect(estimateSlot(said('assistant', 70_000), classes)).toBeGreaterThan(long);
  // Pictures keep their row of thumbnails, never a mean.
  const pictured: Message = { ...said('user', 10), parts: [{ type: 'text', text: 'see' }, { type: 'image', mimeType: 'image/png', data: '' } as Message['parts'][number]] };
  classes.learn(pictured, 900);
  expect(estimateSlot(pictured, classes)).toBe(ESTIMATE + THUMB_HEIGHT + 10);
});

test('restoring saved totals forgets the positions of the thread they served in between', () => {
  const totals = new SlotTotals(new Map());
  const first = [{ id: 'a1' }, { id: 'a2' }] as never[];
  const second = [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }] as never[];
  totals.totals(first, 'first');
  const saved = totals.save(10)!;
  totals.totals(second, 'second');
  totals.restore(saved, first, 'first');
  expect([...totals.positions.keys()]).toEqual(['a1', 'a2']);
});
