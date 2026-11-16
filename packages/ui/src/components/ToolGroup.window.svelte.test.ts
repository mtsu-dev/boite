import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { ActivityPart, ToolPart } from '../lib/tool-groups';
import ToolGroup from './ToolGroup.svelte';

/*
 * An opened run of a thousand steps in a 400 pixel chat: each step is a 34
 * pixel row, what the window counts before it measures one, until its body is
 * open (200 pixels), so twelve rows meet the view.
 */
const VIEW = 400, ROW = 34, OPEN_ROW = 200;
/** What a window may draw: the rows that meet the view, six of overscan on each side, and a focused row kept from far away. */
const MOST = Math.ceil(VIEW / ROW) + 1 + 2 * 6 + 1;

let component: ReturnType<typeof mount> | null = null;
afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const settle = async () => { for (let i = 0; i < 10; i++) { await Promise.resolve(); flushSync(); } };
const call = (id: number): ToolPart => ({ type: 'tool', toolId: `call-${id}`, name: 'Bash', input: { command: `echo ${id}` }, output: `out ${id}`, status: 'done', exitCode: 0 });
const cards = (root: HTMLElement) => root.querySelectorAll('[data-testid=tool-card]');
const card = (root: HTMLElement, id: number) => [...cards(root)].find(node => new RegExp(`echo ${id}(?!\\d)`).test(node.textContent ?? '')) as HTMLElement | undefined;
const scrollTo = async (root: HTMLElement, top: number) => { root.scrollTop = top; root.dispatchEvent(new Event('scroll')); await settle(); };

async function opened(count: number) {
  const root = document.createElement('div');
  root.dataset['scrollRoot'] = '';
  document.body.append(root);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(VIEW);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const height = this.dataset['windowKey'] ? this.querySelector('[data-testid=tool-output]') ? OPEN_ROW : ROW : VIEW;
    return new DOMRect(0, this === root ? 0 : -root.scrollTop, 600, height);
  });
  const props = $state({ parts: Array.from({ length: count }, (_, id): ActivityPart => call(id)), isBackground: () => false });
  component = mount(ToolGroup, { target: root, props });
  flushSync();
  root.querySelector<HTMLButtonElement>('[data-testid=tool-group-toggle]')!.click();
  await settle();
  return { root, props };
}

test('an opened run of 1,000 steps mounts the rows in view and their overscan, and scrolling reaches every step', async () => {
  const { root } = await opened(1000);
  expect(root.querySelector('[data-testid=tool-group]')?.getAttribute('data-count')).toBe('1000');
  expect(cards(root).length).toBeLessThanOrEqual(MOST);
  expect(card(root, 0)).toBeDefined();
  await scrollTo(root, 500 * ROW);
  expect(card(root, 500)).toBeDefined();
  expect(card(root, 0)).toBeUndefined();
  await scrollTo(root, 1000 * ROW - VIEW);
  expect(card(root, 999)).toBeDefined();
  expect(cards(root).length).toBeLessThanOrEqual(MOST);
});

test('a step appended to a running opened run shows at the bottom the chat follows', async () => {
  const { root, props } = await opened(1000);
  await scrollTo(root, 1000 * ROW - VIEW);
  props.parts.push({ ...call(1000), status: 'running', exitCode: null });
  await settle();
  expect(root.querySelector('[data-testid=tool-group]')?.getAttribute('data-count')).toBe('1001');
  // The chat pinned to its bottom takes the new row in; the window follows the scroll.
  await scrollTo(root, 1001 * ROW - VIEW);
  expect(card(root, 1000)).toBeDefined();
  expect(cards(root).length).toBeLessThanOrEqual(MOST);
});

test('a step opened in a long run keeps its body and its taller row after scrolling out and back', async () => {
  const { root } = await opened(1000);
  await scrollTo(root, 500 * ROW);
  card(root, 502)!.querySelector<HTMLButtonElement>('[data-testid=tool-toggle]')!.click();
  await settle();
  expect(card(root, 502)!.querySelector('[data-testid=tool-output]')?.textContent).toBe('out 502');
  await scrollTo(root, 0);
  expect(card(root, 502)).toBeUndefined();
  await scrollTo(root, 500 * ROW);
  expect(card(root, 502)!.querySelector('[data-testid=tool-output]')?.textContent).toBe('out 502');
  // Its measured height counts: the run is one open body taller than a thousand folded rows.
  const spacers = [...root.querySelectorAll<HTMLElement>('.window-list > .spacer')].reduce((sum, node) => sum + parseFloat(node.style.height), 0);
  const rows = [...root.querySelectorAll<HTMLElement>('[data-window-key]')].reduce((sum, node) => sum + node.getBoundingClientRect().height, 0);
  expect(spacers + rows).toBe(999 * ROW + OPEN_ROW);
});

test('the keyboard walks across steps out of the window and the focused step survives scrolling away', async () => {
  const { root } = await opened(1000);
  const first = card(root, 0)!.querySelector<HTMLButtonElement>('[data-testid=tool-toggle]')!;
  first.focus();
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await settle();
  expect(document.activeElement?.closest('[data-testid=tool-card]')).toBe(card(root, 1));
  (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  await settle();
  expect(document.activeElement?.closest('[data-testid=tool-card]')).toBe(card(root, 999));
  await scrollTo(root, 0);
  expect(document.activeElement?.closest('[data-testid=tool-card]')).toBe(card(root, 999));
  expect(cards(root).length).toBeLessThanOrEqual(MOST);
});
