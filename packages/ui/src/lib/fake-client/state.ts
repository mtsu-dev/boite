import {
  RpcErrorCode, isStateDomain, stateAgentUpdate, stateInbox, stateLimit, stateMachines, stateRoute, stateSummary, stateTasks,
  type StateAppUpdate, type StateReading, type StateUpdates, type StateVersion,
} from '@boite/contracts';
import { RpcFailure } from '../client';
import { gatewayQuotas, quotas } from './accounts';
import type { FakeContext, FakeMethods } from './context';
import { view } from './group';
import { resources } from './resources';
import { toSummary } from './shared';

/**
 * `agent.state` as the core answers it (packages/core/src/state.ts): this
 * fake's own accounts, group, devices, updates, threads, processes and gateway,
 * through the same projections (contracts/src/state.ts).
 */
export function stateMethods(ctx: FakeContext): Pick<FakeMethods, 'agent.state'> {
  const app = (status: { phase: string; version: string | null; error: string | null } | null): StateAppUpdate | null =>
    status === null ? null : { phase: status.phase, version: status.version, error: status.error };
  return {
    'agent.state': async (params) => {
      if (!isStateDomain(params.domain)) throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: `domain must be one of summary, limits, machines, updates, inbox, tasks, version, route; got ${String(params.domain)}`, data: { field: 'domain' } });
      const version: StateVersion = { version: ctx.core.version, channel: 'stable', track: null, platform: 'browser', arch: 'unknown', build: 'source', bun: null };
      // The fake has no sockets: a paired device stands for the caller when the caller is not the owner, as `sessions.list` says.
      const caller = ctx.bus.principal === 'owner' ? undefined : ctx.sessions.find(session => session.role !== 'owner')?.id;
      const machines = () => stateMachines(view(ctx), ctx.sessions, { version: ctx.core.version, os: null, reached: () => true, connected: id => id === caller });
      const updates = (): StateUpdates => ({
        version: ctx.core.version, channel: 'stable',
        server: ctx.serverUpdate.phase === 'idle' ? null : app(ctx.serverUpdate), desktop: app(ctx.desktopUpdate), agents: ctx.harnessUpdates.map(stateAgentUpdate),
      });
      const inbox = () => stateInbox(
        [...ctx.threads.values()].filter(thread => !thread.archived).map(toSummary),
        [...ctx.pendingQuestions.values()].map(pending => pending.request),
        [...ctx.pendingPermissions.values()].map(pending => pending.request),
        projectId => ctx.projects.find(project => project.id === projectId)?.name ?? null,
      );
      const route = () => stateRoute(ctx.settings.subscriptionProxy ?? null, ctx.providers, gatewayQuotas(ctx));
      const limits = () => quotas(ctx).map(stateLimit);
      const tasks = () => stateTasks(resources(ctx));
      const read: { [D in StateReading['domain']]: () => StateReading } = {
        version: () => ({ domain: 'version', version }),
        limits: () => ({ domain: 'limits', limits: limits() }),
        machines: () => ({ domain: 'machines', machines: machines() }),
        updates: () => ({ domain: 'updates', updates: updates() }),
        inbox: () => ({ domain: 'inbox', inbox: inbox() }),
        tasks: () => ({ domain: 'tasks', tasks: tasks() }),
        route: () => ({ domain: 'route', route: route() }),
        summary: () => ({ domain: 'summary', summary: stateSummary({ version, limits: limits(), machines: machines(), updates: updates(), inbox: inbox(), tasks: tasks(), route: route() }) }),
      };
      return structuredClone(read[params.domain]());
    },
  };
}
