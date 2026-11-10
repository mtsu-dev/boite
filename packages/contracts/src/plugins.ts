import type { QuotaWindow } from './accounts';
import type { ProviderId, ThreadId, Timestamp } from './ids';
import type { RpcEventName, RpcMethodName } from './index';

// ---------------------------------------------------------------------------
// Plugins: one manifest format, `boite-plugin.json`. The recommended ones ship
// inside the core; the owner adds others from a git URL. docs/plugins.md.
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
// reaches only what its manifest declares, shown to the owner before install.
// A schema 1 desktop app keeps the owner token it always had.
// ---------------------------------------------------------------------------

export const PLUGIN_PERMISSION_NAMES = ['threads.read', 'threads.write', 'threads.archive', 'todos', 'ui.reveal'] as const;
export type PluginPermission = (typeof PLUGIN_PERMISSION_NAMES)[number];

/** What one permission opens: the methods a plugin token may call and the events it hears. */
export interface PluginPermissionGrant {
  methods: readonly RpcMethodName[];
  events: readonly RpcEventName[];
}

/**
 * The whole of what a plugin token reaches. A method or an event in none of
 * these is refused to every plugin, whatever it declares.
 */
export const PLUGIN_PERMISSIONS: Readonly<Record<PluginPermission, PluginPermissionGrant>> = {
  // Every conversation of every project, read only: rows, transcripts, the project list.
  'threads.read': {
    methods: ['threads.list', 'threads.get', 'projects.list'],
    events: ['thread.created', 'thread.updated', 'thread.removed', 'turn.started', 'turn.finished'],
  },
  // Starts conversations and turns, and stops them: it spends the owner's agent quota.
  'threads.write': { methods: ['threads.create', 'turns.start', 'turns.stop'], events: [] },
  // Archives a conversation once it is idle and unpinned, marked done in the plugin's name; never restores one.
  'threads.archive': { methods: ['threads.archive'], events: [] },
  // The project boards: read, add and update cards.
  todos: { methods: ['todos.list', 'todos.add', 'todos.update'], events: ['todos.updated'] },
  // Brings a conversation, a bot or the app updates to the front of the owner's desktop window.
  'ui.reveal': { methods: ['ui.reveal'], events: [] },
};

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
  /** What it adds to agents and to the composer, by name. Absent from older cores. */
  adds?: PluginAdds | null;
  /** The folder a `dev` plugin runs from. Absent or null otherwise. */
  devPath?: string | null;
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
 * reviewed list's, never the plugin's own: docs/plugins.md, Updating.
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
  /** Installs exactly what a preview showed: that manifest, read at that commit. */
  'plugins.add': { params: { previewId: string }; result: PluginState };
  /** Installs a recommended plugin, or reinstalls one already added from a URL. */
  'plugins.install': { params: { id: string }; result: PluginState };
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
}

export interface PluginsRpcEvents {
  /** One plugin after any change. A `url` plugin that comes back `not-installed` is gone from the list. */
  'plugins.updated': PluginState;
}
