export const WORKER_IDLE_MS = 60_000;

/** Reclaim a worker after the last request or reply, even if a job stopped answering. */
export function workerIdle(expire: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    touch() {
      clearTimeout(timer);
      timer = setTimeout(expire, WORKER_IDLE_MS);
    },
    stop() { clearTimeout(timer); }
  };
}
