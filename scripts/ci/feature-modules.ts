/**
 * The modules of each cut feature, by bundle: everything its lazy entry
 * loads and nothing else imports. Each calls `markFeature` with its marker at
 * its top level (docs/internals/experiments.md#the-proof), and
 * `feature-cut.test.ts` checks that and fails on a file of a feature's
 * directory that is neither here nor in `STAYS`.
 *
 * Empty today: no feature is cut (`FEATURE_CUTS`), since the five that were
 * (the Whip, the Council, Contacts, Teams and Automatic goals) are finished.
 * The next feature cut from a build lists its modules here again.
 */
import type { ExperimentId } from '../../packages/contracts/src/experiments.ts';

export const FEATURE_MODULES: Partial<Record<ExperimentId, { ui: string[]; core: string[] }>> = {};

/** The directories that belong to one feature: a new file there must be listed above, or below with its reason. */
export const FEATURE_DIRECTORIES: Partial<Record<ExperimentId, string[]>> = {};

/** Files of those directories that every build holds. */
export const STAYS: Record<string, string> = {};
