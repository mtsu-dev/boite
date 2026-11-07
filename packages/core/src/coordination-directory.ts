import type { AgentAddress, AgentContact, AgentMatch, AgentTranscript, CoordinationConfig, CoordinationPeer, Message } from '@boite/contracts';
import type { Core } from './core.ts';
import { checkMatchExtras, checkRemoteContact, checkTranscript, PARTIAL, partialList, partialName, queryPayload, readTranscript, searchContacts, searchWords, toolOutputEntry, transcriptQuery, type TranscriptQuery } from './coordination-lookup.ts';
import { address, same } from './coordination-letter.ts';
import { PeerRefusal } from './coordination-wire.ts';
import { contactsBot } from './contacts/bot.ts';
import type { ContactMailboxes } from './contacts/mailboxes.ts';
import { projectCoordination } from './contacts/project-coordination.ts';
import { invalidParams, messageOf, refused } from './errors.ts';

/** What the lookups read from the coordination that owns them. */
export interface LookupSide {
  selfId(): string;
  config(threadId: string): CoordinationConfig;
  trusted(): CoordinationPeer[];
  localReach(threadId: string): AgentContact[];
  contact(threadId: string, resident?: boolean): AgentContact;
  checkLookupAccess(threadId: string, remote: boolean): void;
  readonly mailboxes: ContactMailboxes;
}

/**
 * The directory, search and transcript reads across this machine, trusted
 * machines and contacts reached through the group. A machine or route that
 * does not answer is named in `unavailable`, never folded into an empty list.
 */
export class CoordinationLookups {
  constructor(private readonly core: Core, private readonly side: LookupSide) {}
  /** With a Contacts bot, only its thread lists, searches and reads contacts' threads; a shared project keeps its own rules. */
  private hidden(threadId: string): (coreId: string) => boolean {
    const bot = contactsBot(this.core);
    if (bot === null || bot.threadId === threadId) return () => false;
    return coreId => this.core.contacts.isContact(coreId) && !this.core.sharedProjects.hasContact(coreId);
  }
  /**
   * The contacts' threads this thread may write to though no directory lists
   * them: the other end of each of its relations; for the Contacts bot, every
   * relation, the threads whose requests it settles and the contacts' own
   * bots. Their machine is the contact's name, so `<contact>/<thread-id>` resolves.
   */
  private related(threadId: string): AgentContact[] {
    const bot = contactsBot(this.core);
    if (bot === null) return [];
    const self = bot.threadId === threadId;
    const as = (coreId: string, name: string, thread: { threadId: string; title: string }, seen?: AgentContact): AgentContact => ({
      resources: '', status: 'idle', mode: 'brief', ...seen, coreId, threadId: thread.threadId, title: thread.title, machine: name.trim().replace(/\s+/g, '-'),
    });
    const out = this.core.contacts.relations.list().filter(relation => self || relation.local.threadId === threadId).map(relation => as(relation.coreId, relation.contact, relation.remote, relation.remote));
    if (self) {
      for (const request of this.core.contacts.requests.list()) if (request.direction === 'in' && request.status === 'pending') out.push(as(request.coreId, request.contact, request.from, request.from));
      for (const contact of this.core.contacts.list()) if (contact.bot) out.push(as(contact.coreId, contact.name, contact.bot));
    }
    return out;
  }
  private peers(threadId: string): CoordinationPeer[] { const hide = this.hidden(threadId); return this.side.trusted().filter(peer => !hide(peer.coreId)); }
  async directory(threadId: string): Promise<{ agents: AgentContact[]; unavailable: string[] }> {
    const thread = this.core.threads.require(threadId);
    const config = this.side.config(threadId);
    if (thread.archived || config.mode === 'off') return { agents: [], unavailable: [] };
    const agents = this.side.localReach(threadId).filter(a => a.threadId !== threadId);
    const unavailable: string[] = [];
    if (config.remote) {
      const found = await Promise.all(this.peers(threadId).map(async peer => {
        try { return { peer, answer: await projectCoordination(this.core, threadId, peer, 'directory', { partial: PARTIAL }) }; } catch { return { peer, answer: null }; }
      }));
      const hide = this.hidden(threadId);
      const routed = await this.side.mailboxes.directory(threadId);
      routed.entries = routed.entries.filter(entry => !hide(entry.coreId));
      // Trust and associations are read after the last await: a peer revoked while another lookup was pending is named, not listed.
      const trusted = new Set(this.side.trusted().map(peer => peer.coreId));
      for (const { peer, answer } of found) {
        let remote: { contacts: AgentContact[]; missing: number } | null = null;
        if (answer && trusted.has(peer.coreId)) try {
          const list = partialList(answer());
          remote = { contacts: list.entries.map(a => checkRemoteContact(a as AgentContact, peer)), missing: list.unavailable };
        } catch { remote = null; }
        if (!remote) unavailable.push(peer.name);
        else {
          agents.push(...remote.contacts);
          if (remote.missing > 0) unavailable.push(partialName(peer.name, remote.missing));
        }
      }
      agents.push(...routed.entries);
      unavailable.push(...routed.unavailable);
      for (const entry of this.related(threadId)) if (!agents.some(agent => same(agent, entry))) agents.push(entry);
    }
    // Permissions may change while a remote directory is in flight.
    this.side.checkLookupAccess(threadId, config.remote);
    const reachable = new Set(this.side.localReach(threadId).map(contact => contact.threadId));
    const localCoreId = this.side.selfId();
    // A group member that is down fails both its own directory and the contact routes asked of it: it is named once.
    return { agents: agents.filter(contact => contact.coreId !== localCoreId || reachable.has(contact.threadId)), unavailable: [...new Set(unavailable)] };
  }
  /**
   * Every contact this thread may reach on each trusted machine, in parallel; a machine that fails is named, not fatal.
   * The caller collects the answers after its own last await: trust and associations are read then.
   */
  private async remoteAll<T>(threadId: string, operation: 'search' | 'read', payload: unknown, check: (answer: unknown, peer: CoordinationPeer) => T, peers = this.peers(threadId)): Promise<() => { results: T[]; unavailable: string[] }> {
    const config = this.side.config(threadId);
    if (!config.remote || config.mode === 'off') return () => ({ results: [], unavailable: [] });
    const found = await Promise.all(peers.map(async peer => {
      try { return { peer, answer: await projectCoordination(this.core, threadId, peer, operation, payload), failed: null }; }
      catch (error) { return { peer, answer: null, failed: error instanceof PeerRefusal ? `${peer.name} (${error.message})` : peer.name }; }
    }));
    return () => {
      this.side.checkLookupAccess(threadId, true);
      const trusted = new Set(this.side.trusted().map(peer => peer.coreId));
      const results: T[] = [], unavailable: string[] = [];
      for (const { peer, answer, failed } of found) {
        // A peer that answered early may have been revoked while another lookup was pending.
        if (!answer || !trusted.has(peer.coreId)) { unavailable.push(failed ?? peer.name); continue; }
        try { results.push(check(answer(), peer)); } catch (error) { unavailable.push(error instanceof PeerRefusal ? `${peer.name} (${error.message})` : peer.name); }
      }
      return { results, unavailable };
    };
  }
  /** Contacts here and on trusted machines whose fields or chat contain every word of the query. */
  async search(threadId: string, query: string): Promise<{ matches: AgentMatch[]; unavailable: string[] }> {
    const words = searchWords(query);
    const config = this.side.config(threadId);
    if (this.core.threads.require(threadId).archived || config.mode === 'off') return { matches: [], unavailable: [] };
    const own = this.side.localReach(threadId).filter(a => a.threadId !== threadId);
    const matches = searchContacts(this.core.journal.db, own, words);
    const collect = await this.remoteAll(threadId, 'search', { words, partial: PARTIAL }, (answer, peer) => {
      const list = partialList(answer);
      return { peer, missing: list.unavailable, matches: list.entries.map(match => ({ ...checkRemoteContact(match as AgentContact, peer), ...checkMatchExtras(match as { matched?: unknown; excerpts?: unknown }) })) };
    });
    const routed = config.remote ? await this.side.mailboxes.search(threadId, words) : { entries: [], unavailable: [] };
    const hide = this.hidden(threadId);
    routed.entries = routed.entries.filter(entry => !hide(entry.coreId));
    this.side.checkLookupAccess(threadId, config.remote);
    const remote = collect();
    const reachable = new Set(this.side.localReach(threadId).map(contact => contact.threadId));
    const trusted = new Set(this.side.trusted().map(peer => peer.coreId));
    const remoteMatches = remote.results.flatMap(result => result.matches);
    const partial = remote.results.flatMap(result => result.missing > 0 ? [partialName(result.peer.name, result.missing)] : []);
    return {
      matches: [...matches.filter(match => reachable.has(match.threadId)), ...remoteMatches.filter(match => trusted.has(match.coreId)), ...routed.entries],
      unavailable: [...new Set([...remote.unavailable, ...partial, ...routed.unavailable, ...remoteMatches.filter(match => !trusted.has(match.coreId)).map(match => match.machine)])],
    };
  }
  /**
   * One tool call's whole output, read by the thread that ran it: its carried
   * history (`continuation.ts`) keeps a head and tail and points here. It
   * reads nothing beyond that thread's own journal, so it does not wait for
   * coordination to be on; another thread's tool output stays unread.
   */
  private ownToolOutput(threadId: string, to: AgentAddress, query: TranscriptQuery, tool: unknown): AgentTranscript {
    if (typeof tool !== 'string' || tool.length === 0 || tool.length > 200) throw invalidParams('tool: expected a tool call id of 1 to 200 characters', { field: 'tool' });
    if (query.entry === undefined) throw invalidParams('tool: expected beside entry, the id of the message that made the call', { field: 'tool' });
    if (to.coreId !== this.side.selfId() || to.threadId !== threadId) throw refused('tool: a thread reads only its own tool output; another thread shows its text and tool names', { field: 'tool' });
    const found = this.core.journal.messagePart(query.entry, part => part.type === 'tool' && part.toolId === tool);
    if (!found || found.message.threadId !== threadId) throw invalidParams(`entry: ${query.entry} is not an entry of this thread`, { field: 'entry' });
    if (found.part?.type !== 'tool') throw invalidParams(`tool: ${tool} is not a tool call of entry ${query.entry}`, { field: 'tool' });
    const row = this.core.journal.streamingMessage(query.entry)
      ?? this.core.journal.db.query('SELECT role, created_at AS createdAt FROM messages WHERE id = ?').get(query.entry) as Pick<Message, 'role' | 'createdAt'>;
    const entry = toolOutputEntry({ id: query.entry, role: row.role, at: row.createdAt }, found.part.name, found.part.output ?? '', query.offset ?? 0);
    // Its own contact card, whatever its coordination settings.
    return { contact: this.side.contact(threadId, true), entries: [entry], more: false };
  }

  /**
   * Another reachable contact's conversation, text and tool names only: a page
   * of entries, or with `entry` the rest of one entry's text from `offset`.
   */
  async read(threadId: string, target: AgentAddress, limit?: number, before?: number, entry?: string, offset?: number, tool?: string): Promise<AgentTranscript> {
    const to = address(target, 'target');
    const query = transcriptQuery({ limit, before, entry, offset });
    if (tool !== undefined) return this.ownToolOutput(threadId, to, query, tool);
    const config = this.side.config(threadId);
    const resident = to.coreId === this.side.selfId() && this.core.workforce.projects.over(threadId, to.threadId) !== null;
    if (this.core.threads.require(threadId).archived || (config.mode === 'off' && !resident)) throw refused('coordination is disabled for this thread');
    if (to.coreId === this.side.selfId()) {
      const contact = (resident ? this.side.contact(to.threadId, true) : undefined) ?? this.side.localReach(threadId).find(a => same(a, to)) ?? (to.threadId === threadId ? this.side.contact(threadId) : undefined);
      if (!contact) throw refused(`target: ${to.threadId} is not a contact this thread may reach; see boite threads`);
      return { contact, ...readTranscript(this.core.journal.db, to.threadId, query, id => this.core.journal.streamingMessage(id)) };
    }
    const peer = this.side.trusted().find(p => p.coreId === to.coreId);
    if (!config.remote) throw refused('cross-machine coordination is disabled for this thread');
    if (this.hidden(threadId)(to.coreId)) throw refused('target: only the Contacts bot reads a contact\'s threads; ask it with boite threads ask', { field: 'target' });
    const payload = { threadId: to.threadId, ...queryPayload(query) };
    if (!peer) return this.side.mailboxes.read(threadId, to.coreId, payload);
    let incompatible: string | undefined;
    const collect = await this.remoteAll(threadId, 'read', payload, (answer, from) => {
      const raw = answer as { contact?: AgentContact } | null;
      const contact = checkRemoteContact(raw?.contact as AgentContact, from);
      if (contact.threadId !== to.threadId) throw new Error('transcript of another thread');
      // An older machine sends a page for a read of one entry: say so rather than "did not answer".
      try { return { contact, ...checkTranscript(answer, query) }; } catch (error) { incompatible = messageOf(error); throw new PeerRefusal(incompatible); }
    }, [peer]);
    const { results, unavailable } = collect();
    if (!this.side.trusted().some(current => current.coreId === peer.coreId)) throw refused('target.coreId: machine permission revoked');
    if (!results[0]) throw refused(incompatible === undefined ? `${unavailable[0] ?? peer.name} did not answer the read` : `${peer.name}: ${incompatible}`);
    return results[0];
  }}
