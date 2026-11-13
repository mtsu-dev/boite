import { afterEach, expect, test } from 'vitest';
import { createRawSnippet, flushSync, mount, tick, unmount } from 'svelte';
import Menu from './Menu.svelte';

let running: Record<string, unknown> | null = null;
const realGetAnimations = Element.prototype.getAnimations;

afterEach(() => {
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
  if (realGetAnimations) Element.prototype.getAnimations = realGetAnimations;
  else delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
});

const ITEMS = [
  { id: 'default', label: 'Ask' },
  { id: 'acceptEdits', label: 'Accept edits' },
  { id: 'plan', label: 'Plan' }
];

function query<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`no ${selector}`);
  return node;
}

function items(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('[data-value]'));
}

function press(key: string): void {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  );
}

/** The effects, then the microtask the focus and the close settle on. */
async function settle(): Promise<void> {
  flushSync();
  await tick();
  await tick();
}

function open(picked: string[] = []): void {
  running = mount(Menu, {
    target: document.body,
    props: {
      items: ITEMS,
      onpick: (id: string) => picked.push(id),
      label: 'Permission mode',
      testid: 'mode',
      children: createRawSnippet(() => ({ render: () => '<span>Ask</span>' }))
    }
  });
  flushSync();
}

test('the menu opens on ArrowDown, walks with the arrows and Home and End, and Enter picks', async () => {
  const picked: string[] = [];
  open(picked);

  const trigger = query<HTMLButtonElement>('[data-testid=mode]');
  trigger.focus();
  press('ArrowDown');
  await settle();

  // Open, and the keyboard is already on the first row rather than nowhere.
  expect(document.querySelector('[data-testid=mode-menu]')).not.toBeNull();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(items()[0]);

  press('ArrowDown');
  await settle();
  expect(document.activeElement).toBe(items()[1]);

  press('End');
  await settle();
  expect(document.activeElement).toBe(items()[2]);

  // Past the end it wraps rather than sticking on the last row.
  press('ArrowDown');
  await settle();
  expect(document.activeElement).toBe(items()[0]);

  press('Home');
  await settle();
  expect(document.activeElement).toBe(items()[0]);

  press('ArrowUp');
  await settle();
  expect(document.activeElement).toBe(items()[2]);

  press('Enter');
  await settle();
  expect(picked).toEqual(['plan']);
  expect(document.querySelector('[data-testid=mode-menu]')).toBeNull();
});

test('Escape closes and gives the trigger the focus back', async () => {
  open();
  const trigger = query<HTMLButtonElement>('[data-testid=mode]');
  trigger.focus();
  press('ArrowDown');
  await settle();

  press('Escape');
  await settle();
  expect(document.querySelector('[data-testid=mode-menu]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test('pressing another menu trigger closes the open menu and opens the other one', async () => {
  open();
  const second = mount(Menu, {
    target: document.body,
    props: {
      items: ITEMS,
      onpick: () => {},
      label: 'Model',
      testid: 'model',
      children: createRawSnippet(() => ({ render: () => '<span>Model</span>' }))
    }
  });
  flushSync();
  query<HTMLButtonElement>('[data-testid=mode]').click();
  await settle();
  expect(document.querySelector('[data-testid=mode-menu]')).not.toBeNull();

  // The other trigger stops its click, so only the press can reach the open menu.
  const other = query<HTMLButtonElement>('[data-testid=model]');
  other.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  other.click();
  await settle();
  expect(document.querySelector('[data-testid=mode-menu]')).toBeNull();
  expect(document.querySelector('[data-testid=model-menu]')).not.toBeNull();
  unmount(second, { outro: false });
});

test('the popover holds one animation on the way out and unmounts on animationend', async () => {
  // jsdom runs no animation, so the helper closes on the spot unless the node
  // says one is running. This is what a browser reports while it plays.
  Element.prototype.getAnimations = () => [{} as Animation];

  open();
  const trigger = query<HTMLButtonElement>('[data-testid=mode]');
  trigger.click();
  await settle();
  expect(document.querySelector('[data-testid=mode-menu]')).not.toBeNull();

  trigger.click();
  await settle();

  // Still mounted, marked closing, and taking no pointer.
  const popover = query<HTMLElement>('[data-testid=mode-menu]');
  expect(popover.classList.contains('closing')).toBe(true);

  popover.dispatchEvent(new Event('animationend'));
  await settle();
  expect(document.querySelector('[data-testid=mode-menu]')).toBeNull();
});

test('a second open during the close cancels it, and the late animationend is ignored', async () => {
  Element.prototype.getAnimations = () => [{} as Animation];

  open();
  const trigger = query<HTMLButtonElement>('[data-testid=mode]');
  trigger.click();
  await settle();
  trigger.click();
  await settle();
  expect(query<HTMLElement>('[data-testid=mode-menu]').classList.contains('closing')).toBe(true);

  trigger.click();
  await settle();
  const popover = query<HTMLElement>('[data-testid=mode-menu]');
  expect(popover.classList.contains('closing')).toBe(false);

  // The animation of the cancelled close still ends; it must not take the node.
  popover.dispatchEvent(new Event('animationend'));
  await settle();
  expect(document.querySelector('[data-testid=mode-menu]')).not.toBeNull();
  expect(query<HTMLElement>('[data-testid=mode-menu]').classList.contains('closing')).toBe(false);
});

test('a long list given a cap takes that height where the room exists, the default stopping at 45 % of the window', async () => {
  const mountWith = (cap?: number) => {
    running = mount(Menu, {
      target: document.body,
      props: {
        items: ITEMS, onpick: () => {}, label: 'Panels', testid: 'panels', placement: 'bottom', cap,
        children: createRawSnippet(() => ({ render: () => '<span>Panels</span>' }))
      }
    });
    flushSync();
    query<HTMLButtonElement>('[data-testid=panels]').click();
  };
  mountWith(560);
  await settle();
  // The panel selector's 13 rows: the default cut its last one in half at 900 px tall.
  expect(query<HTMLElement>('[data-testid=panels-menu]').style.maxHeight).toBe('560px');
  unmount(running!, { outro: false });
  document.body.innerHTML = '';
  mountWith();
  await settle();
  expect(query<HTMLElement>('[data-testid=panels-menu]').style.maxHeight).toBe(`${Math.min(360, window.innerHeight * .45)}px`);
});

test('a checkable row with a status dot keeps its hint on the label line', async () => {
  running = mount(Menu, {
    target: document.body,
    props: {
      items: [
        { id: 'a.ts', label: 'a.ts', checked: true, hint: '+64 -3', status: { tone: 'success', label: 'Added' } },
        { id: 'wrap', label: 'Wrap lines', checked: false, hint: 'Long lines fold' }
      ],
      onpick: () => {}, label: 'Files', testid: 'files',
      children: createRawSnippet(() => ({ render: () => '<span>Files</span>' }))
    }
  });
  flushSync();
  query<HTMLButtonElement>('[data-testid=files]').click();
  await settle();
  expect(query('[data-value="a.ts"]').classList.contains('inline-hint')).toBe(true);
  // A plain checkable row keeps its description under the label.
  expect(query('[data-value=wrap]').classList.contains('inline-hint')).toBe(false);
});

test('a row with its own rows opens them in place, its way back and a close both return to the first level, and no pick reaches the caller', async () => {
  const picked: string[] = [];
  const group = [{ id: 'back', label: 'Back', back: true }, { id: 'move', label: 'Move' }];
  running = mount(Menu, {
    target: document.body,
    props: {
      items: [{ id: 'rename', label: 'Rename' }, { id: 'more', label: 'Manage', submenu: true, items: group }],
      onpick: (id: string) => picked.push(id),
      label: 'Thread actions',
      testid: 'mode',
      children: createRawSnippet(() => ({ render: () => '<span>Menu</span>' }))
    }
  });
  flushSync();
  const trigger = query<HTMLButtonElement>('[data-testid=mode]');
  const ids = () => items().map(item => item.dataset['value']);
  trigger.click(); await settle();
  query<HTMLButtonElement>('[data-value=more]').click(); await settle();
  expect(ids()).toEqual(['back', 'move']);
  expect(document.activeElement).toBe(items()[0]);
  // The one back row of every second level: its own form, then its rule.
  expect(query('[data-value=back]').classList.contains('back-row')).toBe(true);
  expect(query('[data-value=back]').nextElementSibling?.classList.contains('back-rule')).toBe(true);
  press('ArrowLeft'); await settle();
  expect(ids()).toEqual(['rename', 'more']);
  // Closed on the group, the menu opens again on its first level.
  query<HTMLButtonElement>('[data-value=more]').click(); await settle();
  press('Escape'); await settle();
  trigger.click(); await settle();
  expect(ids()).toEqual(['rename', 'more']);
  query<HTMLButtonElement>('[data-value=more]').click(); await settle();
  query<HTMLButtonElement>('[data-value=move]').click(); await settle();
  expect(picked).toEqual(['move']);
});

test('a menu closed from its rows\' rows leaves on them, and says it closed once it is gone, never on mount', async () => {
  Element.prototype.getAnimations = () => [{} as Animation];
  let closed = 0;
  running = mount(Menu, {
    target: document.body,
    props: {
      items: [{ id: 'rename', label: 'Rename' }, { id: 'more', label: 'Manage', submenu: true, items: [{ id: 'back', label: 'Back', back: true }, { id: 'move', label: 'Move' }] }],
      onpick: () => {},
      onclose: () => { closed += 1; },
      label: 'Thread actions',
      testid: 'mode',
      children: createRawSnippet(() => ({ render: () => '<span>Menu</span>' }))
    }
  });
  await settle();
  // Never opened, so never closed.
  expect(closed).toBe(0);
  const ids = () => items().map(item => item.dataset['value']);
  query<HTMLButtonElement>('[data-testid=mode]').click(); await settle();
  query<HTMLButtonElement>('[data-value=more]').click(); await settle();
  press('Escape'); await settle();
  // The exit plays with the rows it closed on, not the first level swapped in under it.
  expect(query<HTMLElement>('[data-testid=mode-menu]').classList.contains('closing')).toBe(true);
  expect([ids(), closed]).toEqual([['back', 'move'], 0]);
  query<HTMLElement>('[data-testid=mode-menu]').dispatchEvent(new Event('animationend')); await settle();
  expect(closed).toBe(1);
  query<HTMLButtonElement>('[data-testid=mode]').click(); await settle();
  expect(ids()).toEqual(['rename', 'more']);
});
