<script lang="ts">
  import { Check, ChevronDown, ChevronRight, Clock, Forward, MessageCircleQuestion, Reply, X } from '@lucide/svelte';
  import { agentDirectory } from '../lib/agent-directory.svelte';
  import { askAddress, askDiscussion, contactsBotFace, type ContactAsk } from '../lib/contact-asks';
  import type { AgentMail } from '../lib/agent-mail';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import AgentAvatar from './AgentAvatar.svelte';
  import RemoteChip from './RemoteChip.svelte';

  /**
   * A contact request where it happened, in the style of an agent mail row.
   * The asking thread sees the Contacts bot it asked, the contact once one is
   * named, its words on one line and where the request stands now; the bot's
   * own thread sees what it forwarded and what it settled. A row whose answer
   * reached this thread opens that discussion in the panel; any other row
   * unfolds to the whole request.
   */
  let { store, ask, mail }: { store: Store; ask: ContactAsk; mail: readonly AgentMail[] } = $props();
  const labels = $derived(strings.agentMessages.ask);
  const request = $derived(ask.request);
  let open = $state(false);

  /** The bot on this machine, else on the group's Bots machine while this window reaches it. */
  const host = $derived(store.group?.botsHome ? workspace.machinesOr(store).map(machine => machine.store).find(other => other !== store && other.group?.self === store.group?.botsHome) : undefined);
  const bot = $derived(contactsBotFace([agentDirectory(store).snapshot?.profiles, host ? agentDirectory(host).snapshot?.profiles : undefined], strings.agents.builtin.name.contacts));
  const machine = $derived(store.group?.cores?.find(core => core.coreId === store.group?.botsHome)?.name ?? '');
  const discussion = $derived(askDiscussion(ask, mail));
  const address = $derived(askAddress(request));

  const title = $derived(ask.role === 'asked' ? bot.name : request.from.title);
  const kicker = $derived(labels[ask.role]);
  const tone = $derived(ask.state === 'answered' ? 'done' : ask.state === 'refused' ? 'refused' : 'waiting');
  const status = $derived.by(() => {
    switch (ask.state) {
      case 'host': return machine ? fill(labels.host, { machine }) : labels.hostUnnamed;
      case 'bot': return fill(labels.bot, { bot: bot.name });
      case 'owner': return labels.owner;
      case 'sent': return request.contact ? fill(labels.sent, { contact: request.contact }) : labels.sentUnnamed;
      case 'refused': return request.reason ? fill(labels.refused, { reason: request.reason }) : labels.refusedPlain;
      case 'answered':
        if (ask.role === 'settled') return request.relation ? fill(labels.linked, { thread: request.relation.local.title }) : request.project ? fill(labels.shared, { project: request.project.name }) : labels.answered;
        if (address) return labels.touch;
        return request.project ? fill(labels.opened, { contact: request.contact, project: request.project.name }) : labels.answered;
    }
  });

  function activate(): void {
    if (discussion) store.panel.openMessages(discussion.peer, discussion.letterId);
    else open = !open;
  }
</script>

<button type="button" class="ask {ask.role}" class:open data-testid="contact-ask-row" data-role={ask.role} data-state={ask.state} data-request={request.id}
  aria-expanded={discussion ? undefined : open} title={discussion ? labels.openAnswer : open ? labels.collapse : labels.expand} onclick={activate}>
  {#if ask.role === 'asked'}
    <AgentAvatar title={bot.name} resident agent={bot.agent} size={22} />
  {:else}
    <AgentAvatar title={request.from.title} providerId={request.from.agent?.split(/\s+/)[0]} size={22} />
  {/if}
  <span class="body">
    <span class="top">
      <span class="kicker" data-testid="contact-ask-kicker">
        {#if ask.role === 'asked'}<MessageCircleQuestion size={13} strokeWidth={2} aria-hidden="true" />
        {:else if ask.role === 'forwarded'}<Forward size={13} strokeWidth={2} aria-hidden="true" />
        {:else}<Reply size={13} strokeWidth={2} aria-hidden="true" />{/if}
        <span>{kicker}</span>
      </span>
      <strong class="title" data-testid="contact-ask-title">{title}</strong>
      {#if request.contact}<RemoteChip name={request.contact} />{/if}
    </span>
    <span class="words" class:whole={open} data-testid="contact-ask-words">{request.text}</span>
    <span class="status {tone}" data-testid="contact-ask-status">
      {#if tone === 'done'}<Check size={12} strokeWidth={2.25} aria-hidden="true" />
      {:else if tone === 'refused'}<X size={12} strokeWidth={2.25} aria-hidden="true" />
      {:else}<Clock size={12} strokeWidth={2} aria-hidden="true" />{/if}
      <span class="text">{status}</span>
      {#if ask.state === 'answered' && ask.role === 'asked' && address}<code class="address" data-testid="contact-ask-address">{address}</code>{/if}
    </span>
    {#if open}
      <span class="more" data-testid="contact-ask-more">
        {#if request.want}<span>{labels.want[request.want]}</span>{/if}
        {#if ask.role !== 'asked'}<span>{request.from.title}</span>{/if}
        <span class="id">{labels.id} {request.id}</span>
      </span>
    {/if}
  </span>
  {#if discussion}<ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />{:else}<ChevronDown class="caret" size={14} strokeWidth={1.75} aria-hidden="true" />{/if}
</button>

<style>
  .ask {
    display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 10px;
    width: min(100%, 560px); height: auto; min-height: var(--control); padding: 6px 10px 6px 8px;
    border: 1px solid var(--color-border); border-radius: var(--radius-lg); border-bottom-left-radius: var(--radius-sm); background: var(--color-surface-2);
    color: var(--color-muted-foreground); box-shadow: var(--shadow-e1); text-align: left; font-size: var(--text-sm); white-space: normal;
    transition: background var(--dur-1) var(--ease-out-quint), border-color var(--dur-1) var(--ease-out-quint), transform var(--dur-1) var(--ease-out-quint);
  }
  .ask:hover { background: var(--color-surface-3); border-color: var(--color-edge); color: var(--color-foreground); }
  .ask:active { transform: scale(0.99); }
  .ask > :global(svg) { align-self: center; }
  .ask :global(.caret) { transition: transform var(--dur-1) var(--ease-out-quint); }
  .ask.open :global(.caret) { transform: rotate(180deg); }
  .body { min-width: 0; display: grid; gap: 2px; }
  .top { min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 6px; }
  .kicker { flex: none; display: inline-flex; align-items: center; align-self: center; gap: 5px; color: var(--color-muted-foreground); font-size: var(--text-xs); font-weight: 600; }
  .kicker :global(svg) { flex: none; }
  .title { flex: 0 1 auto; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-foreground); font-weight: 600; }
  .words { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-xs); }
  .words.whole { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--color-foreground); }
  /* The address the answer gave goes under its label when both do not fit: never two clipped halves. */
  .status { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 5px; font-size: var(--text-xs); font-weight: 500; }
  .status :global(svg) { flex: none; }
  .status .text { flex: 0 1 auto; min-width: 0; max-width: calc(100% - 17px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status.waiting :global(svg) { color: var(--color-live); }
  .status.done :global(svg) { color: var(--color-success); }
  .status.refused :global(svg) { color: var(--color-danger); }
  .status.refused .text { color: var(--color-foreground); }
  .open .status .text { white-space: normal; }
  .address { flex: 0 1 auto; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 5px; border-radius: var(--radius-sm); background: var(--color-surface-3); color: var(--color-foreground); font-family: var(--font-mono); font-size: var(--text-xs); }
  .more { display: flex; flex-wrap: wrap; gap: 2px 10px; padding-top: 2px; font-size: var(--text-xs); }
  .id { font-family: var(--font-mono); }
  @media (max-width: 720px) {
    .ask { width: 100%; min-height: var(--touch-target); }
  }
</style>
