import type { HarnessUpdate } from './providers';

/*
 * Whether an agent's update is offered, shared by the app's machine list and
 * the core's `boite state updates`, so both count the same releases.
 */

function newer(update: HarnessUpdate): boolean {
  return update.latest !== null && update.current !== null && update.latest !== update.current
    && (update.pending || update.skipped === update.latest || update.state === 'failed');
}

/** The user chose not to hear about this release again. */
export function harnessSkipped(update: HarnessUpdate): boolean {
  return update.skipped !== null && update.skipped === update.latest;
}

/** The release an agent's row offers: its arrow, its Update button and the machine's summary go together. */
export function harnessOffered(update: HarnessUpdate): boolean {
  return !harnessSkipped(update) && (update.pending || (update.state === 'failed' && newer(update)));
}
