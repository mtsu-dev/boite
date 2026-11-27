import { logMessageOf } from '../../log-errors.ts';
import { mkdirSync } from 'node:fs';
import {join} from 'node:path';
import { messageOf, unavailable } from '../../errors.ts';
import type { SpawnedChild } from '../../procs.ts';
import { profileFor, resolveLaunch } from '../../providers/resolve.ts';
import type { ModelInfo } from '@boite/contracts';
import type { LiveTurnSettings, SessionContext, TurnContext } from '../types.ts';
import { exitSentence, exitWithin } from '../exit.ts';
import { IdleTimer } from '../idle-timer.ts';
import { SessionTurns } from '../session-turns.ts';
import { stderrLines } from '../lines.ts';
import {
  agentEnv,
  commandsOf,
  contentText,
  contextArgs,
  imagesOf,
  numberOf,
  piCacheLife,
  sessionDirOf,
  textOf,
} from './mapping.ts';
import { AGENT_OWN_MODEL, EXIT_GRACE_MS, STDERR_MAX } from './protocol.ts';
import type { PiAssistantMessage, PiCommand, PiModel } from './protocol.ts';
import { dataOf, PiPeer } from './rpc.ts';
import { piCatalogPair, piListsPair, piModelArgs, piModelOf, piPairOf, piProfileArgs, piReadsImages } from './models.ts';
import { checkpointOf } from './session-files.ts';
import type { PiTurn } from './turn.ts';
import { answerDialog } from './dialogs.ts';
import { drawCompaction, drawEntry } from './compaction-events.ts';
import { noteReady } from '../driver-log.ts';
import { SessionRetention } from '../session-retention.ts';
import { endOnClose, releaseChild } from '../session-close.ts';
import {protectedPi} from './protected.ts';
import { writeCacheWarmingExtension } from './cache-warming.ts';
import { COMPACTION_ENV, compactOrNothing, extensionWriter, writeCompactionExtension } from './compaction.ts';

type Timer = ReturnType<typeof setTimeout>;

/**
 * How long a stopped turn waits for `agent_settled` after `abort` before the
 * process is closed. pi's abort waits for its tool trees to die, and a Windows
 * taskkill can take seconds. Leave the core's 10 s deadline as a backstop.
 */
const STOP_DEADLINE_MS = 9_000;
let stopDeadlineMs = STOP_DEADLINE_MS;
/** Control reads are bounded; the prompt and actual model run are not. */
const READ_DEADLINE_MS = 5_000;
let readDeadlineMs = READ_DEADLINE_MS;

/** Tests shorten the stop deadline; `null` puts the default back. */
export function setPiStopDeadlineForTests(ms: number | null): void {
  stopDeadlineMs = ms ?? STOP_DEADLINE_MS;
}

/** Tests shorten control reads without putting a deadline on model prompts. */
export function setPiReadDeadlineForTests(ms: number | null): void {
  readDeadlineMs = ms ?? READ_DEADLINE_MS;
}

/**
 * One `pi --mode rpc` process for a thread: launched on the thread's own
 * `--session-id` and `--session-dir`, so a later process reopens the transcript
 * the first one wrote. Viewed and prepared sessions stay resident through
 * navigation; other sessions follow the post-turn `warmProcessMinutes`
 * policy. A stop, archive, shutdown or changed setup closes the process.
 */
export class PiSession {
  #child: SpawnedChild | null = null;
  /** The old process `#reopen` waits on, which a stop or a close kills, and the wake that ends that wait. */
  #draining: { child: SpawnedChild | null; exited: Promise<number | null> | null; wake: () => void } | null = null;
  #markGone: () => void = () => {};
  /** Settles once this session has closed and its pi processes and every one before them have exited. */
  readonly gone = new Promise<void>((resolve) => { this.#markGone = resolve; });
  /**
   * The exits this session's processes wait for: the thread's previous session's, then each process a reopen
   * replaced. Unbounded: a process that outlives its stop still holds the session file.
   */
  #before: Promise<unknown>;
  #wakeOpen: () => void = () => {};
  readonly #dropped = new Promise<undefined>((resolve) => { this.#wakeOpen = () => resolve(undefined); });
  #peer: PiPeer | null = null;
  #starting: Promise<void> | null = null;

  /** The pi session id: what `ctx.sessionId` stores and the next process reopens. */
  #sessionId: string | null = null;
  #replaces: string | null = null;
  #lastStderr = '';
  #exitCode: number | null = null;
  #exited: Promise<number | null> | null = null;
  #processClosed: Promise<void> = Promise.resolve();
  readonly #idle = new IdleTimer(() => this.#drop());
  readonly #retention = new SessionRetention();
  /** The turn whose `prompt` is in flight; events outside one are dropped. */
  #current: PiTurn | null = null;
  #opening: PiTurn | null = null;
  #steered = false;
  /**
   * The turn whose prompt pi accepted. Before that, its process may still be replaced or fail a switch, and pi
   * would open a run of its own for a steer: input then waits for the next turn.
   */
  #prompted: PiTurn | null = null;
  readonly #turns = new SessionTurns<PiTurn>(turn => this.#runTurn(turn), (turn, error) => {
    turn.fail(messageOf(error));
    this.#endTurn(turn, true);
  });
  #closing = false;
  #ended = false;
  /** Ends every process of the thread: the agent and whatever its tools left running. */
  #killTree: (() => void) | null = null;
  /** The model and the thinking level the process is on, so a warm turn only sends a change. */
  #model: string | null = null;
  /** The pair pi runs `#model` as when the catalog named it, as `provider` and `modelId` in JSON; null when pi resolved the text. */
  #pair: string | null = null;
  #effort: string | null = null;
  #protection: ReturnType<typeof protectedPi> = null;

  constructor(
    readonly key: string,
    private warmMs: number,
    private readonly onEnded: (session: PiSession) => void,
    /** `BOITE_COMPACTION` for this process, null for none (`compaction.ts`). */
    readonly compaction: string | null = null,
    /** The account's probed catalog, which names the pi pair behind a model at launch. */
    private readonly catalog: (ctx: SessionContext) => readonly ModelInfo[] | null = () => null,
    /** The thread's previous session's `gone`: its pi may still write the session file this one opens. */
    previousGone: Promise<void> = Promise.resolve(),
  ) {
    this.#before = previousGone;
  }

  /**
   * Reusable only while the process is up and the turn asks for the very same
   * setup. A changed background compaction setting waits for the process to
   * be idle: a turn queued behind a running one keeps it.
   */
  usable(key: string, warmMs: number, compaction: string | null = this.compaction): boolean {
    return !this.#ended && !this.#closing && this.key === key && (compaction === this.compaction || this.busy()) && this.#retention.reusable(warmMs, this.warmMs);
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

  attach(turn: PiTurn, warmMs: number): void {
    this.warmMs = warmMs;
    this.#retention.beginTurn();
    this.#idle.clear();
    this.#turns.enqueue(turn);
  }

  /**
   * `abort` is pi's only stop; the run still settles, as aborted. A turn not
   * yet running sends nothing: `runTurn` sees the stop before its prompt.
   */
  stopTurn(turn: PiTurn): void {
    if (turn.settled) return;
    turn.markStopped();
    if (this.#opening === turn) { this.#drop(); return; }
    if (this.#current !== turn) return;
    if (turn.ctx.turn.execution?.operation === 'compact') {
      turn.settleRun();
      this.#drop();
      return;
    }
    const peer = this.#peer;
    if (peer === null) return;
    this.#abort(turn, peer);
  }

  /**
   * `abort`, after `clear_queue` when coordination steered the run, since pi
   * may continue queued steering after an abort. If the queue cannot confirm
   * it is empty within a local pipe round trip, close this process instead.
   *
   * An idle pi answers `abort` and emits nothing, which is what a prompt still
   * in preflight (an extension dialog) or an extension command leaves behind.
   * `get_state` after the answer says whether a run is still going: pi writes
   * in order, so a run that ended has sent `agent_settled` before it.
   */
  #abort(turn: PiTurn, peer: PiPeer): void {
    this.#armStopDeadline(turn);
    void this.#sendAbort(turn, peer);
  }

  async #sendAbort(turn: PiTurn, peer: PiPeer): Promise<void> {
    if (this.#steered) {
      try { await peer.command('clear_queue', {}, { timeoutMs: Math.min(EXIT_GRACE_MS, stopDeadlineMs), writeKind: 'stop' }); }
      catch (error) {
        if (this.#current !== turn || this.#peer !== peer) return;
        turn.ctx.log('warn', `pi: closing the stopped session because its queue could not be cleared: ${messageOf(error)}`);
        this.#drop();
        return;
      }
    }
    if (this.#current !== turn || this.#peer !== peer || turn.decided) return;
    try {
      await peer.command('abort', {}, { writeKind: 'stop' });
      if (this.#current !== turn || this.#peer !== peer || turn.decided) return;
      const state = await peer.command('get_state', {}, { timeoutMs: stopDeadlineMs });
      if (dataOf(state)['isStreaming'] !== true) turn.settleRun();
    } catch { /* The stop deadline closes an unresponsive session. */ }
  }

  /**
   * A pi that does not settle after `abort` (an extension tool that ignores the
   * signal, a blocked event loop) is closed: the turn ends stopped, then the
   * process and every tool it started go. Stopped first, or the child's close
   * would fail the turn.
   *
   * The deadline runs to the end of the turn, not to its decision: a stop
   * during pi's prompt preflight is decided by `get_state` while the prompt
   * still has no answer, and closing pi is what rejects that command.
   */
  #armStopDeadline(turn: PiTurn): void {
    if (turn.stopDeadline) return;
    turn.stopDeadline = true;
    const ms = stopDeadlineMs;
    const timer = setTimeout(() => {
      if (turn.settled || (turn.decided && !turn.awaitingPi)) return;
      turn.ctx.log(
        'warn',
        turn.decided
          ? `pi: the agent did not answer within ${ms / 1000} s of abort, closing it`
          : `pi: the agent did not settle within ${ms / 1000} s of abort, closing it`,
      );
      turn.settleRun();
      this.#drop();
    }, ms);
    timer.unref?.();
    void turn.done.then(() => {
      clearTimeout(timer);
    });
  }

  /** Submit input at pi's next tool boundary. */
  async steer(turn: PiTurn, message: string, attachments: TurnContext['attachments'] = [], onAccepted?: () => void, signal?: AbortSignal): Promise<boolean> {
    if (this.#current !== turn || this.#prompted !== turn || turn.decided || turn.isStopped || !this.#peer) return false;
    // A run cannot change its process: images a text-only model would drop wait for the next turn, which reopens it.
    // Nothing is written yet, so a state pi does not give refuses the steer rather than leave its delivery unconfirmed.
    const peer = this.#peer;
    if (imagesOf(attachments).length > 0 && await peer.command('get_state', {}, { signal, timeoutMs: readDeadlineMs })
      .then(state => piReadsImages(dataOf(state)['model'] as PiModel | null) === false, () => true)) return false;
    // A run that pi ended meanwhile takes no more input: a steer now would open a run of its own.
    if (this.#current !== turn || this.#prompted !== turn || turn.decided || turn.isStopped || this.#peer !== peer) return false;
    this.#steered = true;
    await peer.command('steer', { message, ...(attachments.length ? { images: imagesOf(attachments) } : {}) }, { onAccepted, signal, writeKind: 'steer' });
    return true;
  }

  /**
   * The thinking level for the model calls the running turn has not made yet.
   * pi answers `set_thinking_level` at any time and its loop reads the level
   * again before each following call (`prepareNextTurn` in pi-agent-core
   * 1.0.4, read on 2026-10-07; no live run on a pi account). pi has no speed,
   * and no level to send for a thread without effort.
   */
  async applySettings(turn: PiTurn, change: LiveTurnSettings): Promise<LiveTurnSettings> {
    if (this.#current !== turn || turn.settled || turn.isStopped || !this.#peer) return {};
    const effort = change.effort;
    if (typeof effort !== 'string' || effort.length === 0) return {};
    if (effort !== this.#effort) {
      // Live settings give up on it after their own bound; this one frees the request pi never answers.
      await this.#peer.command('set_thinking_level', { level: effort }, { timeoutMs: stopDeadlineMs });
      this.#effort = effort;
    }
    turn.ctx.thread.effort = effort;
    return { effort };
  }

  /** Archive, shutdown, an idle window, a changed setup: the process goes. */
  close(reason: string | null, ctx?: SessionContext): void {
    if (this.#ended) return;
    this.#closing = true;
    if (reason !== null && ctx !== undefined) ctx.log('warn', `pi session: ${reason}`);
    this.#drop();
  }

  // -- the turn -------------------------------------------------------------

  async #runTurn(turn: PiTurn): Promise<void> {
    // A turn stopped while it waited for the process sends nothing to the model.
    if (turn.isStopped) {
      turn.settleRun();
      this.#endTurn(turn, false);
      return;
    }
    this.#opening = turn;
    try {
      turn.ctx.protectedExecution?.check();
      await this.#start(turn.ctx);
    } catch (error) {
      if (turn.isStopped) turn.settleRun();
      else turn.fail(messageOf(error));
      this.#endTurn(turn, true);
      return;
    } finally {
      this.#opening = null;
    }

    let peer = this.#peer;
    const sessionId = this.#sessionId;
    if (peer === null || sessionId === null) {
      turn.fail('the pi session went away before the turn');
      this.#endTurn(turn, true);
      return;
    }
    if (turn.isStopped) {
      turn.settleRun();
      this.#endTurn(turn, false);
      return;
    }

    turn.noteSession(sessionId);
    this.#current = turn;
    this.#steered = false;
    turn.awaitingPi = true;
    try {
      // A model pi registered after this process started takes a new one, which may hold another session id.
      peer = await this.#align(turn, peer);
      if (turn.isStopped) {
        turn.settleRun();
      } else if (turn.ctx.turn.execution?.operation === 'compact') {
        const outcome = await compactOrNothing(peer);
        if ('nothing' in outcome) {
          turn.part(turn.takeIndex(), { type: 'notice', notice: { kind: 'nothing_to_compact' }, detail: outcome.nothing });
        } else {
          const { result } = outcome;
          if (result.usage !== undefined && result.usage !== null) turn.addUsage(result.usage);
          turn.part(turn.takeIndex(), {
            type: 'compaction',
            trigger: 'manual',
            preTokens: numberOf(result.tokensBefore) ?? turn.ctx.thread.context?.tokens ?? null,
            postTokens: numberOf(result.estimatedTokensAfter),
          });
        }
        turn.settleRun();
      } else {
        if ((turn.ctx.ownImages ?? imagesOf(turn.ctx.attachments).length) > 0) peer = await this.#imagesReach(turn, peer);
        let prompt = turn.ctx.prompt, attachments = turn.ctx.attachments;
        if (this.#replaces !== null && this.#replaces === turn.ctx.sessionId) {
          this.#replaces = null;
          const carried = await turn.ctx.continuation?.();
          if (!carried) throw new Error('execution.pi.history: a protected cold start requires the captured conversation continuation');
          prompt = carried.prompt; attachments = carried.attachments;
        }
        if (turn.isStopped) turn.settleRun();
        else {
          const accepted = await peer.command('prompt', {
            message: prompt,
            ...(attachments.length === 0 ? {} : { images: imagesOf(attachments) }),
          });
          // pi 1.6.1 answers `handled` for a prompt an extension command or an input hook took without a run.
          if (dataOf(accepted)['disposition'] !== 'handled') this.#prompted = turn;
          turn.ctx.inputReady?.();
          if (turn.isStopped) this.#abort(turn, peer);
          else await this.#settleIfIdle(turn, peer);
        }
      }
    } catch (error) {
      turn.awaitingPi = false;
      // A child that died takes the pipe with it, and its exit says more than
      // "the command failed": give it a moment to be reported.
      const code = await exitWithin(this.#exited, EXIT_GRACE_MS, this.#processClosed);
      if (turn.isStopped) turn.settleRun();
      else turn.fail(code === undefined ? messageOf(error) : this.#exitSentence(code), code === undefined ? logMessageOf(error) : this.#exitSentence(code, true));
      this.#current = this.#prompted = null;
      this.#endTurn(turn, true);
      return;
    }
    turn.awaitingPi = false;

    await turn.finished;
    await this.#readContext(turn, peer);
    this.#current = this.#prompted = null;
    this.#endTurn(turn, turn.isStopped);
  }

  /**
   * A warm process on another model or level than the thread now wants. pi
   * takes both over RPC (`set_model`, `set_thinking_level`), so the process
   * stays. `set_model` clamps the level to the new model, so the level is sent
   * again after it. A pair the catalog found after pi read its models (at
   * start) opens a new process on it. A refusal fails the turn with pi's own
   * sentence and drops the process. Returns the peer the turn talks to.
   */
  async #align(turn: PiTurn, peer: PiPeer): Promise<PiPeer> {
    const ctx = turn.ctx;
    const model = ctx.thread.model;
    if (model === null || model === AGENT_OWN_MODEL) return peer;
    let changed = false;
    // The catalog's pair is the one image admission checked. A refresh can put another pair behind the same id, so
    // the process follows it even when the id did not change.
    const named = piCatalogPair(model, this.catalog(ctx));
    if (model !== this.#model || (named !== undefined && JSON.stringify(named) !== this.#pair)) {
      const listed: unknown = dataOf(await peer.command('get_available_models', {}, { timeoutMs: readDeadlineMs }))['models'];
      if (named !== undefined && !piListsPair(listed, named)) return turn.isStopped ? peer : await this.#reopen(turn);
      // Else pi's own listing names the pair: a provider id may hold a `/`, so the first one is not the split.
      const pair = named ?? piPairOf(listed, model);
      if (pair === undefined) throw new Error(`pi cannot switch to the model ${model}: its id is not <provider>/<id>`);
      // The same id on a process that pi launched on its text: when pi already runs the catalog's pair, a switch
      // would only reset a level pi keeps itself.
      const running = model === this.#model ? dataOf(await peer.command('get_state', {}, { timeoutMs: readDeadlineMs }))['model'] as { provider?: unknown; id?: unknown } | null | undefined : undefined;
      if (running?.provider !== pair.provider || running?.id !== pair.modelId) {
        // pi answers once its `model_select` hooks ran: one that never ends fails the turn and drops the process.
        await peer.command('set_model', pair, { timeoutMs: stopDeadlineMs });
        changed = true;
      }
      this.#model = model;
      this.#pair = named === undefined ? null : JSON.stringify(named);
    }
    const effort = ctx.thread.effort;
    if (effort !== null && (changed || effort !== this.#effort)) {
      await peer.command('set_thinking_level', { level: effort }, { timeoutMs: stopDeadlineMs });
      this.#effort = effort;
    }
    return peer;
  }

  /**
   * The process goes, the session stays: a new process opens this turn's session with the thread's model and level,
   * as a cold turn does, once the old one has exited, since pi's shutdown hooks may still write the session file. Only
   * pi itself is stopped, not what its tools left running. A stop meanwhile drops the session, as during a cold start.
   */
  async #reopen(turn: PiTurn): Promise<PiPeer> {
    this.#opening = turn;
    try {
      const child = this.#child, exited = this.#exited, closed = this.#processClosed;
      this.#protection?.close(exited ?? closed);
      this.#peer?.fail('the pi process was replaced');
      this.#protection = null; this.#peer = null; this.#child = null; this.#starting = null;
      // What a failure from here reports is the new process's exit, not the old one's, a stuck old one included.
      this.#exited = null; this.#processClosed = Promise.resolve(); this.#exitCode = null; this.#lastStderr = '';
      releaseChild(child);
      if (exited !== null) this.#before = Promise.all([this.#before, exited]);
      const code = await new Promise<number | null | undefined | 'dropped'>((resolve) => {
        this.#draining = { child, exited, wake: () => resolve('dropped') };
        // Its exit, not its pipes' close: what its tools left running may hold them.
        void exitWithin(exited, stopDeadlineMs).then(resolve);
      }).finally(() => { this.#draining = null; });
      if (code === undefined && exited !== null) {
        releaseChild(child, this.#killTree);
        throw new Error('the pi process on the previous model did not exit, so its session cannot be reopened yet');
      }
      if (turn.isStopped || this.#ended) throw new Error('the pi turn was stopped before its new process started');
      turn.ctx.log('info', `pi session: ${turn.ctx.thread.model} needs what the running process lacks, a new process opens on it`);
      await this.#start(turn.ctx);
    } finally {
      this.#opening = null;
    }
    const peer = this.#peer, sessionId = this.#sessionId;
    if (peer === null || sessionId === null) throw new Error('the pi session went away before the turn');
    turn.noteSession(sessionId);
    return peer;
  }

  /**
   * Images go only to a model pi says reads them. Admission checked the list
   * the turn was queued under, and pi reads `models.json` once: when the pair pi
   * runs (whatever the thread names) gained images after the launch, a new
   * process opens; any other text-only model fails the turn with admission's
   * sentence. A model without its inputs is pi's.
   */
  async #imagesReach(turn: PiTurn, peer: PiPeer): Promise<PiPeer> {
    const running = async (to: PiPeer) => dataOf(await to.command('get_state', {}, { timeoutMs: readDeadlineMs }))['model'] as PiModel | null | undefined;
    let model = await running(peer);
    if (piReadsImages(model) !== false) return peer;
    const ran = model;
    const listed = this.catalog(turn.ctx)?.find(entry => { const pair = piModelOf(entry); return pair !== undefined && pair.provider === ran?.provider && pair.id === ran?.id; });
    if (listed !== undefined && listed.images !== false && !turn.isStopped) {
      peer = await this.#reopen(turn);
      model = await running(peer);
      if (piReadsImages(model) !== false) return peer;
    }
    // The model that refused, the new process's after a reopen.
    throw new Error(`${model?.name || listed?.name || turn.ctx.thread.model || 'pi\'s model'} takes no images: send the prompt without them`);
  }

  /**
   * A prompt pi handled without a run: an extension command, or an input
   * handler that consumed the text. pi answers the prompt and never emits
   * `agent_settled`. pi marks a run active in the same tick it answers the
   * prompt and writes in order, so `get_state` sent now says `isStreaming` for
   * a run that started, and a run that already ended has settled before the
   * answer. A refused `get_state` leaves the turn to `agent_settled` within
   * the control-read deadline, while a reported active run has no time limit.
   */
  async #settleIfIdle(turn: PiTurn, peer: PiPeer): Promise<void> {
    if (turn.decided) return;
    const controller = new AbortController();
    let timer: Timer | undefined;
    const expired = new Promise<boolean>(resolve => {
      timer = setTimeout(() => resolve(true), readDeadlineMs);
      timer.unref?.();
    });
    try {
      const response = await Promise.race([
        peer.command('get_state', {}, { signal: controller.signal, timeoutMs: readDeadlineMs }),
        turn.finished.then(() => null),
      ]);
      if (response !== null && !turn.decided && dataOf(response)['isStreaming'] !== true) turn.settleRun();
    } catch (error) {
      if (turn.decided) return;
      turn.ctx.log('warn', `pi: get_state after the prompt failed: ${messageOf(error)}`);
      // A refused state read may precede a valid terminal event. Give that
      // event the same bounded window, then retire an unobservable command.
      if (await Promise.race([turn.finished.then(() => false), expired])) {
        if (turn.decided) return;
        if (turn.isStopped) turn.settleRun();
        else turn.fail(`pi did not report its state after accepting the prompt within ${readDeadlineMs / 1000} s`);
        this.#drop();
      }
    } finally {
      controller.abort();
      clearTimeout(timer);
    }
  }

  /**
   * The context meter, read once the run is over: `get_session_stats` carries
   * the tokens pi counts against the window. `tokens` is null right after a
   * compaction, until the next answer, so nothing is written then.
   */
  async #readContext(turn: PiTurn, peer: PiPeer): Promise<void> {
    if (this.#peer !== peer || turn.isStopped) return;
    const reading = new AbortController();
    void turn.stopped.then(() => reading.abort());
    try {
      const stats = dataOf(await peer.command('get_session_stats', {}, { signal: reading.signal, timeoutMs: Math.min(EXIT_GRACE_MS, readDeadlineMs) }));
      const usage = (stats['contextUsage'] ?? {}) as { tokens?: unknown; contextWindow?: unknown };
      const tokens = numberOf(usage.tokens);
      if (!turn.isStopped && tokens !== null) turn.ctx.context({ tokens, window: numberOf(usage.contextWindow) });
      if (!this.#protection && !turn.isStopped && turn.pendingError === null && turn.sessionId !== null
        && stats['sessionId'] === turn.sessionId && (turn.requestAt !== null || turn.ctx.turn.execution?.operation === 'compact')) {
        const path = textOf(stats['sessionFile']);
        turn.checkpoint = await checkpointOf(path, turn.sessionId, sessionDirOf(turn.ctx));
      }
    } catch (error) {
      if (!reading.signal.aborted) turn.ctx.log('warn', `pi: get_session_stats failed: ${messageOf(error)}`);
    }
  }

  #endTurn(turn: PiTurn, drop: boolean): void {
    turn.settle();
    this.#turns.end();
    if (drop || this.#closing || this.#retention.idleMs(this.warmMs) <= 0) {
      this.#drop();
      return;
    }
    if (!this.busy() && !this.#retention.viewed) this.#armIdle();
  }

  // -- the process ----------------------------------------------------------

  #start(ctx: SessionContext): Promise<void> {
    if (this.#starting === null) this.#starting = noteReady(ctx, 'pi', () => this.#open(ctx), undefined, () => this.#closing || this.#ended);
    return this.#starting;
  }

  async #open(ctx: SessionContext): Promise<void> {
    // A stop meanwhile ends the wait at once; what it waited for still holds the next session (`#drop`).
    const exited = await Promise.race([exitWithin(this.#before.then(() => 0), stopDeadlineMs), this.#dropped]);
    if (this.#ended) throw new Error('the pi session was closed before it started');
    if (exited === undefined) throw new Error(`the thread's previous pi process did not exit within ${stopDeadlineMs / 1000} s: its session opens once it has`);
    const profile = profileFor(ctx.provider);
    const launch = resolveLaunch(profile);
    if (launch === null) {
      throw unavailable(`no ${ctx.provider.id} executable on this machine`, { providerId: ctx.provider.id });
    }

    // Ordinary local sessions retain their durable native transcript.
    this.#protection = protectedPi(ctx, () => this.#current, profile?.launch?.args ?? []);
    // Protected cold starts never reopen ordinary or differently scoped native history.
    // Only the core's captured continuation may carry the previous conversation.
    const sessionId = this.#protection ? crypto.randomUUID() : ctx.sessionId ?? crypto.randomUUID();
    this.#replaces = this.#protection ? ctx.sessionId : null;
    const sessionDir = this.#protection ? join(this.#protection.directory, 'sessions') : sessionDirOf(ctx);
    try {
      mkdirSync(sessionDir, { recursive: true });
    } catch (error) {
      throw unavailable(`the pi session directory ${sessionDir} could not be made: ${messageOf(error)}`, {
        providerId: ctx.provider.id,
      });
    }

    const args = [
      ...launch.prefix,
      ...piProfileArgs(profile?.launch?.args ?? [], ctx.thread.model),
      '--session-id',
      sessionId,
      '--session-dir',
      sessionDir,
      ...piModelArgs(ctx.thread.model, ctx.thread.effort, this.catalog(ctx)),
      // Protected launch already removes every native/discovered resource.
      // --no-tools would also suppress its mandatory registered tools; the
      // captured toolsAllowed field still enforces a host tool-free context.
      ...(this.#protection ? [] : contextArgs(ctx.thread.contextMode)),
    ];
    if (this.#protection) args.push(...this.#protection.args);
    // `--extension` loads even under `--no-extensions`, as the protected one does.
    const writeExtension = this.#protection?.asset ?? extensionWriter();
    if (this.compaction !== null) args.push('--extension', writeCompactionExtension(writeExtension));
    args.push('--extension', writeCacheWarmingExtension(writeExtension));
    const child = ctx.spawnChild(launch.executable, args, {
      cwd: this.#protection?.cwd ?? ctx.thread.cwd,
      env: {...agentEnv(ctx.accountEnv), ...this.#protection?.env, ...(this.compaction === null ? {} : {[COMPACTION_ENV]: this.compaction})},
    });
    this.#child = child;
    this.#killTree = ctx.killTree ?? null;
    this.#model = ctx.thread.model;
    const launched = ctx.thread.model === null ? undefined : piCatalogPair(ctx.thread.model, this.catalog(ctx));
    this.#pair = launched === undefined ? null : JSON.stringify(launched);
    this.#effort = ctx.thread.effort;
    const peer = new PiPeer(child, {
      event: (message) => {
        if (this.#child !== child) return;
        this.#onEvent(ctx, message);
      },
      log: (level, message, context) => {
        if (this.#child !== child) return;
        ctx.log(level, message, context);
      },
      fault: (reason) => { void this.#transportFault(child, reason); },
    });
    this.#peer = peer;
    this.#sessionId = sessionId;
    this.#watch(child, ctx, peer);
    // pi's RPC mode has no approval call: there is nothing to gate a tool on, so
    // the thread's permission mode is a preference the agent never sees.
    ctx.log('info', this.#protection ? 'pi session: protected automatic tools use the captured OS capability; native approvals remain unavailable' : 'pi session: the permission mode is not enforced, pi has no approval gate in rpc mode');
    // Once per process, not per turn: `open` runs once for the life of the
    // session, memoized behind `start`. Not awaited, so a slow or unknown
    // command never holds up the turn that started this process.
    void this.#fetchCommands(ctx, peer);
    await peer.command('get_state', {}, { timeoutMs: 20_000 });
    this.#protection?.assertReady();
  }

  /** `get_commands`: a refusal or a dead peer is one warning, never a failed turn. */
  async #fetchCommands(ctx: SessionContext, peer: PiPeer): Promise<void> {
    try {
      const data = dataOf(await peer.command('get_commands'));
      const list = Array.isArray(data['commands']) ? (data['commands'] as PiCommand[]) : [];
      ctx.commands(commandsOf(list));
    } catch (error) {
      ctx.log('warn', `pi: get_commands failed: ${messageOf(error)}`);
    }
  }

  #watch(child: SpawnedChild, ctx: SessionContext, peer: PiPeer): void {
    // Refuse warm reuse immediately, without interrupting stdout drainage.
    child.stdin.once('close', () => { if (this.#child === child) this.#closing = true; });
    let closed = (): void => undefined;
    this.#processClosed = new Promise<void>(resolve => { closed = resolve; });
    // Whole lines, as every other driver reads stderr: a line cut across two
    // chunks would otherwise be logged, and quoted on exit, as two fragments.
    stderrLines(child.stderr, (text) => {
      if (this.#child !== child || text.length === 0) return;
      this.#lastStderr = text.slice(0, STDERR_MAX);
      ctx.log('warn', `pi agent: ${this.#lastStderr}`, { kind: 'provider-output', event: 'provider.output' });
    });
    this.#exited = new Promise<number | null>((resolve) => {
      child.once('exit', (code) => {
        if (this.#child === child) this.#exitCode = code;
        resolve(code);
      });
      // `close` and not `exit`: stderr is flushed by then, so the sentence the
      // turn fails with carries the line the agent printed on its way out.
      child.once('close', () => {
        closed();
        if (this.#child !== child) return;
        const sentence = this.#exitSentence(this.#exitCode);
        peer.fail(sentence, this.#exitSentence(this.#exitCode, true));
        this.#failCurrent(sentence, this.#exitSentence(this.#exitCode, true));
        if (!this.#closing) this.#drop();
      });
      child.once('error', (error) => {
        resolve(null);
        closed();
        if (this.#child !== child) return;
        const sentence = `the pi agent did not start: ${messageOf(error)}`;
        peer.fail(sentence);
        this.#failCurrent(sentence, logMessageOf(error));
        if (!this.#closing) this.#drop();
      });
    });
  }

  async #transportFault(child: SpawnedChild, reason: string): Promise<void> {
    if (this.#child !== child) return;
    this.#closing = true;
    const code = await exitWithin(this.#exited, EXIT_GRACE_MS, this.#processClosed);
    if (this.#child !== child) return;
    this.#failCurrent(code === undefined ? reason : this.#exitSentence(code), code === undefined ? reason : this.#exitSentence(code, true));
    this.#drop();
  }

  #failCurrent(reason: string, diagnostic: string): void {
    const turn = this.#current;
    if (turn?.isStopped) turn.settleRun();
    else turn?.fail(reason, diagnostic);
  }

  #exitSentence(code: number | null, diagnostic = false): string {
    return exitSentence('pi agent', code, this.#lastStderr, diagnostic);
  }

  /**
   * The one teardown: the pipes go, then the child and whatever its tools
   * started, through the registry. A turn still in flight ends here, while the
   * journal is still open, rather than from the child's `close`, which can
   * land after core shutdown closed it.
   */
  #drop(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#closing = true;
    this.#protection?.close(this.#exited ?? this.#processClosed);
    this.#protection = null;
    this.#idle.clear();
    const turn = this.#current;
    this.#current = this.#prompted = null;
    endOnClose(turn, 'the pi session was closed');
    this.#peer?.fail('the pi session was closed');
    this.#peer = null;
    const child = this.#child ?? this.#draining?.child ?? null;
    this.#child = null;
    // The thread's next session opens once this process and those it waited for have exited: their shutdown hooks may
    // still write the session file. Their exit, not their pipes' close, which a stuck grandchild may hold.
    void Promise.all([this.#before, this.#exited]).then(() => this.#markGone());
    this.#wakeOpen();
    this.#draining?.wake();
    this.#draining = null;
    // The bash tool's children (a dev server started with `&`) are not pi's to
    // reap once bash exits; the thread's tree is. On Linux and macOS the tree
    // is the direct children only, which is `kill()`.
    releaseChild(child, this.#killTree);
    this.onEnded(this);
  }

  #armIdle(): void {
    this.#idle.arm(this.#retention.idleMs(this.warmMs));
  }

  // -- what the agent sends -------------------------------------------------

  #onEvent(ctx: SessionContext, message: Record<string, unknown>): void {
    const type = message['type'];
    if (type === 'extension_ui_request') {
      void answerDialog(ctx, this.#current, this.#peer, message).catch((error) => ctx.log('warn', `pi question: ${messageOf(error)}`));
      return;
    }
    if (type === 'extension_error') {
      ctx.log('warn', `pi extension ${textOf(message['extensionPath'])}: ${textOf(message['error'])}`);
      return;
    }
    const turn = this.#current;
    if (turn === null) return;
    switch (type) {
      case 'message_update': {
        const delta = (message['assistantMessageEvent'] ?? {}) as Record<string, unknown>;
        if (delta['type'] === 'text_delta') turn.writeText(textOf(delta['delta']));
        else if (delta['type'] === 'thinking_delta') turn.writeThinking(textOf(delta['delta']));
        break;
      }
      case 'tool_execution_start': {
        const toolCallId = textOf(message['toolCallId']);
        if (toolCallId.length === 0) break;
        turn.upsertTool(toolCallId, {
          name: textOf(message['toolName']),
          input: message['args'] ?? null,
          output: null,
          status: 'running',
        });
        break;
      }
      case 'tool_execution_end': {
        const toolCallId = textOf(message['toolCallId']);
        if (toolCallId.length === 0) break;
        turn.upsertTool(toolCallId, {
          name: textOf(message['toolName']),
          output: contentText(message['result']),
          status: message['isError'] === true ? 'error' : 'done',
        });
        break;
      }
      case 'tool_execution_update':
        turn.ctx.reportProgress?.('tool', textOf(message['toolName']) || null);
        break;
      case 'message_start': {
        const started = message['message'] as { role?: unknown } | undefined;
        if (started?.role === 'assistant') {
          if (turn.sessionId !== null) turn.ctx.sessionAccepted?.(turn.sessionId);
          turn.requestAt = Date.now();
        }
        break;
      }
      case 'message_end': {
        const assistant = message['message'] as PiAssistantMessage | undefined;
        if (assistant === undefined || assistant.role !== 'assistant') break;
        if (assistant.usage !== undefined) turn.addUsage(assistant.usage);
        turn.cacheLife = piCacheLife(assistant) ?? turn.cacheLife;
        turn.noteOutcome(assistant.stopReason === 'error' ? (assistant.errorMessage ?? 'the pi agent failed the turn') : null);
        break;
      }
      case 'auto_retry_start': {
        const attempt = numberOf(message['attempt']), maxAttempts = numberOf(message['maxAttempts']), retryAfterMs = numberOf(message['delayMs']);
        turn.ctx.reportProgress?.('retrying', `${attempt ?? '?'}/${maxAttempts ?? '?'}`);
        turn.ctx.diagnostic?.('warn', `pi request failed, retry ${attempt ?? '?'} of ${maxAttempts ?? '?'} in ${retryAfterMs ?? '?'} ms: ${textOf(message['errorMessage'])}`, {
          event: 'driver.api.retry', data: { attempt, maxAttempts, retryAfterMs },
        });
        turn.ctx.log(
          'info',
          `pi: retrying the request (attempt ${attempt ?? '?'} of ${maxAttempts ?? '?'}, in ${retryAfterMs ?? '?'} ms): ${textOf(message['errorMessage'])}`,
        );
        break;
      }
      case 'auto_retry_end':
        turn.ctx.reportProgress?.('working');
        turn.ctx.diagnostic?.(message['success'] === false ? 'warn' : 'info', message['success'] === false ? `pi gave up retrying: ${textOf(message['finalError']) || turn.pendingError || 'no reason given'}` : 'pi retry succeeded', { event: 'driver.api.retry-ended', data: { success: message['success'] !== false } });
        if (message['success'] === false) {
          turn.noteOutcome(textOf(message['finalError']) || turn.pendingError || 'pi gave up retrying the request');
        }
        break;
      case 'compaction_end':
        drawCompaction(turn, message);
        break;
      case 'entry_appended':
        drawEntry(turn, message['entry']);
        break;
      case 'compaction_start':
        turn.ctx.reportProgress?.('compacting');
        break;
      case 'agent_settled':
        turn.settleRun();
        break;
      default:
        // agent_start, agent_end, turn_start, turn_end, the user's own
        // message_start, the tool_execution_update, bash and queue families:
        // the contract has no part for them, so they are dropped.
        break;
    }
  }
}
