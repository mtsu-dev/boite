/*
 * The plugin manifest, `boite-plugin.json`: one shape for the plugins the core
 * recommends and for the ones the owner adds from a git URL. The reader below
 * is the whole format. A field it does not know, a value it cannot use, a
 * platform it has never heard of: each is refused with the file, the field and
 * what was expected, never skipped. docs/plugins.md is the authoring guide.
 */

import {
  PLUGIN_ANY_PLATFORM, PLUGIN_EXECUTABLE_PATTERN, PLUGIN_MANIFEST_SCHEMAS, PLUGIN_NAME_PATTERN, PLUGIN_PERMISSION_ALIASES, PLUGIN_PERMISSION_NAMES, PLUGIN_PLATFORMS,
  PLUGIN_SETTING_KEY_PATTERN, PLUGIN_SETTING_LIMITS, PLUGIN_SETTING_TYPES, pluginSettingProblem,
} from '@boite/contracts';
import type {
  PluginAdds, PluginArtifact, PluginCommand, PluginManifest, PluginPermission, PluginPlatform, PluginRejected, PluginSetting, PluginSkill, PluginSlashCommand, ProviderId,
} from '@boite/contracts';
import { BUILTIN_COMMANDS } from '../cli-commands.ts';
import { RETIRED_PROVIDERS } from '../providers/retired.ts';

/** The shipped providers an account pool may name. `echo` is the tests' fake agent. */
export const POOL_PROVIDERS: readonly ProviderId[] = ['antigravity', 'claude', 'codex', 'grok', 'hermes', 'muse', 'opencode', 'opencode-v2', 'pi'];
/** A schema 2 manifest carries its skills and prompts inline; anything past this is not one. */
export const MANIFEST_MAX_BYTES = 256 * 1024;
/** Schema 1 keeps the cap it had before skills and prompts could take room. */
export const MANIFEST_V1_MAX_BYTES = 64 * 1024;

const FIELDS_V1 = ['schema', 'id', 'name', 'version', 'description', 'homepage', 'executable', 'artifacts', 'provides'] as const;
const FIELDS_V2 = [...FIELDS_V1, 'runtime', 'permissions', 'settings'] as const;
const FEATURES_V1 = ['accountPools', 'desktopApp', 'gateway'] as const;
const FEATURES_V2 = [...FEATURES_V1, 'service', 'commands', 'skills', 'prompt', 'slashCommands'] as const;
/** The features that run the executable; a plugin providing none of them has no executable to ship. */
const RUNNING_FEATURES = ['accountPools', 'desktopApp', 'gateway', 'service', 'commands'] as const;

/** What a schema 2 plugin may add to agents and to the composer, so its share of every guide stays small. */
export const PLUGIN_LIMITS = {
  name: 40,
  description: 200,
  usage: 200,
  /** Characters of `provides.prompt`. */
  prompt: 1000,
  /** UTF-8 bytes of one skill's body. */
  skillBody: 32 * 1024,
  /** UTF-8 bytes of one slash command's prompt. */
  slashPrompt: 8 * 1024,
  commands: 20,
  skills: 20,
  slashCommands: 20,
} as const;
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
/** Control characters other than tab, line feed and carriage return: what a Markdown body may not hold. */
const BODY_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** A refusal the RPC layer and the list both carry as is. */
export class ManifestRefused extends Error {
  readonly rejected: PluginRejected;
  constructor(file: string, field: string, expected: string, found: string) {
    const message = `${file}: ${field} must be ${expected}, found ${found}`;
    super(message);
    this.name = 'ManifestRefused';
    this.rejected = { file, field, expected, message };
  }
}

/** `win32-x64` and so on: the artifact key this core downloads. */
export function platformKey(): string {
  return `${process.platform}-${process.arch}`;
}

export function isPluginId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/** What was found, short enough to read in one line. */
function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  if (typeof value === 'string') return JSON.stringify(value.length > 60 ? `${value.slice(0, 60)}...` : value);
  return `${typeof value} ${String(value)}`;
}

/** A refusal built outside the reader, for a file that wraps a manifest or a check the format alone cannot make. */
export function refusal(file: string, field: string, expected: string, value: unknown): ManifestRefused {
  return new ManifestRefused(file, field, expected, describe(value));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * An https URL with a host, no user or password in it: what an artifact, a
 * homepage and a source may point at. Returns the reason it is not, or null.
 */
export function httpsProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'not a URL';
  }
  if (url.protocol !== 'https:') return `a ${url.protocol.replace(':', '')} URL`;
  if (url.hostname.length === 0) return 'a URL with no host';
  if (url.username !== '' || url.password !== '') return 'a URL carrying credentials';
  return null;
}

class Reader {
  constructor(
    private readonly file: string,
    private readonly prefix: string,
  ) {}

  refuse(field: string, expected: string, value: unknown): never {
    throw new ManifestRefused(this.file, `${this.prefix}${field}`, expected, describe(value));
  }

  keys(value: Record<string, unknown>, prefix: string, allowed: readonly string[]): void {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) this.refuse(`${prefix}${key}`, `one of ${allowed.join(', ')}`, key);
    }
  }

  text(value: unknown, field: string, max: number): string {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > max || CONTROL.test(value)) {
      this.refuse(field, `a string of 1 to ${max} characters, no control characters`, value);
    }
    return value;
  }

  /** Markdown or prompt text: lines allowed, other control characters not, bounded in UTF-8 bytes. */
  body(value: unknown, field: string, maxBytes: number): string {
    if (typeof value !== 'string' || value.trim().length === 0 || Buffer.byteLength(value, 'utf8') > maxBytes || BODY_CONTROL.test(value)) {
      this.refuse(field, `text of 1 to ${maxBytes} bytes, no control characters but tabs and line breaks`, value);
    }
    return value;
  }

  matching(value: unknown, field: string, pattern: RegExp, expected: string): string {
    if (typeof value !== 'string' || !pattern.test(value)) this.refuse(field, expected, value);
    return value;
  }

  https(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length > 2048 || httpsProblem(value) !== null) {
      this.refuse(field, 'an https URL with a host and no credentials', value);
    }
    return value;
  }

  artifact(value: unknown, field: string): PluginArtifact {
    if (!isRecord(value)) this.refuse(field, 'an object with url and sha256', value);
    this.keys(value, `${field}.`, ['url', 'sha256']);
    return {
      url: this.https(value['url'], `${field}.url`),
      sha256: this.matching(value['sha256'], `${field}.sha256`, SHA256_PATTERN, '64 lowercase hexadecimal characters'),
    };
  }

  artifacts(value: unknown, runtime: 'native' | 'bun'): NonNullable<PluginManifest['artifacts']> {
    if (runtime === 'bun') {
      if (!isRecord(value) || Object.keys(value).length !== 1 || value[PLUGIN_ANY_PLATFORM] === undefined) {
        this.refuse('artifacts', `an object with the one key ${PLUGIN_ANY_PLATFORM}: a bun plugin ships one file for every machine`, value);
      }
      return { [PLUGIN_ANY_PLATFORM]: this.artifact(value[PLUGIN_ANY_PLATFORM], `artifacts.${PLUGIN_ANY_PLATFORM}`) };
    }
    if (!isRecord(value) || Object.keys(value).length === 0) {
      this.refuse('artifacts', `an object keyed by at least one of ${PLUGIN_PLATFORMS.join(', ')}`, value);
    }
    this.keys(value, 'artifacts.', PLUGIN_PLATFORMS);
    const out: Partial<Record<PluginPlatform, PluginArtifact>> = {};
    for (const platform of PLUGIN_PLATFORMS) {
      if (value[platform] !== undefined) out[platform] = this.artifact(value[platform], `artifacts.${platform}`);
    }
    return out;
  }

  /** The permissions asked for; an older name (`todos`) reads as those it stands for. */
  permissions(value: unknown): PluginPermission[] {
    const expected = `an array of distinct permissions among ${PLUGIN_PERMISSION_NAMES.join(', ')} (or ${Object.keys(PLUGIN_PERMISSION_ALIASES).join(', ')}, their older names)`;
    if (!Array.isArray(value)) this.refuse('permissions', expected, value);
    const out = new Set<PluginPermission>();
    value.forEach((permission: unknown, index) => {
      const known = typeof permission === 'string' && ((PLUGIN_PERMISSION_NAMES as readonly string[]).includes(permission) || Object.hasOwn(PLUGIN_PERMISSION_ALIASES, permission));
      if (!known || value.indexOf(permission) !== index) this.refuse(`permissions[${index}]`, expected, permission);
      for (const name of PLUGIN_PERMISSION_ALIASES[permission as string] ?? [permission as PluginPermission]) out.add(name);
    });
    return [...out];
  }

  /**
   * `settings`: up to 30 declarations with distinct keys, each one of the
   * five types with only the fields that type takes, its default valid for it.
   */
  settings(value: unknown): PluginSetting[] {
    const max = PLUGIN_SETTING_LIMITS.settings;
    if (!Array.isArray(value) || value.length > max) this.refuse('settings', `an array of at most ${max} settings`, value);
    const seen = new Set<string>();
    return value.map((entry: unknown, index) => {
      const at = `settings[${index}]`;
      if (!isRecord(entry)) this.refuse(at, 'an object with key, type, label and default', entry);
      const type = entry['type'];
      if (typeof type !== 'string' || !(PLUGIN_SETTING_TYPES as readonly string[]).includes(type)) this.refuse(`${at}.type`, `one of ${PLUGIN_SETTING_TYPES.join(', ')}`, type);
      const extra = type === 'number' || type === 'slider' ? ['min', 'max', 'step'] : type === 'select' ? ['options'] : [];
      this.keys(entry, `${at}.`, ['key', 'type', 'label', 'description', 'default', ...extra]);
      const key = this.matching(entry['key'], `${at}.key`, PLUGIN_SETTING_KEY_PATTERN, 'a letter, then letters, digits and _, at most 40 characters');
      if (seen.has(key)) this.refuse(`${at}.key`, 'a key no other setting takes', key);
      seen.add(key);
      const base = { key, label: this.text(entry['label'], `${at}.label`, 60) };
      const described = entry['description'] === undefined ? {} : { description: this.text(entry['description'], `${at}.description`, PLUGIN_LIMITS.description) };
      let setting: PluginSetting;
      if (type === 'number' || type === 'slider') {
        const bound = (field: 'min' | 'max' | 'step'): number | undefined => {
          const raw = entry[field];
          if (raw === undefined && (type === 'number' || field === 'step')) return undefined;
          if (typeof raw !== 'number' || !Number.isFinite(raw) || (field === 'step' && raw <= 0)) {
            this.refuse(`${at}.${field}`, field === 'step' ? 'a number above 0' : type === 'slider' ? 'a number (a slider needs min and max)' : 'a number', raw);
          }
          return raw;
        };
        const min = bound('min'), max = bound('max'), step = bound('step');
        if (min !== undefined && max !== undefined && max <= min) this.refuse(`${at}.max`, `a number above min (${min})`, max);
        const range = { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }), ...(step === undefined ? {} : { step }) };
        setting = type === 'slider'
          ? { ...base, ...described, type, default: 0, min: min!, max: max!, ...(step === undefined ? {} : { step }) }
          : { ...base, ...described, type, default: 0, ...range };
      } else if (type === 'select') {
        const options = entry['options'];
        const limit = PLUGIN_SETTING_LIMITS.options;
        if (!Array.isArray(options) || options.length === 0 || options.length > limit) this.refuse(`${at}.options`, `an array of 1 to ${limit} objects with value and label`, options);
        const values = new Set<string>();
        setting = { ...base, ...described, type, default: '', options: options.map((option: unknown, which) => {
          const where = `${at}.options[${which}]`;
          if (!isRecord(option)) this.refuse(where, 'an object with value and label', option);
          this.keys(option, `${where}.`, ['value', 'label']);
          const chosen = this.text(option['value'], `${where}.value`, 60);
          if (values.has(chosen)) this.refuse(`${where}.value`, 'a value no other option takes', chosen);
          values.add(chosen);
          return { value: chosen, label: this.text(option['label'], `${where}.label`, 60) };
        }) };
      } else {
        setting = type === 'switch' ? { ...base, ...described, type, default: false } : { ...base, ...described, type: 'text', default: '' };
      }
      const problem = pluginSettingProblem(setting, entry['default']);
      if (problem !== null) this.refuse(`${at}.default`, problem, entry['default']);
      (setting as { default: unknown }).default = entry['default'];
      return setting;
    });
  }

  /** A list of named entries: an array of 1 to `max` objects with distinct names. */
  named<T>(value: unknown, field: string, max: number, keys: readonly string[], read: (entry: Record<string, unknown>, at: string) => T & { name: string }): T[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > max) this.refuse(field, `an array of 1 to ${max} objects`, value);
    const seen = new Set<string>();
    return value.map((entry: unknown, index) => {
      const at = `${field}[${index}]`;
      if (!isRecord(entry)) this.refuse(at, `an object with ${keys.join(', ')}`, entry);
      this.keys(entry, `${at}.`, keys);
      const out = read(entry, at);
      if (seen.has(out.name)) this.refuse(`${at}.name`, `a name no other entry of ${field} takes`, out.name);
      seen.add(out.name);
      return out;
    });
  }

  name(value: unknown, field: string): string {
    const name = this.matching(value, field, PLUGIN_NAME_PATTERN, `lowercase words of letters and digits joined by hyphens, starting with a letter, 1 to ${PLUGIN_LIMITS.name} characters`);
    if (name.length > PLUGIN_LIMITS.name) this.refuse(field, `at most ${PLUGIN_LIMITS.name} characters`, name);
    return name;
  }

  commands(value: unknown): PluginCommand[] {
    return this.named(value, 'provides.commands', PLUGIN_LIMITS.commands, ['name', 'description', 'usage'], (entry, at) => {
      const name = this.name(entry['name'], `${at}.name`);
      if (BUILTIN_COMMANDS.has(name)) this.refuse(`${at}.name`, 'a name no built-in boite command takes', name);
      const command: PluginCommand = { name, description: this.text(entry['description'], `${at}.description`, PLUGIN_LIMITS.description) };
      if (entry['usage'] !== undefined) command.usage = this.text(entry['usage'], `${at}.usage`, PLUGIN_LIMITS.usage);
      return command;
    });
  }

  skills(value: unknown): PluginSkill[] {
    return this.named(value, 'provides.skills', PLUGIN_LIMITS.skills, ['name', 'description', 'body'], (entry, at) => ({
      name: this.name(entry['name'], `${at}.name`),
      description: this.text(entry['description'], `${at}.description`, PLUGIN_LIMITS.description),
      body: this.body(entry['body'], `${at}.body`, PLUGIN_LIMITS.skillBody),
    }));
  }

  slashCommands(value: unknown): PluginSlashCommand[] {
    return this.named(value, 'provides.slashCommands', PLUGIN_LIMITS.slashCommands, ['name', 'description', 'hint', 'prompt'], (entry, at) => {
      const command: PluginSlashCommand = {
        name: this.name(entry['name'], `${at}.name`),
        description: this.text(entry['description'], `${at}.description`, PLUGIN_LIMITS.description),
        prompt: this.body(entry['prompt'], `${at}.prompt`, PLUGIN_LIMITS.slashPrompt),
      };
      if (entry['hint'] !== undefined) command.hint = this.text(entry['hint'], `${at}.hint`, 60);
      return command;
    });
  }

  provides(value: unknown, schema: 1 | 2): PluginManifest['provides'] {
    const features = schema === 1 ? FEATURES_V1 : FEATURES_V2;
    if (!isRecord(value) || Object.keys(value).length === 0) {
      this.refuse('provides', `an object naming at least one of ${features.join(', ')}`, value);
    }
    this.keys(value, 'provides.', features);
    const provides: PluginManifest['provides'] = {};
    if (value['accountPools'] !== undefined) provides.accountPools = this.pools(value['accountPools']);
    if (value['commands'] !== undefined) provides.commands = this.commands(value['commands']);
    if (value['skills'] !== undefined) provides.skills = this.skills(value['skills']);
    if (value['slashCommands'] !== undefined) provides.slashCommands = this.slashCommands(value['slashCommands']);
    if (value['prompt'] !== undefined) {
      const prompt = this.body(value['prompt'], 'provides.prompt', PLUGIN_LIMITS.prompt * 4);
      if (prompt.length > PLUGIN_LIMITS.prompt) this.refuse('provides.prompt', `at most ${PLUGIN_LIMITS.prompt} characters`, prompt);
      provides.prompt = prompt;
    }
    // No fields today for these: a key there is a feature this core does not know.
    for (const feature of ['desktopApp', 'gateway', 'service'] as const) {
      const block = value[feature];
      if (block === undefined) continue;
      if (!isRecord(block)) this.refuse(`provides.${feature}`, 'an empty object', block);
      const extra = Object.keys(block)[0];
      if (extra !== undefined) this.refuse(`provides.${feature}.${extra}`, `absent: ${feature} takes no fields`, extra);
      provides[feature] = {};
    }
    return provides;
  }

  pools(pools: unknown): { providers: ProviderId[] } {
    if (!isRecord(pools)) this.refuse('provides.accountPools', 'an object with providers', pools);
    this.keys(pools, 'provides.accountPools.', ['providers']);
    const providers = pools['providers'];
    const expected = `a non-empty array of distinct provider ids among ${POOL_PROVIDERS.join(', ')}`;
    if (!Array.isArray(providers) || providers.length === 0) this.refuse('provides.accountPools.providers', expected, providers);
    providers.forEach((provider: unknown, index) => {
      if (typeof provider !== 'string' || (!POOL_PROVIDERS.includes(provider) && !RETIRED_PROVIDERS.has(provider)) || providers.indexOf(provider) !== index) {
        this.refuse(`provides.accountPools.providers[${index}]`, expected, provider);
      }
    });
    // A plugin installed under an older Boite keeps loading: a provider retired since then has no accounts to pool.
    return { providers: (providers as string[]).filter((provider) => !RETIRED_PROVIDERS.has(provider)) };
  }
}

/**
 * The manifest, or a `ManifestRefused` naming the first thing wrong. `file` is
 * what the refusal says it read: a path, or `boite-plugin.json` for a
 * repository, or the recommended list's entry. `prefix` places the fields when
 * the manifest sits inside another file, `manifest.` in `installed.json`.
 */
/** `dev`: a folder `boite plugin dev` runs in place, whose manifest needs no artifacts; any it has are read, then ignored. */
export function parseManifest(raw: unknown, file: string, prefix = '', dev = false): PluginManifest {
  const read: Reader = new Reader(file, prefix);
  if (!isRecord(raw)) throw new ManifestRefused(file, prefix === '' ? '(root)' : prefix.replace(/\.$/, ''), 'a JSON object', describe(raw));
  const schema = raw['schema'];
  if (schema !== 1 && schema !== 2) read.refuse('schema', PLUGIN_MANIFEST_SCHEMAS.join(' or '), schema);
  read.keys(raw, '', schema === 1 ? FIELDS_V1 : FIELDS_V2);
  const head = {
    id: read.matching(raw['id'], 'id', ID_PATTERN, 'lowercase letters, digits and inner hyphens, 1 to 64 characters'),
    name: read.text(raw['name'], 'name', 60),
    version: read.matching(raw['version'], 'version', VERSION_PATTERN, 'a version such as 1.2.0 or 1.2.0-beta.1'),
    description: read.text(raw['description'], 'description', 300),
    homepage: read.https(raw['homepage'], 'homepage'),
  };
  const executable = (expected: string): string => read.matching(raw['executable'], 'executable', PLUGIN_EXECUTABLE_PATTERN, expected);
  const native = 'a file name of letters, digits, _ and -, no extension (Boite adds .exe on Windows)';
  if (schema === 1) {
    return { schema: 1, ...head, executable: executable(native), ...(dev && raw['artifacts'] === undefined ? {} : { artifacts: read.artifacts(raw['artifacts'], 'native') }), provides: read.provides(raw['provides'], 1) };
  }
  const runtime = raw['runtime'] === undefined ? 'native' : raw['runtime'];
  if (runtime !== 'native' && runtime !== 'bun') read.refuse('runtime', 'native or bun', raw['runtime']);
  const provides = read.provides(raw['provides'], 2);
  const manifest: PluginManifest = { schema: 2, ...head, provides };
  if (raw['runtime'] !== undefined) manifest.runtime = runtime;
  if (raw['permissions'] !== undefined) manifest.permissions = read.permissions(raw['permissions']);
  if (raw['settings'] !== undefined) manifest.settings = read.settings(raw['settings']);
  if (RUNNING_FEATURES.some((feature) => provides[feature] !== undefined)) {
    manifest.executable = executable(runtime === 'bun' ? 'a file name of letters, digits, _ and -, no extension (Boite adds .js)' : native);
    if (!dev || raw['artifacts'] !== undefined) manifest.artifacts = read.artifacts(raw['artifacts'], runtime);
  } else {
    // Skills, a prompt and slash commands are text: nothing to download, nothing to run.
    for (const field of ['executable', 'artifacts', 'runtime'] as const) {
      if (raw[field] !== undefined) read.refuse(field, `absent: a plugin that provides only skills, a prompt or slash commands runs nothing (one of ${RUNNING_FEATURES.join(', ')} needs ${field})`, raw[field]);
    }
  }
  return manifest;
}

/** The manifest from its JSON text, the parse failure refused like any field. */
export function parseManifestText(text: string, file: string, dev = false): PluginManifest {
  // The fetch path checks the blob's size before reading it; a dev folder's file is held to the same cap here.
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MANIFEST_MAX_BYTES) throw new ManifestRefused(file, '(file)', `at most ${MANIFEST_MAX_BYTES} bytes`, `${bytes} bytes`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ManifestRefused(file, '(file)', 'valid JSON', error instanceof Error ? error.message : 'unreadable text');
  }
  const manifest = parseManifest(raw, file, '', dev);
  if (manifest.schema === 1 && bytes > MANIFEST_V1_MAX_BYTES) throw new ManifestRefused(file, '(file)', `at most ${MANIFEST_V1_MAX_BYTES} bytes for schema 1`, `${bytes} bytes`);
  return manifest;
}

/** What an install downloads here: the platform's file, the one `bun` file, or null for a text-only plugin or a missing platform. */
export function artifactFor(manifest: PluginManifest, platform = platformKey()): PluginArtifact | null {
  if (manifest.artifacts === undefined) return null;
  if (manifest.runtime === 'bun') return manifest.artifacts[PLUGIN_ANY_PLATFORM] ?? null;
  return manifest.artifacts[platform as PluginPlatform] ?? null;
}

/** Whether the plugin ships an executable: false for one that provides only text. */
export function runsExecutable(manifest: PluginManifest): boolean {
  return manifest.executable !== undefined;
}

/** The file name the executable is saved under: `.js` for `bun`, `.exe` added on Windows for a native one. */
export function executableFile(manifest: PluginManifest, platform: NodeJS.Platform = process.platform): string | null {
  if (manifest.executable === undefined) return null;
  if (manifest.runtime === 'bun') return `${manifest.executable}.js`;
  return platform === 'win32' ? `${manifest.executable}.exe` : manifest.executable;
}

export function permissionsOf(manifest: PluginManifest): PluginPermission[] {
  return manifest.permissions ?? [];
}

export function providesService(manifest: PluginManifest): boolean {
  return manifest.provides.service !== undefined;
}

/**
 * What `found` changes in the access the owner approved with `approved`: the
 * schema (schema 1 holds the owner token), the permissions, or what Boite
 * starts on its own (a desktop app, a service, a gateway, account pools),
 * each of which runs with that token. Null when it keeps them. A dev folder
 * reread and a recommended update both stop there until the owner loads it
 * again.
 */
export function authorityChange(approved: PluginManifest, found: PluginManifest): string | null {
  if (found.schema !== approved.schema) return `its schema from ${approved.schema} to ${found.schema}`;
  const before = [...permissionsOf(approved)].sort().join(', ');
  const after = [...permissionsOf(found)].sort().join(', ');
  if (before !== after) return `its permissions from [${before}] to [${after}]`;
  const started = (manifest: PluginManifest): string => [
    ...(providesApp(manifest) ? ['desktop app'] : []),
    ...(providesService(manifest) ? ['service'] : []),
    ...(providesGateway(manifest) ? ['gateway'] : []),
    ...[...poolsOf(manifest)].sort().map((provider) => `${provider} pool`),
  ].join(', ');
  if (started(found) !== started(approved)) return `what Boite starts for it from [${started(approved)}] to [${started(found)}]`;
  return null;
}

/** What the plugin adds to agents and to the composer, by name. */
export function addsOf(manifest: PluginManifest): PluginAdds {
  return {
    commands: (manifest.provides.commands ?? []).map((command) => command.name),
    skills: (manifest.provides.skills ?? []).map((skill) => skill.name),
    slashCommands: (manifest.provides.slashCommands ?? []).map((command) => command.name),
    prompt: manifest.provides.prompt !== undefined,
  };
}

export function poolsOf(manifest: PluginManifest): ProviderId[] {
  return manifest.provides.accountPools?.providers ?? [];
}

export function providesApp(manifest: PluginManifest): boolean {
  return manifest.provides.desktopApp !== undefined;
}

export function providesGateway(manifest: PluginManifest): boolean {
  return manifest.provides.gateway !== undefined;
}

/**
 * The account pool commands, the contract a plugin that provides
 * `accountPools` answers. `list` prints JSON on stdout; the other three change
 * the saved logins and print nothing Boite reads.
 */
export const POOL_COMMANDS = {
  list: (provider: string, refresh: boolean) => ['list', `-${provider}`, '-Json', ...(refresh ? ['-Refresh'] : [])],
  add: (provider: string) => ['add', `-${provider}`],
  switch: (provider: string, email: string) => ['switch', `-${provider}`, '-Email', email, '-Yes'],
  remove: (provider: string, email: string) => ['remove', `-${provider}`, '-Email', email, '-Yes'],
} as const;

/**
 * What the owner is shown before an install: every command line Boite may
 * run, and what a desktop app or a service is handed. A schema 1 desktop app
 * gets the owner token; every schema 2 process gets the plugin's own.
 */
export function commandsOf(manifest: PluginManifest): string[] {
  const file = executableFile(manifest);
  if (file === null) return [];
  const program = manifest.runtime === 'bun' ? `bun ${file}` : manifest.executable!;
  const run = (args: readonly string[]) => [program, ...args].join(' ');
  const token = manifest.schema === 1 ? '<the owner token>' : `<${manifest.id}'s token: ${permissionsOf(manifest).join(', ') || 'no permission'}>`;
  const env = `environment: BOITE_CORE_URL=<this core> BOITE_TOKEN=${token} BOITE_PLUGIN_ID=${manifest.id}${manifest.schema === 1 ? '' : ' BOITE_PLUGIN_DATA=<its data directory>'}`;
  const app = [
    ...(providesApp(manifest) || providesService(manifest) ? [program, env] : []),
    ...(providesGateway(manifest) ? [`${program} --config <its data directory>/${manifest.executable}.toml`] : []),
    ...(manifest.provides.commands ?? []).map((command) => `${run([command.name])} ${command.usage ?? '<arguments>'} (an agent's boite ${command.name}, in its directory)`),
    ...(!providesApp(manifest) && !providesService(manifest) && manifest.provides.commands !== undefined ? [env] : []),
  ];
  if (poolsOf(manifest).length === 0) return app;
  return [
    ...app,
    run(POOL_COMMANDS.list('<pool>', false)),
    run(POOL_COMMANDS.list('<pool>', true)),
    run(POOL_COMMANDS.add('<pool>')),
    run(POOL_COMMANDS.switch('<pool>', '<email>')),
    run(POOL_COMMANDS.remove('<pool>', '<email>')),
  ];
}
