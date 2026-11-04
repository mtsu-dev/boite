/*
 * The CLI side of plugins: `boite <name> args...` for a command an installed
 * plugin provides (`plugins.command`), and the owner's `boite plugin dev`
 * (`plugins.dev`, `plugins.uninstall`).
 */

import { isAbsolute, resolve } from 'node:path';
import { RpcErrorCode } from '@boite/contracts';
import type { CoreClient } from './client.ts';
import { Usage } from './cli-args.ts';

export const PLUGIN_HELP = `  plugin dev <folder>            run a plugin from a folder, reloaded on each
                                 run; --remove <id> removes it (owner only)
  <plugin-command> [args]        a command an installed plugin provides; your
                                 guide lists them`;

interface Io {
  out(text: string): void;
  err(text: string): void;
  cwd: string;
}

type Printer = (lines: string[], value: unknown) => void;

/** `boite <name> args...` for a command a plugin provides: its output as it wrote it, its exit code as the CLI's. */
export async function pluginCommand(client: CoreClient, io: Io, threadId: string, name: string, args: string[]): Promise<number> {
  let result;
  try {
    result = await client.call('plugins.command', { ...(threadId ? { threadId } : {}), name, args, cwd: io.cwd });
  } catch (error) {
    // No plugin provides it: a usage error like any other unknown command.
    const rpc = (error as { rpc?: { code?: number; data?: { field?: unknown } } }).rpc;
    if (rpc?.code === RpcErrorCode.InvalidParams && rpc.data?.field === 'name') throw new Usage(`unknown command ${name}: ${(error as Error).message}`);
    throw error;
  }
  if (result.stdout) io.out(result.stdout);
  if (result.stderr) io.err(result.stderr);
  if (result.truncated) io.err(`boite: ${name}'s output was cut at 1 MB per stream\n`);
  return result.exitCode;
}

/** `boite plugin dev <folder>` and `boite plugin dev --remove <id>`: the owner's, from a terminal. */
export async function pluginDev(client: CoreClient, io: Io, rest: string[], print: Printer): Promise<void> {
  const [action, ...args] = rest;
  if (action !== 'dev') throw new Usage(`plugin: unknown action ${action ?? '(none)'}; expected dev`);
  if (args[0] === '--remove') {
    const id = args[1];
    if (id === undefined || args.length !== 2) throw new Usage('plugin dev --remove needs the plugin id');
    const state = await client.call('plugins.uninstall', { id });
    print([`removed ${id}; its folder and data stay`], state);
    return;
  }
  if (args.length !== 1 || args[0]!.startsWith('-')) throw new Usage('plugin dev needs one folder holding boite-plugin.json, or --remove <id>');
  const folder = isAbsolute(args[0]!) ? args[0]! : resolve(io.cwd, args[0]!);
  const state = await client.call('plugins.dev', { path: folder });
  const adds = state.adds;
  const lines = [
    `${state.id} ${state.version ?? ''} runs from ${state.devPath ?? folder}`.trimEnd(),
    ...(adds?.commands.length ? [`commands: ${adds.commands.map((name) => `boite ${name}`).join(', ')}`] : []),
    ...(adds?.skills.length ? [`skills: ${adds.skills.join(', ')}`] : []),
    ...(adds?.slashCommands.length ? [`slash commands: ${adds.slashCommands.map((name) => `/${name}`).join(', ')}`] : []),
    ...(adds?.prompt ? ['prompt: added to every new agent session\'s guide'] : []),
    ...(state.permissions?.length ? [`permissions: ${state.permissions.join(', ')}`] : []),
    ...(state.app ? [`${state.app.kind === 'service' ? 'service' : 'desktop app'}: ${state.app.status}${state.app.error ? ` (${state.app.error})` : ''}`] : []),
    ...(state.error ? [`error: ${state.error}`] : []),
  ];
  print(lines, state);
}
