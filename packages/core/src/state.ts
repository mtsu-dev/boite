/**
 * `agent.state`: what the user sees in Boite, read-only, for `boite state`
 * (docs/internals/cli.md#state). Each domain reads what the page that shows it
 * reads (Limits: quotas.list's last reading; Machines and updates: the group,
 * paired devices and updaters; Activity: the threads that need the user or
 * finished; Task manager: resources.list) and keeps only what a person reads
 * on screen: labels, states and numbers, never a token, key, gateway
 * credential or full email.
 */
import {
  isStateDomain, stateAgentUpdate, stateInbox, stateLimit, stateMachines, stateRoute, stateSummary, stateTasks,
  type StateAppUpdate, type StateInboxRow, type StateLimit, type StateMachine, type StateReading, type StateRoute, type StateSummary,
  type StateTask, type StateUpdates, type StateVersion,
} from '@boite/contracts';
import type { Core } from './core.ts';
import { invalidParams } from './errors.ts';
import { CORE_VERSION } from './version.ts';

type StateCore = Pick<Core, 'subscribers' | 'version' | 'channel' | 'quotas' | 'group' | 'sessions' | 'updates' | 'serverUpdates' | 'desktopUpdates' | 'threads' | 'projects' | 'procs' | 'journal' | 'settings' | 'providers'>;

export function registerStateMethods(core: Core): void {
  core.router.register('agent.state', (params) => {
    if (!isStateDomain(params.domain)) throw invalidParams(`domain must be one of summary, limits, machines, updates, inbox, tasks, version, route; got ${String(params.domain)}`, { field: 'domain' });
    return readState(core, params.domain);
  });
}

export async function readState(core: StateCore, domain: StateReading['domain']): Promise<StateReading> {
  switch (domain) {
    case 'version': return { domain, version: await versionOf(core) };
    case 'limits': return { domain, limits: limitsOf(core) };
    case 'machines': return { domain, machines: machinesOf(core) };
    case 'updates': return { domain, updates: await updatesOf(core) };
    case 'inbox': return { domain, inbox: inboxOf(core) };
    case 'tasks': return { domain, tasks: tasksOf(core) };
    case 'route': return { domain, route: routeOf(core) };
    case 'summary': return { domain, summary: await summaryOf(core) };
  }
}

async function versionOf(core: StateCore): Promise<StateVersion> {
  const desktop = core.desktopUpdates.snapshot();
  const server = await core.serverUpdates.status(false).catch(() => null);
  // A compiled Bun executable runs from its embedded file system.
  const executable = typeof Bun !== 'undefined' && /^(\/\$bunfs|[A-Z]:\\~BUN)/.test(Bun.main);
  return {
    version: core.version || CORE_VERSION,
    channel: core.channel,
    track: desktop?.channel ?? (server?.mode === 'systemd' || server?.mode === 'android' ? server.channel : null),
    platform: process.platform,
    arch: process.arch,
    build: executable ? 'executable' : 'source',
    bun: process.versions.bun ?? null,
  };
}

/** The last reading, cached rows only: no provider and no gateway is asked, even on a cold or expired cache. */
function limitsOf(core: StateCore): StateLimit[] {
  return core.quotas.cached().map(stateLimit);
}

/** "Online" for another machine: it answered since this core started. A device: one of its sockets is open now. */
function machinesOf(core: StateCore): StateMachine[] {
  return stateMachines(core.group.view('owner'), core.sessions.list(null), {
    version: core.version, os: process.platform, reached: coreId => core.group.answered(coreId), connected: sessionId => core.subscribers.sessionConnected(sessionId),
  });
}

function appUpdate(status: { phase: string; version: string | null; error: string | null } | null): StateAppUpdate | null {
  return status === null ? null : { phase: status.phase, version: status.version, error: status.error };
}

async function updatesOf(core: StateCore): Promise<StateUpdates> {
  const server = await core.serverUpdates.status(false).catch(() => null);
  const agents = await core.updates.list(false);
  return {
    version: core.version,
    channel: core.channel,
    server: server !== null && server.phase !== 'idle' ? appUpdate(server) : null,
    desktop: appUpdate(core.desktopUpdates.snapshot()),
    agents: agents.map(stateAgentUpdate),
  };
}

/** Activity's rows (`stateInbox`, Activity's own derivation over the threads, questions and permissions it reads). */
function inboxOf(core: StateCore): StateInboxRow[] {
  const projects = new Map(core.projects.list().map(project => [project.id, project.name]));
  return stateInbox(core.threads.list({}), core.threads.listQuestions(), core.threads.listPermissions(), projectId => projects.get(projectId) ?? null);
}

function tasksOf(core: StateCore): StateTask[] {
  return stateTasks(core.procs.liveThreads().flatMap(threadId => {
    const thread = core.journal.getThread(threadId);
    const live = core.procs.liveOf(threadId);
    if (thread === null || live.length === 0) return [];
    return [{ threadId, title: thread.title, status: thread.status, load: core.procs.loadOf(threadId) ?? { processes: live.length, cpuPercent: 0, memoryBytes: 0 } }];
  }));
}

function routeOf(core: StateCore): StateRoute {
  return stateRoute(core.settings.get().subscriptionProxy ?? null, core.providers.list().loaded, core.quotas.gateway.state());
}

async function summaryOf(core: StateCore): Promise<StateSummary> {
  const [version, updates] = await Promise.all([versionOf(core), updatesOf(core)]);
  return stateSummary({ version, updates, limits: limitsOf(core), machines: machinesOf(core), inbox: inboxOf(core), tasks: tasksOf(core), route: routeOf(core) });
}
