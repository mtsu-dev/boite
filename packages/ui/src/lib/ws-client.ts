// Owns the WebSocket client lifecycle, authentication and reconnect state.
import { secureId } from './secure-id';
import { RELEASE_VERSION } from './release';
import { signedUngrouped, type DeviceKey } from './device-key';
import {
  PROTOCOL_VERSION, RPC_CHUNK_BYTES, RPC_MAX_FRAME_BYTES, RpcCloseCode, RpcErrorCode,
  type ClientName, type CoreInfo, type DeviceHello, type Principal, type UngroupedData,
  type RpcEventName, type RpcMethodName, type RpcParams, type RpcResult, type StreamChannel, type ThreadId
} from '@boite/contracts';
import type { CallOptions, ClientState, EventHandler, FrameSocket, ObservableClient, Session, SocketLike, WsClientOptions } from './client';
import { RpcFailure, closedFailure, droppedFailure, transportFailure, unansweredFailure } from './rpc-error';
import { receiveFrame, type Pending } from './ws-client-frames';
import {
  IDLE_PROBE_MS, PROBE_DEADLINE_MS, QUIET_CALL_MS, RACE_AFTER_HIDDEN_MS, RESUME_PROBE_MS, MESSAGE_TOO_BIG, STEADY_MS, UPLOAD_FLOOR_BYTES_PER_S,
  browserSocket, defaultBackoff, frameBytes, isLoopbackUrl, megabytes, openDeadline, pageHidden, quickRetry, rpcUrl, streamUrl
} from './ws-client-utils';

/**
 * A socket `resume()` opens beside the one the client has, before it knows
 * whether that one is dead. Its frames stay aside, in `pending`, until it wins:
 * `claim()` says whether it still may.
 */
interface Candidate {
  pending: Map<number, Pending>;
  claim: () => boolean;
  /** Set by `#open`: ends the attempt and closes its socket without a word to the client. */
  cancel: () => void;
}

const NO_HANDLERS = new Map<string, Set<(payload: unknown) => void>>();
const RESUMED = 'connection resumed; check the conversation before resending';

/** Closes a socket with its handlers taken off first, so its close reaches nothing. */
function closeQuietly(socket: SocketLike): void {
  socket.onopen = null;
  socket.onmessage = null;
  socket.onclose = null;
  socket.onerror = null;
  socket.close();
}

export class WsClient implements ObservableClient {
  #options: Required<Omit<WsClientOptions, 'clientName' | 'version' | 'device' | 'grant' | 'ticket' | 'paired' | 'relay' | 'signer' | 'onDevice' | 'onSession' | 'onRevoked' | 'onUnauthorized' | 'onUngrouped'>> & {
    clientName: ClientName;
    version: string;
    device: () => string | null;
  };
  /** Spent on the first hello that answers; a refused grant is not retried. */
  #grant: string | null;
  /** Spent like the grant. A ticket the core refused is asked for again from the member that vouches. */
  #ticket: string | null;
  /**
   * Repeated on every grant hello, retries included, so a retry after an
   * answer lost on the way gets the session the core already made for it.
   * Memory only, like the grant.
   */
  #nonce: string;
  /** The token is a pairing's session key, so a hello it no longer opens is a revoke. */
  #paired: boolean;
  #relay: (() => string | DeviceHello | null) | null;
  #signer: { key: DeviceKey | null; ready: Promise<DeviceKey>; coreId: string | null } | null;
  #onDevice: ((device: string, coreId: string) => unknown) | null;
  #onSession: ((session: Session) => unknown) | null;
  #onRevoked: (() => void) | null;
  #onUnauthorized: ((error: RpcFailure) => void) | null;
  #onUngrouped: (() => void) | null;
  #principal: Principal | null = null;
  #socket: SocketLike | null = null;
  #state: ClientState = 'idle';
  #core: CoreInfo | null = null;
  #clockOffset = 0;
  /** How far `#clockOffset` can be off: half the round trip that measured it, rounded up to cover the offset's own rounding. */
  #clockError = 0;
  #nextId = 1;
  #pending = new Map<number, Pending>();
  #handlers = new Map<string, Set<(payload: unknown) => void>>();
  #stateHandlers = new Set<(state: ClientState) => void>();
  #clockHandlers = new Set<(offset: number) => void>();
  /** The threads this socket follows, with the stream channels it last asked for each: a reconnect asks the same. */
  #subscribed = new Map<ThreadId, StreamChannel[] | undefined>();
  #attempt = 0;
  #recovered = false;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #manuallyClosed = false;
  #opening: Promise<CoreInfo> | null = null;
  #cancelOpen: (() => void) | null = null;
  /** Remote sockets are probed when silent; a loopback one never goes half-open. */
  #remote: boolean;
  #lastFrameAt = 0;
  /** Frames received on this client: a call compares it with the count it was sent at, two of which may share a millisecond. */
  #framesReceived = 0;
  /** Bytes sent since the last frame arrived: the core answers nothing before it has read them. */
  #sentSinceFrame = 0;
  #liveness: ReturnType<typeof setTimeout> | null = null;
  /** The one probe in flight: settled true by any frame, false by its deadline or a teardown. */
  #probe: { socket: SocketLike; result: Promise<boolean>; settle: (alive: boolean) => void } | null = null;
  /** The one race `resume()` runs after a long absence, never two: settles true once nothing more is needed. */
  #race: { candidate: Candidate; done: Promise<boolean> } | null = null;
  /** When the socket in use said hello: one lost sooner than `STEADY_MS` after it is a drop in a loop. */
  #readyAt = 0;
  /** Ready sockets lost in a row, each within `STEADY_MS` of its hello. */
  #flaps = 0;

  constructor(options: WsClientOptions) {
    this.#options = {
      url: options.url,
      token: options.token,
      clientName: options.clientName ?? 'shell',
      version: options.version ?? RELEASE_VERSION,
      device: options.device ?? (() => null),
      socketFactory: options.socketFactory ?? browserSocket,
      reconnect: options.reconnect ?? true,
      backoff: options.backoff ?? defaultBackoff,
      openDeadline: options.openDeadline ?? openDeadline
    };
    this.#grant = options.grant ?? null;
    this.#ticket = options.ticket ?? null;
    this.#nonce = this.#grant === null ? '' : secureId();
    this.#signer = null;
    if (options.signer !== undefined) {
      const signer: { key: DeviceKey | null; ready: Promise<DeviceKey>; coreId: string | null } = { key: null, ready: options.signer.key(), coreId: options.signer.coreId };
      void signer.ready.then((key) => { signer.key = key; }, () => undefined);
      this.#signer = signer;
    }
    this.#onDevice = options.onDevice ?? null;
    this.#paired = options.paired ?? (options.grant !== undefined || options.ticket !== undefined || this.#signer !== null);
    this.#relay = options.relay ?? null;
    this.#onSession = options.onSession ?? null;
    this.#onRevoked = options.onRevoked ?? null;
    this.#onUnauthorized = options.onUnauthorized ?? null;
    this.#onUngrouped = options.onUngrouped ?? null;
    this.#remote = !isLoopbackUrl(options.url);
  }

  get state(): ClientState {
    return this.#state;
  }

  /** A socket to another machine, which can go half-open; the shell's own core and a page on its machine cannot. */
  get remote(): boolean {
    return this.#remote;
  }

  /** Whether the last hello that succeeded came after failed attempts of this client's own backoff. */
  get recovered(): boolean {
    return this.#recovered;
  }

  get principal(): Principal | null {
    return this.#principal;
  }

  /** The id of the device key this client signs with, once loaded; null for a client with no device key. */
  get deviceId(): string | null {
    return this.#signer?.key?.id ?? null;
  }

  get core(): CoreInfo | null {
    return this.#core;
  }

  get clockOffset(): number {
    return this.#clockOffset;
  }

  onState(handler: (state: ClientState) => void): () => void {
    this.#stateHandlers.add(handler);
    return () => this.#stateHandlers.delete(handler);
  }

  onClockOffset(handler: (offset: number) => void): () => void {
    this.#clockHandlers.add(handler);
    return () => this.#clockHandlers.delete(handler);
  }

  on<E extends RpcEventName>(event: E, handler: EventHandler<E>): () => void {
    let set = this.#handlers.get(event);
    if (!set) {
      set = new Set();
      this.#handlers.set(event, set);
    }
    const erased = handler as (payload: unknown) => void;
    set.add(erased);
    return () => {
      set.delete(erased);
    };
  }

  connect(): Promise<CoreInfo> {
    if (this.#state === 'ready' && this.#core) return Promise.resolve(this.#core);
    if (this.#opening) return this.#opening;
    this.#manuallyClosed = false;
    return this.#startOpen();
  }

  /**
   * Back from hidden, back online, out of the back/forward cache or out of a
   * system sleep; `away` is how long the page was gone, in ms. A mobile browser
   * can keep a dead socket after sleep without firing close, but most of the
   * time the socket is fine: it is probed first, and only a socket that stays
   * silent is replaced, rejecting the calls it carried. Away `RACE_AFTER_HIDDEN_MS`
   * or more, a remote socket is not waited on: a new one opens beside the probe
   * and whichever answers first is kept (`#raceFor`).
   */
  async resume(away = 0): Promise<void> {
    if (this.#manuallyClosed || this.#state === 'idle') return;
    // A one-time grant must finish its exchange before any connection replaces it.
    if ((this.#grant !== null || this.#ticket !== null) && this.#opening) { await this.#opening; return; }
    // One race at a time: a second signal of the same return waits for it.
    if (this.#race !== null) { await this.#race.done; return; }
    const socket = this.#socket;
    if (this.#state === 'ready' && socket !== null) {
      const race = this.#remote && away >= RACE_AFTER_HIDDEN_MS && this.#grant === null && this.#ticket === null;
      if (race ? await this.#raceFor(socket) : await this.#probeSocket(socket, RESUME_PROBE_MS)) return;
      // Closed meanwhile, or already replaced by a socket of its own.
      if (this.#manuallyClosed || (this.#socket !== null && this.#socket !== socket)) return;
    }
    if (this.#retryTimer !== null) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#teardown('connection resumed; check the conversation before resending', true);
    // The failures before the page went away say nothing of the network it came back to:
    // the new socket gets the first deadline and backoff, not the 30 s and 10 s they climbed to.
    this.#attempt = 0;
    await this.#startOpen();
  }

  /**
   * The network changed: a client waiting out its backoff, or held back while
   * the browser was offline, tries now from the first deadline. One already
   * opening is left to finish on its socket, and a wake during it joins that
   * attempt, so signals in a row never restart a slow handshake.
   */
  async wake(): Promise<void> {
    if (this.#manuallyClosed || this.#state === 'idle' || this.#state === 'ready') return;
    if (this.#race !== null) { await this.#race.done; return; }
    if (this.#opening !== null) {
      await this.#opening.then(() => undefined, () => undefined);
      return;
    }
    if (this.#retryTimer !== null) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#attempt = 0;
    await this.#startOpen();
  }

  /**
   * The browser lost its network. A remote socket seldom closes by itself then,
   * so it is asked at once and dropped when it stays silent: the header stops
   * saying connected, and the 'online' event reconnects through `resume()`.
   */
  offline(): void {
    const socket = this.#socket;
    if (!this.#remote || socket === null || this.#state !== 'ready') return;
    void this.#probeSocket(socket, RESUME_PROBE_MS).then((alive) => {
      if (!alive) this.#lost(socket);
    });
  }

  /**
   * A new socket opens at once beside the probe of `old`; the first to prove
   * alive is kept. The probe answered first: the new socket closes and nothing
   * changes. The new socket's hello first: it replaces `old` as a reconnect
   * would, the calls on `old` failing with the same message as after a probe
   * that failed. The probe failed first: `old` goes now and the new socket,
   * still on its way, is the reconnect. True once the client needs nothing more.
   */
  #raceFor(old: SocketLike): Promise<boolean> {
    // Frames on `old` since the race began: any of them proves it alive, at the very moment it lands.
    const heard = this.#framesReceived;
    let decided = false;
    const candidate: Candidate = {
      pending: new Map(),
      claim: () => {
        if (decided || this.#manuallyClosed) return false;
        if (this.#socket === old ? this.#framesReceived !== heard : this.#socket !== null) return false;
        decided = true;
        return true;
      },
      cancel: () => undefined
    };
    const opening = this.#open(candidate);
    const won = opening.then(() => true, () => false);
    const probe = this.#probeSocket(old, RESUME_PROBE_MS);
    const keepOld = (): boolean => {
      if (decided) return true;
      decided = true;
      candidate.cancel();
      return true;
    };
    const run = async (): Promise<boolean> => {
      const first = await Promise.race([probe.then((alive) => (alive ? 'alive' : 'dead')), won.then((ok) => (ok ? 'won' : 'failed'))]);
      if (first === 'won') return true;
      if (first === 'alive') return keepOld();
      if (first === 'failed') return (await probe) && keepOld();
      // Dead: unless the new socket already took over, the old one goes now and the new one, on its way, is the reconnect.
      if (!decided && !this.#manuallyClosed) {
        if (this.#socket === old) {
          this.#teardown(RESUMED, true);
          this.#setState('connecting');
          this.#attempt = 0;
        }
        if (this.#socket === null && this.#opening === null) {
          this.#opening = opening;
          this.#cancelOpen = candidate.cancel;
          void opening.finally(() => { if (this.#opening === opening) this.#opening = null; }).catch(() => undefined);
        }
      }
      return won;
    };
    const done = run().finally(() => { if (this.#race?.candidate === candidate) this.#race = null; });
    this.#race = { candidate, done };
    return done;
  }

  #startOpen(): Promise<CoreInfo> {
    const opening = this.#open();
    this.#opening = opening;
    void opening.finally(() => {
      if (this.#opening === opening) this.#opening = null;
    }).catch(() => undefined);
    return opening;
  }

  call<M extends RpcMethodName>(method: M, params: RpcParams<M>, options: CallOptions = {}): Promise<RpcResult<M>> {
    // Forget locally even when an offline host cannot acknowledge the unsubscribe.
    if (method === 'threads.unsubscribe') this.#subscribed.delete((params as RpcParams<'threads.unsubscribe'>).threadId);
    const socket = this.#socket;
    if (!socket || this.#state !== 'ready') {
      return Promise.reject(closedFailure());
    }
    return this.#send(socket, method, params, options.onProgress).then((value) => {
      if (method === 'threads.subscribe') {
        const request = params as RpcParams<'threads.subscribe'>;
        this.#subscribed.set(request.threadId, request.channels);
      } else if (method === 'threads.get' && (value as RpcResult<'threads.get'>).opened) {
        const request = params as RpcParams<'threads.get'>;
        this.#subscribed.set(request.threadId, request.channels);
        if (request.open?.previous && request.open.previous !== request.threadId) this.#subscribed.delete(request.open.previous);
      }
      return value;
    });
  }

  close(): void {
    this.#manuallyClosed = true;
    if (this.#retryTimer !== null) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
    this.#race?.candidate.cancel();
    this.#teardown('client closed');
    this.#setState('closed');
  }

  #setState(state: ClientState): void {
    if (this.#state === state) return;
    this.#state = state;
    for (const handler of this.#stateHandlers) handler(state);
  }

  #send<M extends RpcMethodName>(
    socket: SocketLike,
    method: M,
    params: RpcParams<M>,
    onProgress?: (received: number, total: number) => void,
    calls: Map<number, Pending> = this.#pending
  ): Promise<RpcResult<M>> {
    // Asking for progress is what makes the core slice a long answer. A remote socket asks it of
    // every call: slices keep frames arriving while a long answer downloads, so silence there means
    // a dead link and the liveness probe may ask whatever waits.
    const sliced = onProgress !== undefined || (this.#remote && method !== 'hello');
    const frame = JSON.stringify({ jsonrpc: '2.0', id: this.#nextId, method, params, ...(sliced ? { progress: true } : {}) });
    const size = frameBytes(frame);
    if (size > RPC_MAX_FRAME_BYTES) {
      // The core would close the socket on it before reading a byte, and every
      // other call on the connection would fail with it.
      return Promise.reject(new RpcFailure({
        code: RpcErrorCode.InvalidParams,
        message: `${method} is ${megabytes(size)} MB, over the ${megabytes(RPC_MAX_FRAME_BYTES)} MB the core reads in one frame`,
        data: { bytes: size, max: RPC_MAX_FRAME_BYTES }
      }));
    }
    const id = this.#nextId++;
    const heard = this.#framesReceived;
    return new Promise<RpcResult<M>>((resolve, reject) => {
      // A call that hears nothing at all on a remote socket asks whether the machine is still there,
      // so a click on a conversation of a machine whose link died gets its offline state within the
      // probe's deadline rather than once the call's two minutes are spent.
      const watch = this.#remote && method !== 'hello' && this.#sliced()
        ? setTimeout(() => { if (this.#framesReceived === heard) this.#suspect(socket); }, QUIET_CALL_MS)
        : null;
      const expire = () => {
        calls.delete(id);
        reject(unansweredFailure(method));
        // A call that never answers is the first sign of a half-open socket:
        // ask once, and replace the socket if nothing at all comes back.
        if (method !== 'hello') this.#suspect(socket);
      };
      const wait = method === 'delegation.wait' ? Math.min(3_600_000, Math.max(0, (params as RpcParams<'delegation.wait'>).timeoutMs ?? 600_000)) + 5000 : 120_000;
      let timer = setTimeout(expire, wait);
      const pending: Pending = {
        method,
        resolve: (value) => { clearTimeout(timer); if (watch !== null) clearTimeout(watch); resolve(value as RpcResult<M>); },
        reject: (error) => { clearTimeout(timer); if (watch !== null) clearTimeout(watch); reject(error); },
        touch: () => { clearTimeout(timer); timer = setTimeout(expire, wait); },
        ...(onProgress ? { onProgress } : {})
      };
      calls.set(id, pending);
      try { socket.send(frame); if (calls === this.#pending) this.#sentSinceFrame += size; }
      catch (error) {
        calls.delete(id);
        pending.reject(error instanceof Error ? error : transportFailure(String(error)));
      }
    });
  }

  /** A socket of its own beside the RPC one, to the same core: frames never wait behind an answer, nor an answer behind frames. */
  frames(path: string): FrameSocket {
    const socket = new WebSocket(streamUrl(this.#options.url, path));
    socket.binaryType = 'arraybuffer';
    let closed = false;
    const pending: string[] = [];
    const frames: FrameSocket = {
      onmessage: null,
      onclose: null,
      send: (text) => {
        if (closed) return;
        if (socket.readyState === WebSocket.OPEN) socket.send(text);
        else if (socket.readyState === WebSocket.CONNECTING) pending.push(text);
      },
      close: () => { closed = true; pending.length = 0; socket.close(); },
    };
    socket.onopen = () => { if (!closed) for (const text of pending.splice(0)) socket.send(text); };
    socket.onmessage = (event) => { if (!closed) frames.onmessage?.(event.data as string | ArrayBuffer); };
    socket.onclose = (event) => { pending.length = 0; if (!closed) { closed = true; frames.onclose?.(event.code); } };
    return frames;
  }

  /**
   * `candidate`: a socket beside the one the client has, which takes its place
   * only once its hello answered and `candidate.claim()` agrees (`#promote`).
   * Until then nothing it does reaches the client: a failure closes it quietly.
   */
  #open(candidate: Candidate | null = null): Promise<CoreInfo> {
    if (candidate === null) {
      this.#setState('connecting');
      this.#sentSinceFrame = 0;
    }
    const socket = this.#options.socketFactory(rpcUrl(this.#options.url));
    if (candidate === null) this.#socket = socket;
    // A candidate still beside the client's socket, or one that lost: never the client's.
    const aside = (): boolean => candidate !== null && this.#socket !== socket;

    // A candidate opens on a network the page just came back to: the first deadline, as `resume()` gives.
    const deadline = this.#options.openDeadline(candidate === null ? this.#attempt : 0);
    return new Promise<CoreInfo>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        fail(`connection did not answer within ${deadline / 1000} seconds`);
        socket.close();
      }, deadline);
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(transportFailure(message));
      };
      /** A candidate that will not be the client's: its attempt ends and its socket closes, unheard. */
      const dropAside = (message: string): void => {
        fail(message);
        closeQuietly(socket);
        if (candidate !== null) this.#dropPending(message, false, candidate.pending);
      };
      if (candidate === null) this.#cancelOpen = () => fail('connection replaced');
      else candidate.cancel = () => dropAside('connection replaced');

      socket.onmessage = (event) => {
        if (!aside()) this.#receive(event.data);
        else if (candidate !== null) this.#receiveAside(event.data, candidate.pending);
      };
      socket.onerror = () => fail('socket error');
      socket.onclose = (event) => {
        if (aside()) { dropAside('connection closed'); return; }
        const wasReady = this.#state === 'ready';
        if (wasReady && event?.code === RpcCloseCode.DeviceRevoked && this.#signer !== null) {
          this.#onRevoked?.();
          this.close();
          return;
        }
        const incompatible = event?.code === RpcCloseCode.ProtocolMismatch;
        if (incompatible) this.#manuallyClosed = true;
        const reason = event?.code === MESSAGE_TOO_BIG
          ? `the core refused a frame over ${megabytes(RPC_MAX_FRAME_BYTES)} MB and closed the connection`
          : 'connection closed';
        this.#dropPending(reason, !incompatible && event?.code !== MESSAGE_TOO_BIG);
        this.#stopLiveness();
        this.#socket = null;
        fail(incompatible ? `core protocol version must be ${PROTOCOL_VERSION}` : reason);
        if (this.#manuallyClosed || !this.#options.reconnect) {
          this.#setState('closed');
          return;
        }
        this.#setState('connecting');
        this.#scheduleRetry(wasReady ? 'lost' : null);
      };
      socket.onopen = () => {
        // The device key loads beside the socket: the hello waits for it, once.
        const signer = this.#signer;
        if (signer !== null && signer.key === null) {
          signer.ready.then(() => { if ((candidate !== null || this.#socket === socket) && !settled) socket.onopen?.(); }, () => {
            // A candidate leaves the verdict to the reconnect that follows if the old socket is dead too.
            if (aside()) { dropAside('this device could not read or make its key'); return; }
            this.#manuallyClosed = true;
            fail('this device could not read or make its key');
            socket.close();
          });
          return;
        }
        const grant = this.#grant ?? this.#ticket;
        // The relay's key goes on the hello that opens the socket only: the member takes it out there,
        // and a liveness hello later would carry it to the machine at the end.
        const relay = this.#relay?.() ?? null;
        if (this.#relay !== null && relay === null) {
          if (aside()) { dropAside('this device is no longer paired with the machine that carried it there'); return; }
          this.#manuallyClosed = true;
          fail('this device is no longer paired with the machine that carried it there');
          socket.close();
          return;
        }
        const hello = this.#helloParams();
        // The machine this hello is signed for, and its nonce: what a refusal saying it is in no group must be signed over.
        const meant = hello.device !== undefined && 'nonce' in hello.device ? { coreId: signer?.coreId ?? null, nonce: hello.device.nonce } : null;
        const sentAt = Date.now();
        this.#send(socket, 'hello', { ...hello, ...(relay === null ? {} : { relay }) }, undefined, candidate?.pending ?? this.#pending).then(
          (result) => {
            if (aside()) {
              // The old socket proved alive first, or the client closed: this one goes, unheard.
              if (settled || candidate === null || !candidate.claim()) { dropAside('connection replaced'); return; }
              this.#promote(socket, candidate);
            }
            if (result.core.protocolVersion !== PROTOCOL_VERSION) {
              this.#manuallyClosed = true;
              fail(`core protocol version must be ${PROTOCOL_VERSION}`);
              socket.close();
              return;
            }
            // A key is only taken from a core that was shown a grant or a ticket: one that answers a
            // plain token with a new key has no business handing it, and is not written down as paired.
            // A device key the core just let into its group: from here on every hello is signed for that machine.
            if (result.device && grant !== null && this.#signer !== null && result.core.coreId) {
              this.#grant = null;
              this.#ticket = null;
              this.#paired = true;
              this.#signer.coreId = result.core.coreId;
              if (this.#onDevice?.(result.device, result.core.coreId) === false) {
                this.#manuallyClosed = true;
                fail('the device could not be added here');
                socket.close();
                return;
              }
            } else if (result.session && grant !== null) {
              // The grant is spent: from here on this client is its session.
              this.#grant = null;
              this.#ticket = null;
              this.#paired = true;
              this.#options.token = result.session.token;
              // The caller may refuse the key: the machine was dropped while its ticket was being exchanged.
              if (this.#onSession?.(result.session) === false) {
                this.#manuallyClosed = true;
                fail('the machine left its group while it was being reached');
                socket.close();
                return;
              }
            }
            this.#principal = result.principal;
            // A `resume()` starts from 0: the retry it made does not count as coming back alone.
            this.#recovered = this.#attempt > 0;
            this.#attempt = 0;
            this.#core = result.core;
            this.#lastFrameAt = Date.now();
            this.#readyAt = this.#lastFrameAt;
            // The core read its clock halfway through the round trip, as far as this side can tell.
            this.#clockOffset = typeof result.core.now === 'number' ? Math.round(result.core.now - (sentAt + this.#lastFrameAt) / 2) : 0;
            this.#clockError = Math.ceil((this.#lastFrameAt - sentAt) / 2);
            this.#setState('ready');
            this.#armLiveness(IDLE_PROBE_MS);
            this.#resubscribe(socket);
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              resolve(result.core);
            }
          },
          (error: unknown) => {
            // A candidate refused is no verdict on the client: the reconnect after a dead probe hears it again.
            if (aside()) { dropAside(error instanceof Error ? error.message : String(error)); return; }
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              reject(error instanceof Error ? error : transportFailure(String(error)));
            }
            // The hello parameters are fixed for this client. Retrying a
            // protocol rejection cannot make them compatible with the core,
            // and a grant the core refused once is spent or expired: the
            // retry would only say so again.
            // A session whose key stopped opening the core was revoked from
            // the desktop: retrying every ten seconds would never pair it again.
            const revoked =
              (this.#principal === 'session' || (this.#paired && grant === null)) &&
              error instanceof RpcFailure &&
              error.code === RpcErrorCode.Unauthorized;
            // A key another machine refused stays refused: only the core this
            // shell started changes its token under a client, on a restart, and
            // that one is followed through the retries.
            const refused = this.#remote && error instanceof RpcFailure && error.code === RpcErrorCode.Unauthorized;
            const permanent =
              revoked ||
              refused ||
              (error instanceof RpcFailure &&
                (error.code === RpcErrorCode.InvalidParams || (grant !== null && error.code === RpcErrorCode.Unauthorized)));
            if (error instanceof RpcFailure && error.code === RpcErrorCode.Unauthorized) this.#onUnauthorized?.(error);
            // Out of every group, the machine says so under its key: tried again all the same, as a group that lets it in
            // again tells it of this device. Unsigned, or signed by another machine, it is heard as "come back".
            if (error instanceof RpcFailure && error.code === RpcErrorCode.Unavailable && (error.data as Partial<UngroupedData> | undefined)?.reason === 'ungrouped' && meant?.coreId) {
              void signedUngrouped(meant.coreId, meant.nonce, error.data).then((said) => { if (said && this.#state !== 'ready') this.#onUngrouped?.(); });
            }
            if (permanent) this.close();
            else socket.close();
            if (revoked) this.#onRevoked?.();
          }
        );
      };
    });
  }

  /**
   * The candidate's hello answered first: it becomes the client's socket the
   * way a reconnect makes one, the old socket closed and its calls failed as
   * `resume()` fails them, the state through `connecting` so the store reloads
   * what it missed. The hello's own answer then sets the clock, the principal
   * and the subscriptions as for any new socket.
   */
  #promote(socket: SocketLike, candidate: Candidate): void {
    if (this.#race?.candidate === candidate) this.#race = null;
    if (this.#socket !== null) this.#teardown(RESUMED, true);
    this.#socket = socket;
    this.#sentSinceFrame = 0;
    this.#cancelOpen = null;
    for (const [id, entry] of candidate.pending) this.#pending.set(id, entry);
    candidate.pending.clear();
    this.#attempt = 0;
    this.#setState('connecting');
  }

  /** A candidate's frames before it wins: answers to its own calls, no event reaches a handler. */
  #receiveAside(raw: unknown, pending: Map<number, Pending>): void {
    receiveFrame(raw, pending, NO_HANDLERS, (whole) => this.#receiveAside(whole, pending));
  }

  #helloParams(): RpcParams<'hello'> {
    const device = this.#options.device();
    const signer = this.#signer;
    const key = signer?.key ?? null;
    const credential: Partial<RpcParams<'hello'>> = signer !== null && key !== null && this.#grant !== null
      ? { grant: this.#grant, nonce: this.#nonce, device: key.admit(this.#grant, device ?? this.#options.clientName) }
      : signer !== null && key !== null && signer.coreId !== null ? { device: key.hello(signer.coreId) }
      : this.#ticket !== null ? { ticket: this.#ticket }
      : this.#grant === null ? { token: this.#options.token } : { grant: this.#grant, nonce: this.#nonce };
    return {
      ...credential,
      protocolVersion: PROTOCOL_VERSION,
      client: { name: this.#options.clientName, version: this.#options.version, ...(device ? { device } : {}) },
      // Load samples as `thread.load` alone; an older core ignores this and sends whole rows.
      accepts: ['thread.load']
    };
  }

  /**
   * Whether anything at all arrives on `socket` within `deadlineMs`. The
   * question is a `hello`, which the core answers on an authenticated
   * connection with its info and nothing else, for every principal; any frame,
   * an event included, counts as the answer. The core reads no params on that
   * hello, so it carries no credential: no device signature every 25 s, no
   * token repeated on the wire.
   */
  #probeSocket(socket: SocketLike, deadlineMs: number): Promise<boolean> {
    if (this.#probe?.socket === socket) return this.#probe.result;
    let settle: (alive: boolean) => void = () => undefined;
    // The hello waits behind what this client still uploads, a picture in a prompt on a slow uplink:
    // the deadline grows by the time those bytes take at the slowest rate a link is still trusted with.
    const behind = Math.ceil((Math.max(0, this.#sentSinceFrame - RPC_CHUNK_BYTES) / UPLOAD_FLOOR_BYTES_PER_S) * 1000);
    const result = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => settle(false), deadlineMs + behind);
      settle = (alive) => {
        clearTimeout(timer);
        if (this.#probe?.socket === socket) this.#probe = null;
        resolve(alive);
      };
    });
    this.#probe = { socket, result, settle };
    const sentAt = Date.now();
    void this.#send(socket, 'hello', { protocolVersion: PROTOCOL_VERSION, client: { name: this.#options.clientName, version: this.#options.version } })
      .then((answer) => this.#retime(answer.core.now, sentAt), () => undefined);
    return result;
  }

  /**
   * A probe's hello measures the clocks again, for a device that corrected
   * its own on a live socket, back from sleep. Less than a second apart is
   * round-trip noise, which would only make a counter skip. The middle of a
   * trip is off by at most half of it: a sample no more precise than the
   * offset it would replace counts only when the two ranges cannot meet, so
   * slow hellos held behind an upload never swap one guess for another, while
   * a clock set right still shows.
   */
  #retime(now: number | undefined, sentAt: number): void {
    if (typeof now !== 'number') return;
    const back = Date.now();
    const offset = Math.round(now - (sentAt + back) / 2);
    const error = Math.ceil((back - sentAt) / 2);
    const shift = Math.abs(offset - this.#clockOffset);
    if (shift < 1000 || (error >= this.#clockError && shift <= error + this.#clockError)) return;
    this.#clockOffset = offset;
    this.#clockError = error;
    for (const handler of this.#clockHandlers) handler(offset);
  }

  #suspect(socket: SocketLike): void {
    if (this.#socket !== socket || this.#state !== 'ready') return;
    void this.#probeSocket(socket, PROBE_DEADLINE_MS).then((alive) => {
      if (!alive) this.#lost(socket);
    });
  }

  /** The socket stopped answering without closing: the same path as a close. */
  #lost(socket: SocketLike): void {
    if (this.#socket !== socket || this.#manuallyClosed) return;
    this.#teardown('connection lost; check the conversation before resending', true);
    if (!this.#options.reconnect) {
      this.#setState('closed');
      return;
    }
    this.#setState('connecting');
    this.#attempt = 0;
    this.#scheduleRetry('probe');
  }

  /** One timer per ready remote socket, re-armed from its own callback rather than on every frame. */
  #armLiveness(delayMs: number): void {
    if (!this.#remote || this.#liveness !== null) return;
    this.#liveness = setTimeout(() => {
      this.#liveness = null;
      const socket = this.#socket;
      if (this.#state !== 'ready' || socket === null) return;
      // A hidden page is not probed: `resume()` checks the socket on the way back.
      if (pageHidden()) { this.#armLiveness(IDLE_PROBE_MS); return; }
      const quiet = Date.now() - this.#lastFrameAt;
      if (quiet < IDLE_PROBE_MS) { this.#armLiveness(IDLE_PROBE_MS - quiet); return; }
      // A core that answers in one frame may still be downloading the answer a call waits for:
      // that call's own timeout asks the socket instead.
      if (!this.#sliced() && this.#awaitingAnswer()) { this.#armLiveness(IDLE_PROBE_MS); return; }
      void this.#probeSocket(socket, PROBE_DEADLINE_MS).then((alive) => {
        if (alive) this.#armLiveness(IDLE_PROBE_MS);
        else this.#lost(socket);
      });
    }, delayMs);
  }

  /** Whether a caller's request is still waiting; a probe's own hello does not count. */
  #awaitingAnswer(): boolean {
    for (const pending of this.#pending.values()) if (pending.method !== 'hello') return true;
    return false;
  }

  /** The core slices every long answer this client asks for (`features.chunkedAnswers`): silence is a dead link, never a frame still downloading. */
  #sliced(): boolean {
    return this.#core?.features?.chunkedAnswers === true;
  }

  #stopLiveness(): void {
    if (this.#liveness !== null) clearTimeout(this.#liveness);
    this.#liveness = null;
    this.#probe?.settle(false);
  }

  #resubscribe(socket: SocketLike): void {
    for (const [threadId, channels] of this.#subscribed) {
      void this.#send(socket, 'threads.subscribe', { threadId, ...(channels ? { channels } : {}) }).catch(() => undefined);
    }
  }

  /**
   * `lost`: a socket that was ready closed; `probe`: one stopped answering.
   * Either way the first retry goes almost at once: with no wait at all after
   * a probe, which already waited its deadline, and `quickRetry` after a close,
   * unless the socket closed within `STEADY_MS` of its hello: a host dropping
   * in a loop waits the backoff, longer at each drop in a row. The attempt
   * counts all the same, so a retry that fails waits `backoff(1)`. Offline too, the retries go on with their backoff: a browser
   * that says offline is often wrong, and the 'online' event still calls
   * `resume()` at once.
   */
  #scheduleRetry(after: 'lost' | 'probe' | null = null): void {
    // A race's candidate is on its way: it is the retry, and the race opens another if it fails.
    if (this.#retryTimer !== null || this.#race !== null) return;
    if (after === 'probe') {
      this.#attempt += 1;
      void this.#startOpen().catch(() => undefined);
      return;
    }
    let delay = this.#options.backoff(this.#attempt);
    if (after === 'lost') {
      this.#flaps = Date.now() - this.#readyAt < STEADY_MS ? this.#flaps + 1 : 0;
      delay = this.#flaps > 0 ? this.#options.backoff(this.#flaps - 1) : quickRetry();
    }
    this.#attempt += 1;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      if (this.#manuallyClosed) return;
      void this.#startOpen().catch(() => undefined);
    }, delay);
  }

  /** `dropped`: the socket went under the calls, which a reconnect may answer when asked again. */
  #dropPending(message: string, dropped = false, calls: Map<number, Pending> = this.#pending): void {
    const pending = [...calls.values()];
    calls.clear();
    for (const entry of pending) entry.reject(dropped ? droppedFailure(message) : transportFailure(message));
  }

  #teardown(message: string, dropped = false): void {
    this.#stopLiveness();
    this.#cancelOpen?.();
    this.#cancelOpen = null;
    this.#opening = null;
    const socket = this.#socket;
    this.#socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
    this.#dropPending(message, dropped);
  }

  #receive(raw: unknown): void {
    this.#lastFrameAt = Date.now();
    this.#framesReceived += 1;
    this.#sentSinceFrame = 0;
    this.#probe?.settle(true);
    receiveFrame(raw, this.#pending, this.#handlers, (whole) => this.#receive(whole));
  }
}
