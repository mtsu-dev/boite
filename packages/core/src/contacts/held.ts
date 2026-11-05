/*
 * The contacts each machine of the owner's group holds, told to the others.
 * A contact stays linked to the member it joined until it can follow the
 * group's Bots host (`group-link.ts`), and may never: a contact on another
 * network may not reach the host at all. Meanwhile every machine of the group
 * knows it by name, the Bots host's Contacts bot lists it, and an ask for it
 * goes through the member that holds it (`host-asks.ts`).
 *
 * The list rides each member's copy of the contacts (`relay.mirror`,
 * `members.ts`), pushed again whenever it changes, and carries only what the
 * bot reads: the name, the link state, trust, whether the contact has a bot,
 * the names of what it opened, and why the link did not move. No key,
 * address, grant or relation: those stay with the member.
 */
import type { Contact, ContactCapabilities, CoordinationPeer } from '@boite/contracts';
import { text } from '../coordination-letter.ts';
import type { Core } from '../core.ts';
import { invalidParams } from '../errors.ts';
import { memberAdmission } from './admission.ts';
import type { HolderAdmission } from './requests.ts';
import type { ContactStore } from './store.ts';

const HELD = 'contacts:held';
/** The members and the list they were last marked for: a change marks them again (`members.mark`). */
const TOLD = 'contacts:held-told';
const MAX = 32;

/** One contact a member holds, as it tells the others. */
export interface HeldContact {
  coreId: string;
  name: string;
  link: Contact['link'];
  trusted: boolean;
  /** The names of the projects the contact opened to the owner. */
  offers: string[];
  /** The contact has its own Contacts bot. */
  bot: boolean;
  capabilities: ContactCapabilities;
  /** When the member linked it (`addedAt`): an ask names it, so a contact removed and linked again never gets an older link's ask. */
  addedAt: number;
  /** Why the link has not moved to the Bots host, when the member tried. */
  reason?: string;
}
interface StoredHeld extends HeldContact { via: string; admission: string }
/** A contact a thread here may ask for: this core's own, or one a member holds (`holder`, at `admission`), which sends the ask. */
export interface Reachable { coreId: string; name: string; capabilities?: ContactCapabilities; holder?: CoordinationPeer; admission?: HolderAdmission }

/** The fields of a request sent through the member that holds its contact, or none for this core's own. */
export function throughHolder(found: Reachable): { holder: string; pendingHolder: true; holderAdmission: HolderAdmission } | null {
  return found.holder && found.admission ? { holder: found.holder.coreId, pendingHolder: true, holderAdmission: found.admission } : null;
}

const dashed = (name: string): string => name.replace(/\s+/g, '-').toLowerCase();

export class ContactHeld {
  readonly #core: Core;
  readonly #store: ContactStore;
  readonly #off: () => void;
  #started = false;
  #closed = false;

  constructor(core: Core, store: ContactStore) {
    this.#core = core;
    this.#store = store;
    this.#off = core.bus.onAny(name => { if (name === 'contacts.updated' || name === 'group.updated') queueMicrotask(() => this.tell()); });
  }

  /** Called once the contacts start: what changed while this core was off is told now. */
  start(): void { this.#started = true; this.tell(); }

  // -- The member that holds contacts.

  /** This core's own contacts, as every other member reads them. */
  outgoing(): HeldContact[] {
    return this.#store.list().slice(0, MAX).map(contact => {
      const reason = this.#store.groupLink.stuck(contact.coreId);
      return {
        coreId: contact.coreId, name: contact.name, link: this.#store.linkOf(contact.coreId), trusted: contact.trusted,
        offers: contact.offers.slice(0, 256).map(offer => offer.name.slice(0, 200)), bot: contact.bot !== undefined,
        capabilities: contact.capabilities ?? {}, addedAt: contact.addedAt, ...(reason ? { reason } : {}),
      };
    });
  }

  /** The list or the members changed since they were last marked: each member gets its copy again. */
  tell(): void {
    if (!this.#started || this.#closed) return;
    const members = this.#core.group.peers().map(peer => peer.coreId).sort();
    if (members.length === 0) return;
    const told = JSON.stringify([members, this.outgoing()]);
    if (this.#core.journal.getSetting(TOLD) === told) return;
    this.#core.journal.setSetting(TOLD, told);
    this.#store.members.mark(members);
  }

  // -- The other members.

  #stored(): StoredHeld[] { return (this.#core.journal.getSetting(HELD) as StoredHeld[] | undefined) ?? []; }

  /** What `via` holds now (`relay.mirror`); an older member sends no list and holds nothing this core can ask for. */
  mirrored(via: string, value: unknown): void {
    if (value !== undefined && (!Array.isArray(value) || value.length > MAX)) throw invalidParams(`mirror.held: expected up to ${MAX} contacts`);
    const admission = memberAdmission(this.#core, via);
    const entries = ((value ?? []) as unknown[]).map((entry, index) => ({ ...this.#check(entry, `mirror.held[${index}]`), via, admission }));
    const before = this.#stored();
    const next = [...before.filter(entry => entry.via !== via), ...entries];
    if (JSON.stringify(before) === JSON.stringify(next)) return;
    this.#core.journal.setSetting(HELD, next);
    this.#store.changed();
  }

  #check(value: unknown, field: string): HeldContact {
    const raw = value as Partial<HeldContact> | null;
    if (!raw || typeof raw !== 'object') throw invalidParams(`${field}: expected a contact`);
    if (!['connected', 'connecting', 'offline'].includes(raw.link as string)) throw invalidParams(`${field}.link: expected connected, connecting or offline`);
    if (!Array.isArray(raw.offers) || raw.offers.length > 256) throw invalidParams(`${field}.offers: expected up to 256 names`);
    if (!Number.isSafeInteger(raw.addedAt)) throw invalidParams(`${field}.addedAt: expected when the member linked the contact`);
    const flags = raw.capabilities ?? {};
    return {
      coreId: text(raw.coreId, `${field}.coreId`, 100), name: text(raw.name, `${field}.name`, 100), link: raw.link!, trusted: raw.trusted === true,
      offers: raw.offers.map((name, index) => text(name, `${field}.offers[${index}]`, 200)), bot: raw.bot === true,
      capabilities: {
        ...(flags.sharedProjects === 1 ? { sharedProjects: 1 } : {}), ...(flags.humanLetters === 1 ? { humanLetters: 1 } : {}),
        ...(flags.contactsBot === 1 ? { contactsBot: 1 } : {}), ...(flags.groupLink === 1 ? { groupLink: 1 } : {}),
      },
      addedAt: raw.addedAt!,
      ...(raw.reason === undefined ? {} : { reason: text(raw.reason, `${field}.reason`, 300) }),
    };
  }

  /**
   * The contacts the other members hold, each once, with the member: a
   * member that left, an admission that changed, a contact this core holds
   * itself, or a machine of the group are left out.
   */
  list(): (HeldContact & { member: CoordinationPeer; stamp: string })[] {
    const peers = this.#core.group.peers();
    const self = this.#core.coordination.card().coreId;
    const seen = new Set<string>();
    return this.#stored().flatMap(entry => {
      const member = peers.find(peer => peer.coreId === entry.via);
      let current = false;
      try { current = member !== undefined && entry.admission === memberAdmission(this.#core, entry.via); } catch { /* No group now. */ }
      if (!current || seen.has(entry.coreId) || entry.coreId === self || peers.some(peer => peer.coreId === entry.coreId) || this.#store.has(entry.coreId)) return [];
      seen.add(entry.coreId);
      const { via: _via, admission, ...held } = entry;
      return [{ ...held, member: member!, stamp: admission }];
    });
  }

  // -- Naming a contact anywhere in the group.

  /** A contact by name (any case, spaces or dashes) or core id: this core's own first, then one a member holds. */
  find(value: string): Reachable | undefined {
    const own = this.#store.lookup(value);
    if (own) return { coreId: own.coreId, name: own.name, ...(own.capabilities ? { capabilities: own.capabilities } : {}) };
    const wanted = value.trim().toLowerCase();
    const matches = (entry: { coreId: string; name: string }): boolean => entry.coreId === wanted || entry.name.toLowerCase() === wanted || dashed(entry.name) === wanted;
    const held = this.list().find(matches);
    return held ? { coreId: held.coreId, name: held.name, capabilities: held.capabilities, holder: held.member, admission: { contact: held.addedAt, member: held.stamp } } : undefined;
  }

  /** `find`, or the refusal `boite threads ask` reads. */
  reachable(value: unknown): Reachable {
    if (typeof value !== 'string' || !value.trim()) throw invalidParams('contact: expected the name or core id of a contact; see boite threads contacts', { field: 'contact' });
    const found = this.find(value);
    if (found) return found;
    const where = this.#core.group.peers().length > 0 ? 'a contact of any machine of this group' : 'one of this core\'s contacts';
    throw invalidParams(`contact: ${value} is not ${where}; see boite threads contacts`, { field: 'contact' });
  }

  close(): void { if (!this.#closed) { this.#closed = true; this.#off(); } }
}
