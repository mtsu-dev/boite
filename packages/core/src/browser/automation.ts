/*
 * agent-browser's commands on one tab of the agent browser: refs from a
 * snapshot, native input at the element, the navigation an action starts and
 * the dialogs it raised. Page work runs in the page kit (page-kit.ts); this
 * module sends it and the native input over the tab's DevTools session.
 */
import type { BrowserAction, BrowserActionResult, BrowserDialog, BrowserReply } from '@boite/contracts';
import { kit } from './page-kit.ts';
import { snapshotDiff } from './snapshot-diff.ts';
import { CdpSessionDetachedError } from './cdp.ts';
import type { PageRuntime } from './page-runtime.ts';

/** A way into one document of a tab: the top one speaks on the tab's own session. */
export interface FrameChannel {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  /** A frame that shares its parent's renderer runs in a context of its own on the parent's session. */
  contextId?: number;
  /** The session a frame in another process speaks on; the tab's own otherwise. */
  session?: string;
}

/** How a tab reaches frames of other origins, whose documents the page's own script cannot read. */
export interface PageFrames {
  /** The way into the document frame `frameId` shows, from the document that embeds it; null when the browser offers none. */
  reach(parent: FrameChannel, frameId: string): Promise<FrameChannel | null>;
  /** Closes what `reach` opened for the command that ran. */
  release(): void;
  /** Whether the tab's page runs with DevTools' runtime on (`page-runtime.ts`). */
  readonly runtime?: PageRuntime;
}

/** One tab as the commands see it: its DevTools session and the dialogs answered for the agent. */
export interface AgentPage extends FrameChannel {
  /** Dialogs raised during the agent's commands, oldest first, at most 20. */
  dialogs: BrowserDialog[];
  dialogPolicy: { accept: boolean; text: string | null };
  /** Downloads this tab's frames began: a navigation that turned into one ends there. */
  downloads?: number;
  frames?: PageFrames;
  /** What the tab's snapshots left behind: where its refs live and what the last one read. */
  snapshots?: SnapshotState;
  /** The page's own calls (documents, fetch, XHR) still loading that began in the last 1.5 s (`page-events.ts`). */
  busy?: () => number;
  /** Where the last native pointer move left the mouse, in the top viewport. */
  pointer?: { x: number; y: number };
}

/**
 * Refs are stable and unique across a tab's documents. The page kit numbers
 * them in blocks of `REF_BLOCK` (`page-kit.ts`): the top document owns block 0
 * (`e1` to `e999`), and every other block is granted here, `next` first, to a
 * frame of another origin or to a document that filled its block. A block is
 * never granted twice in the tab's life, so a ref names one element of one
 * document: `routes` keeps, for each block a frame holds, the iframe refs that
 * lead to that frame from the top, and a ref whose block has no route is the
 * top document's.
 */
interface SnapshotState {
  next: number;
  routes: Map<number, string[]>;
  /**
   * The last snapshot of each set of options the agent was shown, newest
   * last, which the next one of the same document and options is compared
   * with: `SNAPSHOT_KEPT` of them, `SNAPSHOT_CHARS` and a few notes each.
   */
  last: Map<string, { token: string; lines: string[]; truncated: boolean }>;
}
const SNAPSHOT_KEPT = 4;
const REF_BLOCK = 1000;
/** Blocks whose route is kept: a page that swaps its frames for hours forgets the oldest. */
const ROUTES_MAX = 2000;

/** The kinds this module runs; the others belong to the browser itself. */
export const PAGE_ACTIONS = new Set<BrowserAction['kind']>(['snapshot', 'click', 'hover', 'focus', 'check', 'uncheck', 'scrollintoview', 'fill', 'type', 'select', 'press', 'scroll', 'get', 'wait', 'dialog', 'history']);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** A value as a JavaScript literal; the characters JSON leaves unescaped are escaped too. */
const js = (value: unknown) => (JSON.stringify(value) ?? 'undefined').replace(/[<>\/\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

const inContext = (channel: FrameChannel) => channel.contextId === undefined ? {} : { contextId: channel.contextId };

export async function evaluate(page: FrameChannel, expression: string, timeoutMs = 12_000): Promise<unknown> {
  const reply = await page.send<{ result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } }>(
    'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: timeoutMs, ...inContext(page) }, timeoutMs + 5000);
  if (reply.exceptionDetails) {
    // The page's own message, without the stack the agent cannot use.
    const details = reply.exceptionDetails;
    const message = details.exception?.description?.split('\n')[0]?.replace(/^Error: /, '') ?? details.text ?? 'page evaluation failed';
    throw new Error(message.slice(0, 2000));
  }
  return reply.result?.value ?? null;
}

/**
 * Runs `body` in the page with its kit bound to `K`. A document between
 * navigation commit and its first script context can hold an evaluation; the
 * agent hears sooner that the page is not ready.
 */
function run<T>(page: FrameChannel, body: string, timeoutMs = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`the page did not answer within ${timeoutMs / 1000} s; it may still be loading: wait --load domcontentloaded, then try again`)), timeoutMs); });
  return Promise.race([evaluate(page, kit(body), timeoutMs), late]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/** The frame an iframe of `channel`'s document shows, by its ref there. */
async function frameOf(channel: FrameChannel, ref: string): Promise<string | null> {
  const reply = await channel.send<{ result?: { objectId?: string }; exceptionDetails?: { exception?: { description?: string } } }>(
    'Runtime.evaluate', { expression: kit(`return K.find(${js(ref)})`), awaitPromise: true, ...inContext(channel) }, 5000);
  if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description?.split('\n')[0]?.replace(/^Error: /, '') ?? 'page evaluation failed');
  const objectId = reply.result?.objectId;
  if (!objectId) return null;
  try { return (await channel.send<{ node?: { frameId?: string } }>('DOM.describeNode', { objectId }, 5000)).node?.frameId ?? null; }
  finally { void channel.send('Runtime.releaseObject', { objectId }).catch(() => {}); }
}

/** The document of the frame iframe `ref` shows; null when the tab has no way into it. */
async function enter(page: AgentPage, channel: FrameChannel, ref: string): Promise<FrameChannel | null> {
  if (!page.frames) return null;
  const frameId = await frameOf(channel, ref);
  return frameId ? page.frames.reach(channel, frameId) : null;
}

/** A target's document, and the iframes of other origins that lead there from the top one. */
interface Scope { channel: FrameChannel; path: Array<{ parent: FrameChannel; owner: string }> }

/** Where `target` lives: a ref a snapshot read in a frame of another origin is reached through its iframes. */
async function scopeOf(page: AgentPage, target: string | undefined): Promise<Scope> {
  const scope: Scope = { channel: page, path: [] };
  const ref = target === undefined ? undefined : /^@?(e\d+)$/.exec(target.trim())?.[1];
  for (const owner of (ref && page.snapshots?.routes.get(Math.floor(Number(ref.slice(1)) / REF_BLOCK))) || []) {
    const child = await enter(page, scope.channel, `@${owner}`).catch(() => null);
    if (!child) throw new Error(`ref @${ref} is inside a frame that changed or is gone; take a new snapshot`);
    scope.path.push({ parent: scope.channel, owner: `@${owner}` });
    scope.channel = child;
  }
  return scope;
}

/** Frames of other origins one snapshot reads at most: each takes several round trips, and a page can embed hundreds of ads. */
const SNAPSHOT_FRAMES_MAX = 30;
/** What a snapshot holds at most, frames included; the page kit stops there too. */
const SNAPSHOT_CHARS = 40_000;

interface SnapshotPart { text: string; refs: number; truncated: boolean; blocks: unknown; frames?: Array<{ ref: string; at: number; depth: number }> }
interface Reading { left: number; max: number; frames: number; refs: number; truncated: boolean; state: SnapshotState; options: Record<string, unknown> }

/** The first lines that fit in `max` characters, and a line counting the rest. */
function shorten(lines: string[], max: number): string {
  let size = 0, kept = 0;
  while (kept < lines.length && size + lines[kept]!.length + 1 <= max) size += lines[kept++]!.length + 1;
  return [...lines.slice(0, kept), `(${lines.length - kept} more lines; snapshot -i prints them all)`].join('\n');
}

/**
 * A snapshot of the tab: the top document, then each frame of another origin
 * read in its own context and set under its iframe. A frame of the same origin
 * is already in its parent's. The same document read again with the same
 * options as the last one the agent was shown answers with what changed
 * (`snapshot-diff.ts`) when the caller asks for `view: 'diff'`, unless a
 * snapshot was cut short or the changes are more than half the text. Only a
 * snapshot with a `view` is remembered as the agent's: a script's own
 * snapshots never reach the agent, so a diff against them would hide lines it
 * never read.
 */
async function snapshot(page: AgentPage, action: Extract<BrowserAction, { kind: 'snapshot' }>): Promise<{ text: string; refs: number; url: string; title: string; diff?: true; unchanged?: true }> {
  const options = { interactive: action.interactive, compact: action.compact, depth: action.depth, urls: action.urls };
  const state = page.snapshots ??= { next: 1, routes: new Map(), last: new Map() };
  const max = SNAPSHOT_CHARS;
  const top = await run<SnapshotPart & { url: string; title: string; token: string }>(page, `return { ...K.snapshot(${js({ ...options, selector: action.selector, top: true, grant: state.next, maxChars: max, limit: max })}), url: location.href, title: document.title, token: K.token }`);
  // The top document's later blocks need no route: a ref without one is its own.
  for (const block of blocksOf(top)) if (block >= state.next) state.next = block + 1;
  const reading: Reading = { left: max - top.text.length, max, frames: 0, refs: top.refs, truncated: top.truncated === true, state, options };
  const lines = await withFrames(page, page, [], top, reading);
  const key = js({ ...options, selector: action.selector }), previous = state.last.get(key), full = lines.join('\n');
  const same = action.view === 'diff' && previous && previous.token === top.token && !previous.truncated && !reading.truncated;
  const diff = same ? snapshotDiff(previous.lines, lines) : null;
  const unchanged = !!same && lines.length === previous.lines.length && lines.every((line, at) => line === previous.lines[at]);
  // A diff longer than half the page is worse than the page, but "no change" is shorter than any page worth reading.
  const shown = diff !== null && (unchanged || diff.length * 2 <= full.length);
  // maxChars bounds what is printed, not what is read: the next diff still compares the whole page.
  const cut = !shown && action.maxChars !== undefined && full.length > action.maxChars ? shorten(lines, action.maxChars) : null;
  if (action.view !== undefined) {
    // A view cut here is one the agent did not read whole, so no diff is taken against it.
    state.last.delete(key); state.last.set(key, { token: top.token, lines, truncated: reading.truncated || cut !== null });
    for (const oldest of state.last.keys()) { if (state.last.size <= SNAPSHOT_KEPT) break; state.last.delete(oldest); }
  }
  return { text: shown ? diff : cut ?? full, refs: reading.refs, url: top.url, title: top.title, ...(shown ? { diff: true } : {}), ...(unchanged ? { unchanged: true } : {}) };
}

/** The blocks a document says it numbers its refs in; the page can write anything there. */
function blocksOf(part: SnapshotPart): number[] {
  return Array.isArray(part.blocks) ? part.blocks.filter((block): block is number => Number.isSafeInteger(block) && block >= 0 && block < 1e9) : [];
}

async function withFrames(page: AgentPage, channel: FrameChannel, route: string[], part: SnapshotPart, reading: Reading): Promise<string[]> {
  const lines = part.text ? part.text.split('\n') : [];
  const { state } = reading;
  let shift = 0;
  for (const frame of part.frames ?? []) {
    const indent = '  '.repeat(reading.options.interactive ? 0 : frame.depth);
    let inner: string[];
    if (reading.frames >= SNAPSHOT_FRAMES_MAX || reading.left <= 0) { reading.truncated = true; inner = [`${indent}- note: not read, the snapshot is full; snapshot -s <selector> reads a part of the page`]; }
    else {
      reading.frames++;
      const child = await enter(page, channel, frame.ref).catch(() => null);
      const granted = state.next;
      const read = child && await run<SnapshotPart>(child, `return K.snapshot(${js({ ...reading.options, grant: granted, base: frame.depth, maxChars: reading.left, limit: reading.max })})`, 5000).catch(() => null);
      if (!child || !read) inner = [`${indent}- note: this frame could not be read`];
      else {
        const inside = [...route, frame.ref];
        for (const block of blocksOf(read)) {
          // A frame keeps the blocks it was granted, and takes new ones from `granted` on: never another document's.
          if (block < 1 || (block < granted && state.routes.get(block)?.join(' ') !== inside.join(' '))) continue;
          state.routes.delete(block); state.routes.set(block, inside);
          if (block >= state.next) state.next = block + 1;
        }
        for (const oldest of state.routes.keys()) { if (state.routes.size <= ROUTES_MAX) break; state.routes.delete(oldest); }
        reading.refs += read.refs; reading.left -= read.text.length; reading.truncated ||= read.truncated === true;
        inner = await withFrames(page, child, inside, read, reading);
      }
    }
    // With -i, a frame with nothing to act on says nothing.
    if (!inner.length && reading.options.interactive) { lines.splice(frame.at - 1 + shift, 1); shift--; continue; }
    lines.splice(frame.at + shift, 0, ...inner); shift += inner.length;
  }
  return lines;
}

interface PageState { url: string; title: string; ready: 'loading' | 'interactive' | 'complete'; token: string; leaving: boolean; quiet?: number }

/** Null while the page is between documents: a navigation destroys the context mid-call. */
async function state(page: AgentPage): Promise<PageState | null> {
  try { return await run<PageState>(page, 'return K.state()', 2000); } catch { return null; }
}
async function begin(page: AgentPage): Promise<PageState> {
  for (let i = 0; i < 20; i++) {
    try { return await run<PageState>(page, 'K.leaving = false; return K.state()', 2000); }
    catch { await sleep(100); }
  }
  throw new Error('the page does not answer; it may still be loading, use wait --load domcontentloaded');
}

/**
 * Waits for a document other than `token`'s to have its DOM, never for the
 * load event: a page whose image or script never finishes would hold every
 * command until its deadline.
 */
export async function awaitDocument(page: AgentPage, token: string | undefined, deadlineMs = 10_000, downloads = page.downloads): Promise<{ state: PageState | null; loading: boolean }> {
  const deadline = Date.now() + deadlineMs;
  let last: PageState | null = null;
  while (Date.now() < deadline) {
    const now = await state(page);
    if (now) last = now;
    if (now && now.token !== token && now.ready !== 'loading' && now.url !== 'about:blank') return { state: now, loading: false };
    // The navigation became a download: the page stays as it is.
    if (now && page.downloads !== downloads) return { state: now, loading: false };
    await sleep(80);
  }
  return { state: last, loading: true };
}

/** The current document's kit token, or none before the first page. */
export async function documentToken(page: AgentPage): Promise<string | undefined> {
  return (await state(page))?.token;
}

/** How long the document stays unchanged, with no fresh call loading, before an action counts as done. */
const QUIET_MS = 100;
/** How long an action waits at most for a page that keeps changing, such as one with an animation. */
const SETTLE_MAX_MS = 1000;

/**
 * After an action: waits for what it set off to end, then, if it started a
 * navigation, for the next document's DOM. The page has settled once its
 * document has not changed for `QUIET_MS` and no call it began in the last
 * 1.5 s is still loading (`busy`), or after `SETTLE_MAX_MS` at most. A
 * navigation shows itself meanwhile by the old page's `beforeunload` or by a
 * new document. `patienceMs` waits at least that long for one, for a history
 * step whose navigation starts late.
 */
async function settle(page: AgentPage, before: PageState, dialogs: number, patienceMs = 0, downloads = page.downloads, land = true): Promise<BrowserActionResult> {
  let navigating = false;
  const start = Date.now();
  await sleep(30);
  for (;;) {
    const now = await state(page);
    if (!now || now.leaving || now.token !== before.token) { navigating = true; break; }
    const elapsed = Date.now() - start;
    if (elapsed >= Math.max(SETTLE_MAX_MS, patienceMs)) break;
    if (elapsed >= Math.max(QUIET_MS, patienceMs) && (now.quiet ?? QUIET_MS) >= QUIET_MS && !page.busy?.()) break;
    await sleep(30);
  }
  const asked = () => { const raised = page.dialogs.slice(dialogs); return raised.length ? { dialogs: raised } : {}; };
  if (!navigating) {
    const now = await state(page);
    return { ok: true, ...(now && now.url !== before.url ? { url: now.url, title: now.title } : {}), ...asked() };
  }
  const { state: after, loading } = await awaitDocument(page, before.token, undefined, downloads);
  if (after && after.token === before.token) {
    // The page began to leave and stayed: a download, a cancelled or a same-document navigation.
    return { ok: true, ...(after.url !== before.url ? { url: after.url, title: after.title } : {}), ...(loading ? { note: 'the page started to navigate and has not changed yet' } : {}), ...asked() };
  }
  // The page reached is waited for as an action's is, so one that fetches its content as it loads is read with it,
  // and a script that sends it on (a sign-in hop) is followed. `land` false leaves that to the caller.
  const landed = land && after && !loading ? await settle(page, after, page.dialogs.length, 0, page.downloads).catch(() => null) : null;
  return { ok: true, navigated: true, url: landed?.url ?? after?.url, title: landed?.title ?? after?.title, ...(loading || landed?.loading ? { loading: true } : {}), ...asked() };
}

/**
 * The wait an action gets, after a navigation reached its DOM: a page that
 * fetches its content as it loads is read with that content. Never throws.
 */
export async function settleLoaded(page: AgentPage): Promise<void> {
  const before = await state(page);
  if (before) await settle(page, before, page.dialogs.length).catch(() => {});
}

const MODIFIERS: Record<string, number> = { alt: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, command: 4, shift: 8 };
const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' }, Tab: { code: 'Tab', keyCode: 9 }, Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 }, Delete: { code: 'Delete', keyCode: 46 }, Insert: { code: 'Insert', keyCode: 45 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 }, ArrowDown: { code: 'ArrowDown', keyCode: 40 }, ArrowLeft: { code: 'ArrowLeft', keyCode: 37 }, ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 }, End: { code: 'End', keyCode: 35 }, PageUp: { code: 'PageUp', keyCode: 33 }, PageDown: { code: 'PageDown', keyCode: 34 },
  Space: { code: 'Space', keyCode: 32, text: ' ' },
};
function keyOf(name: string): { key: string; code: string; keyCode: number; text?: string } {
  if (KEYS[name]) return { key: name === 'Space' ? ' ' : name, ...KEYS[name] };
  const f = /^F([1-9]|1[0-2])$/.exec(name);
  if (f) return { key: name, code: name, keyCode: 111 + Number(f[1]) };
  const upper = name.toUpperCase();
  const code = /^[A-Z]$/.test(upper) ? `Key${upper}` : /^\d$/.test(name) ? `Digit${name}` : '';
  return { key: name, code, keyCode: /^[A-Z0-9]$/.test(upper) ? upper.charCodeAt(0) : 0, text: name };
}
const HELD: Record<string, { key: string; keyCode: number }> = {
  control: { key: 'Control', keyCode: 17 }, ctrl: { key: 'Control', keyCode: 17 }, alt: { key: 'Alt', keyCode: 18 },
  shift: { key: 'Shift', keyCode: 16 }, meta: { key: 'Meta', keyCode: 91 }, cmd: { key: 'Meta', keyCode: 91 }, command: { key: 'Meta', keyCode: 91 },
};
/** A key or a combination such as `Control+a`, as native key events. */
export async function press(page: FrameChannel, combo: string): Promise<void> {
  const parts = combo === '+' ? ['+'] : combo.endsWith('++') ? [...combo.slice(0, -2).split('+'), '+'] : combo.split('+');
  const name = parts.pop()!;
  const mods = parts.map(part => part.toLowerCase());
  const modifiers = mods.reduce((sum, part) => sum | (MODIFIERS[part] ?? 0), 0);
  const key = keyOf(name);
  const held = mods.map(part => HELD[part] ?? HELD.shift!);
  for (const mod of held) await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: mod.key, code: `${mod.key}Left`, windowsVirtualKeyCode: mod.keyCode, modifiers });
  // Text only for a plain or shifted character: Control+a is a shortcut, not an "a".
  const text = modifiers & 7 ? undefined : key.text && modifiers & 8 && key.text.length === 1 ? key.text.toUpperCase() : key.text;
  await page.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, modifiers, ...(text ? { text, unmodifiedText: key.text } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, modifiers });
  for (const mod of held.reverse()) await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: mod.key, code: `${mod.key}Left`, windowsVirtualKeyCode: mod.keyCode, modifiers: 0 });
}
/**
 * Moves the mouse to `point` the way a hand does: a few steps along a slight
 * curve from where it last was, rather than appearing on the target.
 */
async function approach(page: AgentPage, point: { x: number; y: number }): Promise<void> {
  const from = page.pointer ?? { x: point.x + (Math.random() - 0.5) * 300, y: point.y + 120 + Math.random() * 120 };
  const steps = 3 + Math.floor(Math.random() * 3), bend = (Math.random() - 0.5) * 40;
  for (let step = 1; step < steps; step++) {
    const t = step / steps, ease = t * t * (3 - 2 * t), arc = Math.sin(Math.PI * t) * bend;
    const x = Math.max(0, from.x + (point.x - from.x) * ease + arc), y = Math.max(0, from.y + (point.y - from.y) * ease - arc);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await sleep(8 + Math.random() * 10);
  }
  page.pointer = { x: point.x, y: point.y };
}

async function nativeClick(page: AgentPage, scope: Scope, selector: string, point: { x: number; y: number }, count: 1 | 2): Promise<CdpSessionDetachedError | undefined> {
  // A newly drawn cross-process frame can still route input to its iframe.
  // Confirm the native move reached the target before pressing, never retry a click.
  await run(scope.channel, `K.watchPointer(${js(selector)})`);
  await approach(page, point);
  try {
    for (const end = Date.now() + 2000;;) {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'none' });
      let local: Point = point;
      for (const { parent, owner } of scope.path) {
        if (!local) break;
        local = await run<Point>(parent, `return K.into(${js(owner)}, ${local.x}, ${local.y})`);
      }
      if (local && await run<boolean>(scope.channel, `return K.pointerMoved(${local.x}, ${local.y})`)) break;
      if (Date.now() >= end) throw new Error('the element did not receive native pointer movement; wait for the page to finish drawing, then try again');
      await sleep(16);
    }
  } finally { await run(scope.channel, 'K.stopPointer()').catch(() => {}); }
  for (let click = 1; click <= count; click++) {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: click });
    // A press lasts a few tens of milliseconds, never zero.
    await sleep(30 + Math.random() * 40);
    try { await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: click }); }
    catch (error) {
      // A popup may close itself on release without acknowledging that input.
      // Earlier input failures and detachment of another session remain errors.
      if (error instanceof CdpSessionDetachedError && error.method === 'Input.dispatchMouseEvent' && error.sessionId === page.session) return error;
      throw error;
    }
  }
}

type Point = { x: number; y: number; covered?: string } | null;

/**
 * Where native input reaches the element, in the top document's viewport: a
 * point in a frame moves out through each iframe around it, once each is
 * scrolled into its parent's view. Something drawn over an iframe covers the
 * element too.
 */
async function pointOf(scope: Scope, selector: string, mode: string): Promise<Point> {
  for (const { parent, owner } of scope.path) await run(parent, `return K.reveal(${js(owner)})`);
  let point = await run<Point>(scope.channel, `return K.point(${js(selector)}, ${js(mode)})`);
  for (const { parent, owner } of [...scope.path].reverse()) {
    if (!point) return point;
    const out: NonNullable<Point> = await run(parent, `return K.through(${js(owner)}, ${point.x}, ${point.y})`);
    point = { x: out.x, y: out.y, ...(point.covered ?? out.covered ? { covered: point.covered ?? out.covered } : {}) };
  }
  return point;
}

/**
 * Clicks through native input where the element is reachable. Something drawn
 * over it (a cookie banner, a dialog) would take a person's click: the click
 * is refused and the cover named with its controls, so the agent deals with it
 * first, unless `force` asks for a click through the DOM, which a page can
 * tell from a person's. A hidden tab has no native input and is always driven
 * through the DOM.
 */
async function click(page: AgentPage, scope: Scope, selector: string, count: 1 | 2, force = false, command = 'click'): Promise<{ note?: string; closed?: CdpSessionDetachedError }> {
  const point = await pointOf(scope, selector, 'click');
  if (point && !point.covered) return { closed: await nativeClick(page, scope, selector, point, count) };
  if (point?.covered && !force) throw new Error(`${selector} is covered by ${point.covered}, which a click there would hit; nothing was clicked. Close or accept what covers it first, or ${command} --force to click it through the DOM`);
  await run(scope.channel, `return K.dom('click', ${js(selector)}, ${count})`);
  return { note: point?.covered ? `the element was covered by ${point.covered}; it was clicked through the DOM` : undefined };
}

/** Text typed key by key, as a person does, when it is this short and plain; longer text is inserted at once. */
const KEYED_MAX = 200;

async function write(page: AgentPage, scope: Scope, kind: 'fill' | 'type', selector: string, text: string): Promise<string | undefined> {
  const before = kind === 'type' ? await run<string | null>(scope.channel, `return K.value(${js(selector)})`) ?? '' : '';
  const point = await pointOf(scope, selector, kind);
  if (point) {
    if (text.length <= KEYED_MAX && /^[\x20-\x7e]+$/.test(text)) {
      for (const char of text) {
        const key = keyOf(char === ' ' ? 'Space' : char);
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, text: char, unmodifiedText: char });
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode });
      }
    }
    else if (text) await page.send('Input.insertText', { text });
    else if (kind === 'fill') await press(page, 'Backspace');
    const value = await run<string | null>(scope.channel, `return K.value(${js(selector)})`);
    if (value === before + text) return undefined;
  }
  // A field that rewrote native typing: set the value the page's way.
  await run(scope.channel, `return K.dom(${js(kind)}, ${js(selector)}, ${js(text)})`);
  return point ? 'native typing did not produce the text; the value was set through the DOM' : undefined;
}

async function check(page: AgentPage, scope: Scope, selector: string, wanted: boolean, force = false): Promise<string | undefined> {
  if (await run<boolean>(scope.channel, `return K.checked(${js(selector)})`) === wanted) return undefined;
  const { note, closed } = await click(page, scope, selector, 1, force, wanted ? 'check' : 'uncheck');
  if (closed) throw closed;
  await sleep(30);
  if (await run<boolean>(scope.channel, `return K.checked(${js(selector)})`) === wanted) return note;
  await run(scope.channel, `return K.dom('click', ${js(selector)}, 1)`);
  if (await run<boolean>(scope.channel, `return K.checked(${js(selector)})`) === wanted) return 'a native click did not change it; it was clicked through the DOM';
  throw new Error(`the element stayed ${wanted ? 'unchecked' : 'checked'}; it may be a custom control, take a snapshot`);
}

async function wait(page: AgentPage, action: Extract<BrowserAction, { kind: 'wait' }>): Promise<BrowserActionResult> {
  if (action.ms !== undefined) { await sleep(action.ms); return { ok: true }; }
  const scope = await scopeOf(page, action.selector);
  const timeout = action.timeoutMs ?? 10_000;
  const deadline = Date.now() + timeout;
  const spec = js({ selector: action.selector, text: action.text, url: action.url, load: action.load === 'networkidle' ? undefined : action.load });
  let resources = -1, quietSince = 0;
  for (;;) {
    try {
      if (action.fn !== undefined) {
        if (await evaluate(page, `(async () => !!(await (${action.fn})))()`, 2000)) return { ok: true };
      } else if (action.load === 'networkidle') {
        const now = await run<{ ready: string; resources: number }>(page, 'return { ready: document.readyState, resources: K.resources() }', 2000);
        if (now.ready === 'complete' && now.resources === resources) { if (Date.now() - quietSince >= 500) return { ok: true }; }
        else { resources = now.resources; quietSince = Date.now(); }
      } else if (await run<boolean>(scope.channel, `return K.met(${spec})`, 2000)) return { ok: true };
    } catch (error) {
      if (/stale|unknown ref/.test(String(error))) throw error;
    }
    if (Date.now() + 100 >= deadline) throw new Error(`wait timed out after ${timeout} ms`);
    await sleep(100);
  }
}

/** One of `PAGE_ACTIONS` on `tabId`'s page. */
export async function automate(page: AgentPage, tabId: string, action: BrowserAction): Promise<BrowserReply> {
  try { return await act(page, tabId, action); }
  finally { page.frames?.release(); }
}

async function act(page: AgentPage, tabId: string, action: BrowserAction): Promise<BrowserReply> {
  const reply = (value: unknown): BrowserReply => ({ tabId, value });
  switch (action.kind) {
    case 'snapshot': return reply(await snapshot(page, action));
    case 'get': {
      const scope = await scopeOf(page, action.selector);
      return reply(await run(scope.channel, `return K.get(${js(action.what)}, ${js(action.selector ?? null)}, ${js(action.name ?? null)})`));
    }
    case 'click': case 'press': case 'check': case 'uncheck': case 'select': case 'fill': case 'type': {
      const scope = await scopeOf(page, action.kind === 'press' ? undefined : action.selector);
      const before = await begin(page);
      const dialogs = page.dialogs.length, downloads = page.downloads;
      let note: string | undefined, value: unknown;
      if (action.kind === 'click') {
        const clicked = await click(page, scope, action.selector, action.count ?? 1, action.force === true);
        if (clicked.closed) return reply({ ok: true });
        note = clicked.note;
      }
      else if (action.kind === 'check' || action.kind === 'uncheck') note = await check(page, scope, action.selector, action.kind === 'check', action.force === true);
      else if (action.kind === 'select') value = await run(scope.channel, `return K.select(${js(action.selector)}, ${js(action.values)})`);
      else if (action.kind === 'fill' || action.kind === 'type') note = await write(page, scope, action.kind, action.selector, action.text);
      else if (action.kind === 'press') await press(page, action.key);
      const result = await settle(page, before, dialogs, 0, downloads);
      return reply({ ...result, ...(note ? { note } : {}), ...(value === undefined ? {} : { value }) });
    }
    case 'hover': {
      const scope = await scopeOf(page, action.selector);
      const before = await begin(page);
      const dialogs = page.dialogs.length, downloads = page.downloads;
      const point = await pointOf(scope, action.selector, 'hover');
      if (point && !point.covered) { await approach(page, point); await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' }); }
      else await run(scope.channel, `return K.dom('hover', ${js(action.selector)})`);
      // A menu that opens on hover is drawn before the agent looks at it.
      return reply(await settle(page, before, dialogs, 0, downloads));
    }
    case 'focus': await run((await scopeOf(page, action.selector)).channel, `return K.focus(${js(action.selector)})`); return reply({ ok: true });
    case 'scrollintoview': {
      const scope = await scopeOf(page, action.selector);
      for (const { parent, owner } of scope.path) await run(parent, `return K.reveal(${js(owner)})`);
      await run(scope.channel, `return K.scrollIntoView(${js(action.selector)})`);
      return reply({ ok: true });
    }
    case 'scroll': {
      const scope = await scopeOf(page, action.selector);
      const before = await begin(page), dialogs = page.dialogs.length, downloads = page.downloads;
      const value = await run(scope.channel, `return K.scroll(${action.x}, ${action.y}, ${js(action.selector ?? null)})`);
      // A list that loads more as it is scrolled answers after the scroll: the page printed next shows it.
      return reply({ ...await settle(page, before, dialogs, 0, downloads), value });
    }
    case 'wait': return reply(await wait(page, action));
    case 'history': {
      const before = await begin(page);
      const dialogs = page.dialogs.length, downloads = page.downloads;
      await evaluate(page, action.direction === 'back' ? 'history.back()' : action.direction === 'forward' ? 'history.forward()' : 'location.reload()');
      // A check the page lands on comes first: browser.ts waits for it, then for the page it gives way to.
      return reply(await settle(page, before, dialogs, 800, downloads, false));
    }
    case 'dialog': {
      if (action.decision === 'status') return reply({ next: page.dialogPolicy.accept ? 'accept' : 'dismiss', recent: page.dialogs });
      page.dialogPolicy = { accept: action.decision === 'accept', text: action.text ?? null };
      return reply({ ok: true, note: `alerts, confirms and prompts raised by the next actions will be ${action.decision === 'accept' ? 'accepted' : 'dismissed'}` });
    }
    default: throw new Error(`browser action ${action.kind} is not a page action`);
  }
}
