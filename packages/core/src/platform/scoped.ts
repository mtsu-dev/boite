import type {GuardEventSink, ProcessEventSink, ProcessPlatform} from './types.ts';

interface Owner {
  id: number;
  closed: boolean;
  jobs?: ProcessEventSink;
  guards?: GuardEventSink;
  closing?: Promise<void>;
  scopes: Map<string, string>;
  pids: Map<number, {scope: string; guarded: boolean}>;
}
let nextOwner = 0;
let nextScope = 0;
const nativeScopes = new WeakMap<ProcessPlatform, (threadId: string) => string>();
/** Native diagnostics must inspect the same opaque job that the registry controls. */
export function nativeScopeOf(platform: ProcessPlatform, threadId: string): string {
  return nativeScopes.get(platform)?.(threadId) ?? threadId;
}

class PlatformScopes {
  readonly owners = new Set<Owner>();
  readonly scopes = new Map<string, {owner: Owner; threadId: string}>();
  readonly pids = new Map<number, string>();
  private releasing = false;
  constructor(readonly backend: ProcessPlatform) {}

  private readonly jobs: ProcessEventSink = {
    started: (scope, pid, info) => {const entry = this.scopes.get(scope); entry?.owner.jobs?.started(entry.threadId, pid, info);},
    exited: (scope, pid, exit) => {const entry = this.scopes.get(scope); entry?.owner.jobs?.exited(entry.threadId, pid, exit);},
    note: (scope, message) => {const entry = this.scopes.get(scope); entry?.owner.jobs?.note(entry.threadId, message);},
    memoryLimit: (scope, kind) => {
      if (scope === null) {for (const owner of this.owners) owner.jobs?.memoryLimit(null, kind);}
      else {const entry = this.scopes.get(scope); entry?.owner.jobs?.memoryLimit(entry.threadId, kind);}
    },
  };
  private readonly guards: GuardEventSink = {
    pushed: (scope, pid, title, restored) => {const entry = this.scopes.get(scope); entry?.owner.guards?.pushed(entry.threadId, pid, title, restored);},
    muted: (scope, pid) => {const entry = this.scopes.get(scope); entry?.owner.guards?.muted(entry.threadId, pid);},
    note: message => {for (const owner of this.owners) owner.guards?.note(message);},
  };

  retain(owner: Owner, jobs: ProcessEventSink, guards: GuardEventSink): void {
    if (owner.closed || owner.jobs || this.releasing) throw new Error('process platform: expected a new registry after the previous release settled');
    if (!this.owners.size) this.backend.retain(this.jobs, this.guards);
    owner.jobs = jobs; owner.guards = guards; this.owners.add(owner);
  }
  scope(owner: Owner, threadId: string): string {
    if (owner.closed) throw new Error('process platform: this registry is closed');
    let scope = owner.scopes.get(threadId);
    if (!scope) {
      scope = `registry:${owner.id}:${++nextScope}`;
      owner.scopes.set(threadId, scope); this.scopes.set(scope, {owner, threadId});
    }
    return scope;
  }
  /** The registries asking for disk and network detail: the backend has one switch, on while any of them asks. */
  private readonly watchers = new Set<Owner>();
  watch(owner: Owner, active: boolean): void {
    const before = this.watchers.size > 0;
    if (active) this.watchers.add(owner); else this.watchers.delete(owner);
    if (this.watchers.size > 0 !== before) this.backend.watchResources?.(!before);
  }
  async release(owner: Owner): Promise<void> {
    this.watch(owner, false);
    owner.closed = true; this.owners.delete(owner);
    const errors: unknown[] = [];
    for (const scope of owner.scopes.values()) this.scopes.delete(scope);
    for (const [pid, entry] of owner.pids) {
      try {this.removePid(owner, entry.scope, pid, entry.guarded);} catch (error) {errors.push(error);}
    }
    owner.pids.clear();
    for (const scope of owner.scopes.values()) {
      try {this.backend.forget(scope);} catch (error) {errors.push(error);}
    }
    if (!this.owners.size) {
      this.releasing = true;
      try {await this.backend.release();} catch (error) {errors.push(error);} finally {this.releasing = false;}
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, 'process platform: registry release failed');
  }
  removePid(owner: Owner, scope: string, pid: number, guarded: boolean): void {
    owner.pids.delete(pid);
    if (this.pids.get(pid) !== scope) return;
    this.pids.delete(pid);
    this.backend.pidRemoved(scope, pid, guarded);
  }
  forget(owner: Owner, id: string): void {
    const scope = owner.scopes.get(id);
    if (!scope || owner.closed) return;
    this.backend.forget(scope);
    if (!this.backend.hasProcesses?.(scope)) {
      owner.scopes.delete(id); this.scopes.delete(scope);
    }
  }
}

function scopedPlatform(hub: PlatformScopes): ProcessPlatform {
  const backend = hub.backend;
  const owner: Owner = {id: ++nextOwner, closed: false, scopes: new Map(), pids: new Map()};
  const scope = (id: string) => hub.scope(owner, id);
  /** Only `attach` and `pidAdded` create a scope: a stop or a read of a thread that never ran a process has none to name. */
  const existing = (id: string) => owner.closed ? undefined : owner.scopes.get(id);
  const platform: ProcessPlatform = {
    ...backend,
    retain: (jobs, guards) => hub.retain(owner, jobs, guards),
    release: () => owner.closing ??= hub.release(owner),
    attach: (id, pid) => backend.attach(scope(id), pid),
    ...(backend.hasProcesses ? {hasProcesses: (id: string) => {const native = existing(id); return native !== undefined && backend.hasProcesses!(native);}} : {}),
    ...(backend.startup ? {startup: (id: string, active: boolean) => {const native = existing(id); if (native !== undefined) backend.startup!(native, active);}} : {}),
    // A repeated shutdown must not fall back to killing an unscoped, possibly reused PID.
    terminate: id => {if (owner.closed) return true; const native = existing(id); return native !== undefined && backend.terminate(native);},
    terminateSubtree: (id, pid, lineage) => {const native = existing(id); if (native !== undefined) backend.terminateSubtree?.(native, pid, lineage);},
    stopDescendants: (id, pid) => {const native = existing(id); return native === undefined ? undefined : backend.stopDescendants?.(native, pid);},
    terminateProcess: (id, pid, startedAt) => {const native = existing(id); return native !== undefined && backend.terminateProcess(native, pid, startedAt);},
    sample: id => {const native = existing(id); return native === undefined ? null : backend.sample(native);},
    ...(backend.watchResources ? {watchResources: (active: boolean) => {if (!owner.closed) hub.watch(owner, active);}} : {}),
    pidAdded(id, pid, guarded) {
      const native = scope(id); owner.pids.set(pid, {scope: native, guarded}); hub.pids.set(pid, native); backend.pidAdded(native, pid, guarded);
    },
    pidRemoved(id, pid, guarded) {
      const native = owner.scopes.get(id);
      if (native) hub.removePid(owner, native, pid, guarded);
    },
    warm: () => {if (!owner.closed) backend.warm();},
    forget: id => hub.forget(owner, id),
    guardStatus: () => {const status = backend.guardStatus(); return {...status, mutedPids: status.mutedPids.filter(pid => owner.pids.has(pid) && hub.pids.get(pid) === owner.pids.get(pid)!.scope)};},
  };
  nativeScopes.set(platform, scope);
  return platform;
}

/** One native drain, with registry-owned jobs even when independent cores reuse public thread IDs. */
export function scopedPlatforms(platform: ProcessPlatform): () => ProcessPlatform {
  const hub = new PlatformScopes(platform);
  return () => scopedPlatform(hub);
}
