import type { RpcMethodName, RpcMethods } from './index.ts';
import { checkSettingsPatch } from './settings-validation.ts';
import { streamChannelsProblem } from './stream-channels.ts';
import { MESSAGE_SEARCH_QUERY_LIMIT, MESSAGE_SEARCH_RESULT_LIMIT } from './message-search.ts';

export type RpcParamsCheck<T = unknown> =
  | { ok: true; params: T }
  | { ok: false; field: string; message: string };

/**
 * The runtime rules of a method's params, one per method, read by the core's
 * router and the in-memory client alike. A method listed here reaches its
 * handler only with params its rule accepted, in the form the rule returned;
 * a method not listed yet checks its own params in its handler.
 */
/** A method that takes `channels`: only that field is checked here, the handler checks the rest. */
function channelsRule<M extends 'threads.subscribe' | 'threads.get'>(params: unknown): RpcParamsCheck<RpcMethods[M]['params']> {
  const problem = streamChannelsProblem((params as { channels?: unknown } | null)?.channels);
  return problem ? { ok: false, field: problem.field, message: `${problem.field} must be ${problem.expected}` } : { ok: true, params: params as RpcMethods[M]['params'] };
}

const RPC_PARAMS: { readonly [M in RpcMethodName]?: (params: unknown) => RpcParamsCheck<RpcMethods[M]['params']> } = {
  'settings.set': params => {
    const checked = checkSettingsPatch(params);
    return checked.ok ? { ok: true, params: checked.patch } : checked;
  },
  'threads.subscribe': channelsRule<'threads.subscribe'>,
  'threads.get': channelsRule<'threads.get'>,
  'threads.search': params => {
    const { query, limit, includeArchived, replacePending } = (params ?? {}) as Record<string, unknown>;
    if (typeof query !== 'string' || query.length > MESSAGE_SEARCH_QUERY_LIMIT)
      return { ok: false, field: 'query', message: `threads.search.query: expected text up to ${MESSAGE_SEARCH_QUERY_LIMIT} characters` };
    if (limit !== undefined && (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > MESSAGE_SEARCH_RESULT_LIMIT))
      return { ok: false, field: 'limit', message: `threads.search.limit: expected a whole number from 1 to ${MESSAGE_SEARCH_RESULT_LIMIT}` };
    if (includeArchived !== undefined && typeof includeArchived !== 'boolean')
      return { ok: false, field: 'includeArchived', message: 'threads.search.includeArchived: expected a boolean' };
    if (replacePending !== undefined && typeof replacePending !== 'boolean')
      return { ok: false, field: 'replacePending', message: 'threads.search.replacePending: expected a boolean' };
    return { ok: true, params: params as RpcMethods['threads.search']['params'] };
  },
};

/** The params a handler receives, or the field the method's rule refuses. */
export function checkRpcParams(method: string, params: unknown): RpcParamsCheck {
  const rule = Object.hasOwn(RPC_PARAMS, method) ? RPC_PARAMS[method as RpcMethodName] : undefined;
  return rule ? rule(params) : { ok: true, params };
}
