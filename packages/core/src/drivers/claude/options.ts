import type { Options, SpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import { messageOf, unavailable } from '../../errors.ts';
import { userStdioServers, type LazyServerEntry } from '../../mcp/lazy.ts';
import type { SpawnedChild } from '../../procs.ts';
import { profileFor, resolveExecutable } from '../../providers/resolve.ts';
import type { SessionContext } from '../types.ts';
import type { ToolGate } from './permissions.ts';
import { cliEnv, liveSetup, THINKING_DISPLAY_FLAG } from './query.ts';
import { stepHooks, type StepHost } from './step.ts';

/** Claude Code's own subagent and workflow tools; `Task` is the older name of `Agent`. */
export const NATIVE_SUBAGENT_TOOLS = ['Agent', 'Task', 'Workflow'] as const;

/** What the options take from the session that opens the query. */
export interface OptionsHost {
  abortController: AbortController;
  gate: ToolGate;
  /** The summary focus of the context current when the CLI compacts. */
  compactionSummary: () => string | null;
  /** The turn the CLI is on and the interrupt, for the step hooks. */
  steps: StepHost;
  spawn: (options: SpawnOptions) => SpawnedChild;
}

/** The options a Claude query opens with for this context. */
export function cliOptions(ctx: SessionContext, host: OptionsHost, lazyMcp: Record<string, LazyServerEntry> | null = null): Options {
  const profile = profileFor(ctx.provider);
  const executable = profile === undefined ? null : resolveExecutable(profile);
  if (executable === null) {
    throw unavailable(`no ${ctx.provider.id} executable on this machine`, { providerId: ctx.provider.id });
  }
  // The same values the setters carry later, so what the query opens on
  // and what the session records as applied can never say different things.
  const setup = liveSetup(ctx.thread, !!ctx.protectedExecution);
  const mode = ctx.thread.contextMode ?? null;
  return {
    resume: ctx.sessionId ?? undefined,
    // A rewind or a fork: the transcript up to that entry, under a new
    // session id, so the original session is never cut.
    ...(ctx.sessionId !== null && ctx.resumeAt ? { resumeSessionAt: ctx.resumeAt, forkSession: true } : {}),
    cwd: ctx.thread.cwd,
    model: setup.model ?? undefined,
    // A level the CLI knows goes in the options; `ultrathink` goes in the prompt.
    ...(setup.effortLevel === null ? {} : { effort: setup.effortLevel }),
    permissionMode: setup.permissionMode,
    // This enables the live setter; permissionMode still controls the actual approvals.
    allowDangerouslySkipPermissions: true,
    pathToClaudeCodeExecutable: executable,
    // Claude Code's own prompt, tuned per model by Anthropic, with Boite's guide
    // appended. Without a preset the SDK sends an empty one and the model gets a
    // single identity line. Working directory and memory path go to the first
    // message, so every thread and worktree shares one cached system prompt.
    // The CLI records the prompt on a session's first request and reuses it
    // until compaction, so a resumed session keeps the one it started with.
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      excludeDynamicSections: true,
      ...(ctx.systemGuide ? { append: ctx.systemGuide } : {}),
    },
    settingSources: ['user', 'project', 'local'],
    // Subagents in Boite are Boite conversations (`boite delegate spawn`), so the user
    // can follow, steer and stop them; the CLI's own subagent tools never reach the model.
    disallowedTools: [...NATIVE_SUBAGENT_TOOLS],
    // A context mode: what the conversation starts without (docs/context-modes.md).
    ...(mode?.tools ? { tools: [...mode.tools] } : {}),
    ...(mode && !mode.mcp ? { strictMcpConfig: true, mcpServers: {} } : {}),
    // A server given here replaces the user's own of the same name, which then never starts.
    ...(lazyMcp !== null ? { mcpServers: lazyMcp } : {}),
    settings: {
      fastMode: setup.fastMode,
      // Memory belongs to the user's brain and Boite's own notes, not to a
      // per-folder store the preset would otherwise tell the agent to write.
      autoMemoryEnabled: false,
      ...(setup.disableHooks ? { disableAllHooks: true } : {}),
    },
    includePartialMessages: true,
    // Every run of the user's own hooks, for the ledger Settings shows.
    includeHookEvents: true,
    // A CLI driven through the SDK asks the API to leave its reasoning out
    // ("omitted"): the thinking blocks arrive empty. A summary of it costs the
    // same thinking tokens. Only the display moves: whether and how much the
    // model thinks stays the CLI's call (effort, `alwaysThinkingEnabled`).
    extraArgs: { [THINKING_DISPLAY_FLAG]: 'summarized' },
    abortController: host.abortController,
    env: cliEnv(ctx),
    canUseTool: host.gate.canUseTool,
    hooks: {
      PreToolUse: [{ hooks: [host.gate.preToolUse] }],
      PostToolUse: [{ hooks: [host.gate.postToolUse] }],
      // The step boundary after each tool batch, and the native compaction's safety net.
      ...stepHooks(host.steps, host.compactionSummary),
    },
    spawnClaudeCodeProcess: host.spawn,
  };
}

/**
 * The user's stdio MCP servers, reached through the core so that each
 * starts on its first call instead of with the CLI. None for a context mode
 * that starts without MCP, and the servers as configured when the core
 * cannot take them over.
 */
export function lazyServers(ctx: SessionContext): ReturnType<NonNullable<SessionContext['lazyMcp']>> {
  if (ctx.protectedExecution) return null;
  const mode = ctx.thread.contextMode ?? null;
  if (ctx.lazyMcp === undefined || (mode !== null && !mode.mcp)) return null;
  try {
    const servers = userStdioServers(ctx.accountEnv.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR, ctx.thread.cwd);
    return ctx.lazyMcp(cliEnv(ctx), servers);
  } catch (error) {
    ctx.log('warn', `claude: MCP servers start with the CLI: ${messageOf(error)}`);
    return null;
  }
}
