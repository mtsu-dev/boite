import type { Timestamp } from './ids';

/**
 * What a pairing link hands over. `device` is the guest a phone is, held to
 * `DEVICE_METHODS`. `owner` is another computer of the owner's driving a core
 * that runs elsewhere, a server say: its session key says hello as `owner` and
 * reaches every method, and it is still a row `sessions.revoke` can take away.
 */
export type PairingRole = 'device' | 'owner';

/** One paired client, as `sessions.list` shows it. The token itself is never listed. */
export interface PairedSession {
  id: string;
  client: { name: string; version: string };
  role: PairingRole;
  createdAt: Timestamp;
  lastSeenAt: Timestamp;
  /** True on the connection that asked. */
  current: boolean;
  /** The group handed this key over: the client paired with another member. Revoking it there revokes it everywhere. */
  group?: boolean;
}

/**
 * A one-time pairing link. The grant inside it is exchanged once, within
 * `expiresAt`, for a session token of the client's own; the core token never
 * leaves the machine. A grant that was used or that expired is refused by name.
 */
export interface PairingGrant {
  url: string;
  grant: string;
  role: PairingRole;
  expiresAt: Timestamp;
}

/**
 * Where `tailscale serve` stands for this core. `missing`: no CLI. `stopped`
 * and `needs-login`: Tailscale is off or signed out. `https-disabled`: the
 * tailnet has no HTTPS certificates (admin console, DNS page). `off`: ready,
 * nothing served on 443. `on`: 443 proxies to this core. `conflict`: 443
 * already proxies to something else, left alone unless asked to replace it.
 * `error`: the CLI answered something unreadable, `detail` says which step.
 */
export type TailscaleState = 'missing' | 'stopped' | 'needs-login' | 'https-disabled' | 'off' | 'on' | 'conflict' | 'error';

export interface TailscaleStatus {
  state: TailscaleState;
  /** MagicDNS name of this machine, without the trailing dot; null when unknown. */
  dnsName: string | null;
  /** `https://<dnsName>` once HTTPS can be served, null otherwise. */
  url: string | null;
  /** What 443 proxies to now, when something does. */
  servedTarget: string | null;
  /** The local address `tailscale serve` should proxy to. */
  target: string;
  /** True when settings.publicUrl is `url`. */
  publicUrlMatches: boolean;
  /** A safe label for an error or a refusal, never raw CLI output. */
  detail?: 'not-logged-in' | 'permission-denied' | 'timeout' | 'serve-consent' | 'unknown';
  /** A Tailscale page to open to fix the state (login, enabling serve). */
  actionUrl?: string;
}

/** A Windows network category, as the firewall profiles name them. */
export type NetworkCategory = 'public' | 'private' | 'domain';

/**
 * Whether Windows Defender Firewall lets a phone reach this core. Only Windows
 * answers anything but `unsupported`, and only private networks count: Boite
 * never opens on a public network or a work domain. `ready`: the private
 * network this machine is on allows the core's inbound connections, or it is
 * on no network but Tailscale's. `unset`: no rule covers private networks yet,
 * so `firewall.allow` asks for one. `blocked`: a rule blocks it there, which
 * wins over any rule that allows it, the block rules a dismissed prompt leaves
 * included. `public`: it is on public or domain networks only, where Windows
 * keeps the core closed and no prompt is asked; marking the network private
 * in Windows settings opens it. `error`: Windows could not be read, `detail`
 * says why.
 */
export type FirewallState = 'unsupported' | 'ready' | 'unset' | 'blocked' | 'public' | 'error';

export interface FirewallStatus {
  state: FirewallState;
  /** The categories of the networks this machine is on now. Tailscale's own adapter is left out: Tailscale opens it itself. */
  networks: NetworkCategory[];
  /** `private` when the core's inbound connections are allowed on the private network it is on. */
  allowed: NetworkCategory[];
  /** `private` when a rule blocks them on the private network it is on. */
  blocked: NetworkCategory[];
  /** `cancelled`: nobody accepted Windows' administrator prompt. */
  detail?: 'cancelled' | 'timeout' | 'unknown';
}

export interface PairingRpcMethods {

  /** A fresh one-time pairing link, `device` unless the role says otherwise. Owner only. */
  'pairing.grant': { params: { role?: PairingRole }; result: PairingGrant };
  /** Tailscale CLI and `tailscale serve` state for this core. Owner only. */
  'tailscale.status': { params: Record<string, never>; result: TailscaleStatus };
  /** Serve this core on https://<MagicDNS name> and make it the public URL. `replace` takes 443 from another target. Owner only. */
  'tailscale.enable': { params: { replace?: boolean }; result: TailscaleStatus };
  /** Stop serving this core through Tailscale and clear the public URL it set. Owner only. */
  'tailscale.disable': { params: Record<string, never>; result: TailscaleStatus };
  /** Whether Windows Defender Firewall lets other devices reach this core. Owner only. */
  'firewall.status': { params: Record<string, never>; result: FirewallStatus };
  /** Allow this core through Windows Defender Firewall on private networks, after Windows' administrator prompt. Owner only. */
  'firewall.allow': { params: Record<string, never>; result: FirewallStatus };
}
