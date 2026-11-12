/** `agent.spawn`, as the core's `threads/spawn.ts` answers it: the same refusals, a real thread with the brief as its first message. */
import { AGENT_PROJECTS_MAX, RpcErrorCode, type AgentProfile, type AgentProjectAdded, type AgentSpawn, type Message, type ThreadLink } from '@boite/contracts';
import { RpcFailure } from '../client';
import { entrustProject } from './agent-settings';
import { missingFolder, pathKey } from './checks';
import { coordinationConfig, fakeCore } from './coordination';
import { addFakeProject, folderToAdd } from './projects';
import { fakeMember } from './requests';
import { toSummary } from './shared';
import { chooseHere, chooseModel, machineArg, memberModels, type ModelRequest } from './thread-models';
import { resolveProject } from './thread-move';
import type { FakeContext, FakeMethods } from './context';

function refuse(message: string, data: Record<string, unknown>): RpcFailure {
  return new RpcFailure({ code: RpcErrorCode.Refused, message, data });
}

/**
 * The fake starts the thread and its turn, marks both ends, and keeps retries
 * idempotent. The answer the core sends back when the first turn ends is not
 * simulated: the fake's turns finish on their own schedule.
 */
export function spawnMethods(ctx: FakeContext, create: FakeMethods['threads.create'], addProject: FakeMethods['projects.add']) {
  const ledgers = new Map<string, { requestId: string; fingerprint: string; at: number; answer: AgentSpawn }[]>();
  const pending = new Map<string, { fingerprint: string; result: Promise<AgentSpawn> }>();
  const origins = new Map<string, ThreadLink>();
  return {
    'agent.addProject': async (params): Promise<AgentProjectAdded> => {
      const method = 'agent.addProject';
      const caller = ctx.thread(params.threadId);
      if (caller.parentThreadId) throw refuse('a delegated agent or workflow step cannot add projects; ask its parent', { threadId: caller.id, field: 'threadId' });
      if (caller.archived) throw refuse('an archived thread cannot add projects', { threadId: caller.id, field: 'threadId', expected: 'a thread that is not archived' });
      // The core's rule for a bot: its `addProjects` setting, its own machine only, and what it adds is entrusted to it.
      let bot: AgentProfile | null = null;
      if (caller.agentSessionId || caller.projectId === null) {
        const owner = ctx.agents.ownerOf(caller.id);
        bot = owner === null ? null : ctx.agents.profileOf(owner);
        if (bot?.status === 'archived') bot = null;
        if (bot === null) throw refuse('this thread has no project and is no bot\'s own conversation: it cannot add projects', { threadId: caller.id, field: 'threadId' });
        if (ctx.agents.configOf(bot.id).addProjects !== true) {
          throw refuse(`the owner has not let ${bot.name} add projects; ask with boite settings bot request addProjects true --why <reason>`, { threadId: caller.id, field: 'addProjects', expected: true });
        }
        if (params.machine !== undefined) {
          throw refuse('a bot adds projects on its own machine only; ask for a project of another machine with boite settings bot request projects +<machine>/<project> --why <reason>', { threadId: caller.id, field: 'machine' });
        }
      }
      const path = typeof params.path === 'string' ? params.path.trim() : '';
      const gate = () => {
        const config = coordinationConfig(ctx, caller.id);
        if (config.mode === 'off') throw refuse(`${method}: communication is off for this thread; the owner turns it on in Communication settings`, { threadId: caller.id, field: 'coordination' });
        if (config.paused) throw refuse(`${method}: communication is paused for this thread; only the owner resumes it`, { threadId: caller.id, field: 'coordination' });
        if (!config.remote) throw refuse(`${method}: this thread may only reach its own project; the owner allows other projects in Communication settings`, { threadId: caller.id, field: 'coordination' });
        if (origins.has(caller.id) && caller.messages.filter(m => m.role === 'user').length <= 1) throw refuse('a thread an agent started cannot add a project until the user writes in it', { threadId: caller.id, field: 'threadId' });
      };
      const systemLine = (text: string) => {
        const line: Message = {
          id: `m-${++ctx.seq}`, threadId: caller.id, turnId: caller.turns.at(-1)?.id ?? `turn-${++ctx.seq}`, role: 'system', state: 'complete', createdAt: ctx.now(),
          parts: [{ type: 'text', text }],
        };
        caller.messages.push(line);
        ctx.emitToThread(caller.id, 'message.started', structuredClone(line));
        ctx.emitToThread(caller.id, 'message.completed', { threadId: caller.id, messageId: line.id, state: 'complete' });
      };
      if (params.machine !== undefined) {
        // The core's `#addElsewhere` and the member's `addFor`: the path is that machine's, checked there.
        gate();
        const machine = fakeMember(ctx, params.machine, method);
        const there = fakeCore(machine.coreId);
        if (there === undefined) throw new RpcFailure({ code: RpcErrorCode.Unavailable, message: `${machine.name} did not answer`, data: { field: 'machine' } });
        const name = machineArg(ctx, machine);
        if (there.settings.groupThreads !== true) {
          throw refuse(`${machine.name} does not let the other machines of its group add projects there; propose the switch to the user with boite settings request groupThreads true --machine ${name} --why "<what the project is for>"`, { field: 'machine', setting: 'groupThreads' });
        }
        let added: ReturnType<typeof addFakeProject>;
        try { added = addFakeProject(there, folderToAdd({ path, name: params.name }, 'project.add')); }
        catch (error) { throw error instanceof RpcFailure ? refuse(`${machine.name}: ${error.message}`, { field: 'machine' }) : error; }
        const { project } = added;
        if (added.added) systemLine(`The agent added the project ${project.name} (${project.path}) on ${machine.name}.`);
        return { id: project.id, name: project.name, path: project.path, repository: project.repository === true, drafts: project.kind === 'drafts', current: false, added: added.added, machine: name };
      }
      if (!path || !/^([A-Za-z]:[\\/]|[\\/])/.test(path)) throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: `${method}.path: expected an absolute folder, got ${path}` });
      const answer = (p: { id: string; name: string; path: string; repository?: boolean; kind?: string }, added: boolean): AgentProjectAdded => (
        { id: p.id, name: p.name, path: p.path, repository: p.repository === true, drafts: p.kind === 'drafts', current: p.id === caller.projectId, added });
      const known = ctx.projects.find(p => pathKey(p.path) === pathKey(path));
      if (known) return bot === null ? answer(known, false) : { ...answer(known, false), entrusted: (bot.projectIds ?? []).includes(known.id) };
      gate();
      if (missingFolder(path)) throw refuse('a project path must be an existing directory', { path });
      if (bot !== null && new Set(bot.projectIds ?? []).size >= AGENT_PROJECTS_MAX) {
        throw refuse(`projects: ${bot.name} holds ${AGENT_PROJECTS_MAX} projects already, the most an agent holds; ask for one to be taken away with boite settings bot request projects -<name> --why <reason>`, { threadId: caller.id, field: 'projects' });
      }
      const project = await addProject({ path, ...(params.name === undefined ? {} : { name: params.name.trim() }) });
      systemLine(`The agent added the project ${project.name} (${project.path}).`);
      if (bot === null) return answer(project, true);
      entrustProject(ctx, bot, project.id);
      return { ...answer(project, true), entrusted: true };
    },
    'agent.spawn': async (params): Promise<AgentSpawn> => {
      const caller = ctx.thread(params.threadId);
      if (caller.agentSessionId || caller.projectId === null) throw refuse('a persistent agent session takes its work through Agents and cannot start threads', { threadId: caller.id, field: 'threadId' });
      if (caller.parentThreadId) throw refuse('a delegated agent or workflow step cannot start threads; ask its parent', { threadId: caller.id, field: 'threadId' });
      if (caller.archived) throw refuse('an archived thread cannot start threads', { threadId: caller.id, field: 'threadId', expected: 'a thread that is not archived' });
      const prompt = params.prompt.trim();
      if (!prompt || params.prompt.length > 12_000) throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: 'agent.spawn.prompt: expected 1 to 12000 characters' });
      const bounded = (value: unknown, field: string, max: number): string => {
        if (typeof value !== 'string' || !value.trim() || value.length > max) throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: `agent.spawn.${field}: expected 1 to ${max} characters` });
        return value.trim();
      };
      const choice: ModelRequest | null = params.model === undefined && params.effort === undefined && params.speed === undefined ? null : {
        ...(params.model === undefined ? {} : { model: bounded(params.model, 'model', 256) }),
        ...(params.effort === undefined ? {} : { effort: bounded(params.effort, 'effort', 64) }),
        ...(params.speed === undefined ? {} : { speed: bounded(params.speed, 'speed', 64) }),
      };
      if (params.machine !== undefined) {
        // The core's refusals for another machine, its model list included; a thread there is not simulated.
        const { machine, choices } = memberModels(ctx, caller, params.machine, 'agent.spawn');
        if (choice !== null) chooseModel(choices, caller, choice, `boite delegate models --machine ${machineArg(ctx, machine)}`);
        throw new RpcFailure({ code: RpcErrorCode.Unavailable, message: 'the in-memory client does not start threads on another machine', data: { field: 'machine' } });
      }
      const fingerprint = JSON.stringify([params.project, params.prompt, params.title ?? null, params.worktree === true, ...(params.context === undefined ? [] : [params.context]), ...(choice === null ? [] : [{ choice }])]);
      const ledger = ledgers.get(caller.id) ?? [];
      const retried = ledger.find(entry => entry.requestId === params.requestId);
      if (retried) {
        if (retried.fingerprint !== fingerprint) throw refuse('agent.spawn.requestId was already used for different content', { threadId: caller.id, field: 'requestId' });
        return structuredClone(retried.answer);
      }
      const key = JSON.stringify([caller.id, params.requestId]);
      const active = pending.get(key);
      if (active) {
        if (active.fingerprint !== fingerprint) throw refuse('agent.spawn.requestId was already used for different content', { threadId: caller.id, field: 'requestId' });
        return structuredClone(await active.result);
      }
      const result = Promise.resolve().then(async () => {
        if (ctx.thread(caller.id).archived) throw refuse('an archived thread cannot start threads', { threadId: caller.id, field: 'threadId', expected: 'a thread that is not archived' });
        const target = resolveProject(ctx, caller.id, params.project, 'agent.spawn');
        const config = coordinationConfig(ctx, caller.id);
        if (config.mode === 'off') throw refuse('agent.spawn: communication is off for this thread; the owner turns it on in Communication settings', { threadId: caller.id, field: 'coordination' });
        if (config.paused) throw refuse('agent.spawn: communication is paused for this thread; only the owner resumes it', { threadId: caller.id, field: 'coordination' });
        if (target.id !== caller.projectId && !config.remote) throw refuse('agent.spawn: this thread may only reach its own project; the owner allows other projects in Communication settings', { threadId: caller.id, field: 'project' });
        if (origins.has(caller.id) && caller.messages.filter(m => m.role === 'user').length <= 1) throw refuse('a thread an agent started cannot start another until the user writes in it', { threadId: caller.id, field: 'threadId' });
        const title = params.title?.trim() || prompt.split('\n')[0]!.slice(0, 80);
        const picked = choice === null ? null : await chooseHere(ctx, caller, choice);
        const created = await create({
          projectId: target.id, title,
          ...(picked === null
            ? { providerId: caller.providerId, accountId: caller.accountId, ...(caller.model === null ? {} : { model: caller.model }), effort: caller.effort }
            : { providerId: picked.providerId, accountId: picked.accountId, model: picked.model, effort: picked.effort, ...(picked.speed === null ? {} : { speed: picked.speed }) }),
          permissionMode: caller.permissionMode,
          ...(params.worktree ? { worktree: {} } : {}), ...(params.context === undefined ? {} : { context: params.context }),
        });
        if (ctx.thread(caller.id).archived) throw refuse('an archived thread cannot start threads', { threadId: caller.id, field: 'threadId', expected: 'a thread that is not archived' });
        const thread = ctx.thread(created.id);
        thread.titleSource = 'user';
        const from = ctx.projects.find(project => project.id === caller.projectId)!;
        const origin: ThreadLink = { threadId: caller.id, title: caller.title, projectId: from.id, project: from.name };
        origins.set(thread.id, origin);
        const turn = ctx.startTurn(thread.id, prompt);
        const first = thread.messages.find(message => message.turnId === turn.id && message.role === 'user');
        const part = first?.parts[0];
        if (part?.type === 'text') Object.assign(part, { displayText: prompt, startedBy: origin });
        const line: Message = {
          id: `m-${++ctx.seq}`, threadId: caller.id, turnId: caller.turns.at(-1)?.id ?? `turn-${++ctx.seq}`, role: 'system', state: 'complete', createdAt: ctx.now(),
          parts: [{ type: 'text', text: `Started thread "${title}" (${thread.id}) in project ${target.name}.`, started: { threadId: thread.id, title, projectId: target.id, project: target.name } }],
        };
        caller.messages.push(line);
        ctx.emitToThread(caller.id, 'message.started', structuredClone(line));
        ctx.emitToThread(caller.id, 'message.completed', { threadId: caller.id, messageId: line.id, state: 'complete' });
        const answer: AgentSpawn = { thread: structuredClone(toSummary(thread)), turnId: turn.id, address: { coreId: ctx.identity.coreId, threadId: thread.id }, project: target.name };
        const at = ctx.now();
        ledgers.set(caller.id, [...(ledgers.get(caller.id) ?? []).filter(entry => entry.at > at - 86_400_000), { requestId: params.requestId, fingerprint, at, answer }]);
        return answer;
      });
      pending.set(key, { fingerprint, result });
      try { return structuredClone(await result); }
      finally { pending.delete(key); }
    },
  } satisfies Partial<FakeMethods>;
}
