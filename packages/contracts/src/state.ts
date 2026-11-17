import type { AccountQuota, SubscriptionProxyQuotas } from './accounts';
import { activityEvents, activityKind, NEEDS_RANK, rowAsks, threadState, workingChildren } from './activity';
import type { Group } from './group';
import { harnessOffered } from './harness-updates';
import type { ThreadId, Timestamp } from './ids';
import type { PairedSession } from './pairing';
import type { PermissionRequest } from './permissions';
import type { HarnessUpdate } from './providers';
import type { QuestionRequest } from './questions';
import { subscriptionProxyName, subscriptionProxyOrigin, subscriptionProxyServes, type SubscriptionProxy, type SubscriptionProxyTarget } from './subscription-proxy';
import type { ThreadSummary } from './threads';

/*
 * `boite state`: what the user sees in Boite, read-only, for an agent asked
 * about it (docs/internals/cli.md#state). `agent.state` composes what the
 * Limits, Machines and updates, Activity and Task manager pages read, without
 * a token, a key, an address of the gateway's credentials or a full email.
 * Settings come from `agent.settings` with `SETTING_HELP`. The projections
 * below turn what those pages read into a reading, for the core and the
 * app's in-memory core alike.
 */

/** The domains `agent.state` answers; `settings` is `agent.settings`. */
export const STATE_DOMAINS = ['summary', 'limits', 'machines', 'updates', 'inbox', 'tasks', 'version', 'route'] as const;
export type StateDomain = (typeof STATE_DOMAINS)[number];

export function isStateDomain(value: unknown): value is StateDomain {
  return typeof value === 'string' && (STATE_DOMAINS as readonly string[]).includes(value);
}

export interface StateVersion {
  version: string;
  /** The data channel: the regular installation's or Boite Dev's. */
  channel: 'stable' | 'dev';
  /** The update track the server or desktop updater follows, when one reported. */
  track: 'stable' | 'nightly' | null;
  platform: string;
  arch: string;
  /** `executable` for an installed build, `source` for a checkout run through Bun. */
  build: 'executable' | 'source';
  bun: string | null;
}

/** One quota window, as the Limits page draws its bar. */
export interface StateQuotaWindow {
  label: string;
  usedPercent: number;
  resetsAt: Timestamp | null;
}

/** One account of the Limits page. `account` is its label, an email reduced to its first letter and domain. */
export interface StateLimit {
  provider: string;
  account: string;
  status: 'ready' | 'unavailable' | 'unsupported' | 'disabled';
  windows: StateQuotaWindow[];
  /** Read through the subscription gateway (Douane) rather than the provider. */
  gateway: boolean;
  checkedAt: Timestamp | null;
  error: string | null;
}

export interface StateMachine {
  kind: 'machine' | 'device';
  name: string;
  /** This core's own machine. */
  self: boolean;
  os: string | null;
  /** A machine: this core reached it since it started; null for this machine and for a device. */
  reached: boolean | null;
  /** A device: when it last connected. */
  lastSeenAt: Timestamp | null;
  /** A device: connected now. */
  current: boolean | null;
  version: string | null;
}

export interface StateAppUpdate {
  phase: string;
  version: string | null;
  error: string | null;
}

export interface StateAgentUpdate {
  provider: string;
  name: string;
  route: 'managed' | 'self';
  installed: string | null;
  available: string | null;
  /** The app offers `available` (its arrow and Update button): pending, or newer after a failed update, and not skipped. */
  offered: boolean;
  state: 'idle' | 'checking' | 'updating' | 'failed';
  error: string | null;
  checkedAt: Timestamp | null;
}

export interface StateUpdates {
  version: string;
  channel: 'stable' | 'dev';
  /** A standalone server's own updater, null on a desktop core that never checked. */
  server: StateAppUpdate | null;
  /** What the desktop app last reported of its updater, null without one. */
  desktop: StateAppUpdate | null;
  agents: StateAgentUpdate[];
}

/** One Activity row: the thread and why it is listed, as `activityEvents` derives it for the app. */
export interface StateInboxRow {
  threadId: ThreadId;
  title: string;
  project: string | null;
  kind: 'question' | 'permission' | 'failed' | 'stopped' | 'done';
  /** Needs you (`needs`) or an update to read (`updates`), as Activity sorts them. */
  section: 'needs' | 'updates';
  /** A sub-agent that shares its parent's event: the app shows it as a line under the row before it. */
  nested: boolean;
  /** When its question or permission was asked, else when the thread last changed. */
  at: Timestamp;
}

/** One thread of the task manager with what its live processes cost now. */
export interface StateTask {
  threadId: ThreadId;
  title: string;
  status: string;
  processes: number;
  cpuPercent: number;
  memoryBytes: number;
}

export interface StateRoute {
  /** The subscription gateway in Settings, null when none is configured. */
  gateway: { name: string; enabled: boolean; mode: 'local' | 'remote'; origin: string } | null;
  /** Each installed provider and whether the gateway carries its turns. */
  providers: { id: string; name: string; viaGateway: boolean }[];
}

export interface StateSummary {
  version: StateVersion;
  route: { gateway: string | null; providers: number };
  machines: { online: number; total: number; devices: number };
  updates: { failing: number; available: number };
  inbox: { needs: number; updates: number };
  limits: { accounts: number; highest: { provider: string; account: string; label: string; usedPercent: number } | null };
  tasks: { processes: number; memoryBytes: number };
}

export type StateReading =
  | { domain: 'summary'; summary: StateSummary }
  | { domain: 'limits'; limits: StateLimit[] }
  | { domain: 'machines'; machines: StateMachine[] }
  | { domain: 'updates'; updates: StateUpdates }
  | { domain: 'inbox'; inbox: StateInboxRow[] }
  | { domain: 'tasks'; tasks: StateTask[] }
  | { domain: 'version'; version: StateVersion }
  | { domain: 'route'; route: StateRoute };

export interface StateRpcMethods {
  /**
   * What the user sees in Boite for one domain, read-only and without
   * credentials: the agent's `boite state`. The owner reads it too.
   */
  'agent.state': { params: { threadId: ThreadId; domain: StateDomain }; result: StateReading };
}

/** An email in an account label becomes `a…@example.com`; any other label stays. */
export function maskEmail(label: string): string {
  return label.replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '$1…@$2');
}

/** One account of the Limits page, as `agent.state` shows it. */
export function stateLimit(quota: AccountQuota): StateLimit {
  return {
    provider: quota.providerName,
    account: maskEmail(quota.label),
    status: quota.status,
    windows: quota.windows.map(window => ({ label: window.label, usedPercent: window.usedPercent, resetsAt: window.resetsAt })),
    gateway: quota.gateway !== undefined,
    checkedAt: quota.checkedAt,
    error: quota.error === null ? null : maskEmail(quota.error),
  };
}

/** The group's machines, then the paired devices; `here` answers what only the core knows (reached, connected). */
export function stateMachines(
  group: Pick<Group, 'self' | 'cores'> | null,
  sessions: readonly PairedSession[],
  here: { version: string; os: string | null; reached(coreId: string): boolean | null; connected(sessionId: string): boolean },
): StateMachine[] {
  const machines: StateMachine[] = group === null
    ? [{ kind: 'machine', name: 'this machine', self: true, os: here.os, reached: null, lastSeenAt: null, current: null, version: here.version }]
    : group.cores.map(member => {
      const self = member.coreId === group.self;
      return { kind: 'machine', name: member.name, self, os: member.os ?? null, reached: self ? null : here.reached(member.coreId), lastSeenAt: null, current: null, version: self ? here.version : null };
    });
  const devices = sessions.map((session): StateMachine => ({
    kind: 'device', name: session.client.name, self: false, os: null, reached: null, lastSeenAt: session.lastSeenAt, current: here.connected(session.id), version: session.client.version || null,
  }));
  return [...machines, ...devices];
}

/** One agent's row of Machines and updates; `offered` is the app's own rule (`harnessOffered`). */
export function stateAgentUpdate(update: HarnessUpdate): StateAgentUpdate {
  return {
    provider: update.providerId, name: update.name, route: update.route, installed: update.current, available: update.latest, offered: harnessOffered(update),
    state: update.state, error: update.state === 'failed' ? update.message : null, checkedAt: update.checkedAt,
  };
}

/**
 * Activity's rows, by Activity's own derivation (`activityEvents`): the same
 * threads, states, read rules and order, a sub-agent that shares its parent's
 * event marked `nested` under the parent's row.
 */
export function stateInbox(
  threads: readonly ThreadSummary[],
  pendingQuestions: readonly QuestionRequest[],
  pendingPermissions: readonly PermissionRequest[],
  projectName: (projectId: NonNullable<ThreadSummary['projectId']>) => string | null,
): StateInboxRow[] {
  const children = workingChildren(threads);
  const machine = { id: '', store: { subagents: (threadId: ThreadId) => children.get(threadId) ?? null, pendingQuestions, pendingPermissions } };
  const kindOf = (thread: ThreadSummary) => activityKind(machine.store, thread.id, threadState(thread, rowAsks(machine.store, thread.id)));
  // A parent listed only for its sub-agents' event (at work, say) is named by their event.
  const row = (thread: ThreadSummary, rank: number, nested: boolean, event: StateInboxRow['kind']): StateInboxRow => {
    const kind = kindOf(thread) ?? event;
    const asked = kind === 'question' || kind === 'permission'
      ? (pendingQuestions.find(ask => ask.threadId === thread.id) ?? pendingPermissions.find(ask => ask.threadId === thread.id))?.createdAt : undefined;
    return {
      threadId: thread.id, title: thread.title, project: thread.projectId === null ? null : projectName(thread.projectId),
      kind, section: rank <= NEEDS_RANK ? 'needs' : 'updates', nested, at: asked ?? thread.updatedAt,
    };
  };
  return activityEvents(threads.map(thread => ({ machine, thread }))).flatMap(({ lead, helpers, rank }) => {
    const event = kindOf(lead.thread) ?? kindOf(helpers[0]!.thread)!;
    return [row(lead.thread, rank, false, event), ...helpers.map(helper => row(helper.thread, rank, true, event))];
  });
}

/** The task manager's threads with live processes, the heaviest first. */
export function stateTasks(rows: readonly { threadId: ThreadId; title: string; status: string; load: { processes: number; cpuPercent: number; memoryBytes: number } }[]): StateTask[] {
  return rows.map(row => ({ threadId: row.threadId, title: row.title, status: row.status, processes: row.load.processes, cpuPercent: row.load.cpuPercent, memoryBytes: row.load.memoryBytes }))
    .sort((a, b) => b.memoryBytes - a.memoryBytes);
}

/**
 * The gateway in Settings and the providers it carries. `gateway` is its last
 * answer (no read): Muse goes through Douane only when its native Meta pool is on.
 */
export function stateRoute(
  proxy: SubscriptionProxy | null,
  providers: readonly (SubscriptionProxyTarget & { name: string })[],
  gateway: Pick<SubscriptionProxyQuotas, 'providers' | 'nativeMuse'> | null,
): StateRoute {
  return {
    gateway: proxy === null ? null : { name: subscriptionProxyName(proxy.kind), enabled: proxy.enabled, mode: proxy.mode ?? 'remote', origin: subscriptionProxyOrigin(proxy) },
    providers: providers.map(provider => ({ id: provider.id, name: provider.name, viaGateway: proxy?.enabled === true && subscriptionProxyServes(provider, proxy.kind, gateway) })),
  };
}

/** The one-screen summary of every domain's reading. */
export function stateSummary(parts: { version: StateVersion; limits: StateLimit[]; machines: StateMachine[]; updates: StateUpdates; inbox: StateInboxRow[]; tasks: StateTask[]; route: StateRoute }): StateSummary {
  const { version, limits, machines, updates, inbox, tasks, route } = parts;
  const members = machines.filter(machine => machine.kind === 'machine');
  let highest: StateSummary['limits']['highest'] = null;
  for (const limit of limits) for (const window of limit.windows) {
    if (highest === null || window.usedPercent > highest.usedPercent) highest = { provider: limit.provider, account: limit.account, label: window.label, usedPercent: window.usedPercent };
  }
  const apps = [updates.server, updates.desktop];
  const events = inbox.filter(row => !row.nested);
  return {
    version,
    route: { gateway: route.gateway?.enabled ? route.gateway.name : null, providers: route.providers.filter(provider => provider.viaGateway).length },
    machines: { online: members.filter(machine => machine.self || machine.reached === true).length, total: members.length, devices: machines.length - members.length },
    updates: {
      failing: updates.agents.filter(agent => agent.state === 'failed').length + apps.filter(app => app?.phase === 'error').length,
      // `ready` is the desktop app's downloaded release, waiting for a restart.
      available: updates.agents.filter(agent => agent.offered).length + apps.filter(app => app?.phase === 'available' || app?.phase === 'ready').length,
    },
    inbox: { needs: events.filter(row => row.section === 'needs').length, updates: events.filter(row => row.section === 'updates').length },
    limits: { accounts: limits.length, highest },
    tasks: { processes: tasks.reduce((sum, task) => sum + task.processes, 0), memoryBytes: tasks.reduce((sum, task) => sum + task.memoryBytes, 0) },
  };
}
