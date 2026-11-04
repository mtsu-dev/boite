/*
 * How the core starts a plugin's executable. A native one runs as itself. A
 * `bun` one is a JavaScript file run by the Bun this core runs on: under
 * `bun main.ts` that is Bun itself; in the compiled core it is the core's own
 * executable with `BUN_BE_BUN=1`, which makes it the Bun command line, so the
 * file runs as its entry point (`import.meta.main` holds) exactly as under
 * `bun <file>`. A preload removes that variable before the plugin's code
 * runs, so a compiled program the plugin starts stays itself. Bun's own
 * `Bun.spawn` without an `env` passes the environment the process started
 * with, variable included: a plugin that starts a compiled Bun program that
 * way passes `env: process.env`.
 *
 * Either way Bun reads no `.env` and no `bunfig.toml` from the directory the
 * plugin runs in: an agent's project must not change what a plugin loads.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPT = /\.(?:[cm]?[jt]s)$/i;
const PRELOAD = 'delete process.env.BUN_BE_BUN;\n';

type Env = Record<string, string | undefined>;

export interface PluginLaunch {
  cmd: string;
  args: string[];
  /** Overrides on the core's environment, as `procs.spawn` takes them. */
  env: Env | undefined;
}

/** Whether this module runs from a `bun build --compile` executable. */
function compiled(url = import.meta.url): boolean {
  return url.startsWith('file:///$bunfs/') || url.startsWith('file:///B:/~BUN/');
}

/** `<dataDir>/plugin-runtime`: the empty bunfig and the preload every bun plugin starts with. */
function runtimeFiles(dataDir: string): { config: string; preload: string } {
  const dir = join(dataDir, 'plugin-runtime');
  const config = join(dir, 'bunfig.toml');
  const preload = join(dir, 'preload.js');
  if (!existsSync(config) || !existsSync(preload)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(config, '');
    writeFileSync(preload, PRELOAD);
  }
  return { config, preload };
}

/** The command, arguments and environment that run `binary args...`. */
export function pluginLaunch(binary: string, args: string[], env: Env | undefined, dataDir: string, isCompiled = compiled()): PluginLaunch {
  if (!SCRIPT.test(binary)) return { cmd: binary, args, env };
  const { config, preload } = runtimeFiles(dataDir);
  const flags = [`--config=${config}`, '--no-env-file'];
  if (!isCompiled) return { cmd: process.execPath, args: [...flags, binary, ...args], env };
  return { cmd: process.execPath, args: [...flags, '--preload', preload, binary, ...args], env: { ...env, BUN_BE_BUN: '1' } };
}
