import { afterEach, expect, test } from 'vitest';
import { arriveSurface, leaveSurface, reducedMotion } from './surface-swap';

afterEach(() => { delete document.documentElement.dataset['motion']; document.body.innerHTML = ''; });

/** A panel body holding one surface, with the motion tokens app.css gives it. */
function surface(): HTMLElement {
  const body = document.createElement('div');
  const node = document.createElement('div');
  node.style.setProperty('--dur-exit', '140ms');
  body.append(node);
  document.body.append(body);
  return node;
}

test('a panel switch fades the old surface out, then the new one in: never both at once', () => {
  const old = surface();
  const leaving = leaveSurface(old, false);
  expect(leaving.duration).toBe(140);
  expect(leaving.css?.(0.5)).toBe('opacity: 0.5');
  const next = surface();
  arriveSurface(next, false);
  // The new one starts its fade when the old one has finished its own.
  expect(next.dataset['arriving']).toBe('');
  expect(next.style.animationDelay).toBe(`${leaving.duration}ms`);
});

test('under reduced motion the switch is a cut: no fade out, no fade in', () => {
  document.documentElement.dataset['motion'] = 'reduced';
  expect(reducedMotion()).toBe(true);
  const old = surface();
  expect(leaveSurface(old)).toEqual({ duration: 0 });
  expect(old.style.position).toBe('');
  const next = surface();
  arriveSurface(next);
  expect(next.dataset['arriving']).toBeUndefined();
  expect(next.style.animationDelay).toBe('');
});
