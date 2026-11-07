import type { RpcMethodName, RpcMethods } from './index.ts';
import { checkSettingsPatch } from './settings-validation.ts';
import { streamChannelsProblem } from './stream-channels.ts';

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
};

/** The params a handler receives, or the field the method's rule refuses. */
export function checkRpcParams(method: string, params: unknown): RpcParamsCheck {
  const rule = Object.hasOwn(RPC_PARAMS, method) ? RPC_PARAMS[method as RpcMethodName] : undefined;
  return rule ? rule(params) : { ok: true, params };
}
