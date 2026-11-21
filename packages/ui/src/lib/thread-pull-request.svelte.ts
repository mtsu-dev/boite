import { untrack } from 'svelte';
import { threadActive, type LinkedPullRequest, type ThreadSummary } from '@boite/contracts';
import type { Store } from './store.svelte';
import { errorText } from './errors';
import { strings } from './strings';
import { lookupPullRequest, PULL_REQUEST_POLL_MS, watchPullRequests, WORKING_PULL_REQUEST_POLL_MS } from './pull-request';
import { cachedPullRequest, rememberPullRequest } from './pull-request-cache';

type PullRequest = NonNullable<ThreadSummary['pullRequest']>;
const summary = (pr: PullRequest): PullRequest => ({ number: pr.number, url: pr.url, state: pr.state });
const selected = (links: LinkedPullRequest[]): PullRequest | null => {
  const pr = links.findLast(pr => pr.state === 'OPEN') ?? links.at(-1);
  return pr ? summary(pr) : null;
};

/** One checkout's badge lifecycle, shared by desktop cards and phone rows. */
export function trackThreadPullRequest(input: () => { owner: Store; thread: ThreadSummary; hidden?: boolean }) {
  let value = $state<PullRequest | null>(null);
  let loading = $state(false);
  let revision = 0;
  let linkSignature: string | undefined;
  let links: LinkedPullRequest[] = [];
  let recheck = false;

  async function refresh(manual = false, reuseFresh = false) {
    const { owner, thread, hidden } = input();
    const client = owner.client;
    if (!client || loading || (!manual && (hidden || owner.connection !== 'ready' || document.hidden))) return;
    const key = checkoutKey;
    const checkedAt = Date.now();
    const held = reuseFresh && !thread.incognito ? cachedPullRequest(key) : undefined;
    if (held && held.checkedAt !== null) {
      const age = checkedAt - held.checkedAt;
      if (age >= 0 && age < cadence) {
        value = held.pullRequest;
        return;
      }
    }
    const requestedRevision = revision;
    const checkout = JSON.stringify([thread.cwd, thread.branch]);
    recheck = false;
    loading = true;
    try {
      const result = await lookupPullRequest(client, thread.id, manual, checkout);
      if (requestedRevision !== revision || recheck) return;
      if (!result.supported) {
        if (manual) owner.error = strings.errors.pullRequestUnsupported;
        return;
      }
      let next = result.pullRequest ?? null;
      // A merge cannot reopen. A watch event wins over an older cached answer,
      // including URLs whose owner/repository casing differs from GitHub's.
      const merged = next && links.find(pr => pr.state === 'MERGED' && pr.url.toLowerCase() === next?.url.toLowerCase());
      if (merged) next = summary(merged);
      if (!thread.incognito) rememberPullRequest(key, next, checkedAt);
      value = next;
    } catch (error) {
      if (requestedRevision === revision && manual) owner.error = errorText(error);
    } finally {
      if (requestedRevision === revision) {
        loading = false;
        // Unlink must wait for the previous deduplicated lookup to settle.
        if (recheck) void refresh();
      }
    }
  }

  // Primitives only: a summary or a full conversation replacing the object with the same
  // checkout must not reset the badge and ask the core again.
  const checkoutKey = $derived.by(() => {
    const { owner, thread } = input();
    const core = owner.core;
    const identity = core?.coreId ?? [owner.machineId, core?.hostname, core?.dataDir];
    return JSON.stringify([identity, thread.id, thread.cwd, thread.branch]);
  });
  const incognito = $derived(input().thread.incognito === true);
  const ready = $derived.by(() => {
    const { owner, hidden } = input();
    return owner.connection === 'ready' && !hidden;
  });
  const active = $derived(threadActive(input().thread.status));
  const cadence = $derived(active ? WORKING_PULL_REQUEST_POLL_MS : PULL_REQUEST_POLL_MS);
  const client = $derived(input().owner.client);
  let previousCheckout: string | undefined;
  let checkoutChanged = false;
  $effect(() => {
    const key = checkoutKey;
    const cached = incognito ? undefined : cachedPullRequest(key);
    const live = ready;
    const connected = client;
    untrack(() => {
      checkoutChanged ||= previousCheckout !== undefined && previousCheckout !== key;
      previousCheckout = key;
      value = cached?.pullRequest ?? null;
      loading = false;
      links = [];
      linkSignature = undefined;
      recheck = false;
      if (live && connected) {
        void refresh(false, !checkoutChanged);
        checkoutChanged = false;
      }
    });
    return () => { revision++; };
  });
  $effect(() => {
    const connected = client;
    if (!connected || !ready) return;
    return watchPullRequests(connected, () => void refresh(), cadence);
  });
  $effect(() => {
    const { owner, thread, hidden } = input();
    const client = owner.client;
    const threadId = thread.id;
    if (!client || hidden) return;
    return client.on('threads.pullRequestsChanged', event => {
      if (event.threadId !== threadId) return;
      const signature = JSON.stringify(event.pullRequests.map(pr => [pr.url.toLowerCase(), pr.state]));
      // list refreshes also emit events. Identical state must not invalidate
      // every RPC that goes on to discover a new automatic PR.
      if (signature === linkSignature) return;
      linkSignature = signature;
      links = event.pullRequests;
      value = selected(links);
      if (!thread.incognito) rememberPullRequest(checkoutKey, value);
      // An event can remove just one of several links. Wait for the old
      // deduplicated lookup, then read the current membership once more.
      if (loading) recheck = true;
      else if (!links.length) void refresh();
    });
  });
  // A turn that ended may have opened a pull request; one that starts has not yet, and the
  // working cadence asks while it runs.
  let wasActive: boolean | undefined;
  $effect(() => {
    const now = active;
    untrack(() => {
      if (wasActive === true && !now) void refresh();
      wasActive = now;
    });
  });
  return { get value() { return value; }, get loading() { return loading; }, refresh };
}
