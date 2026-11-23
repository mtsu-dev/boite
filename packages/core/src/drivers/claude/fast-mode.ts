import type { Query } from '@anthropic-ai/claude-agent-sdk';

/** Claude Code advertises the effective tier in the init it re-emits after a flag update. */
export class FastMode {
  #report: ((state?: string) => void) | undefined;

  note(state?: string): void {
    this.#report?.(state);
  }

  async apply(query: Query, enabled: boolean): Promise<void> {
    if (!enabled) {
      await query.applyFlagSettings({ fastMode: false });
      return;
    }
    const report = Promise.withResolvers<string | undefined>();
    this.#report = report.resolve;
    const timer = setTimeout(report.resolve, 2_000);
    timer.unref?.();
    try {
      await query.applyFlagSettings({ fastMode: true });
      // A successful setter only confirms the requested flag. The CLI can still report Fast as off.
      if (await report.promise !== 'on') throw new Error('fast mode stays off on the running process');
    } finally {
      clearTimeout(timer);
      this.#report = undefined;
    }
  }
}
