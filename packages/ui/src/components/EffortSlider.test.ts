import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { EffortLevel } from '@boite/contracts';
import EffortSlider from './EffortSlider.svelte';

const LEVELS: EffortLevel[] = [
  { id: 'off', label: 'Off' },
  { id: 'low', label: 'Low' },
  { id: 'high', label: 'High' }
];

let mounted: ReturnType<typeof mount> | undefined;
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = '';
});

function query<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`no ${selector}`);
  return node;
}

function open(active: string | null, onpick: (id: string) => void, ondefault?: () => void): void {
  mounted = mount(EffortSlider, { target: document.body, props: { levels: LEVELS, active, onpick, ondefault } });
  flushSync();
  query<HTMLButtonElement>('[data-testid=composer-effort]').click();
  flushSync();
}

test('a model whose agent keeps its own level reads Default, with no level lit, until one is picked', () => {
  const onpick = vi.fn();
  // A pi model other than the session's: no level picked and no default known.
  open(null, onpick);
  expect(query('[data-testid=composer-effort]').textContent?.trim()).toBe('Default');
  expect(query('[data-testid=composer-effort-menu] .heading').textContent?.trim()).toBe('Default');
  expect(document.querySelectorAll('[data-testid=composer-effort-menu] .dot.on')).toHaveLength(0);
  expect(document.querySelector('[data-testid=composer-effort-menu] .thumb')).toBeNull();
  expect(query('[data-testid=effort-track]').getAttribute('aria-valuetext')).toBe('Default');

  // Even the first level is a pick, not the level already running.
  query<HTMLButtonElement>('[data-testid=composer-effort-menu] [data-dot=off]').click();
  expect(onpick).toHaveBeenCalledWith('off');
});

test('a known level lights its dots and names itself', () => {
  open('low', vi.fn());
  expect(query('[data-testid=composer-effort]').textContent?.trim()).toBe('Low');
  expect(Array.from(document.querySelectorAll('[data-testid=composer-effort-menu] .dot.on')).map(dot => dot.getAttribute('data-dot'))).toEqual(['off', 'low']);
  expect(document.querySelector('[data-testid=composer-effort-menu] .thumb')).not.toBeNull();
});

test('a level picked on such a model can be handed back to the agent with Default', () => {
  const ondefault = vi.fn();
  open('high', vi.fn(), ondefault);
  query<HTMLButtonElement>('[data-testid=effort-default]').click();
  expect(ondefault).toHaveBeenCalledOnce();
});

test('the Default switch is absent while the agent already picks, and for a model with a default', async () => {
  open(null, vi.fn(), vi.fn());
  expect(document.querySelector('[data-testid=effort-default]')).toBeNull();
  await unmount(mounted!);
  document.body.innerHTML = '';
  open('high', vi.fn());
  expect(document.querySelector('[data-testid=effort-default]')).toBeNull();
});

test('a hovered dot names its level in the heading and its cost under the track before any click, and leaving puts the live one back', () => {
  const onpick = vi.fn();
  open('low', onpick);
  const level = () => query('[data-testid=effort-level]');
  const cost = () => query('[data-testid=effort-cost]').textContent;
  // At rest: the live level, in the middle of the scale, costs the balanced line.
  expect(level().textContent).toBe('Low');
  expect(level().classList.contains('previewing')).toBe(false);
  expect(cost()).toBe('Balanced depth and speed');
  // jsdom lays nothing out: give the line a width so the pointer lands on the last dot.
  const line = query('[data-testid=effort-track] .line');
  line.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 4, right: 200, bottom: 4, x: 0, y: 0, toJSON() {} }) as DOMRect;
  const track = query('[data-testid=effort-track]');
  track.dispatchEvent(Object.assign(new MouseEvent('pointermove', { bubbles: true, clientX: 199 }), { pointerType: 'mouse' }));
  flushSync();
  expect(level().textContent).toBe('High');
  expect(level().classList.contains('previewing')).toBe(true);
  expect(cost()).toBe('Deepest thinking, slowest and costliest');
  // A finger has no hover: it previews nothing.
  track.dispatchEvent(new MouseEvent('pointerleave'));
  flushSync();
  track.dispatchEvent(Object.assign(new MouseEvent('pointermove', { bubbles: true, clientX: 0 }), { pointerType: 'touch' }));
  flushSync();
  expect(level().textContent).toBe('Low');
  expect(cost()).toBe('Balanced depth and speed');
  expect(onpick).not.toHaveBeenCalled();
});
