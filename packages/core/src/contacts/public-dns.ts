/*
 * The public addresses of a Tailscale Funnel name, asked of the servers that
 * hold the `ts.net` zone themselves.
 *
 * Tailscale publishes a Funnel name minutes after Funnel is turned on. A
 * resolver asked before that keeps "no such name" for the zone's negative
 * TTL, 300 seconds (read off `ts.net`'s SOA on 2026-11-10): a host that
 * checks its own name through a public resolver, or a guest that joins too
 * early, then waits five more minutes after the name exists, and every later
 * question to that resolver finds the same stale answer. The zone's own
 * servers keep nothing: they know the name the moment it is published.
 */

const ZONE = 'ts.net';
const SERVERS_TTL_MS = 3_600_000;
const QUERY_TIMEOUT_MS = 2_000;
let servers: { at: number; addresses: string[] } | null = null;

/** Whether `host` is a name Tailscale publishes for Funnel. */
export function isFunnelName(host: string): boolean { return host.toLowerCase().endsWith(`.${ZONE}`); }

async function zoneServers(): Promise<string[]> {
  if (servers !== null && Date.now() - servers.at < SERVERS_TTL_MS) return servers.addresses;
  // The zone itself is asked of the system's resolver: it exists, so nothing negative is cached.
  // Loaded when a name is first asked: the core starts without node:dns.
  const { resolve4, resolveNs } = await import('node:dns/promises');
  const names = await resolveNs(ZONE);
  const addresses = (await Promise.all(names.slice(0, 4).map(name => resolve4(name).catch(() => [] as string[])))).flat();
  if (addresses.length === 0) throw new Error(`no address for the name servers of ${ZONE}`);
  servers = { at: Date.now(), addresses };
  return addresses;
}

/**
 * The public IPv4 addresses of a Funnel name: `[]` when the zone does not
 * know it yet, null when its servers could not be asked (no UDP to them, or
 * a name outside `ts.net`).
 */
export async function funnelAddresses(host: string): Promise<string[] | null> {
  if (!isFunnelName(host)) return null;
  try {
    const asked = await zoneServers();
    const { Resolver } = await import('node:dns/promises');
    const resolver = new Resolver({ timeout: QUERY_TIMEOUT_MS, tries: 2 });
    resolver.setServers(asked);
    return await resolver.resolve4(host);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') return [];
    return null;
  }
}

/** A name DNS does not know, as Bun's fetch, Node's resolver and `TextSocket` report it. */
export function nameNotFound(error: unknown): boolean {
  const code = (value: unknown) => (value as { code?: unknown } | null)?.code;
  return code(error) === 'ENOTFOUND' || code((error as { cause?: unknown } | null)?.cause) === 'ENOTFOUND'
    || (error instanceof Error && /\bENOTFOUND\b/.test(error.message));
}

/** The zone's answer for a name the system's resolver does not know; tests replace `resolve`. */
export const publicDns = { resolve: funnelAddresses };

/**
 * The address to reach `origin` at when the system's resolver said "no such
 * name" and the zone's own servers know it: the resolver still holds the
 * answer it got before Tailscale published the name. Null when the zone does
 * not know it either, or could not be asked.
 */
export async function publishedAddress(origin: string): Promise<string | null> {
  const url = new URL(origin);
  if (url.protocol !== 'https:' && url.protocol !== 'wss:') return null;
  return (await publicDns.resolve(url.hostname))?.[0] ?? null;
}

/**
 * `fetch` of a Funnel origin that does not wait on a resolver's stale "no
 * such name": asked again at the address the zone gives, the TLS name and the
 * certificate check still the origin's own.
 */
export async function funnelFetch(url: string, init: RequestInit, timeoutMs: number, send: typeof fetch = fetch): Promise<Response> {
  try { return await send(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (error) {
    if (!nameNotFound(error)) throw error;
    const target = new URL(url);
    const address = await publishedAddress(url);
    if (address === null) throw error;
    const host = target.hostname;
    target.hostname = address;
    return send(target.href, {
      ...init, signal: AbortSignal.timeout(timeoutMs),
      headers: { ...(init.headers as Record<string, string> | undefined), host: new URL(url).host },
      // Bun's own option: the name the certificate is checked against, in place of the address.
      tls: { serverName: host },
    } as RequestInit);
  }
}
