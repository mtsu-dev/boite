import { afterEach, expect, test } from 'vitest';
import { ARRIVE_SHIFT, arriveSurface, reducedMotion } from './surface-swap';
import { panelPlace } from './panel-choices';

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

// A switch says where the new panel sits: it starts a few
// pixels from its side of the launcher's order, and a kind with no side (or a browser's native view) only fades.
test('a panel switch slides in from the side of the new panel in the launcher, a few pixels only', () => {
  expect(panelPlace('files')).toBeGreaterThan(panelPlace('changes'));
  expect(panelPlace('file')).toBe(panelPlace('files'));
  const later = surface();
  arriveSurface(later, false, panelPlace('trace') - panelPlace('changes'));
  expect(later.style.getPropertyValue('--arrive-x')).toBe(`${ARRIVE_SHIFT}px`);
  const earlier = surface();
  arriveSurface(earlier, false, panelPlace('changes') - panelPlace('trace'));
  expect(earlier.style.getPropertyValue('--arrive-x')).toBe(`${-ARRIVE_SHIFT}px`);
  expect(ARRIVE_SHIFT).toBeLessThanOrEqual(12);
  const same = surface();
  arriveSurface(same, false, 0);
  expect(same.style.getPropertyValue('--arrive-x')).toBe('');
});
