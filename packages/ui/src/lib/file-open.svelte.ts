/**
 * What a click on a chat file link does. The path an agent writes belongs to
 * the thread's machine, yet the one reading the chat may be on another: a
 * Windows PC showing a thread on a Linux server, with `N:\` its own NAS. So a
 * link is looked for where it can be (`locate`), then opened there:
 *
 * - on this computer, through the shell: a document or a folder in its app, a
 *   program only once the user confirmed it (`openOnClient`);
 * - in the thread's project: a picture or a video in the viewer, anything else
 *   in the right panel's Files tab;
 * - nowhere: a notice names the machine it was looked for on, with the path to copy.
 */
import { fullPath } from './chat-links';
import { confirm } from './confirm.svelte';
import { absolutePath, baseName, fileKind, foreignPath, markCollisions } from './file-links';
import { clientPathInfo, localFileDirectory, openClientPath, revealClientPath, type ClientPathKind } from './local-files';
import type { MediaItem } from './media-gallery';
import type { MenuItem } from './menu';
import { desktopShell } from './shell-platform';
import type { Store } from './store.svelte';
import { fill, strings } from './strings';
import { relativeTo } from './turn-files';
import { machineName, workspace } from './workspace.svelte';

export type Where =
  /** On the thread's machine, as its core found it: relative to the thread's folder or absolute. */
  | { at: 'thread'; path: string }
  /** On this computer, written as this computer writes it. */
  | { at: 'client'; path: string; kind: Exclude<ClientPathKind, 'missing'> }
  /** Looked for and not found: on this computer when `client`, else on the thread's machine. */
  | { at: 'missing'; client: boolean }
  /** Nothing here may look: a paired phone or a contact reads files but cannot search them. */
  | { at: 'unknown' };

export interface LinkContext {
  store: Store;
  threadId: string;
  /** The desktop switch that opens a file of this computer in its app rather than in Boite. */
  directLinks: boolean;
  /** Shows a picture or a video over the chat. */
  show(item: MediaItem): void;
}

/** A missing file may be written next; a found one stays found for a while. */
const MISSING_MS = 15_000;
const FOUND_MS = 60_000;
const checks = new WeakMap<Store, Map<string, { at: number; answer: Promise<Where> }>>();

function cwdOf(store: Store, threadId: string): string | undefined {
  return store.threads.find(thread => thread.id === threadId)?.cwd;
}

/** The machine's name as the sidebar shows it. */
function machineOf(store: Store): string {
  const machine = workspace.machines.find(item => item.store === store);
  return machine ? machineName(machine) : store.core?.hostname ?? '';
}

/**
 * Where a link's file is. A drive letter in a thread on Linux or macOS is
 * never the thread machine's, so only this computer is asked. Any other path
 * is asked of the thread's core first, which also finds a file named by its
 * tail; an absolute one it lacks may still be this computer's. Answers are
 * kept a moment for the chips that ask as they scroll in; a click asks again.
 */
export function locate(store: Store, threadId: string, written: string, fresh = false): Promise<Where> {
  const key = `${threadId}\n${written}`;
  let byStore = checks.get(store);
  if (!byStore) checks.set(store, byStore = new Map());
  const kept = byStore.get(key);
  if (kept && !fresh && Date.now() < kept.at) return kept.answer;
  const answer = find(store, threadId, written);
  const entry = { at: Number.POSITIVE_INFINITY, answer };
  byStore.set(key, entry);
  answer.then(where => { entry.at = Date.now() + (where.at === 'missing' ? MISSING_MS : FOUND_MS); }, () => byStore.delete(key));
  return answer;
}

async function find(store: Store, threadId: string, written: string): Promise<Where> {
  if (!store.owner) return { at: 'unknown' };
  if (!foreignPath(written, store.core?.os)) {
    const found = await store.locateFile(threadId, written);
    if (found.ok && found.value.length > 1) throw new Error(strings.artifacts.ambiguous(written, found.value.join(', ')));
    if (found.ok && found.value.length === 1) return { at: 'thread', path: found.value[0]! };
  }
  // The thread's machine is this computer: it has already answered.
  if (!desktopShell() || store.localCore || !absolutePath(written)) return { at: 'missing', client: false };
  const path = fullPath(written, null);
  const kind = await clientPathInfo(path).catch((): ClientPathKind => 'missing');
  return kind === 'missing' ? { at: 'missing', client: true } : { at: 'client', path, kind };
}

/** A notice the chat shows for a link it could not open: a title, the path, and Copy path. */
class FileNotice {
  current = $state<{ title: string; path: string; key: number } | null>(null);
  #key = 0;

  show(title: string, path: string): void {
    this.current = { title, path, key: ++this.#key };
  }

  dismiss(): void {
    this.current = null;
  }
}

export const fileNotice = new FileNotice();

/** Opens a file of this computer: a program only after the user said yes. */
async function openOnClient(path: string, kind: ClientPathKind): Promise<void> {
  if (kind === 'missing') return fileNotice.show(strings.chat.fileLink.notFoundHere, path);
  if (kind !== 'program') return openClientPath(path);
  const choice = await confirm.choose({
    title: fill(strings.chat.fileLink.launchTitle, { name: baseName(path) }),
    body: fill(strings.chat.fileLink.launchBody, { path }),
    confirmLabel: strings.chat.fileLink.launch,
    altLabel: strings.chat.fileLink.reveal,
    cancelLabel: strings.common.cancel,
    danger: true
  });
  if (choice === 'confirm') await openClientPath(path, true);
  else if (choice === 'alt') await revealClientPath(path);
}

const VIEWABLE = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;

/** A picture or a video of the project, read when the viewer opens. */
function mediaItem(ctx: LinkContext, path: string): MediaItem | null {
  const kind = fileKind(path);
  if (kind !== 'video' && !(kind === 'image' && VIEWABLE.test(path))) return null;
  const { store, threadId } = ctx;
  const load = async (): Promise<string> => {
    const read = await store.readFile(threadId, path);
    if (!read.ok) throw new Error(read.error);
    if (read.value.kind === 'text') throw new Error(strings.artifacts.mediaFailed);
    return read.value.url;
  };
  return { src: '', name: baseName(path), mimeType: kind === 'video' ? 'video/mp4' : 'image/png', kind, load };
}

/** A file of the thread's folder, shown in Boite: the viewer for media, else the panel. */
function showInProject(ctx: LinkContext, relative: string, line: number | undefined): void {
  const item = mediaItem(ctx, relative);
  if (item) return ctx.show(item);
  if (fileKind(relative) === 'folder') { ctx.store.panel.openFiles(relative.replace(/\/$/, '')); return; }
  ctx.store.panel.openFile(relative, line);
}

/** Where a missing file was looked for: this computer when it was, or the thread's runs here. */
function notFoundTitle(store: Store, client: boolean): string {
  return client || store.localCore ? strings.chat.fileLink.notFoundHere : fill(strings.chat.fileLink.notFoundOn, { machine: machineOf(store) });
}

/** A click on a chat file link, or the menu's Open. */
export async function openLink(ctx: LinkContext, written: string, line: number | undefined): Promise<void> {
  const { store, threadId } = ctx;
  const cwd = cwdOf(store, threadId);
  const where = await locate(store, threadId, written, true);
  if (where.at === 'client') return openOnClient(where.path, where.kind);
  if (where.at === 'missing') {
    return fileNotice.show(notFoundTitle(store, where.client), fullPath(written, foreignPath(written, store.core?.os) ? null : cwd));
  }
  const path = where.at === 'thread' ? where.path : written;
  const relative = cwd && !foreignPath(path, store.core?.os) ? relativeTo(cwd, path) : null;
  // The thread runs on this computer: a program asks first, the switch opens documents in their app,
  // and a file outside the project opens there too, since Boite's panel reads only the project.
  if (where.at === 'thread' && localFileDirectory(store, threadId)) {
    const full = fullPath(path, cwd);
    if (fileKind(path) === 'program' || ctx.directLinks || relative === null) return openOnClient(full, await clientPathInfo(full));
  }
  if (relative !== null) return showInProject(ctx, relative, line);
  const title = where.at === 'thread' ? fill(strings.chat.fileLink.outside, { machine: machineOf(store) }) : strings.chat.fileLink.elsewhere;
  fileNotice.show(title, fullPath(path, cwd));
}

/** Shows the file in its folder, on this computer: the thread's own when its core runs here. */
async function reveal(ctx: LinkContext, written: string): Promise<void> {
  const { store, threadId } = ctx;
  const where = await locate(store, threadId, written, true);
  if (where.at === 'client') return revealClientPath(where.path);
  if (where.at === 'thread' && store.localCore) return revealClientPath(fullPath(where.path, cwdOf(store, threadId)));
  fileNotice.show(notFoundTitle(store, where.at === 'missing' && where.client), fullPath(written, cwdOf(store, threadId)));
}

/** The path as it goes on the clipboard: the file the core found, whole, or relative to the project. */
async function copied(ctx: LinkContext, written: string, relative: boolean): Promise<string> {
  const { store, threadId } = ctx;
  const cwd = cwdOf(store, threadId);
  const where = await locate(store, threadId, written).catch((): Where => ({ at: 'unknown' }));
  const path = where.at === 'thread' ? where.path : written;
  if (foreignPath(path, store.core?.os)) return fullPath(path, null);
  const whole = fullPath(path, cwd);
  const inside = relative && cwd ? relativeTo(cwd, whole.replaceAll('\\', '/')) : null;
  return inside === null ? whole : cwd!.includes('\\') ? inside.replaceAll('/', '\\') : inside;
}

/**
 * A file link's menu, on a right click or a long press: Open, Show in folder
 * where this computer can reach the file, and the path whole or relative to the project.
 */
export function linkMenu(ctx: LinkContext, written: string, line: number | undefined, copy: (text: Promise<string>) => void, failed: (reason: unknown) => void): { items: MenuItem[]; pick(id: string): void } {
  const { store, threadId } = ctx;
  const cwd = cwdOf(store, threadId);
  const items: MenuItem[] = [{ id: 'open', label: strings.chat.openLink }];
  if (desktopShell() && store.owner && (store.localCore || absolutePath(written))) items.push({ id: 'reveal', label: strings.chat.fileLink.reveal });
  items.push({ id: 'copy', label: strings.chat.copyPath });
  const insideProject = !!cwd && !foreignPath(written, store.core?.os) && (!absolutePath(written) || relativeTo(cwd, written) !== null);
  if (insideProject) items.push({ id: 'copy-relative', label: strings.chat.fileLink.copyRelative });
  return {
    items,
    pick(id) {
      if (id === 'open') void openLink(ctx, written, line).catch(failed);
      else if (id === 'reveal') void reveal(ctx, written).catch(failed);
      else copy(copied(ctx, written, id === 'copy-relative'));
    }
  };
}

/**
 * Greys the chips of `node` whose file is nowhere to be found, each once it
 * scrolls near the screen, and marks the chips that share a name
 * (`collide`). Only the owner can look; a phone's chips stay as drawn.
 */
export function fileChecks(node: HTMLElement, read: () => { store?: Store; threadId?: string }): { destroy(): void } {
  const seen = new WeakSet<Element>();
  const look = (chip: HTMLElement): void => {
    const { store, threadId } = read();
    const written = chip.dataset.filePath;
    if (!store?.owner || !threadId || !written) return;
    void locate(store, threadId, written).then(where => {
      chip.toggleAttribute('data-missing', where.at === 'missing');
    }, () => chip.removeAttribute('data-missing'));
  };
  const near = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        near?.unobserve(entry.target);
        look(entry.target as HTMLElement);
      }
    }, { rootMargin: '200px' })
    : null;
  let frame = 0;
  const scan = (): void => {
    frame = 0;
    markCollisions(node);
    for (const chip of node.querySelectorAll<HTMLElement>('a.file-chip')) {
      if (seen.has(chip)) continue;
      seen.add(chip);
      if (near) near.observe(chip); else look(chip);
    }
  };
  const later = (): void => { if (!frame) frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(scan) : window.setTimeout(scan, 16); };
  const observer = new MutationObserver(later);
  observer.observe(node, { childList: true, subtree: true });
  scan();
  return {
    destroy() {
      observer.disconnect();
      near?.disconnect();
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      else if (frame) clearTimeout(frame);
    }
  };
}
