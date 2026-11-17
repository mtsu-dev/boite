import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { assignShards } from '../../scripts/ci/shards.mts';

/**
 * `--shard` cut on each file's recorded seconds, as the E2E and core shards
 * are (scripts/ci/ui-shards.ts), not Vitest's count of files in hash order.
 * A file with no record counts as the median one.
 */
export class DurationSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard!;
    const { seconds } = JSON.parse(readFileSync(new URL('../../scripts/ci/ui-durations.json', import.meta.url), 'utf8')) as { seconds: Record<string, number> };
    const path = (spec: TestSpecification) => relative(this.ctx.config.root, spec.moduleId).replaceAll('\\', '/');
    const kept = new Set(assignShards(files.map(path), seconds, count)[index - 1]!.files);
    return files.filter((spec) => kept.has(path(spec)));
  }
}
