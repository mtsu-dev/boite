import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startUi } from './lib/ui.ts';

let server: { close(): Promise<void> };
let url: string;
const store = 'globalThis.__boiteTest.workspace.active';
const turnId = 'turn-seed-4';
const row = `article[data-turn="${turnId}"]`;
const summary = `${row} [data-testid="turn-summary"][data-status="done"]`;
const footer = 'article[data-turn="follow-up"] [data-testid="turn-summary"][data-status="done"]';
const stamp = `${row}.user [data-testid="message-time"]`;
const ticks = `${row}.user [data-testid="message-receipts"].settled [data-testid="receipt-responded"]`;
const opacity = (selector: string) => `getComputedStyle(document.querySelector('${selector}')).opacity`;

beforeAll(async () => {
  const port = await freePort();
  server = await startUi(port);
  url = `http://127.0.0.1:${port}/?fake=1&open=recent&contactNotice=0`;
}, 60_000);
afterAll(async () => { await server?.close(); }, 30_000);

/** Points the mouse inside the message that owns the selected element. */
async function hover(page: BrowserPage, selector: string): Promise<void> {
  const at = await page.evaluate<{ x: number; y: number }>(`(() => {
    const message = document.querySelector('${selector}').closest('.message');
    message.scrollIntoView({ block: 'nearest' });
    const r = message.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 20) };
  })()`);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
}

for (const [name, width, height, touch] of [['desktop', 1280, 900, false], ['phone', 390, 844, true]] as const) {
  test(`a finished turn's summary and a prompt's time and ticks wait for the pointer on ${name}`, async () => {
    // Headless Chrome reports no hover and no pointer: give each layout the input it stands for.
    const input = touch ? 'primaryHoverType=1,availableHoverTypes=1,primaryPointerType=2,availablePointerTypes=2' : 'primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4';
    const page = await BrowserPage.launch({ url, windowSize: { width, height }, args: [`--blink-settings=${input}`] });
    const capture = (state: string) => page.screenshot(join(import.meta.dir, '.artifacts', `message-meta-${state}-${name}.png`));
    try {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch });
      expect(await page.evaluate<boolean>(`matchMedia('(hover: hover)').matches`)).toBe(!touch);
      await page.waitFor(`${store}?.connection === 'ready'`);
      await page.waitFor(`document.querySelector('${summary}') && document.querySelector('${stamp}') && document.querySelector('${ticks}')`);
      if (!touch) {
        // A newer answer owns the resting footer. The seeded turn still waits for hover.
        await page.evaluate(`(() => {
          const thread = ${store}.openThread, turn = thread.turns.find(t => t.id === '${turnId}');
          const at = turn.finishedAt + 1000;
          thread.turns.push({ ...turn, id: 'follow-up', queuedAt: at, startedAt: at, finishedAt: at + 1000 });
          thread.messages.push(
            { id: 'follow-up-prompt', threadId: thread.id, turnId: 'follow-up', role: 'user', state: 'complete', createdAt: at,
              parts: [{ type: 'text', text: 'Can we check that too?' }] },
            { id: 'follow-up-answer', threadId: thread.id, turnId: 'follow-up', role: 'assistant', state: 'complete', createdAt: at + 1000,
              parts: [{ type: 'text', text: 'Yes, the checks passed.' }] },
          );
        })()`);
        await page.waitFor(`document.querySelector('${footer}')`);
      }
      // Away from every message.
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: height - 1 });
      await page.settleAnimations();
      await capture('rest');
      const shown = touch ? '1' : '0';
      expect(await page.evaluate<string>(opacity(summary))).toBe(shown);
      if (!touch) expect(await page.evaluate<string>(opacity(footer))).toBe('1');
      expect(await page.evaluate<string>(opacity(stamp))).toBe(shown);
      // A finger has no pointer to bring settled ticks up: they are not drawn at all, so nothing waits for a hover that never comes.
      if (touch) expect(await page.evaluate<string>(`getComputedStyle(document.querySelector('${ticks}')).display`)).toBe('none');
      else expect(await page.evaluate<string>(opacity(ticks))).toBe(shown);
      if (touch) return;
      await hover(page, summary);
      await page.settleAnimations();
      await capture('hover-answer');
      expect(await page.evaluate<string>(opacity(summary))).toBe('1');
      await hover(page, stamp);
      await page.settleAnimations();
      await capture('hover-prompt');
      expect(await page.evaluate<string>(opacity(stamp))).toBe('1');
      expect(await page.evaluate<string>(opacity(ticks))).toBe('1');
      // A prompt shows its own time, not the summary its turn closes on.
      expect(await page.evaluate<string>(opacity(summary))).toBe('0');
      // A Claude turn is many messages: pointing at an earlier one shows the summary the last one closes on.
      await page.evaluate(`(() => {
        const thread = ${store}.openThread, at = thread.messages.findLastIndex(message => message.turnId === '${turnId}' && message.role === 'assistant'), last = thread.messages[at];
        thread.messages.splice(at, 1, { ...last, id: last.id + '-a', parts: last.parts.slice(0, 1) }, { ...last, id: last.id + '-b', parts: last.parts.slice(1), createdAt: last.createdAt + 1 });
      })()`);
      const earlier = `${row}.assistant:not(:has([data-testid="turn-summary"])) [data-kind="text"]`;
      await page.waitFor(`document.querySelector('${earlier}') && document.querySelector('${summary}')`);
      await hover(page, earlier);
      await page.settleAnimations();
      await capture('hover-earlier-answer');
      expect(await page.evaluate<string>(opacity(summary))).toBe('1');
      expect(await page.evaluate<string>(opacity(`${summary} [data-testid="message-copy"]`))).toBe('1');
    } finally {
      await page.close();
    }
  }, 60_000);
}
