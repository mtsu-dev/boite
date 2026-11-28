import type { Query } from '@anthropic-ai/claude-agent-sdk';
import { fillModelCapabilities, modelCapabilities, type DiscoveredModel } from '../model-capabilities.ts';
import { canonicalClaudeModel } from './config.ts';
import { unavailable } from '../../errors.ts';
import { profileFor, resolveExecutable } from '../../providers/resolve.ts';
import type { ProbeContext, ProbeResult } from '../types.ts';
import { ProbeProcess } from './probe-process.ts';
import { childEnv, PromptQueue } from './query.ts';
import type { ClaudeDeps } from './query.ts';

export async function readClaudeModels(ctx: ProbeContext, deps: ClaudeDeps): Promise<ProbeResult> {
  const profile = profileFor(ctx.provider);
  const executable = profile ? resolveExecutable(profile) : null;
  if (!executable) throw unavailable('no Claude executable for model discovery');
  const prompts = new PromptQueue();
  const cli = new ProbeProcess(ctx);
  const abortController = new AbortController();
  let query: Query | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const queryFn = await deps.loadQuery();
    query = queryFn({ prompt: prompts.stream(), options: {
      cwd: ctx.cwd, pathToClaudeCodeExecutable: executable, abortController,
      env: childEnv(ctx.accountEnv), settingSources: ['user'], persistSession: false,
      // The user's settings for the model list, never their hooks: a probe is no session.
      settings: { disableAllHooks: true },
      // Without the strict flag an empty `mcpServers` adds no `--mcp-config`, and the CLI starts the user's servers.
      tools: [], mcpServers: {}, strictMcpConfig: true,
      spawnClaudeCodeProcess: cli.spawn,
    } });
    const rows = await Promise.race([query.supportedModels(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Claude model discovery timed out after 20 seconds')), 20_000);
    })]);
    const models = new Map<string, DiscoveredModel>();
    for (const row of rows) {
      if (/^(default|auto)$/i.test(row.value)) continue;
      const id = row.resolvedModel ?? row.value;
      // The family and version alone, as the other providers name theirs: `Opus 5.5`, never `Claude Opus 5.5`.
      // Older CLIs put the version in the description and a bare `Opus` in the display name.
      const versioned = (name: string) => name.match(/^(?:Claude\s+)?((?:Fable|Opus|Sonnet|Haiku)\s+\d+(?:\.\d+)*)(?:\b|$)/i)?.[1];
      const name = versioned(row.displayName) ?? versioned(row.description) ?? (row.displayName.trim().replace(/^Claude(?:\s+|$)/i, '').trim() || id);
      const discovered: DiscoveredModel = { id, name: id.includes('[1m]') ? `${name} (1M)` : name,
        ...modelCapabilities({
          supportsEffort: row.supportsEffort,
          supportedReasoningEfforts: row.supportsEffort === false ? [] : row.supportedEffortLevels,
          capabilities: { speed: row.supportsFastMode, adaptive_thinking: row.supportsAdaptiveThinking },
        }, { claude: true }),
      };
      const model = canonicalClaudeModel(discovered);
      const previous = models.get(model.id);
      models.set(model.id, previous ? fillModelCapabilities(previous, model) : model);
    }
    return { models: [...models.values()], probedAt: Date.now() };
  } finally { if (timer) clearTimeout(timer); cli.end(prompts, query, abortController); }
}
