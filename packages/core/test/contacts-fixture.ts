import type { CoreClient } from '../src/client.ts';
import { makeAgent } from './agent-fixture.ts';
import type { TestCore } from './harness.ts';

/**
 * Gives the core a Contacts bot as the Experiments setting would: an echo
 * agent whose profile is marked built-in `contacts`. Its intro turn has ended.
 * The raw record update emits nothing, so the fixture signals the change the
 * way `saveProfile` does: contacts hear of the bot from that `agents.changed`,
 * not from whichever later event the intro turn happens to emit.
 */
export async function contactsBotOf(h: TestCore, client: CoreClient, name = 'Operator'): Promise<{ agentId: string; threadId: string }> {
  const { agent, threadId } = await makeAgent(h, client, { name, domain: 'Contacts', instructions: 'Settle contacts\' requests.' });
  const { id, revision, createdAt: _c, updatedAt: _u, ...draft } = h.core.workforce.records.find('profile', agent.id)!;
  h.core.workforce.records.update('profile', id, revision, { ...draft, builtin: 'contacts' });
  h.core.workforce.changed();
  return { agentId: agent.id, threadId };
}
