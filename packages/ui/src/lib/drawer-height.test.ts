import { afterEach, expect, test } from 'vitest';
import { DRAWER_MIN, DrawerHeight } from './drawer-height.svelte';

afterEach(() => localStorage.clear());

test('the drawer opens at 30 % of the chat, keeps a dragged height up to 70 %, and a reset forgets it', () => {
  const size = new DrawerHeight();
  size.room = 900;
  expect(size.visible).toBe(270);
  size.set(800);
  expect(size.visible).toBe(630);
  size.save();
  // Another drawer of the device opens where the drag left it.
  const next = new DrawerHeight();
  next.room = 900;
  expect(next.visible).toBe(630);
  next.reset();
  expect(next.visible).toBe(270);
  expect(new DrawerHeight().visible).toBeLessThan(630);
  // A short chat never squeezes the drawer under its floor.
  next.room = 200;
  expect(next.visible).toBe(DRAWER_MIN);
});
