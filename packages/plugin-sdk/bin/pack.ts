#!/usr/bin/env bun
/*
 * Packs a `bun` runtime plugin: bundles its entry into the one JavaScript file
 * the manifest's `executable` names, writes that file's SHA-256 into
 * `artifacts.any`, and copies each `skills/<name>.md` into the body of the
 * skill of that name. docs/plugins.md, Pack and publish.
 *
 *   bun packages/plugin-sdk/bin/pack.ts --entry src/main.ts [--dir .] [--url https://...]
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PLUGIN_EXECUTABLE_PATTERN, PLUGIN_MANIFEST_FILE as MANIFEST_FILE, PLUGIN_NAME_PATTERN as NAME, type PluginManifest } from '@boite/contracts';

/** What the core refuses on a schema 2 manifest, checked here so the author hears it first. */
export const LIMITS = {
  name: 40, description: 200, usage: 200, skillBody: 32 << 10, prompt: 1000, slashPrompt: 8 << 10,
  commands: 20, skills: 20, slashCommands: 20, manifestBytes: 256 << 10,
} as const;

export interface PackOptions {
  /** The plugin's source entry, relative to `dir` or absolute. */
  entry: string;
  /** The folder holding `boite-plugin.json`. */
  dir: string;
  /** Where the packed file will be published. Default: the URL already in `artifacts.any`. */
  url?: string;
}

export interface PackResult {
  file: string;
  bytes: number;
  sha256: string;
  manifest: PluginManifest;
}

export async function pack(options: PackOptions): Promise<PackResult> {
  const dir = resolve(options.dir);
  const manifestPath = join(dir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) throw new Error(`${manifestPath}: not found; a plugin folder holds ${MANIFEST_FILE}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PluginManifest;
  if (manifest.schema !== 2) throw new Error(`${MANIFEST_FILE}: schema must be 2 to pack a bun plugin, found ${JSON.stringify(manifest.schema)}`);
  if (manifest.runtime !== 'bun') throw new Error(`${MANIFEST_FILE}: runtime must be "bun", found ${JSON.stringify(manifest.runtime)}`);
  if (typeof manifest.executable !== 'string' || !PLUGIN_EXECUTABLE_PATTERN.test(manifest.executable)) {
    throw new Error(`${MANIFEST_FILE}: executable must be a file name of letters, digits, _ and -, no path and no .js, found ${JSON.stringify(manifest.executable)}`);
  }

  for (const skill of manifest.provides.skills ?? []) {
    const file = join(dir, 'skills', `${skill.name}.md`);
    if (existsSync(file)) skill.body = readFileSync(file, 'utf8');
  }

  const url = options.url ?? manifest.artifacts?.any?.url;
  if (url === undefined) throw new Error(`${MANIFEST_FILE}: pass --url, where ${manifest.executable}.js will be published (https)`);
  if (!url.startsWith('https://')) throw new Error(`--url must be https, found ${url}`);
  const problems = manifestProblems(manifest);
  if (problems.length) throw new Error(`${MANIFEST_FILE}:\n${problems.map(line => `  ${line}`).join('\n')}`);

  // Nothing is written before every check passed.
  const built = await Bun.build({ entrypoints: [resolve(dir, options.entry)], target: 'bun', format: 'esm' });
  if (!built.success) throw new Error(`bun build failed:\n${built.logs.map(String).join('\n')}`);
  if (built.outputs.length !== 1) throw new Error(`bun build wrote ${built.outputs.length} files; a bun plugin is one file`);
  const bytes = new Uint8Array(await built.outputs[0]!.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  manifest.artifacts = { any: { url, sha256 } };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(text) > LIMITS.manifestBytes) throw new Error(`${MANIFEST_FILE} would be over ${LIMITS.manifestBytes} B`);
  const file = join(dir, `${manifest.executable}.js`);
  writeFileSync(file, bytes);
  writeFileSync(manifestPath, text);
  return { file, bytes: bytes.length, sha256, manifest };
}

/** The schema 2 limits a manifest breaks, one line each. The core checks every other rule. */
export function manifestProblems(manifest: PluginManifest): string[] {
  const problems: string[] = [];
  const provides = manifest.provides ?? {};
  const named = (field: string, entries: { name: string; description: string }[] | undefined, max: number): void => {
    if (entries === undefined) return;
    if (entries.length > max) problems.push(`provides.${field} has ${entries.length} entries, at most ${max}`);
    const seen = new Set<string>();
    entries.forEach((entry, i) => {
      const at = `provides.${field}[${i}]`;
      if (!NAME.test(entry.name) || entry.name.length > LIMITS.name) problems.push(`${at}.name must be lowercase words joined by hyphens, at most ${LIMITS.name} characters, found ${JSON.stringify(entry.name)}`);
      if (seen.has(entry.name)) problems.push(`${at}.name ${entry.name} appears twice`);
      seen.add(entry.name);
      if (!entry.description || entry.description.length > LIMITS.description) problems.push(`${at}.description must be 1 to ${LIMITS.description} characters`);
    });
  };
  named('commands', provides.commands, LIMITS.commands);
  named('skills', provides.skills, LIMITS.skills);
  named('slashCommands', provides.slashCommands, LIMITS.slashCommands);
  provides.commands?.forEach((command, i) => {
    if (command.usage !== undefined && command.usage.length > LIMITS.usage) problems.push(`provides.commands[${i}].usage is over ${LIMITS.usage} characters`);
  });
  provides.skills?.forEach((skill, i) => {
    if (!skill.body) problems.push(`provides.skills[${i}].body is empty: write it inline or in skills/${skill.name}.md`);
    else if (Buffer.byteLength(skill.body) > LIMITS.skillBody) problems.push(`provides.skills[${i}].body is over ${LIMITS.skillBody} B`);
  });
  provides.slashCommands?.forEach((slash, i) => {
    if (!slash.prompt || Buffer.byteLength(slash.prompt) > LIMITS.slashPrompt) problems.push(`provides.slashCommands[${i}].prompt must be 1 to ${LIMITS.slashPrompt} B`);
  });
  if (provides.prompt !== undefined && provides.prompt.length > LIMITS.prompt) problems.push(`provides.prompt is over ${LIMITS.prompt} characters`);
  return problems;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { entry: { type: 'string' }, dir: { type: 'string', default: '.' }, url: { type: 'string' } },
    strict: true,
  });
  if (values.entry === undefined) {
    console.error('usage: boite-plugin-pack --entry <src/main.ts> [--dir <plugin folder>] [--url <https URL of the packed file>]');
    process.exit(2);
  }
  try {
    const result = await pack({ entry: values.entry, dir: values.dir, ...(values.url === undefined ? {} : { url: values.url }) });
    console.log(`${result.file}: ${result.bytes} B, sha256 ${result.sha256}`);
    console.log(`${MANIFEST_FILE}: artifacts.any points at ${result.manifest.artifacts?.any?.url}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
