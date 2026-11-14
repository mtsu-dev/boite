/**
 * `agents.create`: a thread the user asked for a bot asks for it. With the
 * machine setting `agentBotCreation` on `ask` it draws a card in that thread
 * and creates nothing; the owner's `agents.create.approve` then makes the bot.
 * On `free` the bot is made at once, as the Bots page does. Its route resolves
 * as `boite delegate` reads a model, from the calling thread: its own route
 * when none is named. The shared checks live in contracts/agent-create.ts,
 * where the in-memory client reads them.
 */
import { agentBotCreation, botCard, checkAgentCreate, type AgentCreateApproveParams, type AgentCreated, type AgentCreateParams, type AgentCreateResult, type AgentCreation, type AgentSelection, type DelegationConfig, type ThreadSummary } from '@boite/contracts';
import type { Core } from '../core.ts';
import { resolveRoute } from '../delegation/routes.ts';
import { notFound, refused, RpcFailure } from '../errors.ts';
import { botDefaultModel, checkModel, modelsFor } from '../threads/selection.ts';
import type { AgentStore } from './store.ts';

/** Any installed model, as a subagent with no limits would read it: a bot's own policy comes later, from the owner. */
const CREATE_ROUTES: DelegationConfig = { enabled: true, paused: false, profiles: [], anyModel: true };

type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

function context(core: Core, store: AgentStore, route: (model: string | undefined, effort: string | undefined) => Checked<AgentSelection>) {
  return {
    bots: store.records.list('profile').filter(agent => agent.status !== 'archived'),
    projects: core.projects.list().filter(project => project.kind !== 'drafts').map(project => ({ id: project.id, label: project.name })),
    route,
  };
}

function checked(core: Core, store: AgentStore, thread: ThreadSummary, params: AgentCreateParams): AgentCreation {
  const result = checkAgentCreate(params, context(core, store, (model, effort) => {
    try {
      const route = resolveRoute(core, thread, CREATE_ROUTES, { ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) });
      const provider = core.providers.require(route.providerId);
      // As `agents.profile.save` fills a route on the provider's default model.
      const chosen = checkModel(provider, route.accountId, route.model ?? botDefaultModel(provider, route.accountId));
      if (chosen === null) return { ok: false, message: 'model: this thread runs on its provider\'s default model; name one with --model' };
      // Full access, as a bot made on the Bots page.
      return { ok: true, value: { providerId: route.providerId, accountId: route.accountId, model: chosen, effort: effort === undefined ? null : route.effort, permissionMode: 'bypassPermissions' } };
    } catch (error) {
      if (error instanceof RpcFailure) return { ok: false, message: error.message };
      throw error;
    }
  }));
  if (!result.ok) throw refused(result.message, result.data);
  return result.value;
}

function save(store: AgentStore, bot: AgentCreation): AgentCreated {
  const { name, domain, instructions, projectIds, selection } = bot;
  const agent = store.saveProfile({ value: { name, domain, instructions, avatar: '', status: 'active', projectIds, selection } });
  return { agent, threadId: store.sessionOf(agent.id)?.threadId ?? null };
}

export function createAgent(core: Core, store: AgentStore, params: AgentCreateParams): AgentCreateResult {
  const thread = core.threads.require(params.threadId);
  if (thread.archived) throw refused('an archived thread cannot create a mochi', { threadId: thread.id });
  const bot = checked(core, store, thread, params);
  if (agentBotCreation(core.settings.get()) === 'free') return save(store, bot);
  const open = core.threads.listQuestions(thread.id).some(request => request.setting?.kind === 'bot' && request.setting.bot.name.toLowerCase() === bot.name.toLowerCase());
  if (open) throw refused(`a card asking to create the mochi ${JSON.stringify(bot.name)} is already open in this thread`, { field: 'name' });
  const names = new Map(core.projects.list().map(project => [project.id, project.name]));
  let model = bot.selection.model ?? '';
  try { model = modelsFor(core.providers.require(bot.selection.providerId), bot.selection.accountId).find(entry => entry.id === bot.selection.model)?.name ?? model; } catch { /* The id names it. */ }
  const card = botCard(bot, bot.projectIds.map(id => names.get(id) ?? id), model);
  const { questionId } = core.threads.cards.drawAsync(thread, { text: card.text, options: card.options, allowText: false, multiple: false, async: true, setting: card.setting });
  return { questionId, setting: card.setting };
}

/**
 * The owner approves a bot card. The bot is checked again as it would be
 * saved: its name may have been taken, a project removed or its account
 * signed out since the card was drawn. The route is the one the card shows.
 */
export function approveAgent(core: Core, store: AgentStore, params: AgentCreateApproveParams): AgentCreated {
  const request = core.threads.listQuestions(params.threadId).find(question => question.id === params.questionId);
  const ask = request?.setting;
  if (ask?.kind !== 'bot') throw notFound(`agents.create.approve: ${String(params.questionId)} is no open mochi card of thread ${String(params.threadId)}`, { field: 'questionId' });
  const { name, domain, instructions, projectIds, selection } = ask.bot;
  const result = checkAgentCreate({ name, domain, instructions, projects: projectIds }, context(core, store, () => {
    try {
      const provider = core.providers.require(selection.providerId);
      return { ok: true, value: { ...selection, model: checkModel(provider, selection.accountId, selection.model) } };
    } catch (error) {
      if (error instanceof RpcFailure) return { ok: false, message: error.message };
      throw error;
    }
  }));
  if (!result.ok) throw refused(result.message, result.data);
  const made = save(store, result.value);
  core.threads.cards.settle(open => (open.id === params.questionId ? { optionIds: ['applied'], value: { agentId: made.agent.id, threadId: made.threadId } } : null), 'the owner, who approved the mochi');
  return made;
}
