import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Cdp } from '../src/browser/cdp.ts';
import { findChromium } from '../src/browser/chromium.ts';
import { pageRuntime, readsConsole } from '../src/browser/page-runtime.ts';
import { createBrowserFixture } from './browser/fixture.ts';

// Sites and captchas test whether DevTools reads the page: with the runtime
// domain on, Chromium describes each console argument for the client, which
// formats an error's stack through the page's `Error.prepareStackTrace`. The
// page keeps watching, so errors it logged earlier count too: `probe()` logs
// one and says whether any was ever formatted.
const BAIT = `let seen = false;
Error.prepareStackTrace = (error, frames) => {
  if (error.message === 'bait') seen = true;
  return [String(error), ...frames.map(frame => '    at ' + frame)].join('\\n');
};
window.probe = () => { console.debug(new Error('bait')); return seen; };`;

// The top page and two frames: one of another origin on the same site, so in
// the page's renderer, and one of another site, in a process of its own.
// Each frame tells the top page what it saw, and its button says it was pressed.
const FRAME = (who: string) => `<!doctype html><title>${who}</title><button id="pay" onclick="top.postMessage('${who}-pressed yes', '*')">Pay ${who}</button>
<script>${BAIT} setInterval(() => top.postMessage('${who} ' + probe(), '*'), 50);</script>`;
const TOP = (port: number) => `<!doctype html><title>Shop</title><script>${BAIT}
window.heard = {}; addEventListener('message', event => { const [who, what] = String(event.data).split(' '); heard[who] = what; });
console.info('shop ready'); setInterval(probe, 0);</script>
<iframe title="Billing" src="http://pay.shop.example:${port}/frame?who=billing"></iframe>
<iframe title="Captcha" src="http://captcha.example:${port}/frame?who=captcha"></iframe>`;

const browserFixture = createBrowserFixture();
const chromium = findChromium().path;
// The page must be served under a public name: a wrapper maps `*.example` to this machine.
const real = chromium && process.platform !== 'win32' ? browserFixture.real : browserFixture.real.skip;

let site: ReturnType<typeof Bun.serve>, wrapperDir = '', savedBrowser: string | undefined;
beforeAll(() => {
  site = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: request => {
    const url = new URL(request.url);
    // A link to this machine that turns into a download: the public page stays.
    // A page of this machine that sends the tab on to the public site straight away.
    if (url.pathname === '/bounce') return new Response(`<script>setTimeout(() => location.href = 'http://shop.example:${url.port}/', ${Number(url.searchParams.get('delay'))});</script>`, { headers: { 'content-type': 'text/html' } });
    if (url.pathname === '/report.txt') return new Response('report', { headers: { 'content-disposition': 'attachment; filename=report.txt' } });
    const html = url.pathname === '/frame' ? FRAME(url.searchParams.get('who') ?? 'frame') : TOP(Number(url.port));
    return new Response(html, { headers: { 'content-type': 'text/html' } });
  } });
  if (!chromium || process.platform === 'win32') return;
  wrapperDir = mkdtempSync(join(tmpdir(), 'boite-public-'));
  const wrapper = join(wrapperDir, 'chrome');
  writeFileSync(wrapper, `#!/bin/sh\nexec '${chromium}' --host-resolver-rules='MAP *.example 127.0.0.1' "$@"\n`);
  chmodSync(wrapper, 0o755);
  savedBrowser = process.env.BOITE_BROWSER;
  process.env.BOITE_BROWSER = wrapper;
});
afterAll(() => {
  site.stop(true);
  if (savedBrowser === undefined) delete process.env.BOITE_BROWSER; else process.env.BOITE_BROWSER = savedBrowser;
  if (wrapperDir) rmSync(wrapperDir, { recursive: true, force: true });
});

real('a public page cannot tell DevTools drives it, and a page of this machine keeps its console in the diagnostics', async () => {
  const { agent, threadId, evaluate } = browserFixture;
  const command = async (action: Record<string, unknown>) => (await agent.call('browser.command', { threadId, action: action as never })).value as Record<string, unknown>;
  const heard = async (wanted: Record<string, string>) => {
    let last: unknown = null;
    for (const end = Date.now() + 8000; Date.now() < end; await Bun.sleep(50)) {
      last = await evaluate('JSON.stringify(heard)');
      const now = JSON.parse(String(last)) as Record<string, string>;
      if (Object.entries(wanted).every(([who, what]) => now[who] === what)) return;
    }
    expect(JSON.parse(String(last))).toMatchObject(wanted);
  };
  const consoleSaid = async () => ((await command({ kind: 'diagnostics' })).entries as Array<{ kind: string; text: string }>)
    .filter(entry => entry.kind === 'console').map(entry => entry.text);

  const shop = `http://shop.example:${site.port}/`;
  await command({ kind: 'open', url: shop });
  await command({ kind: 'wait', load: 'load' });
  expect(await evaluate('probe()')).toBe(false);
  await heard({ billing: 'false', captcha: 'false' });

  // The agent still reads and presses inside both frames, and reaching them leaves nothing
  // on, not even for an instant: the page logs an error on every tick of its event loop.
  let snapshot = '';
  for (let round = 0; round < 10; round++) snapshot = String((await command({ kind: 'snapshot', interactive: true })).text);
  for (const who of ['billing', 'captcha']) {
    const ref = new RegExp(`button "Pay ${who}" \\[ref=(e\\d+)\\]`).exec(snapshot);
    expect(ref, `${who} in\n${snapshot}`).not.toBeNull();
    await command({ kind: 'click', selector: `@${ref![1]}` });
    await heard({ [`${who}-pressed`]: 'yes' });
  }
  expect(await evaluate('probe()')).toBe(false);
  await heard({ billing: 'false', captcha: 'false' });
  expect(await consoleSaid()).not.toContain('shop ready');
  await evaluate(`location.href = 'http://127.0.0.1:${site.port}/report.txt'`);
  await Bun.sleep(500);
  expect(await evaluate('location.hostname')).toBe('shop.example');
  expect(await evaluate('probe()')).toBe(false);

  // The agent's own work, served from this machine, in the same tab: its console is read, so it can see it.
  await command({ kind: 'open', url: `http://127.0.0.1:${site.port}/`, reuse: true });
  await command({ kind: 'wait', load: 'load' });
  expect(await evaluate('probe()')).toBe(true);
  expect(await consoleSaid()).toContain('shop ready');

  // Back to the public page: it loads again rather than resuming from the back-forward
  // cache, so the runtime is off before its scripts run.
  await command({ kind: 'history', direction: 'back' });
  await command({ kind: 'wait', load: 'load' });
  expect(await evaluate('location.hostname')).toBe('shop.example');
  expect(await evaluate('probe()')).toBe(false);
  await heard({ billing: 'false', captcha: 'false' });

  // A page of this machine that leaves for the public site at once, before or while its runtime turns on.
  for (const delay of [0, 0, 1, 2, 5, 10, 20]) {
    const started = Date.now();
    await command({ kind: 'open', url: `http://127.0.0.1:${site.port}/bounce?delay=${delay}`, reuse: true });
    for (let tries = 0; tries < 100 && await evaluate('location.hostname') !== 'shop.example'; tries++) await Bun.sleep(20);
    await command({ kind: 'wait', load: 'load' });
    expect(await evaluate('probe()'), `left after ${delay} ms`).toBe(false);
    // The public document is held only while the runtime turns off, never for a command's timeout.
    expect(Date.now() - started, `left after ${delay} ms`).toBeLessThan(3000);
  }
}, 60_000);

real('a window opened on a page of this machine that moves on before it is adopted stays hidden', async () => {
  const { agent, threadId, evaluate } = browserFixture;
  const command = async (action: Record<string, unknown>) => (await agent.call('browser.command', { threadId, action: action as never })).value as Record<string, unknown>;
  const root = (await agent.call('browser.command', { threadId, action: { kind: 'open', url: `http://shop.example:${site.port}/` } })).tabId;
  await command({ kind: 'wait', load: 'load' });
  // The core reads the new window's address once it attached; that answer is held back
  // until the window has already moved on to the public site.
  const send = Cdp.prototype.send;
  let captured = false, resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  Cdp.prototype.send = async function (this: Cdp, ...args: Parameters<Cdp['send']>) {
    const result = await send.apply(this, args);
    if (args[0] === 'Target.getTargetInfo' && String((result as { targetInfo?: { url?: string } }).targetInfo?.url).startsWith('http://127.0.0.1:')) { captured = true; await gate; }
    return result;
  } as Cdp['send'];
  try {
    await evaluate(`window.popup = window.open('http://127.0.0.1:${site.port}/', 'private'); true`, root);
    for (let tries = 0; tries < 100 && !captured; tries++) await Bun.sleep(10);
    expect(captured).toBe(true);
    await evaluate(`window.popup.location.href = 'http://shop.example:${site.port}/'; true`, root);
    await Bun.sleep(100);
    resume();
    for (let tries = 0; tries < 100 && ((await command({ kind: 'status' })).tabs as unknown[]).length < 2; tries++) await Bun.sleep(10);
    await command({ kind: 'wait', load: 'load' });
    expect(await evaluate('location.hostname')).toBe('shop.example');
    expect(await evaluate('probe()')).toBe(false);
  } finally { resume(); Cdp.prototype.send = send; }
});

test('the console is read on pages of this machine and private networks, not on public sites', () => {
  for (const url of ['http://localhost:5173/', 'http://app.localhost/', 'http://127.0.0.1:8080/', 'http://[::1]:3000/', 'http://10.1.2.3/', 'http://172.20.0.5/',
    'http://192.168.1.3/', 'http://100.64.0.15:3773/', 'http://nas.local/', 'file:///tmp/page.html', 'http://[fd7a:115c:a1e0::1]/']) {
    expect(readsConsole(url), url).toBe(true);
  }
  for (const url of ['https://accounts.hcaptcha.com/demo', 'https://example.com/', 'http://172.32.0.1/', 'http://100.128.0.1/', 'http://8.8.8.8/', 'http://ws./', 'http://devbox:8080/', 'about:blank', 'data:text/html,hi', 'not a url']) {
    expect(readsConsole(url), url).toBe(false);
  }
});

test('a public document that comes while the runtime leaves waits until it has left', async () => {
  let left!: () => void;
  const leaving = new Promise<void>(resolve => { left = resolve; });
  const released: string[] = [];
  const cdp = { send: async (method: string, params: Record<string, unknown>) => {
    if (method === 'Target.attachToTarget') return { sessionId: 'runtime' };
    if (method === 'Target.detachFromTarget') await leaving;
    if (method === 'Fetch.continueRequest') released.push(String(params.requestId));
    return {};
  } };
  const runtime = pageRuntime(cdp as never, 'tab', 'target');
  await runtime.follow('http://127.0.0.1/');
  const first = runtime.follow('https://first.example/', 'first');
  await Bun.sleep(0);
  const second = runtime.follow('https://second.example/', 'second');
  await Bun.sleep(10);
  expect(released).toEqual([]);
  left();
  await Promise.all([first, second]);
  expect(released.sort()).toEqual(['first', 'second']);
});
