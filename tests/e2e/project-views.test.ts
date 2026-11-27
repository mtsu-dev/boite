import { mobileAction, screensSettled } from './lib/mobile.ts';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { closeDisplayOptions, openDisplayOptions, openProjectFilter, setProjectOrder, showThreadView } from './lib/views.ts';
import { startUi } from './lib/ui.ts';

let server: { close(): Promise<void> };
let page: BrowserPage;
let url: string;
const id = (name: string) => `[data-testid="${name}"]`;
/** Page-side: the key the project filter gives a project of the second machine, Builder (lib/project-view.svelte.ts projectKey). */
const builderKey = (projectId: string) => `(() => { const machine = globalThis.__boiteTest.workspace.machines[1], core = machine.store.core;
  return JSON.stringify([core?.hostname ? [core.hostname, core.dataDir, core.channel] : machine.id, ${JSON.stringify(projectId)}]); })()`;
async function capture(name: string) {
  await page.settleAnimations();
  await page.screenshot(join(import.meta.dir, '.artifacts', name));
}
beforeAll(async () => {
  const port = await freePort();
  server = await startUi(port);
  // `contactNotice=0`: the seeded contact request would float its card over the list, and a tap aimed at a project header lands on it.
  url = `http://127.0.0.1:${port}/?fake=1&open=recent&machines=1&contactNotice=0`;
  page = await BrowserPage.launch({ url, windowSize: { width: 1300, height: 850 } });
  await page.waitFor(`document.querySelectorAll('${id('thread-row')}').length === 8`);
}, 30_000);
afterAll(async () => { await page?.close(); await server?.close(); }, 30_000);

test('recent view filters one owning project and creates its draft', async () => {
  await showThreadView(page, 'recent');
  await capture('project-views-desktop.png');
  // The project filter sits in the display menu, shown with the Recent view.
  await openProjectFilter(page);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  expect(await page.evaluate(`document.activeElement?.getAttribute('role')`)).toBe('menuitem');
  await page.evaluate(`Array.from(document.querySelectorAll('${id('project-filter-menu')} [data-value]')).find(e => e.dataset.value === ${builderKey('p-notes')}).click()`);
  await page.waitFor(`document.querySelectorAll('${id('thread-row')}').length === 1`);
  await closeDisplayOptions(page);
  expect(await page.evaluate(`document.querySelector('${id('thread-row')}').dataset.machineId`)).toBe('http://builder.test');
  await page.click(id('new-thread'));
  await page.waitFor(`globalThis.__boiteTest.workspace.active.draft?.projectId === 'p-notes'`);
  expect(await page.evaluate(`globalThis.__boiteTest.workspace.active.machineId`)).toBe('http://builder.test');
  await capture('project-filter-desktop.png');
  await page.evaluate(`globalThis.__boiteTest.workspace.select(globalThis.__boiteTest.workspace.machines[0].store, 't-trace')`);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'n', code: 'KeyN', modifiers: 2, windowsVirtualKeyCode: 78 });
  await page.waitFor(`globalThis.__boiteTest.workspace.active.machineId === 'http://builder.test' && globalThis.__boiteTest.workspace.active.draft?.projectId === 'p-notes'`);
  await page.evaluate(`globalThis.__boiteTest.workspace.active.archiveProject('p-notes', true)`);
  await page.waitFor(`document.querySelectorAll('${id('thread-row')}').length === 7`);
  await openDisplayOptions(page);
  await page.waitFor(`document.querySelector('${id('project-filter')}')?.textContent.includes('All projects')`);
  await page.evaluate(`globalThis.__boiteTest.workspace.active.archiveProject('p-notes', false)`);
  await page.click(id('project-filter'));
  await page.click(`${id('project-filter-menu')} [data-value=all]`);
  await page.waitFor(`document.querySelectorAll('${id('thread-row')}').length === 8`);
  await closeDisplayOptions(page);
  await page.click(id('sidebar-search-open'));
  await page.waitFor(`document.querySelector('${id('palette-input')}')`);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.waitFor(`!document.querySelector('${id('palette-input')}')`);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await page.waitFor(`document.querySelector('${id('palette-input')}')`);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.waitFor(`!document.querySelector('${id('palette-input')}')`);
}, 20_000);

test('conversation menus copy the thread ID and keep a long working directory readable', async () => {
  await page.evaluate(`localStorage.setItem('boite.locale', 'fr')`);
  await page.navigate(url);
  await page.waitFor(`globalThis.__boiteTest?.workspace.active.openThread`);
  const cwd = await page.evaluate<string>(`(() => {
    const cwd = '/workspace/projects/a-long-project-name/worktrees/a-long-conversation-branch/packages/client';
    const s = globalThis.__boiteTest.workspace.active;
    s.openThread.cwd = cwd;
    s.threads = s.threads.map(t => ({...t, cwd}));
    return cwd;
  })()`);
  const threadId = await page.evaluate<string>('globalThis.__boiteTest.workspace.active.openThread.id');
  await page.send('Browser.grantPermissions', { origin: new URL(url).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  for (const opener of ['thread-row', 'thread-title']) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1300, height: 850, deviceScaleFactor: 1, mobile: false });
    const openMenu = `(() => {
      const { workspace } = globalThis.__boiteTest;
      const owner = workspace.active;
      const machine = workspace.machines.find(m => m.store === owner);
      const target = '${opener}' === 'thread-row'
        ? Array.from(document.querySelectorAll('${id('thread-row')}')).find(e => e.dataset.machineId === machine.id && e.dataset.threadId !== owner.openThread.id)
        : document.querySelector('${id(opener)}');
      target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 180 }));
      return target.dataset.threadId ?? owner.openThread.id;
    })()`;
    const menu = id('context-menu');
    const copyId = `${menu} [data-value=copy-thread-id]`;
    const expectedId = await page.evaluate<string>(openMenu);
    if (opener === 'thread-row') expect(expectedId).not.toBe(threadId);
    await page.waitFor(`document.querySelector('${copyId}')`);
    if (opener === 'thread-row') await capture('copy-thread-id-desktop.png');
    await page.evaluate(`navigator.clipboard.writeText('')`);
    await page.click(copyId);
    await page.waitFor(`!document.querySelector('${menu}')`);
    await page.waitFor(`navigator.clipboard.readText().then(text => text === ${JSON.stringify(expectedId)})`);

    await page.evaluate(openMenu);
    const copy = `${menu} [data-value=copy]`;
    // Copy path sits in the menu's named group of where the thread goes (lib/thread-menu.ts), one step in.
    await page.waitFor(`document.querySelector('${copy}, ${menu} [data-value=more]')`);
    if (await page.evaluate(`!document.querySelector('${copy}')`)) await page.click(`${menu} [data-value=more]`);
    await page.waitFor(`document.querySelector('${copy}')`);
    await capture(`copy-path-${opener}.png`);
    expect(await page.evaluate(`(() => { const e = document.querySelector('${copy}'); return e.scrollWidth <= e.clientWidth; })()`)).toBe(true);
    expect(await page.evaluate(`document.querySelector('${copy}').textContent.trim()`)).toBe('Copier le chemin');
    // Each opener writes its own copy: the previous one must not answer for it.
    await page.evaluate(`navigator.clipboard.writeText('')`);
    await page.click(copy);
    await page.waitFor(`!document.querySelector('${menu}')`);
    // The menu closes at once and the copy it fired lands afterwards: the
    // clipboard write is asynchronous and nothing awaits it.
    await page.waitFor(`navigator.clipboard.readText().then(text => text === ${JSON.stringify(cwd)})`);
  }
  // The phone header offers the ID and leaves the path to the desktop.
  await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
  await page.click(id('thread-menu-trigger'));
  const phoneMenu = id('thread-menu-trigger-menu');
  const phoneCopyId = `${phoneMenu} [data-value=copy-thread-id]`;
  await page.waitFor(`document.querySelector('${phoneCopyId}')`);
  expect(await page.evaluate(`document.querySelector('${phoneMenu} [data-value=copy]')`)).toBeNull();
  await capture('copy-thread-id-phone.png');
  await page.evaluate(`navigator.clipboard.writeText('')`);
  // On a plain HTTP LAN the Clipboard API is unavailable, even after a tap.
  await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })`);
  try {
    const point = await page.evaluate<{ x: number; y: number }>(`(() => {
      const bounds = document.querySelector('${phoneCopyId}').getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    })()`);
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitFor(`!document.querySelector('${phoneMenu}')`);
  } finally {
    await page.evaluate(`delete navigator.clipboard`);
  }
  await page.waitFor(`navigator.clipboard.readText().then(text => text === ${JSON.stringify(threadId)})`, 2000);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1300, height: 850, deviceScaleFactor: 1, mobile: false });
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: false });
}, 20_000);

test('projects follow user activity, then keep a dragged custom order after reload', async () => {
  await showThreadView(page, 'projects');
  // Back from the phone width, the sidebar draws its cards again.
  await page.waitFor(`document.querySelectorAll('${id('project-menu')}').length > 1`);
  // The four projects stay in one list, the paused ones included, so their order alone places them.
  const toggleInactive = async () => {
    await page.click(id('grouping-options'));
    await page.click(`${id('grouping-options-menu')} [data-value=other]`);
    await page.click(id('grouping-options'));
  };
  await toggleInactive();
  await page.waitFor(`!document.querySelector('${id('paused-projects')}')`);
  // The menu ends every header at the same place, whatever counters sit before it.
  const menuEdges = await page.evaluate<number[]>(`Array.from(document.querySelectorAll('${id('project-menu')}')).map(e => Math.round(e.getBoundingClientRect().right))`);
  expect(menuEdges.length).toBeGreaterThan(1);
  expect(new Set(menuEdges).size).toBe(1);
  await page.evaluate(`(() => { const s = globalThis.__boiteTest.workspace.machines[1].store; s.threads = s.threads.map(t => t.projectId === 'p-notes' ? {...t, lastUserMessageAt: Date.now() + 1000} : t); })()`);
  const keys = () => page.evaluate<string[]>(`Array.from(document.querySelectorAll('${id('project')}')).map(e => JSON.stringify([e.dataset.machineId, e.dataset.projectId]))`);
  await page.waitFor(`document.querySelector('${id('project')}')?.dataset.projectId === 'p-notes'`);
  expect((await keys())[0]).toBe(JSON.stringify(['http://builder.test', 'p-notes']));
  const activityOrder = await keys();
  await page.evaluate(`(() => { const s = globalThis.__boiteTest.workspace.machines[0].store; s.threads = s.threads.map(t => ({...t, updatedAt: Date.now() + 10000})); })()`);
  expect(await keys()).toEqual(activityOrder);
  await setProjectOrder(page, 'manual');
  const before = await keys();
  await page.click(id('project-menu'));
  expect(await page.evaluate(`Array.from(document.querySelectorAll('${id('context-menu')} [data-value]')).map(e => e.dataset.value)`)).toEqual(['new', 'copy', 'rename', 'manage']);
  await page.click(`${id('context-menu')} [data-value=manage]`);
  await page.waitFor(`document.querySelector('${id('context-menu')} [data-value=move-up]')`);
  expect(await page.evaluate(`document.querySelector('${id('context-menu')} [data-value=move-up]').disabled`)).toBe(true);
  await page.click(`${id('context-menu')} [data-value=move-down]`);
  await page.waitFor(`!document.querySelector('${id('context-menu')}')`);
  expect(await keys()).toEqual([before[1]!, before[0]!, ...before.slice(2)]);
  await page.click(id('project-menu'));
  await page.click(`${id('context-menu')} [data-value=manage]`);
  await page.click(`${id('context-menu')} [data-value=move-down]`);
  await page.waitFor(`!document.querySelector('${id('context-menu')}')`);
  expect(await keys()).toEqual(before);
  // A real mouse drag: the header is taken past the threshold, then dropped on the upper half of the first project.
  const points = await page.evaluate<{ from: { x: number; y: number }; to: { x: number; y: number } }>(`(() => { const rows = document.querySelectorAll('${id('project')}'); const a = rows[3].querySelector('${id('project-row')}').getBoundingClientRect(); const b = rows[0].getBoundingClientRect(); return { from: { x: a.left + a.width / 2, y: a.top + a.height / 2 }, to: { x: b.left + b.width / 2, y: b.top + Math.min(8, b.height / 4) } }; })()`);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.from, button: 'left', buttons: 1, clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.from.x, y: points.from.y - 12, button: 'left', buttons: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.to, button: 'left', buttons: 1 });
  await page.waitFor(`document.documentElement.classList.contains('project-dragging')`);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.to, button: 'left', buttons: 0, clickCount: 1 });
  await page.waitFor(`JSON.stringify(Array.from(document.querySelectorAll('${id('project')}')).map(e => JSON.stringify([e.dataset.machineId, e.dataset.projectId]))) === ${JSON.stringify(JSON.stringify([before[3]!, ...before.slice(0, 3)]))}`);
  expect(await keys()).toEqual([before[3]!, ...before.slice(0, 3)]);
  await setProjectOrder(page, 'recent');
  expect(await keys()).toEqual(activityOrder);
  await setProjectOrder(page, 'manual');
  expect(await keys()).toEqual([before[3]!, ...before.slice(0, 3)]);
  await capture('project-order-desktop.png');
  await page.navigate(url);
  await page.waitFor(`document.querySelectorAll('${id('project')}').length === 4`);
  expect(await keys()).toEqual([before[3]!, ...before.slice(0, 3)]);
  await toggleInactive();
}, 20_000);

test('phone reorders a project from its group on a short screen and manages no project from its header', async () => {
  const keys = () => page.evaluate<string[]>(`Array.from(document.querySelectorAll('${id('project')}, ${id('mobile-project-group')}')).map(e => JSON.stringify([e.dataset.machineId, e.dataset.projectId]))`);
  const before = await keys();
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 240, deviceScaleFactor: 1, mobile: true });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await mobileAction(page, 'mobile-conversations');
  await page.waitFor(`document.querySelectorAll('${id('mobile-project-group')}').length === 4`);
  // Projects are managed on the desktop: the phone's header holds the picker, + and the menu.
  expect(await page.evaluate(`document.querySelector('${id('mobile-project-actions')}') === null`)).toBe(true);
  await page.click(`${id('mobile-project-group')} ${id('mobile-project-order')}`);
  // The sheet rises from the bottom edge: measured where it stops.
  await page.waitFor(`document.querySelector('${id('mobile-project-order-menu')} [data-value=down]') && ${screensSettled}`);
  expect(await page.evaluate(`(() => { const r = document.querySelector('${id('mobile-project-order-menu')}').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()`)).toBe(true);
  await capture('project-management-short-phone.png');
  await page.click(`${id('mobile-project-order-menu')} [data-value=down]`);
  await page.waitFor(`!document.querySelector('${id('mobile-project-order-menu')}')`);
  expect(await keys()).toEqual([before[1]!, before[0]!, ...before.slice(2)]);
}, 20_000);

test('phone folds a project from a tap on its header and finds it folded after a reload', async () => {
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await mobileAction(page, 'mobile-conversations');
  await showThreadView(page, 'projects', 'mobile-');
  await page.waitFor(`document.querySelectorAll('${id('mobile-project-group')}').length === 4`);
  const first = await page.evaluate<{ machineId: string; projectId: string }>(`(({ machineId, projectId }) => ({ machineId, projectId }))(document.querySelector('${id('mobile-project-group')}').dataset)`);
  const toggle = `${id('mobile-project-group')}[data-machine-id="${first.machineId}"][data-project-id="${first.projectId}"] ${id('mobile-project-toggle')}`;
  const atWork = `(() => { const s = globalThis.__boiteTest.workspace.machines.find(m => m.id === ${JSON.stringify(first.machineId)}).store; const at = s.threads.find(t => t.projectId === ${JSON.stringify(first.projectId)} && !t.archived); s.threads = s.threads.map(t => t === at ? {...t, status: 'running', runningSince: Date.now()} : t); })()`;
  await page.evaluate(atWork);
  const fold = `document.getElementById(document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-controls'))`;
  // A finger on the tile, then on the name: both belong to the fold's target.
  const tap = async (part: string) => {
    // A finger scrolls to a header first: the Contacts section below the projects lets the list scroll, so a reload may leave it under the sticky head.
    await page.evaluate(`document.querySelector(${JSON.stringify(`${toggle} ${part}`)}).scrollIntoView({ block: 'center' })`);
    await page.waitFor(screensSettled);
    const at = await page.evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector(${JSON.stringify(`${toggle} ${part}`)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    // Nothing floats over the header there, or the finger would land on it instead: a sheet still leaving may, for a moment.
    const covering = `(() => { const hit = document.elementFromPoint(${at.x}, ${at.y}); return document.querySelector(${JSON.stringify(toggle)}).contains(hit) ? '' : hit?.outerHTML.slice(0, 300) ?? 'nothing'; })()`;
    await page.waitFor(`${covering} === ''`, 5_000).catch(() => {});
    const covered = await page.evaluate<string>(covering);
    if (covered) {
      // A sheet's backdrop names nothing: the open popovers say whose it is.
      const open = await page.evaluate<string>(`JSON.stringify(Array.from(document.querySelectorAll(':popover-open')).map(e => ({ class: e.className, testid: e.dataset.testid ?? e.closest('[data-testid]')?.dataset.testid ?? null, sheet: e.dataset.mobileSheet ?? null, visible: e.checkVisibility(), text: e.textContent.trim().slice(0, 80) })))`);
      await capture('project-fold-covered.png');
      expect({ covered, open }).toEqual({ covered: '', open: '[]' });
    }
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...at, id: 1 }] });
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  expect(await page.evaluate(`${fold}.getBoundingClientRect().height > 0`)).toBe(true);
  await tap('[data-testid=project-tile]');
  await page.waitFor(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-expanded') === 'false'`);
  await page.settleAnimations();
  expect(await page.evaluate(`${fold}.getBoundingClientRect().height`)).toBe(0);
  expect(await page.evaluate(`${fold}.inert`)).toBe(true);
  // Folded, the header still says what its threads do: their rollup, or the counter that stands for them (Needs you, else
  // working). Finished threads say nothing but their time, so the first project gets one at work.
  const group = `${id('mobile-project-group')}[data-machine-id="${first.machineId}"][data-project-id="${first.projectId}"]`;
  expect(await page.evaluate(`document.querySelector(${JSON.stringify(`${toggle} ${id('project-rollup')}, ${group} ${id('project-waiting-count')}, ${group} ${id('project-working-toggle')}`)})?.getBoundingClientRect().width > 0`)).toBe(true);
  expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  await capture('project-fold-phone-folded.png');

  await page.reload();
  await mobileAction(page, 'mobile-conversations');
  await page.waitFor(`document.querySelector(${JSON.stringify(toggle)})?.getAttribute('aria-expanded') === 'false'`);
  await page.evaluate(atWork);
  await tap('.name');
  await page.waitFor(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-expanded') === 'true'`);
  await page.settleAnimations();
  expect(await page.evaluate(`${fold}.getBoundingClientRect().height > 0 && !${fold}.inert`)).toBe(true);
  expect(await page.evaluate(`document.querySelector(${JSON.stringify(`${toggle} ${id('project-rollup')}`)})`)).toBeNull();
  await capture('project-fold-phone-open.png');

  // The desktop's sidebar folds the same project into the same state, with the same rollup beside its name.
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1300, height: 850, deviceScaleFactor: 1, mobile: false });
  const card = `${id('project')}[data-machine-id="${first.machineId}"][data-project-id="${first.projectId}"]`;
  const row = `${card} ${id('project-row')}`;
  await page.click(row);
  await page.waitFor(`document.querySelector(${JSON.stringify(row)}).getAttribute('aria-expanded') === 'false' && document.querySelector(${JSON.stringify(`${row} ${id('project-rollup')}, ${card} ${id('project-waiting-count')}, ${card} ${id('project-working-toggle')}`)})`);
  await capture('project-fold-desktop.png');
  await page.click(row);
  await page.waitFor(`document.querySelector(${JSON.stringify(row)}).getAttribute('aria-expanded') === 'true'`);
  expect(page.errors()).toEqual([]);
}, 30_000);

test('phone exposes project filtering and custom-order controls without overflow', async () => {
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await mobileAction(page, 'mobile-conversations');
  await page.waitFor(`document.querySelector('${id('mobile-list')}')`);
  await showThreadView(page, 'recent', 'mobile-');
  await openProjectFilter(page, 'mobile-');
  await page.evaluate(`Array.from(document.querySelectorAll('${id('mobile-project-filter-menu')} [data-value]')).find(e => e.dataset.value === ${builderKey('p-notes')}).click()`);
  await page.waitFor(`document.querySelectorAll('${id('mobile-list')} .thread').length === 1`);
  await closeDisplayOptions(page, 'mobile-');
  await capture('project-filter-phone.png');
  await showThreadView(page, 'projects', 'mobile-');
  await page.waitFor(`document.querySelectorAll('${id('mobile-project-group')}').length === 4`);
  await page.click(id('mobile-project-order'));
  await page.click(`${id('mobile-project-order-menu')} [data-value=down]`);
  await capture('project-order-phone.png');
  await page.evaluate(`localStorage.setItem('boite.locale', 'fr')`);
  await page.navigate(url);
  await mobileAction(page, 'mobile-conversations');
  await page.waitFor(`document.querySelector('${id('mobile-grouping-options')}')?.getAttribute('aria-label').startsWith('Options')`);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
  await capture('project-order-phone-fr.png');
  expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  await page.navigate(url);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1300, height: 850, deviceScaleFactor: 1, mobile: false });
  await page.waitFor(`document.querySelector('${id('grouping-options')}')`);
  await page.evaluate(`globalThis.__boiteTest.workspace.active.setSidebarWidth(208)`);
  await page.waitFor(`document.querySelector('${id('sidebar')}')?.getBoundingClientRect().width === 208`);
  await capture('project-order-narrow-fr.png');
  // The list's head keeps its title and its three buttons inside the narrow sidebar in French.
  expect(await page.evaluate(`(() => { const head = document.querySelector('${id('grouping-options')}')?.closest('.list-head'); const box = head?.getBoundingClientRect(); return !!head && head.scrollWidth <= head.clientWidth && [...head.querySelectorAll('button')].every(b => b.getBoundingClientRect().right <= box.right + 0.5); })()`)).toBe(true);
  expect(page.errors()).toEqual([]);
}, 20_000);

test.each(['no-preference', 'reduce'])('changing to phone Conversations while closing the grouping menu leaves project headers tappable (%s)', async motion => {
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1300, height: 850, deviceScaleFactor: 1, mobile: false });
  await page.navigate(url);
  await showThreadView(page, 'projects');
  await openDisplayOptions(page);
  if (motion === 'no-preference') await capture('grouping-menu-exit-desktop.png');

  const menu = `document.querySelector('${id('grouping-options-menu')}')`;
  await page.evaluate(`(() => {
    const panel = ${menu};
    panel.addEventListener('animationcancel', event => {
      if (event.target === panel && event.animationName === 'sheet-down') globalThis.groupingExitCancelled = true;
    });
    // Keep the CSS exit in flight across CDP calls so the resize and navigation always interrupt it.
    panel.style.setProperty('animation-duration', '60s', 'important');
  })()`);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  if (motion === 'no-preference') await page.waitFor(`${menu}?.classList.contains('closing')`);
  await page.waitFor(`document.activeElement?.matches('${id('grouping-options')}')`);

  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  if (motion === 'no-preference') await page.waitFor(`${menu}?.getAnimations().some(animation => animation.animationName === 'sheet-down')`);
  await mobileAction(page, 'mobile-conversations');
  await showThreadView(page, 'projects', 'mobile-');
  const header = `document.querySelector('${id('mobile-project-toggle')}')`;
  await page.waitFor(motion === 'no-preference' ? `globalThis.groupingExitCancelled && ${header}` : header);
  await page.settleAnimations();
  const backdropCleared = await page.evaluate(`!document.querySelector('.mobile-sheet-backdrop')`);
  const captureName = `grouping-menu-exit-phone${motion === 'reduce' ? '-reduced' : ''}${backdropCleared ? '' : '-covered'}.png`;
  await page.screenshot(join(import.meta.dir, '.artifacts', captureName));

  expect(await page.evaluate(`${header}.getAttribute('aria-expanded')`)).toBe('true');
  const at = await page.evaluate<{ x: number; y: number }>(`(() => {
    const box = ${header}.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  })()`);
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...at, id: 1 }] });
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect({
    backdropCleared,
    menuCleared: await page.evaluate(`!${menu}`),
    expanded: await page.evaluate(`${header}.getAttribute('aria-expanded')`),
  }).toEqual({ backdropCleared: true, menuCleared: true, expanded: 'false' });
  await page.click(id('mobile-project-toggle'));
  await page.waitFor(`${header}.getAttribute('aria-expanded') === 'true'`);
}, 20_000);
