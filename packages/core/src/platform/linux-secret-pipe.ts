import { readSync } from 'node:fs';

/** The BoiteOS host's service puts its agent shims on the core's PATH. */
const SHIMS = '/usr/lib/boiteos/agents/bin';
const LEGACY_USAGE = /^error: os agent exec: usage: os agent exec (?:\[--secret-pipe <checkout>\] )?-- <program> <args\.\.\.>; next: os agent exec (?:\[--secret-pipe <checkout>\] )?-- <program> <args\.\.\.>(?:\n|$)/;

function versionRefusal(fd: number, exitCode: number, stderr: string): 'os' | 'osd' | null {
  if (exitCode !== 125) return null;
  const bytes = Buffer.alloc(3);
  const report = bytes.toString('ascii', 0, readSync(fd, bytes));
  if (report === 'OD') return 'osd';
  // Only CLI builds that reject the new flag can produce this usage without
  // first writing the report header. A recipient may exit 125 with any stderr.
  if (report === '' && LEGACY_USAGE.test(stderr)) return 'os';
  return null;
}

export function linuxSecretPipeRecipient(command: string, args: string[], callerEnv: Record<string, string | undefined>, threadCwd: string) {
  const coreEnv = process.env;
  if (coreEnv.BOITEOS_THREAD || !(coreEnv.BOITEOS_AGENTS_SOCKET || coreEnv.PATH?.split(':').includes(SHIMS))) {
    return { command, args, env: callerEnv };
  }
  // osd verifies the thread checkout and requested cwd against the same
  // project configuration. Only the core may select the launcher and socket.
  const env = { BOITEOS_AGENTS_SOCKET: coreEnv.BOITEOS_AGENTS_SOCKET, PATH: callerEnv.PATH,
    XDG_CONFIG_HOME: callerEnv.XDG_CONFIG_HOME, XDG_DATA_HOME: callerEnv.XDG_DATA_HOME };
  return {
    command: '/usr/bin/os',
    args: ['agent', 'exec', '--secret-pipe-report', threadCwd, '--', '/bin/sh', '-c', 'exec "$@"', 'secret-pipe', command, ...args],
    env,
    versionRefusal,
  };
}
