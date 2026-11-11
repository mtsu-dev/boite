import { RpcErrorCode, type Message, type MessageId, type Thread, type ThreadId } from '@boite/contracts';
import { RpcFailure } from '../client';
import { strings } from '../strings';
import type { ToolPart } from '../tool-groups';
import type { StoreContext } from './context';
import { fullMessage } from './full-message';

/** Where a fetched part lands: every copy of the thread the client holds. */
interface Snapshots {
  threadSnapshots(threadId: ThreadId): Thread[];
  messages(threadId: ThreadId, messageId: string): Message[];
}

export interface ToolDisclosure {
  ready: Promise<void>;
  refresh(): Promise<void>;
  release(): void;
}

interface ToolConsumers {
  users: Set<symbol>;
  restore: (() => void)[];
  legacy: boolean;
}

/**
 * What a page leaves folded on the core until the reader opens it: a call's
 * output (its input and documents too on a core with `deferredToolParts`) and
 * an attachment's bytes. Duplicate requests share one fetch. Disclosures pin
 * fetched tool fields until their last body closes; leaving the thread also
 * invalidates pending reads from the old visit.
 */
export class DeferredParts {
  #visit = 0;

  constructor(private readonly ctx: StoreContext, private readonly threads: Snapshots) {}

  leave(): void {
    this.#visit++;
    for (const held of this.#toolConsumers.values()) this.#restore(held);
    this.#toolConsumers.clear();
  }

  readonly #toolConsumers = new Map<string, ToolConsumers>();

  #consumers(key: string): ToolConsumers {
    let held = this.#toolConsumers.get(key);
    if (!held) { held = { users: new Set(), restore: [], legacy: false }; this.#toolConsumers.set(key, held); }
    return held;
  }

  #restore(held: ToolConsumers): void {
    for (const restore of held.restore.splice(0)) restore();
  }

  /** A body owns fetched fields until closing/unmount. `load=false` pins an existing diff without fetching an unrelated deferred output. */
  acquireToolOutput(threadId: ThreadId, messageId: MessageId, toolId: string, load = true): ToolDisclosure {
    const key = JSON.stringify([threadId, messageId, toolId]);
    const consumers = this.#consumers(key), user = Symbol();
    consumers.users.add(user);
    const refresh = () => {
      if (!consumers.users.has(user) || this.#toolConsumers.get(key) !== consumers) return Promise.resolve();
      const needsFetch = this.threads.messages(threadId, messageId).some(message => message.parts.some(part =>
        part.type === 'tool' && part.toolId === toolId && (part.inputDeferred || part.documentsDeferred || (part.outputDeferred && part.status !== 'running'))));
      return needsFetch ? this.#readToolOutput(threadId, messageId, toolId, consumers) : Promise.resolve();
    };
    return { ready: load ? refresh() : Promise.resolve(), refresh, release: () => {
      if (!consumers.users.delete(user) || this.#toolConsumers.get(key) !== consumers || consumers.users.size > 0 || consumers.legacy) return;
      this.#restore(consumers);
      // A quick reopen shares the pending request, whose result checks its owners.
      if (!this.#toolOutputs.has(key)) this.#toolConsumers.delete(key);
    } };
  }

  #hydrate(part: ToolPart, full: Partial<ToolPart>, held: ToolConsumers): void {
    if (part.outputDeferred && full.output !== undefined) {
      const before = part.output, fetched = full.output;
      part.output = fetched; delete part.outputDeferred;
      held.restore.push(() => {
        if (part.status !== 'running' && part.output === fetched && !part.outputDeferred) { part.output = before; part.outputDeferred = true; }
      });
    }
    if (part.inputDeferred && 'input' in full) {
      const before = part.input;
      part.input = full.input; delete part.inputDeferred;
      // Read after assignment: a reactive Store wraps objects in a proxy.
      const fetched = part.input;
      held.restore.push(() => {
        if (part.status !== 'running' && part.input === fetched && !part.inputDeferred) { part.input = before; part.inputDeferred = true; }
      });
    }
    if (part.documentsDeferred && full.documents !== undefined) {
      const before = part.documents;
      part.documents = full.documents; delete part.documentsDeferred;
      const fetched = part.documents;
      held.restore.push(() => {
        if (part.status !== 'running' && part.documents === fetched && !part.documentsDeferred) { part.documents = before; part.documentsDeferred = true; }
      });
    }
  }

  readonly #toolOutputs = new Map<string, { client: NonNullable<StoreContext['client']>; generation: number; promise: Promise<void> }>();
  /**
   * Hydrate only a card the reader opened, shared by duplicate requests: its
   * output, and on a core with `deferredToolParts` its input and documents.
   */
  toolOutput(threadId: ThreadId, messageId: MessageId, toolId: string): Promise<void> {
    const consumers = this.#consumers(JSON.stringify([threadId, messageId, toolId]));
    // Callers without a release API (e.g. ExitPlanMode) own their response for
    // the visit. Lifecycle readers use refresh(), never this compatibility pin.
    consumers.legacy = true;
    return this.#readToolOutput(threadId, messageId, toolId, consumers);
  }

  #readToolOutput(threadId: ThreadId, messageId: MessageId, toolId: string, consumers: ToolConsumers): Promise<void> {
    const key = JSON.stringify([threadId, messageId, toolId]);
    const client = this.ctx.client;
    if (!client) return Promise.reject(new Error(strings.connection.unavailable));
    const generation = this.#visit;
    const held = this.#toolOutputs.get(key);
    if (held?.client === client && held.generation === generation) return held.promise;
    const whole = this.ctx.store.core?.features?.deferredToolParts === true;
    const read = whole
      ? client.call('messages.toolPart', { threadId, messageId, toolId }).then(({ part }) => part as Partial<ToolPart>)
      : client.call('messages.toolOutput', { threadId, messageId, toolId }).then(({ output }): Partial<ToolPart> => ({ output }));
    const loading = read.catch(async (error): Promise<Partial<ToolPart> | null> => {
      if (!(error instanceof RpcFailure) || error.code !== RpcErrorCode.MethodNotFound) throw error;
      if (this.ctx.client !== client || generation !== this.#visit) return null;
      const message = await fullMessage(client, this.threads.threadSnapshots(threadId), threadId, messageId, () => this.ctx.client === client && generation === this.#visit);
      // A visit left during the walk is not a missing tool: nobody shows that card any more.
      if (this.ctx.client !== client || generation !== this.#visit) return null;
      const part = message?.parts.find(part => part.type === 'tool' && part.toolId === toolId);
      if (part?.type !== 'tool') throw new RpcFailure({ code: RpcErrorCode.NotFound, message: `tool ${toolId} is not a tool of message ${messageId}` });
      return part;
    }).then(full => {
      if (!full || this.ctx.client !== client || generation !== this.#visit) return;
      if (!consumers.legacy && consumers.users.size === 0) return;
      for (const message of this.threads.messages(threadId, messageId)) {
        for (const part of message.parts) {
          if (part.type !== 'tool' || part.toolId !== toolId) continue;
          this.#hydrate(part, full, consumers);
        }
      }
    }).finally(() => {
      if (this.#toolOutputs.get(key)?.promise === loading) this.#toolOutputs.delete(key);
      if (!this.#toolOutputs.has(key) && !consumers.legacy && consumers.users.size === 0 && this.#toolConsumers.get(key) === consumers) this.#toolConsumers.delete(key);
    });
    this.#toolOutputs.set(key, { client, generation, promise: loading });
    return loading;
  }

  readonly #attachments = new Map<string, { client: NonNullable<StoreContext['client']>; visit: number; promise: Promise<string | null> }>();

  /** Share duplicate downloads; null cancels a visit that no longer wants the bytes. */
  attachment(threadId: ThreadId, messageId: string, partIndex: number): Promise<string | null> {
    const client = this.ctx.client;
    if (!client) return Promise.reject(new Error(strings.connection.unavailable));
    const visit = this.#visit, generation = this.ctx.clientGeneration;
    const key = JSON.stringify([threadId, messageId, partIndex]);
    const held = this.#attachments.get(key);
    if (held?.client === client && held.visit === visit) return held.promise;
    const promise = client.call('messages.attachment', { threadId, messageId, partIndex }).catch(async error => {
      if (!(error instanceof RpcFailure) || error.code !== RpcErrorCode.MethodNotFound) throw error;
      const message = await fullMessage(client, this.threads.threadSnapshots(threadId), threadId, messageId, () => this.ctx.client === client && visit === this.#visit);
      // Leaving during the fallback walk cancels the download, just like a tool disclosure.
      if (!this.ctx.currentClient(client, generation) || visit !== this.#visit) return null;
      const part = message?.parts[partIndex];
      if (part?.type !== 'file' && part?.type !== 'image') throw new RpcFailure({ code: RpcErrorCode.NotFound, message: `part ${partIndex} is not an attachment of message ${messageId}` });
      return { data: part.data };
    }).then(full => {
      if (!full || !this.ctx.currentClient(client, generation) || this.#visit !== visit) return null;
      const { data } = full;
      for (const message of this.threads.messages(threadId, messageId)) {
        const part = message.parts[partIndex];
        if ((part?.type === 'file' || part?.type === 'image') && part.dataDeferred) { part.data = data; delete part.dataDeferred; }
      }
      return data;
    }).finally(() => { if (this.#attachments.get(key)?.promise === promise) this.#attachments.delete(key); });
    this.#attachments.set(key, { client, visit, promise });
    return promise;
  }
}
