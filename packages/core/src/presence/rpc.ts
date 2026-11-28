/**
 * `presence.set`, the desktop app's rich presence (docs/internals/presence.md).
 * Loaded only through `presence-entry.ts`.
 */
import { experimentRefusal, markFeature, PRESENCE_APPLICATION_ID } from '@boite/contracts';
import type { Core } from '../core.ts';
import { refused } from '../errors.ts';
import { PresenceService } from './service.ts';

markFeature('boite-feature:discord-presence');

export function registerPresence(core: Core, service = new PresenceService({ applicationId: PRESENCE_APPLICATION_ID, log: (level, message) => core.log(level, message) })): PresenceService {
  core.router.register('presence.set', (params, ctx) => {
    const refusal = experimentRefusal('discord-presence', core.version);
    // Clearing stays possible whatever the build: it only takes something away.
    if (refusal !== null && params.activity !== null) throw refused(refusal, { field: 'activity', expected: 'null in a build without the discord-presence experiment' });
    // A chat app's socket is on this machine: a window reached from elsewhere sits beside another one.
    if (ctx.connection.remote !== false) throw refused('presence.set takes the desktop app on this machine only: a chat app listens on the machine that runs the core, and this window reached it from elsewhere', { field: 'connection', expected: 'this machine\'s loopback' });
    // A browser tab on this machine is loopback too: only the desktop app shows one, so a tab never takes its place.
    if (params.activity !== null && ctx.connection.sentFrom?.client !== 'shell') throw refused('presence.set takes an activity from the desktop app only', { field: 'connection', expected: 'the desktop app (hello client "shell")' });
    return service.set(params.activity, ctx.connection);
  });
  return service;
}
