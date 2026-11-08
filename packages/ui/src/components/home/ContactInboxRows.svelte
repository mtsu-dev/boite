<script lang="ts">
  import { tick } from 'svelte';
  import { Check, ChevronDown, Mail, UserRound, X } from '@lucide/svelte';
  import type { ContactRequest, HeldContactLetter } from '@boite/contracts';
  import { minuteClock } from '../../lib/clock.svelte';
  import { contactsShown } from '../../lib/contacts-rail.svelte';
  import { openContact, watchContacts, type ContactsView } from '../../lib/contacts.svelte';
  import { ago, projectName } from '../../lib/format';
  import type { MenuItem } from '../../lib/menu';
  import type { Store } from '../../lib/store.svelte';
  import { fill, strings } from '../../lib/strings';
  import { workspace, type Machine } from '../../lib/workspace.svelte';
  import Menu from '../Menu.svelte';

  /**
   * Activity's first rows: what contacts ask of the owner, on every listed
   * machine, oldest first. A request is accepted into a project picked in the
   * menu or refused with the reason its agent reads; a held message is
   * delivered or refused. Open shows the contact's page with the whole of it.
   */
  let { store }: { store: Store } = $props();
  type Row = { machine: Machine; view: ContactsView; key: string; createdAt: number }
    & ({ request: ContactRequest; letter?: undefined } | { letter: HeldContactLetter; request?: undefined });
  const watched = watchContacts(() => workspace.machinesOr(store).filter(machine => contactsShown(machine.store)));
  const rows = $derived(watched().flatMap(({ machine, view }): Row[] => machine.store.connection !== 'ready' ? [] : [
    ...(view.state?.requests ?? []).filter(request => request.direction === 'in' && request.status === 'pending')
      .map(request => ({ machine, view, key: `${machine.id}:${request.id}`, createdAt: request.createdAt, request })),
    ...(view.state?.mail ?? []).map(letter => ({ machine, view, key: `${machine.id}:mail:${letter.id}`, createdAt: letter.createdAt, letter }))
  ]).sort((a, b) => a.createdAt - b.createdAt));
  const labels = strings.contacts.requests;

  /** The row whose refusal is being written, with its reason. */
  let refusing = $state<string | null>(null);
  let reason = $state('');
  let reasonField = $state<HTMLInputElement>();
  /** The row last answered: a failed call says why under it, not under every row of that machine. */
  let acted = $state<string | null>(null);
  function act(row: Row, call: () => Promise<unknown>) {
    acted = row.key;
    void call();
  }

  function projects(view: ContactsView): MenuItem[] {
    return view.store.projects.filter(project => project.kind !== 'drafts' && !project.archived)
      .map(project => ({ id: project.id, label: projectName(project), projectTile: { project, store: view.store } }));
  }
  async function openRefusal(row: Row) {
    refusing = row.key;
    reason = '';
    await tick();
    reasonField?.focus();
  }
  async function refuse(row: Row & { request: ContactRequest }) {
    const text = reason.trim();
    acted = row.key;
    if (text && await row.view.decide(row.request.id, { accept: false, reason: text })) refusing = null;
  }
</script>

{#each rows as row (row.key)}
  {@const busy = row.view.isBusy(row.request ? `decide:${row.request.id}` : `mail:${row.letter!.id}`)}
  <article class="contact-row" data-testid="activity-contact" data-kind={row.letter ? 'mail' : 'request'}>
    <span class="mark" aria-hidden="true">{#if row.letter}<Mail size={14} />{:else}<UserRound size={14} />{/if}</span>
    <div class="lines">
      <p class="head">
        <!-- The title opens the contact's page, with the whole of it: no Open button to wrap under the actions. -->
        <button type="button" class="ghost title ui-label" title={labels.review} onclick={() => void openContact(row.machine.store, (row.request ?? row.letter!).coreId)} data-testid="activity-contact-open">{row.letter ? fill(strings.contacts.mail.writes, { contact: row.letter.contact, thread: row.letter.thread }) : fill(labels.asks, { contact: row.request.contact })}</button>
        <time datetime={new Date(row.createdAt).toISOString()}>{ago(row.createdAt, minuteClock.now)}</time>
      </p>
      <p class="text">{(row.request ?? row.letter).text}</p>
      {#if row.request && refusing === row.key}
        {@const request = row.request}
        <form class="refusal" onsubmit={event => { event.preventDefault(); void refuse({ ...row, request }); }}>
          <input aria-label={labels.reason} bind:this={reasonField} bind:value={reason} placeholder={labels.reasonPlaceholder} maxlength="500" data-testid="activity-refuse-reason"
            onkeydown={event => { if (event.key === 'Escape') { event.preventDefault(); refusing = null; } }} />
          <span class="actions">
            <button type="button" class="ghost small" onclick={() => { refusing = null; }}><span class="ui-label">{labels.cancel}</span></button>
            <button type="submit" class="danger small" disabled={busy || !reason.trim()} data-testid="activity-refuse-send"><span class="ui-label">{labels.send}</span></button>
          </span>
        </form>
      {:else}
        <span class="actions">
          {#if row.request}
            {@const request = row.request}
            <Menu items={projects(row.view)} onpick={id => act(row, () => row.view.decide(request.id, { accept: true, projectId: id }))} label={labels.acceptLabel} placement="bottom" variant="chip" testid="activity-accept-{request.id}">
              <Check size={14} strokeWidth={2.25} /><span class="ui-label">{labels.accept}</span><ChevronDown size={13} />
            </Menu>
            <button type="button" class="ghost small" disabled={busy} onclick={() => void openRefusal(row)} data-testid="activity-refuse-{request.id}"><X size={14} /><span class="ui-label">{labels.refuse}</span></button>
          {:else}
            {@const letter = row.letter!}
            <button type="button" class="primary small" disabled={busy} title={fill(strings.contacts.mail.deliverTip, { thread: letter.thread })}
              onclick={() => act(row, () => row.view.decideMail(letter.id, true))} data-testid="activity-mail-deliver-{letter.id}"><Check size={14} strokeWidth={2.25} /><span class="ui-label">{strings.contacts.mail.deliver}</span></button>
            <button type="button" class="ghost small" disabled={busy} title={strings.contacts.mail.refuseTip}
              onclick={() => act(row, () => row.view.decideMail(letter.id, false))} data-testid="activity-mail-refuse-{letter.id}"><X size={14} /><span class="ui-label">{strings.contacts.mail.refuse}</span></button>
          {/if}
        </span>
      {/if}
      {#if acted === row.key && !busy && row.view.error}<p class="failed" role="alert">{row.view.error}</p>{/if}
    </div>
  </article>
{/each}

<style>
  /* The text edge of Activity's thread rows (ThreadCard.svelte): 10 px in, a 16 px mark, 10 px to the words. */
  .contact-row { display: flex; gap: 10px; padding: 8px 10px; border-radius: var(--radius-md); }
  .contact-row + .contact-row { margin-top: 2px; }
  .contact-row:hover { background: var(--color-hover); }
  /* Grey: amber is the "Needs you" word alone, and the section above already says it. */
  .mark { display: grid; place-items: center; flex: none; width: 16px; height: 20px; color: var(--color-muted-foreground); }
  .lines { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .head { display: flex; align-items: baseline; gap: 8px; margin: 0; min-height: 20px; }
  .title { display: block; flex: 1; min-width: 0; height: auto; padding: 0; background: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: start; font-weight: 500; color: var(--color-foreground); }
  .title:hover { text-decoration: underline; background: none; }
  time { flex: none; font-size: var(--text-xs); color: var(--color-subtle); font-variant-numeric: tabular-nums; }
  /* What the contact wrote, two lines of it: the rest is on its page. */
  .text { margin: 0; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: var(--text-sm); color: var(--color-muted-foreground); overflow-wrap: anywhere; }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .actions :global(button) { gap: 5px; }
  .refusal { display: flex; flex-direction: column; gap: 6px; }
  .refusal input { width: 100%; min-width: 0; }
  .refusal .actions { justify-content: flex-end; }
  .failed { margin: 0; font-size: var(--text-xs); color: var(--color-danger); overflow-wrap: anywhere; }
  @media (max-width: 720px) {
    /* The phone row's own edge (MobileThreadRow.svelte): 12 px in. */
    .contact-row { padding: 10px 12px; }
    .actions :global(button) { min-height: var(--touch-target); }
  }
</style>
