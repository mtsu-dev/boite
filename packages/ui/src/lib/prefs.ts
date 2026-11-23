import type { PermissionMode } from '@boite/contracts';

/** What the composer remembers between threads: the last provider, account, mode, model and effort. */
export interface ComposerPrefs {
  providerId: string | null;
  accountId: string | null;
  permissionMode: PermissionMode;
  model: string | null;
  /** A level id of that model, or null for the model's own default. */
  effort: string | null;
  speed?: string | null;
}

/** What the window remembers: the sidebar's width, optional Mochis column width, and whether it is folded. */
export interface LayoutPrefs {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  agentsSidebarWidth?: number;
}

export type SidebarPage = 'chat' | 'agents' | 'home' | 'settings';

export const PREFS_STORAGE_KEY = 'boite.composer';
export const LAYOUT_STORAGE_KEY = 'boite.layout';

/** Wide enough for about 30 characters of a thread title before its cut at the default size. */
export const SIDEBAR_DEFAULT = 312;
/** The defaults before: a width saved at one of them was never chosen, so it reads as today's default. */
const SIDEBAR_OLD_DEFAULTS = new Set([280, 300]);
export const SIDEBAR_MIN = 208;
export const SIDEBAR_MAX = 440;
/** The Mochis column holds a head and a short list: cap it so the conversation keeps its reading width. */
export const AGENTS_SIDEBAR_MAX = 280;

const MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'yolo', 'dontAsk'];

export function defaultPrefs(): ComposerPrefs {
  return { providerId: null, accountId: null, permissionMode: 'default', model: null, effort: null };
}

function defaultLayout(): LayoutPrefs {
  return { sidebarWidth: SIDEBAR_DEFAULT, sidebarCollapsed: false };
}

export function sidebarMax(page: SidebarPage, drawer = false): number {
  return page === 'agents' && !drawer ? AGENTS_SIDEBAR_MAX : SIDEBAR_MAX;
}

export function clampSidebar(width: number, max = SIDEBAR_MAX): number {
  return Math.min(max, Math.max(SIDEBAR_MIN, Math.round(width)));
}

/**
 * Single source of truth for the left column's visible width on desktop:
 * capped on the Mochis page (outside a drawer), using the Mochis column's own
 * width once dragged there while leaving the thread list's width untouched.
 */
export function visibleSidebarWidth(
  layout: { sidebarWidth: number; agentsSidebarWidth?: number | null; page?: SidebarPage },
  drawer = false
): number {
  const page = layout.page ?? 'chat';
  const max = sidebarMax(page, drawer);
  const raw = page === 'agents' && !drawer && typeof layout.agentsSidebarWidth === 'number'
    ? layout.agentsSidebarWidth
    : layout.sidebarWidth;
  return clampSidebar(raw, max);
}

function read<T>(key: string, fallback: () => T, parse: (raw: Partial<T>) => T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback();
    return parse(JSON.parse(raw) as Partial<T>);
  } catch {
    return fallback();
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* a browser that refuses storage still runs for this session */
  }
}

export function readPrefs(): ComposerPrefs {
  return read(PREFS_STORAGE_KEY, defaultPrefs, (parsed) => {
    const mode = parsed.permissionMode;
    return {
      providerId: typeof parsed.providerId === 'string' ? parsed.providerId : null,
      accountId: typeof parsed.accountId === 'string' ? parsed.accountId : null,
      permissionMode: mode !== undefined && MODES.includes(mode) ? mode : 'default',
      model: typeof parsed.model === 'string' ? parsed.model : null,
      effort: typeof parsed.effort === 'string' ? parsed.effort : null,
      speed: typeof parsed.speed === 'string' ? parsed.speed : null
    };
  });
}

export function writePrefs(prefs: ComposerPrefs): void {
  write(PREFS_STORAGE_KEY, prefs);
}

export function readLayout(): LayoutPrefs {
  return read(LAYOUT_STORAGE_KEY, defaultLayout, (parsed) => {
    const agentsSidebarWidth =
      typeof parsed.agentsSidebarWidth === 'number' && Number.isFinite(parsed.agentsSidebarWidth)
        ? clampSidebar(parsed.agentsSidebarWidth, AGENTS_SIDEBAR_MAX)
        : undefined;
    return {
      sidebarWidth:
        typeof parsed.sidebarWidth === 'number' && Number.isFinite(parsed.sidebarWidth) && !SIDEBAR_OLD_DEFAULTS.has(parsed.sidebarWidth)
          ? clampSidebar(parsed.sidebarWidth)
          : SIDEBAR_DEFAULT,
      sidebarCollapsed: parsed.sidebarCollapsed === true,
      ...(agentsSidebarWidth !== undefined ? { agentsSidebarWidth } : {})
    };
  });
}

export function writeLayout(layout: LayoutPrefs): void {
  write(LAYOUT_STORAGE_KEY, layout);
}

/**
 * What the stash chord puts aside: one text per thread, so a prompt written and not sent
 * survives a reload. A draft has no thread id yet and stashes under
 * `DRAFT_STASH_KEY`.
 */
export const STASH_STORAGE_KEY = 'boite:composer-stash:v1';
export const DRAFT_STASH_KEY = 'draft';

function readStashes(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(STASH_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStashes(stashes: Record<string, string>): void {
  try {
    if (Object.keys(stashes).length === 0) window.localStorage.removeItem(STASH_STORAGE_KEY);
    else window.localStorage.setItem(STASH_STORAGE_KEY, JSON.stringify(stashes));
  } catch {
    /* a browser that refuses storage still runs for this session */
  }
}

/** The text stashed for one thread, or null when there is none. */
export function readStash(key: string): string | null {
  return readStashes()[key] ?? null;
}

export function writeStash(key: string, text: string): void {
  writeStashes({ ...readStashes(), [key]: text });
}

export function clearStash(key: string): void {
  const stashes = readStashes();
  if (!(key in stashes)) return;
  delete stashes[key];
  writeStashes(stashes);
}
