/**
 * One `session/prompt` as the parts it draws, and the mapping from what ACP
 * carries (tool content, raw output, usage) to the contract's shapes.
 */
import type {
  AvailableCommand,
  ContentBlock,
  PromptResponse,
  ToolCallContent,
  ToolCallStatus,
  Usage as AcpUsage,
} from '@agentclientprotocol/sdk/unstable';
import type {
  AgentCommand,
  ImageAttachment,
  ToolDocument,
  ToolStatus,
  Usage,
} from '@boite/contracts';
import { ANTHROPIC_DEFAULT, openAiCacheLife } from '../../prompt-cache.ts';
import { isOpenCode } from '../../providers/opencode.ts';
import { antigravitySubagentBatch, normalizeAntigravityTool, type AntigravityLaunch } from '../antigravity.ts';
import { imageDocument } from '../documents.ts';
import type { PromptCacheLife, TurnContext, TurnRefusal, TurnResult } from '../types.ts';
import { stringify } from '../tool-text.ts';
import { TurnParts } from '../turn-parts.ts';

/**
 * The prompt cache lifetime of an ACP agent's turn, from the thread's model.
 * Only OpenCode has one: its `provider/model` ids name the vendor, it marks
 * Anthropic prompts with a `cache_control` that carries no `ttl`, and it sends
 * OpenAI no retention option. Grok, Gemini behind Antigravity, and OpenCode's
 * own gateway publish no lifetime, so their threads show no timer.
 */
export function acpCacheLife(providerId: string, model: string | null): PromptCacheLife | null {
  if (!isOpenCode(providerId) || model === null) return null;
  if (model.startsWith('anthropic/')) return ANTHROPIC_DEFAULT;
  if (model.startsWith('openai/')) return openAiCacheLife(model);
  return null;
}

/** What one tool part keeps of its output, and of each text document, in the journal. */
const TOOL_TEXT_MAX = 64 * 1024;

/** One `ContentBlock::Image` per attachment, `mimeType` and `data` as ACP names them. */
export function imageBlocksOf(attachments: ImageAttachment[]): ContentBlock[] {
  return attachments.map((attachment) => ({
    type: 'image' as const,
    mimeType: attachment.mimeType,
    data: attachment.data,
  }));
}

interface ToolEntry {
  index: number;
  name: string;
  input: unknown;
  output: string | null;
  status: ToolStatus;
  documents: ToolDocument[];
  launch: AntigravityLaunch | null;
  hermesDelegation?: true;
}

/**
 * A tool call's `content` as documents. A `diff` member is a file the call
 * wrote, a text block is markdown, an image block an image. `terminal`, audio
 * and resource blocks have no document in the contract, so they are dropped.
 * This is not the tool's output: `rawOutput` stays what it always was. Text is
 * cut at `TOOL_TEXT_MAX`, since the whole part is journalled and sent again on
 * every `tool_call_update`; a diff that large becomes a line saying so, because
 * half a diff would read as a real change.
 */
function documentsOf(content: ToolCallContent[]): ToolDocument[] {
  const documents: ToolDocument[] = [];
  for (const entry of content) {
    if (entry.type === 'diff') {
      // No `oldText` is a file the call created.
      const oldText = entry.oldText ?? '';
      const size = oldText.length + entry.newText.length;
      if (size > TOOL_TEXT_MAX) {
        documents.push({ kind: 'markdown', title: entry.path, text: `The change is too large to show here (${size} characters).` });
        continue;
      }
      documents.push({ kind: 'diff', path: entry.path, oldText, newText: entry.newText });
      continue;
    }
    if (entry.type !== 'content') continue;
    const block = entry.content;
    if (block.type === 'text') documents.push({ kind: 'markdown', title: null, text: boundText(block.text) });
    else if (block.type === 'image') documents.push(imageDocument(block.mimeType, block.data, null));
  }
  return documents;
}

/** The head of a text, with a line saying where it was cut. */
function boundText(text: string, max = TOOL_TEXT_MAX): string {
  return text.length > max ? `${text.slice(0, max)}\n[cut at ${max} characters]` : text;
}

/** `AvailableCommand` as the contract's `AgentCommand`: no `input` means no hint. */
export function commandsOf(list: AvailableCommand[]): AgentCommand[] {
  return list.map((command) => ({
    name: command.name,
    description: command.description || null,
    hint: command.input?.hint ?? null,
  }));
}

/**
 * One `session/prompt` and what it wrote. The parts are drawn the way every
 * other driver draws them: one text part the chunks append to, one part per
 * tool call, one part per permission question.
 */
export class AcpTurn extends TurnParts {
  readonly #tools = new Map<string, ToolEntry>();
  readonly #unannouncedTools = new Set<string>();
  #awaitingUser = 0;

  #status: TurnResult['status'] = 'done';
  #error: string | null = null;
  #diagnosticError: string | undefined;
  #refusal: TurnRefusal | undefined;
  #executionError: string | null = null;
  #usage: Usage | null = null;
  #queuedInputCancelled = false;

  sessionId: string | null;
  /**
   * The last USD cost an `usage_update` carried. The protocol defines it as the
   * session's running total, so the turn's own cost is what it added to
   * `costBefore`.
   */
  costUsdEquivalent: number | null = null;
  /** The session's cost before this turn, or null when the native total was unavailable. */
  costBefore: number | null = 0;
  /** `used` and `size` of the last `usage_update`, reported once when the turn ends. */
  contextUse: { tokens: number; window: number | null } | null = null;
  /**
   * The agent refused to load the thread's session in a way that says it no
   * longer has it: the thread's next turn starts a new session and carries the
   * conversation so far in its prompt.
   */
  sessionLost = false;

  /** This agent's dialect fixes, read once from the descriptor. */
  readonly antigravity: boolean;
  readonly activeCompactions = new Set<string>();
  stoppedForQueuedInput = false;
  outputRevision = 0;

  constructor(ctx: TurnContext) {
    super(ctx);
    this.antigravity = ctx.provider.quirks?.includes('antigravity') === true;
    this.sessionId = ctx.sessionId;
  }

  noteSession(sessionId: string): void {
    this.sessionId = sessionId;
  }

  get hasExecutionError(): boolean {
    return this.#executionError !== null;
  }

  noteExecutionError(text: string): void {
    this.#executionError = text;
  }

  /** Output continued past the candidate error or the prompt ended for another reason. */
  flushExecutionError(): void {
    const text = this.#executionError;
    this.#executionError = null;
    if (text !== null && !this.isStopped) this.writeText(text);
  }

  /** The id of every tool call this turn drew. */
  toolCallIds(): Set<string> {
    return new Set(this.#tools.keys());
  }

  /** A completed launch can leave children working in the agent process. */
  mayHaveDetachedChildren(): boolean {
    const hermes = this.ctx.provider.quirks?.includes('hermes');
    if (!this.antigravity && !hermes) return false;
    for (const tool of this.#tools.values()) {
      // A Hermes delegation can announce completion before its result names the mode.
      if (tool.status !== 'error' && (tool.launch === 'subagent' || tool.launch === 'swarm' || tool.hermesDelegation)) return true;
    }
    return false;
  }

  /**
   * A tool call of this turn, not one in `before`, still running. A subagent
   * launch is left out: Antigravity never closes it, and its children are
   * counted from their records.
   */
  hasRunningTool(before: ReadonlySet<string>): boolean {
    for (const [id, entry] of this.#tools) {
      if (!before.has(id) && entry.status === 'running' && entry.launch !== 'subagent') return true;
    }
    return false;
  }

  /** A permission grant can precede the agent's first update for that tool. */
  expectPermittedTool(toolCallId: string): void {
    if (!this.#tools.has(toolCallId)) this.#unannouncedTools.add(toolCallId);
  }

  get hasUnannouncedTools(): boolean {
    return this.#unannouncedTools.size > 0;
  }

  /** True while a permission request or a question of this turn waits for the user. */
  get awaitingUser(): boolean {
    return this.#awaitingUser > 0;
  }

  /** `answer`, counted in `awaitingUser` until it settles. */
  async awaitUser<T>(answer: Promise<T>): Promise<T> {
    this.#awaitingUser += 1;
    try {
      return await answer;
    } finally {
      this.#awaitingUser -= 1;
    }
  }

  /**
   * A stop that ended the turn before the agent answered it: the process was
   * closed under a pending request. The turn is stopped, not failed, so no
   * error part; a turn that already failed stays failed.
   */
  stopNow(): void {
    if (this.settled || this.#status === 'error') return;
    this.#status = 'stopped';
  }

  /** `usage_update`: only the latest reading counts, and it is reported once, at the end. */
  noteContext(used: number, size: number): void {
    if (!Number.isFinite(used) || used < 0) return;
    this.contextUse = { tokens: used, window: Number.isFinite(size) && size > 0 ? size : null };
  }

  settle(): void {
    if (this.settled) return;
    this.settled = true;
    this.wake();
    if (this.contextUse !== null) this.ctx.context(this.contextUse);
    this.resolve(this.#status, () => ({
      status: this.#status,
      sessionId: this.sessionId,
      usage: this.#usage,
      error: this.#error ?? undefined,
      ...(this.#diagnosticError === undefined ? {} : { diagnosticError: this.#diagnosticError }),
      ...(this.#refusal === undefined ? {} : { refusal: this.#refusal }),
      promptCache: acpCacheLife(this.ctx.provider.id, this.ctx.thread.model),
      ...(this.sessionLost ? { sessionLost: true } : {}),
      ...(this.#queuedInputCancelled ? { queuedInputCancelled: true } : {}),
      ...(this.stoppedForQueuedInput && !this.#queuedInputCancelled
        ? this.#status === 'done' ? { queuedInputCompleted: true } : { queuedInputInterrupted: true }
        : {}),
    }));
  }

  /** The turn's share of the session's running cost; a total below what came before is a session that started over. */
  #turnCost(): number | null {
    const total = this.costUsdEquivalent;
    if (total === null || this.costBefore === null) return null;
    return total >= this.costBefore ? total - this.costBefore : total;
  }

  /** The prompt response: the stop reason becomes the status, the usage the numbers. */
  finish(response: PromptResponse): void {
    this.#usage = mapUsage(response.usage ?? null, this.#turnCost());
    if (response.stopReason !== 'end_turn') this.flushExecutionError();
    switch (response.stopReason) {
      case 'end_turn': {
        const text = this.#executionError;
        this.#executionError = null;
        // A concurrent permission or update stop must keep the refusal so the queue can recover the input.
        if (text !== null && (!this.isStopped || this.stoppedForQueuedInput)) this.fail(text.trim(), undefined, { kind: 'capacity' });
        break;
      }
      case 'cancelled':
        this.#status = 'stopped';
        this.#queuedInputCancelled = this.stoppedForQueuedInput;
        break;
      default:
        this.fail(`the agent stopped: ${response.stopReason}`);
        break;
    }
  }

  fail(reason: string, diagnostic?: string, refusal?: TurnRefusal): void {
    if (this.#status === 'error') return;
    this.flushExecutionError();
    this.#status = 'error';
    this.#error = reason;
    this.#diagnosticError = diagnostic;
    this.#refusal = refusal;
    this.part(this.takeIndex(), { type: 'error', message: reason });
  }

  /**
   * The agent no longer has this session. No error part: the runner starts a
   * fresh session and sends the turn again, so the conversation shows the answer.
   */
  loseSession(reason: string): void {
    if (this.#status === 'error') return;
    this.sessionLost = true;
    this.#status = 'error';
    this.#error = reason;
  }

  // -- parts ----------------------------------------------------------------

  /**
   * `tool_call` opens the part, `tool_call_update` replaces the same one by id.
   * `content` replaces the documents when the agent sends one, the protocol's
   * own word for that field; null or absent leaves the ones already there.
   * `launch` is what this update says the call is, kept from the first
   * update that says it: the later ones carry no title.
   */
  upsertTool(
    toolCallId: string,
    name: string | null,
    input: unknown,
    output: unknown,
    status: ToolCallStatus | null | undefined,
    content: ToolCallContent[] | null | undefined,
    launch: AntigravityLaunch | null = null,
    fallbackName: string | null = null,
  ): void {
    const entry: ToolEntry = this.#tools.get(toolCallId) ?? {
      index: this.takeIndex(),
      name: name ?? fallbackName ?? toolCallId,
      input: null,
      output: null,
      status: 'running' as ToolStatus,
      documents: [] as ToolDocument[],
      launch: null,
    };
    if (launch === 'mcp' || entry.launch === null) entry.launch = launch;
    if (name !== null && name.length > 0) entry.name = name;
    // A later update can change the card's title, even before its result arrives.
    if (this.ctx.provider.quirks?.includes('hermes') && /^delegate_task(?::|$)/.test(entry.name)) entry.hermesDelegation = true;
    // Antigravity carries a shell call's command, its cwd and its combined
    // output under half a dozen spellings, and pads `_meta` with base64
    // images: the quirk folds those into what the card already draws.
    const native = this.antigravity ? normalizeAntigravityTool(input, output) : null;
    if (native !== null) {
      if (native.input !== undefined) entry.input = native.input;
      if (native.output !== undefined) entry.output = native.output;
    } else {
      if (input !== undefined) entry.input = input;
      // Journalled whole and sent again on every update: a file read or a
      // command's output can be megabytes.
      if (output !== undefined && output !== null) entry.output = boundText(toolOutputText(output));
    }
    if (status !== null && status !== undefined) entry.status = toolStatus(status);
    if (content !== null && content !== undefined) {
      // OpenCode 2 puts stdout in ACP content and only metadata in rawOutput.
      // Text is the tool output; images and diffs are separate documents.
      if (this.ctx.provider.id === 'opencode-v2') {
        const text = content.flatMap(item => item.type === 'content' && item.content.type === 'text' ? [item.content.text] : []);
        if (text.length > 0) entry.output = boundText(text.join('\n'));
        entry.documents = documentsOf(content.filter(item => item.type !== 'content' || item.content.type !== 'text'));
      } else entry.documents = documentsOf(content);
    }
    this.#tools.set(toolCallId, entry);
    this.#unannouncedTools.delete(toolCallId);
    this.part(entry.index, {
      type: 'tool',
      toolId: toolCallId,
      name: entry.name,
      input: entry.input,
      output: entry.output,
      status: entry.status,
      ...(entry.documents.length > 0 ? { documents: entry.documents } : {}),
      ...(entry.launch === 'subagent' ? { nativeAgents: [antigravitySubagentBatch(toolCallId, entry.status, entry.output)] } : {}),
    });
  }
}

/**
 * `rawOutput` as the text a person reads. Agents wrap it their own way: OpenCode
 * answers `{ output, metadata }`, Grok answers a tagged object whose `output`
 * is the bytes of the text with `output_for_prompt` beside it, and its file
 * tools nest the text under `FileContent.content` or `Content.content`. A shape
 * nobody knows stays the JSON it was.
 */
export function toolOutputText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === null || typeof output !== 'object' || Array.isArray(output)) return stringify(output) ?? '';
  const record = output as Record<string, unknown>;
  const inner = record['output'];
  if (typeof inner === 'string') return inner;
  if (Array.isArray(inner) && inner.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return new TextDecoder().decode(Uint8Array.from(inner as number[]));
  }
  if (typeof record['output_for_prompt'] === 'string') return record['output_for_prompt'];
  for (const key of ['FileContent', 'Content']) {
    const nested = record[key];
    if (nested !== null && typeof nested === 'object') {
      const content = (nested as Record<string, unknown>)['content'];
      if (typeof content === 'string') return content;
    }
  }
  return stringify(output) ?? '';
}

function toolStatus(status: ToolCallStatus): ToolStatus {
  switch (status) {
    case 'completed':
      return 'done';
    case 'failed':
      return 'error';
    default:
      return 'running';
  }
}

/** A `usage_update`'s running cost when it is a finite USD amount, the only currency a turn records. */
export function usdCostOf(update: { cost?: { amount: number; currency: string } | null }): number | null {
  const cost = update.cost;
  if (cost == null || cost.currency !== 'USD' || !Number.isFinite(cost.amount) || cost.amount < 0) return null;
  return cost.amount;
}

/** `PromptResponse.usage` is experimental: a cost the agent reported without it is still the turn's cost. */
function mapUsage(usage: AcpUsage | null, costUsdEquivalent: number | null): Usage | null {
  if (usage === null) {
    if (costUsdEquivalent === null) return null;
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsdEquivalent };
  }
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cachedReadTokens ?? 0,
    cacheWriteTokens: usage.cachedWriteTokens ?? 0,
    costUsdEquivalent,
  };
}

