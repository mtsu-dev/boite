import { experimentStartRefusal } from '@boite/contracts';
import type { Core } from '../core.ts';
import { refused } from '../errors.ts';

/**
 * What starts something new in Contacts (an invitation, a link, a share, a
 * request, an acceptance) asks here first. Contacts are finished (`release`),
 * so this refuses nothing in any build; it would refuse in a build below the
 * tag if Contacts ever went back to one, while reading and removing what
 * exists stay open.
 */
export function contactsGate(core: Core): void {
  const refusal = experimentStartRefusal('contacts', core.version);
  if (refusal !== null) throw refused(refusal, { reason: 'experiment-off' });
}
