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
  expect(query('[data-testid=composer-effort]').textContent?.trim()).toBe('Effort Default');
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
  expect(query('[data-testid=composer-effort]').textContent?.trim()).toBe('Effort Low');
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

test('the popover holds one word: the picked level, or in a lighter ink the dot under a mouse, which gets a ring and picks nothing', () => {
  const onpick = vi.fn();
  open('low', onpick);
  const level = () => query('[data-testid=effort-level]');
  // At rest: the live level and nothing else to read, no ends under the track, no line of cost.
  expect(level().textContent).toBe('Low');
  expect(level().classList.contains('previewing')).toBe(false);
  expect(document.querySelector('[data-testid=effort-ends]')).toBeNull();
  expect(document.querySelector('[data-testid=effort-cost]')).toBeNull();
  expect(document.querySelector('[data-testid=composer-effort-menu] p')).toBeNull();
  // jsdom lays nothing out: give the line a width so the pointer lands on the last dot.
  const line = query('[data-testid=effort-track] .line');
  line.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 4, right: 200, bottom: 4, x: 0, y: 0, toJSON() {} }) as DOMRect;
  const track = query('[data-testid=effort-track]');
  track.dispatchEvent(Object.assign(new MouseEvent('pointermove', { bubbles: true, clientX: 199 }), { pointerType: 'mouse' }));
  flushSync();
  // The heading names the hovered dot as a preview, rolling up from the name it replaces; the fill stays on the pick.
  expect(level().textContent).toBe('High');
  expect(level().classList.contains('previewing')).toBe(true);
  expect(level().querySelector('.word')?.getAttribute('data-from')).toBe('Low');
  expect(level().querySelector('.word')?.classList.contains('down')).toBe(false);
  expect(query('[data-dot=high]').classList.contains('hovered')).toBe(true);
  expect(Array.from(document.querySelectorAll('.dot.on')).map((dot) => dot.getAttribute('data-dot'))).toEqual(['off', 'low']);
  // Leaving puts the picked level back, rolling the other way.
  track.dispatchEvent(new MouseEvent('pointerleave'));
  flushSync();
  expect(level().textContent).toBe('Low');
  expect(level().classList.contains('previewing')).toBe(false);
  expect(level().querySelector('.word')?.classList.contains('down')).toBe(true);
  // A finger has no hover: it previews nothing.
  track.dispatchEvent(Object.assign(new MouseEvent('pointermove', { bubbles: true, clientX: 199 }), { pointerType: 'touch' }));
  flushSync();
  expect(level().textContent).toBe('Low');
  expect(onpick).not.toHaveBeenCalled();
});

test('a held thumb names the level under it at once and follows the drag, and picks only when let go', () => {
  const onpick = vi.fn();
  open('low', onpick);
  const level = () => query('[data-testid=effort-level]');
  const line = query('[data-testid=effort-track] .line');
  line.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 4, right: 200, bottom: 4, x: 0, y: 0, toJSON() {} }) as DOMRect;
  const track = query<HTMLElement>('[data-testid=effort-track]');
  track.setPointerCapture = () => {};
  track.hasPointerCapture = () => false;
  track.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 199 }), { pointerId: 1 }));
  flushSync();
  // Held on the last dot: its name in the full ink, the thumb and the fill under the pointer.
  expect(level().textContent).toBe('High');
  expect(level().classList.contains('previewing')).toBe(false);
  expect(track.classList.contains('held')).toBe(true);
  expect(track.getAttribute('aria-valuenow')).toBe('2');
  expect(onpick).not.toHaveBeenCalled();
  track.dispatchEvent(Object.assign(new MouseEvent('pointermove', { bubbles: true, clientX: 0 }), { pointerId: 1 }));
  flushSync();
  expect(level().textContent).toBe('Off');
  expect(level().querySelector('.word')?.getAttribute('data-from')).toBe('High');
  expect(onpick).not.toHaveBeenCalled();
  track.dispatchEvent(Object.assign(new MouseEvent('pointerup', { bubbles: true, clientX: 0 }), { pointerId: 1 }));
  flushSync();
  expect(onpick).toHaveBeenCalledWith('off');
  expect(track.classList.contains('held')).toBe(false);
});

test('a hovered dot previews nothing once the popover closes, nor after a drag', () => {
  const onpick = vi.fn();
  open('low', onpick);
  const level = () => query('[data-testid=effort-level]');
  const hover = (clientX: number) => {
    const line = query('[data-testid=effort-track] .line');
    line.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 4, right: 200, bottom: 4, x: 0, y: 0, toJSON() {} }) as DOMRect;
    query('[data-testid=effort-track]').dispatchEvent(Object.assign(new MouseEvent('pointermove', { bubbles: true, clientX }), { pointerType: 'mouse' }));
    flushSync();
  };
  hover(199);
  expect(level().textContent).toBe('High');
  // Escape takes the track away under the pointer, which never leaves it: reopened, the heading reads the pick.
  query('[data-testid=effort-track]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  flushSync();
  query<HTMLButtonElement>('[data-testid=composer-effort]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  flushSync();
  expect(query('[data-testid=composer-effort-menu]')).not.toBeNull();
  expect(level().textContent).toBe('Low');
  expect(level().classList.contains('previewing')).toBe(false);
  // A drag from a hovered dot to another: the dot it left previews nothing once it ends.
  hover(199);
  expect(level().textContent).toBe('High');
  const track = query<HTMLElement>('[data-testid=effort-track]');
  track.setPointerCapture = () => {};
  track.hasPointerCapture = () => false;
  track.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0 }), { pointerId: 1 }));
  flushSync();
  track.dispatchEvent(Object.assign(new MouseEvent('pointerup', { bubbles: true, clientX: 0 }), { pointerId: 1 }));
  flushSync();
  expect(onpick).toHaveBeenCalledWith('off');
  expect(level().classList.contains('previewing')).toBe(false);
  expect(document.querySelector('.dot.hovered')).toBeNull();
});

test('the fast bolt reads its name whether it is on or off, with no switch beside it', async () => {
  const onspeed = vi.fn();
  mounted = mount(EffortSlider, { target: document.body, props: { levels: LEVELS, active: 'low', onpick() {}, speeds: [{ id: 'fast', label: 'Fast' }], speed: null, onspeed } });
  flushSync();
  query<HTMLButtonElement>('[data-testid=composer-effort]').click();
  flushSync();
  // Off is a named button to turn on, not a bare outline.
  expect(query('[data-testid=effort-speed-label]').textContent).toBe('Fast');
  expect(query('[data-testid=effort-speed]').classList.contains('active')).toBe(false);
  expect(document.querySelector('[data-testid=effort-speed] .switch')).toBeNull();
  query<HTMLButtonElement>('[data-testid=effort-speed]').click();
  expect(onspeed).toHaveBeenCalledWith('fast');
  await unmount(mounted);
  document.body.innerHTML = '';
  mounted = mount(EffortSlider, { target: document.body, props: { levels: LEVELS, active: 'low', onpick() {}, speeds: [{ id: 'fast', label: 'Fast' }], speed: 'fast', onspeed } });
  flushSync();
  query<HTMLButtonElement>('[data-testid=composer-effort]').click();
  flushSync();
  expect(query('[data-testid=effort-speed-label]').textContent).toBe('Fast');
  expect(query('[data-testid=effort-speed]').classList.contains('active')).toBe(true);
});

test('the chip names what it sets then the level, with no step meter; a speed alone reads as itself', () => {
  mounted = mount(EffortSlider, { target: document.body, props: { levels: LEVELS, active: 'low', onpick() {} } });
  flushSync();
  const chip = query<HTMLElement>('[data-testid=composer-effort]');
  expect(chip.textContent?.trim()).toBe('Effort Low');
  expect(chip.querySelector('.name')?.textContent).toBe('Effort');
  // The accessible name is the visible one, value included.
  expect(chip.hasAttribute('aria-label')).toBe(false);
  expect(chip.querySelector('[data-testid=effort-meter], .meter, .step')).toBeNull();
  unmount(mounted);
  mounted = mount(EffortSlider, { target: document.body, props: { levels: [], active: null, onpick() {}, speeds: [{ id: 'fast', label: 'Fast' }] } });
  flushSync();
  expect(query('[data-testid=composer-effort]').textContent?.trim()).toBe('Standard speed');
});

test("a mochi's effort chip names its level and opens nothing", () => {
  mounted = mount(EffortSlider, { target: document.body, props: { levels: LEVELS, active: 'high', onpick() {}, readonly: true, readonlyHint: "Set in Ada's settings" } });
  flushSync();
  const chip = query<HTMLElement>('[data-testid=composer-effort]');
  expect(chip.tagName).toBe('SPAN');
  expect(chip.textContent?.trim()).toBe('Effort High');
  expect(chip.getAttribute('title')).toBe("Set in Ada's settings");
  chip.click();
  flushSync();
  expect(document.querySelector('[data-testid=composer-effort-menu]')).toBeNull();
});
