import type {
  AgentTask,
  ArtifactContent,
  KeepAwakeStatus,
  MemoryEvent,
  MemoryState,
  MemoryStatus,
  FileContent,
  FileEntry,
  GitDiff,
  GitOutsideRepository,
  GitStatus,
  ProcessRecord,
  ProjectId,
  RpcMethodName,
  RpcParams,
  RpcResult,
  ThreadId,
  ThreadResources,
  Todo
} from '@boite/contracts';
import { RpcErrorCode, TRACE_LIMIT } from '@boite/contracts';
import { untrack } from 'svelte';
import { strings } from '../strings';
import { RpcFailure } from '../rpc-error';
import { coreHref } from '../endpoint';
import { titleFrom } from '../format';
import type { FileAnswer } from '../store.svelte';
import type { StoreContext } from './context';

/** A pid alone is reused by the OS, so a trace row is a pid and its start. */
export function sameProcess(a: ProcessRecord, b: ProcessRecord): boolean {
  return a.pid === b.pid && a.startedAt === b.startedAt;
}

/**
 * The workbench: the open thread's trace, its working tree, its files, the
 * project's todos and the machine's resources. A paired device reads the
 * working tree and its files (`DEVICE_METHODS`); everything else here, and
 * every write, is owner-only in `packages/core/src/access.ts`, so it is gated
 * on `store.owner` the way `trace.get` is rather than thrown at a phone.
 *
 * The three `files.*` calls answer a `FileAnswer` rather than raising the
 * app's toast: a refused path or a file that vanished under the editor is
 * about the surface that asked, so it reads in that surface.
 */
export class Workbench {
  memory = $state.raw<MemoryStatus | null>(null);
  memoryState = $state<MemoryState | null>(null);
  /**
   * The last process the memory guard stopped, until the user puts its notice
   * away (`MemoryCorner`): a stop in a thread nobody is looking at is still
   * news about the machine.
   */
  memoryStop = $state.raw<MemoryEvent | null>(null);
  /** Whether the machine is held awake and can be; null until read, or from a core without `resources.keepAwake`. */
  keepAwake = $state.raw<KeepAwakeStatus | null>(null);
  private memoryRevision = 0;
  private memoryRead = 0;

  resetMemory(): void {
    this.memoryRead++;
    this.memoryRevision++;
    this.memory = null;
    this.memoryState = null;
    this.memoryStop = null;
    this.keepAwake = null;
  }

  memoryEvent(event: MemoryEvent): void {
    this.memoryRevision++;
    this.memoryState = event.state;
    if (event.kind === 'killed') this.memoryStop = event;
  }

  dismissMemoryStop(): void {
    this.memoryStop = null;
  }

  /** Quiet on failure: an older core has no such method, and the switch then says nothing. */
  async refreshKeepAwake(): Promise<void> {
    const client = this.ctx.client;
    const clientGeneration = this.ctx.clientGeneration;
    if (!client || !this.ctx.store.owner) return;
    try {
      const status = await client.call('resources.keepAwake', {});
      if (this.ctx.currentClient(client, clientGeneration)) this.keepAwake = status;
    } catch {
      if (this.ctx.currentClient(client, clientGeneration)) this.keepAwake = null;
    }
  }

  async refreshMemory(): Promise<void> {
    const client = this.ctx.client;
    if (!client || !this.ctx.store.owner) return;
    const read = ++this.memoryRead;
    const revision = this.memoryRevision;
    try {
      const memory = await client.call('resources.memoryStatus', {});
      if (client !== this.ctx.client || read !== this.memoryRead) return;
      this.memory = memory;
      if (revision === this.memoryRevision) {
        this.memoryState = memory.state;
      }
    } catch (error) {
      if (client === this.ctx.client && read === this.memoryRead) this.ctx.fail(error);
    }
  }

  resources = $state<ThreadResources[]>([]);
  /** Replaced whole, never changed in place: no proxy over every record. */
  trace = $state.raw<ProcessRecord[]>([]);
  /**
   * The todo cards of each project, keyed by project id: the list is the
   * project's, so every thread of it shows the same one.
   */
  todos = $state<Record<ProjectId, Todo[]>>({});
  /** The thread `trace` belongs to, and whether the trace surface is on screen to read it. */
  tracedThreadId: ThreadId | null = null;
  traceWatched = false;
  private traceRead = 0;

  constructor(private readonly ctx: StoreContext) {}

  async refreshTrace(): Promise<void> {
    const s = this.ctx.store;
    const client = this.ctx.client;
    const open = s.openThread;
    // Owner-only, like the surface it draws.
    if (!client || !open || !s.owner) return;
    const read = ++this.traceRead;
    const navigation = this.ctx.threads.openGeneration;
    const baseline = untrack(() => [...this.trace]);
    const current = () => read === this.traceRead && this.ctx.currentNavigation(client, navigation) && s.openThread?.id === open.id;
    try {
      const snapshot = await client.call('trace.get', { threadId: open.id });
      if (!current()) return;
      const changed = this.trace.filter(record => baseline.find(previous => sameProcess(previous, record)) !== record);
      // Events that came during the read stay ahead of it, within the same bound.
      this.trace = [...changed, ...snapshot.filter(record => !changed.some(newer => sameProcess(newer, record)))].slice(0, TRACE_LIMIT);
    } catch (error) {
      if (current()) this.ctx.fail(error);
    }
  }

  /** The project of a thread, open or not: what keys the todo list. */
  #projectOf(threadId: ThreadId): ProjectId | null {
    const s = this.ctx.store;
    if (s.openThread?.id === threadId) return s.openThread.projectId;
    return s.threads.find((thread) => thread.id === threadId)?.projectId ?? null;
  }

  /** File and Git surfaces get their own error instead of a toast. */
  async #fileCall<M extends RpcMethodName>(
    method: M,
    params: RpcParams<M>,
    reject: (error: unknown) => Extract<FileAnswer<never>, { ok: false }> = error => ({ ok: false, error: this.ctx.reason(error) }),
    map: (value: RpcResult<M>) => RpcResult<M> = value => value
  ): Promise<FileAnswer<RpcResult<M>>> {
    const client = this.ctx.client;
    const clientGeneration = this.ctx.clientGeneration;
    if (!client) return { ok: false, error: strings.errors.noEndpoint };
    try {
      const value = await client.call(method, params);
      if (!this.ctx.currentClient(client, clientGeneration)) return { ok: false, error: strings.errors.noEndpoint };
      return { ok: true, value: map(value) };
    } catch (error) {
      return reject(error);
    }
  }

  gitStatus(threadId: ThreadId): Promise<FileAnswer<GitStatus>> {
    return this.#fileCall('git.status', { threadId }, this.#gitReadError);
  }

  /** `oldPath` is the origin `git.status` gave the path, null for none; undefined lets the core ask git. */
  gitDiff(threadId: ThreadId, path: string, ref?: string, oldPath?: string | null): Promise<FileAnswer<GitDiff>> {
    return this.#fileCall('git.diff', { threadId, path, ...(ref === undefined ? {} : { ref }), ...(oldPath === undefined ? {} : { oldPath }) }, this.#gitReadError);
  }

  #gitReadError = (error: unknown): { ok: false; error: string } => {
    const outside = error instanceof RpcFailure && (error.data as Partial<GitOutsideRepository> | undefined)?.reason === 'not-a-repository';
    return { ok: false, error: outside ? strings.changes.outsideRepository : this.ctx.reason(error) };
  };

  listFiles(threadId: ThreadId, path?: string): Promise<FileAnswer<FileEntry[]>> {
    return this.#fileCall('files.list', { threadId, ...(path === undefined ? {} : { path }) }, error => {
      const inaccessible = error instanceof RpcFailure && [RpcErrorCode.NotFound, RpcErrorCode.Refused, RpcErrorCode.Unauthorized].some(code => code === error.code);
      return { ok: false, error: this.ctx.reason(error), ...(inaccessible ? { inaccessible: true as const } : {}) };
    });
  }

  /** The files a chat link names in the thread's directory: `files.locate`. */
  locateFile(threadId: ThreadId, path: string): Promise<FileAnswer<string[]>> {
    return this.#fileCall('files.locate', { threadId, path });
  }

  readFile(threadId: ThreadId, path: string): Promise<FileAnswer<FileContent>> {
    return this.#fileCall('files.read', { threadId, path }, undefined, value => {
      // The core answers a path on its own HTTP server: the origin is the one
      // this client reached it by, which a core cannot know from where it runs.
      const endpoint = this.ctx.store.endpointUrl;
      return value.kind !== 'text' && value.url.startsWith('/') && endpoint !== null
        ? { ...value, url: coreHref(endpoint, value.url) }
        : value;
    });
  }

  /** `view` asks for the address a published view opens as a page at, which a frame loads; without it the address downloads. */
  async readArtifact(threadId: ThreadId, messageId: string, artifactId: string, renew?: string, view = false, previewMax?: RpcParams<'artifacts.read'>['previewMax']): Promise<FileAnswer<ArtifactContent>> {
    const client = this.ctx.client;
    if (!client) return { ok: false, error: strings.artifacts.failed };
    try {
      const value = await client.call('artifacts.read', { threadId, messageId, artifactId, ...(renew ? { renew } : {}), ...(view ? { view: true as const } : {}), ...(previewMax ? { previewMax } : {}) });
      const endpoint = this.ctx.store.endpointUrl;
      return { ok: true, value: { ...value, url: value.url.startsWith('/') && endpoint ? coreHref(endpoint, value.url) : value.url } };
    } catch (error) { return { ok: false, error: this.ctx.reason(error) }; }
  }

  /** The address a ```view block of an answer opens at as a page, which a frame loads. */
  async viewBlock(html: string): Promise<FileAnswer<string>> {
    const client = this.ctx.client;
    if (!client) return { ok: false, error: strings.errors.noEndpoint };
    try {
      const { url } = await client.call('artifacts.viewBlock', { html });
      const endpoint = this.ctx.store.endpointUrl;
      return { ok: true, value: url.startsWith('/') && endpoint ? coreHref(endpoint, url) : url };
    } catch (error) { return { ok: false, error: this.ctx.reason(error) }; }
  }

  /** The editor's save. The bytes that reached the disk, or why they did not. */
  async writeFile(
    threadId: ThreadId,
    path: string,
    text: string
  ): Promise<FileAnswer<{ bytes: number; modifiedAt: number }>> {
    if (!this.ctx.client || !this.ctx.store.owner) return { ok: false, error: strings.rightPanel.ownerOnly };
    return this.#fileCall('files.write', { threadId, path, text });
  }

  /** The agent's task list, whole. The answer arrives as `thread.activity` too. */
  async setTasks(threadId: ThreadId, tasks: AgentTask[]): Promise<void> {
    const s = this.ctx.store;
    if (!s.owner) return;
    return this.ctx.command('threads.tasks.set', { threadId, tasks }, activity => {
      if (s.openThread?.id === threadId) s.openThread.activity = activity;
    });
  }

  /** The owner's, and a paired device's once its core serves the project board. */
  #mayTodos(): boolean {
    return this.ctx.store.owner || this.ctx.store.core?.features?.projectBoard === true;
  }

  async loadTodos(threadId: ThreadId): Promise<void> {
    const client = this.ctx.client;
    const clientGeneration = this.ctx.clientGeneration;
    if (!client || !this.#mayTodos()) return;
    try {
      const project = this.#projectOf(threadId);
      const todos = await client.call('todos.list', { threadId });
      // The list keys on the project, which an empty answer does not carry.
      if (!this.ctx.currentClient(client, clientGeneration)) return;
      const projectId = todos[0]?.projectId ?? project;
      if (projectId === null) return;
      this.todos = { ...this.todos, [projectId]: todos };
    } catch (error) {
      if (this.ctx.currentClient(client, clientGeneration)) this.ctx.fail(error);
    }
  }

  /** Stops one pull request watch; the thread's row and panel follow from `thread.updated`. A phone may too. */
  unwatchPullRequest(threadId: ThreadId, url: string): Promise<void> {
    return this.ctx.command('threads.unwatchPullRequest', { threadId, url });
  }

  async addTodo(threadId: ThreadId, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!this.#mayTodos() || !trimmed) return;
    return this.ctx.command('todos.add', { threadId, text: trimmed });
  }

  async updateTodo(
    threadId: ThreadId,
    todoId: string,
    patch: { status?: Todo['status']; text?: string; goalThreadId?: ThreadId | null }
  ): Promise<void> {
    if (!this.#mayTodos()) return;
    return this.ctx.command('todos.update', { threadId, todoId, ...patch });
  }

  async removeTodo(threadId: ThreadId, todoId: string): Promise<void> {
    if (!this.#mayTodos()) return;
    return this.ctx.command('todos.remove', { threadId, todoId });
  }

  /**
   * A card put in progress on the board: a new conversation of its project, on
   * the agent, account, model and mode of the thread the board is open in, and
   * in a worktree of its own when that thread has one, works on the card as a
   * `/goal2`. The card links it first, so the goal's first change reaches the board.
   */
  async startCardGoal(threadId: ThreadId, todo: Todo): Promise<ThreadId | null> {
    const s = this.ctx.store;
    const client = this.ctx.client;
    const clientGeneration = this.ctx.clientGeneration;
    const from = s.openThread?.id === threadId ? s.openThread : s.threads.find((thread) => thread.id === threadId);
    if (!client || !from?.projectId || !this.#mayTodos()) return null;
    const created = await s.createThread({
      projectId: from.projectId,
      providerId: from.providerId,
      accountId: from.accountId,
      permissionMode: from.permissionMode,
      effort: from.effort,
      speed: from.speed ?? null,
      ...(from.model ? { model: from.model } : {}),
      ...(from.branch ? { worktree: {} } : {}),
      title: titleFrom(todo.text) || undefined
    }, { navigate: false });
    if (!created || !this.ctx.currentClient(client, clientGeneration)) return null;
    try {
      await client.call('todos.update', { threadId, todoId: todo.id, status: 'open', goalThreadId: created.id });
    } catch (error) {
      // Another device put the card in progress first, or the card went: its conversation works, this empty one goes.
      if (this.ctx.currentClient(client, clientGeneration)) {
        void s.removeThread(created.id);
        this.ctx.fail(error);
      }
      return null;
    }
    return await this.resumeCardGoal(threadId, { ...todo, goalThreadId: created.id }) ? created.id : null;
  }

  /** The `/goal2` of a card's linked conversation, set again: after a start cut short, or a goal removed there. */
  async resumeCardGoal(threadId: ThreadId, todo: Todo): Promise<boolean> {
    const client = this.ctx.client;
    const clientGeneration = this.ctx.clientGeneration;
    if (!client || !todo.goalThreadId || !this.#mayTodos()) return false;
    try {
      await client.call('threads.activity.set', { threadId: todo.goalThreadId, goal: { objective: todo.text, review: true } });
      return true;
    } catch (error) {
      if (this.ctx.currentClient(client, clientGeneration)) this.ctx.fail(error);
      return false;
    }
  }

  async refreshResources(): Promise<void> {
    const client = this.ctx.client;
    const clientGeneration = this.ctx.clientGeneration;
    if (!client || !this.ctx.store.owner) return;
    try {
      const [resources] = await Promise.all([client.call('resources.list', {}), this.refreshMemory(), this.refreshKeepAwake()]);
      if (this.ctx.currentClient(client, clientGeneration)) this.resources = resources;
    } catch (error) {
      if (this.ctx.currentClient(client, clientGeneration)) this.ctx.fail(error);
    }
  }

  killTree(threadId: ThreadId): Promise<void> {
    return this.ctx.command('resources.killTree', { threadId }, () => this.ctx.store.refreshResources());
  }
}
