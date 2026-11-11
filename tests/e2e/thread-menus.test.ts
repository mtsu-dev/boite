import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startUi } from './lib/ui.ts';
import { mobileAction } from './lib/mobile.ts';

let server: { close(): Promise<void> };

/**
 * Move to project sits in the menu's named group ("Move to a project or a bot", `more`) when the group holds
 * more than one row, on the first level otherwise: walk to it, wait for the row and leave it shown.
 */
async function openMove(page: BrowserPage, menu: string): Promise<void> {
  await page.waitFor(`document.querySelector('${menu} [data-value=move], ${menu} [data-value=more]')`);
  if (!await page.evaluate<boolean>(`!!document.querySelector('${menu} [data-value=move]')`)) await page.click(`${menu} [data-value=more]`);
  await page.waitFor(`document.querySelector('${menu} [data-value=move]') && !document.querySelector('${menu} [data-value=move]').disabled`);
}
let port: number;
beforeAll(async () => {
  port = await freePort();
  server = await startUi(port);
}, 120_000);
afterAll(async () => { await server?.close(); }, 30_000);

for (const width of [1280, 390]) {
  test(`thread menus at ${width}px archive waiting work separately from Mark done`, async () => {
    const page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&open=recent`, windowSize: { width, height: width < 720 ? 844 : 900 } });
    try {
      await page.waitFor(`globalThis.__boiteTest?.workspace.active.openThread && document.querySelector('[data-testid=thread-header]')`);
      await page.evaluate(`globalThis.__boiteTest.setTheme('dark')`);
      if (width < 720) {
        await mobileAction(page, 'mobile-conversations');
        await page.click('[data-testid=mobile-thread-menu-t-bench]');
      } else {
        await page.click('[data-testid=thread-row][data-thread-id=t-bench] ~ [data-testid=thread-menu]');
      }
      const menu = '[role=menu]:not(.closing)';
      await page.waitFor(`document.querySelector('${menu} [data-value=archive]')`);
      expect(await page.evaluate(`document.querySelector('${menu} [data-value=done]').disabled`)).toBe(true);
      expect(await page.evaluate(`document.querySelector('${menu} [data-value=archive]').disabled`)).toBe(false);
      expect((await page.text(`${menu} [data-value=archive]`)).trim()).toBe('Archive');
      expect(await page.evaluate(`Array.from(document.querySelectorAll('${menu} [role=menuitem]')).every(row => row.querySelector('svg'))`)).toBe(true);
      expect(await page.evaluate(`document.querySelector('${menu} [data-value=delete]').previousElementSibling.getAttribute('role')`)).toBe('separator');
      // The phone's chat body is covered by the list here: its transitions never finish, so settle by what is drawn.
      await page.settleAnimations();
      expect(await page.evaluate(`(() => { const r = document.querySelector('${menu}').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`)).toBe(true);
      await page.screenshot(join(import.meta.dir, '.artifacts', `thread-menu-row-${width}.png`));
      await page.click(`${menu} [data-value=archive]`);
      await page.waitFor(`!globalThis.__boiteTest.workspace.active.threads.some(t => t.id === 't-bench')`);
      expect(await page.evaluate(`globalThis.__boiteTest.workspace.active.pendingPermissions.some(p => p.threadId === 't-bench')`)).toBe(false);
      expect(await page.evaluate(`document.querySelector('[data-testid=confirm-dialog]') === null`)).toBe(true);
      await page.click('[data-testid=undo-action]');
      await page.waitFor(`globalThis.__boiteTest.workspace.active.threads.some(t => t.id === 't-bench')`);
      // Done uses a fresh idle conversation; the pending seed also has a static scheduler entry.
      const idleId = await page.evaluate<string>(`(async () => {
        const client = globalThis.__boiteTest.workspace.active.client;
        const source = await client.call('threads.get', {threadId: 't-bench'});
        return (await client.call('threads.create', {projectId: source.projectId, providerId: source.providerId, accountId: source.accountId, model: source.model, title: 'Ready to finish'})).id;
      })()`);
      await page.click(width < 720 ? `[data-testid=mobile-thread-menu-${idleId}]` : `[data-testid=thread-row][data-thread-id="${idleId}"] ~ [data-testid=thread-menu]`);
      await page.waitFor(`document.querySelector('${menu} [data-value=done]')`);
      expect(await page.evaluate(`document.querySelector('${menu} [data-value=done]').disabled`)).toBe(false);
      await page.click(`${menu} [data-value=done]`);
      await page.waitFor(`!globalThis.__boiteTest.workspace.active.threads.some(t => t.id === ${JSON.stringify(idleId)})`);
      await page.click('[data-testid=undo-action]');
      await page.waitFor(`globalThis.__boiteTest.workspace.active.threads.some(t => t.id === ${JSON.stringify(idleId)})`);
      if (width < 720) {
        // A phone's row menu keeps rename, which reaches the title editor, and the move; the path stays on the desktop.
        await page.click('[data-testid=mobile-thread-menu-t-bench]');
        await page.waitFor(`document.querySelector('${menu} [data-value=rename]')`);
        expect(await page.evaluate(`document.querySelector('${menu} [data-value=copy]') === null`)).toBe(true);
        await openMove(page, menu);
        expect(await page.evaluate(`document.querySelector('${menu} [data-value=copy]') === null`)).toBe(true);
        // Back to the first level when the move was in the group's second level.
        if (await page.evaluate<boolean>(`!!document.querySelector('${menu} [data-value=back]')`)) await page.click(`${menu} [data-value=back]`);
        await page.waitFor(`document.querySelector('${menu} [data-value=rename]')`);
        await page.click(`${menu} [data-value=rename]`);
        await page.waitFor(`document.querySelector('[data-testid=thread-rename-input]')`);
        await page.type('[data-testid=thread-rename-input]', 'Restored thread from phone');
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' });
        await page.waitFor(`globalThis.__boiteTest.workspace.active.openThread?.title === 'Restored thread from phone'`);
      } else await page.click('[data-testid=thread-row][data-thread-id=t-bench]');
      await page.waitFor(`globalThis.__boiteTest.workspace.active.openThread?.id === 't-bench'`);
      await page.click('[data-testid=thread-menu-trigger]');
      await page.waitFor(`document.querySelector('${menu} [data-value=archive]')`);
      expect(await page.evaluate(`document.querySelector('${menu} [data-value=archive]').disabled`)).toBe(false);
      await page.settleAnimations();
      await page.screenshot(join(import.meta.dir, '.artifacts', `thread-menu-header-${width}.png`));
      await page.click(`${menu} [data-value=archive]`);
      await page.waitFor(`!globalThis.__boiteTest.workspace.active.threads.some(t => t.id === 't-bench')`);
      expect(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
      expect(page.errors()).toEqual([]);
    } finally { await page.close(); }
  }, 60_000);
}

// Issue #922: eighteen projects in long Windows folders, the way a Windows user has them.
const HOME = 'C:\\Users\\timothe';
const GITHUB = `${HOME}\\Documents\\GitHub`;
const longProjects: [string, string][] = [
  ['boite-site', `${GITHUB}\\boite-site`], ['boite-android', `${GITHUB}\\boite-android`], ['portfolio', `${GITHUB}\\portfolio`],
  ['api-facturation', 'D:\\Projets\\clients\\2026\\api-facturation'],
  ['un-projet-au-nom-vraiment-très-long-pour-voir', `${GITHUB}\\un-projet-au-nom-vraiment-très-long-pour-voir`],
  ['scripts', `${HOME}\\scripts`], ['notes-perso', `${HOME}\\Documents\\notes`], ['dotfiles', `${HOME}\\dotfiles`],
  ['jeu-de-plateau', `${GITHUB}\\jeu-de-plateau`], ['client-meteo', 'D:\\Projets\\clients\\2026\\client-meteo'],
  ['docs-internes', `${GITHUB}\\docs-internes`], ['extension-navigateur', `${GITHUB}\\extension-navigateur`],
  ['maquettes', `${HOME}\\Documents\\maquettes`], ['bot-discord', `${GITHUB}\\bot-discord`],
  ['compta-2026', 'D:\\Perso\\compta-2026'], ['site-asso', 'D:\\Projets\\clients\\2026\\site-asso'],
];

test('Move to project opens the project search: each name on one line, inside the window at 1280 and 360px, searched and walked by keyboard', async () => {
  const page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&open=recent`, windowSize: { width: 1280, height: 860 } });
  const picker = '[data-testid=move-project-menu]';
  const rows = `[data-testid=move-project-list] [data-row]`;
  const key = (name: string, code: number) => page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code });
  const names = () => page.evaluate<string[]>(`Array.from(document.querySelectorAll('${rows} .name'), (el) => el.textContent)`);
  const highlighted = () => page.evaluate<string>(`document.querySelector('${rows}.highlight .name')?.textContent ?? ''`);
  const threadProject = () => page.evaluate<string>(`globalThis.__boiteTest.workspace.active.threads.find((t) => t.id === 't-descriptors').projectId`);
  // One line a name, every row as tall as the next, the dialog inside the window, and only the rows scrolling.
  const layout = () => page.evaluate<{ inside: boolean; oneLine: boolean; heights: number[]; scrolls: boolean; truncated: boolean }>(`(() => {
    const menu = document.querySelector('${picker}').getBoundingClientRect();
    const list = document.querySelector('[data-testid=move-project-list]');
    const all = Array.from(document.querySelectorAll('${rows}'));
    const long = all.find((row) => row.title.endsWith('pour-voir')).querySelector('.name');
    // A second line would take the name past twice its type size.
    const oneLine = (name) => name.getClientRects().length === 1 && name.getBoundingClientRect().height < 2 * parseFloat(getComputedStyle(name).fontSize);
    return {
      inside: menu.left >= 0 && menu.top >= 0 && menu.right <= innerWidth && menu.bottom <= innerHeight,
      oneLine: all.every((row) => oneLine(row.querySelector('.name'))),
      heights: [...new Set(all.map((row) => Math.round(row.getBoundingClientRect().height)))],
      scrolls: list.scrollHeight > list.clientHeight,
      truncated: long.scrollWidth > long.clientWidth,
    };
  })()`);
  try {
    await page.waitFor(`globalThis.__boiteTest?.workspace.active.booted && document.querySelector('[data-thread-id="t-descriptors"]')`);
    await page.evaluate(`(async () => {
      const store = globalThis.__boiteTest.workspace.active;
      for (const [name, path] of ${JSON.stringify(longProjects)}) await store.client.call('projects.add', { path, name });
    })()`);
    await page.waitFor(`globalThis.__boiteTest.workspace.active.projects.length === ${longProjects.length + 2}`);
    const from = await threadProject();

    // The sidebar row's menu, then Move to project.
    await page.evaluate(`(() => { const row = document.querySelector('[data-thread-id="t-descriptors"]'); const r = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 10 })); })()`);
    await openMove(page, '[data-testid=context-menu]');
    await page.click('[data-testid=context-menu] [data-value=move]');
    await page.waitFor(`document.querySelector('${picker}') && !document.querySelector('[data-testid=context-menu]')`);
    await page.settleAnimations();
    expect(await page.evaluate(`document.activeElement?.dataset.testid`)).toBe('move-project-search');
    expect((await names()).length).toBe(18);
    expect(await page.evaluate(`Array.from(document.querySelectorAll('${rows}[aria-selected=true]'), (row) => row.dataset.value)`)).toEqual([JSON.stringify(['local', from])]);
    expect(await highlighted()).toBe('notes');
    expect(await page.evaluate(`Array.from(document.querySelectorAll('${rows}')).find((row) => row.querySelector('.name').textContent === 'boite-site').querySelector('.hint').textContent`)).toBe('~\\…\\GitHub\\boite-site');
    expect(await layout()).toMatchObject({ inside: true, oneLine: true, heights: [expect.any(Number)], scrolls: true });
    await page.screenshot(join(import.meta.dir, '.artifacts', 'move-project-1280.png'));

    // A word of the name, then one only the folder holds; Escape clears, then closes and moves nothing.
    await page.send('Input.insertText', { text: 'meteo' });
    await page.waitFor(`document.querySelectorAll('${rows}').length === 1`);
    expect(await names()).toEqual(['client-meteo']);
    await key('Escape', 27);
    await page.waitFor(`document.querySelectorAll('${rows}').length === 18`);
    await page.send('Input.insertText', { text: 'clients' });
    await page.waitFor(`document.querySelectorAll('${rows}').length === 3`);
    expect((await names()).sort()).toEqual(['api-facturation', 'client-meteo', 'site-asso']);
    await key('Escape', 27);
    await key('Escape', 27);
    await page.waitFor(`!document.querySelector('${picker}')`);
    expect(await threadProject()).toBe(from);

    // From the title menu of the open thread: the arrows walk from the checked row, Enter moves.
    await page.click('[data-thread-id="t-descriptors"]');
    await page.waitFor(`globalThis.__boiteTest.workspace.active.openThread?.id === 't-descriptors'`);
    await page.click('[data-testid=thread-menu-trigger]');
    await openMove(page, '[role=menu]:not(.closing)');
    await page.click('[role=menu]:not(.closing) [data-value=move]');
    await page.waitFor(`document.querySelector('${picker}') && document.activeElement?.dataset.testid === 'move-project-search'`);
    await key('ArrowDown', 40);
    const next = await highlighted();
    expect(next).not.toBe('notes');
    await key('ArrowUp', 38);
    expect(await highlighted()).toBe('notes');
    await key('ArrowDown', 40);
    const target = await page.evaluate<string>(`JSON.parse(document.querySelector('${rows}.highlight').dataset.value)[1]`);
    await key('Enter', 13);
    await page.waitFor(`globalThis.__boiteTest.workspace.active.threads.find((t) => t.id === 't-descriptors').projectId === ${JSON.stringify(target)}`);
    await page.waitFor(`!document.querySelector('${picker}')`);

    // A phone's width: the same dialog, under the top edge and inside the window.
    await page.click('[data-testid=thread-menu-trigger]');
    await openMove(page, '[role=menu]:not(.closing)');
    await page.click('[role=menu]:not(.closing) [data-value=move]');
    await page.waitFor(`document.querySelector('${picker}')`);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 760, deviceScaleFactor: 1, mobile: true });
    await page.waitFor(`innerWidth === 360`);
    await page.settleAnimations();
    expect(await highlighted()).toBe(next);
    expect(await layout()).toMatchObject({ inside: true, oneLine: true, heights: [expect.any(Number)], scrolls: true, truncated: true });
    expect(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
    await page.screenshot(join(import.meta.dir, '.artifacts', 'move-project-360.png'));
    await key('Escape', 27);
    await page.waitFor(`!document.querySelector('${picker}')`);
    expect(page.errors()).toEqual([]);
  } finally { await page.close(); }
}, 60_000);
