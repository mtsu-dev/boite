/** Process trace, live resources and token usage. */
import { deviceBound, RpcErrorCode, type AgentResourceSnapshot, type MachineResourceSnapshot, type ResourceByteUsage, type ThreadId, type ThreadResources, type Usage } from '@boite/contracts';
import { RpcFailure } from '../client';
import { addUsage, emptyUsage } from './shared';
import { fakeUsageHistory, fakeUsageKnows, fakeUsageThread } from '../fake-usage';
import type { FakeContext, FakeMethods } from './context';

/** The edges `usage.history` and `usage.thread` take, checked as the core checks them. */
function usageEdges(edges: unknown): number[] {
  const valid = Array.isArray(edges) && edges.length >= 2 && edges.length <= 367 &&
    edges.every((edge, index) => typeof edge === 'number' && Number.isFinite(edge) && (index === 0 || edge > (edges[index - 1] as number)));
  if (!valid) throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: 'edges: expected 2 to 367 strictly ascending timestamps in milliseconds' });
  return edges as number[];
}

function usageProvider(providerId: unknown): string | undefined {
  if (providerId === undefined) return undefined;
  if (typeof providerId !== 'string' || !providerId.trim()) {
    throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: 'providerId: expected a non-empty provider id', data: { field: 'providerId' } });
  }
  return providerId;
}

function usageLedger(ctx: FakeContext) {
  const visibleOnly = deviceBound(ctx.bus.principal);
  const projects = new Map(ctx.projects.map(project => [project.id, { name: project.name, removed: false }]));
  const threads = new Map(ctx.threads);
  for (const { project, threads: archived } of ctx.removedProjects.values()) {
    projects.set(project.id, { name: project.name, removed: true });
    if (!visibleOnly) for (const thread of archived) threads.set(thread.id, thread);
  }
  return { seeded: ctx.usageSeeded, finished: ctx.finished, projects, threads, visibleOnly };
}

function missingUsageThread(threadId: ThreadId): RpcFailure {
  return new RpcFailure({ code: RpcErrorCode.NotFound, message: `threadId: no thread ${threadId}`, data: { field: 'threadId' } });
}

export function resources(ctx: FakeContext): ThreadResources[] {
  const out: ThreadResources[] = [];
  for (const thread of ctx.threads.values()) {
    const live = ctx.processes.filter((p) => p.threadId === thread.id && p.exitedAt === null);
    // The core's rule: only what runs now; what exited stays in the trace.
    if (live.length === 0) continue;
    out.push({
      threadId: thread.id,
      title: thread.title,
      status: thread.status,
      live,
      // As in the core, the count is the live list's, whenever the load was sampled.
      load: { ...(thread.load ?? { cpuPercent: 0, memoryBytes: 0 }), processes: live.length },
      // As in the core, macOS reads no CPU: unknown, not 0 %.
      loadAvailable: { cpu: thread.load !== null && ctx.core.os !== 'macos', memory: thread.load !== null }
    });
  }
  return out.sort((a, b) => b.load.cpuPercent - a.load.cpuPercent);
}

export function resourceMethods(ctx: FakeContext) {
  const unavailable = (): ResourceByteUsage => ({ readBytes: null, writeBytes: null,
    readBytesPerSecond: null, writeBytesPerSecond: null, sampledAt: null, since: null,
    coverage: 'unavailable', source: 'unavailable', note: 'No supported per-agent counter' });
  return {
    'resources.usage': async (params): Promise<AgentResourceSnapshot> => {
      if (ctx.bus.principal === 'agent') throw new RpcFailure({ code: RpcErrorCode.Refused, message: "resources.usage is not one of the agent's methods: the owner and paired devices call it" });
      if (params === null || typeof params !== 'object' || Array.isArray(params)) throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: 'resources.usage: expected an object' });
      if (params.watch !== undefined && typeof params.watch !== 'boolean') throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: 'watch: expected a boolean' });
      return { sampledAt: ctx.now(), agents: resources(ctx).map(resource => {
        const thread = ctx.threads.get(resource.threadId)!;
        return { threadId: thread.id, title: thread.title, providerId: thread.providerId, model: thread.model,
          status: thread.status, projectId: thread.projectId, parentThreadId: thread.parentThreadId ?? null,
          load: resource.load, loadAvailable: resource.loadAvailable!, disk: unavailable(), network: unavailable() };
      }) };
    },
    'resources.machine': async (params): Promise<MachineResourceSnapshot> => {
      if (ctx.bus.principal === 'agent') throw new RpcFailure({ code: RpcErrorCode.Refused, message: "resources.machine is not one of the agent's methods: the owner and paired devices call it" });
      if (params === null || typeof params !== 'object' || Array.isArray(params)) throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: 'resources.machine: expected an object' });
      const live = resources(ctx);
      // A slow wave, so a demo's curves move without a random number in a test.
      const wave = (period: number, low: number, high: number) => low + (high - low) * (0.5 + 0.5 * Math.sin(ctx.now() / period));
      const gib = 1024 ** 3;
      return {
        sampledAt: ctx.now(), hostname: 'fake-pc', os: 'windows', osLabel: 'Windows 11 Pro',
        cpu: { model: 'AMD Ryzen 7 7800X3D 8-Core Processor', cores: 16, percent: wave(7000, 12, 38) },
        memory: { totalBytes: 32 * gib, availableBytes: Math.round((32 - wave(23000, 13, 15)) * gib), agentBytes: live.reduce((sum, row) => sum + row.load.memoryBytes, 0) },
        gpus: [{ name: 'AMD Radeon RX 6750 XT', percent: wave(5000, 2, 21), memoryUsedBytes: Math.round(wave(19000, 2.8, 3.4) * gib), memoryTotalBytes: 12 * gib }],
        agentGpu: live.map(row => ({ threadId: row.threadId, percent: 0 })),
        volumes: [{ name: 'C:', totalBytes: 931 * gib, freeBytes: 284 * gib }, { name: 'D:', totalBytes: 1863 * gib, freeBytes: 1210 * gib }],
      };
    },
    'trace.get': async (params) => {
      const rows = ctx.processes
        .filter((p) => p.threadId === params.threadId)
        .sort((a, b) => b.startedAt - a.startedAt);
      return structuredClone(params.limit ? rows.slice(0, params.limit) : rows);
    },
    'resources.list': async () => {
      return structuredClone(resources(ctx));
    },
    'resources.memoryStatus': async () => {
      const totalMb = 32768;
      const budget = Math.floor(totalMb * ctx.settings.agentMemoryBudgetPercent / 100 / 256) * 256;
      return {
        state: ctx.settings.memoryProtection === false ? 'ok' : ctx.memoryState,
        agentBytes: resources(ctx).reduce((sum, thread) => sum + thread.load.memoryBytes, 0),
        availableBytes: (ctx.memoryState === 'critical' ? 2048 : 16384) * 1048576,
        limits: {
          budgetMb: ctx.settings.memoryProtection === false ? 0 : budget,
          threadMemoryCapMb: ctx.settings.memoryProtection === false ? 0 : Math.min(ctx.settings.threadMemoryCapMb || Math.floor(budget / 2 / 256) * 256, budget),
          memoryReserveMb: ctx.settings.memoryProtection === false ? 0 : ctx.settings.memoryReserveMb || Math.max(totalMb * 0.1, 3072),
        },
      };
    },
    // No turn holds the demo machine awake; `?awake=missing` is a machine without an inhibitor.
    'resources.keepAwake': async () => ({ held: false, available: ctx.keepAwakeAvailable }),
    'resources.killTree': async (params) => {
      let killed = 0;
      for (const record of ctx.processes) {
        if (record.threadId !== params.threadId || record.exitedAt !== null) continue;
        record.exitedAt = ctx.now();
        record.exitCode = 1;
        killed += 1;
        ctx.emitToThread(record.threadId, 'process.exited', structuredClone(record));
      }
      const thread = ctx.threads.get(params.threadId);
      if (thread) {
        thread.load = null;
        ctx.touch(thread);
      }
      return { killed };
    },
    'usage.get': async (params) => {
      const visibleOnly = deviceBound(ctx.bus.principal);
      if (visibleOnly && params.threadId !== undefined && !ctx.threads.has(params.threadId)) throw missingUsageThread(params.threadId);
      const byThread: Record<ThreadId, Usage> = {};
      let total = emptyUsage();
      for (const [threadId, usage] of ctx.usage) {
        if (params.threadId && params.threadId !== threadId) continue;
        if (!visibleOnly || ctx.threads.has(threadId)) byThread[threadId] = { ...usage };
        total = addUsage(total, usage);
      }
      return { byThread, total };
    },
    'usage.history': async (params) => {
      const edges = usageEdges(params?.edges);
      const providerId = usageProvider(params.providerId);
      if (params.projectId !== undefined && params.projectId !== null && (typeof params.projectId !== 'string' || !params.projectId.trim())) {
        throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: 'projectId: expected a project id or null' });
      }
      return fakeUsageHistory(edges, { ...usageLedger(ctx), providerId, projectId: params.projectId });
    },
    'usage.thread': async (params) => {
      const edges = usageEdges(params?.edges);
      if (typeof params.threadId !== 'string' || !params.threadId.trim()) throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: 'threadId: expected a thread id' });
      const providerId = usageProvider(params.providerId);
      const ledger = usageLedger(ctx);
      if (!ledger.threads.has(params.threadId) && (ledger.visibleOnly || !fakeUsageKnows(params.threadId, ledger.finished))) {
        throw missingUsageThread(params.threadId);
      }
      return fakeUsageThread(params.threadId, edges, { ...ledger, providerId });
    },
  } satisfies Partial<FakeMethods>;
}
