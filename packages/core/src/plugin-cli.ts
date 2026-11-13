/*
 * The CLI side of plugins: `boite <name> args...` for a command an installed
 * plugin provides (`plugins.command`), an agent's `boite plugin add`, a card
 * that opens a plugin's preview for the user (`settings.request`), and the
 * owner's `boite plugin dev` (`plugins.dev`, `plugins.uninstall`).
 */

import { isAbsolute, resolve } from 'node:path';
import { RpcErrorCode } from '@boite/contracts';
import type { CoreClient } from './client.ts';
import { Usage } from './cli-args.ts';

export const PLUGIN_HELP = `  plugin add <url> --why <text>  a card asking the user to preview a plugin:
                                 a repository URL or page, owner/repo for
                                 GitHub, --ref <branch|tag|commit>; the user
                                 installs it in Settings, never you
  plugin dev <folder>            run a plugin from a folder, reloaded on each
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

/**
 * `boite plugin add <url> [--ref <ref>] --why <text>`: a card on the agent's
 * thread. Its Preview opens Settings > Agents > Plugins with the repository read;
 * nothing is fetched before the user clicks, and only the user installs.
 */
async function pluginAdd(client: CoreClient, threadId: string, args: string[], print: Printer): Promise<void> {
  let url: string | undefined;
  let ref: string | undefined;
  let why: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--ref' || arg === '--why') {
      const value = args[++index];
      if (value === undefined) throw new Usage(`plugin add: ${arg} needs a value`);
      if (arg === '--ref') ref = value;
      else why = value;
    } else if (arg.startsWith('-') || url !== undefined) throw new Usage(`plugin add: unexpected ${arg}; expected <url> [--ref <ref>] --why <text>`);
    else url = arg;
  }
  if (url === undefined) throw new Usage('plugin add needs the repository: a URL, its page or owner/repo');
  if (why === undefined || why.trim() === '') throw new Usage('plugin add needs --why <text>, the reason the user reads on the card');
  if (threadId === '') throw new Usage('plugin add puts a card in an agent\'s thread; from a terminal, paste the URL in Settings > Agents > Plugins');
  const asked = await client.call('settings.request', { threadId, reason: why, page: 'plugins', plugin: { url, ...(ref === undefined ? {} : { ref }) } });
  const plugin = asked.setting.kind === 'open' ? asked.setting.plugin : undefined;
  print([
    `requested: ${asked.questionId}`,
    `card: Preview opens Settings > Agents > Plugins with ${plugin?.url ?? url}${plugin?.ref ? ` at ${plugin.ref}` : ''} read; the user installs it there or not`,
    'Keep working. The outcome arrives as a message quoting your reason; without one, nothing changed.',
  ], asked);
}

/** `boite plugin add` from an agent, `boite plugin dev <folder>` and `boite plugin dev --remove <id>` from the owner's terminal. */
export async function pluginAction(client: CoreClient, io: Io, threadId: string, rest: string[], print: Printer): Promise<void> {
  const [action, ...args] = rest;
  if (action === 'add') return pluginAdd(client, threadId, args, print);
  if (action !== 'dev') throw new Usage(`plugin: unknown action ${action ?? '(none)'}; expected add or dev`);
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
