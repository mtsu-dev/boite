import { expect, spyOn } from 'bun:test';
import type { BrowserAction } from '@boite/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBrowserFixture } from './browser/fixture.ts';
import { traceBrowserCommands } from './browser/dialog-trace.ts';
import { rejection, thrown } from './settle.ts';
import { waitFor } from './harness.ts';
import { browserCommand } from '../src/browser-cli.ts';
import type { CliIo } from '../src/cli.ts';

// What an agent's actions print and reach on a real page, split from
// browser.test.ts, which keeps the tab's own life, with a browser of its own.
const browserFixture = createBrowserFixture();
const { real, url, evaluate } = browserFixture;

// Trace click 1 opens #pop; click 2 closes #shut. Keep the native click and popup lifecycle visible on failure.
real('an element keeps its ref from one snapshot to the next, and a repeated snapshot prints only what changed', async () => {
  const { agent, threadId } = browserFixture;
  const command = async (action: BrowserAction) => (await agent.call('browser.command', { threadId, action })).value as Record<string, unknown>;
  const tree = async (view: 'diff' | 'full' = 'diff') => String((await command({ kind: 'snapshot', interactive: true, view })).text);
  const diff = (unchanged: number, ...lines: string[]) =>
    [`diff since your last snapshot of this page, ${unchanged} lines unchanged (+ added, - removed, = context); snapshot --full prints everything`, '= - heading "All rows" [ref=e4] [level=2]', ...lines].join('\n');
  await command({ kind: 'open', url: url('/rows') });
  const first = await tree();
  expect(first.split('\n').slice(0, 6)).toEqual(['- heading "Rows" [ref=e1] [level=1]', '- button "Add row" [ref=e2]', '- button "Rename" [ref=e3]', '- heading "All rows" [ref=e4] [level=2]', '- link "Item 1" [ref=e5]', '- button "Open 1" [ref=e6]']);
  expect(first.split('\n')).toHaveLength(204);
  expect(first).toContain('- button "Open 3" [ref=e10]');

  // A row inserted above every other: the refs read before it still name their elements, with no new snapshot.
  await command({ kind: 'click', selector: '@e2' });
  await command({ kind: 'click', selector: '@e10' });
  expect(await evaluate('document.title')).toBe('opened 3');
  // The next snapshot lists the new row alone, under the heading it follows, with numbers nothing had yet.
  expect(await tree()).toBe(diff(204, '+ - link "Item 101" [ref=e205]', '+ - button "Open 101" [ref=e206]'));
  await command({ kind: 'click', selector: '@e12' });
  expect(await evaluate('document.title')).toBe('opened 4');

  // A change in place is the old line and the new one, on the same ref. A
  // snapshot no agent was shown (a script's, sent without a view) is whole and
  // leaves the agent's last view as the base of the next diff.
  await command({ kind: 'click', selector: '@e3' });
  expect(String((await command({ kind: 'snapshot', interactive: true })).text).split('\n')).toHaveLength(206);
  expect(await tree()).toBe(diff(205, '- - button "Open 50" [ref=e104]', '+ - button "Renamed" [ref=e104]'));
  expect(await tree()).toBe('no change since your last snapshot of this page, 206 lines unchanged; snapshot --full prints everything');

  // --full, other options and a new document each print the whole tree.
  const whole = await tree('full');
  expect(whole.split('\n').slice(3, 8)).toEqual(['- heading "All rows" [ref=e4] [level=2]', '- link "Item 101" [ref=e205]', '- button "Open 101" [ref=e206]', '- link "Item 1" [ref=e5]', '- button "Open 1" [ref=e6]']);
  expect(whole.split('\n')).toHaveLength(206);
  expect(String((await command({ kind: 'snapshot', view: 'diff' })).text)).toStartWith('- heading "Rows" [ref=e1] [level=1]\n');
  // Each set of options keeps its own last view: the full tree in between leaves the -i one as it was.
  expect(await tree()).toBe('no change since your last snapshot of this page, 206 lines unchanged; snapshot --full prints everything');

  // A removed element's ref is refused as stale, and its number is not given again.
  await evaluate('document.querySelector("#row-3").remove()');
  expect(await thrown(command({ kind: 'click', selector: '@e10' }))).toThrow('ref @e10 is stale because the page changed; take a new snapshot');
  await command({ kind: 'click', selector: '@e2' });
  expect(await tree()).toBe(diff(204, '+ - link "Item 102" [ref=e207]', '+ - button "Open 102" [ref=e208]', '- - link "Item 3" [ref=e9]', '- - button "Open 3" [ref=e10]'));

  await command({ kind: 'open', url: url('/rows?again') });
  expect(await tree()).toBe(first);

  // A whole page cut to maxChars, as an action prints it, counts what it left out and is no base for a diff.
  await command({ kind: 'open', url: url('/rows?third') });
  const cut = String((await command({ kind: 'snapshot', interactive: true, view: 'diff', maxChars: 500 })).text).split('\n');
  expect(cut.slice(0, -1).join('\n').length).toBeLessThanOrEqual(500);
  expect(cut.at(-1)).toMatch(/^\(\d+ more lines; snapshot -i prints them all\)$/);
  expect(await tree()).toBe(first);
  expect(await tree()).toBe('no change since your last snapshot of this page, 204 lines unchanged; snapshot --full prints everything');
}, 150_000);

real('each action prints the page it leaves: div buttons get refs, a click waits for its fetch, typing sends keys and a cover names its controls', async () => {
  const { agent, threadId, harness } = browserFixture;
  const io: CliIo = { cwd: harness.dataDir, env: {}, out: () => {}, err: () => {} };
  const cli = async (...args: string[]) => (await browserCommand(args, io, agent, threadId)).lines.join('\n');
  const opened = await cli('open', url('/widgets'));
  // A new page is printed whole; a div with a click handler and a pointer is a control with a ref.
  expect(opened).toContain('page (snapshot -i):');
  const card = /clickable "Open card" \[ref=(e\d+)\]/.exec(opened)?.[1];
  expect(card).toBeDefined();
  expect(await cli('click', `@${card}`)).toEndWith('  the page did not change');
  expect(await evaluate('document.title')).toBe('card opened');
  // The page answers this click 500 ms later by fetch: the click returns once the answer is in, with -q and no page read after it.
  expect(await cli('click', '-q', '#load')).not.toContain('page');
  expect(await evaluate('result.textContent')).toBe('loaded');
  // Typed text arrives as keys, the way a person's does, so a field that listens for them hears each one.
  await cli('type', '-q', '#word', 'hello');
  expect(await evaluate('[word.value, keys.textContent]')).toEqual(['hello', '5']);
  // A banner over the target: nothing is clicked, and the refusal names the banner's controls by ref.
  const refusal = String((await rejection(browserCommand(['click', '#buy'], io, agent, threadId))).reason);
  expect(refusal).toMatch(/#buy is covered by div#banner .*\[ref=e\d+\]; controls there: button "Accept" \[ref=e\d+\], button "Settings" \[ref=e\d+\]/);
  const accept = /button "Accept" \[ref=(e\d+)\]/.exec(refusal)![1];
  // Accepting removes the banner. On a page this short the whole list is shorter than a diff of it.
  const accepted = await cli('click', `@${accept}`);
  expect(accepted).toContain('- button "Buy"');
  expect(accepted).not.toContain('Accept');
  expect(await cli('click', '#buy')).toEndWith('  the page did not change');
  // A page that fetches its content as it loads is printed with it, and so is what a scroll loads.
  expect(await cli('open', url('/late'))).toContain('button "Loaded"');
  expect(await cli('scroll', '0', '1000')).toContain('button "More"');
  // The same for a page reached by a reload or by a link.
  expect(await cli('reload')).toContain('button "Loaded"');
  expect(await cli('click', '#again')).toContain('button "Loaded"');
  // A click that opens a window: the page printed is that window's, and it stays the current tab,
  // even when the window is still joining the conversation as the click returns.
  await cli('open', url());
  harness.core.browser.joining.delayMs = 1500;
  const popped = await cli('click', '#pop').finally(() => { harness.core.browser.joining.delayMs = 0; });
  expect(popped).toMatch(/a new window is the current tab: browser:/);
  const tabs = ((await agent.call('browser.command', { threadId, action: { kind: 'status' } })).value as { tabs: Array<{ url: string; active: boolean }> }).tabs;
  expect(tabs.find(tab => tab.active)?.url).toBe(url('/popup'));
  await cli('click', '-q', '#shut');
  // The popup closes after the click returns: the next test starts with one tab.
  for (let i = 0; i < 50 && ((await agent.call('browser.command', { threadId, action: { kind: 'status' } })).value as { tabs: unknown[] }).tabs.length > 1; i++) await Bun.sleep(100);
}, 60_000);

real('a window a page opens joins the conversation as a tab of its own', () => traceBrowserCommands(async () => {
  const { agent, threadId } = browserFixture;
  await agent.call('browser.command', { threadId, action: { kind: 'open', url: url() } });
  await agent.call('browser.command', { threadId, action: { kind: 'click', selector: '#pop' } });
  let tabs: Array<{ url: string; title: string }> = [];
  for (let i = 0; i < 50 && tabs.length < 2; i++) {
    await Bun.sleep(100);
    tabs = ((await agent.call('browser.command', { threadId, action: { kind: 'status' } })).value as { tabs: typeof tabs }).tabs;
  }
  expect(tabs.map(tab => tab.url)).toEqual([url(), url('/popup')]);
  // Its first request leaves before the core attaches to it: the browser's own flag names it.
  expect(browserFixture.agents.get('/popup')).toMatch(/ Chrome\/\d+/);
  // The popup is the active tab, and it keeps its opener: a sign-in window answers the page that opened it.
  expect(await evaluate('opener !== null && opener.document.title')).toBe('Fixture');
  const status = async () => ((await agent.call('browser.command', { threadId, action: { kind: 'status' } })).value as { tabs: typeof tabs }).tabs;
  await agent.call('browser.command', { threadId, action: { kind: 'click', selector: '#shut' } });
  for (let i = 0; i < 50 && (tabs = await status()).length > 1; i++) await Bun.sleep(100);
  expect(tabs.map(tab => tab.url)).toEqual([url()]);
  expect(await evaluate('messages.join()')).toBe('hello from ');
  // A window opened by a script, with no click behind it, is a tab too: the desktop app's webviews block none.
  expect(await evaluate(`window.open('/popup?script', 'z', 'width=400,height=300') !== null`)).toBe(true);
  for (let i = 0; i < 50 && (tabs = await status()).length < 2; i++) await Bun.sleep(100);
  expect(tabs.map(tab => tab.url)).toEqual([url(), url('/popup?script')]);
}), 150_000);

real('a command that names no tab waits for every window still joining, and a window of an archived conversation is closed', async () => {
  const { agent, threadId, harness } = browserFixture;
  const browser = harness.core.browser;
  const run = (action: BrowserAction) => agent.call('browser.command', { threadId, action });
  const tabs = () => browser.status({ threadId }).tabs.map(tab => [tab.url, tab.active]);
  await run({ kind: 'open', url: url() });
  browser.joining.delayMs = 700;
  // `open` drives the window a click just opened, not the page behind it.
  await run({ kind: 'click', selector: '#pop' });
  await run({ kind: 'open', url: url('/popup?next'), reuse: true });
  expect(tabs()).toEqual([[url(), false], [url('/popup?next'), true]]);
  // A window opened while a command waits is waited for too.
  await evaluate(`window.open('/popup?one', 'one'); setTimeout(() => window.open('/popup?two', 'two'), 300); true`);
  expect((await run({ kind: 'evaluate', expression: 'location.search' })).value).toBe('?two');
  // Archived while a window joins: the waiting command is refused and the window closes with the rest.
  browser.joining.delayMs = 0;
  const resume = Promise.withResolvers<void>();
  const join = browser.joining.window.bind(browser.joining);
  const held = spyOn(browser.joining, 'window').mockImplementation((id, attach) => join(id, () => resume.promise.then(attach)));
  const waits = spyOn(browser.joining, 'windows');
  try {
    await evaluate(`window.open('/popup?late', 'late'); true`);
    // The opener can return before Chromium announces the new window.
    await waitFor(() => browser.joining.count(threadId) === 1);
    waits.mockClear();
    const waiting = thrown(run({ kind: 'evaluate', expression: 'location.search' }));
    await waitFor(() => waits.mock.calls.length > 0);
    harness.core.journal.putThread({ ...harness.core.threads.require(threadId), archived: true });
    browser.release(threadId);
    resume.resolve();
    expect(await waiting).toThrow('the agent browser needs an active conversation');
  } finally {
    resume.resolve();
    waits.mockRestore();
    held.mockRestore();
  }
  for (let i = 0; i < 50 && tabs().length > 0; i++) await Bun.sleep(100);
  expect(tabs()).toEqual([]);
}, 60_000);

real('a window a frame of another site opens is the current tab, and one its sandbox refuses holds no command', async () => {
  const { agent, threadId, harness } = browserFixture;
  const io: CliIo = { cwd: harness.dataDir, env: {}, out: () => {}, err: () => {} };
  const cli = async (...args: string[]) => (await browserCommand(args, io, agent, threadId)).lines.join('\n');
  const tabs = () => harness.core.browser.status({ threadId }).tabs;
  await cli('open', url());
  // A sandbox without allow-popups refuses the window: there is nothing to wait for.
  await evaluate(`new Promise(done => { const frame = document.createElement('iframe'); frame.id = 'boxed'; frame.sandbox = 'allow-scripts allow-same-origin'; frame.src = '/shop'; frame.onload = () => done(true); document.body.append(frame); })`);
  expect(await evaluate(`boxed.contentWindow.eval("window.open('/popup?boxed', '_blank') !== null")`)).toBe(false);
  const asked = performance.now();
  expect(await evaluate('location.pathname')).toBe('/');
  expect(performance.now() - asked).toBeLessThan(2_000);
  expect(tabs()).toHaveLength(1);
  const framed = url('/frame-popup').replace('127.0.0.1', 'localhost');
  await evaluate(`new Promise(done => { const frame = document.createElement('iframe'); frame.src = ${JSON.stringify(framed)}; frame.onload = () => done(true); document.body.append(frame); })`);
  const ref = /button "Open popup" \[ref=(e\d+)\]/.exec(await cli('snapshot', '-i'))?.[1];
  expect(ref).toBeDefined();
  // The click returns before Chrome may have told the core of the window: the page printed is still that window's.
  expect(await cli('click', `@${ref}`)).toMatch(/a new window is the current tab: browser:/);
  expect(tabs().find(tab => tab.active)?.url).toBe(`${framed.replace('/frame-popup', '/popup')}?frame`);
  await cli('click', '-q', '#shut');
  for (let i = 0; i < 50 && tabs().length > 1; i++) await Bun.sleep(100);
  expect(tabs()).toHaveLength(1);

}, 60_000);

real('a target that moves away from the native pointer is not clicked, and the next command can reach it', async () => {
  const { agent, threadId } = browserFixture;
  await agent.call('browser.command', { threadId, action: { kind: 'open', url: url() } });
  await evaluate(`document.body.innerHTML = '<button id="moving">Move</button>';
    window.clicks = [];
    document.addEventListener('click', event => clicks.push(event.isTrusted));
    window.escapePointer = event => { if (event.isTrusted) moving.style.transform = 'translateX(300px)'; };
    moving.addEventListener('pointermove', escapePointer); true`);
  expect(await thrown(agent.call('browser.command', { threadId, action: { kind: 'click', selector: '#moving' } }))).toThrow('did not receive native pointer movement');
  expect(await evaluate('clicks')).toEqual([]);
  await evaluate(`moving.removeEventListener('pointermove', escapePointer); moving.style.transform = ''; true`);
  await agent.call('browser.command', { threadId, action: { kind: 'click', selector: '#moving' } });
  expect(await evaluate('clicks')).toEqual([true]);
}, 150_000);

real('native pointer movement retries a selector temporarily changed by hover', async () => {
  const {agent, threadId} = browserFixture;
  await agent.call('browser.command', {threadId, action: {kind: 'open', url: url()}});
  await evaluate(`document.body.innerHTML = '<button class="ready">Hover</button>';
    window.clicks = [];
    const button = document.querySelector('button');
    button.addEventListener('click', event => clicks.push(event.isTrusted));
    button.addEventListener('pointermove', event => {
      if (!event.isTrusted) return;
      button.className = 'hovering';
      setTimeout(() => button.className = 'ready', 100);
    }, {once: true}); true`);
  await agent.call('browser.command', {threadId, action: {kind: 'click', selector: '.ready'}});
  expect(await evaluate('clicks')).toEqual([true]);
}, 150_000);

real('a burst of windows opened at once stops at the conversation tab limit', async () => {
  const { agent, threadId } = browserFixture;
  // The desktop app's webviews let a page open many windows, and so does the core's Chromium (`chromiumArgs`).
  const host = await browserFixture.fakeHost('shell');
  try {
    await host.app.call('browser.hostAttach', {});
    for (let i = 0; i < 7; i++) await agent.call('browser.command', { threadId, action: { kind: 'open', url: url() } });
    await evaluate(`for (let i = 0; i < 10; i++) window.open('/popup?' + i, 'burst' + i); true`);
    const count = async () => ((await agent.call('browser.command', { threadId, action: { kind: 'status' } })).value as { tabs: unknown[] }).tabs.length;
    for (let i = 0; i < 50 && await count() < 8; i++) await Bun.sleep(100);
    // Every window of the burst is announced before the first one is attached: none may pass the check on a stale count.
    await Bun.sleep(1500);
    expect(await count()).toBe(8);
  } finally { await host.close(); }
}, 150_000);

real('a click right after the viewport changes size lands on its element, and what the page then logs is kept', async () => {
  const { agent, threadId } = browserFixture;
  const fixture = readFileSync(join(import.meta.dir, '../../../tests/e2e/fixtures/browser-parity.html'), 'utf8');
  const page = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: request => new URL(request.url).pathname === '/'
    ? new Response(fixture, { headers: { 'content-type': 'text/html;charset=utf-8' } }) : new Response('missing', { status: 404 }) });
  try {
    const command = (action: BrowserAction) => agent.call('browser.command', { threadId, action });
    await command({ kind: 'open', url: page.url.href });
    await command({ kind: 'preset', preset: 'iphone-15-pro' });
    expect(await evaluate('[innerWidth,innerHeight]')).toEqual([393, 852]);
    await command({ kind: 'preset', preset: 'iphone-15-pro', orientation: 'landscape' });
    expect(await evaluate('[innerWidth,innerHeight]')).toEqual([852, 393]);
    await command({ kind: 'reset-viewport' });
    // The button sits elsewhere at each size: aimed at the old layout, the click missed it.
    await command({ kind: 'click', selector: '#diagnostic' });
    await Bun.sleep(150);
    const { entries } = (await command({ kind: 'diagnostics' })).value as { entries: Array<{ kind: string; text: string }> };
    expect(entries.some(entry => entry.kind === 'console' && entry.text.includes('Diagnostic volontaire'))).toBe(true);
    expect(entries.some(entry => entry.kind === 'exception' && entry.text.includes('Erreur volontaire'))).toBe(true);
    expect(entries.some(entry => entry.kind === 'network' && entry.text.includes('404'))).toBe(true);
  } finally { page.stop(true); }
}, 150_000);
