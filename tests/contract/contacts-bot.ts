import { RpcErrorCode } from '../../packages/contracts/src/index.ts';
import type { ContractEnv, Scenario } from './scenarios.ts';

/* The Contacts bot's own methods and the Bots role, the same on the real core and the in-memory client. */

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function refused(call: Promise<unknown>, code: number, field?: string): Promise<void> {
  let error: unknown = null;
  try { await call; } catch (caught) { error = caught; }
  check(error !== null, `expected code ${code}, the call succeeded`);
  const raw = error as { code?: number; data?: { field?: unknown }; rpc?: { code?: number; data?: { field?: unknown } } };
  const got = raw.rpc ?? raw;
  check(got.code === code, `expected code ${code}, got ${String(got.code)} (${error instanceof Error ? error.message : String(error)})`);
  if (field !== undefined) check(got.data?.field === field, `expected field ${field}, got ${String(got.data?.field)}`);
}

export const CONTACTS_BOT_SCENARIOS: Record<string, Scenario> = {
  'only the Contacts bot thread settles requests, and an unknown request, flag or relation is refused by its field': async (env: ContractEnv) => {
    const account = (await env.call('accounts.list', {})).find(entry => entry.providerId === 'echo')!;
    const project = await env.call('projects.add', { path: await env.newFolder(), name: 'Bot contract' });
    const thread = await env.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, title: 'Not the bot' });
    const bot = await env.call('agents.builtin.ensure', { kind: 'contacts' });
    const { threadId: botThread } = await env.call('agents.open', { agentId: bot.id });

    const view = await env.call('contacts.bot.view', { threadId: botThread });
    check(Array.isArray(view.requests) && Array.isArray(view.relations) && Array.isArray(view.flags) && Array.isArray(view.contacts), 'the bot view lists requests, relations, flags and contacts');
    check(view.projects.some(entry => entry.id === project.id), 'the bot view names the projects it may start a thread on');

    // Another thread of this owner is not the bot.
    const other = thread.id;
    await refused(env.call('contacts.bot.view', { threadId: other }), RpcErrorCode.Refused, 'threadId');
    await refused(env.call('contacts.bot.connect', { threadId: other, id: 'creq-none', target: other }), RpcErrorCode.Refused, 'threadId');
    await refused(env.call('contacts.bot.start', { threadId: other, id: 'creq-none', project: project.id, brief: 'Help them.' }), RpcErrorCode.Refused, 'threadId');
    await refused(env.call('contacts.bot.share', { threadId: other, id: 'creq-none', project: project.id, reason: 'They asked.' }), RpcErrorCode.Refused, 'threadId');
    await refused(env.call('contacts.bot.askOwner', { threadId: other, id: 'creq-none', text: 'Should I?' }), RpcErrorCode.Refused, 'threadId');
    await refused(env.call('contacts.bot.refuse', { threadId: other, id: 'creq-none', reason: 'No.' }), RpcErrorCode.Refused, 'threadId');
    await refused(env.call('contacts.bot.cut', { threadId: other, contact: 'Nobody', reason: 'Done.' }), RpcErrorCode.Refused, 'threadId');
    await refused(env.call('contacts.bot.flag', { threadId: other, id: 'cflag-none', deliver: false }), RpcErrorCode.Refused, 'threadId');

    // The bot itself, with nothing of that id to settle.
    await refused(env.call('contacts.bot.connect', { threadId: botThread, id: 'creq-none', target: other }), RpcErrorCode.InvalidParams, 'id');
    await refused(env.call('contacts.bot.start', { threadId: botThread, id: 'creq-none', project: project.id, brief: 'Help them.' }), RpcErrorCode.InvalidParams, 'id');
    await refused(env.call('contacts.bot.share', { threadId: botThread, id: 'creq-none', project: project.id, reason: 'They asked.' }), RpcErrorCode.InvalidParams, 'id');
    await refused(env.call('contacts.bot.askOwner', { threadId: botThread, id: 'creq-none', text: 'Should I?' }), RpcErrorCode.InvalidParams, 'id');
    await refused(env.call('contacts.bot.refuse', { threadId: botThread, id: 'creq-none', reason: 'No.' }), RpcErrorCode.InvalidParams, 'id');
    await refused(env.call('contacts.bot.flag', { threadId: botThread, id: 'cflag-none', deliver: true }), RpcErrorCode.InvalidParams, 'id');
    await refused(env.call('contacts.cutRelation', { id: 'crel-none' }), RpcErrorCode.InvalidParams, 'id');
  },

  'the Bots role names one machine of the group or none': async (env: ContractEnv) => {
    const group = await env.call('group.create', { name: 'Bots contract' });
    const self = group.cores[0]!.coreId;
    await refused(env.call('group.botsHome', { coreId: 'core-elsewhere' }), RpcErrorCode.InvalidParams, 'coreId');
    check((await env.call('group.botsHome', { coreId: self })).botsHome === self, 'the Bots role is this machine');
    check((await env.call('group.get', {}))?.botsHome === self, 'the Bots role read back');
    check((await env.call('group.botsHome', { coreId: null })).botsHome === undefined, 'the Bots role cleared');
    // The other scenarios start with no group.
    await env.call('group.leave', {});
  },
};
