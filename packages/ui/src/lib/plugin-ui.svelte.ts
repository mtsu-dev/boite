/*
 * Plugin interfaces (`provides.ui`, docs/plugins.md "Interface"). The window
 * reads `plugins.ui` from its home core once it is connected, adds each
 * plugin's stylesheet to the page and imports its script, which gets one
 * object: the slots it may fill (buttons, a message action, a panel tab, a
 * palette command), an RPC client limited to what the owner granted, its
 * settings and a cleanup hook. Svelte's markup is rebuilt every release, so
 * the slots are the API that lasts; the DOM is reachable, at the plugin's own
 * risk.
 *
 * A script that throws, while loading or later in a handler it gave Boite,
 * stops that plugin only: its slots go, its cleanups run, and its card on the
 * Plugins page says why. Safe mode starts the window with no plugin script:
 * `?safe=1`, or by itself after a start that never finished loading them.
 */

import { PLUGIN_PERMISSIONS, type PluginUiBundle, type RpcEventName, type RpcMethodName } from '@boite/contracts';
import type { Client } from './client';
import { errorText as messageOf } from './errors';

/** Where a plugin button goes. */
export const PLUGIN_SLOTS = ['thread-header', 'composer', 'sidebar'] as const;
export type PluginSlot = (typeof PLUGIN_SLOTS)[number];

/** What a button, a command or a panel tab is told about where it was used. */
export interface PluginSlotContext {
  /** The open conversation on the plugin's machine, or null on another machine's or none. */
  threadId: string | null;
}

/** What a message action is told about the message it was picked on. */
export interface PluginMessageContext {
  threadId: string;
  messageId: string;
  role: 'user' | 'assistant';
  /** What the message says, as its copy button would put it on the clipboard. */
  text: string;
}

interface Entry {
  /** `<plugin>/<id>`: unique across plugins. */
  key: string;
  plugin: string;
  id: string;
}
export interface PluginButtonEntry extends Entry { slot: PluginSlot; label: string; icon: string | null; run(context: PluginSlotContext): void }
export interface PluginMessageActionEntry extends Entry { label: string; run(context: PluginMessageContext): void }
export interface PluginTabEntry extends Entry {
  title: string;
  icon: string | null;
  /** Draws the tab into `element`; what it returns runs when the tab closes or the plugin unloads. */
  mount(element: HTMLElement, context: PluginSlotContext): void | (() => void);
}
export interface PluginCommandEntry extends Entry { title: string; run(context: PluginSlotContext): void }

export interface PluginUiStatus {
  name: string;
  state: 'loading' | 'running' | 'failed' | 'skipped';
  error: string | null;
}

export type SafeMode = { active: false; reason: null } | { active: true; reason: 'flag' | 'crash' };

/** Set while scripts load, cleared once they did: still set at the next start means that start died loading them. */
export const LOADING_KEY = 'boite:plugin-ui:loading';
/** How long after the scripts ran a start counts as survived. */
const SETTLE_MS = 1500;

/** `?safe` or `?safe=1` in the address, or a start that died while loading scripts. */
export function safeModeAt(search: string, storage: Pick<Storage, 'getItem'> | null): SafeMode {
  const flag = new URLSearchParams(search).get('safe');
  if (flag !== null && flag !== '0' && flag !== 'false') return { active: true, reason: 'flag' };
  try {
    if (storage?.getItem(LOADING_KEY) != null) return { active: true, reason: 'crash' };
  } catch { /* storage refused: no record of a crash */ }
  return { active: false, reason: null };
}

/** The part of a client the loader reads: one per connection, swapped on reconnect. */
export type PluginUiClient = Pick<Client, 'call' | 'on'>;

/** What the window hands the loader: how to open a panel tab, and how a script becomes a module. */
export interface PluginUiDeps {
  openTab(key: string, title: string): void;
  /** The open conversation of the plugin's own machine, for the contexts. */
  threadId(): string | null;
  importModule?(source: string, pluginId: string): Promise<{ url: string | null; module: Record<string, unknown> }>;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

interface Loaded {
  bundle: PluginUiBundle;
  alive: boolean;
  cleanups: (() => void)[];
  style: HTMLStyleElement | null;
  url: string | null;
  settings: PluginUiBundle['settings'];
  settingsListeners: Set<(values: PluginUiBundle['settings']) => void>;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const LABEL_MAX = 60;

/** A blob URL module: the default way a script runs, under the window's `script-src blob:`. */
async function blobModule(source: string): Promise<{ url: string; module: Record<string, unknown> }> {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    return { url, module: await import(/* @vite-ignore */ url) as Record<string, unknown> };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export class PluginUi {
  buttons = $state.raw<PluginButtonEntry[]>([]);
  messageActions = $state.raw<PluginMessageActionEntry[]>([]);
  tabs = $state.raw<PluginTabEntry[]>([]);
  commands = $state.raw<PluginCommandEntry[]>([]);
  status = $state.raw<Record<string, PluginUiStatus>>({});
  safe = $state.raw<SafeMode>({ active: false, reason: null });

  #deps: PluginUiDeps | null = null;
  #client: PluginUiClient | null = null;
  #bundles: PluginUiBundle[] = [];
  #loaded = new Map<string, Loaded>();
  /** Every event a script listens to, fanned out from whichever client is current. */
  #listeners = new Map<RpcEventName, Set<(payload: unknown) => void>>();
  #clientOffs: (() => void)[] = [];
  #refreshing: Promise<void> | null = null;
  #again = false;
  #settle: ReturnType<typeof setTimeout> | undefined;
  #windowOff: (() => void) | null = null;
  /** The digest each failed plugin failed at. */
  #failed = new Map<string, string>();

  /** Starts the loader on a window: the safe mode it starts in, and how tabs open. */
  start(deps: PluginUiDeps, safe: SafeMode): void {
    this.#deps = deps;
    this.safe = safe;
    this.#watchWindow();
  }

  /**
   * The home core's client, on every new connection: the interfaces are read
   * again, and what scripts listen to moves to it. Loaded scripts stay
   * loaded across a reconnect. Returns the detach.
   */
  attach(client: PluginUiClient): () => void {
    this.#client = client;
    for (const off of this.#clientOffs) off();
    this.#clientOffs = [client.on('plugins.uiUpdated', () => void this.refresh())];
    for (const event of this.#listeners.keys()) this.#subscribe(event);
    void this.refresh();
    return () => {
      if (this.#client !== client) return;
      for (const off of this.#clientOffs) off();
      this.#clientOffs = [];
      this.#client = null;
    };
  }

  /** Reads `plugins.ui` and brings the loaded scripts in line: new ones load, changed ones reload, gone ones unload. */
  refresh(): Promise<void> {
    if (this.#refreshing) { this.#again = true; return this.#refreshing; }
    this.#refreshing = (async () => {
      do {
        this.#again = false;
        const client = this.#client;
        if (!client) return;
        let bundles: PluginUiBundle[];
        try { bundles = await client.call('plugins.ui', {}); } catch { return; }
        await this.#apply(bundles);
      } while (this.#again);
    })().finally(() => { this.#refreshing = null; });
    return this.#refreshing;
  }

  /** Leaves safe mode: the scripts load now, and the next start loads them too. */
  async leaveSafeMode(): Promise<void> {
    this.#forgetCrash();
    this.safe = { active: false, reason: null };
    await this.#apply(this.#bundles);
  }

  /**
   * Unloads one plugin's interface and loads it again, read afresh from the
   * core: a dev plugin's edited files, or a script that failed and may not now.
   */
  async reload(id: string): Promise<void> {
    this.#failed.delete(id);
    this.#unload(id, null);
    if (this.#client) { await this.refresh(); return; }
    const bundle = this.#bundles.find((entry) => entry.id === id);
    if (bundle && !this.safe.active) await this.#load(bundle);
  }

  /** The buttons of one slot, in plugin order. */
  buttonsFor(slot: PluginSlot): PluginButtonEntry[] {
    return this.buttons.filter((entry) => entry.slot === slot);
  }

  tab(key: string): PluginTabEntry | null {
    return this.tabs.find((entry) => entry.key === key) ?? null;
  }

  name(plugin: string): string {
    return this.status[plugin]?.name ?? this.#bundles.find((bundle) => bundle.id === plugin)?.name ?? plugin;
  }

  /** Stops every script and forgets the window: tests, and a window going away. */
  stop(): void {
    for (const id of [...this.#loaded.keys()]) this.#unload(id, null);
    for (const off of this.#clientOffs) off();
    this.#clientOffs = [];
    this.#client = null;
    this.#windowOff?.();
    this.#windowOff = null;
    clearTimeout(this.#settle);
    this.#bundles = [];
    this.#failed.clear();
    this.#listeners.clear();
    this.status = {};
    this.safe = { active: false, reason: null };
  }

  async #apply(bundles: PluginUiBundle[]): Promise<void> {
    this.#bundles = bundles;
    const wanted = new Map(bundles.map((bundle) => [bundle.id, bundle]));
    for (const [id, loaded] of this.#loaded) {
      const next = wanted.get(id);
      if (!next || next.digest !== loaded.bundle.digest) this.#unload(id, null);
    }
    for (const id of Object.keys(this.status)) if (!wanted.has(id)) this.#setStatus(id, null);
    if (this.safe.active) {
      for (const bundle of bundles) this.#setStatus(bundle.id, { name: bundle.name, state: 'skipped', error: null });
      return;
    }
    // A failed script stays off until it changes (an update, a dev edit) or its card asks again.
    for (const [id, digest] of this.#failed) if (wanted.get(id)?.digest !== digest) this.#failed.delete(id);
    const fresh = bundles.filter((bundle) => !this.#loaded.has(bundle.id) && !this.#failed.has(bundle.id));
    for (const bundle of bundles) {
      const loaded = this.#loaded.get(bundle.id);
      if (loaded && JSON.stringify(loaded.settings) !== JSON.stringify(bundle.settings)) this.#settingsChanged(loaded, bundle.settings);
    }
    if (fresh.length === 0) return;
    this.#markLoading();
    for (const bundle of fresh) await this.#load(bundle);
    this.#markLoaded();
  }

  async #load(bundle: PluginUiBundle): Promise<void> {
    const id = bundle.id;
    const loaded: Loaded = { bundle, alive: true, cleanups: [], style: null, url: null, settings: bundle.settings, settingsListeners: new Set() };
    this.#loaded.set(id, loaded);
    this.#setStatus(id, { name: bundle.name, state: 'loading', error: null });
    if (bundle.error !== null) { this.#fail(id, bundle.error); return; }
    if (bundle.style !== null && typeof document !== 'undefined') {
      const style = document.createElement('style');
      style.dataset['boitePlugin'] = id;
      style.textContent = bundle.style;
      document.head.append(style);
      loaded.style = style;
    }
    if (bundle.script !== null) {
      try {
        const imported = await (this.#deps?.importModule ?? blobModule)(bundle.script, id);
        loaded.url = imported.url;
        if (!loaded.alive) { if (imported.url) URL.revokeObjectURL(imported.url); return; }
        const activate = typeof imported.module['default'] === 'function' ? imported.module['default'] : imported.module['activate'];
        if (typeof activate !== 'function') throw new Error('its script exports neither a default function nor activate()');
        const result = await (activate as (api: unknown) => unknown)(this.#api(loaded));
        if (typeof result === 'function') loaded.cleanups.push(result as () => void);
      } catch (error) {
        this.#fail(id, messageOf(error));
        return;
      }
    }
    if (loaded.alive) this.#setStatus(id, { name: bundle.name, state: 'running', error: null });
  }

  /** Stops a plugin after its script threw: slots and style go, cleanups run, and its card says why. */
  #fail(id: string, error: string): void {
    const name = this.#loaded.get(id)?.bundle.name ?? this.name(id);
    const digest = this.#loaded.get(id)?.bundle.digest;
    if (digest !== undefined) this.#failed.set(id, digest);
    this.#unload(id, { name, state: 'failed', error });
    console.warn(`plugin ${id}: ${error}`);
  }

  #unload(id: string, status: PluginUiStatus | null): void {
    const loaded = this.#loaded.get(id);
    if (loaded) {
      loaded.alive = false;
      this.#loaded.delete(id);
      for (const cleanup of loaded.cleanups.reverse()) {
        try { cleanup(); } catch (error) { console.warn(`plugin ${id} cleanup: ${messageOf(error)}`); }
      }
      loaded.style?.remove();
      if (loaded.url) URL.revokeObjectURL(loaded.url);
      const mine = (entry: Entry) => entry.plugin !== id;
      this.buttons = this.buttons.filter(mine);
      this.messageActions = this.messageActions.filter(mine);
      this.tabs = this.tabs.filter(mine);
      this.commands = this.commands.filter(mine);
    }
    this.#setStatus(id, status);
  }

  #setStatus(id: string, status: PluginUiStatus | null): void {
    const next = { ...this.status };
    if (status === null) delete next[id];
    else next[id] = status;
    this.status = next;
  }

  #settingsChanged(loaded: Loaded, values: PluginUiBundle['settings']): void {
    loaded.settings = values;
    for (const listener of loaded.settingsListeners) this.#guard(loaded, listener)(structuredClone(values));
  }

  /**
   * A tab's cleanup, run exactly once: when the tab closes, or when its plugin
   * unloads with the tab still open, so the timers and listeners its mount
   * started never outlive it. A throw while the plugin runs stops it; one
   * during unloading is only logged.
   */
  #tabCleanup(loaded: Loaded, cleanup: () => void): () => void {
    let ran = false;
    const once = () => {
      if (ran) return;
      ran = true;
      loaded.cleanups = loaded.cleanups.filter((other) => other !== once);
      try { cleanup(); } catch (error) {
        if (loaded.alive) this.#fail(loaded.bundle.id, messageOf(error));
        else console.warn(`plugin ${loaded.bundle.id} cleanup: ${messageOf(error)}`);
      }
    };
    if (loaded.alive) loaded.cleanups.push(once);
    else once();
    return once;
  }

  /** A function a script handed Boite: run only while its plugin is loaded, its throw stopping that plugin alone. */
  #guard<A extends unknown[], R>(loaded: Loaded, fn: (...args: A) => R): (...args: A) => R | undefined {
    return (...args: A) => {
      if (!loaded.alive) return undefined;
      try {
        const result = fn(...args);
        if (result instanceof Promise) result.catch((error: unknown) => { if (loaded.alive) this.#fail(loaded.bundle.id, messageOf(error)); });
        return result;
      } catch (error) {
        this.#fail(loaded.bundle.id, messageOf(error));
        return undefined;
      }
    };
  }

  #subscribe(event: RpcEventName): void {
    const client = this.#client;
    if (!client) return;
    this.#clientOffs.push(client.on(event, ((payload: unknown) => {
      for (const listener of [...(this.#listeners.get(event) ?? [])]) listener(payload);
    }) as never));
  }

  /** The object a script's default export is called with. */
  #api(loaded: Loaded): object {
    const plugin = loaded.bundle.id;
    const methods = new Set<string>(loaded.bundle.permissions.flatMap((permission) => PLUGIN_PERMISSIONS[permission]?.methods ?? []));
    const events = new Set<string>(loaded.bundle.permissions.flatMap((permission) => PLUGIN_PERMISSIONS[permission]?.events ?? []));
    const context = (): PluginSlotContext => ({ threadId: this.#deps?.threadId() ?? null });
    const own = (what: string, spec: unknown): Record<string, unknown> => {
      if (typeof spec !== 'object' || spec === null) throw new TypeError(`${what} takes an object`);
      return spec as Record<string, unknown>;
    };
    const idOf = (what: string, spec: Record<string, unknown>): string => {
      const id = spec['id'];
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new TypeError(`${what}: id must be letters, digits, - or _, at most 40, found ${JSON.stringify(id)}`);
      return id;
    };
    const textOf = (what: string, spec: Record<string, unknown>, key: string): string => {
      const text = spec[key];
      if (typeof text !== 'string' || text.trim() === '' || text.length > LABEL_MAX) throw new TypeError(`${what}: ${key} must be a string of 1 to ${LABEL_MAX} characters`);
      return text;
    };
    const fnOf = <F>(what: string, spec: Record<string, unknown>, key: string): F => {
      if (typeof spec[key] !== 'function') throw new TypeError(`${what}: ${key} must be a function`);
      return spec[key] as F;
    };
    const iconOf = (spec: Record<string, unknown>): string | null => (typeof spec['icon'] === 'string' && spec['icon'].length <= 4000 ? spec['icon'] : null);
    /** Adds an entry to one list while the plugin is loaded; the remove it returns is also a cleanup. */
    const add = <T extends Entry>(list: 'buttons' | 'messageActions' | 'tabs' | 'commands', entry: T): (() => void) => {
      if (!loaded.alive) return () => {};
      const current = this[list] as unknown as T[];
      if (current.some((other) => other.key === entry.key)) throw new Error(`${entry.key} is already added`);
      (this[list] as unknown as T[]) = [...current, entry];
      const remove = () => { (this[list] as unknown as T[]) = (this[list] as unknown as T[]).filter((other) => other !== entry); };
      loaded.cleanups.push(remove);
      return remove;
    };
    const ui = Object.freeze({
      slots: PLUGIN_SLOTS,
      addButton: (raw: unknown) => {
        const spec = own('addButton', raw);
        const id = idOf('addButton', spec);
        const slot = spec['slot'];
        if (!PLUGIN_SLOTS.includes(slot as PluginSlot)) throw new TypeError(`addButton: slot must be one of ${PLUGIN_SLOTS.join(', ')}, found ${JSON.stringify(slot)}`);
        const run = this.#guard(loaded, fnOf<(context: PluginSlotContext) => unknown>('addButton', spec, 'onClick'));
        return add<PluginButtonEntry>('buttons', { key: `${plugin}/${id}`, plugin, id, slot: slot as PluginSlot, label: textOf('addButton', spec, 'label'), icon: iconOf(spec), run: (ctx) => { run(ctx); } });
      },
      addMessageAction: (raw: unknown) => {
        const spec = own('addMessageAction', raw);
        const id = idOf('addMessageAction', spec);
        const run = this.#guard(loaded, fnOf<(context: PluginMessageContext) => unknown>('addMessageAction', spec, 'onClick'));
        return add<PluginMessageActionEntry>('messageActions', { key: `${plugin}/${id}`, plugin, id, label: textOf('addMessageAction', spec, 'label'), run: (ctx) => { run(ctx); } });
      },
      addPanelTab: (raw: unknown) => {
        const spec = own('addPanelTab', raw);
        const id = idOf('addPanelTab', spec);
        const mount = this.#guard(loaded, fnOf<PluginTabEntry['mount']>('addPanelTab', spec, 'mount'));
        return add<PluginTabEntry>('tabs', { key: `${plugin}/${id}`, plugin, id, title: textOf('addPanelTab', spec, 'title'), icon: iconOf(spec), mount: (element, ctx) => {
          const cleanup = mount(element, ctx);
          return typeof cleanup === 'function' ? this.#tabCleanup(loaded, cleanup as () => void) : undefined;
        } });
      },
      addCommand: (raw: unknown) => {
        const spec = own('addCommand', raw);
        const id = idOf('addCommand', spec);
        const run = this.#guard(loaded, fnOf<(context: PluginSlotContext) => unknown>('addCommand', spec, 'onRun'));
        return add<PluginCommandEntry>('commands', { key: `${plugin}/${id}`, plugin, id, title: textOf('addCommand', spec, 'title'), run: (ctx) => { run(ctx); } });
      },
      /** Opens one of this plugin's panel tabs in the open conversation's panel. */
      openPanelTab: (id: unknown) => {
        const tab = this.tab(`${plugin}/${String(id)}`);
        if (!tab) throw new Error(`openPanelTab: ${plugin} added no panel tab ${String(id)}`);
        this.#deps?.openTab(tab.key, tab.title);
      },
      context,
    });
    const rpc = Object.freeze({
      call: (method: unknown, params?: unknown): Promise<unknown> => {
        if (!loaded.alive) return Promise.reject(new Error(`${plugin} is unloaded`));
        if (typeof method !== 'string' || !methods.has(method)) {
          return Promise.reject(new Error(`${String(method)} needs a permission ${plugin} was not granted (granted: ${loaded.bundle.permissions.join(', ') || 'none'})`));
        }
        const client = this.#client;
        if (!client) return Promise.reject(new Error('Boite is not connected right now'));
        return client.call(method as RpcMethodName, (params ?? {}) as never);
      },
      on: (event: unknown, handler: unknown): (() => void) => {
        if (typeof event !== 'string' || !events.has(event)) throw new Error(`${String(event)} needs a permission ${plugin} was not granted`);
        if (typeof handler !== 'function') throw new TypeError('rpc.on: the handler must be a function');
        const name = event as RpcEventName;
        const guarded = this.#guard(loaded, handler as (payload: unknown) => unknown) as (payload: unknown) => void;
        let set = this.#listeners.get(name);
        if (!set) { set = new Set(); this.#listeners.set(name, set); this.#subscribe(name); }
        set.add(guarded);
        const off = () => { this.#listeners.get(name)?.delete(guarded); };
        loaded.cleanups.push(off);
        return off;
      },
    });
    const settings = Object.freeze({
      get: () => structuredClone(loaded.settings),
      onChange: (listener: unknown): (() => void) => {
        if (typeof listener !== 'function') throw new TypeError('settings.onChange: the listener must be a function');
        const typed = listener as (values: PluginUiBundle['settings']) => void;
        loaded.settingsListeners.add(typed);
        const off = () => { loaded.settingsListeners.delete(typed); };
        loaded.cleanups.push(off);
        return off;
      },
    });
    return Object.freeze({
      id: plugin,
      name: loaded.bundle.name,
      version: loaded.bundle.version,
      permissions: Object.freeze([...loaded.bundle.permissions]),
      ui,
      rpc,
      settings,
      onCleanup: (fn: unknown) => {
        if (typeof fn !== 'function') throw new TypeError('onCleanup takes a function');
        loaded.cleanups.push(fn as () => void);
      },
    });
  }

  /** Errors thrown later by a script's own code (a timer, a listener it added to the DOM): the blob URL says whose. */
  #watchWindow(): void {
    if (typeof window === 'undefined' || this.#windowOff) return;
    const owner = (text: string | undefined): string | null => {
      if (!text) return null;
      for (const [id, loaded] of this.#loaded) if (loaded.url && text.includes(loaded.url)) return id;
      return null;
    };
    const onError = (event: ErrorEvent) => {
      const id = owner(event.filename) ?? owner(event.error instanceof Error ? event.error.stack : undefined);
      if (id) this.#fail(id, event.message || messageOf(event.error));
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const id = owner(event.reason instanceof Error ? event.reason.stack : undefined);
      if (id) this.#fail(id, messageOf(event.reason));
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    this.#windowOff = () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }

  #markLoading(): void {
    clearTimeout(this.#settle);
    try { this.#deps?.storage?.setItem(LOADING_KEY, String(Date.now())); } catch { /* storage refused */ }
  }

  #markLoaded(): void {
    clearTimeout(this.#settle);
    this.#settle = setTimeout(() => this.#forgetCrash(), SETTLE_MS);
  }

  #forgetCrash(): void {
    try { this.#deps?.storage?.removeItem(LOADING_KEY); } catch { /* storage refused */ }
  }
}

/** The window's one loader. */
export const pluginUi = new PluginUi();
