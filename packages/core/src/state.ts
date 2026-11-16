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
  isStateDomain, maskEmail, subscriptionProxyName, subscriptionProxyOrigin, subscriptionProxyServes,
  type StateAgentUpdate, type StateAppUpdate, type StateInboxRow, type StateLimit, type StateMachine, type StateReading,
  type StateRoute, type StateSummary, type StateTask, type StateUpdates, type StateVersion, type ThreadSummary,
} from '@boite/contracts';
import type { Core } from './core.ts';
import { invalidParams } from './errors.ts';
import { CORE_VERSION } from './version.ts';

type StateCore = Pick<Core, 'version' | 'channel' | 'quotas' | 'group' | 'sessions' | 'updates' | 'serverUpdates' | 'desktopUpdates' | 'threads' | 'projects' | 'procs' | 'journal' | 'settings' | 'providers'>;

export function registerStateMethods(core: Core): void {
  core.router.register('agent.state', (params) => {
    if (!isStateDomain(params.domain)) throw invalidParams(`domain must be one of summary, limits, machines, updates, inbox, tasks, version, route; got ${String(params.domain)}`, { field: 'domain' });
    return readState(core, params.domain);
  });
}

export async function readState(core: StateCore, domain: StateReading['domain']): Promise<StateReading> {
  switch (domain) {
    case 'version': return { domain, version: await versionOf(core) };
    case 'limits': return { domain, limits: await limitsOf(core) };
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

/** The last reading, as the Limits page opens with it: no provider is asked again. */
async function limitsOf(core: StateCore): Promise<StateLimit[]> {
  const quotas = await core.quotas.list(false);
  return quotas.map(quota => ({
    provider: quota.providerName,
    account: maskEmail(quota.label),
    status: quota.status,
    windows: quota.windows.map(window => ({ label: window.label, usedPercent: window.usedPercent, resetsAt: window.resetsAt })),
    gateway: quota.gateway !== undefined,
    checkedAt: quota.checkedAt,
    error: quota.error === null ? null : maskEmail(quota.error),
  }));
}

function machinesOf(core: StateCore): StateMachine[] {
  const group = core.group.view('owner');
  const machines: StateMachine[] = group === null
    ? [{ kind: 'machine', name: 'this machine', self: true, os: process.platform, reached: null, lastSeenAt: null, current: null, version: core.version }]
    : group.cores.map(member => {
      const self = member.coreId === group.self;
      return { kind: 'machine', name: member.name, self, os: member.os ?? null, reached: self ? null : core.group.answered(member.coreId), lastSeenAt: null, current: null, version: self ? core.version : null };
    });
  const devices: StateMachine[] = core.sessions.list(null).map(session => ({
    kind: 'device', name: session.client.name, self: false, os: null, reached: null, lastSeenAt: session.lastSeenAt, current: session.current, version: session.client.version || null,
  }));
  return [...machines, ...devices];
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
    agents: agents.map((update): StateAgentUpdate => ({
      provider: update.providerId, name: update.name, route: update.route, installed: update.current, available: update.latest,
      state: update.state, error: update.state === 'failed' ? update.message : null, checkedAt: update.checkedAt,
    })),
  };
}

/**
 * Activity's rows (`packages/ui/src/lib/activity-feed.ts`): a thread waiting
 * on the user or failed (Needs you), one stopped or finished unread
 * (updates). Team chats, council salons, incognito and archived threads are
 * not listed there.
 */
function inboxOf(core: StateCore): StateInboxRow[] {
  const projects = new Map(core.projects.list().map(project => [project.id, project.name]));
  const permissions = new Set(core.threads.listPermissions().map(permission => permission.threadId));
  const rows: StateInboxRow[] = [];
  for (const thread of core.threads.list({})) {
    if (thread.archived || thread.incognito || thread.teamId || thread.councilId) continue;
    const kind = inboxKind(thread, permissions.has(thread.id));
    if (kind === null) continue;
    rows.push({
      threadId: thread.id, title: thread.title, project: thread.projectId === null ? null : projects.get(thread.projectId) ?? null,
      kind, section: kind === 'stopped' || kind === 'done' ? 'updates' : 'needs', at: thread.updatedAt,
    });
  }
  return rows.sort((a, b) => (a.section === b.section ? b.at - a.at : a.section === 'needs' ? -1 : 1));
}

function inboxKind(thread: ThreadSummary, permission: boolean): StateInboxRow['kind'] | null {
  if (permission) return 'permission';
  if (thread.status === 'waiting' || (thread.openQuestions ?? 0) > 0) return 'question';
  if (thread.status === 'error') return 'failed';
  if (thread.status !== 'idle') return null;
  if (thread.backgroundWait?.state === 'interrupted') return 'stopped';
  if ((thread.backgroundWork?.kinds.length ?? 0) > 0 || thread.backgroundWait?.state === 'waiting') return null;
  return thread.unread ? 'done' : null;
}

function tasksOf(core: StateCore): StateTask[] {
  const tasks: StateTask[] = [];
  for (const threadId of core.procs.liveThreads()) {
    const thread = core.journal.getThread(threadId);
    const live = core.procs.liveOf(threadId);
    if (thread === null || live.length === 0) continue;
    const load = core.procs.loadOf(threadId) ?? { processes: live.length, cpuPercent: 0, memoryBytes: 0 };
    tasks.push({ threadId, title: thread.title, status: thread.status, processes: load.processes, cpuPercent: load.cpuPercent, memoryBytes: load.memoryBytes });
  }
  return tasks.sort((a, b) => b.memoryBytes - a.memoryBytes);
}

function routeOf(core: StateCore): StateRoute {
  const proxy = core.settings.get().subscriptionProxy ?? null;
  const providers = core.providers.list().loaded;
  return {
    gateway: proxy === null ? null : { name: subscriptionProxyName(proxy.kind), enabled: proxy.enabled, mode: proxy.mode ?? 'remote', origin: subscriptionProxyOrigin(proxy) },
    providers: providers.map(provider => ({ id: provider.id, name: provider.name, viaGateway: proxy?.enabled === true && subscriptionProxyServes(provider, proxy.kind) })),
  };
}

async function summaryOf(core: StateCore): Promise<StateSummary> {
  const [version, limits, updates] = await Promise.all([versionOf(core), limitsOf(core), updatesOf(core)]);
  const machines = machinesOf(core);
  const inbox = inboxOf(core);
  const tasks = tasksOf(core);
  const route = routeOf(core);
  const members = machines.filter(machine => machine.kind === 'machine');
  let highest: StateSummary['limits']['highest'] = null;
  for (const limit of limits) for (const window of limit.windows) {
    if (highest === null || window.usedPercent > highest.usedPercent) highest = { provider: limit.provider, account: limit.account, label: window.label, usedPercent: window.usedPercent };
  }
  const failing = updates.agents.filter(agent => agent.state === 'failed').length
    + [updates.server, updates.desktop].filter(app => app?.phase === 'error').length;
  const available = updates.agents.filter(agent => agent.available !== null && agent.available !== agent.installed).length
    + [updates.server, updates.desktop].filter(app => app?.phase === 'available' || app?.phase === 'ready').length;
  return {
    version,
    route: { gateway: route.gateway?.enabled ? route.gateway.name : null, providers: route.providers.filter(provider => provider.viaGateway).length },
    machines: { online: members.filter(machine => machine.self || machine.reached === true).length, total: members.length, devices: machines.length - members.length },
    updates: { failing, available },
    inbox: { needs: inbox.filter(row => row.section === 'needs').length, updates: inbox.filter(row => row.section === 'updates').length },
    limits: { accounts: limits.length, highest },
    tasks: { processes: tasks.reduce((sum, task) => sum + task.processes, 0), memoryBytes: tasks.reduce((sum, task) => sum + task.memoryBytes, 0) },
  };
}
