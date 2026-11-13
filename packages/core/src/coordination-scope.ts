import { coordinationReach } from '@boite/contracts';
import type { AgentLetter, CoordinationConfig, CoordinationPeer, CoordinationReach } from '@boite/contracts';
import { contactsBot } from './contacts/bot.ts';
import type { Core } from './core.ts';

/** A thread's config as its own agent may use it, cut to the machine's `coordinationReach`. */
export interface CoordinationScope extends CoordinationConfig {
  /** Other projects of this machine. */
  projects: boolean;
  /** Some other machine: every trusted one at reach `group`, else only a contact it shares its project with. */
  remote: boolean;
  reach: CoordinationReach;
  /** Whether it may reach that machine. */
  machine(coreId: string): boolean;
}

/**
 * What a thread's own agent may reach, the one place the machine setting
 * `coordinationReach` applies: its config with `projects` (other projects of
 * this machine) and `remote` (other machines) cut to the reach. The
 * directory, search, read and send all read it; it only narrows the config.
 * The Contacts bot keeps its config whole: it is the gateway other threads
 * ask, under the contacts' own rules. What follows another rule never reads
 * this: a bot over its entrusted projects (`resident`), team letters,
 * delegation and workflow steps, a contact-shared project
 * (`projectCoordination`), and what a thread accepts from elsewhere.
 *
 * `letter` is the one the thread is sending. The first answer of a thread an
 * agent started goes back to its starter whatever the reach: the start was
 * allowed, and its result is no new contact. The thread's own config (Off,
 * Pause, its own project only) still applies, and no other letter passes.
 */
export function coordinationScope(core: Core, threadId: string, config: CoordinationConfig, trusted: readonly CoordinationPeer[], letter?: Pick<AgentLetter, 'id' | 'to'>): CoordinationScope {
  const reach = contactsBot(core)?.threadId === threadId ? 'group' : coordinationReach(core.settings.get());
  // A project shared with a contact keeps its own rule: its threads reach that contact's side of it, whatever the reach.
  const shared = (coreId: string): boolean => { try { return core.sharedProjects.forThread(threadId, coreId).length > 0; } catch { return false; } };
  const answer = letter !== undefined && core.threads.spawns.answers(threadId, letter.to, letter.id);
  const machine = (coreId: string): boolean => config.remote && (reach === 'group' || shared(coreId) || (answer && coreId === letter.to.coreId));
  return { ...config, projects: config.remote && (reach !== 'project' || answer), remote: config.remote && (reach === 'group' || trusted.some(peer => shared(peer.coreId))), reach, machine };
}
