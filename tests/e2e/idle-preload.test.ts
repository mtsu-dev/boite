import { afterAll, beforeAll, expect, test } from 'bun:test';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startUi } from './lib/ui.ts';

// A remote machine 200 ms away. Once the page is idle, the machine's first
// sidebar threads are read ahead (`IdlePreloads` in lib/store/thread-preload.ts):
// a click on one of them draws its rows from memory instead of waiting a round
// trip for its page.
const RTT_MS = 200;
const SAMPLES = 4;
// Long enough for the idle callback and four reads one after the other at this round trip.
const SETTLE_MS = 3_000;

let server: { close(): Promise<void> };
let page: BrowserPage;
let url: string;

beforeAll(async () => {
  const port = await freePort();
  server = await startUi(port);
  url = `http://127.0.0.1:${port}/?fake=1&open=recent&rtt=${RTT_MS}`;
  page = await BrowserPage.launch({ url, windowSize: { width: 1280, height: 900 } });
  // Off under automation like the press; this test opts in before the store starts.
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__BOITE_IDLE_PRELOAD_TEST__ = true' });
}, 90_000);

afterAll(async () => { await page?.close(); await server?.close(); }, 30_000);

/** A fresh page, left idle; answers the first thread in the sidebar's order, pins first, the open one left out. */
async function load(): Promise<string> {
  await page.navigate(url);
  await page.waitFor('document.querySelector("[data-testid=thread-row]") && globalThis.__boiteTest?.workspace.active.loadingThreadId === null', 30_000);
  await page.settleAnimations();
  await Bun.sleep(SETTLE_MS);
  return page.evaluate<string>(`(() => {
    const store = globalThis.__boiteTest.workspace.active;
    const last = thread => thread.lastUserMessageAt ?? thread.createdAt;
    const drawn = [...document.querySelectorAll('[data-testid=thread-row]')].map(row => store.threads.find(thread => thread.id === row.dataset.threadId)).filter(Boolean);
    return drawn.filter(thread => thread.id !== store.openThread?.id).sort((a, b) => Number(b.pinned) - Number(a.pinned) || last(b) - last(a))[0].id;
  })()`);
}

/** Click the row and time the release to the first message drawn in the timeline; and whether the loading view showed. */
async function openByClick(threadId: string): Promise<{ ms: number; loaded: boolean }> {
  await page.evaluate(`document.querySelector('[data-testid=thread-row][data-thread-id="${threadId}"]').scrollIntoView({ block: 'center' })`);
  const { x, y } = await page.evaluate<{ x: number; y: number }>(`(() => {
    const box = document.querySelector('[data-testid=thread-row][data-thread-id="${threadId}"]').getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  })()`);
  await page.evaluate(`(() => {
    window.__shownAt = null;
    window.__loaded = false;
    addEventListener('pointerup', () => { window.__upAt = performance.now(); }, { capture: true, once: true });
    const look = () => {
      const store = globalThis.__boiteTest.workspace.active;
      if (store.loadingThreadId === '${threadId}') window.__loaded = true;
      if (store.openThread?.id === '${threadId}' && document.querySelector('[data-testid=timeline] [data-testid=message]')) window.__shownAt = performance.now();
      else requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  })()`);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await page.waitFor('window.__shownAt !== null', 10_000);
  const [ms, loaded] = await page.evaluate<[number, boolean]>('[window.__shownAt - window.__upAt, window.__loaded]');
  console.log(`${threadId}: ${ms.toFixed(0)} ms${loaded ? ', loading view seen' : ''}`);
  return { ms, loaded };
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

test('a thread read ahead while the page was idle draws its rows without waiting for the machine', async () => {
  const samples: number[] = [];
  const loaded: boolean[] = [];
  for (let index = 0; index < SAMPLES; index++) {
    const sample = await openByClick(await load());
    samples.push(sample.ms);
    loaded.push(sample.loaded);
  }
  console.log(`idle-preload rtt=${RTT_MS}ms settle=${SETTLE_MS}ms: first sidebar thread, release to first message drawn, median ${median(samples).toFixed(0)} ms [${samples.map(v => v.toFixed(0)).join(', ')}]`);
  // Held, the thread never shows its loading view, and its rows come well inside one round trip.
  expect(loaded).toEqual(loaded.map(() => false));
  expect(median(samples)).toBeLessThan(RTT_MS);
}, 120_000);
