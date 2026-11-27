import { logMessageOf } from '../../log-errors.ts';
import type {
  ClientConnection,
  ClientContext,
  PromptResponse,
  SessionConfigOption,
  SessionNotification,
} from '@agentclientprotocol/sdk/unstable';
import type { Attachment, PermissionMode, ProviderId, ModelInfo, TurnId } from '@boite/contracts';
import { nativeImage } from '../../attachments.ts';
import { messageOf, refused } from '../../errors.ts';
import type { SpawnedChild } from '../../procs.ts';
import { profileFor } from '../../providers/resolve.ts';
import { stderrLines } from '../lines.ts';
import { exitSentence, exitWithin } from '../exit.ts';
import { IdleTimer } from '../idle-timer.ts';
import { SessionTurns } from '../session-turns.ts';
import type { LiveTurnSettings, ProbeContext, ProbeFilter, SessionContext } from '../types.ts';
import { OpenCommands } from './commands.ts';
import { readDetachedWork, readPendingReply } from './detached.ts';
import { ModelRefused, SessionControls } from './controls.ts';
import { failureText, loadRefusal, LoadRefused, rpcReason, rpcRefusal } from './load.ts';
import { AGENT_OWN_MODEL, agentModelsOf } from './models.ts';
import { EXIT_GRACE_MS, isGrok, STDERR_MAX, type AcpDeps, type Timer } from './protocol.ts';
import { commandsOf, imageBlocksOf, usdCostOf, type AcpTurn } from './turn.ts';
import { drawUpdate } from './updates.ts';
import { noteReady } from '../driver-log.ts';
import { SessionRetention } from '../session-retention.ts';
import { releaseChild } from '../session-close.ts';
import { OpenCodeConnection } from './opencode-connection.ts';
import { OPENCODE_V2 } from '../../providers/opencode.ts';
import { noteCompactionModel, wantedCompactionBuffer, type CompactionCaches } from './opencode-compaction.ts';
import type { protectedAcp } from './protected.ts';
import { discoveredControls, newConversation, probeControls } from './control-probe.ts';
import { acpMcpServers, loadConversation } from './conversation.ts';
import { sessionMcp } from '../mcp.ts';
import { connectTransport, initializeTransport, spawnTransport } from './transport.ts';
import { isAntigravity } from '../antigravity.ts';

/** A glog line at info severity: `I0921 09:51:32.917720 10292 main.py:80] ...`. */
const GLOG_INFO = /^I\d{4} \d{2}:\d{2}:\d{2}\.\d+\s/;
/** How long an agent gets to answer `session/cancel` before its process is closed. */
const STOP_GRACE_MS = 3_000;
/**
 * A turn held for Antigravity's detached children reads the agent's records
 * this often, and ends once they all reported, no reply is owed and the
 * session said nothing for `DETACHED_QUIET_MS`.
 */
const DETACHED_POLL_MS = 1_000;
const DETACHED_QUIET_MS = 3_000;

/**
 * What the driver learns about agents across their processes, for the life of
 * the core, OpenCode 2's compaction windows included.
 */
export interface AcpMemory extends CompactionCaches {
  /**
   * Providers seen to count a loaded session's cost from zero in each new
   * process, against the protocol's "cumulative session cost": their cold
   * turns are charged the whole total the process reports.
   */
  costPerProcess: Set<ProviderId>;
  /** `provider\0sessionId` of loads refused once with an `unsure` error. */
  refusedLoads: Set<string>;
}

/**
 * One ACP agent process for a thread: one `initialize`, one `session/new` or
 * `session/load`, then one `session/prompt` per turn. Viewed and prepared
 * sessions stay resident through navigation; other sessions follow the
 * post-turn `warmProcessMinutes` policy. A stop, archive, shutdown or changed
 * setup closes the process.
 */
export class AcpSession {
  #child: SpawnedChild | null = null;
  #killTree: (() => void) | null = null;
  #connection: ClientConnection | OpenCodeConnection | null = null;
  #agent: ClientContext | null = null;
  #starting: Promise<void> | null = null;
  /**
   * The thread's latest session context, kept across turns. `available_commands_update`
   * typically arrives right after `session/new` or `session/load`, before any
   * turn is in flight, so the update handler reports through this rather than
   * through `current`, or the list would be dropped between turns.
   */
  #ctx: SessionContext | null = null;

  #sessionId: string | null = null;
  #canLoad = false;
  /** The agent deletes sessions on request: a discovery session does not outlive its reading. */
  #canDelete = false;
  /** What every `session/new` and `session/load` of this process adds, from its `initialize` answer. */
  #sessionMeta: { _meta?: Record<string, unknown> } = {};
  /** This process resumed the thread's session with `session/load`, rather than creating one. */
  #loaded = false;
  /** This process already opened the session that reads the agent's own model: a refusal is not asked again. */
  #ownModelAsked = false;
  /**
   * The thread's session this process could not load and replaced with a new
   * one: the turn that asked for it is sent the conversation so far.
   */
  #replaces: string | null = null;
  /**
   * The last USD running total this process reported, in a turn, between two
   * turns or while a `session/load` replayed the history. What the next turn
   * adds is measured from it.
   */
  #reportedCost: number | null = null;
  #imagesSupported = false;
  /** The `compaction.buffer` this OpenCode 2 process was started with, null for none; undefined before a spawn. */
  #compactionBuffer: number | null | undefined = undefined;
  /** The model, the effort and the mode, as last sent and as the agent last reported them. */
  readonly #controls = new SessionControls(() => ({ agent: this.#agent, sessionId: this.#sessionId }));
  #lastStderr = '';
  #exited: Promise<number | null> | null = null;
  /** The process ended before Boite closed it: its exit, not the error that closed it, says why. */
  #diedAlone = false;
  readonly #idle = new IdleTimer(() => this.#drop());
  readonly #retention = new SessionRetention();
  /** The turn receiving updates, including Antigravity's reply after the prompt. */
  #current: AcpTurn | null = null;
  /** The turn the queue is running, from its start to its end, prompt or not. */
  #active: AcpTurn | null = null;
  /** Armed by a stop on a prompt in flight: an agent that ignores the cancel is closed. */
  #stopTimer: Timer | null = null;
  readonly #turns = new SessionTurns<AcpTurn>(turn => this.#runTurn(turn), (turn, error) => {
    if (turn.isStopped) turn.stopNow();
    else turn.fail(messageOf(error));
    this.#endTurn(turn, true);
  });
  /** Antigravity's shell commands, the ones that outlived their turn included. */
  readonly #commands = new OpenCommands();
  /** Antigravity's `GEMINI_HOME` for this process, where it records its children. */
  #geminiHome: string | null = null;
  /** The turn kept open after its prompt for the children it launched. */
  #holding: AcpTurn | null = null;
  /** Earlier prompts can leave native workers in this process. */
  #hasDetachedWork = false;
  /** Prompts this process acknowledged cancelling for queued input. */
  readonly #queuedInputReceipts = new Set<TurnId>();
  /** When this session last sent an update, to tell a reply that ended from one still streaming. */
  #lastUpdateAt = 0;
  /** Grok answered `_x.ai/interject` with an error once: this process has no mid-turn input. */
  #interjectRefused = false;
  #closing = false;
  #ended = false;
  #catalogValid = true;
  #protection: ReturnType<typeof protectedAcp> = null;

  #warmMs: number;
  readonly #deps: AcpDeps;
  readonly #memory: AcpMemory;
  #mcp: ReturnType<typeof sessionMcp> = null;
  readonly #onEnded: (session: AcpSession) => void;
  readonly #onOptions: (options: SessionConfigOption[], ownModel?: string | null) => void;

  constructor(
    readonly key: string,
    warmMs: number,
    deps: AcpDeps,
    memory: AcpMemory,
    onEnded: (session: AcpSession) => void,
    /** The config options a session answered with, for the next session of the account to start from. */
    onOptions: (options: SessionConfigOption[], ownModel?: string | null) => void = () => undefined,
  ) { this.#warmMs = warmMs; this.#deps = deps; this.#memory = memory; this.#onEnded = onEnded; this.#onOptions = onOptions;}

  async catalog(ctx: ProbeContext): Promise<ModelInfo[] | null> {
    const setup = this.#ctx;
    const scope = ctx.catalogThread;
    if (!this.#catalogValid || this.#ended || this.#closing || setup === null || scope === undefined
      || setup.thread.id !== scope.id || scope.providerId !== ctx.provider.id || scope.accountId !== ctx.accountId
      || setup.thread.cwd !== scope.cwd
      || JSON.stringify(setup.thread.contextMode ?? null) !== JSON.stringify(scope.contextMode ?? null)
      || setup.provider.id !== ctx.provider.id || setup.account.id !== ctx.accountId
      || JSON.stringify(setup.accountEnv) !== JSON.stringify(ctx.accountEnv)
      || JSON.stringify(setup.provider) !== JSON.stringify(ctx.provider)) return null;
    // Composition may ask for models while the matching prompt-free opener is
    // still initializing. Share that work before deciding a probe is needed.
    try { await this.#starting; } catch { return null; }
    if (!this.#catalogValid || this.#ended || this.#closing || this.#sessionId === null) return null;
    return this.#controls.catalog(setup);
  }

  forgetCatalog(filter: ProbeFilter): void {
    if (this.#ctx === null) return;
    if (filter.providerId !== undefined && filter.providerId !== this.#ctx.provider.id) return;
    if (filter.accountId !== undefined && filter.accountId !== this.#ctx.account.id) return;
    // The driver dropped the account's windows: an idle process says again what
    // it runs, or its next turn would restart it on the native ceiling. A busy
    // one says it as its turn ends.
    if (!this.busy() && !this.#ended && !this.#closing) this.#noteCompactionWindow(this.#ctx);
    // A session still opening reads its options after the refresh asked: they
    // are the fresh catalog. The composer asks for one as the app opens, while
    // the draft's own process starts, and a catalog lost here costs the first
    // prompt one more agent process (2.6 s for OpenCode 2 2.0.30).
    if (filter.refresh === true && this.#sessionId === null && !this.#ended) return;
    this.#catalogValid = false;
  }

  /**
   * The thread's model, options and mode, sent at the start of the process and
   * of every turn. A thread going back to the agent's own model on an agent
   * that lists models needs to know which one that is: a `session/load`
   * reports the model the session was left on, or no models at all, and a
   * reloaded descriptor drops the account's probe. Then one throwaway session
   * says it, on a cold start or a warm turn alike, and the account keeps it.
   */
  async #applyControls(ctx: SessionContext): Promise<void> {
    const agent = this.#agent;
    const antigravity = isAntigravity(ctx.provider);
    const takesOwnModel = !this.#controls.hasModelOption() || antigravity;
    const wantsOwnModel = ctx.thread.model === AGENT_OWN_MODEL || (antigravity && ctx.thread.model === null);
    if (agent !== null && !isGrok(ctx.provider) && wantsOwnModel
      && (this.#controls.hasModels() || this.#loaded) && takesOwnModel && !this.#controls.knowsOwnModel() && !this.#ownModelAsked) {
      this.#ownModelAsked = true;
      // Only a lookup: a refusal leaves the session where it is, and the next
      // process asks again.
      await this.#probeControls(ctx, agent).catch((error: unknown) => {
        ctx.log('warn', `acp: ${ctx.provider.id} refused the session that reads its own model: ${messageOf(error)}`);
      });
    }
    await this.#controls.applySelection(ctx);
    await this.#controls.applyMode(ctx);
  }

  seedConfig(options: SessionConfigOption[], ownModel?: string | null): void {
    this.#controls.seed(options);
    this.#controls.seedOwnListedModel(ownModel);
  }

  /**
   * Reusable only while the process is up and the turn asks for the very same
   * setup. A command an earlier turn left running keeps it reusable whatever
   * the warm window: a new process would end that command.
   */
  usable(key: string, warmMs: number): boolean {
    return !this.#ended && !this.#closing && this.key === key && (this.#retention.reusable(warmMs, this.#warmMs) || this.#commands.outlived());
  }

  setViewed(viewed: boolean): void {
    this.#retention.setViewed(viewed);
    this.#idle.clear();
    if (!viewed && !this.busy() && !this.#ended) this.#armIdle();
  }

  async prepare(ctx: SessionContext, forTurn = false): Promise<void> {
    this.#retention.prepare(forTurn);
    this.#idle.clear();
    try { await this.#start(ctx); }
    catch (error) { this.#drop(); throw error; }
    finally {
      ctx.finishStartup?.();
      if (!this.#ended && !this.busy() && !this.#retention.viewed) this.#armIdle();
    }
  }

  busy(): boolean {
    return this.#turns.busy;
  }

  /**
   * An idle OpenCode 2 process started with another compaction buffer than
   * the thread's limit now asks for: the window became known after its
   * launch, or the limit changed. The driver replaces it before the next
   * turn, never during one, the way the Claude driver reopens a query whose
   * native compaction settings changed.
   */
  compactionMoved(ctx: SessionContext): boolean {
    if (ctx.provider.id !== OPENCODE_V2 || this.#compactionBuffer === undefined || this.busy() || this.#ended || this.#closing) return false;
    return wantedCompactionBuffer(this.#memory, ctx) !== this.#compactionBuffer;
  }

  /** The model the process says the session runs and its window, for the next process on it. */
  #noteCompactionWindow(ctx: SessionContext): void {
    if (!(this.#connection instanceof OpenCodeConnection)) return;
    const { model, window } = this.#connection.compactionModel();
    noteCompactionModel(this.#memory, ctx, model, window);
  }

  attach(turn: AcpTurn, warmMs: number): void {
    this.#warmMs = warmMs;
    this.#retention.beginTurn();
    this.#idle.clear();
    this.#turns.enqueue(turn);
  }

  /**
   * `session/cancel` is the only stop ACP has, and the prompt response ends the
   * turn. It only asks, though: an agent that ignores it is closed past
   * `STOP_GRACE_MS`, and one still starting (`initialize`, `session/new` or
   * `session/load`, a `set_*` call) is closed at once, since nothing it has
   * not answered yet can be cancelled. Closing the connection rejects the
   * pending request, and the turn settles as stopped.
   */
  stopTurn(turn: AcpTurn, reason?: 'restart'): void {
    if (turn.settled) return;
    if (reason !== 'restart') turn.stoppedForQueuedInput = false;
    turn.markStopped();
    // Not begun: `runTurn` settles it the moment the queue reaches it.
    if (this.#active !== turn) return;
    // No prompt to cancel: the children it waits for end with the process.
    if (this.#current !== turn || this.#holding === turn) {
      this.#drop();
      return;
    }
    if (!turn.stoppedForQueuedInput) this.#cancel();
    if (this.#stopTimer !== null) return;
    this.#stopTimer = setTimeout(() => {
      this.#stopTimer = null;
      if (!turn.settled) this.#drop();
    }, STOP_GRACE_MS);
    this.#stopTimer.unref?.();
  }

  cancelForQueuedInput(turn: AcpTurn, attachments: Attachment[]): boolean {
    if (this.#current !== turn || turn.isStopped || turn.stoppedForQueuedInput || turn.awaitingUser || turn.hasExecutionError || turn.activeCompactions.size > 0
      || this.#holding === turn || this.#commands.outlived() || this.#hasDetachedWork || turn.mayHaveDetachedChildren()) return false;
    if (!this.#imagesSupported && attachments.some(attachment => nativeImage(turn.ctx.provider, attachment))) {
      throw refused(`${turn.ctx.provider.name} takes no images`);
    }
    turn.stoppedForQueuedInput = true;
    // A queued follow-up can wait if the agent ignores cancellation.
    this.#cancel();
    return true;
  }

  /**
   * Grok's `_x.ai/interject`: the text joins the running prompt at the agent's
   * next safe point, between two tool calls or two model calls. Only while this
   * turn's prompt is in flight: on an idle session Grok runs the text as a turn
   * of its own that no Boite turn would draw. An agent that answers with an
   * error, an older Grok without the method, is not asked again.
   */
  async steer(turn: AcpTurn, text: string): Promise<boolean> {
    const agent = this.#agent;
    const sessionId = this.#sessionId;
    if (this.#interjectRefused || agent === null || sessionId === null || this.#current !== turn || turn.isStopped) return false;
    try {
      await agent.request('_x.ai/interject', { sessionId, text });
      return true;
    } catch (error) {
      if (!rpcRefusal(error)) throw error;
      this.#interjectRefused = true;
      turn.ctx.log('warn', `acp: ${turn.ctx.provider.id} refused _x.ai/interject, answers wait for the turn's end: ${rpcReason(error)}`);
      return false;
    }
  }

  /** Whether this session talks to OpenCode 2's native server, the only transport that steers. */
  steersOpenCode(): boolean {
    return this.#connection instanceof OpenCodeConnection;
  }

  async steerOpenCode(turn: AcpTurn, text: string, attachments: import('@boite/contracts').ImageAttachment[] = [], onAccepted?: () => void, signal?: AbortSignal): Promise<boolean> {
    if (this.#current !== turn || turn.isStopped || !(this.#connection instanceof OpenCodeConnection)) return false;
    return this.#connection.steer([{ type: 'text', text }, ...imageBlocksOf(attachments)], onAccepted, signal);
  }

  #cancel(): void {
    const agent = this.#agent;
    const sessionId = this.#sessionId;
    if (agent === null || sessionId === null) return;
    void agent.notify('session/cancel', { sessionId }).catch(() => undefined);
  }

  /** Archive, shutdown, an idle window, a changed setup: the process goes. */
  close(reason: string | null, ctx?: SessionContext): void {
    if (this.#ended) return;
    this.#closing = true;
    if (reason !== null && ctx !== undefined) ctx.log('warn', `acp session: ${reason}`);
    this.#drop();
  }

  // -- the process ----------------------------------------------------------

  async setPermissionMode(turn: AcpTurn, mode: PermissionMode): Promise<boolean> {
    if (turn.ctx.protectedExecution) return false;
    if (this.#current !== turn || turn.isStopped || this.#closing || this.#ended) return false;
    const applied = await this.#controls.applyMode({ ...turn.ctx, thread: { ...turn.ctx.thread, permissionMode: mode } });
    if (applied) turn.ctx.thread.permissionMode = mode;
    return applied;
  }

  /**
   * The reasoning effort of a prompt that is still running, as the same
   * `session/set_config_option` a turn starts with. OpenCode 1.18.35 answered
   * it during a tool call with the new current value and finished the prompt
   * normally (probed on 2026-10-07); whether the requests left in that prompt
   * use it is the agent's own business. ACP has no speed. Grok takes its
   * effort inside `session/set_model`, untested while it prompts, so it waits
   * for the next turn.
   */
  async applySettings(turn: AcpTurn, change: LiveTurnSettings): Promise<LiveTurnSettings> {
    if (this.#current !== turn || turn.isStopped || this.#closing || this.#ended) return {};
    const effort = change.effort;
    if (typeof effort !== 'string' || effort.length === 0) return {};
    if (!(await this.#controls.applyEffort(turn.ctx, effort))) return {};
    turn.ctx.thread.effort = effort;
    return { effort };
  }

  async #runTurn(turn: AcpTurn): Promise<void> {
    this.#active = turn;
    if (this.#stopBeforePrompt(turn, false) || !(await this.#startTurn(turn))) return;

    const agent = this.#agent;
    const sessionId = this.#sessionId;
    if (agent === null || sessionId === null) {
      if (turn.isStopped) turn.stopNow();
      else turn.fail('the acp session went away before the prompt');
      this.#endTurn(turn, true);
      return;
    }
    const prepareSessionPrompt = turn.ctx.prepareSessionPrompt;
    turn.ctx.prepareSessionPrompt = undefined;
    const replaces = this.#replaces !== null && this.#replaces === turn.ctx.sessionId;
    const receipts = turn.ctx.sessionId === sessionId ? this.#queuedInputReceipts : undefined;
    const input = replaces ? await this.#carryPrompt(turn) : await prepareSessionPrompt?.(receipts) ?? turn.ctx;
    if (input === null || this.#stopBeforePrompt(turn)) return;
    const { prompt, attachments } = input;

    if (attachments.length > 0 && !this.#imagesSupported) {
      turn.fail(`${turn.ctx.provider.name} takes no images`);
      this.#endTurn(turn, true);
      return;
    }

    turn.noteSession(sessionId);
    // Every turn, not only the first: a warm session outlives a change to any
    // of the three, the agent may have switched on its own since the last
    // prompt, and a `session/load` reports none of them reliably. Each call
    // sends nothing when what it carries has not moved. A model the agent did
    // not take ends the turn here: the prompt would run on the previous one.
    try {
      await this.#applyControls(turn.ctx);
    } catch (error) {
      if (!(error instanceof ModelRefused)) throw error;
      // A stop closes the agent under a switch it has not answered.
      if (turn.isStopped) turn.stopNow();
      else turn.fail(error.message);
      this.#endTurn(turn, turn.isStopped);
      return;
    }
    let judged = false;
    const connection = this.#connection;
    if (connection instanceof OpenCodeConnection) {
      // A failed read at the end of the previous turn leaves the native total unknown.
      turn.costBefore = connection.sessionCost ?? await connection.readSessionCost(turn);
    } else judged = this.#costBaseline(turn);
    if (this.#stopBeforePrompt(turn)) return;
    this.#current = turn;
    let response: PromptResponse;
    try {
      const pending = agent.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: prompt }, ...imageBlocksOf(attachments)],
      });
      turn.ctx.inputReady?.();
      if (turn.isStopped) this.#cancel();
      // The agent is up and holds the prompt. Until its first update the wait
      // is the model's: OpenCode retries a refused provider for a minute and
      // more without a word on the wire, which must not read as a start.
      else turn.ctx.reportProgress?.('waiting');
      response = await pending;
      if (this.#canLoad) turn.ctx.sessionAccepted?.(sessionId);
      if (turn.antigravity && response.stopReason === 'end_turn' && !turn.isStopped && !turn.hasExecutionError) await this.#holdForDetached(turn, sessionId);
    } catch (error) {
      this.#current = null;
      if (turn.isStopped) {
        // The stop closed the process under the prompt.
        turn.stopNow();
      } else {
        await this.#fail(turn, error);
      }
      // A live agent may answer cancellation with an error. Keep its process
      // unless the session went away, so the next prompt can recover on load.
      const retain = !turn.isStopped && !this.#closing && turn.stoppedForQueuedInput
        && rpcRefusal(error) && loadRefusal(error, rpcReason(error)) !== 'gone';
      if (retain) this.#retention.prepare(true);
      this.#endTurn(turn, !retain);
      return;
    }
    this.#current = null;
    // A stop or the process's end settled the turn while it waited for its children.
    if (turn.settled) {
      this.#endTurn(turn, true);
      return;
    }
    // The turn may have moved the thread to another model.
    this.#noteCompactionWindow(turn.ctx);
    turn.finish(response);
    // Keep this session for the queued follow-up even with zero warm time.
    if (turn.stoppedForQueuedInput && response.stopReason === 'cancelled') {
      this.#queuedInputReceipts.add(turn.ctx.turn.id);
      this.#retention.prepare(true);
    }
    // A resumed session whose first total came in below what the session
    // already cost: this agent counts each process from zero.
    const total = turn.costUsdEquivalent;
    if (judged && total !== null && turn.costBefore !== null && total < turn.costBefore && !this.#memory.costPerProcess.has(turn.ctx.provider.id)) {
      this.#memory.costPerProcess.add(turn.ctx.provider.id);
      turn.ctx.log('info', `acp: ${turn.ctx.provider.id} reports a resumed session's cost from zero; its cold turns are charged their whole total`);
    }
    this.#endTurn(turn, turn.isStopped);
  }

  #stopBeforePrompt(turn: AcpTurn, drop = true): boolean {
    if (!turn.isStopped) return false;
    turn.stopNow();
    this.#endTurn(turn, drop);
    return true;
  }

  async #startTurn(turn: AcpTurn): Promise<boolean> {
    this.#ctx = turn.ctx;
    try {
      turn.ctx.protectedExecution?.check();
      await this.#start(turn.ctx);
      return true;
    } catch (error) {
      if (this.#stopBeforePrompt(turn)) return false;
      if (error instanceof LoadRefused && error.lost) turn.loseSession(error.message);
      else if (error instanceof LoadRefused || error instanceof ModelRefused) turn.fail(error.message);
      else await this.#fail(turn, error);
      this.#endTurn(turn, true);
      return false;
    }
  }

  /** A new conversation replacing a lost session carries the history with its prompt. */
  async #carryPrompt(turn: AcpTurn): Promise<Pick<AcpTurn['ctx'], 'prompt' | 'attachments'> | null> {
    this.#replaces = null;
    try { return await turn.ctx.continuation?.() ?? turn.ctx; }
    catch (error) {
      if (this.#stopBeforePrompt(turn)) return null;
      turn.fail(messageOf(error));
      this.#endTurn(turn, true);
      return null;
    }
  }

  /**
   * What the session had cost before this turn, which `usage_update`'s running
   * total is measured from. A total this process already reported is exact. A
   * session it created starts at zero. A session it loaded and that has said
   * nothing yet starts where the journal left it, since the protocol defines
   * the cost as the session's. An agent seen to count from zero starts at zero.
   * True when the turn's reading has to tell which of the two the agent does.
   */
  #costBaseline(turn: AcpTurn): boolean {
    if (this.#reportedCost !== null) {
      turn.costBefore = this.#reportedCost;
      return false;
    }
    if (!this.#loaded || this.#memory.costPerProcess.has(turn.ctx.provider.id)) {
      turn.costBefore = 0;
      return false;
    }
    turn.costBefore = turn.ctx.sessionBefore?.costUsd ?? 0;
    return turn.costBefore > 0;
  }

  /**
   * Antigravity ended the prompt while children it launched still work
   * (`detached.ts`). The turn stays open, so Stop is there and the idle window
   * does not close the process under them, and stays the current one, so the
   * reply the agent starts on its own once they report is drawn into it. It
   * ends once every child reported, the agent owes no reply, no tool that
   * reply started still runs, nothing waits for the user and the session
   * went quiet; a stop or the process's end settles it instead.
   */
  async #holdForDetached(turn: AcpTurn, sessionId: string): Promise<void> {
    const home = this.#geminiHome;
    if (home === null) return;
    // Before any await: a tool the reply starts while the records are read is the reply's.
    const prompted = turn.toolCallIds();
    this.#holding = turn;
    // The quiet counts from the last update or the last poll that found work.
    let busyAt = Date.now();
    try {
      const first = await readDetachedWork(home, sessionId, prompted).catch(() => null);
      if (first === null || first.launched === 0) return;
      turn.ctx.log('info', `acp: the prompt ended with ${first.atWork} of the ${first.launched} children it launched at work; the turn waits for their reports and the agent's reply`);
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, DETACHED_POLL_MS));
        if (this.#ended || turn.settled || turn.isStopped) return;
        const work = await readDetachedWork(home, sessionId, turn.toolCallIds()).catch(() => null);
        if (this.#ended || turn.settled || turn.isStopped) return;
        // A wake can leave its transcript pending after an execution error.
        // Other work still holds the reply open until it finishes.
        const busy = (work !== null && work.atWork > 0)
          || turn.awaitingUser
          || turn.hasRunningTool(prompted)
          || (!turn.hasExecutionError && await readPendingReply(home, sessionId).catch(() => false));
        if (busy) {
          busyAt = Date.now();
          continue;
        }
        if (Date.now() - Math.max(this.#lastUpdateAt, busyAt) >= DETACHED_QUIET_MS) return;
      }
    } finally {
      this.#holding = null;
    }
  }

  #endTurn(turn: AcpTurn, drop: boolean): void {
    if (this.#stopTimer !== null) {
      clearTimeout(this.#stopTimer);
      this.#stopTimer = null;
    }
    if (this.#active === turn) this.#active = null;
    this.#hasDetachedWork ||= turn.mayHaveDetachedChildren();
    // A command the prompt left running keeps the process: closing it would
    // end the command, which Stop on the idle thread does when asked.
    const outlived = !drop && !this.#closing && turn.antigravity && this.#commands.promote(turn.ctx);
    const dropping = drop || this.#closing || (!outlived && this.#retention.idleMs(this.#warmMs) <= 0);
    turn.settle();
    this.#turns.end();
    if (dropping) {
      this.#drop();
      return;
    }
    if (!this.busy() && !this.#retention.viewed) this.#armIdle();
  }

  #start(ctx: SessionContext): Promise<void> {
    this.#ctx = ctx;
    if (this.#starting === null) {
      this.#starting = noteReady(ctx, `${ctx.provider.id} ACP`, async () => {
        await this.#open(ctx);
        this.#protection?.assertReady();
        this.#protection?.assertMcpReady();
        await this.#applyControls(ctx);
        if (this.#ended) throw new Error('the acp session was closed while it started');
        this.#noteCompactionWindow(ctx);
      }, () => ({
        text: this.#loaded ? ', loaded the saved session' : this.#replaces !== null ? ', a new one replacing a session it cannot load' : '',
        data: { loaded: this.#loaded, canLoad: this.#canLoad, replaced: this.#replaces !== null, images: this.#imagesSupported },
        ...(this.#replaces !== null ? { resumed: false } : {}),
      }), () => this.#active?.isStopped === true || this.#ended || this.#closing);
    }
    return this.#starting;
  }

  async #open(ctx: SessionContext): Promise<void> {
    const sdk = await this.#deps.loadSdk();
    if (this.#ended) throw Object.assign(new Error('the acp session was closed before it started'), { abandoned: true });
    const current = () => this.#current;
    this.#mcp = sessionMcp(ctx);
    const transport = spawnTransport(ctx, this.#deps, this.#memory, current, this.#mcp);
    const child = transport.child;
    this.#geminiHome = isAntigravity(ctx.provider) ? transport.env['GEMINI_HOME'] ?? null : null;
    this.#child = child;
    this.#killTree = ctx.killTree ?? null;
    this.#protection = transport.protection;
    if (transport.native) this.#compactionBuffer = transport.buffer;
    this.#watch(child, ctx);

    const connection = await connectTransport(ctx, sdk, transport, params => this.#onUpdate(params), current);
    this.#connection = connection;
    this.#agent = connection.agent;
    const init = await initializeTransport(ctx, sdk, connection, transport.protection);
    this.#sessionMeta = init.meta;
    this.#canLoad = init.canLoad;
    this.#canDelete = init.canDelete;
    this.#imagesSupported = init.imagesSupported;
    if (!transport.native && !init.canMcpHttp) { this.#mcp?.release(); this.#mcp = null; }
    await this.#openConversation(ctx, connection.agent, child, !transport.native && init.canMcpHttp);
  }

  async #openConversation(ctx: SessionContext, agent: ClientContext, child: SpawnedChild, useMcp: boolean): Promise<void> {
    const servers = useMcp ? acpMcpServers(this.#mcp) : [];
    if (ctx.sessionId !== null && this.#canLoad) {
      const loaded = await loadConversation(ctx, ctx.sessionId, agent, child, this.#sessionMeta, this.#memory.refusedLoads, () => this.#ended, servers);
      this.#sessionId = ctx.sessionId;
      this.#loaded = true;
      this.#controls.noteSession(loaded.modes, loaded.configOptions ?? null, loaded, false);
      // A load may omit its controls; both OpenCode majors answer them, so no
      // empty session is opened for nothing. With no probe cache either, a
      // throwaway session reads them once for the account, and the next cold
      // turn of any thread starts from what it found.
      // A load that listed models answers the model question: only an effort
      // still has to be looked for.
      if (!isGrok(ctx.provider) && !this.#controls.hasOptions()
        && (ctx.thread.effort !== null || (ctx.thread.model !== AGENT_OWN_MODEL && !this.#controls.hasModels()))) {
        await this.#probeControls(ctx, agent);
      }
      return;
    }
    if (ctx.sessionId !== null) {
      // The thread has a session this agent cannot resume: its process ended
      // (the turn took it, an idle window, an archive, a restart). The new
      // session this opens is sent the conversation so far.
      ctx.log('warn', `acp: ${ctx.provider.id} cannot load a session, so this turn starts a new one carrying the conversation`);
      this.#replaces = ctx.sessionId;
    }

    const created = await newConversation(agent, this.#protection?.cwd ?? ctx.thread.cwd, this.#sessionMeta, servers);
    this.#sessionId = created.sessionId;
    this.#controls.noteSession(created.modes, created.configOptions ?? null, created, true);
    this.#controls.noteOwnModel(created.configOptions ?? null);
    this.#onOptions(created.configOptions ?? [], agentModelsOf(created)?.currentModelId ?? null);
  }

  #probeControls(ctx: SessionContext, agent: ClientContext): Promise<void> {
    return probeControls(agent, ctx.thread.cwd, this.#sessionMeta, this.#canDelete, created => {
      const { options, listed } = discoveredControls(created);
      this.seedConfig(options, listed?.currentModelId ?? null);
      this.#controls.seedListedModels(listed);
      this.#onOptions(options, listed?.currentModelId ?? null);
    });
  }

  #watch(child: SpawnedChild, ctx: SessionContext): void {
    child.stdin.on('error', () => undefined);
    stderrLines(child.stderr, (text) => {
      this.#lastStderr = text.slice(0, STDERR_MAX);
      // Antigravity writes every protocol frame to stderr as a glog info line,
      // three hundred a turn: only what the agent itself calls a warning is one.
      if (GLOG_INFO.test(text)) return;
      ctx.log('warn', `acp agent: ${this.#lastStderr}`, { kind: 'provider-output', event: 'provider.output' });
    });
    this.#exited = new Promise<number | null>((resolve) => {
      child.once('exit', (code) => {
        this.#diedAlone = !this.#closing;
        resolve(code);
        // A process that dies on its own leaves nothing reusable behind: the
        // next turn of the thread starts a fresh one.
        if (!this.#closing) this.#drop(this.#exitSentence(code), this.#exitSentence(code, true));
      });
      child.once('error', () => {
        resolve(null);
        if (!this.#closing) this.#drop();
      });
    });
  }

  /**
   * A turn whose start or prompt threw. An agent that exits on its own takes the
   * connection with it, and its exit code and last stderr line say more than
   * that. One Boite closed because of the error (a refused mode, model or load)
   * exits with the code of that kill: the error itself is the reason.
   */
  async #fail(turn: AcpTurn, error: unknown): Promise<void> {
    const code = await exitWithin(this.#exited, EXIT_GRACE_MS);
    if (code === undefined || !this.#diedAlone) turn.fail(failureText(error), logMessageOf(error));
    else turn.fail(this.#exitSentence(code), this.#exitSentence(code, true));
  }

  #exitSentence(code: number | null, diagnostic = false): string {
    return exitSentence('acp agent', code, this.#lastStderr, diagnostic);
  }

  /** The turn settles before its connection and child go through the registry. */
  #drop(reason = 'the acp session closed', diagnostic?: string): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#closing = true;
    const current = this.#current;
    this.#current = null;
    if (current !== null) {
      if (current.isStopped) current.stopNow();
      else current.fail(reason, diagnostic);
      current.settle();
    }
    this.#mcp?.release();
    this.#protection?.close(this.#exited ?? Promise.resolve());
    this.#protection = null;
    this.#idle.clear();
    this.#commands.clear();
    const connection = this.#connection;
    this.#connection = null;
    this.#agent = null;
    try {
      connection?.close();
    } catch {
      // the connection is already closed
    }
    const child = this.#child;
    this.#child = null;
    releaseChild(child, this.#killTree);
    this.#onEnded(this);
  }

  #armIdle(): void {
    this.#idle.clear();
    // The window starts once the last command that outlived its turn ended.
    if (this.#commands.outlived()) return;
    this.#idle.arm(this.#retention.idleMs(this.#warmMs));
  }

  // -- what the agent sends -------------------------------------------------

  #onUpdate(params: SessionNotification): void {
    const update = params.update;
    if (this.#sessionId !== null && params.sessionId === this.#sessionId) this.#lastUpdateAt = Date.now();
    // Not gated on `current`: this one arrives between turns as often as
    // during one, right after `session/new` or `session/load`.
    if (update.sessionUpdate === 'available_commands_update') {
      this.#ctx?.commands(commandsOf(update.availableCommands));
      return;
    }
    // Same reason: an agent announces a mode change between two turns as well
    // as during one. Dropped here, the cached id stays what the last turn set,
    // `applyMode` finds nothing to send, and the next turn runs in the agent's
    // mode instead of the user's. The thread record is not touched: the mode
    // the user picked stands. A replayed one from a `session/load` is harmless,
    // the load's own answer overwrites it right after.
    if (update.sessionUpdate === 'current_mode_update') {
      this.#controls.noteMode(update.currentModeId);
      this.#ctx?.log('info', `acp: the agent switched to the session mode ${update.currentModeId}`);
      return;
    }
    // The same announcement from an agent whose modes are a config option. Only
    // for this thread's session once it is open: a `session/load` replays the
    // options of turns long past before the session id is set, and the same
    // connection carries the throwaway session the options were discovered on,
    // whose late update would otherwise overwrite the mode kept for this one.
    if (update.sessionUpdate === 'config_option_update') {
      if (this.#sessionId !== null && params.sessionId === this.#sessionId) this.#controls.noteOptionUpdate(update.configOptions);
      return;
    }
    // A running total outside a turn is still what the next one is measured
    // from: an agent may report it while a load replays, or between turns.
    if (update.sessionUpdate === 'usage_update') {
      const cost = usdCostOf(update);
      if (cost !== null) this.#reportedCost = cost;
    }
    // This session's own: a `session/load` replays its history before the id is set.
    if (this.#ctx?.provider.quirks?.includes('antigravity') === true && params.sessionId === this.#sessionId
      && this.#commands.note(update) && !this.busy()) {
      // The last command a finished turn left running ended: the warm rule applies from now.
      if (this.#retention.idleMs(this.#warmMs) <= 0) this.#drop();
      else if (!this.#retention.viewed) this.#armIdle();
    }
    const turn = this.#current;
    if (turn === null) return;
    if (this.#canLoad && this.#sessionId !== null && params.sessionId === this.#sessionId
      && (update.sessionUpdate === 'agent_message_chunk' || update.sessionUpdate === 'agent_thought_chunk' || update.sessionUpdate === 'tool_call')) {
      turn.ctx.sessionAccepted?.(this.#sessionId);
    }
    drawUpdate(turn, update, params.sessionId);
  }
}

/**
 * What a session was started with and cannot be told to change. A turn that
 * differs on any of it needs its own. The model and the effort are deliberately
 * not in here: ACP changes them in place with `session/set_config_option`, and
 * Grok with `session/set_model`, so a warm session follows the thread. Neither
 * is the permission mode for an agent that takes it as a `session/set_mode`; it
 * is in here for Grok alone, whose mode is a command line option, so a change
 * there drops the process the way it does for Codex.
 */
export function sessionKey(ctx: SessionContext): string {
  return JSON.stringify({
    mcp: ctx.thread.contextMode?.mcp === false ? false : ctx.mcpRevision,
    protection: ctx.protectedExecution?.fingerprint ?? null,
    permissionMode: isGrok(ctx.provider) ? ctx.thread.permissionMode : null,
    cwd: ctx.thread.cwd,
    contextMode: ctx.thread.contextMode,
    launch: profileFor(ctx.provider),
    accountId: ctx.account.id,
    providerId: ctx.provider.id,
    env: ctx.accountEnv,
  });
}
