import type { McpServer, McpServerInput } from './mcp';
import type { Os } from './providers';

// The core and UI provide URL without needing DOM types in the contracts package.
declare const URL: new (value: string) => { username: string; password: string; href: string; origin: string; protocol: string; hostname: string };

export class McpInputError extends Error {
  constructor(readonly field: string, readonly expected: string) {
    super(`${field} must be ${expected}`);
  }
}

const CONTROL = /[\p{Cc}\p{Cs}]/u;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_KEY = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const RESERVED_HEADERS = new Set(['accept', 'connection', 'content-length', 'content-type', 'host', 'mcp-session-id', 'mcp-protocol-version', 'transfer-encoding', 'upgrade', 'last-event-id']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

export function mcpHttpOriginChanged(previous: string | undefined, next: string | undefined): boolean {
  if (previous === undefined || next === undefined) return false;
  try { return new URL(previous).origin !== new URL(next).origin; }
  catch { return false; }
}

export function mcpHttpAllowsSecretHeaders(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' || (protocol === 'http:' && LOOPBACK_HOSTS.has(hostname));
  } catch { return false; }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new McpInputError(field, 'an object');
  return value as Record<string, unknown>;
}

function valueText(value: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || CONTROL.test(value) || (!allowEmpty && value.trim().length === 0)) {
    throw new McpInputError(field, `a ${allowEmpty ? '' : 'non-empty '}Unicode string of up to ${max} characters without control characters`);
  }
  return value;
}

function entries(value: unknown, field: string, header: boolean, secret: boolean, normalize: (key: string) => string): [string, string | null][] {
  const pairs = Object.entries(record(value === undefined ? {} : value, field));
  if (pairs.length > 64) throw new McpInputError(field, 'a map with at most 64 keys');
  const seen = new Set<string>();
  return pairs.map(([key, val]) => {
    const identity = normalize(key);
    if (key.length > 128 || !(header ? HEADER_KEY : ENV_KEY).test(key) || seen.has(identity) ||
      (header && (RESERVED_HEADERS.has(identity) || identity.startsWith('proxy-'))) ||
      (!header && key.toUpperCase().startsWith('BOITE_'))) {
      throw new McpInputError(field, `distinct, valid ${header ? 'HTTP header' : 'environment variable'} names outside Boite’s reserved keys`);
    }
    seen.add(identity);
    if (secret && val === null) return [key, null];
    const text = valueText(val, `${field}.${key}`, 8192, !secret);
    if (header && /[^\x20-\x7e]/.test(text)) throw new McpInputError(`${field}.${key}`, 'a printable ASCII HTTP header value');
    return [key, text];
  });
}

export function mcpSecretPatch(input: McpServerInput, envKey: (key: string) => string): { env: Record<string, string | null>; headers: Record<string, string | null> } {
  return {
    env: Object.fromEntries(entries(input.secretEnv, 'secretEnv', false, true, envKey)),
    headers: Object.fromEntries(entries(input.secretHeaders, 'secretHeaders', true, true, headerKey)),
  };
}

function headerKey(key: string): string { return key.toLowerCase(); }

export function mcpEnvKey(key: string, os: Os): string { return os === 'windows' ? key.toUpperCase() : key; }

function keySet(previous: string[], patch: Record<string, string | null>, normalize: (key: string) => string): string[] {
  const keys = new Map(previous.map(key => [normalize(key), key]));
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) keys.delete(normalize(key));
    else keys.set(normalize(key), key);
  }
  return [...keys.values()];
}

function httpUrl(value: unknown): string {
  const raw = valueText(value, 'url', 4096).trim();
  let url: InstanceType<typeof URL>;
  try { url = new URL(raw); } catch { throw new McpInputError('url', 'an absolute HTTP or HTTPS URL'); }
  if (!/^https?:\/\//i.test(raw) || url.username || url.password || raw.includes('#')) {
    throw new McpInputError('url', 'an absolute HTTP or HTTPS URL without credentials or a fragment');
  }
  return url.href;
}

export function normalizeMcpServer(raw: unknown, servers: readonly McpServer[], hasProject: (id: string) => boolean, envKey: (key: string) => string): McpServer {
  const p = record(raw, 'server');
  const previous = p.id === undefined ? undefined : servers.find(server => server.id === p.id);
  if (p.id !== undefined && previous === undefined) throw new McpInputError('id', 'an installed MCP server id');
  const name = valueText(p.name, 'name', 80).trim().normalize('NFC');
  const slug = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) throw new McpInputError('name', 'a name containing a Latin letter or digit');
  const id = previous?.id ?? slug;
  if (servers.some(server => server.id !== previous?.id && (server.id === id || server.name.toLowerCase() === name.toLowerCase()))) {
    throw new McpInputError('name', 'a unique server name and slug');
  }
  if (p.transport !== 'stdio' && p.transport !== 'http') throw new McpInputError('transport', 'stdio or http');
  const enabled = p.enabled === undefined ? previous?.enabled : p.enabled;
  if (typeof enabled !== 'boolean') throw new McpInputError('enabled', 'a boolean');
  const projectIds = p.projectIds;
  if (p.scope !== 'global' && p.scope !== 'projects') throw new McpInputError('scope', 'global or projects');
  if (!Array.isArray(projectIds) || (p.scope === 'global' ? projectIds.length !== 0 : projectIds.length === 0) ||
    new Set(projectIds).size !== projectIds.length || !projectIds.every((id): id is string => typeof id === 'string' && hasProject(id))) {
    throw new McpInputError('projectIds', p.scope === 'global' ? 'empty for global scope' : 'distinct active project ids');
  }
  const patch = mcpSecretPatch(p as unknown as McpServerInput, envKey);
  const env = Object.fromEntries(entries(p.env, 'env', false, false, envKey)) as Record<string, string>;
  const headers = Object.fromEntries(entries(p.headers, 'headers', true, false, headerKey)) as Record<string, string>;
  const url = p.transport === 'http' ? httpUrl(p.url) : undefined;
  const secretEnvKeys = keySet(previous?.secretEnvKeys ?? [], patch.env, envKey);
  const savedHeaders = mcpHttpOriginChanged(previous?.url, url) ? [] : previous?.secretHeaderKeys ?? [];
  const secretHeaderKeys = keySet(savedHeaders, patch.headers, headerKey);
  if (secretEnvKeys.some(key => Object.keys(env).some(other => envKey(key) === envKey(other)))) throw new McpInputError('env', 'keys distinct from secretEnv');
  if (secretHeaderKeys.some(key => Object.keys(headers).some(other => headerKey(key) === headerKey(other)))) throw new McpInputError('headers', 'keys distinct from secretHeaders');
  if (Object.keys(headers).some(key => ['authorization', 'cookie', 'x-api-key'].includes(key.toLowerCase()))) {
    throw new McpInputError('headers', 'Authorization, Cookie and X-API-Key in secretHeaders');
  }
  const base: Omit<McpServer, 'transport'> = { id, name, enabled, scope: p.scope, projectIds, env, headers, envKeys: Object.keys(env), headerKeys: Object.keys(headers), secretEnvKeys, secretHeaderKeys };
  if (p.transport === 'stdio') {
    if (base.headerKeys.length || secretHeaderKeys.length || p.url !== undefined) throw new McpInputError('headers', 'empty for stdio');
    const command = valueText(p.command, 'command', 4096).trim();
    if (!Array.isArray(p.args) || p.args.length > 128) throw new McpInputError('args', 'an array of up to 128 arguments');
    return { ...base, transport: p.transport, command, args: p.args.map((arg, i) => valueText(arg, `args[${i}]`, 8192, true)) };
  }
  if (base.envKeys.length || secretEnvKeys.length || p.command !== undefined || p.args !== undefined) throw new McpInputError('env', 'empty for HTTP');
  if (secretHeaderKeys.length && !mcpHttpAllowsSecretHeaders(url!)) {
    throw new McpInputError('url', 'HTTPS or loopback HTTP when using secret headers');
  }
  return { ...base, transport: p.transport, url };
}
