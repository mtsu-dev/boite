<script lang="ts">
  import { Puzzle } from '@lucide/svelte';
  import type { PluginState } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { workspace } from '../lib/workspace.svelte';
  import { notifyCorner } from '../lib/notify-corner';
  import { answerPluginUpdate, pluginUpdateOffer, readPluginUpdateAnswers } from '../lib/plugin-update-notice';

  interface Host { id: string; label: string; store: Store }
  interface Notice { key: string; host: Host; plugin: PluginState; version: string }

  /** Tests hand their machines; the app shows the workspace's. */
  let { machines }: { machines?: Host[] } = $props();
  const t = strings.plugins;
  /** More than this at once would bury the thread; the Plugins page lists every update. */
  const MOST = 2;

  let hosts = $derived(machines ?? workspace.machines);
  let lists = $state<Record<string, PluginState[]>>({});
  let answers = $state(readPluginUpdateAnswers());

  /** Only the owner installs plugins: a paired device neither asks for the list nor sees a notice. */
  const owns = (store: Store) => store.connection === 'ready' && store.owner && store.client !== null;

  $effect(() => {
    const offs: (() => void)[] = [];
    for (const host of hosts) {
      const store = host.store;
      // A new connection is a new client: listen again and read the list it now holds.
      void store.clientGeneration;
      if (!owns(store)) continue;
      const client = store.client!;
      const id = host.id;
      offs.push(client.on('plugins.updated', (plugin) => {
        lists[id] = [...(lists[id] ?? []).filter((entry) => entry.id !== plugin.id), plugin];
      }));
      client.call('plugins.list', {}).then((rows) => { lists[id] = rows; }, () => undefined);
    }
    return () => { for (const off of offs) off(); };
  });

  let notices = $derived.by(() => {
    const out: Notice[] = [];
    for (const host of hosts) {
      if (!owns(host.store)) continue;
      for (const plugin of lists[host.id] ?? []) {
        const key = `${host.id}:${plugin.id}`;
        const version = pluginUpdateOffer(plugin, answers, key);
        if (version !== null) out.push({ key, host, plugin, version });
      }
    }
    return out.slice(0, MOST);
  });
  let several = $derived(hosts.length > 1);
  /** Settings would hide their own controls under it, and the Plugins page shows the same update: the notice waits for the conversation. */
  let offChat = $derived(machines === undefined && workspace.active.page !== 'chat');

  /** Either answer is final for this version; the install itself shows on the Plugins page. */
  function answer(notice: Notice, install: boolean) {
    answers = answerPluginUpdate(answers, notice.key, notice.version);
    if (!install) return;
    notice.host.store.client?.call('plugins.install', { id: notice.plugin.id }).catch((cause: unknown) => notice.host.store.reportError(cause));
  }
</script>

{#if notices.length > 0}
  <div class="update-notices notify-corner" class:off-chat={offChat} use:notifyCorner data-testid="plugin-update-notices" role="region" aria-label={t.noticeLabel}>
    {#each notices as notice (notice.key)}
      <article class="notice notify-card" data-tone="quiet" data-testid="plugin-update-notice" data-plugin={notice.plugin.id} data-version={notice.version}>
        <span class="notify-mark" aria-hidden="true"><Puzzle size={16} strokeWidth={1.75} /></span>
        <div class="notify-lines">
          <span class="notify-title">{fill(t.noticeTitle, { name: notice.plugin.name, version: notice.version })}</span>
          <p class="notify-text">{t.noticeBody}{#if several}<span class="sep" aria-hidden="true">{' · '}</span>{notice.host.label}{/if}</p>
          <div class="notify-actions">
            <button type="button" class="small" data-testid="plugin-update-run" onclick={() => answer(notice, true)}>{t.noticeUpdate}</button>
            <button type="button" class="ghost small" data-testid="plugin-update-later" onclick={() => answer(notice, false)}>{t.noticeLater}</button>
          </div>
        </div>
      </article>
    {/each}
  </div>
{/if}

<style>
  /* The notice the agent updates used, in the notification corner: never
     auto-dismissed, leaving only on an answer. App mounts it beside its root,
     under the dialogs (60) and the image viewer (55). */
  .update-notices {
    z-index: 54;
    display: flex;
    flex-direction: column-reverse;
    gap: 8px;
  }

  .notice { animation: rise var(--dur-3) var(--ease-out-quint); }

  /* Settings would hide their own rows under it, and the Plugins page shows the same update. */
  .update-notices.off-chat { display: none; }

  @media (prefers-reduced-motion: reduce) {
    .notice { animation: none; }
  }

  /* A phone shows one at a time. */
  @media (max-width: 720px) {
    .notice:nth-child(n + 2) { display: none; }
  }
</style>
