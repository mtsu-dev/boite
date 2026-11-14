/**
 * Boite as ADEMark drives an app: launch, type, open a thread, quit.
 *
 * On Linux the bench has no Tauri shell (it needs WebKitGTK to build), so the
 * app is the compiled core plus the production UI in a headless Chromium, the
 * two processes a shell starts. Keys go in through devtools as real key events
 * and the echo is read from the composer at an animation frame, where ADEMark
 * reads pixels with OCR.
 */
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { connect } from '../../packages/core/src/client.ts';
import { BrowserPage, findBrowser } from '../../tests/e2e/lib/cdp.ts';
import { pairingUrlOf, type RunningCore, startCore } from '../../tests/e2e/lib/core.ts';
import { commandOf, evict, type Groups, now, parentOf, PROBE, probeRun, tree, until } from './lib.ts';
import type { Stage } from './stage.ts';

const ROOT = join(import.meta.dir, '..', '..');
/** The compiled core and the built UI of this checkout, or the ones a before/after comparison names. */
const CORE = process.env.ADEMARK_BOITE_CORE || join(ROOT, 'packages', 'core', 'dist', 'boite-core-linux-x64');
const UI = process.env.ADEMARK_BOITE_UI || join(ROOT, 'packages', 'ui', 'dist');
const COMPOSER = '[data-testid="composer-input"]';
const COMPOSER_VALUE = `(document.querySelector('${COMPOSER}')?.value ?? '')`;
/** The open thread's text. The timeline only holds the rows near the viewport, so a text found there is on screen or next to it. */
const TIMELINE_TEXT = `(document.querySelector('[data-testid="timeline"]')?.textContent ?? '')`;
/** Resolves at the frame after the one that drew the current DOM, with the page's host time. */
const NEXT_FRAME = 'new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(performance.timeOrigin + performance.now()))))';

type Client = Awaited<ReturnType<typeof connect>>;

export interface BoiteOptions {
  stage: Stage;
  /** Receipts and the data directory of this run. */
  out: string;
  arena: string;
  /** Replay runs send a made-up token; live runs keep the login of this shell. */
  live: boolean;
}

export class BoiteApp {
  readonly name = 'boite';
  readonly #options: BoiteOptions;
  readonly #dataDir: string;
  readonly #home: string;
  readonly #profile: string;
  #core: RunningCore | null = null;
  #client: Client | null = null;
  #page: BrowserPage | null = null;
  #projectId = '';
  #accountId = '';
  #finished = new Set<string>();
  #typed = 0;

  constructor(options: BoiteOptions) {
    if (!existsSync(CORE)) throw new Error(`the compiled core is missing: run \`bun run build:core:linux\` (${CORE})`);
    if (!existsSync(join(UI, 'index.html'))) throw new Error(`the UI build is missing: run \`bun run build:ui\` (${UI})`);
    this.#options = options;
    this.#dataDir = join(options.out, 'data');
    this.#home = join(options.out, 'home');
    this.#profile = join(options.out, 'browser');
    mkdirSync(this.#dataDir, { recursive: true });
    mkdirSync(join(this.#home, '.claude'), { recursive: true });
  }

  /** What `sudo purge` would make cold: the core, the UI, the browser and the data. */
  coldFiles(): string[] {
    return [CORE, UI, dirname(realpathSync(findBrowser())), this.#dataDir, this.#profile];
  }

  get client(): Client {
    if (this.#client === null) throw new Error('the core is not running');
    return this.#client;
  }

  get page(): BrowserPage {
    if (this.#page === null) throw new Error('the window is not open');
    return this.#page;
  }

  async #startCore(): Promise<RunningCore> {
    const login: Record<string, string> = this.#options.live ? {} : { ANTHROPIC_AUTH_TOKEN: 'replay', ANTHROPIC_API_KEY: '' };
    return startCore({
      command: [CORE],
      dataDir: this.#dataDir,
      env: { BOITE_UI_DIR: UI, HOME: this.#home, CLAUDE_CONFIG_DIR: join(this.#home, '.claude'), BOITE_HOST_AGENTS: '1', BOITE_ECHO: '0', ANTHROPIC_BASE_URL: this.#options.stage.url, ...login },
    });
  }

  async #connect(core: RunningCore): Promise<void> {
    this.#core = core;
    const client = await connect(core.url, core.token, { timeoutMs: 60_000 });
    client.on('turn.finished', (turn) => this.#finished.add(turn.threadId));
    this.#client = client;
  }

  /** First start on a fresh data directory: the arena project and a Claude account on this shell's login. */
  async install(): Promise<void> {
    await this.#connect(await this.#startCore());
    const project = await this.client.call('projects.add', { path: this.#options.arena, name: 'arena' });
    const account = await this.client.call('accounts.add', { providerId: 'claude', label: 'Bench', useDefaultLocation: true });
    const check = await this.client.call('accounts.check', { accountId: account.id, refresh: true });
    if (check.status !== 'ok') throw new Error(`the Claude account is not signed in: ${JSON.stringify(check)}`);
    this.#projectId = project.id;
    this.#accountId = account.id;
  }

  /** A thread made over RPC with full access, as ADEMark configures every app. Returns its id once the turn ended. */
  async thread(prompt: string, options: { wait?: boolean; title?: string } = {}): Promise<string> {
    const create = () => this.client.call('threads.create', { projectId: this.#projectId, providerId: 'claude', accountId: this.#accountId, model: 'claude-opus-5-5', effort: 'high', permissionMode: 'yolo', title: options.title ?? prompt, subscribe: true });
    // A fresh account is still listing its models for a moment, and the core refuses a thread until then.
    let thread = await create().catch(() => null);
    for (let attempt = 0; thread === null && attempt < 30; attempt += 1) {
      await Bun.sleep(1_000);
      thread = await create().catch((error: unknown) => (attempt === 29 ? Promise.reject(error) : null));
    }
    if (thread === null) throw new Error('the core refused to create a thread');
    await this.client.call('turns.start', { threadId: thread.id, prompt });
    if (options.wait !== false && !(await until(() => this.#finished.has(thread.id), 600_000, 50))) throw new Error(`the turn of ${prompt} never ended`);
    return thread.id;
  }

  finished(threadId: string): boolean {
    return this.#finished.has(threadId);
  }

  /** Opens the app: the core and the window start together, as the shell starts them. Returns as soon as the page is asked for. */
  async launch(): Promise<void> {
    const [core, page] = await Promise.all([
      this.#core ?? this.#startCore(),
      BrowserPage.launch({ url: 'about:blank', userDataDir: this.#profile, windowSize: { width: 1600, height: 1000 } }),
    ]);
    if (this.#client === null) await this.#connect(core);
    this.#page = page;
    this.#typed = 0;
    await page.send('Page.navigate', { url: pairingUrlOf(core) });
  }

  /**
   * Types a probe character every 50 ms until the composer shows two of them,
   * then waits for the frame that drew them. Returns that frame's host time.
   * With `absent`, the open thread must no longer show that text: an echo in
   * the old thread's composer is not a new thread.
   */
  async ready(timeoutMs = 60_000, absent?: string): Promise<number> {
    const end = performance.now() + timeoutMs;
    let nextKey = 0;
    while (performance.now() < end) {
      if (performance.now() >= nextKey) {
        nextKey = performance.now() + 50 * (0.8 + Math.random() * 0.4);
        await this.key(PROBE[this.#typed % PROBE.length] as string).catch(() => undefined);
        this.#typed += 1;
      }
      const value = await this.page.evaluate<string>(COMPOSER_VALUE, 2_000).catch(() => '');
      if (probeRun(value) >= 2 && (absent === undefined || !(await this.shows(absent)))) return this.page.evaluate<number>(NEXT_FRAME);
      await Bun.sleep(4);
    }
    throw new Error('the composer never echoed the probe');
  }

  async key(key: string): Promise<void> {
    await this.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, text: key, unmodifiedText: key });
    await this.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key });
  }

  /** One keystroke and the host time of the first frame that shows it. */
  async timedKey(key: string): Promise<{ sent: number; shown: number | null }> {
    const before = await this.page.evaluate<number>(`${COMPOSER_VALUE}.length`);
    const shown = this.page.evaluate<number | null>(`new Promise((done) => {
      const end = performance.now() + 2000;
      const look = () => {
        if (${COMPOSER_VALUE}.length !== ${before}) requestAnimationFrame(() => done(performance.timeOrigin + performance.now()));
        else if (performance.now() > end) done(null);
        else requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    })`, 10_000);
    const sent = now();
    await this.key(key);
    return { sent, shown: await shown };
  }

  async clearComposer(): Promise<void> {
    await this.page.type(COMPOSER, '');
    this.#typed = 0;
  }

  /** The new-thread button, without waiting for what it opens. */
  async newThread(): Promise<void> {
    await this.page.evaluate(`document.querySelector('[data-testid="new-thread"]').click()`);
  }

  /** True while the open thread still shows `marker`. */
  shows(marker: string): Promise<boolean> {
    return this.page.evaluate<boolean>(`(${TIMELINE_TEXT}).includes(${JSON.stringify(marker)})`);
  }

  /** Puts `text` in the composer, untimed. */
  /** Types `text` into the composer key by key, each held 10 ms as ADEMark's native keys are. */
  async fill(text: string): Promise<void> {
    for (const character of text) {
      await this.page.send('Input.dispatchKeyEvent', { type: 'keyDown', text: character, key: character });
      await Bun.sleep(10);
      await this.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: character });
    }
  }

  async enter(): Promise<void> {
    await this.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await this.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  }

  /** Starts watching for `marker` in the thread; the promise gives the host time of the first frame that shows it. */
  watch(marker: string, timeoutMs = 30_000, settled = false): Promise<number | null> {
    return this.page.evaluate<number | null>(`new Promise((done) => {
      const end = performance.now() + ${timeoutMs};
      const host = () => performance.timeOrigin + performance.now();
      // Settled is ADEMark's rule: the last frame that changed, once nothing changed for a second.
      let changed = performance.now();
      const observer = new MutationObserver(() => { changed = performance.now(); });
      if (${settled}) observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      const finish = (value) => { observer.disconnect(); done(value); };
      const settle = (shown) => {
        if (document.getAnimations().some((animation) => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity)) changed = performance.now();
        if (performance.now() - changed >= 1000 || performance.now() > end) finish(Math.max(shown, performance.timeOrigin + changed));
        else requestAnimationFrame(() => settle(shown));
      };
      const look = () => {
        if ((${TIMELINE_TEXT}).includes(${JSON.stringify(marker)})) requestAnimationFrame(() => (${settled} ? settle(host()) : finish(host())));
        else if (performance.now() > end) finish(null);
        else requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    })`, timeoutMs + 10_000);
  }

  /** Clicks a thread's row in the sidebar. */
  async open(threadId: string): Promise<void> {
    const row = `document.querySelector('[data-testid="thread-row"][data-thread-id="${threadId}"]')`;
    // A project card folds its quiet threads behind "Show more".
    await this.page.waitFor(`${row} || document.querySelector('[data-testid="project-more"][aria-expanded="false"]')`, 30_000);
    if (!(await this.page.evaluate<boolean>(`!!${row}`))) await this.page.click('[data-testid="project-more"][aria-expanded="false"]');
    await this.page.waitFor(row, 30_000);
    await this.page.evaluate(`${row}.click()`);
  }

  /** The app is the core and the browser; an agent is a Claude Code process the core started, with its children. */
  groups(): Groups {
    const core = this.#core?.pid;
    const roots = [core, this.#page?.pid].filter((pid): pid is number => typeof pid === 'number');
    const all = tree(roots);
    const agents = core === undefined ? [] : all.filter((pid) => pid !== core && /claude/.test(commandOf(pid).split(' ')[0] ?? '') && parentOf(pid) === core);
    return { app: all, agents };
  }

  /** Bytes of the core alone, the part a shell on any OS shares. */
  corePid(): number | null {
    return this.#core?.pid ?? null;
  }

  /** Closes the window and stops the core, the data kept for the next launch. */
  async quit(): Promise<void> {
    await this.#page?.close();
    this.#page = null;
    this.#client?.close();
    this.#client = null;
    await this.#core?.stop({ keepDataDir: true });
    this.#core = null;
  }

  /** Drops what `coldFiles` names from the page cache. */
  purge(): number {
    return evict(this.coldFiles());
  }
}
