<script lang="ts">
  import { tick } from 'svelte';
  import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, GitBranch, Waypoints, X } from '@lucide/svelte';
  import type { ContactRequest } from '@boite/contracts';
  import { settledByBot, type ContactsView } from '../../lib/contacts.svelte';
  import { ago, projectName } from '../../lib/format';
  import type { MenuItem } from '../../lib/menu';
  import { fill, strings } from '../../lib/strings';
  import Menu from '../Menu.svelte';
  import ThreadChoice from './ThreadChoice.svelte';

  /**
   * One request between contacts, a row of a Requests card. Waiting on this
   * owner, it carries Accept, which shares a project picked in the app's menu,
   * or, on a request for a thread the Contacts bot settles, lets the bot put the
   * threads in touch (a trusted contact's needs no Accept), and Refuse, which asks for the reason the asking agent will read. Decided, it folds to one line with
   * what came of it and who decided.
   */
  let { view, request, now }: { view: ContactsView; request: ContactRequest; now: number } = $props();
  const labels = $derived(strings.contacts.requests);

  const pending = $derived(request.status === 'pending');
  const mine = $derived(request.direction === 'in');
  const busy = $derived(view.isBusy(`decide:${request.id}`));
  const byBot = $derived(settledByBot(request));
  const items = $derived<MenuItem[]>(view.store.projects
    .filter(project => project.kind !== 'drafts' && !project.archived)
    .map(project => ({ id: project.id, label: projectName(project), projectTile: { project, store: view.store } })));
  /** What came of it: the project shared, or the thread put in touch with the asking one. */
  const outcome = $derived(request.status !== 'accepted' ? labels.refused
    : request.relation && !request.project ? fill(labels.inTouch, { thread: mine ? request.relation.local.title : request.relation.remote.title })
    : fill(labels.accepted, { project: request.project?.name ?? '' }));
  /** The Operator's plan for a contact not trusted: the owner's Accept runs it. */
  const plan = $derived(!request.plan ? '' : request.plan.kind === 'start' ? fill(labels.plan.start, { project: request.plan.project.name })
    : fill(request.plan.project ? labels.plan.connectIn : labels.plan.connect, { thread: request.plan.thread.title, project: request.plan.project ?? '' }));
  const sender = $derived([request.from.title, request.from.project, request.from.agent?.split(/\s+/).slice(1).join(' ')].filter(Boolean).join(' · '));

  let refusing = $state(false);
  let reason = $state('');
  let reasonField = $state<HTMLInputElement>();

  async function openRefusal() {
    refusing = true;
    await tick();
    reasonField?.focus();
  }
  async function refuse() {
    const text = reason.trim();
    if (!text) return;
    if (await view.decide(request.id, { accept: false, reason: text })) { refusing = false; reason = ''; }
  }
</script>

{#if pending}
  <article class="request" class:incoming={mine} data-testid="contact-request-{request.id}" data-status={request.status}>
    <header class="kicker">
      {#if mine}<ArrowDownLeft size={14} strokeWidth={2} aria-hidden="true" />{:else}<ArrowUpRight size={14} strokeWidth={2} aria-hidden="true" />{/if}
      <span class="ui-label">{fill(mine ? strings.contacts.requests.asks : strings.contacts.requests.asked, { contact: request.contact })}</span>
      <time class="age" datetime={new Date(request.createdAt).toISOString()}>{ago(request.createdAt, now)}</time>
    </header>
    <p class="text">{request.text}</p>
    <p class="from">{sender}</p>
    {#if request.stage && !(mine && request.stage === 'owner')}<p class="stage" data-stage={request.stage} data-testid="contact-request-stage">{labels.stage[request.stage]}</p>{/if}
    {#if plan && mine}<p class="plan" data-testid="contact-request-plan" title={request.plan?.kind === 'start' ? request.plan.brief : undefined}><Waypoints size={14} strokeWidth={2} aria-hidden="true" /><span>{plan}</span></p>{/if}
    {#if request.gitRemote}<p class="remote" title={labels.remote}><GitBranch size={13} strokeWidth={2} aria-hidden="true" /><span>{request.gitRemote}</span></p>{/if}
    {#if mine}
      {#if refusing}
        <form class="refusal" onsubmit={event => { event.preventDefault(); void refuse(); }}>
          <input aria-label={labels.reason} bind:this={reasonField} bind:value={reason} placeholder={labels.reasonPlaceholder} maxlength="500" data-testid="contact-refuse-reason"
            onkeydown={event => { if (event.key === 'Escape') { event.preventDefault(); refusing = false; } }} />
          <div class="buttons">
            <button type="button" class="ghost" onclick={() => { refusing = false; }}>{labels.cancel}</button>
            <button type="submit" class="danger" disabled={busy || !reason.trim()} data-testid="contact-refuse-send">{labels.send}</button>
          </div>
        </form>
      {:else}
        <div class="buttons">
          {#if !byBot}
            <span class="accept">
              <Menu {items} onpick={id => void view.decide(request.id, { accept: true, projectId: id })} label={labels.acceptLabel} placement="bottom" variant="chip" testid="contact-accept-{request.id}">
                <Check size={14} strokeWidth={2.25} /><span class="ui-label">{labels.accept}</span><ChevronDown size={13} />
              </Menu>
            </span>
          {:else if plan || request.approved === false}
            <!-- One Accept: the Operator's choice. Its arrow opens the search, for the owner's own pick. -->
            <span class="split">
              <button type="button" class="approve" disabled={busy} title={plan ? labels.plan.acceptTip : labels.approveTip} onclick={() => void view.decide(request.id, { accept: true })} data-testid="contact-approve-{request.id}"><Check size={14} strokeWidth={2.25} /><span class="ui-label">{labels.accept}</span></button>
              <ThreadChoice store={view.store} testid="contact-pick-{request.id}" label={labels.pick.label} skip={view.state?.bot?.threadId} disabled={busy} onpick={threadId => void view.decide(request.id, { accept: true, threadId })}><ChevronDown size={14} /></ThreadChoice>
            </span>
          {/if}
          <button type="button" class="ghost" disabled={busy} onclick={() => void openRefusal()} data-testid="contact-refuse-{request.id}"><X size={14} /><span class="ui-label">{labels.refuse}</span></button>
        </div>
      {/if}
    {/if}
  </article>
{:else}
  <div class="decided" data-testid="contact-request-{request.id}" data-status={request.status}>
    <span class="mark" class:ok={request.status === 'accepted'}>{#if request.status === 'accepted'}<Check size={13} strokeWidth={2.25} />{:else}<X size={13} strokeWidth={2.25} />{/if}</span>
    <span class="line">
      <span class="what" data-testid="contact-request-outcome">{outcome}</span>
      <span class="sub">{fill(mine ? labels.asks : labels.asked, { contact: request.contact })}: {request.status === 'refused' && request.reason ? request.reason : request.text}</span>
    </span>
    {#if request.decidedBy}<span class="by" data-by={request.decidedBy} title={labels.byTip[request.decidedBy]}>{labels.by[request.decidedBy]}</span>{/if}
  </div>
{/if}

<style>
  /* A row of the Requests card: rows are split by a rule, like Settings rows. */
  .request {
    display: grid;
    gap: 6px;
    padding: 14px 0;
    animation: rise var(--dur-3) var(--ease-out-quint);
  }
  :global(.request) + .request { border-top: 1px solid var(--color-border); }
  :global(h2) + .request { padding-top: 0; }
  .kicker { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--color-accent); font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
  .request:not(.incoming) .kicker { color: var(--color-muted-foreground); }
  .kicker .ui-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .age { margin-left: auto; flex: none; color: var(--color-subtle); font-weight: 500; text-transform: none; letter-spacing: 0; }
  .text { margin: 0; font-size: var(--text-base); line-height: 1.5; overflow-wrap: anywhere; }
  .from { margin: 0; color: var(--color-muted-foreground); font-size: var(--text-sm); overflow-wrap: anywhere; }
  .remote { display: flex; align-items: center; gap: 6px; margin: 0; min-width: 0; color: var(--color-subtle); font-family: var(--font-mono); font-size: var(--text-xs); }
  .remote span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .remote :global(svg) { flex: none; }
  .plan { display: flex; align-items: flex-start; gap: 6px; margin: 0; color: var(--color-accent); font-size: var(--text-sm); font-weight: 600; overflow-wrap: anywhere; }
  .plan :global(svg) { flex: none; margin-top: 3px; }
  /* Accept and its arrow read as one control: the arrow keeps the fill behind a hairline. */
  .split { display: inline-flex; }
  .split .approve { border-radius: var(--radius-md) 0 0 var(--radius-md); }
  .split :global(.arrow) { height: var(--control); padding: 0 8px; border: 1px solid var(--color-accent); border-left-color: color-mix(in srgb, var(--color-accent-ink) 30%, transparent); border-radius: 0 var(--radius-md) var(--radius-md) 0; background: var(--color-accent); color: var(--color-accent-ink); }
  .split :global(.arrow:hover:not(:disabled)), .split :global(.arrow[aria-expanded='true']) { background: var(--color-control-primary-hover); }
  .buttons { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 2px; }
  .accept :global(.trigger), .approve { height: var(--control); padding: 0 12px; border-color: var(--color-accent); background: var(--color-accent); color: var(--color-accent-ink); font-weight: 600; }
  .accept :global(.trigger:hover), .approve:hover:not(:disabled) { background: var(--color-control-primary-hover); }
  .refusal { display: grid; gap: 8px; }
  .refusal input { width: 100%; min-width: 0; }
  .decided { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--radius-md); }
  .mark { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: color-mix(in oklch, var(--color-danger) 16%, transparent); color: var(--color-danger); }
  .mark.ok { background: color-mix(in oklch, var(--color-success) 16%, transparent); color: var(--color-success); }
  .line { display: grid; gap: 1px; min-width: 0; }
  .what { font-size: var(--text-sm); font-weight: 600; }
  .sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .by { padding: 2px 8px; border-radius: var(--radius-full); background: var(--color-surface-3); color: var(--color-muted-foreground); font-size: var(--text-xs); font-weight: 600; }
  .stage { justify-self: start; margin: 0; padding: 1px 8px; border-radius: var(--radius-full); background: var(--color-surface-3); color: var(--color-muted-foreground); font-size: var(--text-xs); font-weight: 600; }
  .stage[data-stage='owner'] { background: var(--color-accent-soft); color: var(--color-accent); }
  .by[data-by='bot'], .by[data-by='concierge'] { background: var(--color-accent-soft); color: var(--color-accent); }
  .by[data-by='match'] { background: color-mix(in oklch, var(--color-success) 14%, transparent); color: var(--color-success); }
  @media (prefers-reduced-motion: reduce) { .request { animation: none; } }
  :global(html[data-motion='reduced']) .request { animation: none; }
  @media (max-width: 720px) {
    .buttons > button, .accept :global(.trigger) { min-height: var(--touch-target); }
  }
</style>
