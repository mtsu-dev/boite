/*
 * The Contacts bot goes with the Bots role (`Group.botsHome`). When the group
 * names another member Bots host and this core runs the live built-in
 * contacts bot, this core moves the bot there (`agents.move`) before it hands
 * any contact link (`group-link.ts`). The move's request id comes from the
 * role's roster revision, so a restart sends the same move again and the host
 * takes it once. The links go only once the host answered that it holds a
 * bot; until then this core keeps both.
 *
 * The host hears first that a bot is coming. If the member that announced it
 * leaves the group before the bot arrived, the host makes a fresh one
 * (`agents.builtin.ensure`), so the group's contacts are not left without one.
 */
import type { CoordinationPeer } from '@boite/contracts';
import type { Core } from '../core.ts';
import { messageOf } from '../errors.ts';
import { contactsBot } from './bot.ts';

/** The member whose Contacts bot is on its way to this Bots host. */
const COMING = 'contacts:bot-coming';
/** A move that failed is sent again this long after, or at the next forced sweep. */
const RETRY_MS = 30_000;

/** The request id of the move to `host` for this revision of the Bots role: the same after a restart. */
export function botMoveId(revision: number, host: string): string { return `contacts-bot-${revision}-${host.slice(0, 16)}`; }

export class ContactBotHome {
  readonly #core: Core;
  /** The host and role revision that answered it holds a bot. */
  #ready: string | null = null;
  #job: Promise<void> | null = null;
  #next = 0;
  #closed = false;
  readonly #resweep: () => void;

  constructor(core: Core, resweep: () => void) {
    this.#core = core;
    this.#resweep = resweep;
  }

  #revision(): number { return this.#core.group.roster?.botsHomeRev ?? 0; }

  // -- The member that holds the bot.

  /** The links may go to `host`: this core has no live contacts bot, or the host holds one now. `force` ignores the retry wait. */
  ready(host: CoordinationPeer, force = false): boolean {
    if (contactsBot(this.#core) === null) return true;
    const key = `${host.coreId}:${this.#revision()}`;
    if (this.#ready === key) return true;
    if (this.#job === null && (force || Date.now() >= this.#next)) {
      this.#job = this.#send(host, key)
        .catch(error => { if (!this.#closed) this.#core.log('info', `contacts: the Contacts bot stays here for now (${messageOf(error)})`, { source: 'contacts' }); })
        .finally(() => { this.#job = null; });
    }
    return false;
  }

  async #send(host: CoordinationPeer, key: string): Promise<void> {
    this.#next = Date.now() + RETRY_MS;
    const holds = async (): Promise<boolean> => ((await this.#core.coordination.request(host, 'contact.hand', { action: 'bot' })) as { bot?: unknown } | null)?.bot === true;
    // The host learns a bot is coming, or already runs its own: then this one stays here and the links may go.
    if (!await holds()) {
      const bot = contactsBot(this.#core);
      if (bot !== null) {
        try { await this.#core.workforce.moves.move({ agentId: bot.agentId, machine: host.coreId, requestId: botMoveId(this.#revision(), host.coreId) }); }
        catch (error) { if (!await holds().catch(() => false)) throw error; }
      }
    }
    if (contactsBot(this.#core) !== null) this.#core.log('warn', `contacts: ${host.name} runs its own Contacts bot; the one here stays, with no contact`, { source: 'contacts' });
    this.#ready = key;
    if (!this.#closed) this.#resweep();
  }

  // -- The Bots host.

  /** `contact.hand` `bot`: a member says its bot is coming; the answer says whether this host holds one already. */
  coming(peer: CoordinationPeer): { bot: boolean } {
    const bot = contactsBot(this.#core) !== null;
    if (!bot) this.#core.journal.setSetting(COMING, peer.coreId);
    return { bot };
  }

  /** On the Bots host, at each sweep: the member that announced the bot left the group without sending it, so a fresh one starts here. */
  hosting(): void {
    const coming = this.#core.journal.getSetting(COMING) as string | undefined;
    if (coming === undefined) return;
    if (contactsBot(this.#core) === null && this.#core.group.peers().some(peer => peer.coreId === coming)) return;
    this.#core.journal.deleteSetting(COMING);
    if (contactsBot(this.#core) !== null) return;
    try { this.#core.workforce.builtins.ensure({ kind: 'contacts' }); }
    catch (error) { this.#core.log('warn', `contacts: no Contacts bot could start here (${messageOf(error)})`, { source: 'contacts' }); }
  }

  close(): Promise<unknown> { this.#closed = true; return this.#job ?? Promise.resolve(); }
}
