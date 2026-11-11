/*
 * The plugin SDK: what a plugin's executable needs to answer agent commands
 * and talk to the core. docs/internals/plugins.md explains the manifest it goes with.
 */

import type { PluginManifest } from '@boite/contracts';

export { connect, socketUrl, RpcError, PROTOCOL_VERSION, RPC_PATH, SDK_VERSION } from './connect.ts';
export type { ConnectOptions, PluginClient, RpcParams, RpcResult } from './connect.ts';
export { dispatch, runCommands } from './commands.ts';
export type { CommandContext, CommandHandler, RunOptions } from './commands.ts';
export type {
  PluginCommand,
  PluginManifest,
  PluginPermission,
  PluginRuntime,
  PluginSkill,
  PluginSlashCommand,
} from '@boite/contracts';

/** Types a manifest written in TypeScript; it returns its argument. */
export function definePlugin(manifest: PluginManifest): PluginManifest {
  return manifest;
}
