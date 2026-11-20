/** The BoiteOS host's service puts its agent shims on the core's PATH. */
const SHIMS = '/usr/lib/boiteos/agents/bin';

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
    args: ['agent', 'exec', '--secret-pipe', threadCwd, '--', '/bin/sh', '-c', 'exec "$@"', 'secret-pipe', command, ...args],
    env,
  };
}
