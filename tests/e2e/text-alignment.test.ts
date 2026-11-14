import { afterAll, beforeAll, expect, test } from 'bun:test';
import { BrowserPage, freePort } from './lib/cdp';
import { startDevUi } from './lib/ui';
import { labelOffsets } from './lib/text-metrics';

let page: BrowserPage;
let server: { close(): Promise<void> };
beforeAll(async () => {
  const port = await freePort();
  server = await startDevUi(port);
  page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&updates=1&open=recent`, windowSize: { width: 1280, height: 900 } });
  // Updates waiting: Update shows only when there is something to update, and its icon is measured beside Check.
  // A loaded Windows runner kept the dev server's modules unanswered for 14 s, and the page sat on "Starting"
  // past waitFor's default 15 s (2026-10-13): the first paint gets the hook's budget, not the default.
  await page.waitFor(`document.querySelector('[data-testid="composer-effort"]')`, 40_000);
}, 60_000);
// Closing Chrome and its profile can take seconds on a loaded Windows runner.
afterAll(async () => { await page?.close(); await server?.close(); }, 30_000);

/** Each permission row is its icon beside a name over one line of what it does: the icon holds the centre of the two lines. */
async function expectModeRowsCentred() {
  const rows = await page.evaluate<number[]>(`[...document.querySelectorAll('[data-testid="composer-mode-menu"] .row')].map((row) => {
    const glyph = row.querySelector('.glyph').getBoundingClientRect(), text = row.querySelector('.text').getBoundingClientRect();
    return glyph.top + glyph.height / 2 - text.top - text.height / 2;
  })`);
  expect(rows.length).toBeGreaterThan(1);
  for (const offset of rows) expect(Math.abs(offset)).toBeLessThanOrEqual(0.8);
}

test('text and icons share a vertical centre across reading fonts, menus and phone controls', async () => {
  const pairs: [string, string][] = [
    ['[data-testid="thread-title"]', '[data-testid="thread-title"] > .ui-label'],
    ['[data-testid="composer-picker"]', '[data-testid="composer-picker"] .label'],
    ['[data-testid="composer-effort"]', '[data-testid="composer-effort"]'],
    ['[data-testid="composer-mode"]', '[data-testid="composer-mode"]'],
  ];
  for (const font of ['inter', 'atkinson', 'source', 'plex', 'system']) {
    await page.evaluate(`(async () => {
      document.documentElement.dataset.font = '${font}';
      const style = getComputedStyle(document.body);
      await document.fonts.load('500 13px ' + style.fontFamily);
      await document.fonts.load('600 14px ' + style.fontFamily);
      await document.fonts.ready;
    })()`);
    for (const result of await labelOffsets(page, pairs)) {
      expect(Math.abs(result.offset), `${font}: ${result.label}`).toBeLessThanOrEqual(0.8);
      expect(result.inkFits, `${font}: ${result.label} accents/descenders`).toBe(true);
    }
    await page.evaluate(`(async () => {
      const { setLocaleSetting } = await import('/src/lib/i18n.svelte.ts');
      await setLocaleSetting('fr');
      window.__alignmentEffort = __boiteTest.workspace.active.openThread.effort;
      __boiteTest.workspace.active.openThread.effort = 'high';
    })()`);
    // The chip leads with what it sets, so its plain capitals hold the line's centre beside an accented level.
    await page.waitFor(`document.querySelector('[data-testid="composer-effort"] .ui-label')?.textContent === 'Effort Élevé'`);
    for (const result of await labelOffsets(page, [['[data-testid="composer-effort"] svg', '[data-testid="composer-effort"] .name']])) {
      expect(Math.abs(result.inkOffset), `${font}: accented effort label`).toBeLessThanOrEqual(0.8);
      expect(result.inkFits, `${font}: accented effort ink`).toBe(true);
    }
    await page.evaluate(`(async () => {
      __boiteTest.workspace.active.openThread.effort = window.__alignmentEffort;
      const { setLocaleSetting } = await import('/src/lib/i18n.svelte.ts'); await setLocaleSetting('en');
    })()`);
    await page.evaluate(`__boiteTest.workspace.active.showSettings('accounts')`);
    await page.waitFor(`document.querySelector('[data-testid="settings"] h1.ui-label-box .ui-label')`);
    await page.waitFor(`document.querySelector('[data-testid="subscription-proxy-settings"] h2 .info-tip')`);
    // Off, the card is its switch and one line; the form and its Save show once the switch is on.
    await page.click('[data-testid="subscription-proxy-enabled"]');
    await page.waitFor(`document.querySelector('[data-testid="subscription-proxy-settings"] form .ui-label-box .ui-label') && document.querySelector('[data-testid="subscription-proxy-save"] .ui-label')`);
    for (const result of await labelOffsets(page, [
      ['[data-testid="settings"] h1 .info-tip', '[data-testid="settings"] h1 .ui-label'],
      ['[data-testid="subscription-proxy-settings"] h2 .info-tip', '[data-testid="subscription-proxy-settings"] h2 .ui-label'],
      ['[data-testid="subscription-proxy-settings"] form .clear-key', '[data-testid="subscription-proxy-settings"] form .clear-key .ui-label'],
      ['[data-testid="subscription-proxy-save"]', '[data-testid="subscription-proxy-save"] .ui-label'],
    ])) {
      expect(Math.abs(result.offset), `${font}: heading information icon`).toBeLessThanOrEqual(0.8);
    }
    // A row's "i" steps aside for the one beside the card's title, which says what the row's said.
    expect(await page.evaluate(`(() => {
      const card = document.querySelector('[data-testid="subscription-proxy-settings"]');
      const row = card.querySelector('form .info-tip[data-tip-text]'), head = card.querySelector('h2 .info-tip[data-gather]');
      return !!head && getComputedStyle(row).display === 'none';
    })()`), `${font}: proxy row tip gathered`).toBe(true);
    await page.click('[data-testid="subscription-proxy-enabled"]');
    await page.waitFor(`document.querySelector('[data-testid="subscription-proxy-off"]')`);
    await page.evaluate(`__boiteTest.workspace.active.showSettings('machines')`);
    await page.waitFor(`document.querySelector('[data-testid="updates-check-all"] .ui-label') && document.querySelector('[data-testid="updates-run-all"] .ui-label') && document.querySelector('[data-testid="group-add-device"] .ui-label')`);
    // The settings bar carries the page's title and its "i"; the page's own heading steps aside.
    expect((await page.text('[data-testid="settings"] h1 .ui-label')).trim()).toBe('Machines and updates');
    for (const result of await labelOffsets(page, [
      ['[data-testid="settings"] h1 .info-tip', '[data-testid="settings"] h1 .ui-label'],
      ['[data-testid="updates-check-all"] svg', '[data-testid="updates-check-all"] .ui-label'],
      ['[data-testid="updates-run-all"] svg', '[data-testid="updates-run-all"] .ui-label'],
      ['[data-testid="group-add-device"] svg', '[data-testid="group-add-device"] .ui-label'],
    ])) expect(Math.abs(result.offset), `${font}: machine updates`).toBeLessThanOrEqual(0.8);
    // The agents and their versions are on Providers, under a title of the page's own level.
    await page.evaluate(`__boiteTest.workspace.active.showSettings('accounts')`);
    await page.waitFor(`document.querySelector('[data-testid="harness-updates-card"] h2 .info-tip')`);
    for (const result of await labelOffsets(page, [
      ['[data-testid="harness-updates-card"] h2 .info-tip', '[data-testid="harness-updates-card"] h2 .ui-label'],
      ['[data-testid="harness-updates-check"] svg', '[data-testid="harness-updates-check"] .ui-label'],
    ])) expect(Math.abs(result.offset), `${font}: agent updates`).toBeLessThanOrEqual(0.8);
    await page.evaluate(`__boiteTest.workspace.active.showSettings('voice')`);
    await page.waitFor(`document.querySelector('[data-testid="voice-models"] [data-testid^="voice-model-download-"] .ui-label')`);
    for (const result of await labelOffsets(page, [
      ['[data-testid="voice-models"] h2 .info-tip', '[data-testid="voice-models"] h2 .ui-label'],
      ['[data-testid="voice-models"] [data-testid^="voice-model-download-"]', '[data-testid="voice-models"] [data-testid^="voice-model-download-"] .ui-label'],
    ])) expect(Math.abs(result.offset), `${font}: voice model choices`).toBeLessThanOrEqual(0.8);
    await page.evaluate(`__boiteTest.workspace.active.showSettings('usage')`);
    await page.waitFor(`document.querySelector('[data-testid="usage-page"] .legend .ui-label')`);
    for (const result of await labelOffsets(page, [
      ['[data-testid="usage-provider-filter"] svg', '[data-testid="usage-provider-filter"] .ui-label'],
      ['[data-testid="usage-page"] .legend .swatch', '[data-testid="usage-page"] .legend .ui-label'],
    ])) {
      expect(Math.abs(result.offset), `${font}: usage provider labels`).toBeLessThanOrEqual(0.8);
      expect(result.inkFits, `${font}: usage provider ink`).toBe(true);
    }
    await page.evaluate(`__boiteTest.workspace.active.showChat()`);
  }
  await page.click('[data-testid="composer-mode"]');
  await page.waitFor(`document.querySelector('[data-testid="composer-mode"]')?.getAttribute('aria-expanded') === 'true'`);
  await expectModeRowsCentred();
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', windowsVirtualKeyCode: 27 });
  await page.evaluate(`__boiteTest.workspace.active.showSettings('general')`);
  await page.waitFor(`document.querySelector('[data-testid="settings-tab-general"]')`);
  for (const result of await labelOffsets(page, [['[data-testid="settings-tab-general"]', '[data-testid="settings-tab-general"] > span']])) expect(Math.abs(result.offset)).toBeLessThanOrEqual(0.8);
  await page.evaluate(`__boiteTest.workspace.active.showSettings('task-manager')`);
  await page.waitFor(`document.querySelector('[data-testid="task-manager"] .live .ui-label')`);
  for (const result of await labelOffsets(page, [['[data-testid="task-manager"] dt', '[data-testid="task-manager"] dt .ui-label']])) expect(Math.abs(result.offset)).toBeLessThanOrEqual(0.8);
  // A new text span must not inherit the status dot's width or background.
  expect(await page.evaluate(`(() => {
    const label = document.querySelector('[data-testid="task-manager"] .live .ui-label');
    const style = getComputedStyle(label), box = label.getBoundingClientRect();
    return box.width > 40 && box.height < 30 && style.backgroundColor === 'rgba(0, 0, 0, 0)';
  })()`)).toBe(true);
  await page.evaluate(`__boiteTest.workspace.active.showChat()`);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.waitFor(`document.querySelector('[data-testid="composer-options"]').getBoundingClientRect().width > 0`);
  for (const result of await labelOffsets(page, [pairs[1]!])) expect(Math.abs(result.offset)).toBeLessThanOrEqual(0.8);
  await page.click('[data-testid="composer-options"]');
  await page.waitFor(`document.querySelector('[data-testid="composer-options-sheet"]')`);
  for (const result of await labelOffsets(page, [['[data-testid="composer-options-sheet"] .row', '[data-testid="composer-options-sheet"] .row .ui-label']])) expect(Math.abs(result.offset)).toBeLessThanOrEqual(0.8);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', windowsVirtualKeyCode: 27 });
  await page.waitFor(`!document.querySelector('[data-testid="composer-options-sheet"]')`);
  // The permission is the phone composer's own chip; its sheet's rows hold the same centre as the desktop menu's.
  await page.click('[data-testid="composer-mode"]');
  await page.waitFor(`document.querySelector('[data-testid="composer-mode"]')?.getAttribute('aria-expanded') === 'true'`);
  await expectModeRowsCentred();
  expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  expect(page.errors()).toEqual([]);
}, 30_000);
