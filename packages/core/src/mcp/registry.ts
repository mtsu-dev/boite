import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCP_PRESETS, McpInputError, mcpSecretPatch, normalizeMcpServer, type McpServer, type McpServerInput, type ProjectId } from '@boite/contracts';
import type { Core } from '../core.ts';
import { invalidParams } from '../errors.ts';
import type { StdioServer } from './lazy.ts';

export interface HttpServer { url: string; headers: Record<string, string> }
export type ManagedServer = { id: string; redact: (text: string) => string } & (StdioServer | HttpServer);

type Credentials = { env: Record<string, string>; headers: Record<string, string> };
type StoredSecrets = Record<string, Credentials>;
const SERVERS_KEY = 'mcp:servers';
const PENDING_KEY = 'mcp:secrets-pending';
const emptyCredentials: Credentials = { env: {}, headers: {} };
const encoder = new TextEncoder();

function applyPatch(values: Record<string, string>, patch: Record<string, string | null>, header: boolean): Record<string, string> {
  const next = new Map(Object.entries(values));
  for (const [key, value] of Object.entries(patch)) {
    const old = [...next.keys()].find(candidate => header ? candidate.toLowerCase() === key.toLowerCase() : candidate.toUpperCase() === key.toUpperCase());
    if (old !== undefined) next.delete(old);
    if (value !== null) next.set(key, value);
  }
  return Object.fromEntries(next);
}

export class McpRegistry {
  readonly #revisions = new Map<string, number>();
  #revision = 0;

  constructor(readonly core: Core) {}

  #servers(): McpServer[] { return (this.core.journal.getSetting(SERVERS_KEY) as McpServer[] | undefined) ?? []; }

  list(): { servers: McpServer[]; presets: typeof MCP_PRESETS } { return { servers: this.#servers(), presets: MCP_PRESETS }; }

  get(id: unknown): McpServer {
    const server = this.#servers().find(item => item.id === id);
    if (!server) throw invalidParams('id must be an installed MCP server id', { field: 'id', expected: 'an installed MCP server id' });
    return server;
  }

  save(input: McpServerInput): McpServer {
    const servers = this.#servers();
    let next: McpServer;
    try {
      next = normalizeMcpServer(input, servers, id => {
        const project = this.core.journal.getProject(id);
        return !!project && !project.archived && project.kind !== 'drafts';
      });
    } catch (error) {
      if (!(error instanceof McpInputError)) throw error;
      throw invalidParams(error.message, { field: error.field, expected: error.expected });
    }
    const previous = this.#readSecrets();
    const stored = input.id === undefined ? emptyCredentials : this.#credentials(next.id, previous);
    const patch = mcpSecretPatch(input);
    const credentials = {
      env: applyPatch(stored.env, patch.env, false),
      headers: applyPatch(stored.headers, patch.headers, true),
    };
    const updated = { ...previous };
    if (Object.keys(credentials.env).length || Object.keys(credentials.headers).length) {
      Object.defineProperty(updated, next.id, { value: credentials, enumerable: true, configurable: true });
    } else delete updated[next.id];
    this.#write(servers.some(server => server.id === next.id)
      ? servers.map(server => server.id === next.id ? next : server)
      : [...servers, next], next.id, previous, updated);
    return next;
  }

  toggle(id: string, enabled: boolean): McpServer {
    if (typeof enabled !== 'boolean') throw invalidParams('enabled must be a boolean', { field: 'enabled', expected: 'a boolean' });
    const current = this.get(id);
    if (current.enabled === enabled) return current;
    const next = { ...current, enabled };
    this.#write(this.#servers().map(server => server.id === id ? next : server), id);
    return next;
  }

  remove(id: string): { removed: true } {
    this.get(id);
    const previous = this.#readSecrets();
    const updated = { ...previous };
    delete updated[id];
    this.#write(this.#servers().filter(server => server.id !== id), id, previous, updated);
    return { removed: true };
  }

  revokeManaged(): void {
    for (const server of this.#servers()) {
      this.#revisions.set(server.id, ++this.#revision);
      this.core.lazyMcp.revoke(server.id, false);
    }
  }

  #matching(projectId: ProjectId | null): McpServer[] {
    if (this.core.policy.values.mcp === false) return [];
    return this.#servers().filter(server => server.enabled && (server.scope === 'global' || (projectId !== null && server.projectIds.includes(projectId))));
  }

  revision(projectId: ProjectId | null): string | null {
    const servers = this.#matching(projectId);
    return servers.length === 0 ? null : JSON.stringify(servers.map(server => [server.id, this.#revisions.get(server.id) ?? 0]));
  }

  resolve(projectId: ProjectId | null): Map<string, ManagedServer> {
    const servers = this.#matching(projectId);
    if (servers.length === 0) return new Map();
    const stored = this.#readSecrets();
    return new Map(servers.map(server => [`boite-managed-${server.id}`, this.runtime(server, stored)]));
  }

  runtime(server: McpServer, stored = this.#readSecrets()): ManagedServer {
    const saved = this.#credentials(server.id, stored);
    const secretEnv = Object.fromEntries(server.secretEnvKeys.filter(key => Object.hasOwn(saved.env, key)).map(key => [key, saved.env[key]!]));
    const secretHeaders = Object.fromEntries(server.secretHeaderKeys.filter(key => Object.hasOwn(saved.headers, key)).map(key => [key, saved.headers[key]!]));
    const parts = new Set<string>();
    for (const [key, value] of Object.entries(server.transport === 'http' ? secretHeaders : secretEnv)) {
      // Fetch trims header values before sending them upstream.
      const sent = server.transport === 'http' ? value.trim() : value;
      const credential = key.toLowerCase() === 'authorization' ? sent.replace(/^(?:bearer|basic)\s+/i, '') : sent;
      for (const text of new Set([value, sent, credential])) {
        if (text.length === 0) continue;
        parts.add(text);
        parts.add(encodeURIComponent(text));
        parts.add(JSON.stringify(text).slice(1, -1));
        const encoded = encoder.encode(text);
        const digest = createHash('sha256').update(encoded).digest('hex');
        this.core.secrets.masks.add('mcp', digest, key, encoded);
        encoded.fill(0);
      }
    }
    const needles = [...parts].sort((a, b) => b.length - a.length);
    const redact = (text: string): string => {
      for (const needle of needles) text = text.replaceAll(needle, '[redacted]');
      return text;
    };
    const base = { id: server.id, redact };
    if (server.transport === 'http') return { ...base, url: server.url!, headers: { ...server.headers, ...secretHeaders } };
    return { ...base, command: server.command!, args: server.args!, env: { ...server.env, ...secretEnv } };
  }

  #credentials(id: string, stored: StoredSecrets): Credentials {
    return Object.hasOwn(stored, id) ? stored[id]! : emptyCredentials;
  }

  #write(servers: McpServer[], id: string, previous?: StoredSecrets, updated?: StoredSecrets): void {
    const changesSecrets = updated !== undefined && JSON.stringify(previous) !== JSON.stringify(updated);
    const journal = this.core.journal;
    const pending = this.#secretPath(true);
    if (changesSecrets) {
      this.#settleSecrets();
      this.#writeSecrets(pending, updated);
    }
    try {
      journal.db.transaction(() => {
        journal.setSetting(SERVERS_KEY, servers);
        journal.deleteSetting(`mcp-manifest:managed:${id}`);
        if (changesSecrets) journal.setSetting(PENDING_KEY, true);
      })();
    } catch (error) {
      if (changesSecrets) rmSync(pending, { force: true });
      throw error;
    }
    if (changesSecrets) {
      try { this.#settleSecrets(); }
      catch { this.core.log('warn', 'The MCP credential update is committed but its file could not be finalized'); }
    }
    if (servers.some(server => server.id === id)) this.#revisions.set(id, ++this.#revision);
    else this.#revisions.delete(id);
    this.core.lazyMcp.revoke(id);
    this.core.bus.emit('mcp.changed', {});
  }

  #secretPath(pending = false): string { return join(this.core.dataDir, pending ? 'mcp-secrets.pending.json' : 'mcp-secrets.json'); }

  /** The database marker chooses which file is current across a core crash. */
  #settleSecrets(): void {
    const journal = this.core.journal;
    if (journal.getSetting(PENDING_KEY) === true) {
      try { renameSync(this.#secretPath(true), this.#secretPath()); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      journal.deleteSetting(PENDING_KEY);
    } else rmSync(this.#secretPath(true), { force: true });
  }

  #readSecrets(): StoredSecrets {
    if (this.core.journal.getSetting(PENDING_KEY) === true) {
      try { this.#settleSecrets(); }
      catch {
        // A committed draft stays current even if the last step cannot run yet.
        const pending = this.#readSecretFile(this.#secretPath(true));
        if (pending !== undefined) return pending;
      }
    }
    return this.#readSecretFile(this.#secretPath()) ?? {};
  }

  #readSecretFile(path: string): StoredSecrets | undefined {
    try {
      const stat = lstatSync(path);
      if (!stat.isFile()) throw new Error('mcp-secrets.json must be a regular file');
      if (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600) chmodSync(path, 0o600);
      return JSON.parse(readFileSync(path, 'utf8')) as StoredSecrets;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new Error('Cannot read the MCP credentials file');
    }
  }

  #writeSecrets(path: string, secrets: StoredSecrets): void {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(secrets), { flag: 'wx', mode: 0o600, flush: true });
      renameSync(temporary, path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
