import { expect, spyOn } from 'bun:test';
import type { BrowserAction } from '@boite/contracts';
import { echoThread, startTestCore } from './harness.ts';
import { createBrowserFixture, picture } from './browser/fixture.ts';
import { traceBrowserCommands } from './browser/dialog-trace.ts';
import { thrown } from './settle.ts';
import { Cdp } from '../src/browser/cdp.ts';

// Refs, snapshots, actions, windows a page opens and the native pointer are in
// browser-actions.test.ts: one file of both ran past the 300 s file deadline
// on the Intel Mac (docs/internals/ci.md#core-and-ui-shards).
const browserFixture = createBrowserFixture();
const { real, url, evaluate } = browserFixture;

real('an agent opens, reads and drives a page in the browser of its own machine', async () => {
  const { harness, owner, agent, threadId } = browserFixture;
  const open = await agent.call('browser.command', { threadId, action: { kind: 'open', url: url() } });
  expect(open.tabId).toMatch(/^browser:/);
  expect(open.profile).toBe('default');
  expect(open.title).toBe('Fixture');
  const status = (await agent.call('browser.command', { threadId, action: { kind: 'status' } })).value as { available: boolean; tabs: Array<{ tabId: string; url: string; title: string; active: boolean }> };
  expect(status.available).toBe(true);
  expect(status.tabs).toMatchObject([{ tabId: open.tabId, url: url(), title: 'Fixture', active: true }]);
  const snapshot = (await agent.call('browser.command', { threadId, action: { kind: 'snapshot', interactive: true } })).value as { title: string; text: string };
  expect(snapshot.title).toBe('Fixture');
  expect(snapshot.text).toContain('- button "Go" [ref=e1]');
  const readDiagnostics = async () => (await agent.call('browser.command', { threadId, action: { kind: 'diagnostics' } })).value as { entries: Array<{ kind: string; text: string; url?: string }> };
  let diagnostics = await readDiagnostics();
  // DOM readiness does not include the asynchronous failed fetch's diagnostic.
  const deadline = Date.now() + 5000;
  while (!diagnostics.entries.some(entry => entry.kind === 'network' && entry.url === url('/missing')) && Date.now() < deadline) {
    await Bun.sleep(50);
    diagnostics = await readDiagnostics();
  }
  expect(diagnostics.entries).toContainEqual(expect.objectContaining({ kind: 'console', text: 'boom' }));
  // The query string carried a token: diagnostics keep the address without it.
  expect(diagnostics.entries).toContainEqual(expect.objectContaining({ kind: 'network', url: url('/missing') }));
  await agent.call('browser.command', { threadId, action: { kind: 'click', selector: '#go' } });
  expect(await evaluate('document.title')).toBe('clicked');
  await agent.call('browser.command', { threadId, action: { kind: 'type', selector: '#name', text: 'hello' } });
  expect(await evaluate('document.querySelector("#name").value')).toBe('hello');
  expect(await thrown(agent.call('browser.command', { threadId, action: { kind: 'click', selector: 'nothing' } }))).toThrow('matched 0');
  await agent.call('browser.command', { threadId, action: { kind: 'preset', preset: 'iphone-15-pro' } });
  expect(await evaluate('innerWidth')).toBe(393);
  await agent.call('browser.command', { threadId, action: { kind: 'appearance', colorScheme: 'dark' } });
  expect(await evaluate('matchMedia("(prefers-color-scheme: dark)").matches')).toBe(true);
  const shot = await agent.call('browser.command', { threadId, action: { kind: 'screenshot' } });
  expect(Buffer.from(shot.screenshot!.base64, 'base64').subarray(1, 4).toString()).toBe('PNG');
  const pngSize = (base64: string) => {
    const bytes = Buffer.from(base64, 'base64');
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  };
  const cssSize = await evaluate('[innerWidth, innerHeight]') as [number, number];
  expect(pngSize(shot.screenshot!.base64)).toEqual(cssSize);
  // A page that cannot shrink in an isolated world still gives the agent CSS pixels.
  const send = Cdp.prototype.send;
  const shrinking = spyOn(Cdp.prototype, 'send').mockImplementation(function <T>(this: Cdp, method: string, params: Record<string, unknown> = {}, session?: string, timeoutMs?: number): Promise<T> {
    if (method === 'Page.createIsolatedWorld' && params.worldName === 'boite-screenshot') return Promise.reject(new Error('isolated world unavailable'));
    return send.call(this, method, params, session, timeoutMs) as Promise<T>;
  });
  try {
    const fallback = await agent.call('browser.command', { threadId, action: { kind: 'screenshot' } });
    expect(pngSize(fallback.screenshot!.base64)).toEqual(cssSize);
  } finally { shrinking.mockRestore(); }
  const history = ((await agent.call('browser.command', { threadId, action: { kind: 'diagnostics' } })).value as { history: Array<{ action: string; ok: boolean }> }).history;
  expect(history.map(entry => entry.action)).toEqual(['open', 'click', 'evaluate', 'type', 'evaluate', 'click', 'preset', 'evaluate', 'appearance', 'evaluate', 'screenshot', 'evaluate', 'screenshot']);
  expect(history[5]!.ok).toBe(false);
  // Its token reaches its own conversation only, and only http(s) pages open.
  expect(await thrown(agent.call('browser.command', { threadId: 'another-thread', action: { kind: 'status' } }))).toThrow('not thread');
  expect(await thrown(agent.call('browser.command', { threadId, action: { kind: 'open', url: 'file:///etc/passwd' } }))).toThrow('HTTP');
  const other = (await echoThread(harness, owner, 'other')).threadId;
  expect(((await owner.call('browser.command', { threadId: other, action: { kind: 'status' } })).value as { tabs: unknown[] }).tabs).toEqual([]);
  expect(await thrown(owner.call('browser.command', { threadId: other, tabId: open.tabId, action: { kind: 'snapshot' } }))).toThrow('no browser tab');
  await agent.call('browser.command', { threadId, action: { kind: 'close' } });
  expect(((await agent.call('browser.command', { threadId, action: { kind: 'status' } })).value as { tabs: unknown[] }).tabs).toEqual([]);
}, 150_000);

real('a page nobody drives or watches sleeps, and meets the next command or viewer awake and focused', async () => {
  const { harness, owner, agent, threadId } = browserFixture;
  harness.core.browser.sleepAfterMs = 300;
  const { tabId } = await agent.call('browser.command', { threadId, action: { kind: 'open', url: url('/animated?busy=400') } });
  const browser = harness.core.browser;
  // Whether the core keeps the tab awake is its own state; how fast a runner's
  // Chrome then runs the page is not (macOS runners stalled awake pages 2 s).
  const asleepWithin = async (ms: number) => {
    for (const end = Date.now() + ms; !browser.asleep(tabId!) && Date.now() < end;) await Bun.sleep(50);
    return browser.asleep(tabId!);
  };
  const awakeFor = async (ms: number, every: () => Promise<unknown> = async () => {}) => {
    for (const end = Date.now() + ms; Date.now() < end;) {
      await every();
      if (browser.asleep(tabId!)) return false;
      await Bun.sleep(100);
    }
    return true;
  };
  // The browser answers a freeze before its renderer applies it, and a loaded
  // renderer applies it late: a page that still ran 400 ms into a second counted
  // from the answer showed a timer pause of 701 ms. The second runs from when the
  // page says it froze, and the page above is still busy for 400 ms each time.
  const frozenFor = async (ms: number) => {
    const froze = browserFixture.frozen();
    expect(await asleepWithin(30_000)).toBe(true);
    for (const end = Date.now() + 30_000; browserFixture.frozen() === froze && Date.now() < end;) await Bun.sleep(50);
    expect(browserFixture.frozen()).toBeGreaterThan(froze);
    await Bun.sleep(ms);
  };
  await evaluate('gaps()');
  await frozenFor(1000);
  // Frozen for a second: no animation frame and no timer ran, and the command found the page as it was.
  const [frameGap, tickGap] = await evaluate('gaps()') as [number, number];
  expect(frameGap).toBeGreaterThan(800);
  expect(tickGap).toBeGreaterThan(800);
  expect(await evaluate('document.visibilityState + " " + document.hasFocus()')).toBe('visible true');
  // Asleep again, a viewer's first frame wakes it and its screencast keeps it awake past the wait.
  await frozenFor(1000);
  await owner.call('threads.subscribe', { threadId });
  await owner.call('browser.remoteFrame', { threadId, tabId, maxWidth: 300, quality: 40 });
  expect(browser.asleep(tabId!)).toBe(false);
  expect((await evaluate('gaps()') as [number, number])[0]).toBeGreaterThan(800);
  expect(await awakeFor(1500, () => owner.call('browser.remoteFrame', { threadId, tabId, maxWidth: 300, quality: 40 }).catch(() => {}))).toBe(true);
  // Each frame is a use; past the last one, the viewer's screencast holds the tab, for its 3 s idle time at least.
  expect(await awakeFor(1500)).toBe(true);
  // Once the viewer leaves it sleeps again; a client that shows the tab's own
  // page asks for no frames, and one `browser.remoteWatch` keeps it awake.
  // The screencast stops up to twice its idle time after the last frame; a loaded runner takes longer.
  await frozenFor(1000);
  expect(await owner.call('browser.remoteWatch', { threadId, tabId: tabId! })).toEqual({ ok: true });
  expect((await evaluate('gaps()') as [number, number])[0]).toBeGreaterThan(800);
  // Without the lease it would sleep within this wait, as it did above.
  expect(await awakeFor(2000)).toBe(true);
}, 150_000);

real('a background tab woken from sleep draws again: its screenshot answers', async () => {
  const { harness, agent, threadId } = browserFixture;
  harness.core.browser.sleepAfterMs = 300;
  const first = (await agent.call('browser.command', { threadId, action: { kind: 'open', url: url() } })).tabId!;
  // The second tab is the browser's front one; the first is drawn only while focus emulation keeps it shown.
  const second = (await agent.call('browser.command', { threadId, action: { kind: 'open', url: url('/shop') } })).tabId!;
  const browser = harness.core.browser;
  for (const end = Date.now() + 30_000; !(browser.asleep(first) && browser.asleep(second)) && Date.now() < end;) await Bun.sleep(50);
  expect([browser.asleep(first), browser.asleep(second)]).toEqual([true, true]);
  // Before the fix the woken page stayed hidden and the capture waited 30 s for a frame that never came.
  const started = performance.now();
  const shot = await agent.call('browser.command', { threadId, tabId: first, action: { kind: 'screenshot' } });
  expect(Buffer.from(shot.screenshot!.base64, 'base64').subarray(1, 4).toString()).toBe('PNG');
  expect(performance.now() - started).toBeLessThan(10_000);
}, 150_000);

real('a tab whose renderer was killed loads its page again for the next viewer or command', async () => {
  const { harness, owner, agent, threadId } = browserFixture;
  harness.core.browser.sleepAfterMs = 300;
  const browser = harness.core.browser;
  const { tabId } = await agent.call('browser.command', { threadId, action: { kind: 'open', url: url() } });
  // Each step starts once the core heard of the crash.
  let crashes = 0;
  const record = harness.core.logs.record.bind(harness.core.logs);
  harness.core.logs.record = (level, message, context = {}, at) => { if (context.event === 'browser.tab-crashed') crashes++; record(level, message, context, at); };
  const crash = async () => {
    const before = crashes;
    // Every renderer of this test's own browser: the tab's is among them, and the others are spares.
    for (const pid of await browser.rendererPids(tabId!)) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
    for (const end = Date.now() + 15_000; crashes === before && Date.now() < end;) await Bun.sleep(50);
    expect(crashes).toBe(before + 1);
  };
  // Killed asleep, as the memory guard stopped a Gmail tab nobody watched: the viewer that came later got no frame.
  for (const end = Date.now() + 30_000; !browser.asleep(tabId!) && Date.now() < end;) await Bun.sleep(50);
  expect(browser.asleep(tabId!)).toBe(true);
  await crash();
  await owner.call('threads.subscribe', { threadId });
  const started = performance.now();
  const frame = await picture(owner.call('browser.remoteFrame', { threadId, tabId, maxWidth: 300, quality: 40 }));
  expect(frame.title).toBe('Fixture');
  expect(performance.now() - started).toBeLessThan(10_000);
  // Killed while awake, the agent's next command finds the page loaded again.
  await crash();
  expect(await evaluate('document.title')).toBe('Fixture');
  // Closed while dead, the page goes without loading again: its server hears nothing.
  await crash();
  browserFixture.agents.delete('/');
  await agent.call('browser.command', { threadId, tabId, action: { kind: 'close' } });
  expect(browserFixture.agents.has('/')).toBe(false);
}, 150_000);

real('boite browse opens its page as a new tab of the conversation browser, not in a panel of its own', async () => {
  const { owner, agent, threadId } = browserFixture;
  const mine = await agent.call('browser.command', { threadId, action: { kind: 'open', url: url() } });
  await owner.call('threads.subscribe', { threadId });
  const panels: unknown[] = [];
  owner.on('panel.requested', (event) => { if (event.threadId === threadId) panels.push(event); });
  expect(await agent.call('panel.open', { threadId, surface: { kind: 'browser', url: url('/shop') } })).toEqual({ shown: true });
  const status = (await agent.call('browser.command', { threadId, action: { kind: 'status' } })).value as { tabs: Array<{ tabId: string; url: string; active: boolean }> };
  // The agent's own page stays where it was; the new tab is the active one.
  expect(status.tabs).toMatchObject([{ tabId: mine.tabId, url: url(), active: false }, { url: url('/shop'), active: true }]);
  await Bun.sleep(100);
  expect(panels).toEqual([]);
}, 150_000);

real('an agent drives a page with agent-browser commands: refs, forms, dialogs and covered elements', () => traceBrowserCommands(async () => {
  const { agent, threadId } = browserFixture;
  const command = async (action: BrowserAction): Promise<unknown> => (await agent.call('browser.command', { threadId, action })).value;
  const opened = await agent.call('browser.command', { threadId, action: { kind: 'open', url: url('/shop'), reuse: true } });
  const { text } = await command({ kind: 'snapshot', interactive: true }) as { text: string };
  expect(text.split('\n')).toEqual([
    '- heading "Shop" [ref=e1] [level=1]',
    '- textbox "Name" [ref=e2]',
    '- button "Send" [ref=e3]',
    '- combobox [ref=e4]: "Small" [options=["Small","Large"]]',
    '- checkbox "Gift" [ref=e5] [checked]',
    '- button "Ask" [ref=e6]',
    '- button "Later" [ref=e7]',
    '- button "Under" [ref=e8]',
  ]);
  await command({ kind: 'fill', selector: '@e2', text: 'Ada' });
  await command({ kind: 'type', selector: '@e2', text: ' L' });
  expect(await command({ kind: 'get', what: 'value', selector: '@e2' })).toBe('Ada L');
  expect(await command({ kind: 'select', selector: '@e4', values: ['Large'] })).toMatchObject({ value: ['Large'] });
  expect(await evaluate('document.querySelector("#size").value')).toBe('l');
  await command({ kind: 'uncheck', selector: '@e5' });
  expect(await command({ kind: 'get', what: 'checked', selector: '#gift' })).toBe(false);
  // A dialog the command raised is answered by the policy and reported with it.
  expect(await command({ kind: 'click', selector: '@e6' })).toMatchObject({ dialogs: [{ type: 'confirm', message: 'Sure?', accepted: true }] });
  expect(await command({ kind: 'get', what: 'text', selector: '#ask' })).toBe('yes');
  await command({ kind: 'dialog', decision: 'dismiss' });
  expect(await command({ kind: 'click', selector: '@e6' })).toMatchObject({ dialogs: [{ type: 'confirm', accepted: false }] });
  await command({ kind: 'dialog', decision: 'accept' });
  // One raised after the command ended, as a person's tap would, is declined and not the agent's.
  const later = await command({ kind: 'click', selector: '@e7' }) as { dialogs?: unknown };
  expect(later.dialogs).toBeUndefined();
  await command({ kind: 'wait', text: 'Free', timeoutMs: 1000 });
  browserFixture.releaseLaterDialog();
  await browserFixture.laterDialogDone();
  expect(await command({ kind: 'get', what: 'title' })).toBe('later no');
  // A covered element refuses a click and names its cover with a ref; forced, it is reached through the DOM.
  expect(await thrown(command({ kind: 'click', selector: '@e8' }))).toThrow(/@e8 is covered by div#cover Cover \[ref=e\d+\].*nothing was clicked/);
  expect(await command({ kind: 'click', selector: '@e8', force: true })).toMatchObject({ note: expect.stringContaining('covered by div#cover') });
  expect(await thrown(command({ kind: 'click', selector: '@e70' }))).toThrow('unknown ref @e70');
  expect(await thrown(command({ kind: 'click', selector: 'button' }))).toThrow('matched 4');
  // Enter submits the form natively; the command waits for the next page and says where it went.
  await command({ kind: 'focus', selector: '@e2' });
  expect(await command({ kind: 'press', key: 'Enter' })).toMatchObject({ navigated: true, title: 'Sent', url: url('/sent?name=Ada+L') });
  expect(await thrown(command({ kind: 'click', selector: '@e3' }))).toThrow('belongs to an earlier page');
  // open drives the current tab, as agent-browser's does.
  const again = await agent.call('browser.command', { threadId, action: { kind: 'open', url: url('/shop'), reuse: true } });
  expect(again.tabId).toBe(opened.tabId);
  expect(await command({ kind: 'history', direction: 'back' })).toMatchObject({ navigated: true, title: 'Sent' });
  expect(await thrown(command({ kind: 'wait', selector: '#never', timeoutMs: 300 }))).toThrow('wait timed out after 300 ms');
}), 150_000);

real('a site sees the browser a person runs with a window, not headless Chrome', async () => {
  const { agent, threadId } = browserFixture;
  await agent.call('browser.command', { threadId, action: { kind: 'open', url: url() } });
  const seen = JSON.parse(String(await evaluate(`(async () => JSON.stringify({
    page: navigator.userAgent,
    webdriver: navigator.webdriver,
    versions: (await navigator.userAgentData.getHighEntropyValues(['fullVersionList'])).fullVersionList.length,
    screen: [screen.width, screen.height],
    window: [outerWidth, outerHeight],
    worker: await new Promise(resolve => { new Worker(URL.createObjectURL(new Blob(['postMessage(navigator.userAgent)']))).onmessage = event => resolve(event.data); }),
    request: await fetch('/missing').then(() => 'sent'),
  }))()`)));
  expect(seen.page).toMatch(/ Chrome\/\d+/);
  expect(seen.page).not.toContain('Headless');
  expect([seen.worker, browserFixture.agents.get('/'), browserFixture.agents.get('/missing')]).toEqual([seen.page, seen.page, seen.page]);
  expect(seen.webdriver).toBe(false);
  // `--user-agent` alone leaves the high-entropy client hints empty; the tab's override restores them.
  expect(seen.versions).toBeGreaterThan(1);
  expect(seen.screen[0]).toBeGreaterThanOrEqual(seen.window[0]);
  expect(seen.screen[1]).toBeGreaterThanOrEqual(seen.window[1]);
}, 150_000);

real('custom profile User-Agents cover pages, workers, popups and requests even with a desktop host', async () => {
  const { owner, agent, threadId } = browserFixture;
  const host = await browserFixture.fakeHost();
  try {
    await host.app.call('browser.hostAttach', {});
    await owner.call('settings.set', { browserProfiles: [
      { id: 'p-suffix', name: 'Suffix', userAgent: { mode: 'suffix', value: 'Bounty/1' } },
      { id: 'p-replace', name: 'Replace', userAgent: { mode: 'replace', value: 'Research/1' } },
    ] });
    for (const profile of ['p-suffix', 'p-replace']) {
      const opened = await agent.call('browser.command', { threadId, action: { kind: 'open', url: url(), profile } });
      // A custom profile must not use webviews: only a process flag reaches workers and popup requests.
      const status = async () => (await agent.call('browser.command', { threadId, action: { kind: 'status' } })).value as { tabs: Array<{ tabId: string; url: string; view?: string }> };
      expect((await status()).tabs.find(tab => tab.tabId === opened.tabId)?.view).toBeUndefined();
      const seen = await evaluate(`(async () => {
        const worker = await new Promise(resolve => { const w = new Worker(URL.createObjectURL(new Blob(['postMessage(navigator.userAgent)']))); w.onmessage = e => { w.terminate(); resolve(e.data); }; });
        await fetch('/ua-request');
        return { page: navigator.userAgent, worker,
          versions: (await navigator.userAgentData.getHighEntropyValues(['fullVersionList'])).fullVersionList.length };
      })()`, opened.tabId) as { page: string; worker: string; versions: number };
      await agent.call('browser.command', { threadId, tabId: opened.tabId, action: { kind: 'click', selector: '#pop' } });
      let popup: { tabId: string; url: string } | undefined;
      for (let i = 0; i < 100; i++) {
        popup = (await status()).tabs.find(tab => tab.url === url('/popup'));
        if (popup) break;
        await Bun.sleep(50);
      }
      expect(popup).toBeDefined();
      const popupAgent = await evaluate('navigator.userAgent', popup!.tabId);
      expect(seen.page).toMatch(profile === 'p-suffix' ? / Chrome\/.* Bounty\/1$/ : /^Research\/1$/);
      expect([seen.worker, popupAgent, browserFixture.agents.get('/'), browserFixture.agents.get('/popup'), browserFixture.agents.get('/ua-request')])
        .toEqual(Array(5).fill(seen.page));
      expect(seen.versions).toBeGreaterThan(1);
      await agent.call('browser.command', { threadId, tabId: popup!.tabId, action: { kind: 'close' } });
      await agent.call('browser.command', { threadId, tabId: opened.tabId, action: { kind: 'close' } });
    }
  } finally { await host.close(); }
}, 150_000);

real('an open agent tab does not hold back an update of the core', async () => {
  let stopping = 0;
  const updating = await startTestCore({ onShutdown: () => { stopping += 1; } });
  const client = await updating.connect();
  try {
    const thread = (await echoThread(updating, client)).threadId;
    await client.call('browser.command', { threadId: thread, action: { kind: 'open', url: url() } });
    // The browser process is alive with its tab, and nothing is running: the core may stop for an update.
    expect(updating.core.procs.liveThreads()).toContain('system:browser');
    expect(updating.core.requestIdleShutdown()).toBe('accepted');
  } finally { client.close(); await updating.stop(); }
  expect(stopping).toBeLessThanOrEqual(1);
}, 150_000);
