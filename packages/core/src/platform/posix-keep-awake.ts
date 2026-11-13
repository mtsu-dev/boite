/**
 * The sleep inhibitor of Linux and macOS: a helper process that holds it for
 * as long as it lives. The helper runs `cat` on a pipe from the core, so it
 * ends, and the machine may sleep again, when the hold is given back and also
 * when the core dies without saying so.
 *
 * Linux asks logind through `systemd-inhibit`. Blocking sleep is allowed to a
 * user at the machine; a core running as a service with no active session is
 * refused it, and falls back to the idle inhibitor alone, which any user may
 * hold and which stops logind's idle suspend. macOS holds an idle-sleep
 * assertion through `caffeinate -i`. Neither stops a sleep the user orders
 * with the power button, or a laptop closing its lid.
 */
type Find = (name: string) => string | null;

/** The commands to try in order, the widest inhibitor first; empty when the OS has no helper. */
export function keepAwakeCommands(os: 'linux' | 'macos', find: Find = name => Bun.which(name)): string[][] {
  const cat = find('cat');
  if (cat === null) return [];
  if (os === 'macos') {
    const caffeinate = find('caffeinate');
    return caffeinate === null ? [] : [[caffeinate, '-i', cat]];
  }
  const inhibit = find('systemd-inhibit');
  if (inhibit === null) return [];
  return ['sleep:idle', 'idle'].map(what => [inhibit, `--what=${what}`, '--who=Boite', '--why=Agents are working', '--mode=block', cat]);
}

/**
 * Holds the inhibitor until the returned function is called. `onLost` hears
 * when no command could hold it, or when the helper ended by itself.
 */
export function posixKeepAwake(commands: string[][], onLost: (reason: string) => void): (() => void) | null {
  if (commands.length === 0) return null;
  let released = false;
  let child: ReturnType<typeof start> | null = null;
  const start = (cmd: string[]) => Bun.spawn({ cmd, stdin: 'pipe', stdout: 'ignore', stderr: 'pipe' });
  const attempt = (index: number): void => {
    const cmd = commands[index]!;
    let running: ReturnType<typeof start>;
    try { running = start(cmd); } catch (error) { onLost(`${cmd[0]} did not start: ${error instanceof Error ? error.message : String(error)}`); return; }
    child = running;
    // The core's exit is not held back by a helper it forgot.
    running.unref();
    void Promise.all([running.exited, new Response(running.stderr).text().catch(() => '')]).then(([code, stderr]) => {
      if (released || child !== running) return;
      child = null;
      // A refusal comes at once; the next command asks for less.
      if (index + 1 < commands.length) return attempt(index + 1);
      onLost(`${cmd[0]} ended with code ${code}${stderr.trim() ? `: ${stderr.trim().split('\n').at(-1)!.slice(0, 200)}` : ''}`);
    });
  };
  attempt(0);
  return () => {
    if (released) return;
    released = true;
    const running = child;
    child = null;
    if (running === null) return;
    // End of input ends `cat`, and the helper with it; the signal covers a helper that ignores its input.
    try { void running.stdin.end(); } catch { /* already gone */ }
    try { running.kill(); } catch { /* already gone */ }
  };
}
