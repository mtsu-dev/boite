/** The contact methods: `contacts.*` for the owner, `collaboration.contacts` and `collaboration.ask` for agents. Who may call which is in `access.ts`. */
import type { Core } from '../core.ts';
import { registerSharedProjectMethods } from './projects.ts';
import { registerSharedBoardMethods } from './board.ts';
import { registerSharedAccess } from './access-policy.ts';
import { registerContactsBot } from './bot.ts';
import { decideMail, heldMail, releaseMail } from './letter-scopes.ts';
import { assertContacts } from './switch.ts';

/**
 * What links this machine to a contact, or lets one in, is refused while
 * contacts are off (`switch.ts`); reading, removing and the upkeep of what is
 * stored stay open.
 */
export function registerContactMethods(core: Core): void {
  registerSharedProjectMethods(core);
  registerSharedBoardMethods(core);
  registerSharedAccess(core);
  core.router.register('contacts.sendHuman', (p, c) => { assertContacts(core); return core.coordination.send(p, true, c.connection); });
  core.router.register('contacts.get', async () => ({ ...await core.contacts.state(), mail: heldMail(core) }));
  core.router.register('contacts.invite', p => { assertContacts(core); return core.contacts.invite(p.share, p.internet); });
  core.router.register('contacts.cancelInvites', () => core.contacts.cancelInvites());
  core.router.register('contacts.join', p => { assertContacts(core); return core.contacts.join(p.link); });
  core.router.register('contacts.update', p => {
    // Renaming or withdrawing trust is upkeep; granting it lets a contact's mail in.
    const contact = core.contacts.update(p);
    // Trusted now: the mail waiting from it goes to its threads.
    if (p.trusted === true) releaseMail(core, contact.coreId);
    return contact;
  });
  core.router.register('contacts.grant', p => { assertContacts(core); return core.contacts.grant(p); });
  core.router.register('contacts.revoke', p => core.contacts.revoke(p));
  core.router.register('contacts.remove', p => core.contacts.remove(p.coreId));
  core.router.register('contacts.decide', p => { if (p.accept) assertContacts(core); return core.contacts.decide(p); });
  core.router.register('contacts.decideMail', p => { if (p.accept) assertContacts(core); return decideMail(core, p.id, p.accept); });
  core.router.register('contacts.settings', p => core.contacts.setSettings(p.settings));
  core.router.register('contacts.tailscaleKey', p => { if (p.key !== null) assertContacts(core); return core.contacts.setTailscaleKey(p.key); });
  core.router.register('collaboration.contacts', p => core.coordination.mailboxes.contacts(p.threadId));
  core.router.register('collaboration.ask', p => { assertContacts(core); return core.coordination.mailboxes.ask(p); });
  registerContactsBot(core);
}
