/*
 * What installed plugins add to agents and to the composer: the lines of the
 * Boite guide naming their commands, skills and prompts, and the slash
 * commands of the `/` menu with what each sends. Everything is read from the
 * installed manifests on each call, so an install, an uninstall or an edit to
 * a dev plugin's folder shows on the next guide or the next message.
 */

import { join } from 'node:path';
import type { AgentCommand } from '@boite/contracts';
import { ensureSkills } from '../builtin-skills.ts';
import type { Core } from '../core.ts';
import type { InstalledPlugin } from '../plugins.ts';

/** The guide's lines for the plugins' commands, skills and prompts; empty when none adds any. */
export function pluginGuideLines(plugins: readonly InstalledPlugin[], onError: (message: string) => void = () => {}): string[] {
  const commands = plugins.flatMap((plugin) => (plugin.manifest.provides.commands ?? []).map((command) =>
    `\`boite ${command.name}${command.usage ? ` ${command.usage}` : ''}\`: ${command.description}`));
  const skills = plugins.flatMap((plugin) => {
    const declared = plugin.manifest.provides.skills ?? [];
    if (declared.length === 0) return [];
    return ensureSkills(join(plugin.dir, 'skills'), declared, onError, `plugin ${plugin.id} skill`)
      .map((skill) => `${skill.name}: ${skill.description}\nFile: ${skill.path}`);
  });
  const prompts = plugins.flatMap((plugin) => (plugin.manifest.provides.prompt === undefined ? [] : [`From the ${plugin.manifest.name} plugin: ${plugin.manifest.provides.prompt}`]));
  return [
    ...(commands.length ? ['Plugin commands, run in your directory like any boite command:', ...commands] : []),
    ...(skills.length ? ['Plugin skills. Read the named SKILL.md before using one.', ...skills] : []),
    ...prompts,
  ];
}

/** The plugins' slash commands for the composer's `/` menu. */
export function pluginSlashCommands(plugins: readonly InstalledPlugin[]): AgentCommand[] {
  return plugins.flatMap((plugin) => (plugin.manifest.provides.slashCommands ?? []).map((command) => ({
    name: command.name,
    description: command.description,
    hint: command.hint ?? null,
  })));
}

/** `first`, then each command of `rest` whose name `first` does not take. */
export function mergeCommands(first: readonly AgentCommand[], rest: readonly AgentCommand[]): AgentCommand[] {
  const taken = new Set(first.map((command) => command.name));
  return [...first, ...rest.filter((command) => !taken.has(command.name))];
}

/**
 * `/name rest` becomes the slash command's prompt followed by ` rest`. A
 * command the agent itself advertises wins, as it does over the brain's.
 */
export function expandPluginSlash(prompt: string, plugins: readonly InstalledPlugin[], driverCommands: readonly AgentCommand[] = []): string {
  const name = /^\/([^\s]+)(?:\s|$)/.exec(prompt)?.[1];
  if (!name || driverCommands.some((command) => command.name === name)) return prompt;
  for (const plugin of plugins) {
    const command = plugin.manifest.provides.slashCommands?.find((entry) => entry.name === name);
    if (command !== undefined) return command.prompt + prompt.slice(name.length + 1);
  }
  return prompt;
}

/** A leading `/name`: the brain's manual skill first, then a plugin's slash command. */
export function expandSlashPrompt(core: Pick<Core, 'brain' | 'plugins'>, prompt: string, driverCommands: readonly AgentCommand[] = []): string {
  const expanded = core.brain.expandPrompt(prompt, driverCommands);
  if (expanded !== prompt || !prompt.startsWith('/')) return expanded;
  return expandPluginSlash(prompt, core.plugins.installedPlugins(), driverCommands);
}
