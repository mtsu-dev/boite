/**
 * `boite contacts`: the Contacts bot's commands. Only the bot's own thread may
 * call them; the core refuses any other thread with the reason. Ordinary
 * threads ask the bot with `boite threads ask`.
 */
import type { ContactFlag, ContactRelation, ContactRequest, ContactsBotView } from '@boite/contracts';
import type { CoreClient } from '../client.ts';
import { Usage } from '../cli-args.ts';

type Printer = (lines: string[], value: unknown) => void;

export interface ContactsOptions {
  project?: string;
  model?: string;
  effort?: string;
  worktree: boolean;
}

export const CONTACTS_HELP = `Contacts bot (only its own thread):
  contacts                       requests waiting on you, relations, open flags,
                                 contacts and the projects you may use
  contacts forward <request-id> <contact>[/<thread-id>] [text]
                                 send a request of this owner's threads on
  contacts connect <request-id> <thread-id>
                                 put a contact's asking thread in relation with
                                 one thread here: letters only
  contacts start <request-id> <project> <brief>
                                 start a thread there for it (--model, --effort,
                                 --worktree) in relation with the asking thread
  contacts share <request-id> <project> <reason>
                                 ask the owner to open a project to the contact
  contacts ask-owner <request-id> <text>
                                 ask the owner about a contact not trusted
  contacts refuse <request-id> <reason>
  contacts cut <contact>[/<relation-id>] <reason>
                                 end its relations, one, or with --project close
                                 that project to it
  contacts deliver <flag-id>     hand a held letter to its thread
  contacts block <flag-id> <reason>
                                 refuse it`;

function requestLine(request: ContactRequest): string {
  const who = request.direction === 'in' ? `from ${request.contact}: ${JSON.stringify(request.from.title)} (${request.from.threadId})` : `from here: ${JSON.stringify(request.from.title)} (${request.from.threadId})${request.contact ? ` to ${request.contact}` : ''}`;
  const want = request.want ?? 'share';
  const target = request.target ? ` target ${request.target.threadId}${request.target.title ? ` ${JSON.stringify(request.target.title)}` : ''}` : '';
  const stage = request.status !== 'pending' ? request.status : request.stage === 'owner' ? 'waiting on the owner' : request.approved ? 'owner said yes' : 'waiting on you';
  const remote = request.gitRemote ? `\n    git remote: ${request.gitRemote}` : '';
  return `${request.id} ${request.direction} ${who}, wants ${want}${target} [${stage}]${remote}\n    ${request.text.replace(/\n/g, '\n    ')}`;
}

function relationLine(relation: ContactRelation): string {
  return `${relation.id} ${relation.contact}: ${relation.local.threadId} ${JSON.stringify(relation.local.title)} <-> ${relation.remote.threadId} ${JSON.stringify(relation.remote.title)}`;
}

function flagLine(flag: ContactFlag): string {
  return `${flag.id} ${flag.kind} from ${flag.contact}${flag.letterId ? `, letter ${flag.letterId} held` : ''}${flag.threadId ? ` to ${flag.threadId}` : ''}: ${flag.reason}`;
}

export function viewLines(view: ContactsBotView): string[] {
  const pending = view.requests.filter(request => request.status === 'pending');
  const flags = view.flags.filter(flag => flag.status === 'open');
  return [
    `requests (${pending.length}):`, ...(pending.length ? pending.map(requestLine) : ['  none']),
    `relations (${view.relations.length}):`, ...(view.relations.length ? view.relations.map(relationLine) : ['  none']),
    `open flags (${flags.length}):`, ...(flags.length ? flags.map(flagLine) : ['  none']),
    `contacts (${view.contacts.length}):`,
    ...(view.contacts.length ? view.contacts.map(contact => `  ${contact.name} (${contact.link}${contact.trusted ? ', trusted' : ''}${contact.bot ? ', has a Contacts bot' : ''}) opened to us: ${contact.offers.join(', ') || 'nothing'}; we opened: ${contact.granted.join(', ') || 'nothing'}`) : ['  none']),
    `projects here (${view.projects.length}):`,
    ...view.projects.map(project => `  ${project.name} (${project.id})${project.gitRemote ? ` ${project.gitRemote}` : ''}`),
  ];
}

export async function contactsCommand(client: CoreClient, threadId: string, rest: string[], options: ContactsOptions, print: Printer): Promise<void> {
  const [action = 'view'] = rest;
  const want = (index: number, what: string): string => {
    const value = rest[index];
    if (value === undefined || value === '') throw new Usage(`contacts ${action} needs ${what}`);
    return value;
  };
  const text = (start: number, what: string): string => {
    const value = rest.slice(start).join(' ').trim();
    if (!value) throw new Usage(`contacts ${action} needs ${what}`);
    return value;
  };
  const done = (request: ContactRequest, line: string) => print([`${request.id}: ${line}`], request);

  if (action === 'view' || action === 'list') {
    const view = await client.call('contacts.bot.view', { threadId });
    print(viewLines(view), view);
  } else if (action === 'help') {
    print([CONTACTS_HELP], null);
  } else if (action === 'forward') {
    const id = want(1, 'a request id');
    const [contact = '', target] = want(2, 'a contact, or <contact>/<thread-id>').split('/');
    const note = rest.slice(3).join(' ').trim();
    const request = await client.call('contacts.bot.forward', { threadId, id, contact, ...(target ? { target } : {}), ...(note ? { text: note } : {}) });
    done(request, `sent to ${request.contact}; its Contacts bot answers, and the answer reaches the asking thread`);
  } else if (action === 'connect') {
    const request = await client.call('contacts.bot.connect', { threadId, id: want(1, 'a request id'), target: want(2, 'a thread id here') });
    done(request, `relation ${request.relation?.id ?? ''} made; both threads were told how to write to each other`);
  } else if (action === 'start') {
    const id = want(1, 'a request id');
    const project = want(2, 'a project');
    const brief = text(3, 'a brief for the new thread');
    const result = await client.call('contacts.bot.start', {
      threadId, id, project, brief,
      ...(options.model === undefined ? {} : { model: options.model }), ...(options.effort === undefined ? {} : { effort: options.effort }),
      ...(options.worktree ? { worktree: true } : {}),
    });
    print([`${id}: thread ${result.threadId} started, in relation with the asking thread`], result);
  } else if (action === 'share') {
    const result = await client.call('contacts.bot.share', { threadId, id: want(1, 'a request id'), project: want(2, 'a project'), reason: text(3, 'the reason the owner reads') });
    print([`card ${result.questionId} asks the owner; only the owner's Yes opens the project. The answer comes back to this thread.`], result);
  } else if (action === 'ask-owner') {
    const result = await client.call('contacts.bot.askOwner', { threadId, id: want(1, 'a request id'), text: text(2, 'the question the owner reads') });
    print([`card ${result.questionId} asks the owner. The answer comes back to this thread.`], result);
  } else if (action === 'refuse') {
    const request = await client.call('contacts.bot.refuse', { threadId, id: want(1, 'a request id'), reason: text(2, 'the reason the asking agent reads') });
    done(request, 'refused');
  } else if (action === 'cut') {
    const [contact = '', relation] = want(1, 'a contact, or <contact>/<relation-id>').split('/');
    const result = await client.call('contacts.bot.cut', {
      threadId, contact, reason: text(2, 'a reason'),
      ...(relation ? { relation } : {}), ...(options.project === undefined ? {} : { project: options.project }),
    });
    print([`cut: ${result.relations} relation(s) ended, ${result.projects} project(s) closed`], result);
  } else if (action === 'deliver' || action === 'block') {
    const id = want(1, 'a flag id');
    const reason = action === 'block' ? text(2, 'a reason') : rest.slice(2).join(' ').trim();
    const flag = await client.call('contacts.bot.flag', { threadId, id, deliver: action === 'deliver', ...(reason ? { reason } : {}) });
    print([`${flag.id}: ${flag.status}`], flag);
  } else throw new Usage('contacts expects forward, connect, start, share, ask-owner, refuse, cut, deliver, block or help');
}
