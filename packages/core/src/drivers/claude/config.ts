import type { EffortLevel, PermissionMode as SdkPermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { ModelInfo, PermissionMode } from '@boite/contracts';

export function claudeModelId(id: string): string;
export function claudeModelId(id: string | null): string | null;
export function claudeModelId(id: string | null): string | null {
  return id?.startsWith('claude/claude-') && !id.slice(7).includes('/') && id.length > 7 ? id.slice(7) : id;
}

export function canonicalClaudeModel<Model extends ModelInfo>(model: Model): Model {
  const id = claudeModelId(model.id);
  if (!id.startsWith('claude-') || id.includes('/')) return model;
  const historical = `claude/${id}`;
  const aliases = model.aliases ?? [];
  if (aliases.some(alias => alias.id === historical)) return id === model.id ? model : { ...model, id };
  return { ...model, id, aliases: [...aliases, { id: historical }] };
}

/** The effort levels the SDK takes as an option; see `Options['effort']`. */
const SDK_EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'];
/** The one level the CLI has no option for: it is a word in the prompt. */
export const PROMPT_EFFORT = 'ultrathink';

/** The native settings a warm or running query can change without another prompt. */
export interface LiveSetup {
  model: string | null;
  /**
   * Null is the model's own default, and both cases land there: a thread with
   * no effort, and `ultrathink`, which is a word in the prompt and no option at
   * all. `applyFlagSettings` takes null as "clear it from the flag layer", so
   * the drift back to the default is one call like any other.
   */
  effortLevel: EffortLevel | null;
  fastMode: boolean;
  /**
   * What the CLI runs in: the mode Boite set, or one the CLI reported entering
   * by itself (EnterPlanMode, or an ExitPlanMode it was refused), which can be
   * one Boite has no name for.
   */
  permissionMode: Exclude<PermissionMode, 'yolo'> | SdkPermissionMode;
  disableHooks: boolean;
}

/** What this turn asks the running query to be, whatever the last one asked for. */
export function liveSetup(thread: { model: string | null; effort: string | null; permissionMode: PermissionMode; speed?: string | null; contextMode?: { hooks: boolean } | null }, protectedExecution = false): LiveSetup {
  const effort = thread.effort;
  return {
    model: claudeModelId(thread.model),
    effortLevel: effort !== null && SDK_EFFORTS.includes(effort) ? (effort as EffortLevel) : null,
    fastMode: thread.speed === 'fast',
    permissionMode: thread.permissionMode === 'yolo' ? 'bypassPermissions' : thread.permissionMode,
    // Only a context mode without hooks turns them off. YOLO keeps them: a hook
    // that answers `ask` reaches `canUseTool`, which allows it in YOLO.
    disableHooks: protectedExecution || thread.contextMode?.hooks === false,
  };
}

