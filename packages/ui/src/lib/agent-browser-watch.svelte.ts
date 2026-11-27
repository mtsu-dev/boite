import type { Store } from './store.svelte';
import { rightPanel } from './right-panel.svelte';
import { liveViews } from './live-view.svelte';

export function showAgentBrowser(store: Store, threadId: string): void {
  const key = store.threadKey(threadId);
  liveViews.show('agent-browser', key);
  const panel = rightPanel.for(key);
  const tab = panel.surfaces.find(surface => surface.kind === 'agent-browser');
  if (tab) panel.activate(tab.id);
  else panel.open('agent-browser');
  if (matchMedia('(max-width: 720px)').matches) store.sidebarOpen = false;
}

/** Reports background activity. An explicit show request opens the live tab. */
export function watchAgentBrowser(store: Store, threadId: string, onlive: (live: boolean) => void = () => {}, onshow?: () => void): () => void {
  const client = store.client;
  if (!client) return () => {};
  let received = false, stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const off = client.on('browser.remoteChanged', (event) => {
    if (event.threadId !== threadId) return;
    received = true;
    onlive(event.live);
    if (event.show && event.live) {
      onshow?.();
      showAgentBrowser(store, threadId);
    }
  });
  // The subscription to a conversation just opened may still be on its way.
  const ask = (attempt: number) => {
    void client.call('browser.remoteStatus', { threadId }).then(
      ({ live }) => { if (!stopped && !received) onlive(live); },
      () => { if (!stopped && attempt < 4) retry = setTimeout(() => ask(attempt + 1), 1000); }
    );
  };
  ask(0);
  return () => { stopped = true; clearTimeout(retry); off(); };
}

export function agentBrowserActivity(current: () => Store, onshow: () => void) {
  let live = $state(false);
  const threadId = $derived(current().openThread?.id);

  $effect(() => {
    const store = current();
    void store.connection;
    live = false;
    if (threadId && store.client?.state === 'ready') {
      return watchAgentBrowser(store, threadId, value => { live = value; }, onshow);
    }
  });

  return {
    get background() {
      if (!live) return false;
      const store = current();
      const panel = store.panel;
      return !(panel.isOpen && panel.active?.kind === 'agent-browser'
        && (store.localCore || liveViews.shown('agent-browser', store.threadKey(threadId ?? ''))));
    },
    open() {
      if (threadId) showAgentBrowser(current(), threadId);
    },
  };
}
