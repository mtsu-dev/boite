/**
 * How long a phone's navigation takes to answer, on the in-memory fake client,
 * in headless Chrome at a phone's size with software compositing: from the
 * touch (or the system Back) to the first frame that shows the change, then to
 * the end of the move it starts. docs/internals/performance.md, "What a tap costs".
 *
 * Run: bun bench/ui-latency.ts [--cpu 4] [--runs 5] [--bundle <dir>] [--browser <chrome>] [--profile <dir>]
 *
 * `--cpu 4` slows the page's CPU four times, about a mid-range phone's WebView
 * next to a desktop core. Without --bundle it builds the UI once, as
 * `bench/ui-frames.ts --build` does.
 *
 * "System Back" calls `history.back()`, what a browser's Back does, and what
 * the Android app's did before it answered Back itself; "app Back" calls
 * `answerAndroidBack()`, what the Android app's Back runs now
 * (`lib/android-back.ts`).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ONBOARDING_STORAGE_KEY, ONBOARDING_VERSION } from '../packages/ui/src/lib/onboarding.ts';
import { findBrowser, freePort } from '../tests/e2e/lib/cdp.ts';

const argv = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at < 0 ? undefined : argv[at + 1];
};
const CPU = Number(option('cpu') ?? 4);
const RUNS = Number(option('runs') ?? 5);
const W = 390, H = 844;
/** `--profile <dir>` writes a CPU profile of each step's first run there. */
const PROFILE = option('profile');

/**
 * In the page: `__probe(start)` resolves with the time from `start` to the
 * first DOM change, to the frame after it, and to the end of every finite
 * animation that change started.
 */
const SETUP = `
  try { localStorage.setItem(${JSON.stringify(ONBOARDING_STORAGE_KEY)}, ${JSON.stringify(JSON.stringify({ version: ONBOARDING_VERSION, at: 0 }))}); } catch {}
  window.__touch = 0;
  addEventListener('pointerdown', (event) => { window.__touch = event.timeStamp; }, true);
  window.__probe = (start) => new Promise((resolve) => {
    let changed = 0;
    const observer = new MutationObserver(() => {
      if (changed) return;
      changed = performance.now();
      observer.disconnect();
      requestAnimationFrame(() => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          const painted = performance.now();
          // Read once, not every frame: a probe that walks the animations each frame would slow what it measures.
          const moves = document.getAnimations().filter((a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime));
          void Promise.allSettled(moves.map((a) => a.finished)).then(() => {
            const s = start();
            resolve({ change: changed - s, paint: painted - s, settled: performance.now() - s });
          });
        };
        channel.port2.postMessage(0);
      });
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    setTimeout(() => { if (!changed) { observer.disconnect(); resolve(null); } }, 3000);
  });
`;

class Page {
  #id = 0;
  #pending = new Map<number, (value: Record<string, unknown>) => void>();
  constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const { id, result } = JSON.parse(String(event.data)) as { id?: number; result?: Record<string, unknown> };
      if (typeof id !== 'number') return;
      this.#pending.get(id)?.(result ?? {});
      this.#pending.delete(id);
    });
  }
  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = ++this.#id;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => this.#pending.set(id, resolve));
  }
  async evaluate<T>(expression: string): Promise<T> {
    const answer = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }) as { result?: { value?: T }; exceptionDetails?: unknown };
    if (answer.exceptionDetails) throw new Error(JSON.stringify(answer.exceptionDetails).slice(0, 400));
    return answer.result?.value as T;
  }
  async waitFor(expression: string, ms = 30_000): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await this.evaluate<boolean>(`!!(${expression})`)) return;
      await Bun.sleep(50);
    }
    throw new Error(`timed out waiting for ${expression}`);
  }
}

type Sample = { change: number; paint: number; settled: number } | null;

async function main(): Promise<void> {
  const own = option('bundle') === undefined;
  const bundle = option('bundle') ?? mkdtempSync(join(tmpdir(), 'boite-ui-latency-'));
  if (own) {
    const builder = Bun.spawn({ cmd: [process.execPath, join(import.meta.dir, 'ui-frames.ts'), '--build', bundle], stdout: 'inherit', stderr: 'inherit' });
    if ((await builder.exited) !== 0) throw new Error('the UI build failed');
  }
  const uiPort = await freePort();
  const server = Bun.serve({
    port: uiPort,
    hostname: '127.0.0.1',
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const file = Bun.file(join(bundle, path === '/' ? 'index.html' : path));
      return (await file.exists()) ? new Response(file) : new Response(Bun.file(join(bundle, 'index.html')));
    },
  });
  const debugPort = await freePort();
  const profile = mkdtempSync(join(tmpdir(), 'boite-ui-latency-profile-'));
  const chrome = Bun.spawn({
    cmd: [option('browser') ?? findBrowser(), '--headless=new', '--disable-gpu', '--disable-software-rasterizer', '--disable-3d-apis', '--mute-audio',
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--lang=en-US',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-allow-origins=*',
      `--window-size=${W},${H}`, `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, 'about:blank'],
    stdout: 'ignore', stderr: 'ignore', windowsHide: true,
  });
  try {
    let target: { type: string; webSocketDebuggerUrl: string } | undefined;
    for (let attempt = 0; attempt < 100 && !target; attempt++) {
      try { target = ((await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((entry) => entry.type === 'page'); } catch { /* not up yet */ }
      if (!target) await Bun.sleep(100);
    }
    if (!target) throw new Error('Chrome opened no page');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ready) => socket.addEventListener('open', ready));
    const page = new Page(socket);
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SETUP });
    await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.send('Page.navigate', { url: `http://127.0.0.1:${uiPort}/?fake=1` });
    await page.waitFor(`document.readyState === 'complete' && globalThis.__bench?.store?.booted`);
    await Bun.sleep(1500);
    await page.send('Emulation.setCPUThrottlingRate', { rate: CPU });

    /** A finger's tap on the element `css` finds: a real touch through the compositor. */
    const tap = async (css: string): Promise<void> => {
      const box = await page.evaluate<{ x: number; y: number } | null>(`(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      if (!box) throw new Error(`nothing to tap at ${css}`);
      const point = { x: box.x, y: box.y, id: 1 };
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await Bun.sleep(40);
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    /** Starts the probe, runs `act`, and waits for the probe's answer. `from` names the clock's start in the page. */
    const measure = async (act: () => Promise<void>, from: 'touch' | 'mark'): Promise<Sample> => {
      await page.evaluate(`(window.__mark = 0, window.__touch = 0, window.__result = undefined, window.__probe(() => ${from === 'touch' ? 'window.__touch' : 'window.__mark'}).then((r) => { window.__result = r; }), true)`);
      await act();
      await page.waitFor(`window.__result !== undefined`, 10_000);
      return page.evaluate<Sample>(`window.__result`);
    };
    const mark = (expression: string) => () => page.evaluate<void>(`(window.__mark = performance.now(), ${expression}, undefined)`);

    const steps: { name: string; run: () => Promise<Sample>; ready: string }[] = [
      { name: 'open a conversation (tap)', run: () => measure(() => tap('.mobile-list:not(.covered) [data-testid^=mobile-thread-]'), 'touch'), ready: `document.querySelector('[data-testid=mobile-back]')` },
      { name: 'back to the list (arrow tap)', run: () => measure(() => tap('[data-testid=mobile-back]'), 'touch'), ready: `!document.querySelector('[data-testid=mobile-back]')` },
      { name: 'open a conversation (tap)', run: () => measure(() => tap('.mobile-list:not(.covered) [data-testid^=mobile-thread-]'), 'touch'), ready: `document.querySelector('[data-testid=mobile-back]')` },
      { name: 'back to the list (system Back)', run: () => measure(mark('history.back()'), 'mark'), ready: `!document.querySelector('[data-testid=mobile-back]')` },
      ...(await page.evaluate<boolean>(`typeof globalThis.__bench.back === 'function'`) ? [
        { name: 'open a conversation (tap)', run: () => measure(() => tap('.mobile-list:not(.covered) [data-testid^=mobile-thread-]'), 'touch'), ready: `document.querySelector('[data-testid=mobile-back]')` },
        { name: 'back to the list (app Back)', run: () => measure(mark('globalThis.__bench.back()'), 'mark'), ready: `!document.querySelector('[data-testid=mobile-back]')` },
      ] : []),
      { name: 'open Settings (tap)', run: () => measure(() => tap('[data-testid=mobile-settings]'), 'touch'), ready: `document.querySelector('[data-testid=mobile-settings-leave]')` },
      { name: 'leave Settings (system Back)', run: () => measure(mark('history.back()'), 'mark'), ready: `!document.querySelector('[data-testid=mobile-settings-leave]')` },
    ];

    // The fake lands in a conversation: the list is one Back away.
    await page.waitFor(`document.querySelector('[data-testid=mobile-back]')`);
    await tap('[data-testid=mobile-back]');
    await page.waitFor(`document.querySelector('[data-testid^=mobile-thread-]')`);
    await Bun.sleep(600);

    const results = new Map<string, Sample[]>();
    if (PROFILE) { await page.send('Profiler.enable'); await page.send('Profiler.setSamplingInterval', { interval: 200 }); }
    for (let run = 0; run < RUNS; run++) {
      for (const [index, step] of steps.entries()) {
        if (PROFILE && run === 0) await page.send('Profiler.start');
        const sample = await step.run();
        if (PROFILE && run === 0) {
          const { profile: cpu } = await page.send('Profiler.stop') as { profile: unknown };
          await Bun.write(join(PROFILE, `${index}-${step.name.replace(/\W+/g, '-')}.cpuprofile`), JSON.stringify(cpu));
        }
        await page.waitFor(step.ready, 10_000);
        await Bun.sleep(500);
        results.set(step.name, [...(results.get(step.name) ?? []), sample]);
      }
    }
    const median = (values: number[]): number => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? NaN; };
    console.log(`phone ${W}x${H}, CPU slowed ${CPU}x, ${RUNS} runs, medians in ms (worst)`);
    console.log('step | to first change | to first frame | to the end of the move');
    for (const [name, samples] of results) {
      const ok = samples.filter((s): s is NonNullable<Sample> => s !== null);
      const cell = (key: 'change' | 'paint' | 'settled') => `${median(ok.map((s) => s[key])).toFixed(0)} (${Math.max(...ok.map((s) => s[key])).toFixed(0)})`;
      console.log(`${name} | ${cell('change')} | ${cell('paint')} | ${cell('settled')}${ok.length < samples.length ? ` | ${samples.length - ok.length} changed nothing` : ''}`);
    }
  } finally {
    chrome.kill();
    await chrome.exited;
    void server.stop(true);
    rmSync(profile, { recursive: true, force: true });
    if (own) rmSync(bundle, { recursive: true, force: true });
  }
}

await main();
