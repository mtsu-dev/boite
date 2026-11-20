/** BoiteOS maps a process's working directory to its thread's sandbox. */
export function linuxSecretPipeRecipient(command: string, args: string[], callerEnv: Record<string, string | undefined>) {
  const thread = callerEnv.BOITEOS_THREAD;
  if (!thread || thread === process.env.BOITEOS_THREAD) return { command, args, env: callerEnv };
  // The launcher may fall back to the host for an unregistered checkout. It
  // must never hand the recipient stdin unless osd supplied the expected thread.
  // Start the launcher with the core's environment, so the caller cannot replace
  // its private socket, dynamic loader or shell configuration.
  const env = { BOITEOS_AGENTS_SOCKET: process.env.BOITEOS_AGENTS_SOCKET, PATH: callerEnv.PATH,
    XDG_CONFIG_HOME: callerEnv.XDG_CONFIG_HOME, XDG_DATA_HOME: callerEnv.XDG_DATA_HOME };
  return {
    command: '/usr/bin/os',
    args: ['agent', 'exec', '--', '/bin/sh', '-c', 'test "$BOITEOS_THREAD" = "$1" || exit 125; shift; exec "$@"',
      'secret-pipe', thread, command, ...args],
    env,
  };
}
