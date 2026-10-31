<script lang="ts">
  import { ArrowLeftRight, MessageSquare, ShieldAlert } from '@lucide/svelte';
  import type { ContactRelation } from '@boite/contracts';
  import { agentDirectory } from '../../lib/agent-directory.svelte';
  import { confirm } from '../../lib/confirm.svelte';
  import type { ContactsView } from '../../lib/contacts.svelte';
  import { ago, count } from '../../lib/format';
  import { fill, strings } from '../../lib/strings';
  import BuiltinBadge from '../agents/BuiltinBadge.svelte';
  import InfoTip from '../InfoTip.svelte';

  /**
   * The Operator on the Contacts page: a link to the bot, the threads it put
   * in touch with a contact's, each with an End, and the flags it still has to
   * decide. Flags are the bot's to settle: the page shows them and opens its
   * conversation, nothing more.
   */
  let { view, now }: { view: ContactsView; now: number } = $props();
  const labels = $derived(strings.contacts.bot);
  const store = $derived(view.store);
  const data = $derived(view.state);
  const bot = $derived(data?.bot ?? null);
  const name = $derived((bot && agentDirectory(store).agents.find(agent => agent.id === bot.agentId)?.name) || strings.agents.builtin.name.contacts);
  const relations = $derived(data?.relations ?? []);
  const flags = $derived((data?.flags ?? []).filter(flag => flag.status === 'open'));

  function openThread(threadId: string) {
    store.showChat();
    void store.open(threadId);
  }
  function threadOf(threadId: string | undefined, relationId: string | undefined): string {
    const relation = relations.find(entry => entry.id === relationId || (threadId && entry.local.threadId === threadId));
    return relation?.local.title ?? store.threads.find(thread => thread.id === threadId)?.title ?? '';
  }
  async function end(relation: ContactRelation) {
    const words = { thread: relation.local.title, contact: relation.contact, remote: relation.remote.title };
    if (!await confirm.ask({ title: labels.endTitle, body: fill(labels.endBody, words), confirmLabel: labels.end, cancelLabel: strings.common.cancel, danger: true })) return;
    await view.cutRelation(relation.id);
  }
</script>

{#if bot || relations.length || flags.length}
  <section class="card operator" data-testid="home-bot">
    <h2 class="ui-label-box">
      <span class="ui-label">{name}</span><BuiltinBadge /><InfoTip topic={name} text={labels.tip} />
      {#if bot}<button type="button" class="ghost small open" title={fill(labels.openTip, { name })} onclick={() => store.showAgents(bot.agentId)} data-testid="home-bot-open"><MessageSquare size={14} strokeWidth={1.75} /><span class="ui-label">{labels.open}</span></button>{/if}
    </h2>

    <div class="group" data-testid="home-relations">
      <h3 class="ui-label-box"><span class="ui-label">{labels.relations}</span><InfoTip topic={labels.relations} text={labels.relationsTip} /></h3>
      {#each relations as relation (relation.id)}
        <div class="row relation" data-testid="contact-relation-{relation.id}">
          <button type="button" class="ghost local" title={relation.local.title} onclick={() => openThread(relation.local.threadId)}><span>{relation.local.title}</span></button>
          <ArrowLeftRight size={14} strokeWidth={2} aria-hidden="true" />
          <span class="remote"><strong>{relation.contact}</strong><span>{relation.remote.title}</span></span>
          <button type="button" class="danger small" disabled={view.isBusy(`relation:${relation.id}`)} aria-label={fill(labels.endLabel, { thread: relation.local.title, contact: relation.contact })} onclick={() => void end(relation)} data-testid="contact-relation-end-{relation.id}">{labels.end}</button>
        </div>
      {:else}
        <p class="hint">{labels.none}</p>
      {/each}
    </div>

    {#if flags.length}
      <div class="group" data-testid="home-flags">
        <h3 class="ui-label-box"><span class="ui-label">{labels.flags}</span><InfoTip topic={labels.flags} text={labels.flagsTip} /><span class="count">{fill(labels.openFlags, { count: count(flags.length) })}</span></h3>
        {#each flags as flag (flag.id)}
          {@const thread = threadOf(flag.threadId, flag.relationId)}
          <div class="row flag" data-testid="contact-flag-{flag.id}" data-kind={flag.kind}>
            <span class="kind"><ShieldAlert size={12} strokeWidth={2} aria-hidden="true" />{labels.kind[flag.kind]}</span>
            <span class="line">
              <span class="reason">{flag.reason}</span>
              <span class="sub">{[flag.contact, thread].filter(Boolean).join(' · ')} · <time datetime={new Date(flag.at).toISOString()}>{ago(flag.at, now)}</time></span>
            </span>
            {#if bot}<button type="button" class="ghost small" title={fill(labels.openTip, { name })} onclick={() => openThread(bot.threadId)} data-testid="contact-flag-open-{flag.id}">{labels.open}</button>{/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .operator h2 { display: flex; align-items: center; gap: 8px; }
  .operator h2 .open { margin-left: auto; }
  .group { display: grid; gap: 2px; }
  .group + .group { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--color-border); }
  h3 { display: flex; align-items: center; gap: 4px; margin: 0 0 4px; color: var(--color-muted-foreground); font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
  .row { display: flex; align-items: center; gap: 10px; min-height: var(--row); min-width: 0; }
  .relation > :global(svg) { flex: none; color: var(--color-subtle); }
  .local { flex: 0 1 auto; min-width: 0; max-width: 45%; padding: 0 8px; font-weight: 600; }
  .local span, .remote span, .reason, .sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .remote { display: flex; flex: 1; align-items: baseline; gap: 6px; min-width: 0; font-size: var(--text-sm); }
  .remote strong { flex: none; }
  .remote span { color: var(--color-muted-foreground); }
  .row > button:last-child { flex: none; }
  .kind { display: inline-flex; flex: none; align-items: center; gap: 4px; padding: 2px 8px; border-radius: var(--radius-full); background: color-mix(in oklch, var(--color-danger) 14%, transparent); color: var(--color-danger); font-size: var(--text-xs); font-weight: 600; }
  .flag[data-kind='review'] .kind, .flag[data-kind='boundary'] .kind { background: var(--color-surface-3); color: var(--color-muted-foreground); }
  .line { display: grid; flex: 1; gap: 1px; min-width: 0; padding: 6px 0; }
  .reason { font-size: var(--text-sm); }
  .sub { color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .count { margin-left: 4px; padding: 1px 8px; border-radius: var(--radius-full); background: color-mix(in oklch, var(--color-danger) 14%, transparent); color: var(--color-danger); text-transform: none; letter-spacing: 0; }
  @media (max-width: 720px) {
    .relation { flex-wrap: wrap; row-gap: 2px; padding: 6px 0; }
    .local { max-width: 100%; }
    .row > button:last-child { min-height: var(--touch-target); }
  }
</style>
