import type { ThreadId, Timestamp } from './ids';

/*
 * `boite state`: what the user sees in Boite, read-only, for an agent asked
 * about it (docs/internals/cli.md#state). `agent.state` composes what the
 * Limits, Machines and updates, Activity and Task manager pages read, without
 * a token, a key, an address of the gateway's credentials or a full email.
 * Settings come from `agent.settings` with `SETTING_HELP`.
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

/** One Activity row: the thread and why it is listed. */
export interface StateInboxRow {
  threadId: ThreadId;
  title: string;
  project: string | null;
  kind: 'question' | 'permission' | 'failed' | 'stopped' | 'done';
  /** Needs you (`needs`) or an update to read (`updates`), as Activity sorts them. */
  section: 'needs' | 'updates';
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
