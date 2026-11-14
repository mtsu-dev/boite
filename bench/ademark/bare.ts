/**
 * ADEMark's control: Claude Code alone, one process per thread, each in a
 * pseudo-terminal. ADEMark runs it in Ghostty and reads the window; here no
 * terminal draws, so the echo is the moment Claude Code writes the typed text
 * back to the terminal, and the terminal's own memory and CPU are left out.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evict, type Groups, now, plain, PROBE, until } from './lib.ts';
import type { Stage } from './stage.ts';

interface Tab {
  proc: Bun.Subprocess;
  /** Everything Claude Code drew, without escape sequences or blanks. */
  drawn: string;
  /** Called with each chunk as it arrives. */
  listen: ((chunk: string, at: number) => void) | null;
  typed: string;
}

interface Terminal {
  write(data: string): void;
}

function squeeze(text: string): string {
  return plain(text).replace(/\s+/g, '');
}

export interface BareOptions {
  stage: Stage;
  out: string;
  arena: string;
  live: boolean;
  /** The Claude Code executable; a private copy lets a cold start be cold. */
  binary?: string;
}

export class BareCli {
  readonly name = 'bare-cli';
  readonly #options: BareOptions;
  readonly #home: string;
  readonly #binary: string;
  #tabs: Tab[] = [];

  constructor(options: BareOptions) {
    this.#options = options;
    this.#home = join(options.out, 'home');
    const binary = options.binary ?? Bun.which('claude');
    if (binary === null) throw new Error('no `claude` on PATH: the Bare CLI is Claude Code');
    this.#binary = binary;
    mkdirSync(join(this.#home, '.claude'), { recursive: true });
    // A fresh config would open on the theme picker and the trust question: a user's CLI is past both.
    writeFileSync(join(this.#home, '.claude', '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, bypassPermissionsModeAccepted: true, projects: { [options.arena]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }));
  }

  get #front(): Tab {
    const tab = this.#tabs.at(-1);
    if (tab === undefined) throw new Error('no Claude Code is running');
    return tab;
  }

  #terminal(tab: Tab): Terminal {
    return (tab.proc as unknown as { terminal: Terminal }).terminal;
  }

  /** Starts one Claude Code in the arena, which is both a launch and a new thread for a CLI. */
  async launch(): Promise<void> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && key !== 'CLAUDECODE' && !key.startsWith('CLAUDE_') && !key.startsWith('BOITE')) env[key] = value;
    }
    Object.assign(env, { HOME: this.#home, CLAUDE_CONFIG_DIR: join(this.#home, '.claude'), ANTHROPIC_BASE_URL: this.#options.stage.url, TERM: 'xterm-256color' });
    if (!this.#options.live) Object.assign(env, { ANTHROPIC_AUTH_TOKEN: 'replay', ANTHROPIC_API_KEY: '' });
    const decoder = new TextDecoder();
    const tab: Tab = { proc: null as unknown as Bun.Subprocess, drawn: '', listen: null, typed: '' };
    const terminal = {
      cols: 160,
      rows: 50,
      data(_terminal: unknown, data: Uint8Array): void {
        const at = now();
        const chunk = squeeze(decoder.decode(data, { stream: true }));
        tab.drawn += chunk;
        tab.listen?.(chunk, at);
      },
    };
    tab.proc = Bun.spawn([this.#binary, '--model', 'claude-opus-5-5', '--effort', 'high', '--dangerously-skip-permissions'], { cwd: this.#options.arena, env, terminal } as unknown as Parameters<typeof Bun.spawn>[1]);
    this.#tabs.push(tab);
  }

  newThread(): Promise<void> {
    return this.launch();
  }

  /** Types a probe character every 50 ms until Claude Code draws two of them after its prompt sign. */
  async ready(timeoutMs = 60_000): Promise<number> {
    const tab = this.#front;
    let shown: number | null = null;
    tab.listen = (_chunk, at) => {
      if (shown === null && tab.typed.length >= 2 && /❯[ademarkqz]{2,}/.test(tab.drawn.slice(tab.drawn.lastIndexOf('❯')))) shown = at;
    };
    const end = performance.now() + timeoutMs;
    while (shown === null && performance.now() < end) {
      const key = PROBE[tab.typed.length % PROBE.length] as string;
      this.#terminal(tab).write(key);
      tab.typed += key;
      await Bun.sleep(50 * (0.8 + Math.random() * 0.4));
    }
    tab.listen = null;
    if (shown === null) throw new Error('Claude Code never echoed the probe');
    return shown;
  }

  /** One keystroke in a thread and the host time Claude Code drew it. */
  async timedKey(key: string, thread = 0): Promise<{ sent: number; shown: number | null }> {
    const tab = this.#tabs[thread];
    if (tab === undefined) throw new Error('no Claude Code is running');
    tab.typed += key;
    // Claude Code echoes a key as that one character at the cursor, or redraws the prompt line with what was typed so far.
    const line = `❯${tab.typed.slice(-12)}`;
    let shown: number | null = null;
    // The terminal may cut one redraw in two reads, so the line is looked for in everything drawn since the key.
    const from = tab.drawn.length;
    tab.listen = (chunk, at) => {
      if (shown === null && (chunk === key || tab.drawn.slice(Math.max(0, from - line.length)).includes(line))) shown = at;
    };
    const sent = now();
    this.#terminal(tab).write(key);
    await until(() => shown !== null, 2_000, 2);
    tab.listen = null;
    return { sent, shown };
  }

  async clearComposer(): Promise<void> {
    for (const tab of this.#tabs) {
      if (tab.typed === '') continue;
      // Control-U empties the input line.
      this.#terminal(tab).write('\x15');
      tab.typed = '';
    }
    await Bun.sleep(300);
  }

  async fill(text: string): Promise<void> {
    this.#terminal(this.#front).write(text);
    // ADEMark lets a pasted prompt settle for 500 ms before Enter.
    await Bun.sleep(500);
  }

  async enter(): Promise<void> {
    this.#terminal(this.#front).write('\r');
  }

  /** The host time Claude Code first draws `marker` in the front thread. */
  watch(marker: string, timeoutMs = 30_000): Promise<number | null> {
    const tab = this.#front;
    const from = tab.drawn.length;
    return new Promise((done) => {
      const timer = setTimeout(() => {
        tab.listen = null;
        done(null);
      }, timeoutMs);
      tab.listen = (_chunk, at) => {
        if (!tab.drawn.slice(Math.max(0, from - marker.length)).includes(marker)) return;
        clearTimeout(timer);
        tab.listen = null;
        done(at);
      };
    });
  }

  /** A finished thread: a new Claude Code that got `prompt` and drew `marker`. */
  async thread(prompt: string, marker: string, timeoutMs = 600_000): Promise<void> {
    await this.launch();
    await this.#settle();
    const seen = this.watch(marker, timeoutMs);
    await this.fill(prompt);
    await this.enter();
    if ((await seen) === null) throw new Error(`Claude Code never drew ${marker} for ${prompt}`);
  }

  /** Sends `prompt` in a new Claude Code and returns without waiting for the answer. */
  async start(prompt: string): Promise<void> {
    await this.launch();
    await this.#settle();
    await this.fill(prompt);
    await this.enter();
  }

  async #settle(): Promise<void> {
    const tab = this.#front;
    if (!(await until(() => tab.drawn.includes('❯'), 30_000))) throw new Error('Claude Code never drew its prompt');
    await Bun.sleep(500);
  }

  /** How many Claude Code processes this run started and still holds. */
  count(): number {
    return this.#tabs.length;
  }

  /** No app: every process is an agent. */
  groups(): Groups {
    return { app: [], agents: this.#tabs.map((tab) => tab.proc.pid) };
  }

  purge(): number {
    return evict([this.#binary, this.#home]);
  }

  async quit(): Promise<void> {
    for (const tab of this.#tabs) tab.proc.kill();
    await Promise.all(this.#tabs.map((tab) => tab.proc.exited));
    this.#tabs = [];
  }
}
