import { afterAll, beforeAll, expect, test } from 'bun:test';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startUi } from './lib/ui.ts';

/** A desktop pointer: headless Chromium matches `(hover: hover)` only with these settings. */
const POINTER = '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4';
const STORE = 'globalThis.__boiteTest.workspace.active';
const FOOTER = '[data-testid=turn-summary].resting';

let server: { close(): Promise<void> };
let port: number;
beforeAll(async () => { port = await freePort(); server = await startUi(port); }, 60_000);
afterAll(async () => { await server?.close(); }, 30_000);

/** Where each mark of the footer is drawn, and how visible its time, finish, tokens and first button are. */
const READ = `(() => {
  const footer = document.querySelector('${FOOTER}');
  const shown = (el) => el ? Number(getComputedStyle(el).opacity) : -1;
  return {
    turn: footer.closest('article').dataset.turn,
    marks: [...footer.querySelectorAll('[data-testid]')].map(el => { const r = el.getBoundingClientRect(); return [el.dataset.testid, Math.round(r.left), Math.round(r.top)]; }),
    elapsed: shown(footer.querySelector('[data-testid=turn-elapsed]')),
    finished: shown(footer.querySelector('[data-testid=turn-finished-at]')?.closest('.metric')),
    tokens: shown(footer.querySelector('[data-testid=turn-tokens]')?.closest('.metric')),
    button: shown(footer.querySelector('.act')),
  };
})()`;

// The thread ended on two lines saying the same time; then its one line moved its marks when a pointer or a focus came.
test('a finished thread ends on one footer that keeps its time at rest and reveals the rest in place on hover and on focus', async () => {
  const page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&open=recent&machines=1&contactNotice=0`, windowSize: { width: 1280, height: 800 }, args: [POINTER] });
  try {
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.waitFor(`${STORE}.threads?.some?.(t => t.id === 't-trace')`, 30_000);
    await page.evaluate(`${STORE}.open('t-trace')`);
    await page.waitFor(`${STORE}.openThread?.id === 't-trace' && document.querySelector('[data-testid=composer-input]')`);
    await page.evaluate(`(async () => {
      const input = document.querySelector('[data-testid=composer-input]');
      input.value = 'one more look'; input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      document.querySelector('[data-testid=composer-send]').click();
    })()`);
    await page.waitFor(`${STORE}.openThread?.turns.at(-1)?.status === 'done' && document.querySelector('${FOOTER}')`, 30_000);
    const answered = await page.evaluate<string>(`${STORE}.openThread.turns.at(-1).id`);
    // An automatic compaction after it folds onto its line as a mark: the line stays the footer, a marked one.
    await page.evaluate(`(() => {
      const thread = ${STORE}.openThread, last = thread.turns.at(-1);
      thread.turns.push({ ...last, id: 'turn-auto-compact', queuedAt: last.queuedAt + 1, startedAt: last.finishedAt + 1, finishedAt: last.finishedAt + 2, usage: null,
        execution: { ...(last.execution ?? {}), operation: 'compact', automatic: true } });
      thread.messages.push({ id: 'm-auto-compact', threadId: thread.id, turnId: 'turn-auto-compact', role: 'assistant', state: 'complete', createdAt: Date.now(),
        parts: [{ type: 'compaction', trigger: 'auto', preTokens: 180000, postTokens: 20000 }] });
    })()`);
    await page.waitFor(`document.querySelector('${FOOTER} [data-testid=turn-compaction]')`);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 790 });
    await page.evaluate(`(() => { const t = document.querySelector('[data-testid=timeline]'); t.scrollTop = t.scrollHeight; })()`);
    await page.waitFor(`(${READ}).tokens === 0`);
    const rest = await page.evaluate<Record<string, unknown>>(READ);
    expect(rest).toMatchObject({ turn: answered, elapsed: 1, finished: 0, tokens: 0, button: 0 });
    expect(await page.evaluate<number>(`document.querySelectorAll('[data-testid=turn-summary].resting').length`)).toBe(1);

    const answer = await page.evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector('${FOOTER}').closest('article').getBoundingClientRect(); return { x: r.left + 200, y: r.top + 12 }; })()`);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...answer });
    await page.waitFor(`(${READ}).tokens === 1`);
    const hovered = await page.evaluate<Record<string, unknown>>(READ);
    expect(hovered).toMatchObject({ elapsed: 1, finished: 1, tokens: 1, button: 1 });
    expect(hovered.marks).toEqual(rest.marks);

    // The keyboard inside the answer, on a control that is not the footer's, shows the same line in the same place.
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 790 });
    await page.waitFor(`(${READ}).tokens === 0`);
    const focused = await page.evaluate<boolean>(`(() => {
      const article = document.querySelector('${FOOTER}').closest('article');
      const control = [...article.querySelectorAll('button, a[href]')].find(el => !el.closest('[data-testid=turn-summary]'));
      control?.focus();
      return !!control && document.activeElement === control;
    })()`);
    expect(focused).toBe(true);
    await page.waitFor(`(${READ}).tokens === 1`);
    const viaKeyboard = await page.evaluate<Record<string, unknown>>(READ);
    expect(viaKeyboard).toMatchObject({ finished: 1, tokens: 1, button: 1 });
    expect(viaKeyboard.marks).toEqual(rest.marks);

    // Clicking Copy in the resting footer and moving the pointer away returns finished time and tokens to rest.
    const copyBox = await page.evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector('${FOOTER} [data-testid=message-copy]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...copyBox });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...copyBox });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...copyBox });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 790 });
    await page.waitFor(`(${READ}).tokens === 0`);
    const afterCopyClick = await page.evaluate<Record<string, unknown>>(READ);
    expect(afterCopyClick).toMatchObject({ elapsed: 1, finished: 0, tokens: 0 });

    // Inline file changes on a resting turn with folded steps keep meta and actions on the summary row, before Show diff and above the opened file list, in matching DOM Tab order.
    await page.evaluate(`(() => {
      const thread = ${STORE}.openThread, last = thread.turns.at(-1), at = (last.finishedAt ?? Date.now()) + 1000;
      thread.turns.push({ ...last, id: 'turn-folded-edit', queuedAt: at, startedAt: at, finishedAt: at + 30_000, status: 'done',
        usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
        execution: { ...(last.execution ?? {}), operation: 'routine', opensRequest: true } });
      thread.messages.push(
        { id: 'm-fe-open', threadId: thread.id, turnId: 'turn-folded-edit', role: 'system', state: 'complete', createdAt: at, parts: [{ type: 'text', text: 'Routine edit' }] },
        { id: 'm-fe-ans', threadId: thread.id, turnId: 'turn-folded-edit', role: 'assistant', state: 'complete', createdAt: at + 1, parts: [
          { type: 'tool', toolId: 'tf-1', name: 'Edit', input: { file_path: 'src/a.ts', old_string: 'old', new_string: 'new' }, output: 'Updated src/a.ts', status: 'done' },
          { type: 'text', text: 'Updated the file.' },
        ] });
    })()`);
    await page.waitFor(`document.querySelector('${FOOTER} [data-testid=turn-files-toggle]')`);
    await page.evaluate(`document.querySelector('${FOOTER} [data-testid=turn-files-toggle]').click()`);
    await page.waitFor(`document.querySelector('${FOOTER} .tree')`);
    const inlineOrder = await page.evaluate<{ sameRow: boolean; leftToRight: boolean; treeBelow: boolean; domTabOrder: boolean }>(`(() => {
      const f = document.querySelector('${FOOTER}');
      const box = (sel) => f.querySelector(sel).getBoundingClientRect();
      const finished = box('[data-testid=turn-finished-at]');
      const tokens = box('[data-testid=turn-tokens]');
      const tail = box('.tail');
      const diff = box('[data-testid=turn-diff-toggle]');
      const tree = box('.tree');
      const copyEl = f.querySelector('[data-testid=message-copy]');
      const diffEl = f.querySelector('[data-testid=turn-diff-toggle]');
      const treeEl = f.querySelector('.tree');
      return {
        sameRow: Math.abs(finished.top - tokens.top) <= 6 && Math.abs(tokens.top - tail.top) <= 6 && Math.abs(tail.top - diff.top) <= 6,
        leftToRight: finished.left < tokens.left && tokens.left < tail.left && tail.left < diff.left,
        treeBelow: tree.top >= Math.max(finished.bottom, tokens.bottom, tail.bottom, diff.bottom) - 1,
        domTabOrder: Boolean(copyEl.compareDocumentPosition(diffEl) & Node.DOCUMENT_POSITION_FOLLOWING) && Boolean(diffEl.compareDocumentPosition(treeEl) & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    })()`);
    expect(inlineOrder).toEqual({ sameRow: true, leftToRight: true, treeBelow: true, domTabOrder: true });
    expect(page.errors()).toEqual([]);
  } finally { await page.close(); }
}, 60_000);
