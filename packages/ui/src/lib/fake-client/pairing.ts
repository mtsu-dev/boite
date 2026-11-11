/** Pairing grants, paired sessions, the Tailscale switch and the Web Push the fake refuses. */
import { GRANT_TTL_MS, RpcErrorCode, type TailscaleStatus } from '@boite/contracts';
import { RpcFailure } from '../client';
import type { FakeContext, FakeMethods } from './context';
import { refreshOwnCard } from './group';
import { FAKE_LAN } from './lan';

/** A tailnet ready to serve the fake core: nothing on 443 yet. */
function fakeTailscale(): TailscaleStatus {
  const dnsName = 'boite-pc.tail0d6070.ts.net';
  return { state: 'off', dnsName, url: `https://${dnsName}`, servedTarget: null, target: 'http://127.0.0.1:8777', publicUrlMatches: false };
}

export function pairingMethods(ctx: FakeContext) {
  let tailscale = fakeTailscale();
  const setPublicUrl = (publicUrl: string | null) => {
    ctx.settings = { ...ctx.settings, publicUrl };
    ctx.emit('settings.updated', structuredClone(ctx.settings));
  };
  return {
    'pairing.grant': async (params) => {
      const seq = ++ctx.seq;
      const grant = `fake-grant-${seq}`;
      const role = params?.role ?? 'device';
      const expiresAt = ctx.now() + GRANT_TTL_MS;
      // `?lan=off` is a fresh install: the core listens on itself until the setting is on.
      const lanOff = typeof location !== 'undefined' && new URLSearchParams(location.search).get('lan') === 'off' && !ctx.settings.listenOnLan;
      const origin = ctx.settings.publicUrl ?? (lanOff ? 'http://127.0.0.1:8777' : FAKE_LAN);
      return {
        url: `${origin}/?grant=${grant}`,
        grant,
        role,
        expiresAt
      };
    },
    'tailscale.status': async () => ({ ...tailscale, publicUrlMatches: ctx.settings.publicUrl === tailscale.url }),
    'tailscale.enable': async (params) => {
      if (tailscale.state === 'conflict' && params?.replace !== true) return tailscale;
      if (tailscale.state === 'off' || tailscale.state === 'conflict') tailscale = { ...tailscale, state: 'on', servedTarget: tailscale.target };
      if (tailscale.state === 'on') setPublicUrl(tailscale.url);
      return { ...tailscale, publicUrlMatches: tailscale.state === 'on' };
    },
    'tailscale.disable': async () => {
      if (tailscale.state === 'on') {
        tailscale = { ...tailscale, state: 'off', servedTarget: null };
        if (ctx.settings.publicUrl === tailscale.url) setPublicUrl(null);
      }
      return { ...tailscale, publicUrlMatches: false };
    },
    'firewall.status': async () => {
      // The real core hears every reading: a network marked private in Windows settings opens its LAN listener.
      refreshOwnCard(ctx);
      return structuredClone(ctx.firewall);
    },
    'firewall.allow': async () => {
      if (ctx.firewallRefuses) return { ...structuredClone(ctx.firewall), detail: 'cancelled' as const };
      if (ctx.firewall.state === 'blocked' || ctx.firewall.state === 'unset') {
        ctx.firewall = { ...ctx.firewall, state: 'ready', allowed: ['private'], blocked: [] };
        // A grouped core opens its LAN listener once the private rule is in, as the real one does.
        refreshOwnCard(ctx);
      }
      return structuredClone(ctx.firewall);
    },
    'sessions.list': async (params) => {
      if (ctx.bus.principal === 'owner') return structuredClone(ctx.sessions);
      // A paired device sees its own row only, marked current, as on the real core. The fake has no
      // caller session, so the paired phone of the fixture stands for it.
      const own = ctx.sessions.find(session => session.role !== 'owner');
      return structuredClone(own === undefined ? [] : [{ ...own, current: true }]);
    },
    'push.status': async (params) => {
      return { publicKey: '', subscribed: false };
    },
    'push.subscribe': async (params) => {
      throw new RpcFailure({ code: RpcErrorCode.Refused, message: 'Web Push needs a paired connection to a real core' });
    },
    'push.unsubscribe': async (params) => {
      throw new RpcFailure({ code: RpcErrorCode.Refused, message: 'Web Push needs a paired connection to a real core' });
    },
    'push.test': async (params) => {
      throw new RpcFailure({ code: RpcErrorCode.Refused, message: 'Web Push needs a paired connection to a real core' });
    },
    'push.kinds': async (params) => {
      throw new RpcFailure({ code: RpcErrorCode.Refused, message: 'Web Push needs a paired connection to a real core' });
    },
    'sessions.revoke': async (params) => {
      if (!ctx.sessions.some((session) => session.id === params.sessionId)) {
        throw new RpcFailure({ code: RpcErrorCode.Refused, message: `unknown session ${params.sessionId}` });
      }
      ctx.sessions = ctx.sessions.filter((session) => session.id !== params.sessionId);
      ctx.emit('sessions.updated', { sessionId: params.sessionId, state: 'revoked' });
      return { ok: true };
    },
  } satisfies Partial<FakeMethods>;
}
