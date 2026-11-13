import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { closeDisplayOptions, openDisplayOptions, openProjectFilter, showThreadView } from './lib/views.ts';
import { startUi } from './lib/ui.ts';

let server: { close(): Promise<void> };
let page: BrowserPage;
let url: string;
let main: string;
let remote: string;
const id = (name: string) => `[data-testid="${name}"]`;
/** Page-side: the key the project filter gives a project of the second machine, Builder (lib/project-view.svelte.ts projectKey). */
const builderKey = (projectId: string) => `(() => { const machine = globalThis.__boiteTest.workspace.machines[1], core = machine.store.core;
  return JSON.stringify([core?.hostname ? [core.hostname, core.dataDir, core.channel] : machine.id, ${JSON.stringify(projectId)}]); })()`;
const desktopRow = (machine: string, thread = 't-trace') => `${id('thread-row')}[data-machine-id="${machine}"][data-thread-id="${thread}"]`;
const doneRow = (machine: string, thread = 't-trace') => `${id('done-thread')}[data-machine-id="${machine}"][data-thread-id="${thread}"]`;
const phoneRow = (machine: string, thread = 't-trace') => `.row[data-machine-id="${machine}"][data-thread-id="${thread}"]`;
// Done is the display menu's filter (DisplayOptionsPanel.svelte): on, its rows follow the live ones. Archived keeps its fold.
const inGroup = (kind: 'done' | 'archived', machine: string, thread = 't-trace') => `${id(kind === 'done' ? 'recent-done-rows' : `recent-${kind}`)} ${doneRow(machine, thread)}`;
const phoneArchived = (machine: string) => `${id('mobile-list')} ${inGroup('archived', machine)}`;
const phoneToggle = (kind: 'done' | 'archived' | 'working') => `${id('mobile-list')} ${id(`recent-${kind}-toggle`)}`;
const captures = process.env.BOITE_RECENT_CAPTURES ?? join(import.meta.dir, '.artifacts');

async function capture(name: string): Promise<void> {
  await page.settleAnimations();
  await page.screenshot(join(captures, name));
}
async function phone(): Promise<void> {
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.click(id('mobile-back'));
  await page.waitFor(`document.querySelector('${id('mobile-list')}')`);
}
async function phoneGroup(kind: 'done' | 'archived' | 'working'): Promise<void> {
  await page.evaluate(`document.querySelector('${phoneToggle(kind)}').scrollIntoView({block:'center'})`);
  await page.click(phoneToggle(kind));
}
/** Shows or hides the finished threads from the display menu's Done switch, and closes the menu. */
async function showDone(on: boolean): Promise<void> {
  await openDisplayOptions(page);
  const done = `${id('grouping-options-menu')} [data-value=done]`;
  if (await page.evaluate(`document.querySelector('${done}').getAttribute('aria-checked') !== '${on}'`)) await page.click(done);
  await page.waitFor(`document.querySelector('${done}')?.getAttribute('aria-checked') === '${on}'`);
  await closeDisplayOptions(page);
}
async function workingPreference(): Promise<void> {
  await page.click(id('nav-settings'));
  await page.click(id('settings-tab-general'));
  await page.click(id('setting-group-working-threads'));
  await page.click(id('settings-back'));
}
beforeAll(async () => {
  mkdirSync(captures, { recursive: true });
  const port = await freePort(); server = await startUi(port);
  url = `http://127.0.0.1:${port}/?fake=1&open=recent&machines=1`;
  page = await BrowserPage.launch({ url, windowSize: { width: 1280, height: 900 } });
}, 60_000);
beforeEach(async () => {
  if (await page.evaluate(`matchMedia('(max-width: 720px)').matches && !!document.querySelector('${id('mobile-back')}')`)) {
    await page.click(id('mobile-back'));
    await page.waitFor(`document.querySelector('${id('mobile-list')}')`);
  }
  // A phone panel's history traversal must land before the next navigation.
  await page.waitFor('!history.state?.boiteOverlay');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.evaluate(`localStorage.removeItem('boite.recent.v1'); localStorage.removeItem('boite.project-view.v1'); localStorage.removeItem('boite.done.v1'); localStorage.setItem('boite.locale', 'fr')`);
  await page.navigate(url);
  await page.waitFor(`globalThis.__boiteTest?.workspace.machines.length === 2 && document.querySelectorAll('${id('thread-row')}').length === 8`);
  [main, remote] = await page.evaluate<[string, string]>('globalThis.__boiteTest.workspace.machines.map(machine => machine.id)');
  await showThreadView(page, 'recent');
  // A reload and two waits: bun's 5 s hook default expires on a slow Windows runner before the test's own budget.
}, 30_000);
afterAll(async () => {
  try {
    await page?.close();
  } finally {
    await server?.close();
  }
}, 60_000);

test('Done is collapsed, can be read and reopened, and keeps the other machine with the same thread id', async () => {
  await page.waitFor(`document.querySelector('${desktopRow(main)}')`);
  await page.evaluate(`document.querySelector(${JSON.stringify(desktopRow(main))}).closest('.thread').querySelector('${id('thread-done')}').click()`);
  await page.waitFor(`!document.querySelector(${JSON.stringify(desktopRow(main))})`);
  expect(await page.evaluate(`!!document.querySelector(${JSON.stringify(desktopRow(remote))})`)).toBe(true);
  // Done starts hidden: no row of it until the display menu shows it.
  expect(await page.evaluate(`!document.querySelector('${id('recent-done-rows')}')`)).toBe(true);
  expect(await page.evaluate(`document.querySelectorAll('${id('done-thread')}').length`)).toBe(0);
  await showDone(true);
  await page.waitFor(`document.querySelector(${JSON.stringify(inGroup('done', main))})`);
  await page.click(`${inGroup('done', main)} ${id('done-thread-open')}`);
  await page.waitFor(`document.querySelector('${id('done-thread-notice')}')`);
  expect(await page.evaluate(`!!document.querySelector('${id('composer-input')}')`)).toBe(false);
  expect(await page.evaluate(`document.querySelectorAll('${id('message')}').length > 0`)).toBe(true);
  await page.click(id('done-thread-reopen'));
  await page.waitFor(`document.querySelector(${JSON.stringify(desktopRow(main))}) && document.querySelector('${id('composer-input')}')`);
  expect(await page.evaluate('globalThis.__boiteTest.workspace.machines[0].store.openThread.archived')).toBe(false);

  await phone();
  await page.click(`${phoneRow(main)} ${id('mobile-thread-menu-t-trace')}`);
  await page.click(`${id('mobile-thread-menu-t-trace-menu')} [data-value=archive]`);
  await page.waitFor(`!document.querySelector(${JSON.stringify(phoneRow(main))})`);
  expect(await page.evaluate(`!!document.querySelector(${JSON.stringify(phoneRow(remote))})`)).toBe(true);
  // Archiving by hand keeps the thread for later: it lands in Archived, not Done.
  await phoneGroup('archived');
  await page.waitFor(`document.querySelector(${JSON.stringify(phoneArchived(main))})`);
  expect(await page.evaluate(`!!document.querySelector(${JSON.stringify(`${id('mobile-list')} ${inGroup('done', main)}`)})`)).toBe(false);
  await page.click(`${phoneArchived(main)} ${id('done-thread-open')}`);
  await page.waitFor(`document.querySelector('${id('done-thread-reopen')}')`);
  await page.click(id('done-thread-reopen'));
  await page.waitFor('globalThis.__boiteTest.workspace.active.openThread?.archived === false');
}, 30_000);

test('working grouping persists on the device, retains attention and works on the phone', async () => {
  await workingPreference();
  expect(await page.evaluate(`JSON.parse(localStorage.getItem('boite.recent.v1')).groupWorking`)).toBe(true);
  await page.reload();
  await page.waitFor('globalThis.__boiteTest?.workspace.machines.length === 2');
  await page.evaluate(`(() => {
    const [first, second] = globalThis.__boiteTest.workspace.machines;
    first.store.threads = first.store.threads.map(t => t.id === 't-trace' ? {...t, status:'running', unread:false} : t.id === 't-descriptors' ? {...t, status:'error'} : t);
    second.store.threads = second.store.threads.map(t => t.id === 't-trace' ? {...t, status:'queued', unread:false} : t.id === 't-descriptors' ? {...t, pinned:true, status:'running'} : t);
  })()`);
  await page.waitFor(`document.querySelector('${id('recent-working-toggle')}')`);
  expect(await page.evaluate(`document.querySelector('${id('recent-working-toggle')}').getAttribute('aria-expanded')`)).toBe('false');
  expect(await page.evaluate(`!!document.querySelector(${JSON.stringify(desktopRow(main))})`)).toBe(false);
  expect(await page.evaluate(`!!document.querySelector(${JSON.stringify(desktopRow(main, 't-scheduler'))})`)).toBe(true);
  expect(await page.evaluate(`!!document.querySelector(${JSON.stringify(desktopRow(main, 't-descriptors'))})`)).toBe(true);
  expect(await page.evaluate(`!!document.querySelector(${JSON.stringify(desktopRow(remote, 't-descriptors'))})`)).toBe(true);
  await capture('recent-desktop.png');
  await page.click(id('recent-working-toggle'));
  await page.waitFor(`document.querySelector(${JSON.stringify(desktopRow(main))})`);
  await page.click(id('recent-working-toggle'));
  await phone();
  expect(await page.evaluate(`document.querySelector('${phoneToggle('working')}').getAttribute('aria-expanded')`)).toBe('false');
  expect(await page.evaluate(`!!document.querySelector(${JSON.stringify(phoneRow(main))})`)).toBe(false);
  await page.evaluate(`document.querySelector('${id('mobile-list')}').scrollTop = 64`);
  await capture('recent-phone.png');
  await phoneGroup('working');
  await page.waitFor(`document.querySelector(${JSON.stringify(phoneRow(main))})`);
  await page.click(phoneToggle('working'));
  // The magnifier opens the search field in the title's place.
  await page.click(id('mobile-search-open'));
  await page.type(id('mobile-search'), 'Finish the trace');
  await page.waitFor(`document.querySelector(${JSON.stringify(phoneRow(main))})`);
  // The phone groups from the display options at the end of its search field.
  await page.click(id('mobile-grouping-options'));
  await page.waitFor(`document.querySelector('${id('mobile-grouping-options-menu')} [data-value=working]')?.getAttribute('aria-checked') === 'true'`);
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
  await capture('recent-settings-phone.png');
  await page.click(`${id('mobile-grouping-options-menu')} [data-value=working]`);
  expect(await page.evaluate(`JSON.parse(localStorage.getItem('boite.recent.v1')).groupWorking`)).toBe(false);
  await page.click(id('mobile-grouping-options'));
  await page.type(id('mobile-search'), '');
  await page.waitFor(`!document.querySelector('${phoneToggle('working')}')`);
  await page.waitFor(`document.querySelector(${JSON.stringify(phoneRow(main))})`);
}, 30_000);

test('a merged PR asks the agent, its answer puts the thread in Done, and project filtering and restoration follow the owning machine', async () => {
  const {threadId, asked} = await page.evaluate<{threadId: string; asked: number}>(`(async () => {
    const s = globalThis.__boiteTest.workspace.machines[0].store;
    const t = await s.client.call('threads.create', {projectId:'p-boite', providerId:'echo', accountId:'a-echo', title:'Clean the Recent sidebar', worktree:{branch:'boite/recent-sidebar'}}), sha = 'a'.repeat(40);
    // A finished, read turn: the agent's prompt cache is warm, so the question is worth a turn.
    const turn = await s.client.call('turns.start', {threadId:t.id, prompt:'Clean the sidebar.'});
    while ((await s.client.call('threads.get', {threadId:t.id})).turns.find(r => r.id === turn.id)?.status !== 'done') await new Promise(r => setTimeout(r, 20));
    await s.client.call('threads.markRead', {threadId:t.id});
    s.client.setMergedPrFixture(t.id, {repository:'github.com/example/repo', branch:t.branch, tip:sha, clean:true, candidates:[{repository:'github.com/example/repo', branch:t.branch, sha, number:407, url:'https://github.com/example/repo/pull/407', mergedAt:'2026-10-02T12:00:00Z', fork:false}]});
    return {threadId:t.id, asked:await s.client.sweepMergedPrArchives()};
  })()`);
  expect(asked).toBe(1);
  // Asked, not put away: the row stays live while its agent answers.
  expect(await page.evaluate(`globalThis.__boiteTest.workspace.machines[0].store.client.call('threads.get', {threadId:${JSON.stringify(threadId)}}).then(t => ({archived:t.archived, asked:t.turns.filter(turn => turn.execution?.operation === 'pull-request').length}))`)).toEqual({archived:false, asked:1});
  await page.waitFor(`document.querySelector(${JSON.stringify(desktopRow(main, threadId))})`);
  // The agent answers with `boite thread done`: Done once its turn ends. Echo reads "question" in the prompt as its cue for a card; skipping it ends the turn.
  await page.evaluate(`(async () => {
    const s = globalThis.__boiteTest.workspace.machines[0].store, threadId = ${JSON.stringify(threadId)};
    await s.client.call('agent.done', {threadId});
    while (!(await s.client.call('threads.get', {threadId})).archived) {
      const [question] = await s.client.call('questions.list', {threadId});
      if (question) await s.client.call('questions.skip', {threadId, questionId: question.id});
      await new Promise(r => setTimeout(r, 20));
    }
  })()`);
  await page.waitFor(`!document.querySelector(${JSON.stringify(desktopRow(main, threadId))})`);
  await showDone(true);
  await page.waitFor(`document.querySelector(${JSON.stringify(inGroup('done', main, threadId))})`);
  await capture('recent-done-desktop.png');
  await openProjectFilter(page);
  await page.evaluate(`Array.from(document.querySelectorAll('${id('project-filter-menu')} [data-value]')).find(e => e.dataset.value === ${builderKey('p-boite')}).click()`);
  await closeDisplayOptions(page);
  // The other machine has no done thread in this project, only its seeded archive.
  await page.waitFor(`!document.querySelector('${id('recent-done-rows')} ${id('done-thread')}')`);
  await page.click(id('recent-archived-toggle'));
  await page.waitFor(`document.querySelectorAll('${id('done-thread')}').length === 1 && document.querySelector(${JSON.stringify(inGroup('archived', remote, 't-parser'))})`);
  expect(await page.evaluate(`!!document.querySelector(${JSON.stringify(desktopRow(remote))})`)).toBe(true);
  await openProjectFilter(page);
  await page.click(`${id('project-filter-menu')} [data-value=all]`);
  await closeDisplayOptions(page);
  await page.waitFor(`document.querySelector(${JSON.stringify(doneRow(main, threadId))})`);
  await page.click(`${doneRow(main, threadId)} ${id('done-thread-restore')}`);
  await page.waitFor(`document.querySelector(${JSON.stringify(desktopRow(main, threadId))})`);
  expect(await page.evaluate('globalThis.__boiteTest.workspace.machines[0].store.client.sweepMergedPrArchives()')).toBe(0);
}, 20_000);

test('the draft project picker has its logo and bordered selection at desktop and phone widths', async () => {
  await page.evaluate('globalThis.__boiteTest.workspace.machines[0].store.startDraft("p-boite")');
  await page.waitFor(`document.querySelector('${id('draft-project')} [data-kind=image] img')?.complete`);
  await page.waitFor(`document.querySelector('${id('recent-archived-toggle')}')`);
  // A choice to make, framed as a control: a solid edge around the project.
  expect(await page.evaluate(`(() => { const style = getComputedStyle(document.querySelector('${id('draft-project')}').closest('.project-choice')); return style.borderStyle + ' ' + style.borderTopWidth; })()`)).toBe('solid 1px');
  await capture('recent-project-desktop.png');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.waitFor(`document.querySelector('${id('mobile-draft-project')} [data-kind=image] img')?.complete`);
  expect(await page.evaluate(`(() => { const style = getComputedStyle(document.querySelector('${id('mobile-draft-project')}').closest('.project-choice')); return style.borderStyle + ' ' + style.borderTopWidth; })()`)).toBe('solid 1px');
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
  await capture('recent-project-phone.png');
  // The find chord opens the phone's copy with the keys in its search, and Back closes it.
  await page.evaluate(`document.querySelector('${id('composer-input')}').focus()`);
  const find = { key: 'f', code: 'KeyF', modifiers: 2, windowsVirtualKeyCode: 70 };
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...find });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...find });
  await page.waitFor(`document.activeElement === document.querySelector('${id('mobile-draft-project-search')}')`);
  expect(await page.evaluate(`!!document.querySelector('${id('draft-project-menu')}')`)).toBe(false);
  await page.evaluate('history.back()');
  await page.waitFor(`!document.querySelector('${id('mobile-draft-project-menu')}')`);
  await page.click(id('mobile-draft-project'));
  await page.evaluate(`Array.from(document.querySelectorAll('${id('mobile-draft-project-menu')} [data-value]')).find(e => e.dataset.value === ${JSON.stringify(JSON.stringify(['http://builder.test', 'p-notes']))}).click()`);
  await page.waitFor(`globalThis.__boiteTest.workspace.active.machineId === 'http://builder.test' && document.querySelector('${id('mobile-draft-project')} [data-tech=python]')`);
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
  // From the keyboard alone: the find chord on a draft opens the list, one
  // word lands on the project and one on the machine, Enter moves the draft
  // to the other machine and its composer takes the next keys.
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.waitFor(`document.querySelector('${id('composer-input')}')?.getClientRects().length`);
  await page.evaluate(`document.querySelector('${id('composer-input')}').focus()`);
  const chord = { key: 'f', code: 'KeyF', modifiers: 2, windowsVirtualKeyCode: 70 };
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...chord });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...chord });
  await page.waitFor(`document.activeElement === document.querySelector('${id('draft-project-search')}')`);
  // The machine's own name, in whatever language the page speaks.
  const here = await page.evaluate<string>('globalThis.__boiteTest.workspace.machines[0].label');
  await page.send('Input.insertText', { text: `boite ${here}` });
  await page.waitFor(`Array.from(document.querySelectorAll('${id('draft-project-list')} [data-value]')).map(e => e.dataset.value).join('|') === ${JSON.stringify(JSON.stringify([main, 'p-boite']))}`);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await page.waitFor(`globalThis.__boiteTest.workspace.active === globalThis.__boiteTest.workspace.machines[0].store && globalThis.__boiteTest.workspace.active.draft?.projectId === 'p-boite' && document.activeElement === document.querySelector('${id('composer-input')}')`);
  expect(page.errors()).toEqual([]);
  console.log('RECENT_PROJECT_PICKER_OK desktop=1280x900 phone=390x844');
}, 20_000);
