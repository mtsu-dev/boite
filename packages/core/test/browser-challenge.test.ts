import { afterAll, beforeAll, expect, test } from 'bun:test';
import { connect, type CoreClient } from '../src/client.ts';
import { challengeNote, passChallenge, type Challenge, type ChallengePage } from '../src/browser/challenge.ts';
import { chromiumArgs, findChromium, gpuArgs, type GpuProbe } from '../src/browser/chromium.ts';
import { echoThread, startTestCore, type TestCore } from './harness.ts';

// Local pages that carry each vendor's own markers: element ids, script and frame addresses, titles.
// No vendor is contacted. A widget frame is served from `localhost`, another site than the page's
// `127.0.0.1`, so a click reaches it through the browser as it does a real widget.
const html = (body: string) => new Response(`<!doctype html>${body}`, { headers: { 'content-type': 'text/html' } });
/** A checkbox widget: it reports a click a pointer led to, and tells the page that embeds it. */
const WIDGET = `<body style="margin:0"><div id=box style="position:absolute;left:14px;top:22px;width:32px;height:32px;border:1px solid"></div><script>
let moves = 0; addEventListener('mousemove', () => moves++);
box.addEventListener('click', event => { if (!event.isTrusted) return; fetch('/clicked?moves=' + moves, { mode: 'no-cors' }); parent.postMessage('checked', '*'); });
</script>`;
const frame = (port: number, path: string, height = 78) => `<iframe src="http://localhost:${port}${path}" width=304 height=${height} style="border:0"></iframe>`;

let site: ReturnType<typeof Bun.serve>;
let clicks: number[] = [], reloads = 0, unrelated = 0;
let harness: TestCore, owner: CoreClient, agent: CoreClient, threadId: string, tabId: string;
const real = findChromium().path ? test : test.skip;
const url = (path: string) => `http://127.0.0.1:${site.port}${path}`;

beforeAll(async () => {
  site = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: request => {
    const at = new URL(request.url), path = at.pathname, port = site.port!;
    if (path === '/unrelated') { unrelated++; return new Response('ok'); }
    if (path === '/clicked') { clicks.push(Number(at.searchParams.get('moves'))); return new Response('ok'); }
    if (path === '/done') return html('<title>Shop</title><h1>Welcome to the shop</h1>');
    if (path === '/plain') return html('<title>Plain</title><h1>Nothing to pass</h1>');
    // Cloudflare's wait page, cleared by its own script.
    if (path === '/cf-auto') return html('<title>Just a moment...</title><script>window._cf_chl_opt = { cType: "managed" }; setTimeout(() => location.replace("/done"), 900)</script><div id="challenge-running">Verifying you are human</div>');
    // The same page with a Turnstile box, in a closed shadow root as Cloudflare builds it.
    if (path === '/cf-box') return html(`<title>Just a moment...</title><script>window._cf_chl_opt = {}</script><div style="margin-top:900px"><div id=host><input type=hidden name="cf-turnstile-response"></div></div><script>
      host.attachShadow({ mode: 'closed' }).innerHTML = ${JSON.stringify(frame(port, '/cdn-cgi/challenge-platform/turnstile', 65))};
      addEventListener('message', event => { if (event.data === 'checked') location.replace('/done'); });</script>`);
    if (path === '/cdn-cgi/challenge-platform/turnstile' || path === '/recaptcha/api2/anchor' || path === '/hcaptcha.com/checkbox') return html(WIDGET);
    if (path === '/recaptcha/api2/bframe') return html('pick every image with a bus');
    // A reCAPTCHA alone on its page; with `puzzle`, the click opens the image puzzle.
    // With `covered`, a button the page draws over the widget, which a click on the box would press.
    if (path === '/recaptcha') return html(`<title>Check</title><p>Confirm you are not a robot</p>${frame(port, '/recaptcha/api2/anchor?k=site')}${at.searchParams.has('covered') ? '<div style="position:fixed;left:0;top:0;width:420px;height:240px;background:#fff" onclick="fetch(\'/unrelated\')">Promo</div>' : ''}<textarea name="g-recaptcha-response" style="display:none"></textarea>
      <div id=puzzle style="visibility:hidden">${frame(port, '/recaptcha/api2/bframe?k=site', 300)}</div><script>
      addEventListener('message', event => { if (event.data !== 'checked') return; if (${at.searchParams.has('puzzle')}) puzzle.style.visibility = 'visible'; else document.querySelector('textarea').value = 'token'; });</script>`);
    if (path === '/hcaptcha') return html(`<title>Check</title>${frame(port, '/hcaptcha.com/checkbox#frame=checkbox&id=0')}<textarea name="h-captcha-response" style="display:none"></textarea><script>
      addEventListener('message', event => { if (event.data === 'checked') document.querySelector('textarea').value = 'token'; });</script>`);
    // The same widget inside a form the agent came to fill in: not a wall.
    if (path === '/form') return html(`<title>Sign up</title><form><input type=email name=email>${frame(port, '/recaptcha/api2/anchor?k=site')}<textarea name="g-recaptcha-response" style="display:none"></textarea><button>Join</button></form>`);
    if (path === '/px') return html('<title>Access to this page has been denied</title><script>window._pxAppId = "PX12345"</script><div id="px-captcha"></div><p>Press &amp; Hold to confirm you are a human</p>');
    if (path === '/datadome') return html(`<title>shop.example</title><iframe src="http://localhost:${port}/geo.captcha-delivery.com/captcha/" width=400 height=300></iframe>`);
    if (path === '/geo.captcha-delivery.com/captcha/') return html('slide the piece');
    if (path === '/akamai') return html('<title>Challenge Validation</title><div id="sec-if-cpt-container"><iframe id="sec-cpt-if" src="about:blank"></iframe></div><script>setTimeout(() => location.replace("/done"), 700)</script>');
    if (path === '/amazon') return html('<title>Amazon.com</title><form action="/errors/validateCaptcha"><h4>Type the characters you see in this image:</h4><input name="field-keywords"><button>Continue shopping</button></form>');
    if (path === '/blocked') return html('<title>Attention Required! | Cloudflare</title><div class="cf-wrapper cf-error-details"><h1>Sorry, you have been blocked</h1></div>');
    // A shop that asks for a check on its second load, as after a reload.
    if (path === '/second') return ++reloads === 1 ? html('<title>Shop</title><h1>First visit</h1>') : html('<title>Just a moment...</title><script>window._cf_chl_opt = {}; setTimeout(() => location.replace("/done"), 1500)</script>');
    return new Response('missing', { status: 404 });
  } });
  if (!findChromium().path) return;
  harness = await startTestCore();
  owner = await harness.connect();
  ({ threadId } = await echoThread(harness, owner));
  agent = await connect(harness.url, harness.core.agents.tokenFor(threadId), { client: { name: 'boite-cli', version: 'test' } });
  tabId = (await agent.call('browser.command', { threadId, action: { kind: 'open', url: url('/plain') } })).tabId!;
}, 120_000);

afterAll(async () => {
  agent?.close(); owner?.close();
  await harness?.stop();
  await site.stop(true);
}, 60_000);

type Value = { url: string; title: string; note?: string };
async function go(path: string): Promise<Value & { ms: number }> {
  const at = performance.now();
  const reply = await agent.call('browser.command', { threadId, tabId, action: { kind: 'navigate', url: url(path) } });
  return { ...reply.value as Value, ms: performance.now() - at };
}

real('a page with no check gets no note and no wait, a widget inside a form included', async () => {
  clicks = [];
  const plain = await go('/plain');
  expect(plain.note).toBeUndefined();
  expect(plain.ms).toBeLessThan(1500);
  const form = await go('/form');
  expect(form.note).toBeUndefined();
  expect(clicks).toEqual([]);
}, 60_000);

real('a check that clears by itself is waited for, and the reply names the page it gave way to', async () => {
  clicks = [];
  const cloudflare = await go('/cf-auto');
  expect(cloudflare.note).toMatch(/^passed a Cloudflare check in \d\.\d s$/);
  expect(cloudflare).toMatchObject({ url: url('/done'), title: 'Shop' });
  expect((await go('/akamai')).note).toMatch(/^passed an Akamai check in \d\.\d s$/);
  expect(clicks).toEqual([]);
}, 60_000);

real('a checkbox is clicked once with a pointer that moved to it, below the fold too', async () => {
  clicks = [];
  const turnstile = await go('/cf-box');
  expect(turnstile.note).toMatch(/^passed a Cloudflare check in \d\.\d s \(its checkbox was clicked\)$/);
  expect(turnstile.url).toBe(url('/done'));
  expect(clicks).toHaveLength(1);
  expect(clicks[0]).toBeGreaterThanOrEqual(3);
  expect((await go('/recaptcha')).note).toMatch(/^passed a reCAPTCHA check in \d\.\d s \(its checkbox was clicked\)$/);
  expect(clicks).toHaveLength(2);
  expect((await go('/hcaptcha')).note).toMatch(/^passed an hCaptcha check in \d\.\d s \(its checkbox was clicked\)$/);
  expect(clicks).toHaveLength(3);
  // A box something covers is not clicked: the click would land on the cover.
  unrelated = 0;
  clicks = [];
  expect((await go('/recaptcha?covered')).note).toMatch(/^still on a reCAPTCHA check after 12 s \(something covers its checkbox, so nothing was clicked\)/);
  expect([clicks, unrelated]).toEqual([[], 0]);
}, 60_000);

real('a check that needs more than a click is named at once for the agent to try', async () => {
  clicks = [];
  const puzzle = await go('/recaptcha?puzzle');
  expect(puzzle.note).toBe('on a reCAPTCHA image puzzle (its checkbox was clicked), which does not clear by itself; take a screenshot, act on the page, or ask the user to take over in the panel');
  expect(clicks).toHaveLength(1);
  for (const [path, note] of [['/px', /^on a HUMAN press-and-hold check, which/], ['/datadome', /^on a DataDome slider puzzle, which/], ['/amazon', /^on an Amazon captcha page, which/], ['/blocked', /^Cloudflare refused this browser/]] as const) {
    const reply = await go(path);
    expect(reply.note).toMatch(note);
    expect(reply.ms).toBeLessThan(2500);
  }
  // The puzzle's checkbox is the only click: none of the pages after it was clicked.
  expect(clicks).toHaveLength(1);
}, 60_000);

real('a reload that lands on a check passes it too', async () => {
  reloads = 0;
  expect((await go('/second')).note).toBeUndefined();
  const reply = await agent.call('browser.command', { threadId, tabId, action: { kind: 'history', direction: 'reload' } });
  expect((reply.value as Value).note).toMatch(/passed a Cloudflare check in \d\.\d s$/);
  const status = await agent.call('browser.command', { threadId, action: { kind: 'status' } });
  expect(JSON.stringify(status.value)).toContain(url('/done'));
}, 60_000);

/** A page that answers each look with the next of `looks`, the last one for ever; `throw` is a page between two documents. */
function scripted(looks: Array<Challenge | null | 'throw'>, reaches = true) {
  const sent: string[] = [];
  let at = 0;
  const page: ChallengePage = {
    evaluate: async expression => {
      // The look just before a press asks whether the widget receives the point; it does not move the script on.
      if (expression.includes('elementFromPoint')) {
        const look = looks[Math.min(at, looks.length - 1)];
        return look && look !== 'throw' && look.box ? { ...look, box: { ...look.box, hit: reaches } } : look === 'throw' ? null : look;
      }
      const look = looks[Math.min(at++, looks.length - 1)];
      if (look === 'throw') throw new Error('no document');
      return look;
    },
    send: async (method, params) => { sent.push(`${method}:${String(params?.type)}`); return {}; },
  };
  return { page, sent, looks: () => at };
}

test('the wait stops at its bound, clicks once, and takes a page between two documents as still checking', async () => {
  expect(await passChallenge(scripted([null]).page, 500)).toBeNull();
  const none = scripted([null]);
  await passChallenge(none.page, 500);
  expect(none.looks()).toBe(1);

  const box: Challenge = { vendor: 'hCaptcha', kind: 'checkbox', box: { x: 100, y: 200, width: 303, height: 78 } };
  const stuck = scripted([box]);
  const outcome = await passChallenge(stuck.page, 1500);
  expect(outcome).toMatchObject({ vendor: 'hCaptcha', passed: false, clicked: true });
  expect(outcome!.note).toMatch(/^still on an hCaptcha check after 1\.\d s \(its checkbox was clicked\); take a screenshot/);
  expect(outcome!.ms).toBeLessThan(2500);
  expect(stuck.sent.filter(one => one.endsWith('mousePressed'))).toHaveLength(1);
  expect(stuck.sent.filter(one => one.endsWith('mouseMoved')).length).toBeGreaterThanOrEqual(4);
  expect(stuck.sent.at(-1)).toBe('Input.dispatchMouseEvent:mouseReleased');

  // Something drawn over the box would take the click: the pointer moves, nothing is pressed, and the note says why.
  const covered = scripted([box], false);
  const held = await passChallenge(covered.page, 1500);
  expect(held).toMatchObject({ passed: false, clicked: false });
  expect(held!.note).toMatch(/^still on an hCaptcha check after 1\.\d s \(something covers its checkbox, so nothing was clicked\)/);
  expect(covered.sent.filter(one => !one.endsWith('mouseMoved'))).toEqual([]);

  // One empty look between two steps of a check is not a pass; two in a row are.
  const auto: Challenge = { vendor: 'Cloudflare', kind: 'auto' };
  const stepped = await passChallenge(scripted([auto, null, auto, 'throw', null, null]).page, 5000);
  expect(stepped).toMatchObject({ passed: true, clicked: false });
  expect(stepped!.ms).toBeGreaterThanOrEqual(1200);
  expect(challengeNote(auto, false, false, 12_000)).toBe('still on a Cloudflare check after 12 s; take a screenshot, act on the page, or ask the user to take over in the panel');
}, 30_000);

test('the GPU is on where the machine has one, and WebGL is never drawn in software', () => {
  const probe = (renderNode: boolean, vulkanDriver = true, virtualMac = false): GpuProbe => ({ renderNode: () => renderNode, vulkanDriver: () => vulkanDriver, virtualMac: () => virtualMac });
  expect(gpuArgs('linux', {}, probe(true))).toEqual(['--use-angle=vulkan', '--disable-software-rasterizer']);
  expect(gpuArgs('linux', {}, probe(true, false))).toEqual(['--disable-software-rasterizer']);
  expect(gpuArgs('linux', {}, probe(false))).toEqual(['--disable-gpu', '--disable-software-rasterizer']);
  expect(gpuArgs('win32', {}, probe(false))).toEqual(['--disable-software-rasterizer']);
  expect(gpuArgs('darwin', {}, probe(false))).toEqual(['--disable-software-rasterizer']);
  expect(gpuArgs('darwin', {}, probe(false, false, true))).toEqual(['--disable-gpu', '--disable-software-rasterizer']);
  for (const platform of ['linux', 'darwin', 'win32'] as const) {
    expect(gpuArgs(platform, { BOITE_BROWSER_GPU: 'off' }, probe(true))).toEqual(['--disable-gpu', '--disable-software-rasterizer']);
    const args = chromiumArgs('/profile', platform, undefined, gpuArgs(platform, {}, probe(true)));
    expect(args).toEqual(expect.arrayContaining(['--disable-software-rasterizer', '--force-device-scale-factor=2']));
    for (const gone of ['--disable-gpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=swiftshader']) expect(args).not.toContain(gone);
  }
});

test('Chrome stable is found before Chrome for Testing or Chromium on PATH, and BOITE_BROWSER still wins', () => {
  const onPath = (name: string) => name === 'google-chrome' || name === 'chromium' ? `/usr/bin/${name}` : null;
  const installed = (...paths: string[]) => (path: string) => paths.includes(path);
  expect(findChromium({}, 'linux', onPath, installed('/opt/google/chrome/chrome', '/opt/google/chrome-beta/chrome'))).toEqual({ path: '/opt/google/chrome/chrome' });
  expect(findChromium({}, 'linux', onPath, installed('/opt/google/chrome-unstable/chrome', '/opt/google/chrome-beta/chrome'))).toEqual({ path: '/opt/google/chrome-beta/chrome' });
  expect(findChromium({}, 'linux', onPath, installed())).toEqual({ path: '/usr/bin/google-chrome' });
  expect(findChromium({ BOITE_BROWSER: '/own/chrome' }, 'linux', onPath, installed('/opt/google/chrome/chrome', '/own/chrome'))).toEqual({ path: '/own/chrome' });
  // The Linux paths are not looked at on another system.
  expect(findChromium({}, 'darwin', onPath, installed('/opt/google/chrome/chrome'))).toEqual({ path: '/usr/bin/google-chrome' });
});
