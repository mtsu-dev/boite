import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { which } from '../providers/which.ts';
import type { StdioServer } from './lazy.ts';

// Keep executable lookup and platform directories. Servers get authentication
// and other overrides only from their own configuration.
const INHERITED = new Set([
  'PATH', 'PATHEXT', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMMONPROGRAMFILES',
  'TMP', 'TEMP', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME',
  'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'TZ', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
]);

/** Start npm presets through Node on Windows, where npx.cmd needs a shell. */
export function managedStdioLaunch(server: StdioServer): StdioServer {
  const windows = process.platform === 'win32';
  const overrides = new Set(Object.keys(server.env).map(key => windows ? key.toUpperCase() : key));
  const inherited = Object.entries(process.env).filter(([key, value]) => {
    const upper = key.toUpperCase();
    return value !== undefined && INHERITED.has(upper) && !overrides.has(windows ? upper : key);
  });
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
