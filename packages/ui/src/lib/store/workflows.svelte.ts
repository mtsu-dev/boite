import { secureId } from '../secure-id';
import type { ProjectId, RpcEvents, ThreadId, WorkflowRun, WorkflowTemplate } from '@boite/contracts';
import type { Client } from '../client';
import type { StoreContext } from './context';

interface TemplateRead {
  client: Client;
  generation: number;
  navigation: number;
  threadId: ThreadId;
  projectId: ProjectId | null;
  /** A child's library belongs to its parent, whose project can differ from its checkout. */
  libraryProjectId: ProjectId | null | undefined;
  revision: number;
  values: WorkflowTemplate[] | null;
  promise: Promise<void> | null;
}

/** The workflow runs of the open thread's tree and its project's saved plans. */
export class Workflows {
  /** The workflow runs rooted at the open thread, or at its parent for a step, newest first. */
  workflows = $state<WorkflowRun[]>([]);
  /** The thread `workflows` was read for, so a list never shows under another thread. */
  workflowsThreadId = $state<ThreadId | null>(null);
  workflowTemplates = $state<WorkflowTemplate[]>([]);
  workflowsError = $state<string | null>(null);
  workflowsEpoch = 0;
  /** A burst of `workflows.changed` becomes one read: set while one is in flight. */
  workflowsReading: { threadId: ThreadId; client: Client; generation: number; navigation: number; again: boolean } | null = null;
  #templates: TemplateRead | null = null;

  constructor(private readonly ctx: StoreContext) {}

  reset(): void {
    this.disconnected();
    this.workflows = [];
    this.workflowsThreadId = null;
    this.workflowTemplates = [];
    this.workflowsError = null;
  }

  /** A reconnect must revalidate even when it reuses the same Client object. */
  disconnected(): void {
    this.workflowsEpoch++;
    this.workflowsReading = null;
    this.#templates = null;
  }

  #currentTemplates(entry: TemplateRead): boolean {
    const s = this.ctx.store;
    return this.#templates === entry && this.ctx.client === entry.client &&
      this.ctx.clientGeneration === entry.generation && s.navigationGeneration === entry.navigation &&
      s.connection === 'ready' && s.openThread?.id === entry.threadId && s.openThread.projectId === entry.projectId;
  }

  #invalidateTemplates(projectId?: ProjectId | null): boolean {
    const open = this.ctx.store.openThread;
    if (!open) return false;
    const entry = this.#templates;
    const current = entry && this.#currentTemplates(entry);
    const libraryProjectId = current ? entry.libraryProjectId : open.parentThreadId ? undefined : open.projectId;
    // An empty child's response cannot identify its parent library. Revalidate
    // template writes until a nonempty response does; run progress stays cached.
    if (projectId !== undefined && libraryProjectId !== undefined && libraryProjectId !== projectId) return false;
    if (current) {
      entry.revision++;
      entry.values = null;
    }
    return true;
  }

  /** One library per owning client/project visit; run progress never invalidates it. */
  #loadTemplates(threadId: ThreadId): Promise<void> {
    const s = this.ctx.store, client = this.ctx.client, thread = s.openThread;
    if (!client || !thread || thread.id !== threadId || s.connection !== 'ready') return Promise.resolve();
    let entry = this.#templates;
    if (!entry || !this.#currentTemplates(entry)) {
      this.workflowTemplates = [];
      entry = { client, generation: this.ctx.clientGeneration, navigation: s.navigationGeneration, threadId, projectId: thread.projectId,
        libraryProjectId: thread.parentThreadId ? undefined : thread.projectId, revision: 0, values: null, promise: null };
      this.#templates = entry;
    }
    if (entry.promise) return entry.promise;
    if (entry.values !== null) return Promise.resolve();
    const scope = entry;
    const promise = (async () => {
      do {
        const revision = scope.revision;
        const templates = await client.call('workflows.templates.list', { threadId });
        if (!this.#currentTemplates(scope)) return;
        // An invalidation during the read may name a write newer than its snapshot.
        if (revision !== scope.revision) continue;
        if (templates[0]) scope.libraryProjectId = templates[0].projectId;
        scope.values = templates;
        this.workflowTemplates = templates;
        return;
      } while (this.#currentTemplates(scope));
    })().then(() => {
      scope.promise = null;
      // An event may arrive between publishing the answer and settling its promise.
      if (this.#currentTemplates(scope) && scope.values === null) return this.#loadTemplates(threadId);
    }, error => {
      scope.promise = null;
      throw error;
    });
    scope.promise = promise;
    return promise;
  }

  changed({ threadId, runId, templatesProjectId }: RpcEvents['workflows.changed']): void {
    const s = this.ctx.store, open = s.openThread;
    if (templatesProjectId !== undefined) {
      if (this.#invalidateTemplates(templatesProjectId) && open) {
        const client = this.ctx.client, navigation = s.navigationGeneration, epoch = this.workflowsEpoch;
        void this.#loadTemplates(open.id).catch(error => {
          if (client === this.ctx.client && navigation === s.navigationGeneration && epoch === this.workflowsEpoch) this.workflowsError = this.ctx.reason(error);
        });
      }
      return;
    }
    if (!open || (threadId !== open.id && threadId !== open.parentThreadId)) return;
    // Older cores announce template writes with an empty run id on the root.
    if (runId === '') this.#invalidateTemplates();
    void s.loadWorkflows(open.id);
  }

  /**
   * The runs and the project's templates for this thread. Events arrive once
   * per saved step, so a read already in flight for the same thread is marked
   * to go again rather than joined by a second one.
   */
  async loadWorkflows(threadId = this.ctx.store.openThread?.id): Promise<void> {
    const s = this.ctx.store;
    const client = this.ctx.client;
    // A machine that dropped is not asked. The read is tracked on purpose: the
    // effects that call this only load, so they run again once the machine is back.
    if (!client || !threadId || s.openThread?.id !== threadId || s.connection !== 'ready') return;
    const generation = this.ctx.clientGeneration, navigation = s.navigationGeneration;
    const reading = this.workflowsReading;
    if (reading?.threadId === threadId && reading.client === client && reading.generation === generation && reading.navigation === navigation) {
      reading.again = true;
      return;
    }
    const epoch = ++this.workflowsEpoch;
    const entry = { threadId, client, generation, navigation, again: false };
    this.workflowsReading = entry;
    const current = () => this.ctx.client === client && this.ctx.clientGeneration === generation && s.navigationGeneration === navigation &&
      s.connection === 'ready' && s.openThread?.id === threadId && this.workflowsEpoch === epoch;
    try {
      do {
        entry.again = false;
        const [runs] = await Promise.all([
          client.call('workflows.list', { threadId }),
          this.#loadTemplates(threadId)
        ]);
        if (!current()) return;
        if (this.workflowsThreadId !== threadId) this.workflowsError = null;
        this.workflows = runs;
        this.workflowsThreadId = threadId;
      } while (entry.again && current());
    } catch (error) {
      if (current()) this.workflowsError = this.ctx.reason(error);
    } finally {
      if (this.workflowsReading === entry) this.workflowsReading = null;
    }
  }

  /** The runs of `threadId`'s tree, empty while the list was read for another thread. */
  workflowsOf(threadId: ThreadId): WorkflowRun[] {
    return this.workflowsThreadId === threadId ? this.workflows : [];
  }

  isWorkflowStep(threadId: ThreadId): boolean {
    return this.workflows.some(run => run.nodes.some(node => node.instances.some(inst => inst.threadId === threadId)));
  }

  /** Pause, resume, stop or retry, sent as the run's root: the core refuses a step thread. */
  async controlWorkflow(run: WorkflowRun, action: 'pause' | 'resume' | 'stop' | 'retry', stepId?: string): Promise<boolean> {
    const client = this.ctx.client;
    if (!client) return false;
    this.workflowsError = null;
    try {
      const next = await client.call('workflows.control', { threadId: run.rootThreadId, runId: run.id, action, ...(stepId ? { stepId } : {}) });
      if (client === this.ctx.client) this.workflows = this.workflows.map(one => one.id === next.id ? next : one);
      return true;
    } catch (error) {
      if (client === this.ctx.client) this.workflowsError = this.ctx.reason(error);
      return false;
    }
  }

  /** Starts a saved plan on the open thread, or on its parent when a step is open. */
  async startWorkflowTemplate(template: WorkflowTemplate): Promise<WorkflowRun | null> {
    const s = this.ctx.store;
    const client = this.ctx.client;
    const thread = s.openThread;
    if (!client || !thread || !s.owner) return null;
    this.workflowsError = null;
    try {
      const run = await client.call('workflows.start', { threadId: thread.parentThreadId ?? thread.id, plan: template.plan, templateId: template.id, requestId: secureId() });
      if (client === this.ctx.client && s.openThread?.id === thread.id) await s.loadWorkflows(thread.id);
      return run;
    } catch (error) {
      if (client === this.ctx.client) this.workflowsError = this.ctx.reason(error);
      return null;
    }
  }

  async saveWorkflowTemplate(run: WorkflowRun, name: string): Promise<WorkflowTemplate | null> {
    const s = this.ctx.store;
    const client = this.ctx.client;
    if (!client || !s.owner || !name.trim()) return null;
    this.workflowsError = null;
    try {
      const template = await client.call('workflows.templates.save', { threadId: run.rootThreadId, name: name.trim(), plan: run.plan });
      if (client === this.ctx.client) {
        if (this.#invalidateTemplates(template.projectId) && s.openThread) await this.#loadTemplates(s.openThread.id);
      }
      return template;
    } catch (error) {
      if (client === this.ctx.client) this.workflowsError = this.ctx.reason(error);
      return null;
    }
  }

  async removeWorkflowTemplate(template: WorkflowTemplate): Promise<void> {
    const s = this.ctx.store;
    const client = this.ctx.client;
    const threadId = s.openThread?.id;
    if (!client || !threadId || !s.owner) return;
    this.workflowsError = null;
    try {
      await client.call('workflows.templates.remove', { threadId, templateId: template.id });
      if (client === this.ctx.client) {
        if (this.#invalidateTemplates(template.projectId) && s.openThread) await this.#loadTemplates(s.openThread.id);
      }
    } catch (error) {
      if (client === this.ctx.client) this.workflowsError = this.ctx.reason(error);
    }
  }
}
