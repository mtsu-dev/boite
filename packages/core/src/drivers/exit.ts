/** Grace for a terminating child's final pipe records and exit diagnostic. */
export const EXIT_GRACE_MS = 500;

/** Wait for exit and optional stdio closure within one deadline, retaining any known exit code. */
export function exitWithin(exited: Promise<number | null> | null, ms: number, closed?: Promise<void>): Promise<number | null | undefined> {
  if (exited === null) return Promise.resolve(undefined);
  return new Promise<number | null | undefined>((resolve) => {
    let code: number | null | undefined;
    const timer = setTimeout(() => {
      resolve(code);
    }, ms);
    timer.unref?.();
    void exited.then((exitCode) => {
      code = exitCode;
      const done = (): void => { clearTimeout(timer); resolve(exitCode); };
      if (closed === undefined) done();
      else void closed.then(done);
    });
  });
}

/** What a turn fails with when its agent is gone: the exit code, then the last line it printed unless `diagnostic`. */
export function exitSentence(subject: string, code: number | null, lastStderr: string, diagnostic = false): string {
  const head = `the ${subject} exited with code ${code === null ? 'unknown' : code}`;
  return diagnostic || lastStderr.length === 0 ? head : `${head}: ${lastStderr}`;
}
