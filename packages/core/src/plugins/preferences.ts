/*
 * What the owner chose for each installed plugin, kept in the journal so it
 * outlives a core restart: whether it is turned off, and the values of the
 * settings its manifest declares. Only values that differ from the declared
 * default are stored; a key a later version drops goes at the next write.
 * Both leave with an uninstall.
 */

import { pluginSettingProblem, pluginSettingValues } from '@boite/contracts';
import type { PluginSetting, PluginSettingValues } from '@boite/contracts';
import type { Journal } from '../journal.ts';
import { invalidParams } from '../errors.ts';
import { isRecord } from './manifest.ts';

const OFF_KEY = 'plugin-off:';
const SETTINGS_KEY = 'plugin-settings:';

export class PluginPreferences {
  #journal: Pick<Journal, 'getSetting' | 'setSetting' | 'deleteSetting' | 'isClosed'>;

  constructor(journal: Pick<Journal, 'getSetting' | 'setSetting' | 'deleteSetting' | 'isClosed'>) {
    this.#journal = journal;
  }

  /** A closed journal answers off: a relaunch timer that fires after a crash starts nothing. */
  isOff(id: string): boolean {
    return this.#journal.isClosed() || this.#journal.getSetting(`${OFF_KEY}${id}`) === true;
  }

  setOff(id: string, off: boolean): void {
    if (off) this.#journal.setSetting(`${OFF_KEY}${id}`, true);
    else this.#journal.deleteSetting(`${OFF_KEY}${id}`);
  }

  /** Every declared setting's value: the stored one while still valid, the default otherwise. */
  values(id: string, declared: readonly PluginSetting[]): PluginSettingValues {
    return pluginSettingValues(declared, this.#stored(id));
  }

  /**
   * Stores `values` over the ones kept. Each key must be declared and each
   * value valid for it, or nothing is stored and the refusal names the key.
   * Answers every value after the change.
   */
  set(id: string, declared: readonly PluginSetting[], values: unknown): PluginSettingValues {
    if (!isRecord(values)) throw invalidParams('values must be an object of setting keys and values', { field: 'values', expected: 'an object of setting keys and values' });
    for (const [key, value] of Object.entries(values)) {
      const setting = declared.find((entry) => entry.key === key);
      if (setting === undefined) {
        const expected = declared.length === 0 ? `none: ${id} declares no settings` : `one of ${declared.map((entry) => entry.key).join(', ')}`;
        throw invalidParams(`${id} declares no setting ${key}; expected ${expected}`, { field: `values.${key}`, expected });
      }
      const problem = pluginSettingProblem(setting, value);
      if (problem !== null) throw invalidParams(`${id} setting ${key} must be ${problem}, got ${JSON.stringify(value)}`, { field: `values.${key}`, expected: problem });
    }
    const merged = pluginSettingValues(declared, { ...this.#stored(id), ...values });
    const kept = Object.fromEntries(declared.flatMap((setting) => (merged[setting.key] === setting.default ? [] : [[setting.key, merged[setting.key]]])));
    if (Object.keys(kept).length === 0) this.#journal.deleteSetting(`${SETTINGS_KEY}${id}`);
    else this.#journal.setSetting(`${SETTINGS_KEY}${id}`, kept);
    return merged;
  }

  /** At uninstall: the plugin's choices go with it. */
  forget(id: string): void {
    this.#journal.deleteSetting(`${OFF_KEY}${id}`);
    this.#journal.deleteSetting(`${SETTINGS_KEY}${id}`);
  }

  #stored(id: string): Record<string, unknown> {
    const stored = this.#journal.getSetting(`${SETTINGS_KEY}${id}`);
    return isRecord(stored) ? stored : {};
  }
}
