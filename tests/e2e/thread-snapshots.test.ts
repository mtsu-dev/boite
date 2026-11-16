import { afterAll, beforeAll, expect, test } from 'bun:test';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startUi } from './lib/ui.ts';

// A machine 200 ms away. A thread opened before a full page reload opens
// again from the device's snapshot of it (lib/thread-snapshots.ts) and catches
// up behind it, instead of waiting a round trip for its first page.
// `&coreid=` keeps the fake core's id across reloads, as a real machine's is.
const RTT_MS = 200;
const SAMPLES = 4;
const THREAD = 't-descriptors';
// Long enough for the snapshot's write delay and an idle moment.
const SETTLE_MS = 2_500;

let server: { close(): Promise<void> };
let page: BrowserPage;
let url: string;

beforeAll(async () => {
  const port = await freePort();
  server = await startUi(port);
  url = `http://127.0.0.1:${port}/?fake=1&rtt=${RTT_MS}&coreid=snapshot-bench`;
  page = await BrowserPage.launch({ url, windowSize: { width: 1280, height: 900 } });
}, 90_000);

afterAll(async () => { await page?.close(); await server?.close(); }, 30_000);

/** A fresh page, ready and idle, its landing draft on screen. */
async function load(): Promise<void> {
  await page.navigate(url);
  await page.waitFor('document.querySelector("[data-testid=thread-row]") && globalThis.__boiteTest?.workspace.active.connection === "ready" && globalThis.__boiteTest.workspace.active.loadingThreadId === null', 30_000);
  await Bun.sleep(500);
}

/** Opens THREAD and times the call to its first message drawn; and whether the loading view showed. */
async function open(): Promise<{ ms: number; loaded: boolean }> {
  await page.evaluate(`(() => {
    window.__shownAt = null;
    window.__loaded = false;
    const store = globalThis.__boiteTest.workspace.active;
    const look = () => {
      if (store.loadingThreadId === '${THREAD}') window.__loaded = true;
      if (store.openThread?.id === '${THREAD}' && document.querySelector('[data-testid=timeline] [data-testid=message]')) window.__shownAt = performance.now();
      else requestAnimationFrame(look);
    };
    window.__openAt = performance.now();
    void globalThis.__boiteTest.workspace.select(store, '${THREAD}');
    requestAnimationFrame(look);
  })()`);
  await page.waitFor('window.__shownAt !== null', 10_000);
  const [ms, loaded] = await page.evaluate<[number, boolean]>('[window.__shownAt - window.__openAt, window.__loaded]');
  return { ms, loaded };
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

test('a thread opened before a full reload draws its rows without waiting for the machine', async () => {
  const samples: number[] = [];
  const loaded: boolean[] = [];
  for (let index = 0; index < SAMPLES; index++) {
    await load();
    // Opened once, then left to settle: its snapshot is written.
    await open();
    await Bun.sleep(SETTLE_MS);
    await load();
    const sample = await open();
    console.log(`${THREAD} after reload: ${sample.ms.toFixed(0)} ms${sample.loaded ? ', loading view seen' : ''}`);
    samples.push(sample.ms);
    loaded.push(sample.loaded);
  }
  console.log(`thread-snapshots rtt=${RTT_MS}ms: open after a full reload, call to first message drawn, median ${median(samples).toFixed(0)} ms [${samples.map(v => v.toFixed(0)).join(', ')}]`);
  expect(loaded).toEqual(loaded.map(() => false));
  expect(median(samples)).toBeLessThan(RTT_MS);
}, 180_000);
