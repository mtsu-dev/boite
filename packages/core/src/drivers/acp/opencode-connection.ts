/**
 * OpenCode 2's ACP command owns an inaccessible private server and rejects a
 * second prompt. Own the same native server here so follow-ups use its inbox
 * with delivery=steer while the original execution keeps running.
 */
import { createInterface } from 'node:readline';
import type { ClientContext, ContentBlock, PromptResponse, SessionNotification } from '@agentclientprotocol/sdk/unstable';
import type { SpawnedChild } from '../../procs.ts';
import type { AcpTurn } from './turn.ts';
import { object, text, OpenCodeControls } from './opencode-controls.ts';
import { messageOf } from '../../errors.ts';
import { openCodeContent } from './opencode-content.ts';
import { answerOpenCodeForm } from './opencode-forms.ts';
import type { PermissionTicket } from '../types.ts';
import { EXIT_GRACE_MS } from '../exit.ts';

type Pending = {
  resolve(response: PromptResponse): void;
  reject(error: unknown): void;
  admitted: boolean;
  cancelSent: boolean;
  output: Promise<void>;
  buffered: number;
  awaitingInbox: Set<string>;
  earlyInbox: Set<string> | null;
  receivedTerminal: boolean;
};
type Notify = (notification: SessionNotification) => void;
type Terminal = { stopReason: 'end_turn' | 'cancelled'; error?: string };
const EVENT_LIMIT = 16 * 1024 * 1024;

function sessionCost(session: Record<string, unknown>): number | null {
  const cost = session['cost'];
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null;
}

export class OpenCodeConnection {
  readonly agent: ClientContext;
  readonly #abort = new AbortController();
  readonly #controls: OpenCodeControls;
  readonly #tools = new Map<string, { name: string; input: unknown }>();
  #sessionId = '';
  #sessionCost: number | null = null;
  #pending: Pending | null = null;
  #tokens = { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, totalTokens: 0 };
  #lastTokens = 0;
  #compacting = false;
  #inputCommitted: Promise<void> | null = null;
  #commitInput: (() => void) | null = null;
  readonly #permissions = new Map<string, PermissionTicket>();
  readonly #children = new Set<string>();
  readonly #inbox = new Set<string>();
  #deferredTerminal: Terminal | null = null;

  readonly #url: string;
  readonly #authorization: string;
  readonly #notify: Notify;
  readonly #current: () => AcpTurn | null;

  private constructor(url: string, authorization: string, cwd: string, notify: Notify, current: () => AcpTurn | null) {
    this.#url = url; this.#authorization = authorization; this.#notify = notify; this.#current = current;
    this.#controls = new OpenCodeControls(this.#call.bind(this), cwd);
    // The session uses only these two methods. ACP stays the internal control
    // vocabulary; the network boundary below is OpenCode's documented HTTP API.
    this.agent = { request: this.#request.bind(this), notify: this.#notification.bind(this) } as unknown as ClientContext;
  }

  static async open(child: SpawnedChild, password: string, cwd: string, notify: Notify, current: () => AcpTurn | null): Promise<OpenCodeConnection> {
    const url = await new Promise<string>((resolve, reject) => {
      const lines = createInterface({ input: child.stdout });
      const timer = setTimeout(() => finish(new Error('OpenCode serve did not report its loopback URL within 15 seconds')), 15_000);
      const failed = () => finish(new Error('OpenCode serve exited before reporting its loopback URL'));
      const finish = (error?: Error, url?: string) => {
        clearTimeout(timer); lines.close(); child.off('exit', failed); child.off('error', failed);
        if (error) reject(error); else resolve(url!);
      };
      child.once('exit', failed); child.once('error', failed);
      lines.once('line', line => {
        try {
          const url = new URL(text(object(JSON.parse(line))['url']));
          if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) throw new Error('expected an http://127.0.0.1 URL');
          finish(undefined, url.origin);
        } catch { finish(new Error('OpenCode serve readiness must contain an http://127.0.0.1 URL')); }
      });
    });
    const bridge = new OpenCodeConnection(url, `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`, cwd, notify, current);
    try { await bridge.#subscribe(); } catch (error) { bridge.close(); throw error; }
    return bridge;
  }

  close(): void {
    this.#commitInput?.();
    this.#abort.abort();
    for (const ticket of this.#permissions.values()) ticket.withdraw();
    this.#permissions.clear();
    this.#pending?.reject(new Error('OpenCode connection closed'));
    this.#pending = null;
  }

  /**
   * The session's actual model, `provider/model`, and the window OpenCode
   * compacts it against: an empty model and 0 until the session is read.
   */
  compactionModel(): { model: string; window: number } {
    return { model: this.#controls.currentModel(), window: this.#controls.compactionWindow() };
  }

  get sessionCost(): number | null { return this.#sessionCost; }

  async readSessionCost(turn: AcpTurn): Promise<number | null> {
    try {
      const session = object(object(await this.#call(this.#path(), 'GET', undefined, AbortSignal.timeout(EXIT_GRACE_MS)))['data']);
      return sessionCost(session);
    } catch (error) {
      if (!this.#abort.signal.aborted) turn.ctx.log('warn', `OpenCode session cost could not be read: ${messageOf(error)}`);
      return null;
    }
  }

  async steer(prompt: ContentBlock[], onAccepted?: () => void, signal?: AbortSignal): Promise<boolean> {
    const pending = this.#pending;
    if (!pending || this.#inputCommitted || !this.#current() || this.#current()?.isStopped) return false;
    await this.#submit(pending, prompt, false, onAccepted, signal);
    return true;
  }

  async #call(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(`${this.#url}${path}`, {
      method, headers: { authorization: this.#authorization, 'content-type': 'application/json' },
      redirect: 'error',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([this.#abort.signal, AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok) throw Object.assign(new Error(`OpenCode ${method} ${path.split('?')[0]} returned HTTP ${response.status}`), { code: response.status === 404 ? -32001 : -32603 });
    const content = await response.text();
    return content ? JSON.parse(content) : {};
  }

  async #request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method === 'initialize') return { protocolVersion: 1, agentInfo: { name: 'OpenCode native API' }, agentCapabilities: { loadSession: true, promptCapabilities: { image: true }, sessionCapabilities: { delete: {} } } };
    if (method === 'session/new' || method === 'session/load') {
      const session = object(object(method === 'session/new'
        ? await this.#call('/api/session', 'POST', { location: { directory: params['cwd'] } })
        : await this.#call(`/api/session/${encodeURIComponent(text(params['sessionId']))}`))['data']);
      this.#sessionId = text(session['id']);
      if (!this.#sessionId) throw new Error('OpenCode session.id must be a nonempty string');
      this.#sessionCost = sessionCost(session);
      await this.#controls.read(session);
      this.#notify({ sessionId: this.#sessionId, update: { sessionUpdate: 'available_commands_update', availableCommands: [
        { name: 'compact', description: 'Compact the session' },
        ...this.#controls.commands.map(command => ({ name: text(command['name']), description: text(command['description']) })),
      ] } });
      return { sessionId: this.#sessionId, configOptions: this.#controls.options() };
    }
    if (method === 'session/set_config_option' || method === 'session/set_mode') {
      await this.#controls.set(text(params['sessionId']), method === 'session/set_mode' ? 'mode' : text(params['configId']), text(params['modeId'] ?? params['value']));
      return { configOptions: this.#controls.options() };
    }
    if (method === 'session/delete') return this.#call(`/api/session/${encodeURIComponent(text(params['sessionId']))}`, 'DELETE');
    if (method !== 'session/prompt') throw Object.assign(new Error(`OpenCode bridge does not implement ${method}`), { code: -32601 });
    if (this.#pending) throw new Error('OpenCode already has a prompt in flight');
    this.#tools.clear();
    this.#lastTokens = 0;
    this.#compacting = false;
    this.#inbox.clear();
    this.#deferredTerminal = null;
    this.#tokens = { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, totalTokens: 0 };
    const response = Promise.withResolvers<PromptResponse>();
    const pending: Pending = {
      ...response, admitted: false, cancelSent: false, output: Promise.resolve(), buffered: 0,
      awaitingInbox: new Set(), earlyInbox: null, receivedTerminal: false,
    };
    this.#pending = pending;
    void this.#submit(pending, params['prompt'] as ContentBlock[], true).catch(error => {
      if (this.#pending !== pending) return;
      this.#pending = null;
      pending.reject(error);
    });
    return response.promise;
  }

  async #notification(method: string): Promise<void> {
    const pending = this.#pending;
    if (method !== 'session/cancel' || !pending || pending.cancelSent) return;
    pending.cancelSent = true;
    if (!this.#stopOnReceivedTerminal(pending)) await this.#interrupt();
  }

  #path(): string { return `/api/session/${encodeURIComponent(this.#sessionId)}`; }

  #interrupt(): Promise<unknown> { return this.#call(`${this.#path()}/interrupt`, 'POST', {}); }

  async #submit(pending: Pending, prompt: ContentBlock[], initial: boolean, onAccepted?: () => void, signal?: AbortSignal): Promise<void> {
    this.#inputCommitted = new Promise(resolve => { this.#commitInput = resolve; });
    const earlyInbox = new Set<string>();
    pending.earlyInbox = earlyInbox;
    try {
      const response = object(await this.#send(prompt, signal));
      signal?.throwIfAborted();
      if (this.#pending !== pending) throw new Error('OpenCode execution ended before admission');
      const id = text(object(response['data'])['id']);
      if (!id) throw new Error('OpenCode prompt response data.id must be a nonempty inbox ID');
      this.#inbox.add(id);
      if (!earlyInbox.has(id)) pending.awaitingInbox.add(id);
      if (initial) pending.admitted = true;
      onAccepted?.();
    } finally {
      pending.earlyInbox = null;
      this.#commitInput?.(); this.#commitInput = null; this.#inputCommitted = null;
      // An earlier interrupt may have reached the server before the prompt did.
      if (this.#pending === pending && pending.cancelSent && pending.admitted && !this.#stopOnReceivedTerminal(pending) && initial) {
        void this.#interrupt().catch(() => undefined);
      }
    }
    this.#current()?.ctx.inputReady?.();
  }

  #send(prompt: ContentBlock[], signal?: AbortSignal): Promise<unknown> {
    const value = prompt.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
    const files = prompt.flatMap(block => block.type === 'image' ? [{ uri: `data:${block.mimeType};base64,${block.data}` }] : []);
    const slash = /^\/([^\s]+)\s*([\s\S]*)$/.exec(value.trim());
    if (slash?.[1] === 'compact') {
      this.#compacting = true;
      return this.#call(`${this.#path()}/compact`, 'POST', {}, signal);
    }
    if (slash && this.#controls.commands.some(command => command['name'] === slash[1])) {
      return this.#call(`${this.#path()}/command`, 'POST', { name: slash[1], text: slash[2], files, delivery: 'steer' }, signal);
    }
    return this.#call(`${this.#path()}/prompt`, 'POST', { text: value, files, delivery: 'steer' }, signal);
  }

  async #subscribe(): Promise<void> {
    const opening = new AbortController();
    const headerTimer = setTimeout(() => opening.abort(new Error('OpenCode event subscription did not answer within 15 seconds')), 15_000);
    let response: Response;
    try {
      response = await fetch(`${this.#url}/api/event`, { headers: { authorization: this.#authorization }, redirect: 'error', signal: AbortSignal.any([this.#abort.signal, opening.signal]) });
    } finally { clearTimeout(headerTimer); }
    if (!response.ok || !response.body) throw new Error(`OpenCode event subscription returned HTTP ${response.status}`);
    let connected!: () => void;
    let failed!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { connected = resolve; failed = reject; });
    const timer = setTimeout(() => failed(new Error('OpenCode events did not report server.connected within 15 seconds')), 15_000);
    const consume = async () => {
      let buffer = '';
      const decoder = new TextDecoder();
      for await (const chunk of response.body!) {
        buffer += decoder.decode(chunk, { stream: true });
        if (buffer.length > EVENT_LIMIT) throw new Error('OpenCode event exceeds 16 MiB');
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end).trimEnd(); buffer = buffer.slice(end + 1);
          if (!line.startsWith('data:')) continue;
          const event = object(JSON.parse(line.slice(5)));
          if (event['type'] === 'server.connected') { clearTimeout(timer); connected(); }
          else this.#receive(text(event['type']), object(event['data']), line.length);
        }
      }
      if (!this.#abort.signal.aborted) throw new Error('OpenCode event stream closed');
    };
    void consume().catch(error => {
      clearTimeout(timer); failed(error);
      this.#pending?.reject(error); this.close();
    });
    try { await ready; } finally { clearTimeout(timer); }
  }

  #receive(type: string, data: Record<string, unknown>, size: number): void {
    if (type === 'session.created' && (data['parentID'] === this.#sessionId || this.#children.has(text(data['parentID'])))) {
      this.#children.add(text(data['sessionID']));
      return;
    }
    const pending = this.#pending;
    const turn = this.#current();
    if (!pending || !turn) return;
    if (data['sessionID'] === this.#sessionId) {
      if (type === 'session.step.ended' || type === 'session.step.failed') {
        this.#noteTokens(object(data['tokens']));
        return;
      }
      this.#noteReceipt(pending, type, data);
      if (turn.isStopped) {
        // A new interrupt acknowledgement ends even an admitted inbox.
        // Before initial admission it can still be for the idle session.
        if (pending.admitted && type === 'session.execution.interrupted') void this.#finish('cancelled');
        else this.#stopOnReceivedTerminal(pending);
      }
    }
    if (turn.isStopped) return;
    pending.buffered += size;
    if (pending.buffered > EVENT_LIMIT) throw new Error('OpenCode pending output exceeds 16 MiB');
    pending.output = pending.output.then(async () => {
      // SSE may arrive first. Publish the input before drawing its answer, and
      // keep data events ordered while a tool's documents are being read.
      while (this.#pending === pending && this.#inputCommitted) await this.#inputCommitted;
      if (this.#pending === pending && this.#current() === turn && !turn.isStopped) await this.#event(turn, type, data);
    }).catch(error => {
      if (this.#pending !== pending) return;
      pending.reject(error);
      this.close();
    }).finally(() => { pending.buffered -= size; });
  }

  /** Track the execution and its inbox at receipt, while drawing stays ordered. */
  #noteReceipt(pending: Pending, type: string, data: Record<string, unknown>): void {
    switch (type) {
      case 'session.execution.started':
      case 'session.compaction.started':
        pending.receivedTerminal = false;
        break;
      case 'session.inbox.delivered':
      case 'session.inbox.cancelled': {
        const id = text(data['inboxID']);
        if (!pending.awaitingInbox.delete(id)) pending.earlyInbox?.add(id);
        if (type === 'session.inbox.delivered') pending.receivedTerminal = false;
        break;
      }
      case 'session.execution.interrupted':
        if (pending.admitted) pending.receivedTerminal = true;
        break;
      case 'session.execution.succeeded':
      case 'session.execution.failed':
        pending.receivedTerminal = true;
        break;
      case 'session.compaction.ended':
      case 'session.compaction.failed':
        if (this.#compacting) pending.receivedTerminal = true;
        break;
    }
  }

  #stopOnReceivedTerminal(pending: Pending): boolean {
    if (!pending.admitted || pending.earlyInbox !== null || !pending.receivedTerminal || pending.awaitingInbox.size > 0) return false;
    void this.#finish('cancelled');
    return true;
  }

  async #event(turn: AcpTurn, type: string, data: Record<string, unknown>): Promise<void> {
    const sessionId = text(data['sessionID'] ?? object(data['form'])['sessionID']);
    const child = this.#children.has(sessionId);
    if (sessionId !== this.#sessionId && !child) return;
    // Children can ask for approval without ending their parent's execution.
    if (child && !type.startsWith('permission.') && !type.startsWith('form.') && !type.startsWith('session.tool.')) return;
    const id = text(data['id']);
    switch (type) {
      case 'session.execution.started': this.#deferredTerminal = null; break;
      case 'session.inbox.delivered': this.#inbox.delete(text(data['inboxID'])); break;
      case 'session.inbox.cancelled':
        this.#inbox.delete(text(data['inboxID']));
        if (this.#inbox.size === 0 && this.#deferredTerminal) this.#complete(this.#deferredTerminal);
        break;
      case 'session.text.delta': turn.writeText(text(data['delta'])); break;
      case 'session.reasoning.delta': turn.writeThinking(text(data['delta'])); break;
      case 'session.tool.input.started':
        this.#tools.set(id, { name: text(data['name']), input: {} });
        turn.upsertTool(id, text(data['name']), {}, undefined, 'pending', undefined);
        break;
      case 'session.tool.called': {
        const tool = this.#tools.get(id) ?? { name: text(data['name']) || 'tool', input: null };
        tool.input = data['input']; this.#tools.set(id, tool);
        turn.upsertTool(id, tool.name, tool.input, undefined, 'in_progress', undefined);
        break;
      }
      case 'session.tool.success':
      case 'session.tool.failed': {
        const tool = this.#tools.get(id);
        const content = await openCodeContent(data['content'], type.endsWith('failed') ? null : data['metadata'], turn.ctx.thread.cwd);
        if (turn !== this.#current() || turn.isStopped || turn.settled || this.#abort.signal.aborted) return;
        if (type.endsWith('failed')) content.push({ type: 'content', content: { type: 'text', text: text(object(data['error'])['message']) } });
        turn.upsertTool(id, tool?.name ?? null, tool?.input, undefined, type.endsWith('failed') ? 'failed' : 'completed', content);
        break;
      }
      case 'session.compaction.started': turn.ctx.reportProgress?.('compacting'); break;
      case 'session.compaction.ended':
        turn.ctx.reportProgress?.('working');
        if (this.#compacting) this.#complete({ stopReason: 'end_turn' });
        break;
      case 'session.compaction.failed':
        if (this.#compacting) this.#complete({ stopReason: 'end_turn', error: text(object(data['error'])['message']) || 'OpenCode compaction failed' });
        break;
      case 'session.execution.succeeded':
      case 'session.execution.interrupted':
      case 'session.execution.failed':
        this.#complete({ stopReason: type.endsWith('interrupted') ? 'cancelled' : 'end_turn',
          ...(type.endsWith('failed') ? { error: text(object(data['error'])['message']) || 'OpenCode execution failed' } : {}) });
        break;
      case 'permission.asked': {
        const path = `/api/session/${encodeURIComponent(sessionId)}/permission/${encodeURIComponent(id)}/reply`;
        if (turn.ctx.thread.permissionMode === 'yolo') {
          if (!turn.isStopped && !turn.settled) void this.#call(path, 'POST', { decision: 'once' }).catch(error => {
            if (!this.#abort.signal.aborted && !turn.isStopped && !turn.settled) turn.fail(messageOf(error));
          });
          break;
        }
        const tool = this.#tools.get(text(object(data['source'])['id']));
        const toolName = tool?.name ?? text(data['action']);
        const ticket = turn.ctx.requestPermission(toolName, tool?.input ?? data['metadata'] ?? null, text(data['message']) || null);
        this.#permissions.set(id, ticket);
        const index = turn.takeIndex();
        turn.part(index, { type: 'permission', requestId: ticket.requestId, toolName, decision: null });
        void Promise.race([ticket, turn.stopped.then(() => 'deny' as const)]).then(async decision => {
          if (!this.#permissions.delete(id) || turn.isStopped || turn.settled) return;
          turn.part(index, { type: 'permission', requestId: ticket.requestId, toolName, decision });
          await this.#call(path, 'POST', { decision: decision === 'allow' ? 'once' : 'reject' });
        }).catch(error => { if (!this.#abort.signal.aborted && !turn.isStopped && !turn.settled) turn.fail(messageOf(error)); });
        break;
      }
      case 'permission.replied': {
        const requestId = text(data['requestID']);
        const ticket = this.#permissions.get(requestId); this.#permissions.delete(requestId); ticket?.withdraw();
        break;
      }
      case 'form.created':
        void answerOpenCodeForm(turn, object(data['form']), this.#call.bind(this)).catch(error => {
          if (!turn.isStopped && !turn.settled) turn.fail(messageOf(error));
        });
        break;
      default: break;
    }
  }

  #noteTokens(tokens: Record<string, unknown>): void {
    const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
    const cache = object(tokens['cache']);
    const input = number(tokens['input']), output = number(tokens['output']), reasoning = number(tokens['reasoning']);
    const read = number(cache['read']), write = number(cache['write']);
    this.#tokens.inputTokens += input; this.#tokens.outputTokens += output; this.#tokens.thoughtTokens += reasoning;
    this.#tokens.cachedReadTokens += read; this.#tokens.cachedWriteTokens += write;
    this.#lastTokens = input + output + reasoning + read + write;
    this.#tokens.totalTokens += this.#lastTokens;
  }

  #complete(terminal: Terminal): void {
    // Admission can race the previous execution's terminal event. Its inbox
    // entry must deliver before a terminal event can end this Boite turn.
    if (this.#inbox.size > 0 && !this.#current()?.isStopped) {
      this.#deferredTerminal = terminal;
      return;
    }
    if (terminal.error) this.#current()?.fail(terminal.error);
    void this.#finish(terminal.stopReason);
  }

  async #finish(stopReason: 'end_turn' | 'cancelled'): Promise<void> {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    const turn = this.#current();
    if (this.#lastTokens > 0) turn?.noteContext(this.#lastTokens, this.#controls.contextWindow());
    if (turn) {
      this.#sessionCost = null;
      const cost = await this.readSessionCost(turn);
      if (this.#current() === turn) this.#sessionCost = turn.costUsdEquivalent = cost;
    }
    pending.resolve({ stopReason: turn?.isStopped ? 'cancelled' : stopReason, usage: this.#tokens });
  }
}
