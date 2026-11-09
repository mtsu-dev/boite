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

test('the heading keeps the picked level while a hovered dot gets a ring, its own name and its cost in a lighter ink, and leaving puts the ends back', () => {
  const onpick = vi.fn();
  open('low', onpick);
  const level = () => query('[data-testid=effort-level]');
  const cost = () => query('[data-testid=effort-cost]');
  const preview = () => document.querySelector('[data-testid=effort-preview]');
  const ends = () => [...document.querySelectorAll('[data-testid=effort-ends] .end')].map((end) => end.textContent);
  // At rest: the live level, the scale's two ends by name, and the line of that level.
  expect(level().textContent).toBe('Low');
  expect(ends()).toEqual(['Off', 'High']);
  expect(preview()).toBeNull();
  expect(cost().textContent).toBe('Quick answers, light on your limits');
  expect(cost().classList.contains('previewing')).toBe(false);
  // jsdom lays nothing out: give the line a width so the pointer lands on the last dot.
  const line = query('[data-testid=effort-track] .line');
  line.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 4, right: 200, bottom: 4, x: 0, y: 0, toJSON() {} }) as DOMRect;
  const track = query('[data-testid=effort-track]');
  track.dispatchEvent(Object.assign(new MouseEvent('pointermove', { bubbles: true, clientX: 199 }), { pointerType: 'mouse' }));
  flushSync();
  // The pick stays named and filled; the preview is a ring on its dot and a name under it.
  expect(level().textContent).toBe('Low');
  expect(preview()?.textContent).toBe('High');
  expect(query('[data-dot=high]').classList.contains('hovered')).toBe(true);
  expect(query('[data-testid=effort-ends]').classList.contains('previewing')).toBe(true);
  expect(Array.from(document.querySelectorAll('.dot.on')).map((dot) => dot.getAttribute('data-dot'))).toEqual(['off', 'low']);
  expect(cost().textContent).toBe('Thinks it through, a little slower');
  expect(cost().classList.contains('previewing')).toBe(true);
  // A finger has no hover: it previews nothing.
  track.dispatchEvent(new MouseEvent('pointerleave'));
  flushSync();
  track.dispatchEvent(Object.assign(new MouseEvent('pointermove', { bubbles: true, clientX: 199 }), { pointerType: 'touch' }));
  flushSync();
  expect(preview()).toBeNull();
  expect(cost().textContent).toBe('Quick answers, light on your limits');
  expect(onpick).not.toHaveBeenCalled();
});

test('the cost line follows the level by its name, not its place: High on a six-level scale is never the balanced middle', () => {
  const scale: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultrathink'].map((id) => ({ id, label: id }));
  mounted = mount(EffortSlider, { target: document.body, props: { levels: scale, active: 'high', onpick() {} } });
  flushSync();
  query<HTMLButtonElement>('[data-testid=composer-effort]').click();
  flushSync();
  expect(query('[data-testid=effort-cost]').textContent).toBe('Thinks it through, a little slower');
});

test('with Fast on, the cost line says what the level and Fast do together, never slower and sooner at once', () => {
  const scale: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'].map((id) => ({ id, label: id }));
  mounted = mount(EffortSlider, { target: document.body, props: { levels: scale, active: 'high', onpick() {}, speeds: [{ id: 'fast', label: 'Fast' }], speed: 'fast', onspeed() {} } });
  flushSync();
  query<HTMLButtonElement>('[data-testid=composer-effort]').click();
  flushSync();
  const line = query('[data-testid=effort-cost]').textContent;
  expect(line).toBe('Thinks it through, with Fast replying sooner for more of your limits');
  expect(line).not.toContain('slower');
});

test('the fast switch reads its name beside the bolt whether it is on or off', async () => {
  const onspeed = vi.fn();
  mounted = mount(EffortSlider, { target: document.body, props: { levels: LEVELS, active: 'low', onpick() {}, speeds: [{ id: 'fast', label: 'Fast' }], speed: null, onspeed } });
  flushSync();
  query<HTMLButtonElement>('[data-testid=composer-effort]').click();
  flushSync();
  // Off is a switch to turn on, named, not a bare outline.
  expect(query('[data-testid=effort-speed-label]').textContent).toBe('Fast');
  expect(query('[data-testid=effort-speed] .switch').classList.contains('on')).toBe(false);
  query<HTMLButtonElement>('[data-testid=effort-speed]').click();
  expect(onspeed).toHaveBeenCalledWith('fast');
  await unmount(mounted);
  document.body.innerHTML = '';
  mounted = mount(EffortSlider, { target: document.body, props: { levels: LEVELS, active: 'low', onpick() {}, speeds: [{ id: 'fast', label: 'Fast' }], speed: 'fast', onspeed } });
  flushSync();
  query<HTMLButtonElement>('[data-testid=composer-effort]').click();
  flushSync();
  expect(query('[data-testid=effort-speed-label]').textContent).toBe('Fast');
  expect(query('[data-testid=effort-speed] .switch').classList.contains('on')).toBe(true);
});

test("a bot's effort chip names its level and opens nothing", () => {
  mounted = mount(EffortSlider, { target: document.body, props: { levels: LEVELS, active: 'high', onpick() {}, readonly: true, readonlyHint: "Set in Ada's settings" } });
  flushSync();
  const chip = query<HTMLElement>('[data-testid=composer-effort]');
  expect(chip.tagName).toBe('SPAN');
  expect(chip.textContent?.trim()).toBe('High');
  expect(chip.getAttribute('title')).toBe("Set in Ada's settings");
  chip.click();
  flushSync();
  expect(document.querySelector('[data-testid=composer-effort-menu]')).toBeNull();
});
