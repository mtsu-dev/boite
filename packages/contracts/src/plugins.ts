import type { QuotaWindow } from './accounts';
import type { ProviderId, ThreadId, Timestamp } from './ids';
import type { RpcEventName, RpcMethodName } from './index';

// ---------------------------------------------------------------------------
// Plugins: one manifest format, `boite-plugin.json`. The recommended ones ship
// inside the core; the owner adds others from a git URL. docs/internals/plugins.md.
// ---------------------------------------------------------------------------

/** The file a plugin repository carries at its root. */
export const PLUGIN_MANIFEST_FILE = 'boite-plugin.json';
/** The newest manifest schema this core reads. Schema 1 manifests still load as they always did. */
export const PLUGIN_MANIFEST_SCHEMA = 2;
/** Every manifest schema this core reads. */
export const PLUGIN_MANIFEST_SCHEMAS = [1, 2] as const;
/** `${process.platform}-${process.arch}` keys an artifact may be published for. */
export const PLUGIN_PLATFORMS = ['win32-x64', 'win32-arm64', 'darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64'] as const;
export type PluginPlatform = (typeof PLUGIN_PLATFORMS)[number];
/**
 * The artifact key of a `bun` plugin: one JavaScript file for every machine,
 * run by the Bun the core itself runs on.
 */
export const PLUGIN_ANY_PLATFORM = 'any';
/**
 * How the core runs the executable. `native`: a program built for each
 * platform. `bun`: one JavaScript file the core runs with its own Bun, so a
 * plugin ships one artifact for every machine. Schema 2 only; schema 1 is native.
 */
export type PluginRuntime = 'native' | 'bun';

// ---------------------------------------------------------------------------
// Permissions. A schema 2 plugin's processes get a token of their own that
// reaches only what the owner granted of what its manifest asks for
// (docs/internals/plugins.md, Permissions). A schema 1 desktop app keeps the owner token
// it always had.
//
// Every method and event a paired device reaches (`DEVICE_METHODS` and
// `DEVICE_EVENTS` in access.ts) sits in exactly one domain below or in
// `PLUGIN_CLOSED`; core/test/plugin-permissions.test.ts fails on one
// filed nowhere. A method added later joins its domain here and every plugin
// granted that domain reaches it, with no change to the plugin.
// ---------------------------------------------------------------------------

export const PLUGIN_PERMISSION_NAMES = [
  'threads.read', 'threads.write', 'projects.read', 'projects.write', 'todos.read', 'todos.write',
  'agents.read', 'agents.write', 'files.read', 'questions.write', 'screens.read', 'screens.write',
  'status.read', 'ui.reveal',
] as const;
export type PluginPermission = (typeof PLUGIN_PERMISSION_NAMES)[number];

/**
 * Names older manifests used, read as the permissions they stand for, so an
 * installed manifest still loads. A manifest may name both forms.
 */
export const PLUGIN_PERMISSION_ALIASES: Readonly<Record<string, readonly PluginPermission[]>> = {
  todos: ['todos.read', 'todos.write'],
};

/** What one permission opens: the methods a plugin token may call and the events it hears. */
export interface PluginPermissionGrant {
  methods: readonly RpcMethodName[];
  events: readonly RpcEventName[];
  /** Drawn in red at install: granting it hands the plugin the owner's own say. */
  danger?: true;
}

/**
 * The whole of what a plugin token reaches. A method or an event in none of
 * these is refused to every plugin, whatever it asks for. A plugin passes the
 * same checks as a paired device on top (access.ts): the working tree's diff
 * against HEAD only, the last quota reading only.
 */
export const PLUGIN_PERMISSIONS: Readonly<Record<PluginPermission, PluginPermissionGrant>> = {
  // Every conversation of every project, read only: rows, transcripts, cards waiting on the owner, the composer's drafts.
  // `projects.list` too: a row names its project, and plugins asking for threads.read before the domains used it.
  'threads.read': {
    methods: [
      'projects.list', 'threads.list', 'threads.listChanges', 'threads.get', 'threads.capabilities', 'threads.stats', 'threads.subscribe', 'threads.unsubscribe',
      'threads.pullRequest', 'threads.pullRequests', 'threads.pullRequestReview', 'threads.pullRequestFiles',
      'messages.list', 'messages.toolOutput', 'messages.toolPart', 'messages.attachment', 'artifacts.read', 'artifacts.viewBlock',
      'composer.list', 'composer.asset.get', 'permissions.list', 'questions.list',
    ],
    events: [
      'thread.created', 'thread.updated', 'thread.removed', 'thread.commands', 'thread.background', 'thread.btw', 'thread.load', 'thread.activity',
      'turn.started', 'turn.finished', 'turn.toolCompleted',
      'message.started', 'message.delta', 'message.part', 'message.completed', 'message.truncated',
      'permission.requested', 'permission.resolved', 'question.asked', 'question.answered',
      'composer.updated', 'threads.pullRequestsChanged',
    ],
  },
  // Starts, steers, stops, renames, moves, forks and archives conversations: it spends the owner's agent quota.
  // `threads.archive` stays idle-only and never restores (threads/plugin-archive.ts, access.ts).
  'threads.write': {
    methods: [
      'threads.create', 'threads.update', 'threads.retitle', 'threads.archive', 'threads.remove', 'threads.restore', 'threads.pin', 'threads.markRead',
      'threads.move', 'threads.moveCancel', 'threads.fork', 'threads.rewind', 'threads.mergeBack', 'threads.compact',
      'threads.btw', 'threads.btw.cancel', 'threads.btw.fork', 'threads.activity.set', 'threads.activity.control', 'threads.unwatchPullRequest',
      'turns.start', 'turns.steer', 'turns.stop', 'turns.recover', 'turns.cancelRetry',
      'composer.asset.put', 'drafts.prepare', 'drafts.release', 'attachments.upload', 'attachments.release',
    ],
    events: [],
  },
  // The projects' icons, file lists and changes, and the composer's skill menu (the list itself is threads.read's).
  'projects.read': {
    methods: ['projects.icon', 'projects.files', 'brain.commands'],
    events: ['project.added', 'project.removed', 'project.updated'],
  },
  // Adds a folder as a project, renames or archives one.
  'projects.write': { methods: ['projects.add', 'projects.archive', 'projects.rename', 'projects.drafts'], events: [] },
  'todos.read': { methods: ['todos.list'], events: ['todos.updated'] },
  // Adds, edits, moves and removes cards, a done one included, as the owner would.
  'todos.write': { methods: ['todos.add', 'todos.update', 'todos.remove'], events: [] },
  // Bots, delegated children, workflows, teams, councils and the coordination inbox, read only.
  'agents.read': {
    methods: [
      'agents.snapshot', 'agents.runtime.get', 'agents.brain.get', 'agents.picture.get',
      'delegation.get', 'delegation.result', 'delegation.wait', 'workflows.list', 'workflows.get', 'workflows.templates.list',
      'teams.list', 'council.list', 'council.get', 'collaboration.get', 'collaboration.directory',
    ],
    events: ['agents.changed', 'delegation.changed', 'workflows.changed', 'collaboration.changed', 'teams.changed', 'council.changed'],
  },
  // Wakes a bot, writes to children and teams, pauses or stops their work.
  'agents.write': {
    methods: ['agents.open', 'agents.event', 'delegation.send', 'delegation.stop', 'workflows.control', 'teams.post', 'council.post', 'council.closeRound', 'council.stop'],
    events: [],
  },
  // The working trees: changed files, their diffs, any file, and the folders of this machine.
  'files.read': { methods: ['git.status', 'git.diff', 'files.list', 'files.read', 'projects.browse'], events: [] },
  // Answers the cards agents raise, tool permissions included: what the agent then runs, the owner did not approve.
  'questions.write': { methods: ['permissions.answer', 'questions.answer', 'questions.openPage', 'questions.skip'], events: [], danger: true },
  // What an agent's browser, a phone emulator or a desktop window shows.
  'screens.read': {
    methods: ['browser.remoteFrame', 'browser.remoteSelection', 'browser.remoteStatus', 'devices.list', 'devices.sessions', 'devices.frame', 'devices.screenshot', 'devices.stream', 'windows.list', 'windows.frame'],
    events: ['browser.remoteChanged', 'devices.changed', 'windows.changed'],
  },
  // Taps, types and opens there, reads the emulator's clipboard, closes what is shown.
  'screens.write': { methods: ['browser.remoteInput', 'devices.input', 'devices.open', 'devices.close', 'devices.clipboard', 'windows.close'], events: [] },
  // This machine's load and usage, the quota readings, the agents installed, settings and shortcuts, read only.
  'status.read': {
    methods: ['resources.usage', 'resources.machine', 'scheduler.get', 'usage.get', 'usage.history', 'quotas.list', 'subscriptionProxy.quotas', 'providers.list', 'settings.get', 'keybindings.get'],
    events: [
      'scheduler.updated', 'quotas.updated', 'quotas.progress', 'quotas.alerted', 'subscriptionProxy.quotasUpdated',
      'settings.updated', 'keybindings.updated', 'providers.updated', 'providers.installProgress', 'providers.probed',
    ],
  },
  // Brings a conversation, a bot or the app updates to the front of the owner's desktop window.
  'ui.reveal': { methods: ['ui.reveal'], events: [] },
};

/**
 * What no plugin reaches, whatever it asks for, and why. A name ending in
 * `.` closes every method or event under it. Methods a paired device does
 * not reach are the owner's and closed anyway; those are listed only when the
 * reason is worth saying.
 */
export const PLUGIN_CLOSED: readonly { name: string; reason: string }[] = [
  { name: 'accounts.', reason: 'the agents\' sign-ins and their settings are the owner\'s' },
  { name: 'quotas.alert', reason: 'an account\'s alert thresholds are the owner\'s account settings' },
  { name: 'providers.probe', reason: 'it starts an agent with the owner\'s login' },
  { name: 'providers.install', reason: 'installing an agent runs its installer on this machine' },
  { name: 'providers.update', reason: 'updating an agent runs its installer on this machine' },
  { name: 'providers.uninstall', reason: 'removing an agent is the owner\'s' },
  { name: 'subscriptionProxy.setEnabled', reason: 'it routes the owner\'s provider traffic' },
  { name: 'secrets.', reason: 'secrets reach only the agent that asked for one' },
  { name: 'secret.', reason: 'secrets reach only the agent that asked for one' },
  { name: 'plugins.', reason: 'installing, removing, granting, turning off and setting up plugins is the owner\'s' },
  { name: 'core.', reason: 'updating, restarting and stopping Boite and the app is the owner\'s' },
  { name: 'policy.', reason: 'policies hold the owner\'s machines to an administrator\'s rules, which a plugin neither reads nor changes' },
  { name: 'sessions.', reason: 'pairing a device is the owner\'s' },
  { name: 'pairing.', reason: 'pairing a device is the owner\'s' },
  { name: 'group.', reason: 'the machines of the group and their pairing are the owner\'s' },
  { name: 'push.', reason: 'notifications belong to the device that subscribed' },
  { name: 'client.', reason: 'each app\'s language and experiments are its own' },
  { name: 'threads.focus', reason: 'which conversation the person is looking at decides their notifications' },
  { name: 'speech.', reason: 'the microphone belongs to the person speaking to the app' },
  { name: 'composer.put', reason: 'a queued line goes out as the owner\'s own; a plugin sends with turns.start or turns.steer, which name it' },
  { name: 'diagnostics.report', reason: 'the app reports its own errors' },
  { name: 'windows.consent', reason: 'only the owner lets an agent see a window' },
  { name: 'contacts.', reason: 'a contact letter speaks as the owner to another person' },
  { name: 'shared', reason: 'a shared project is open to the people it is shared with, not to plugins' },
];

/** Why no plugin reaches `name`, or null when a permission may open it. */
export function pluginClosedReason(name: string): string | null {
  return PLUGIN_CLOSED.find((entry) => entry.name.endsWith('.') ? name.startsWith(entry.name) : (entry.name === 'shared' ? /^shared[A-Z]/.test(name) : entry.name === name))?.reason ?? null;
}

/** The permission that opens `method`, or null when none does. */
export function pluginPermissionFor(method: string): PluginPermission | null {
  return (PLUGIN_PERMISSION_NAMES.find((permission) => (PLUGIN_PERMISSIONS[permission].methods as readonly string[]).includes(method))) ?? null;
}

/** Who did something a plugin asked for, recorded on what it changed: the name as it was then, so it still reads after an uninstall. */
export interface PluginActor {
  pluginId: string;
  pluginName: string;
}

// ---------------------------------------------------------------------------
// Settings. A schema 2 manifest declares them; Boite draws them in the same
// dialog for every plugin, keeps the owner's values on the core, and the
// plugin reads them (`plugins.settings.get`) and hears each change
// (`plugin.settings.changed`) with no permission, for itself only.
// ---------------------------------------------------------------------------

export const PLUGIN_SETTING_TYPES = ['switch', 'number', 'slider', 'text', 'select'] as const;
export type PluginSettingType = (typeof PLUGIN_SETTING_TYPES)[number];
/** A setting's key: a letter, then letters, digits and `_`, at most 40 characters. */
export const PLUGIN_SETTING_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
/** How many settings one plugin may declare, and how long a text value or a select's list may be. */
export const PLUGIN_SETTING_LIMITS = { settings: 30, text: 1000, options: 30 } as const;

export type PluginSettingValue = boolean | number | string;
/** Every declared key with its value: the owner's, or the declared default. */
export type PluginSettingValues = Record<string, PluginSettingValue>;

interface PluginSettingBase {
  key: string;
  /** One short line, the setting's name. */
  label: string;
  /** One line under the label. */
  description?: string;
}
/** A number field; `min`, `max` and `step` bound what the owner may enter. */
export interface PluginNumberSetting extends PluginSettingBase { type: 'number'; default: number; min?: number; max?: number; step?: number }
/** A slider: `min` and `max` are required. */
export interface PluginSliderSetting extends PluginSettingBase { type: 'slider'; default: number; min: number; max: number; step?: number }
export interface PluginSelectOption { value: string; label: string }
export type PluginSetting =
  | (PluginSettingBase & { type: 'switch'; default: boolean })
  | PluginNumberSetting
  | PluginSliderSetting
  | (PluginSettingBase & { type: 'text'; default: string })
  | (PluginSettingBase & { type: 'select'; default: string; options: PluginSelectOption[] });

/**
 * Why `value` cannot be the setting's value, or null when it can. The core
 * checks every default and every value the owner sets with it; the UI uses it
 * to refuse a field before sending it.
 */
export function pluginSettingProblem(setting: PluginSetting, value: unknown): string | null {
  switch (setting.type) {
    case 'switch': return typeof value === 'boolean' ? null : 'true or false';
    case 'text':
      return typeof value === 'string' && value.length <= PLUGIN_SETTING_LIMITS.text && !/[\u0000-\u001f\u007f]/.test(value)
        ? null : `a string of at most ${PLUGIN_SETTING_LIMITS.text} characters on one line`;
    case 'select': {
      const values = setting.options.map((option) => option.value);
      return typeof value === 'string' && values.includes(value) ? null : `one of ${values.join(', ')}`;
    }
    default: {
      const { min, max, step } = setting;
      const range = [min === undefined ? '' : `at least ${min}`, max === undefined ? '' : `at most ${max}`, step === undefined ? '' : `a multiple of ${step}${min === undefined ? '' : ` from ${min}`}`].filter(Boolean).join(', ');
      if (typeof value !== 'number' || !Number.isFinite(value)) return `a number${range ? `, ${range}` : ''}`;
      if ((min !== undefined && value < min) || (max !== undefined && value > max) || (step !== undefined && !onStep(value, min ?? 0, step))) return `a number, ${range}`;
      return null;
    }
  }
}

/** Whether `value` lands on a step from `base`, within float error. */
function onStep(value: number, base: number, step: number): boolean {
  const steps = (value - base) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

/** The value of each declared setting: the stored one while it is still valid, the default otherwise. */
export function pluginSettingValues(settings: readonly PluginSetting[], stored: Readonly<Record<string, unknown>>): PluginSettingValues {
  return Object.fromEntries(settings.map((setting) => {
    const value = stored[setting.key];
    return [setting.key, value !== undefined && pluginSettingProblem(setting, value) === null ? value as PluginSettingValue : setting.default];
  }));
}

// ---------------------------------------------------------------------------
// What a schema 2 plugin adds to agents and to the composer. Each is plain
// data in the manifest except agent commands, which run the executable.
// ---------------------------------------------------------------------------

/**
 * The manifest's `executable`: one file name with no extension and no path,
 * so neither the core's install nor the SDK's packer can write outside the
 * plugin's folder.
 */
export const PLUGIN_EXECUTABLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Names an agent command, a skill or a slash command may take: lowercase words joined by hyphens. */
export const PLUGIN_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * A `boite <name> ...` command agents run. The core runs the plugin's
 * executable with `<name>` and the arguments, in the agent's directory, and
 * hands back its output and exit code. A built-in command of the same name
 * wins, so the manifest reader refuses one.
 */
export interface PluginCommand {
  name: string;
  /** One line agents read in their guide. */
  description: string;
  /** The arguments, as `boite help` would word them (`<file> [--max N]`). */
  usage?: string;
}

/** A skill the plugin ships to every agent: listed in the guide, its body written to disk until the agent reads it. */
export interface PluginSkill {
  name: string;
  description: string;
  /** The SKILL.md text, Markdown. */
  body: string;
}

/** A `/name` the composer offers. The prompt replaces the name; what the user typed after it follows. */
export interface PluginSlashCommand {
  name: string;
  description: string;
  /** What goes after the name (`<branch>`), or absent. */
  hint?: string;
  prompt: string;
}

/** One release file, downloaded over https and checked against its digest: a native executable, or a `bun` plugin's script. */
export interface PluginArtifact {
  url: string;
  /** Lowercase hex SHA-256 of the file at `url`. */
  sha256: string;
}

/**
 * What the plugin adds. Account pools, a desktop app, a gateway and a service
 * run the executable in the background; commands run it on demand; skills,
 * the prompt and slash commands are text and need no executable at all.
 */
export interface PluginProvides {
  /** The executable answers the account pool commands for these providers. */
  accountPools?: { providers: ProviderId[] };
  /**
   * The executable is a desktop app the core starts with no arguments and
   * keeps running. It reaches the core with `BOITE_CORE_URL` and the owner
   * token in `BOITE_TOKEN`. No fields today.
   */
  desktopApp?: Record<string, never>;
  /**
   * The executable is a subscription gateway speaking Douane's runtime
   * contract: the core runs it in the background with `--config <file>` it
   * writes, on a loopback port, and the subscription proxy's local mode points
   * at it. No fields today.
   */
  gateway?: Record<string, never>;
  /**
   * Schema 2. The executable runs in the background with no window, kept
   * running and relaunched after a crash like a desktop app, on any machine,
   * a headless server included. No fields today.
   */
  service?: Record<string, never>;
  /** Schema 2. `boite <name>` commands agents run. */
  commands?: PluginCommand[];
  /** Schema 2. Skills every agent is offered. */
  skills?: PluginSkill[];
  /** Schema 2. A few lines added to every agent's Boite guide. */
  prompt?: string;
  /** Schema 2. Entries of the composer's `/` menu. */
  slashCommands?: PluginSlashCommand[];
}

/** Where a gateway plugin stands. Null on a plugin that provides no gateway. */
export interface PluginGatewayState {
  /** Whether the core runs it. True after a first install, kept across restarts and updates. */
  enabled: boolean;
  /**
   * Whether the core starts it when the core starts, whatever a stop left
   * `enabled` at. True after a first install. Absent from cores older than
   * `plugins.autostart`.
   */
  autostart?: boolean;
  /**
   * `starting`: launched and not answering `/health` yet, or waiting to start
   * again after a crash. `updating`: a newer release waits for the requests in
   * flight to end. `crashed`: it failed four times in five minutes; it waits
   * for the owner.
   */
  status: 'stopped' | 'starting' | 'running' | 'updating' | 'crashed';
  /** The loopback port it listens on, or will at its next start. */
  port: number;
  /** What its `/health` reported, once it answered. */
  version: string | null;
  pid: number | null;
  exitCode: number | null;
  /** Why it is not running, when Boite knows. Never its own output. */
  error: string | null;
  startedAt: Timestamp | null;
  /** Where its configuration, sign-ins and database live; an uninstall keeps them. */
  dataDir: string;
}

/** Where a desktop-app plugin stands. Null on a plugin that provides no desktop app. */
export interface PluginAppState {
  /**
   * `desktop`: a desktop app, which needs a screen. `service`: a background
   * process, which runs anywhere. Absent from cores older than services: desktop.
   */
  kind?: 'desktop' | 'service';
  /** Whether the core starts the app. True after a first install, kept across restarts and updates. */
  enabled: boolean;
  /**
   * Whether the core starts the app when the core starts, whatever a stop
   * left `enabled` at. True after a first install. Absent from cores older
   * than `plugins.autostart`.
   */
  autostart?: boolean;
  /**
   * `stopped`: not running, after a stop, a clean exit or before the first start.
   * `crashed`: it failed four times in five minutes; it waits for the owner.
   * `unavailable`: this core cannot show a window; `error` says why.
   */
  status: 'stopped' | 'starting' | 'running' | 'crashed' | 'unavailable';
  pid: number | null;
  /** The last exit code, set after the app exits. */
  exitCode: number | null;
  /** Why the app is not running, when Boite knows. Never the app's own output. */
  error: string | null;
  startedAt: Timestamp | null;
}

/**
 * What `ui.reveal` shows in the owner's desktop window: a thread, an agent's
 * page, or the app updates in Settings. `agentId` is 1 to 200 characters.
 * `coreId` names the machine the thread or the agent lives on: another member
 * of this core's group or a machine trusted for coordination. Missing, or this
 * core's own id, means this core.
 */
export type UiRevealTarget =
  | { kind: 'thread'; threadId: ThreadId; coreId?: string }
  | { kind: 'agent'; agentId: string; coreId?: string }
  | { kind: 'update' };

export interface PluginManifest {
  schema: 1 | 2;
  id: string;
  name: string;
  version: string;
  description: string;
  /** https page of the project, shown as its source link. */
  homepage: string;
  /** Schema 2: how the executable runs. Absent means native. */
  runtime?: PluginRuntime;
  /**
   * The file name Boite writes: `.exe` appended on Windows for a native one,
   * `.js` for a `bun` one. Absent from a schema 2 plugin that provides only
   * skills, a prompt or slash commands.
   */
  executable?: string;
  /**
   * Keyed by platform for a native executable, by `any` alone for a `bun` one.
   * Absent exactly when `executable` is.
   */
  artifacts?: Partial<Record<PluginPlatform | typeof PLUGIN_ANY_PLATFORM, PluginArtifact>>;
  /** Schema 2: what the plugin's own token reaches. Absent means nothing. */
  permissions?: PluginPermission[];
  /** Schema 2: the settings Boite draws for the owner, in this order. */
  settings?: PluginSetting[];
  provides: PluginProvides;
}

/** Where a plugin added from a URL came from. */
export interface PluginSource {
  /** The repository URL, as the core normalized it. */
  url: string;
  /** The branch, tag or commit asked for, `HEAD` when none was. */
  ref: string;
  /** The commit the manifest was read at. */
  commit: string;
}

/** A manifest the core refused, with the file, the field and what it expected. */
export interface PluginRejected {
  file: string;
  field: string;
  expected: string;
  message: string;
}

/**
 * Where a move sends the logins: the configured proxy's Douane (absent), or
 * `plugin`, the Douane plugin this core runs, whatever the proxy points at.
 */
export type GatewayMoveTarget = 'proxy' | 'plugin';

export interface PluginState {
  id: string;
  name: string;
  /**
   * Shipped in the core's recommended list, added by the owner from a git URL,
   * or `dev`: run from a folder on this machine with `boite plugin dev`.
   */
  origin: 'recommended' | 'url' | 'dev';
  description: string;
  homepage: string | null;
  /** The version on disk, null while nothing is installed. */
  version: string | null;
  /** The version an install or an update brings. */
  availableVersion: string | null;
  status: 'not-installed' | 'installed' | 'installing' | 'error' | 'rejected';
  progress: number;
  error: string | null;
  /** Null for a recommended plugin. */
  source: PluginSource | null;
  /** What an install downloads on this machine, null when the manifest publishes nothing for it. */
  artifact: PluginArtifact | null;
  /** This machine's key, `win32-x64` and so on. */
  platform: string;
  /** The command lines Boite runs, `<pool>` and `<email>` standing for the values. */
  commands: string[];
  /** The providers whose account pools the plugin serves. */
  pools: ProviderId[];
  /** Set exactly when `status` is `rejected`. */
  rejected: PluginRejected | null;
  /** The desktop app or service the plugin provides, null when it provides neither. */
  app: PluginAppState | null;
  /** The gateway the plugin provides, null when it provides none. Absent from cores older than gateway plugins. */
  gateway?: PluginGatewayState | null;
  /**
   * Where Boite looks for this recommended plugin's newer releases, and what
   * it last found there. Null when its entry names no update source. Absent
   * from cores older than update sources.
   */
  updates?: PluginUpdates | null;
  /**
   * What a schema 2 plugin's own token reaches, empty when it declared none.
   * Absent for a schema 1 plugin, whose processes get the owner token, and
   * from older cores, where every plugin does.
   */
  permissions?: PluginPermission[];
  /**
   * What the owner granted of `permissions`: all the plugin's token reaches.
   * Absent with `permissions`. A permission the plugin asks for and the owner
   * left out is refused by name (docs/internals/plugins.md, Permissions).
   */
  granted?: PluginPermission[];
  /** What the version an install or an update brings asks for; the consent dialog lists it. Absent when that version is schema 1. */
  requested?: PluginPermission[];
  /** It runs a program of its own on this machine, with Boite's rights: an executable, which its app or service runs too. */
  runsProgram?: boolean;
  /** What it adds to agents and to the composer, by name. Absent from older cores. */
  adds?: PluginAdds | null;
  /** The folder a `dev` plugin runs from. Absent or null otherwise. */
  devPath?: string | null;
  /**
   * False once the owner turned the plugin off (`plugins.setEnabled`): its
   * processes stopped, its token revoked, what it adds gone, its files kept.
   * Absent from older cores, where every installed plugin is on.
   */
  enabled?: boolean;
  /** The settings its manifest declares, empty when none. Absent from older cores. */
  settings?: PluginSetting[];
  /** The current value of each declared setting. Absent from older cores. */
  settingValues?: PluginSettingValues;
}

/** The agent commands, skills and slash commands a plugin adds, and whether it adds guide lines. */
export interface PluginAdds {
  commands: string[];
  skills: string[];
  slashCommands: string[];
  prompt: boolean;
}

/** What `plugins.command` hands back: the command's exit code and its output. */
export interface PluginCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** The output passed the cap and was cut at it. */
  truncated: boolean;
}

/**
 * A recommended plugin's update source and its last check. The source is the
 * reviewed list's, never the plugin's own: docs/internals/plugins.md, Updating.
 */
export interface PluginUpdates {
  /** The https repository and the ref whose `boite-plugin.json` is read. */
  source: { url: string; ref: string };
  /** A check is running now. */
  checking: boolean;
  /** When the last check finished, successful or not. */
  checkedAt: Timestamp | null;
  /** When the core checks again by itself, null when it does not. */
  nextCheckAt: Timestamp | null;
  /** A newer release the last check found and accepted; `availableVersion` then names it. */
  available: { version: string; commit: string; checkedAt: Timestamp } | null;
  /** Why the manifest read there was not offered: not newer, another id, no artifact here. Not an error. */
  ignored: string | null;
  /** Why the last check could not read the source. Checks back off after one. */
  error: string | null;
}

/** What `plugins.inspect` read, shown to the owner before anything is downloaded. */
export interface PluginPreview {
  /** What `plugins.add` takes. Null when the manifest was refused. */
  previewId: string | null;
  source: PluginSource;
  manifest: PluginManifest | null;
  rejected: PluginRejected | null;
  artifact: PluginArtifact | null;
  platform: string;
  commands: string[];
  /** The version installed under the same id, which this install replaces. */
  replaces: string | null;
  expiresAt: Timestamp;
}

export interface PluginPool {
  provider: string;
  accounts: { email: string; active: boolean; windows: QuotaWindow[]; checkedSecondsAgo: number | null }[];
}

export interface PluginsRpcMethods {
  /** The recommended plugins, then every one installed from a URL, rejected ones included. */
  'plugins.list': { params: Record<string, never>; result: PluginState[] };
  /**
   * Fetches the repository at `ref` (default `HEAD`) and reads its manifest.
   * Downloads no artifact and runs nothing. https URLs only.
   */
  'plugins.inspect': { params: { url: string; ref?: string }; result: PluginPreview };
  /**
   * Installs exactly what a preview showed: that manifest, read at that commit.
   * `grants`: what the owner ticked of the manifest's permissions; all of them when absent.
   */
  'plugins.add': { params: { previewId: string; grants?: PluginPermission[] }; result: PluginState };
  /**
   * Installs a recommended plugin, or reinstalls or updates one already added
   * from a URL. `grants`: what the owner ticked of the permissions that
   * version asks for. Absent, a first install grants all of them and an
   * update keeps what was granted, granting nothing new.
   */
  'plugins.install': { params: { id: string; grants?: PluginPermission[] }; result: PluginState };
  /**
   * Owner-only. What an installed schema 2 plugin's token reaches, among the
   * permissions its manifest asks for. Its token is reissued, the sockets the
   * old one opened close, and its app or service restarts with the new one.
   */
  'plugins.setGrants': { params: { id: string; grants: PluginPermission[] }; result: PluginState };
  'plugins.cancel': { params: { id: string }; result: PluginState };
  'plugins.uninstall': { params: { id: string }; result: PluginState };
  'plugins.accounts': { params: { id: string; refresh?: boolean }; result: PluginPool[] };
  'plugins.accountAction': {
    params: { id: string; provider: string; action: 'add' | 'switch' | 'remove'; email?: string };
    result: PluginPool[];
  };
  /**
   * Controls a plugin's desktop app or service. `start` enables and launches it, `stop`
   * disables and kills it, `restart` kills and launches it again.
   */
  'plugins.app': { params: { id: string; action: 'start' | 'stop' | 'restart' }; result: PluginState };
  /** Owner-only. Start, stop or restart a gateway plugin. */
  'plugins.gateway': { params: { id: string; action: 'start' | 'stop' | 'restart' }; result: PluginState };
  /**
   * Owner-only. Whether the plugin's desktop app or service and its gateway
   * start when the core starts. It changes nothing running now; a stop no longer keeps a
   * plugin off across core starts once this is on. A client offers it only
   * when the plugin's state carries `autostart`.
   */
  'plugins.autostart': { params: { id: string; autostart: boolean }; result: PluginState };
  /**
   * Reads the update source of one recommended plugin, or of every one that
   * names a source, now. Answers once the reads finish; each changed state is
   * also announced by `plugins.updated`. Installs nothing.
   */
  'plugins.checkUpdates': { params: { id?: string }; result: PluginState[] };
  /**
   * Runs an agent command an installed plugin provides: `boite <name> ...`.
   * The executable gets `<name>` and `args`, runs in `cwd`, and its exit code
   * and output come back once it ends, within ten minutes. An agent names its
   * own thread; the owner may name none.
   */
  'plugins.command': { params: { threadId?: ThreadId; name: string; args: string[]; cwd: string }; result: PluginCommandResult };
  /**
   * Owner-only. Runs the plugin in `path`, a folder holding `boite-plugin.json`
   * and its executable, without a download or a digest: what an author tests
   * before publishing. Called again, it reads the folder again and restarts
   * the plugin's app or service.
   */
  'plugins.dev': { params: { path: string }; result: PluginState };
  /**
   * Owner-only. Turns an installed plugin off or on without uninstalling it.
   * Off stops its desktop app, service and gateway, revokes its token and
   * drops its commands, skills, guide lines and slash commands; on brings
   * them back. Its files, data and settings stay either way.
   */
  'plugins.setEnabled': { params: { id: string; enabled: boolean }; result: PluginState };
  /**
   * The values of the plugin's declared settings, defaults filled in. Open to
   * the plugin itself for its own id with no permission; any other id is the owner's.
   */
  'plugins.settings.get': { params: { id: string }; result: PluginSettingValues };
  /**
   * Owner-only. Sets some of the plugin's declared settings. Every key must be
   * declared and every value valid, or nothing changes; the refusal names the key.
   */
  'plugins.settings.set': { params: { id: string; values: PluginSettingValues }; result: PluginState };
}

export interface PluginsRpcEvents {
  /** One plugin after any change. A `url` plugin that comes back `not-installed` is gone from the list. */
  'plugins.updated': PluginState;
  /** A plugin's settings after the owner changed them: every value. Heard by the owner and by that plugin alone. */
  'plugin.settings.changed': { id: string; values: PluginSettingValues };
}
