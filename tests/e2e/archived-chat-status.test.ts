import { expect, test } from 'bun:test';
import { connect } from '../../packages/core/src/client.ts';
import { BrowserPage } from './lib/cdp.ts';
import { pairingUrlOf, startCore } from './lib/core.ts';
import { ensureProductionUi } from './lib/prod-ui.ts';

test('opening a manually archived conversation does not describe it as done', async () => {
  ensureProductionUi();
  const core = await startCore();
  const client = await connect(core.url, core.token);
  let page: BrowserPage | undefined;
  try {
    await client.call('brain.configure', { path: null, enabled: false, boiteGuide: false });
    const project = await client.call('projects.add', { path: core.dataDir, name: 'Archive check' });
    const account = (await client.call('accounts.list', {})).find(row => row.providerId === 'echo')!;
    const title = 'Set aside for the next session';
    const thread = await client.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, title });
    const prompt = 'Keep this context for later';
    await client.call('turns.start', { threadId: thread.id, prompt });
    await client.call('threads.update', { threadId: thread.id, title });
    page = await BrowserPage.launch({ url: pairingUrlOf(core), locale: 'en', windowSize: { width: 1440, height: 900 } });
    const titleSelector = '[data-testid=thread-title]';
    const received = `[...document.querySelectorAll('[data-role=assistant]')].some(row => row.textContent.includes(${JSON.stringify(prompt)}))`;
    await page.click(`[data-testid=thread-row][data-thread-id="${thread.id}"]`);
    await page.waitFor(`document.querySelector('${titleSelector}')?.textContent.trim() === ${JSON.stringify(title)}`);
    await page.waitFor(received);
    await page.waitFor(`document.querySelector('[data-testid=thread-header]')?.dataset.status === 'idle'`);
    await page.click('[data-testid=thread-menu-trigger]');
    await page.click('[role=menu] [data-value=archive]');
    await page.waitFor(`!document.querySelector('${titleSelector}')`);
    const archived = await client.call('threads.get', { threadId: thread.id });
    expect(archived.archived).toBe(true);
    expect(archived.doneAt ?? null).toBeNull();

    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
    await page.type('[data-testid=palette-input]', title);
    await page.waitFor(`[...document.querySelectorAll('[data-testid=palette-row]')].some(row => row.textContent.includes(${JSON.stringify(title)}))`);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await page.waitFor(`document.querySelector('${titleSelector}')?.textContent.trim() === ${JSON.stringify(title)}`);
    expect((await client.call('threads.get', { threadId: thread.id })).archived).toBe(true);
    await page.waitFor(received);
    expect(await page.text('[data-testid=chat]')).not.toContain('This thread is done');
  } finally {
    try { await page?.close(); } finally { client.close(); await core.stop(); }
  }
}, 60_000);
