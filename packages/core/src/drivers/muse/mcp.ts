import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { McpRegistration } from '../../mcp/lazy.ts';
import { agentEnv } from '../../providers/resolve.ts';
import { knownVersion, readVersion } from '../../providers/versions.ts';
import type { SessionContext } from '../types.ts';

const AUTH = 'BOITE_MCP_AUTHORIZATION';
const MCP_CONFIG_SINCE = [1, 4, 13] as const;
const PROBE_TIMEOUT_MS = 2_000;
const PROBE_MAX_BYTES = 4_096;

interface ProbedVersion {
  mtimeMs: number;
  size: number;
  version: string;
}

const probed = new Map<string, ProbedVersion>();

export function museVersionSupportsMcp(version: string | null): boolean {
  if (version === null) return false;
  const parts = /(\d+)\.(\d+)\.(\d+)/.exec(version)?.slice(1).map(Number);
  if (parts === undefined) return false;
  const index = parts.findIndex((part, i) => part !== MCP_CONFIG_SINCE[i]);
  return index === -1 || parts[index]! > MCP_CONFIG_SINCE[index]!;
}

/**
 * Checks whether a Muse binary accepts `-c mcp_servers.<name>=...` config flags:
 * reads `.muse-version` when Boite installed it, falls back to the cached provider
 * version, and otherwise caches a successful `--version` per binary revision.
 * Null leaves support undetermined so a later host can probe again.
 */
export async function museMcpSupport(executable: string, probeVersion: () => Promise<string | null>): Promise<boolean | null> {
  if (!basename(executable).toLowerCase().startsWith('muse')) return false;
  try {
    const file = readFileSync(join(dirname(executable), '.muse-version'), 'utf8').trim();
    if (file.length > 0) return museVersionSupportsMcp(file);
  } catch { /* fall through for system-installed binaries without .muse-version */ }
  const cached = knownVersion(executable);
  if (cached !== null) return museVersionSupportsMcp(cached);
  let stat: { mtimeMs: number; size: number } | null = null;
  try { stat = statSync(executable); } catch { return null; }
  const kept = probed.get(executable);
  if (kept !== undefined && kept.mtimeMs === stat.mtimeMs && kept.size === stat.size) {
    return museVersionSupportsMcp(kept.version);
  }
  const output = await probeVersion().catch(() => null);
  const version = output === null ? null : readVersion(output);
  if (version === null) return null;
  probed.set(executable, { mtimeMs: stat.mtimeMs, size: stat.size, version });
  return museVersionSupportsMcp(version);
}

export function probeMuseVersion(ctx: SessionContext, executable: string): Promise<string | null> {
  return new Promise(resolve => {
    let settled = false;
    let output = '';
    const done = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const child = ctx.spawnChild(executable, ['--version'], {
      cwd: ctx.thread.cwd,
      env: agentEnv(ctx.provider, ctx.accountEnv),
    });
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* exited */ }
      done(null);
    }, PROBE_TIMEOUT_MS);
    timer.unref?.();
    child.stdout.on('data', (chunk: Buffer) => {
      if (output.length < PROBE_MAX_BYTES) output += chunk.toString('utf8').slice(0, PROBE_MAX_BYTES - output.length);
    });
    child.on('error', () => done(null));
    child.on('close', code => done(code === 0 ? output.trim() || null : null));
  });
}

// Same transport and header fields as protectedMuse settings.json. The native
// 1.4.13+ host accepts them through -c and expands the header from its environment.
export function museMcpConfig(mcp: McpRegistration | null): { args: string[]; env: Record<string, string> } {
  if (mcp === null) return { args: [], env: {} };
  const args = Object.entries(mcp.entries).flatMap(([name, entry]) => ['-c', `mcp_servers.${name}=${JSON.stringify({
    transport: 'streamable_http', url: entry.url, headers: { Authorization: '$' + '{' + AUTH + '}' },
  })}`]);
  return { args, env: { [AUTH]: mcp.authorization } };
}
