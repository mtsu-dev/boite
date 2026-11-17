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
  private seconds?: Record<string, number>;

  private recorded(spec: TestSpecification): number | undefined {
    this.seconds ??= (JSON.parse(readFileSync(new URL('../../scripts/ci/ui-durations.json', import.meta.url), 'utf8')) as { seconds: Record<string, number> }).seconds;
    return this.seconds[this.path(spec)];
  }

  private path(spec: TestSpecification): string {
    return relative(this.ctx.config.root, spec.moduleId).replaceAll('\\', '/');
  }

  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard!;
    this.recorded(files[0]!);
    const kept = new Set(assignShards(files.map((spec) => this.path(spec)), this.seconds!, count)[index - 1]!.files);
    return files.filter((spec) => kept.has(this.path(spec)));
  }

  /**
   * A shard starts its longest recorded files, as the core shards do. With no
   * Vitest cache, as on a run whose cache key changed, Vitest would start the
   * largest files instead, all transforming at once: QuestionCard.test.ts then
   * took 18.8 s instead of 2.4 and timed out. Unrecorded files follow, in
   * Vitest's order; a run without `--shard` keeps Vitest's order.
   */
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const order = await super.sort(files);
    if (!this.ctx.config.shard) return order;
    const rank = new Map(order.map((spec, position) => [spec, position]));
    return [...files].sort((a, b) => (this.recorded(b) ?? -1) - (this.recorded(a) ?? -1) || rank.get(a)! - rank.get(b)!);
  }
}
