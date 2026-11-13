import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startUi } from './lib/ui.ts';

/*
 * The nine pages of Settings as a person meets them on a desktop: one nav
 * entry each, the page's name and scope line at its head, every card of the
 * map on its page, a route from before landing where its content went, and
 * the search opening a card and ringing it. Each page is captured for review.
 */
const ARTIFACTS = join(import.meta.dir, '.artifacts', 'settings-map');
const DESKTOP = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
const PAGES = [
  ['appearance', 'Appearance', 'device', ['theme', 'reading', 'buttons', 'workspace', 'details']],
  ['input', 'Input', 'machine', ['keyboard', 'keybinding-file', 'voice']],
  ['conversations', 'Conversations', 'device', ['thread-list', 'conversations', 'notifications', 'agent-replies', 'archived', 'worktrees']],
  ['ai', 'AI accounts', 'machine', ['providers', 'local-acp', 'secrets', 'quotas', 'subscription-proxy', 'usage']],
  ['agents', 'Agents', 'machine', ['brain', 'plugins', 'auto-compact', 'execution']],
  ['safeguards', 'Safeguards', 'machine', ['quiet', 'limits', 'browser-profiles', 'privacy']],
  ['devices', 'Devices', 'group', ['app', 'group', 'machines', 'phone', 'origins']],
  ['version', 'Version', 'machine', ['updates', 'agent-updates', 'experiments']],
  ['help', 'Troubleshooting', 'machine', ['diagnostics-status', 'diagnostics-problems', 'diagnostics-log', 'tasks', 'task-manager', 'core', 'tour']]
] as const;

let page: BrowserPage;
let server: { close(): Promise<void> };
let base: string;
beforeAll(async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const port = await freePort();
  server = await startUi(port);
  base = `http://127.0.0.1:${port}`;
  page = await BrowserPage.launch({ url: `${base}/?fake=1` });
  await page.send('Emulation.setDeviceMetricsOverride', DESKTOP);
  await page.navigate(`${base}/?fake=1`);
  await page.waitFor(`window.__boiteTest?.workspace.active.connection === 'ready'`);
}, 60000);
afterAll(async () => { await page?.close(); await server?.close(); }, 30_000);

const id = (name: string) => `[data-testid="${name}"]`;
async function settle() {
  await page.evaluate(`Promise.all([document.fonts.ready, ...document.getAnimations().filter(a => a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))])`);
}
async function capture(name: string) {
  await settle();
  await page.screenshot(join(ARTIFACTS, name));
}

test('the nav lists nine pages, and each shows its name, its scope and its cards', async () => {
  await page.click(id('nav-settings'));
  await page.waitFor(`document.querySelector('${id('settings-tab-appearance')}')?.getAttribute('aria-current') === 'page'`);
  expect(await page.evaluate(`[...document.querySelectorAll('nav .tab:not([hidden])')].map(entry => entry.dataset.testid)`)).toEqual(PAGES.map(([name]) => `settings-tab-${name}`));
  for (const [name, title, scope, cards] of PAGES) {
    await page.click(id(`settings-tab-${name}`));
    await page.waitFor(`document.querySelector('${id('settings-page')}')?.dataset.page === '${name}'`);
    for (const card of cards) await page.waitFor(`document.getElementById('settings-${card}') !== null`);
    expect(await page.evaluate(`document.querySelector('${id('settings-crumb')} h1 .ui-label').textContent`)).toBe(title);
    expect(await page.evaluate(`document.querySelector('${id('settings-scope')}').dataset.scope`)).toBe(scope);
    // One anchor per card: no card is drawn twice on a page.
    expect(await page.evaluate(`[...document.querySelectorAll('.framed [id^="settings-"]')].map(node => node.id).filter((one, index, all) => all.indexOf(one) !== index)`)).toEqual([]);
    // Nothing wider than the panel: no row pushes the page sideways.
    expect(await page.evaluate(`(() => { const panel = document.querySelector('.framed'); return panel.scrollWidth <= panel.clientWidth; })()`)).toBe(true);
    await capture(`${name}.png`);
  }
}, 180000);

test('AI accounts lists its sections under its entry, holds the subscription proxy once, and ends on usage', async () => {
  await page.click(id('settings-tab-ai'));
  await page.waitFor(`document.querySelector('${id('settings-sections')}') !== null`);
  expect(await page.evaluate(`[...document.querySelectorAll('${id('settings-sections')} .sub')].map(entry => entry.dataset.testid)`)).toEqual([
    'settings-section-providers', 'settings-section-local-acp', 'settings-section-secrets', 'settings-section-quotas', 'settings-section-subscription-proxy', 'settings-section-usage'
  ]);
  await page.waitFor(`document.querySelector('${id('subscription-proxy-settings')}') !== null && document.querySelector('${id('usage-page')}') !== null`);
  expect(await page.evaluate(`document.querySelectorAll('${id('subscription-proxy-settings')}').length`)).toBe(1);
  expect(await page.evaluate(`document.querySelector('${id('settings-page')}').lastElementChild.dataset.block`)).toBe('usage');
  await page.click(id('settings-section-usage'));
  await page.waitFor(`(() => { const head = document.getElementById('settings-usage'), panel = document.querySelector('.framed'); return head.getBoundingClientRect().top - panel.getBoundingClientRect().top < 120; })()`);
  await capture('ai-usage.png');
}, 60000);

test('a route from before the map lands on the page that took its content', async () => {
  for (const [route, section, landed, anchor] of [
    ['general', 'null', 'conversations', null], ['accounts', 'null', 'ai', null], ['limits', 'null', 'ai', 'quotas'], ['usage', 'null', 'ai', 'usage'],
    ['machines', 'null', 'devices', null], ['advanced', `'origins'`, 'devices', 'origins'], ['resources', `'limits'`, 'safeguards', 'limits'],
    ['experiments', 'null', 'version', 'experiments'], ['diagnostics', 'null', 'help', null], ['task-manager', 'null', 'help', 'task-manager'],
    ['keyboard', 'null', 'input', 'keyboard'], ['voice', 'null', 'input', 'voice'], ['plugins', 'null', 'agents', 'plugins'], ['brain', 'null', 'agents', null],
    ['browser', 'null', 'safeguards', 'browser-profiles']
  ] as const) {
    await page.evaluate(`window.__boiteTest.workspace.active.showSettings('${route}', ${section})`);
    await page.waitFor(`document.querySelector('${id('settings-page')}')?.dataset.page === '${landed}'`);
    expect(await page.evaluate(`document.querySelector('${id(`settings-tab-${landed}`)}').getAttribute('aria-current')`)).toBe('page');
    if (anchor) await page.waitFor(`document.getElementById('settings-${anchor}') !== null`);
  }
}, 120000);

test('the search finds a card by a word of its own or of a setting on it, names its page, and rings the card', async () => {
  for (const [query, landed, section, trail] of [
    ['compaction', 'agents', 'auto-compact', 'Agents'],
    ['resume', 'ai', 'limit-resume', 'AI accounts'],
    ['proxy', 'ai', 'subscription-proxy', 'AI accounts'],
    ['origins', 'devices', 'origins', 'Devices'],
    ['start at login', 'devices', 'app', 'Devices']
  ] as const) {
    await page.type(id('settings-search'), query);
    await page.waitFor(`document.querySelector('${id('settings-search-result')}')?.dataset.section === '${section}'`);
    expect(await page.evaluate(`document.querySelector('${id('settings-search-result')} .trail').textContent`)).toBe(trail);
    if (query === 'proxy') await capture('search-proxy.png');
    await page.click(id('settings-search-result'));
    await page.waitFor(`document.querySelector('${id('settings-page')}')?.dataset.page === '${landed}'`);
    // The ring is the flash class, there until its animation ends.
    await page.waitFor(`(() => { const card = document.getElementById('settings-${section}'); return card !== null && (card.classList.contains('settings-flash') || window.__boiteTest.workspace.active.settingsSection?.flash === true); })()`);
    await page.waitFor(`(() => { const card = document.getElementById('settings-${section}'), panel = document.querySelector('.framed'); const top = card.getBoundingClientRect().top - panel.getBoundingClientRect().top; return top >= -4 && top < panel.clientHeight; })()`);
    expect(await page.evaluate(`document.querySelector('${id('settings-search')}').value`)).toBe('');
  }
}, 120000);

test('a paired desktop reads the admin policy on Safeguards, and has no page of the owner alone', async () => {
  await page.navigate(`${base}/?fake=1&principal=session&policy=managed&settings=safeguards`);
  await page.waitFor(`window.__boiteTest?.workspace.active.connection === 'ready' && document.querySelector('${id('settings-page')}')?.dataset.page === 'safeguards'`);
  expect(await page.evaluate(`window.__boiteTest.workspace.active.owner`)).toBe(false);
  // The policy card, read-only as on General before the map; nothing an owner alone may change.
  expect(await page.evaluate(`[...document.querySelectorAll('${id('settings-page')} > [data-block]')].map(node => node.dataset.block)`)).toEqual(['policy']);
  await page.waitFor(`document.getElementById('settings-policy')?.getClientRects().length > 0`);
  expect(await page.evaluate(`document.querySelectorAll('#settings-policy input, #settings-policy button:not(.info-tip)').length`)).toBe(0);
  for (const card of ['quiet', 'limits', 'browser-profiles', 'privacy']) expect(await page.evaluate(`document.getElementById('settings-${card}')`)).toBe(null);
  const nav = () => page.evaluate<string[]>(`[...document.querySelectorAll('nav .tab:not([hidden])')].map(entry => entry.dataset.testid)`);
  expect(await nav()).toContain('settings-tab-safeguards');
  expect(await nav()).not.toContain('settings-tab-agents');
  // The old route to the policy card still lands on it.
  await page.click(id('settings-tab-appearance'));
  await page.evaluate(`window.__boiteTest.workspace.active.showSettings('general', 'policy')`);
  await page.waitFor(`document.querySelector('${id('settings-page')}')?.dataset.page === 'safeguards' && document.getElementById('settings-policy') !== null`);
  await capture('paired-safeguards.png');
  // On a machine with no policy the page would be empty for it: no entry, and its route opens the first page.
  await page.navigate(`${base}/?fake=1&principal=session&settings=safeguards`);
  await page.waitFor(`window.__boiteTest?.workspace.active.connection === 'ready' && document.querySelector('${id('settings-page')}')?.dataset.page === 'appearance'`);
  expect(await nav()).not.toContain('settings-tab-safeguards');
  await page.navigate(`${base}/?fake=1`);
  await page.waitFor(`window.__boiteTest?.workspace.active.connection === 'ready'`);
}, 60000);
