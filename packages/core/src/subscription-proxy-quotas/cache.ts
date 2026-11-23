import { subscriptionProxyOf, type AccountQuota, type GatewayQuotaEntry, type GatewayQuotaProvider, type SubscriptionProxy, type SubscriptionProxyQuotas } from '@boite/contracts';
import type { Core } from '../core.ts';
import { proxyKey } from '../subscription-proxy.ts';
import { ensureLocalProxyKey } from '../subscription-proxy-auth.ts';
import { MAX_BYTES } from './decode.ts';
import { fetchGatewayQuotas } from './fetch.ts';
import { gatewayQuotaRows } from './projection.ts';

/** The native quota cadence: a list within a minute of the last read reuses it. */
const FRESH_MS = 60_000;
const OFF: SubscriptionProxyQuotas = { status: 'off', providers: [], updatedAt: null, checkedAt: null, error: null };

function keepReading(entry: GatewayQuotaEntry, previous: GatewayQuotaEntry | undefined): GatewayQuotaEntry {
  if (!previous || (entry.error === null && entry.status !== 'error')) return entry;
  const keepWindows = !entry.windows.length && previous.windows.length > 0;
  const keepCredits = !entry.credits.length && previous.credits.length > 0;
  if (!keepWindows && !keepCredits) return entry;
  // An error carrying no reading cannot give the retained data a new timestamp.
  const updatedAt = entry.windows.length || entry.credits.length ? entry.updatedAt ?? previous.updatedAt : previous.updatedAt;
  return {
    ...entry, updatedAt,
    windows: keepWindows ? previous.windows : entry.windows,
    credits: keepCredits ? previous.credits : entry.credits,
  };
}

/** Failed entries can omit their readings. Match only entries of the same provider and display mode. */
function keepReadings(providers: GatewayQuotaProvider[], previous: GatewayQuotaProvider[]): GatewayQuotaProvider[] {
  const byProvider = new Map(previous.map((provider) => [provider.providerId, provider]));
  return providers.map((provider) => {
    const last = byProvider.get(provider.providerId);
    if (last?.display !== provider.display) return provider;
    const byEntry = new Map(last.entries.map((entry) => [entry.id, entry]));
    return { ...provider, entries: provider.entries.map((entry) => keepReading(entry, byEntry.get(entry.id))) };
  });
}

/**
 * The gateway's quotas as the core last read them. Every client, a phone or
 * another machine, gets them from here: the gateway is reached from the core
 * only, with the key that never leaves it.
 */
export class GatewayQuotas {
  private last: SubscriptionProxyQuotas = { ...OFF, status: 'unavailable' };
  private readAt = 0;
  private pending: Promise<SubscriptionProxyQuotas> | null = null;
  private pendingRefresh = false;
  /** The proxy configuration `last` belongs to; another one starts over. */
  private config: string;
  private epoch = 0;

  /** `onReset` tells the quota store, whose `quotas.updated` still carries the dropped rows. */
  constructor(private core: Core, private max = MAX_BYTES, private onReset: () => void = () => {}) {
    this.config = JSON.stringify(core.settings.get().subscriptionProxy ?? null);
    core.bus.onAny((name) => { if (name === 'settings.updated') this.reconfigure(); });
  }

  private proxy(): SubscriptionProxy | null {
    const proxy = this.core.settings.get().subscriptionProxy;
    return proxy?.enabled ? proxy : null;
  }

  private reconfigure(): void {
    const config = JSON.stringify(this.core.settings.get().subscriptionProxy ?? null);
    if (config === this.config) return;
    this.config = config;
    this.reset();
  }

  /**
   * Forgets the answer and any read in flight: the proxy changed, or its key,
   * which lives outside settings. Clients drop the old rows at once.
   */
  reset(): void {
    this.epoch++;
    this.pending = null;
    this.pendingRefresh = false;
    this.readAt = 0;
    this.last = { ...OFF, status: 'unavailable' };
    this.core.bus.emit('subscriptionProxy.quotasUpdated', this.state());
    this.checkMuseAccounts();
    this.onReset();
  }

  /** A newly discovered Meta pool changes Muse's login state without touching its native sign-in. */
  private checkMuseAccounts(): void {
    if (subscriptionProxyOf(this.core.settings.get(), { id: 'muse', protocol: 'muse' }, this.state())) this.core.accounts.ensureDefaults();
    for (const account of this.core.accounts.list()) {
      if (account.providerId === 'muse') this.core.accounts.check(account.id);
    }
  }

  /** What is known without asking the gateway. */
  state(): SubscriptionProxyQuotas {
    const proxy = this.proxy();
    if (!proxy) return OFF;
    if (proxy.kind !== 'douane') return { ...OFF, status: 'unsupported' };
    return this.last;
  }

  async read(refresh = false): Promise<SubscriptionProxyQuotas> {
    const proxy = this.proxy();
    if (!proxy || proxy.kind !== 'douane') return this.state();
    if (this.pending) {
      if (!refresh || this.pendingRefresh) return this.pending;
      const epoch = this.epoch;
      await this.pending;
      if (epoch !== this.epoch) return this.state();
      return this.read(true);
    }
    if (!refresh && this.readAt && Date.now() - this.readAt < FRESH_MS) return this.last;
    const epoch = this.epoch;
    const running = (async () => {
      let next: SubscriptionProxyQuotas;
      try {
        await ensureLocalProxyKey(this.core);
        if (epoch !== this.epoch) return this.state();
        const names = (id: string) => this.core.providers.get(id)?.name ?? null;
        const answer = await fetchGatewayQuotas(proxy, proxyKey(this.core), names, this.max, refresh);
        next = answer
          ? { status: 'ready', ...answer, providers: keepReadings(answer.providers, this.last.providers), checkedAt: Date.now(), error: null }
          : { ...OFF, status: 'unsupported' };
      } catch (error) {
        const good = this.last.checkedAt !== null ? this.last : null;
        next = { status: 'unavailable', providers: good?.providers ?? [], updatedAt: good?.updatedAt ?? null, checkedAt: good?.checkedAt ?? null,
          error: error instanceof Error ? error.message : 'Douane quotas request failed.' };
      }
      if (epoch !== this.epoch) return this.state();
      this.last = next;
      this.readAt = Date.now();
      this.checkMuseAccounts();
      this.core.bus.emit('subscriptionProxy.quotasUpdated', next);
      return next;
    })();
    this.pending = running;
    this.pendingRefresh = refresh;
    try { return await running; } finally {
      if (this.pending === running) { this.pending = null; this.pendingRefresh = false; }
    }
  }

  /** The entries as limit rows, beside every account's own. */
  rows(state = this.state()): AccountQuota[] {
    return gatewayQuotaRows(state);
  }
}
