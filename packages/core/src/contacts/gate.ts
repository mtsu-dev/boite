import { experimentStartRefusal } from '@boite/contracts';
import type { Core } from '../core.ts';
import { refused } from '../errors.ts';

/**
 * Contacts is an experiment: a Release starts nothing new in it (an
 * invitation, a link, a share, a request, an acceptance), whatever an app
 * asks. Reading and removing what a Nightly left behind stay open, so a
 * person can still clean up.
 */
export function contactsGate(core: Core): void {
  const refusal = experimentStartRefusal('contacts', core.version);
  if (refusal !== null) throw refused(refusal, { reason: 'experiment-off' });
}
