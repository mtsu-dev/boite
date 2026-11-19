import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BrowserPage } from '../../tests/e2e/lib/cdp.ts';
import { HISTORY, MOCHI, POOL_SIZE, SIZES } from './fixture.ts';
import { installProbe, type ClickSample, type FrameSample } from './probe.ts';
import { profiled } from './trace.ts';

interface Options {
  browser?: string;
  bundle?: string;
  runs: number;
  only?: string;
  trace?: string;
}
type Cases = Record<string, (bench: Bench) => Promise<Record<string, unknown>>>;

const VIEWPORT = { width: 1280, height: 900 };
const SHORT = 't-trace';
const KEYS = 'type while the other agents work in the background.'.slice(0, 48);
const PROMPT = 'A streaming paragraph with enough words to wrap on a normal conversation.\n\n'.repeat(72);
const testId = (id: string) => `[data-testid="${id}"]`;
const query = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;
const row = (id: string) => `${testId('thread-row')}[data-thread-id="${id}"]`;
const panelTab = (kind: string) => `${testId('panel-tab')}[data-kind="${kind}"]`;
const selectedPanel = (kind: string) => query(`${panelTab(kind)}[aria-selected=true]`);
const timeline = query(testId('timeline'));
const chat = query(testId('chat'));
const store = '__bench.store';
const probe = '__latency';
const composer = query(testId('composer-input'));
const paintedMessages = query(`${testId('timeline')} [data-mid]`);
const threadReady = (id: string) => `${store}.openThread?.id === ${JSON.stringify(id)} && ${paintedMessages} ? ${chat} : null`;
const mochiRail = `${testId('rail-bot')}[aria-label^="${MOCHI}"]`;
const mochiReady = `${query(mochiRail + '[aria-current=page]')} && ${store}.page === 'agents' && ${paintedMessages} ? ${chat} : null`;

function quantile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

function percentiles(values: number[]) {
  return { count: values.length, p50: quantile(values, 0.5), p95: quantile(values, 0.95), max: quantile(values, 1) };
}

async function loadAverage(): Promise<string | null> {
  return Bun.file('/proc/loadavg').text().then(value => value.trim(), () => null);
}

class Bench {
  constructor(readonly page: BrowserPage, private readonly origin: string, private readonly traceDir: string | undefined) {}

  async open(size: number, params = ''): Promise<void> {
    await this.page.send('Storage.clearDataForOrigin', { origin: this.origin, storageTypes: 'local_storage,indexeddb' });
    await this.page.navigate(`${this.origin}/?fake=1&latency=${size}&${params}`);
    await this.page.waitFor(`${store}.booted && ${query(row(HISTORY))}`, 30_000);
    await this.frames(3);
  }

  async frames(count: number): Promise<void> {
    await this.page.evaluate(`(async () => { for (let i = 0; i < ${count}; i++) await ${probe}.afterPaint(); })()`);
  }

  async pointer(selector: string): Promise<{ x: number; y: number }> {
    const target = query(selector);
    await this.page.waitFor(`${target}?.checkVisibility()`, 8000);
    await this.page.evaluate(`${target}.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })`);
    const point = `(() => {
      const target = ${target};
      if (!target) return null;
      const box = target.getBoundingClientRect();
      const x = box.left + box.width / 2, y = box.top + box.height / 2;
      return target.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
    })()`;
    await this.page.waitFor(point, 5000);
    return this.page.evaluate<{ x: number; y: number }>(point);
  }

  async press(point: { x: number; y: number }): Promise<void> {
    await this.page.send('Input.dispatchMouseEvent', { ...point, type: 'mousePressed', button: 'left', clickCount: 1 });
    await this.page.send('Input.dispatchMouseEvent', { ...point, type: 'mouseReleased', button: 'left', clickCount: 1 });
  }

  async click(selector: string, ready: string, label: string): Promise<ClickSample> {
    const point = await this.pointer(selector);
    await this.page.evaluate(`${probe}.armClick(${JSON.stringify(selector)}, () => (${ready}), ${JSON.stringify(label)})`);
    await this.press(point);
    return this.page.evaluate<ClickSample>(`${probe}.click()`, 15_000);
  }

  async measure<T>(label: string, scenario: () => Promise<T>): Promise<T> {
    return profiled(this.page, this.traceDir, label, scenario);
  }

  async prepareHistory(size: number, followTail = false): Promise<number> {
    if (!followTail) {
      const point = await this.pointer(testId('timeline'));
      await this.page.send('Input.dispatchMouseEvent', { ...point, type: 'mouseWheel', deltaX: 0, deltaY: -480 });
      await this.page.waitFor(`${timeline}.classList.contains('below')`);
    }
    const fetched = await this.page.evaluate<number>(`(async () => {
      const threadId = ${store}.openThread.id;
      globalThis.__latencyPreloadCount = 0;
      globalThis.__latencyPreload = threadId;
      try {
        await ${store}.open(threadId);
      } finally {
        globalThis.__latencyPreload = undefined;
      }
      return globalThis.__latencyPreloadCount;
    })()`, 40_000);
    if (fetched !== size) throw new Error(`Prepared ${fetched} messages, expected ${size}`);
    await this.frames(6);
    const retained = await this.messageCount();
    if (!followTail && retained !== size) throw new Error(`Reader kept ${retained} messages, expected ${size}`);
    return retained;
  }

  messageCount(): Promise<number> {
    return this.page.evaluate<number>(`${store}.openThread.messages.length`);
  }

  thread(id: string, label = 'setup/thread'): Promise<ClickSample> {
    return this.click(row(id), threadReady(id), label);
  }

  async metrics(): Promise<Record<string, number>> {
    const { metrics } = await this.page.send('Performance.getMetrics', {}) as { metrics: Array<{ name: string; value: number }> };
    return Object.fromEntries(metrics.map(metric => [metric.name, metric.value]));
  }

  async heap(): Promise<{ bytes: number; nodes: number; listeners: number }> {
    await this.page.send('HeapProfiler.collectGarbage', {});
    const heap = await this.page.send('Runtime.getHeapUsage', {}) as { usedSize: number };
    const { nodes, jsEventListeners } = await this.page.send('Memory.getDOMCounters', {}) as { nodes: number; jsEventListeners: number };
    return { bytes: heap.usedSize, nodes, listeners: jsEventListeners };
  }
}

function typing(size: number, load: number): Cases[string] {
  return async bench => {
    const page = bench.page;
    const label = `typing/${size}/${load}`;
    await bench.open(size, `typing=1&working=${load}`);
    await bench.thread(HISTORY);
    const loaded = await bench.prepareHistory(size);
    const counts = await page.evaluate<{ running: number; idle: number }>(`({
      running: ${store}.threads.filter(t => t.id.startsWith('t-working-') && t.status === 'running').length,
      idle: ${store}.threads.filter(t => t.id.startsWith('t-idle-')).length,
    })`);
    if (counts.running !== load || counts.idle !== POOL_SIZE - load) throw new Error('Unexpected background thread counts: ' + JSON.stringify(counts));
    await page.evaluate(`${composer}.focus(); ${probe}.inputMs.length = 0;`);
    return bench.measure(label, async () => {
      const before = await bench.metrics();
      await page.evaluate(`performance.mark(${JSON.stringify(label + '/begin')})`);
      for (const key of KEYS) {
        const code = key === ' ' ? 'Space' : `Key${key.toUpperCase()}`;
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text: key, unmodifiedText: key });
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
        await Bun.sleep(40);
      }
      await bench.frames(2);
      const after = await bench.metrics();
      const { value, inputMs } = await page.evaluate<{ value: string; inputMs: number[] }>(`({ value: ${composer}.value, inputMs: ${probe}.inputMs })`);
      if (value !== KEYS || inputMs.length !== KEYS.length) throw new Error('Did not observe all composer inputs');
      await page.evaluate(`performance.mark(${JSON.stringify(label + '/end')})`);
      return { ...counts, loaded, input: percentiles(inputMs), inputMs, layoutCount: after.LayoutCount! - before.LayoutCount!, mainCpuMs: 1000 * (after.ThreadTime! - before.ThreadTime!) };
    });
  };
}

function switchThread(size: number): Cases[string] {
  return async bench => {
    await bench.open(size);
    await bench.thread(SHORT);
    const cold = await bench.measure(`switch/${size}/cold`, () => bench.thread(HISTORY, 'thread/cold'));
    const coldEntries = await bench.messageCount();
    const awayEntries = await bench.prepareHistory(size);
    const away = await bench.measure(`switch/${size}/leave`, () => bench.thread(SHORT, 'thread/leave'));
    const warm = await bench.measure(`switch/${size}/warm`, () => bench.thread(HISTORY, 'thread/warm'));
    const warmEntries = await bench.messageCount();
    return { cold, coldEntries, away, awayEntries, warm, warmEntries };
  };
}

function switchTabs(size: number, mochi: boolean): Cases[string] {
  return async bench => {
    await bench.open(size, mochi ? 'mochi=1' : '');
    if (mochi) await bench.click(mochiRail, mochiReady, 'setup/mochi');
    else await bench.thread(HISTORY);
    const loadedBeforeTab = await bench.prepareHistory(size);
    const activity = await bench.measure(`tabs/${mochi ? 'mochi-' : ''}${size}/activity`, () =>
      bench.click(testId('nav-activity'), query(testId('activity-list')), 'rail/activity'));
    const threads = await bench.measure(`tabs/${mochi ? 'mochi-' : ''}${size}/threads`, () =>
      bench.click(testId('view-threads'), `${query(testId('view-threads') + '[aria-current=page]')} && ${query(row(HISTORY))} ? ${chat} : null`, 'rail/threads'));
    return { loadedBeforeTab, activity, threads };
  };
}

function switchMochi(size: number): Cases[string] {
  return async bench => {
    await bench.open(size, 'mochi=1');
    await bench.thread(SHORT);
    const cold = await bench.measure(`mochi/${size}/cold`, () => bench.click(mochiRail, mochiReady, 'mochi/cold'));
    const coldEntries = await bench.messageCount();
    const preparedEntries = await bench.prepareHistory(size);
    await bench.click(testId('view-threads'), query(testId('view-threads') + '[aria-current=page]'), 'setup/threads');
    await bench.thread(SHORT);
    const warm = await bench.measure(`mochi/${size}/warm`, () => bench.click(mochiRail, mochiReady, 'mochi/warm'));
    const warmEntries = await bench.messageCount();
    return { cold, coldEntries, preparedEntries, warm, warmEntries };
  };
}

async function settings(bench: Bench): Promise<Record<string, unknown>> {
  await bench.open(1000);
  await bench.thread(HISTORY);
  await bench.prepareHistory(1000);
  return bench.measure('settings', async () => {
    const click = await bench.click(testId('nav-settings'), `${query(testId('settings-home-page'))} ? ${query(testId('settings'))} : null`, 'settings/home');
    return { home: click };
  });
}

const panelContents = {
  changes: testId('changes-panel'),
  files: `${testId('files-row')}, ${testId('files-empty')}`,
  'agent-browser': testId('agent-browser-surface'),
  device: testId('device-surface'),
  agents: testId('delegation-surface'),
  messages: testId('agent-messages-surface'),
  tasks: testId('tasks-panel'),
  trace: `${testId('trace-table')}, ${testId('trace-empty')}`,
  desk: testId('desk-ident'),
  file: `${testId('file-panel')}[data-kind=text]`,
  window: testId('window-empty'),
  browser: 'iframe[data-browser-id][style*="display: block"]',
  council: testId('council-post'),
  plugin: `${testId('plugin-tab')} .hello-recent li`,
} as const;

const launcherPanels = ['agents', 'messages', 'agent-browser', 'device', 'changes', 'files', 'tasks', 'trace'] as const;
const panelReady = (kind: keyof typeof panelContents) =>
  `${selectedPanel(kind)} && ${query(panelContents[kind])} ? ${query(testId('right-panel'))} : null`;

async function panels(bench: Bench): Promise<Record<string, unknown>> {
  const page = bench.page;
  await bench.open(100, 'mochi=1');
  await page.evaluate(`${store}.open('${SHORT}')`);
  await page.waitFor(threadReady(SHORT));
  await page.click(testId('panel-toggle'));
  const open: Record<string, ClickSample> = {};
  const activate: Record<string, ClickSample> = {};
  for (const kind of launcherPanels) {
    const menu = testId('panel-add-menu');
    await page.click(`${testId('right-panel')} ${testId('panel-add')}`);
    const option = `${menu}:not(.closing) [data-value="${kind}"]`;
    open[kind] = await bench.measure(`panels/${kind}/open`, () => bench.click(option, panelReady(kind), `panel/open/${kind}`));
    await page.waitFor(`!${query(menu)}`);
  }
  // A document and a native-window viewer need a panel request before they
  // have a tab. The fake owns both, so this setup opens no OS window.
  await page.evaluate(`${store}.panel.openFile('src/lib/store.svelte.ts'); ${store}.panel.open('window')`);
  for (const kind of [...launcherPanels, 'file', 'window'] as const) {
    activate[kind] = await bench.measure(`panels/${kind}/activate`, () => bench.click(panelTab(kind), panelReady(kind), `panel/activate/${kind}`));
  }
  await bench.click(mochiRail, mochiReady, 'setup/mochi');
  await page.evaluate(`${store}.panel.open('desk'); ${store}.panel.open('trace');`);
  activate.desk = await bench.measure('panels/desk/activate', () => bench.click(panelTab('desk'), panelReady('desk'), 'panel/activate/desk'));
  return { open, activate };
}

async function extraPanels(bench: Bench): Promise<Record<string, unknown>> {
  const page = bench.page;
  await bench.open(100, 'council=1');
  await page.evaluate(`${store}.open('${SHORT}')`);
  await page.waitFor(threadReady(SHORT));
  await page.evaluate(`${store}.panel.open('browser')`);
  await page.waitFor(panelReady('browser'));
  await page.evaluate(`${store}.panel.open('trace')`);
  await page.waitFor(panelReady('trace'));
  await page.settleAnimations();
  const browser = await bench.measure('panels/browser/activate', () => bench.click(panelTab('browser'), panelReady('browser'), 'panel/activate/browser'));

  // The example UI and its source are served by the fake client itself.
  await page.evaluate(`(async () => {
    const client = ${store}.client;
    const preview = await client.call('plugins.inspect', { url: 'https://github.com/example/hello' });
    await client.call('plugins.add', { previewId: preview.previewId });
  })()`);
  const example = `${testId('plugin-button')}[data-plugin="hello"][data-slot="thread-header"]`;
  const pluginOpen = await bench.measure('panels/plugin/open', () => bench.click(example, panelReady('plugin'), 'panel/open/plugin'));
  await bench.click(panelTab('trace'), panelReady('trace'), 'setup/trace');
  const plugin = await bench.measure('panels/plugin/activate', () => bench.click(panelTab('plugin'), panelReady('plugin'), 'panel/activate/plugin'));

  await page.evaluate(`${store}.open('t-council')`);
  await page.waitFor(threadReady('t-council'));
  await page.settleAnimations();
  const councilCard = `${testId('council-card')}[data-council-id="cnl_demo_done"] ${testId('council-card-open')}`;
  const councilOpen = await bench.measure('panels/council/open', () => bench.click(councilCard, panelReady('council'), 'panel/open/council'));
  await page.evaluate(`${store}.panel.open('trace')`);
  const council = await bench.measure('panels/council/activate', () => bench.click(panelTab('council'), panelReady('council'), 'panel/activate/council'));
  return { open: { council: councilOpen, plugin: pluginOpen }, activate: { browser, council, plugin } };
}

function stream(kind: 'idle' | 'only' | 'scroll-idle' | 'scroll'): Cases[string] {
  const streaming = kind === 'only' || kind === 'scroll';
  const scrolling = kind === 'scroll-idle' || kind === 'scroll';
  return async bench => {
    const page = bench.page;
    await bench.open(5000, 'stream=tokens');
    await bench.thread(HISTORY);
    const beforeStream = await bench.prepareHistory(5000, true);
    if (streaming) {
      await page.evaluate(`${composer}.focus()`);
      await page.send('Input.insertText', { text: PROMPT });
      await page.click(testId('composer-send'));
      await page.waitFor(`document.querySelectorAll('.prose.live .paragraph').length >= 2`, 15_000);
    }
    return bench.measure(`stream/${kind}`, async () => {
      const before = await bench.metrics();
      await page.evaluate(`(() => {
        const stats = { deltas: 0, scrolls: 0 };
        const off = ${store}.client.on('message.delta', event => { if (event.threadId === '${HISTORY}') stats.deltas++; });
        const view = ${timeline};
        const scroll = () => stats.scrolls++;
        view.addEventListener('scroll', scroll);
        globalThis.__streamStats = () => { off(); view.removeEventListener('scroll', scroll); return stats; };
        globalThis.__streamFrames = ${probe}.frames(3600, 'frames/${kind}');
      })()`);
      if (scrolling) {
        const point = await bench.pointer(testId('timeline'));
        await page.send('Input.synthesizeScrollGesture', { ...point, yDistance: 5600, speed: 2400, gestureSourceType: 'mouse' }, 12_000);
      }
      const frame = await page.evaluate<FrameSample>('globalThis.__streamFrames', 12_000);
      const changes = await page.evaluate<{ deltas: number; scrolls: number }>('globalThis.__streamStats()');
      const after = await bench.metrics();
      if (streaming && changes.deltas < 10) throw new Error('Too few deltas reached the open thread: ' + changes.deltas);
      if (scrolling && changes.scrolls < 5) throw new Error('Scroll did not move the timeline');
      const elapsed = frame.gaps.reduce((sum, value) => sum + value, 0);
      return {
        ...changes, beforeStream, afterStream: await bench.messageCount(), elapsed, frameGaps: percentiles(frame.gaps), fps: 1000 * frame.gaps.length / elapsed,
        droppedFrames60Hz: Math.max(0, Math.round(elapsed * 60 / 1000) - frame.gaps.length),
        longTasks: frame.longTasks, longFrames: frame.longFrames, support: await page.evaluate(`${probe}.supported`),
        mainCpuMs: 1000 * (after.ThreadTime! - before.ThreadTime!),
        layouts: after.LayoutCount! - before.LayoutCount!,
        styleRecalculations: after.RecalcStyleCount! - before.RecalcStyleCount!,
      };
    });
  };
}

async function heap(bench: Bench): Promise<Record<string, unknown>> {
  await bench.open(5000);
  await bench.thread(SHORT);
  await bench.thread(HISTORY);
  const loaded = await bench.prepareHistory(5000, true);
  await bench.thread(SHORT);
  await bench.frames(6);
  const before = await bench.heap();
  return bench.measure('heap', async () => {
    for (let i = 0; i < 50; i++) await bench.thread(i % 2 === 0 ? HISTORY : SHORT, 'heap/switch');
    await bench.frames(6);
    await bench.page.evaluate(`for (const mark of ['click', 'first-paint', 'stable']) performance.clearMarks('heap/switch/' + mark)`);
    const after = await bench.heap();
    return { switches: 50, loaded, before, after, deltaBytes: after.bytes - before.bytes };
  });
}

const cases: Cases = {
  ...Object.fromEntries(SIZES.flatMap(size => [0, 8, POOL_SIZE].map(load => [`typing/${size}/${load}`, typing(size, load)]))),
  ...Object.fromEntries(SIZES.map(size => [`switch/${size}`, switchThread(size)])),
  ...Object.fromEntries(SIZES.map(size => [`tabs/${size}`, switchTabs(size, false)])),
  'mochi/100': switchMochi(100),
  'mochi/5000': switchMochi(5000),
  'tabs/mochi-5000': switchTabs(5000, true),
  settings, panels,
  'panels/special': extraPanels,
  'stream/idle': stream('idle'),
  'stream/only': stream('only'),
  'stream/scroll-idle': stream('scroll-idle'),
  'stream/scroll': stream('scroll'),
  heap,
};

export async function runLatency(options: Options): Promise<void> {
  const filters = options.only?.split(',').map(name => name.trim());
  const selected = Object.entries(cases).filter(([name]) => !filters || filters.some(filter => name === filter || name.startsWith(filter + '/')));
  if (!selected.length) throw new Error('No matching case. Available: ' + Object.keys(cases).join(', '));
  const started = new Date().toISOString();
  const loadBefore = await loadAverage();
  const scratch = options.bundle ? undefined : mkdtempSync(join(tmpdir(), 'boite-ui-latency-'));
  const bundle = resolve(options.bundle ?? scratch!);
  let page: BrowserPage | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    if (scratch) {
      const build = Bun.spawn([process.execPath, join(import.meta.dir, '../ui-latency.ts'), '--build', bundle], { stdout: 'inherit', stderr: 'inherit' });
      if (await build.exited !== 0) throw new Error('Fixture build failed');
    }
    if (!await Bun.file(join(bundle, 'index.html')).exists()) throw new Error('No UI fixture at ' + bundle);
    if (options.trace) mkdirSync(options.trace, { recursive: true });
    server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      const path = new URL(request.url).pathname;
      const file = Bun.file(join(bundle, path === '/' ? 'index.html' : path));
      return await file.exists() ? new Response(file) : new Response('Not found', { status: 404 });
    } });
    const origin = server.url.origin;
    async function launch(): Promise<BrowserPage> {
      page = await BrowserPage.launch({
        url: origin + '/blank', windowSize: VIEWPORT, locale: 'en',
        executable: options.browser ?? process.env.BOITE_E2E_BROWSER ?? Bun.which('chrome-headless-shell') ?? undefined,
        experiments: ['resident-agents', 'debates'],
        args: ['--disable-gpu', '--disable-software-rasterizer', '--disable-3d-apis'],
      });
      await page.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
      await page.send('Performance.enable', { timeDomain: 'timeTicks' });
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installProbe.toString()})()` });
      // Keep the network cache cold for first opens of lazy UI chunks.
      await page.send('Network.setCacheDisabled', { cacheDisabled: true });
      return page;
    }
    let browser: unknown;
    const samples: Array<Record<string, unknown>> = [];
    const errors: Array<{ name: string; run: number; error: string; pageErrors: string[] }> = [];
    for (let run = 1; run <= options.runs; run++) {
      const traceDir = options.trace ? join(options.trace, `run-${run}`) : undefined;
      if (traceDir) mkdirSync(traceDir, { recursive: true });
      for (const [name, measure] of selected) {
        const before = await loadAverage();
        try {
          const current = page ?? await launch();
          browser ??= await current.send('Browser.getVersion', {});
          const bench = new Bench(current, origin, traceDir);
          const data = await measure(bench);
          samples.push({ name, run, loadBefore: before, loadAfter: await loadAverage(), ...data });
          console.error(`[${run}/${options.runs}] ${name} recorded`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push({ name, run, error: message, pageErrors: page?.errors() ?? [] });
          console.error(`[${run}/${options.runs}] ${name}: ${message}`);
          // A hung renderer must not also fail the rest of the matrix.
          await page?.close();
          page = undefined;
        }
      }
    }
    console.log(JSON.stringify({ started, finished: new Date().toISOString(), loadBefore, loadAfter: await loadAverage(), viewport: VIEWPORT, browser, runs: options.runs, samples, errors }, null, 2));
    if (errors.length) process.exitCode = 1;
  } finally {
    try { await page?.close(); }
    finally {
      server?.stop(true);
      if (scratch) rmSync(scratch, { recursive: true, force: true });
    }
  }
}
