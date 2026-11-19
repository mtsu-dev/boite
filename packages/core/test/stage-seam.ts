import { EXPERIMENT_STAGES, type ExperimentId, type FeatureStage } from '@boite/contracts';

/*
 * A finished feature tagged lower for one test, so the gate a Release keeps for
 * an experiment stays proved while no feature is one. `restoreStages` in the
 * file's afterEach puts every tag back.
 */
const stages = EXPERIMENT_STAGES as Record<ExperimentId, FeatureStage>;
const saved = new Map<ExperimentId, FeatureStage>();

export function tagStage(id: ExperimentId, stage: FeatureStage): void {
  if (!saved.has(id)) saved.set(id, stages[id]);
  stages[id] = stage;
}

export function restoreStages(): void {
  for (const [id, stage] of saved) stages[id] = stage;
  saved.clear();
}
