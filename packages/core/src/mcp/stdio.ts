import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { which } from '../providers/which.ts';
import type { StdioServer } from './lazy.ts';

/** Start npm presets through Node on Windows, where npx.cmd needs a shell. */
export function managedStdioLaunch(server: StdioServer): StdioServer {
  const windows = process.platform === 'win32';
  const overrides = new Set(Object.keys(server.env).map(key => windows ? key.toUpperCase() : key));
  const inherited = Object.entries(process.env).filter(([key, value]) => value !== undefined && !overrides.has(windows ? key.toUpperCase() : key));
  const env = { ...Object.fromEntries(inherited) as Record<string, string>, ...server.env };
  if (!windows || !/^npx(?:\.cmd)?$/i.test(server.command)) return { ...server, env };

  const path = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';
  const node = which('node.exe', path);
  const launcher = which('npx.cmd', path);
  const script = [launcher, node]
    .flatMap(file => file === null ? [] : [join(dirname(file), 'node_modules', 'npm', 'bin', 'npx-cli.js')])
    .find(existsSync);
  if (node === null || script === undefined) throw new Error('npx requires Node.js and npm on PATH');
  return { command: node, args: [script, ...server.args], env };
}
