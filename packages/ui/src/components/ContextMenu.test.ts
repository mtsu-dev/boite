import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import ContextMenu from './ContextMenu.svelte';
import { contextMenu } from '../lib/context-menu.svelte';

let running: Record<string, unknown> | null = null;

afterEach(() => {
  if (running) unmount(running, { outro: false });
  running = null;
  contextMenu.close();
  document.body.innerHTML = '';
});

async function settle() {
  for (let i = 0; i < 4; i++) { await tick(); await Promise.resolve(); }
  flushSync();
}

test('a scroll beside the row a menu was opened on leaves it open, and one that moves the row closes it', async () => {
  running = mount(ContextMenu, { target: document.body }); await settle();
  const sidebar = document.body.appendChild(document.createElement('nav'));
  const row = sidebar.appendChild(document.createElement('div'));
  const timeline = document.body.appendChild(document.createElement('section'));
  row.addEventListener('contextmenu', event => contextMenu.open(event, [{ id: 'import', label: 'Import', testid: 'project-import' }], () => {}));
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
  await settle();
  expect(document.querySelector('[data-value=import]')).not.toBeNull();
  // An item keeps the test id its menu gave it.
  expect(document.querySelector('[data-testid=project-import]')?.getAttribute('data-value')).toBe('import');

  // The timeline settles after a view comes back, or follows a streaming answer.
  timeline.dispatchEvent(new Event('scroll'));
  await settle();
  expect(contextMenu.current).not.toBeNull();

  sidebar.dispatchEvent(new Event('scroll'));
  await settle();
  expect(contextMenu.current).toBeNull();
});

test('ArrowRight opens a submenu from its row and ArrowLeft goes back from any row of it', async () => {
  running = mount(ContextMenu, { target: document.body }); await settle();
  const row = document.body.appendChild(document.createElement('div'));
  const picked: string[] = [];
  const main = [{ id: 'open', label: 'Open' }, { id: 'manage', label: 'Manage project', hint: '›', submenu: true }];
  const sub = [{ id: 'back', label: 'Back', back: true }, { id: 'archive', label: 'Archive' }];
  const pick = (id: string) => { picked.push(id); if (id === 'manage') contextMenu.follow(sub, pick); if (id === 'back') contextMenu.follow(main, pick); };
  row.addEventListener('contextmenu', event => contextMenu.open(event, main, pick));
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
  await settle();
  const key = (name: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

  // On a row that opens nothing, ArrowRight does nothing.
  document.querySelector<HTMLElement>('[data-value=open]')!.focus();
  key('ArrowRight'); await settle();
  expect(picked).toEqual([]);
  document.querySelector<HTMLElement>('[data-value=manage]')!.focus();
  key('ArrowRight'); await settle();
  expect(picked).toEqual(['manage']);
  expect(document.querySelector('[data-value=archive]')).not.toBeNull();

  document.querySelector<HTMLElement>('[data-value=archive]')!.focus();
  key('ArrowLeft'); await settle();
  expect(picked).toEqual(['manage', 'back']);
  expect(document.querySelector('[data-value=manage]')).not.toBeNull();
});

// The long-press sheet drew its first frame at the finger before docking, its own check and inset: one grammar now.
test('a phone long press is the shared sheet from its first frame: docked, its check at the far edge, Delete last, groups titled', async () => {
  const media = window.matchMedia;
  window.matchMedia = ((query: string) => ({ matches: query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  try {
    running = mount(ContextMenu, { target: document.body }); await settle();
    const row = document.body.appendChild(document.createElement('div'));
    const items = [
      { id: 'place', label: 'Project and branch', separator: true },
      { id: 'delete', label: 'Delete', danger: true },
      { id: 'pin', label: 'Pin', checked: true, hint: 'P' }
    ];
    row.addEventListener('contextmenu', event => contextMenu.open(event, items, () => {}));
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 300 }));
    flushSync();
    const sheet = document.querySelector<HTMLElement>('[data-testid=context-menu]')!;
    expect(sheet.dataset['mobileSheet']).toBe('true');
    expect([sheet.style.left, sheet.style.bottom]).toEqual(['0px', '0px']);
    await settle();
    expect(Array.from(sheet.children).map((one) => one.getAttribute('data-value') ?? one.className.split(' ')[0])).toEqual(['section', 'pin', 'rule', 'delete']);
    expect(sheet.querySelector('.section')?.textContent).toBe('Project and branch');
    const pin = sheet.querySelector('[data-value=pin]')!;
    expect(pin.lastElementChild?.classList.contains('check')).toBe(true);
    expect(pin.querySelector('.check svg')?.getAttribute('width')).toBe('14');
  } finally {
    window.matchMedia = media;
  }
});
