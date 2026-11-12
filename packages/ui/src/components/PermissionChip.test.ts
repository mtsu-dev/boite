import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { Bot, ShieldCheck } from '@lucide/svelte';
import PermissionChip from './PermissionChip.svelte';
import { phoneWidth } from '../test/phone-width';

const ITEMS = [
  { id: 'yolo', label: 'No limits', hint: 'Runs everything and skips your hooks', title: 'Approves every tool request', icon: Bot as never },
  { id: 'default', label: 'Ask', hint: 'Asks before it edits a file or runs a command', title: 'Reads freely', icon: ShieldCheck as never }
];

let mounted: ReturnType<typeof mount> | undefined;
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = '';
});

function chip(): HTMLElement { return document.querySelector<HTMLElement>('[data-testid=composer-mode]')!; }
function menu(): HTMLElement | null { return document.querySelector<HTMLElement>('[data-testid=composer-mode-menu]'); }

test('each mode is a full row with its icon, its word, its plain line and a check on the live one; a pick saves and closes', async () => {
  const onpick = vi.fn();
  mounted = mount(PermissionChip, { target: document.body, props: { items: ITEMS, active: 'default', onpick } });
  flushSync();
  // At rest the chip reads the mode in a word, and its name says what it is.
  expect(document.querySelector('[data-testid=composer-mode-value]')?.textContent).toBe('Ask');
  expect(chip().getAttribute('aria-label')).toBe('Permission: Ask');
  chip().click();
  flushSync();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const rows = [...menu()!.querySelectorAll<HTMLElement>('[data-row]')];
  expect(rows.map((row) => [row.querySelector('.label')?.textContent, row.querySelector('.hint')?.textContent, row.querySelector('.glyph svg') !== null]))
    .toEqual([['No limits', 'Runs everything and skips your hooks', true], ['Ask', 'Asks before it edits a file or runs a command', true]]);
  expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual(['false', 'true']);
  expect(rows[1]!.querySelector('.mark svg')).not.toBeNull();
  expect(rows[0]!.querySelector('.mark svg')).toBeNull();
  // The keyboard lands on the live mode; the arrows wrap.
  expect(document.activeElement).toBe(rows[1]);
  rows[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  expect(document.activeElement).toBe(rows[0]);
  rows[0]!.click();
  flushSync();
  expect(onpick).toHaveBeenCalledWith('yolo');
  expect(chip().getAttribute('aria-expanded')).toBe('false');
});

test('on a phone the modes open as the shared bottom sheet with its title', async () => {
  const restore = phoneWidth();
  try {
    mounted = mount(PermissionChip, { target: document.body, props: { items: ITEMS, active: 'default', onpick() {} } });
    flushSync();
    chip().click();
    flushSync();
    expect(menu()!.dataset.mobileSheet).toBe('true');
    expect(menu()!.querySelector('.sheet-head')?.textContent).toBe('Permission');
  } finally { restore(); }
});

test("a bot's chip reads its mode and says where it is set, and opens nothing", () => {
  const onpick = vi.fn();
  mounted = mount(PermissionChip, { target: document.body, props: { items: ITEMS, active: 'yolo', onpick, readonly: true, readonlyHint: "Set in Ada's settings" } });
  flushSync();
  expect(chip().tagName).toBe('SPAN');
  expect(chip().textContent?.trim()).toBe('No limits');
  expect(chip().getAttribute('title')).toBe("Set in Ada's settings");
  chip().click();
  flushSync();
  expect(menu()).toBeNull();
  expect(onpick).not.toHaveBeenCalled();
});
