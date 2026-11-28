/**
 * The rich presence on the fake core's computer: Discord as Ada on the first
 * socket and a Fluxer bridge on the next, both taking whatever is set
 * (packages/core/src/presence/). Nothing leaves the page.
 */
import type { PresenceStatus } from '@boite/contracts';
import type { FakeContext, FakeMethods } from './context';

const LISTENING: PresenceStatus['targets'] = [{ socket: 'discord-ipc-0', user: 'Ada' }, { socket: 'discord-ipc-1', user: null }];

export function presenceMethods(_ctx: FakeContext): Pick<FakeMethods, 'presence.set'> {
  return {
    'presence.set': async (params) => params.activity === null ? { active: false, targets: [] } : { active: true, targets: LISTENING },
  };
}
