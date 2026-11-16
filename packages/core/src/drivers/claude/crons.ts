import type { HookInput, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

/** The tools that change the jobs the CLI keeps inside its own process. */
const CRON_TOOLS = new Set(['CronCreate', 'CronDelete']);

/**
 * The jobs a Claude CLI keeps inside its own process (CronCreate, `/loop`,
 * ScheduleWakeup), which die with it. The Stop hook's `session_crons` (CLI
 * 2.1.325) lists them all at the end of every run, before its result, so the
 * warm rule that result applies already knows. A CronCreate or CronDelete call
 * makes the count unknown until the next Stop says. A CLI that sends no list
 * holds nothing.
 */
export class SessionCrons {
  #count: number | 'unknown' = 0;

  /** The CLI has a job to wake itself for, or may have: ending it would lose that job. */
  get held(): boolean {
    return this.#count !== 0;
  }

  /** A Stop hook's payload. True when it reported a job. */
  stopped(input: HookInput): boolean {
    if (input.hook_event_name !== 'Stop') return false;
    this.#count = Array.isArray(input.session_crons) ? input.session_crons.length : 0;
    return this.#count > 0;
  }

  /** A frame as the CLI writes it, never replayed: a call to CronCreate or CronDelete. A replay would undo a Stop that came after it. */
  noted(message: SDKMessage): void {
    if (message.type !== 'assistant') return;
    const content: unknown = message.message.content;
    if (Array.isArray(content) && content.some((block: { type?: unknown; name?: unknown }) =>
      block.type === 'tool_use' && typeof block.name === 'string' && CRON_TOOLS.has(block.name))) this.#count = 'unknown';
  }
}
