import { afterEach, expect, test } from 'vitest';
import { arriveSurface, reducedMotion } from './surface-swap';

afterEach(() => { delete document.documentElement.dataset['motion']; document.body.innerHTML = ''; });

function surface(): HTMLElement {
  const node = document.createElement('div');
  document.body.append(node);
  return node;
}

// The old swap delayed the new surface by the old one's exit: the box went
// through empty frames. The new one now starts in the frame the old one leaves.
test('a panel switch shows the new surface at once: no delay before it', () => {
  const next = surface();
  arriveSurface(next, false);
  expect(next.dataset['arriving']).toBe('');
  expect(next.style.animationDelay).toBe('');
});

test('under reduced motion the switch is a cut: no settle', () => {
  document.documentElement.dataset['motion'] = 'reduced';
  expect(reducedMotion()).toBe(true);
  const next = surface();
  arriveSurface(next);
  expect(next.dataset['arriving']).toBeUndefined();
});
