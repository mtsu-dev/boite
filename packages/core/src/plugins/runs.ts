/*
 * The plugin processes the store runs to completion: an account pool command
 * (`list`, `add`, `switch`, `remove`) and an agent's plugin command
 * (`plugins.command`). Each goes through `core.procs` under its own trace id,
 * and core shutdown kills those still running and waits for them.
 */

import { isAbsolute } from 'node:path';
import { statSync } from 'node:fs';
import { PLUGIN_MANIFEST_FILE, PLUGIN_NAME_PATTERN } from '@boite/contracts';
import type { PluginCommandResult, PluginManifest, PluginRejected, RpcParams } from '@boite/contracts';
import { PLUGIN_COMMAND_TIMEOUT_MS } from '../cli-commands.ts';
import type { Core } from '../core.ts';
import { invalidParams } from '../errors.ts';
import type { SpawnedProcess, SpawnOptions } from '../procs.ts';
import { pluginLaunch } from './launch.ts';
import { refusal } from './manifest.ts';

/** An account pool command: at most 4 MB of output, 60 seconds. */
const RUN_MAX_BYTES = 4 * 1024 * 1024;
const RUN_TIMEOUT_MS = 60_000;
/** An agent command: how long it may run and how much of each stream comes back. */
export const COMMAND_TIMEOUT_MS = PLUGIN_COMMAND_TIMEOUT_MS;
export const COMMAND_OUTPUT_MAX_BYTES = 1024 * 1024;
const COMMAND_ARGS_MAX = 256;
const COMMAND_ARG_MAX_BYTES = 32 * 1024;

/** A plugin as the command lookup reads it. */
interface Provider {
  id: string;
  manifest: { provides: { commands?: readonly { name: string }[] } };
}

/** The checked fields of a `plugins.command` request. */
export function commandRequest(params: RpcParams<'plugins.command'>): { name: string; args: string[]; cwd: string } {
  const name = params?.name;
  if (typeof name !== 'string' || !PLUGIN_NAME_PATTERN.test(name)) {
    throw invalidParams('plugin command name must be lowercase words joined by hyphens', { field: 'name', expected: 'a command an installed plugin provides' });
  }
  const args = params.args;
  if (!Array.isArray(args) || args.length > COMMAND_ARGS_MAX || args.some((arg) => typeof arg !== 'string' || Buffer.byteLength(arg) > COMMAND_ARG_MAX_BYTES || arg.includes('\0'))) {
    throw invalidParams(`plugin command args must be at most ${COMMAND_ARGS_MAX} strings of at most 32 KB, no NUL`, { field: 'args' });
  }
  const cwd = params.cwd;
  if (typeof cwd !== 'string' || !isAbsolute(cwd) || !statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
    throw invalidParams(`plugin command cwd must be an absolute path to an existing directory, got ${JSON.stringify(cwd)}`, { field: 'cwd', expected: 'an absolute directory' });
  }
  return { name, args, cwd };
}

/** The installed plugin that provides `name`; the refusal lists the commands there are. */
export function commandOwner<T extends Provider>(plugins: readonly T[], name: string): T {
  const owner = plugins.find((plugin) => plugin.manifest.provides.commands?.some((command) => command.name === name));
  if (owner !== undefined) return owner;
  const known = plugins.flatMap((plugin) => (plugin.manifest.provides.commands ?? []).map((command) => command.name));
  const expected = known.length === 0 ? 'no installed plugin provides a command' : `one of ${known.join(', ')}`;
  throw invalidParams(`boite ${name} is no boite command and no installed plugin provides it; plugin commands: ${known.length === 0 ? 'none' : known.join(', ')}`, { field: 'name', expected });
}

/**
 * Why one of the manifest's commands or slash commands cannot take its name:
 * another plugin, installed or on its way in, has it. Null when none does.
 */
export function nameClash<T extends { id: string; manifest: PluginManifest }>(manifest: PluginManifest, others: Iterable<T>): PluginRejected | null {
  for (const other of others) {
    if (other.id === manifest.id) continue;
    for (const field of ['commands', 'slashCommands'] as const) {
      const theirs = new Set((other.manifest.provides[field] ?? []).map((entry) => entry.name));
      const clash = (manifest.provides[field] ?? []).find((entry) => theirs.has(entry.name));
      if (clash !== undefined) return refusal(PLUGIN_MANIFEST_FILE, `provides.${field}`, `names no other plugin takes (${other.id} has ${clash.name})`, clash.name).rejected;
    }
  }
  return null;
}

export class PluginRuns {
  #core: Core;
  #running = new Map<string, string>();
  #exits = new Set<Promise<number>>();
  #sequence = 0;

  constructor(core: Core) {
    this.#core = core;
  }

  /** Runs `binary args...` to its end, `collect` reading it, and kills what is left of its tree after. */
  async #run<T>(id: string, kind: string, binary: string, args: string[], opts: SpawnOptions, collect: (spawned: SpawnedProcess, kill: () => void) => Promise<T>): Promise<T> {
    const threadId = `plugin:${id}:${kind}${++this.#sequence}`;
    const launch = pluginLaunch(binary, args, opts.env, this.#core.dataDir);
    const spawned = this.#core.procs.spawn(threadId, launch.cmd, launch.args, { ...opts, env: launch.env });
    this.#running.set(threadId, id);
    this.#exits.add(spawned.exited);
    try {
      return await collect(spawned, () => this.#core.procs.killTree(threadId));
    } finally {
      this.#core.procs.killTree(threadId);
      await spawned.exited;
      this.#running.delete(threadId);
      this.#exits.delete(spawned.exited);
    }
  }

  /**
   * An account pool command, run in the plugin's directory with `env` (a
   * schema 2 plugin's, none for schema 1): its stdout, or a
   * refusal naming the exit code. Its output is never forwarded otherwise,
   * since it may carry login material.
   */
  pool(id: string, binary: string, label: string, args: string[], cwd: string, env: Record<string, string | undefined> | undefined): Promise<string> {
    return this.#run(id, '', binary, args, { cwd, ...(env ? { env } : {}) }, async (spawned) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const read = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
        const reader = stream.getReader(); const chunks: Uint8Array[] = []; let size = 0;
        for (;;) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.length;
          if (size > RUN_MAX_BYTES) throw new Error(`${id} output exceeds 4 MB.`);
          chunks.push(chunk.value);
        }
        return Buffer.concat(chunks).toString('utf8');
      };
      try {
        const output = Promise.all([read(spawned.proc.stdout), read(spawned.proc.stderr), spawned.exited]);
        const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${id} did not finish within 60 seconds.`)), RUN_TIMEOUT_MS); });
        const [stdout, , code] = await Promise.race([output, expired]);
        if (code !== 0) throw new Error(`${label} ${args.slice(0, 2).join(' ')} failed with exit code ${code}.`);
        return stdout;
      } finally {
        clearTimeout(timer);
      }
    });
  }

  /**
   * An agent's plugin command, `argv` run in `cwd` with `env`, stdin empty:
   * its exit code (124 once stopped at the timeout) and each stream cut at
   * 1 MB, the rest read and dropped so a full pipe never hangs the plugin.
   */
  command(id: string, binary: string, argv: string[], cwd: string, env: Record<string, string | undefined>): Promise<PluginCommandResult> {
    return this.#run(id, 'cmd:', binary, argv, { cwd, env, agentRoot: false }, async (spawned, kill) => {
      let truncated = false;
      const read = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
        const reader = stream.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (size >= COMMAND_OUTPUT_MAX_BYTES) { truncated = true; continue; }
          const room = COMMAND_OUTPUT_MAX_BYTES - size;
          if (chunk.value.length > room) truncated = true;
          const kept = chunk.value.length > room ? chunk.value.subarray(0, room) : chunk.value;
          size += kept.length;
          chunks.push(kept);
        }
        return Buffer.concat(chunks).toString('utf8');
      };
      let timedOut = false;
      const output = Promise.all([read(spawned.proc.stdout), read(spawned.proc.stderr), spawned.exited]);
      const timer = setTimeout(() => { timedOut = true; kill(); }, COMMAND_TIMEOUT_MS);
      try {
        const [stdout, stderr, code] = await output;
        const note = timedOut ? `\nboite: ${argv[0]} was stopped after ${COMMAND_TIMEOUT_MS / 60_000} minutes.\n` : '';
        return { exitCode: timedOut ? 124 : code, stdout, stderr: stderr + note, truncated };
      } finally {
        clearTimeout(timer);
      }
    });
  }

  /** At core shutdown: kills every run still going and waits for them to exit. */
  async close(): Promise<void> {
    for (const threadId of this.#running.keys()) this.#core.procs.killTree(threadId);
    await Promise.all(this.#exits);
  }
}
