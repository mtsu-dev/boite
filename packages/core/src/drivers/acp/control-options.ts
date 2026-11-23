import type { SessionConfigOption, SessionConfigOptionCategory } from '@agentclientprotocol/sdk/unstable';
import { grokReasoningEffortOf } from '../grok.ts';
import { AGENT_OWN_MODEL, categoryOption, type AgentModels } from './models.ts';

export function categoryValue(options: SessionConfigOption[], category: SessionConfigOptionCategory): string | undefined {
  const option = categoryOption(options, category);
  return option?.type === 'select' ? String(option.currentValue) : undefined;
}

/** Select an advertised model and decide whether a Grok request needs the model as well as the effort. */
export function listedModelPlan(
  grok: boolean, thread: { model: string | null; effort: string | null }, own: string | null,
  listed: AgentModels | null, appliedModel: string | null | undefined, appliedEffort: string | null | undefined,
) {
  const wanted = (thread.model === AGENT_OWN_MODEL ? null : thread.model) ?? (grok ? null : own);
  const effort = grok ? thread.effort || null : null;
  if (wanted === null && effort === null) return undefined;
  const model = wanted ?? listed?.currentModelId;
  if (model == null) return undefined;
  if (appliedModel === model && appliedEffort === effort) return undefined;
  const currentModel = appliedModel === undefined ? listed?.currentModelId : appliedModel;
  const currentEntry = listed?.available.find(entry => entry.modelId === currentModel);
  const alreadyOpen = appliedModel === undefined && model === currentModel
    && (effort === null || effort === grokReasoningEffortOf(currentEntry?.meta));
  return { model, effort, alreadyOpen, requiresModel: wanted !== null && model !== currentModel };
}
