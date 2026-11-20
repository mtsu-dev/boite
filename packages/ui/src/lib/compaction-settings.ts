import type { CompactionPolicy, CompactionTarget, Settings } from '@boite/contracts';

/** Absent types follow the common defaults, including later changes. */
export function compactionPolicy(settings: Partial<Settings> | null | undefined, target?: CompactionTarget): CompactionPolicy {
  return (target ? settings?.compactionByType?.[target] : undefined) ?? {
    autoCompact: settings?.autoCompact ?? null,
    backgroundCompaction: settings?.backgroundCompaction === true,
    ...(settings?.compactionSummary === undefined ? {} : { compactionSummary: settings.compactionSummary }),
  };
}

/** Settings patches replace the map, so keep every other type and parameter. */
export function compactionPatch(settings: Partial<Settings> | null | undefined, target: CompactionTarget | undefined, patch: Partial<CompactionPolicy>): Partial<Settings> {
  return target ? { compactionByType: { ...settings?.compactionByType, [target]: { ...compactionPolicy(settings, target), ...patch } } } : patch;
}

type SettingsOwner = { readonly settings: Partial<Settings> | null | undefined; saveSettings(patch: Partial<Settings>): Promise<boolean> };

/**
 * The writes of one compaction card, one after the other. A per-type patch
 * replaces the whole `compactionByType` map, so each is built from the
 * settings the previous answer left, never from those seen when it was asked:
 * a background switch flipped while a limit saves keeps the limit.
 */
export class CompactionWrites {
  #last: Promise<unknown> = Promise.resolve();

  save(machine: SettingsOwner, target: CompactionTarget | undefined, patch: Partial<CompactionPolicy>): Promise<boolean> {
    const sent = this.#last.catch(() => undefined).then(() => machine.saveSettings(compactionPatch(machine.settings, target, patch)));
    this.#last = sent;
    return sent;
  }

  /** Resolves once every write asked so far, and any asked meanwhile, has an answer. */
  async idle(): Promise<void> {
    for (let seen = this.#last; ; seen = this.#last) {
      await seen.catch(() => undefined);
      if (seen === this.#last) return;
    }
  }
}
