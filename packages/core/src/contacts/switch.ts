import { CONTACTS_OFF_MESSAGE, CONTACTS_OFF_REASON, contactsOn } from '@boite/contracts';
import type { Core } from '../core.ts';
import { memberAdmission } from './admission.ts';
import { RpcFailure, refused } from '../errors.ts';

// Earlier peers match the full refusal text to decide whether to retry.
const PEER_CONTACTS_OFF = 'contacts are off on this machine (Settings, General, What agents may do alone); ask the owner to turn them on with: boite settings request contacts true --why "<reason>"';

/*
 * Whether contacts run on this machine. Two things hold them off: the admin
 * policy (`network.contacts: false`) and the owner's own switch, `contacts`
 * in Settings, held off in a Release. Off, they stop where the policy stops
 * them: no invitation, join, link or contact letter, and agents read nothing
 * about contacts. What is stored waits for the switch.
 */

/**
 * Whether this install already works with contacts, the first start's reason
 * to leave the switch on: one of its own (`store.ts`), or a copy another
 * member relays to it (`members.ts`) or holds for the group (`held.ts`) under
 * the admission still current. Seeding reads saved records separately from
 * the switch in force. A copy from a group this core left reaches
 * nothing and counts for nothing. Read once the group is restored.
 */
export function contactsKept(core: Core): boolean {
  const own = core.journal.getSetting('contacts');
  if (Array.isArray(own) && own.length > 0) return true;
  return ['contacts:relayed', 'contacts:held'].some(key => {
    const copies = core.journal.getSetting(key);
    return Array.isArray(copies) && copies.some((copy: { via?: unknown; admission?: unknown }) => {
      try { return typeof copy.via === 'string' && copy.admission === memberAdmission(core, copy.via); }
      catch { return false; }
    });
  });
}

/** True while either the policy or the owner's switch holds contacts off. */
export function contactsOff(core: Pick<Core, 'policy' | 'settings'>): boolean {
  return core.policy.networkOff('contacts') || !contactsOn(core.settings.get());
}

/** Throws the policy's refusal, else the switch's, while contacts are off. */
export function assertContacts(core: Pick<Core, 'policy' | 'settings'>, detail?: string): void {
  core.policy.assert(core.policy.networkOff('contacts'), 'network.contacts', detail);
  if (!contactsOn(core.settings.get())) throw refused(detail ? `${CONTACTS_OFF_MESSAGE} (${detail})` : CONTACTS_OFF_MESSAGE, { reason: CONTACTS_OFF_REASON });
}

/** Whether `error` is the switch's or the policy's refusal: what was queued then waits for contacts, never fails. */
export function contactsRefusal(error: unknown): boolean {
  if (!(error instanceof RpcFailure) || typeof error.data !== 'object' || error.data === null) return false;
  const data = error.data as { reason?: unknown; policy?: unknown };
  return data.reason === CONTACTS_OFF_REASON || data.policy === 'network.contacts';
}

/**
 * Whether a peer's signed refusal says its contacts are off, by its switch or
 * its policy: a request, letter or answer already queued for it waits for
 * them instead of failing.
 */
export function contactsOffWord(message: string): boolean {
  return message.startsWith(PEER_CONTACTS_OFF) || message.startsWith(CONTACTS_OFF_MESSAGE) || message.includes(': blocked by your organization\'s policy, key network.contacts in ');
}

/** The signed peer protocol carries text only. Keep it recognizable to older senders. */
export function contactsPeerRefusal(error: RpcFailure): string {
  return error.message.startsWith(CONTACTS_OFF_MESSAGE)
    ? PEER_CONTACTS_OFF + error.message.slice(CONTACTS_OFF_MESSAGE.length) : error.message;
}
