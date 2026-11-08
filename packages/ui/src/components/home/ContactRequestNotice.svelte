<script lang="ts">
  import type { ContactRequest, HeldContactLetter } from '@boite/contracts';
  import { untrack } from 'svelte';
  import { ArrowRight, Bell, Check, Mail, X } from '@lucide/svelte';
  import { Closing } from '../../lib/closing.svelte';
  import { contactsShown } from '../../lib/contacts-rail.svelte';
  import { openContact, watchContacts, type ContactsView } from '../../lib/contacts.svelte';
  import { count } from '../../lib/format';
  import type { Store } from '../../lib/store.svelte';
  import { fill, strings } from '../../lib/strings';
  import { machineName, workspace, type Machine } from '../../lib/workspace.svelte';
  import { notifyCorner } from '../../lib/notify-corner';
  import { inbox } from '../../lib/inbox.svelte';

  /**
   * What waits for the owner from contacts, on every listed machine, oldest
   * first: a request opens its contact's page; a message outside a shared
   * project is read here and delivered, refused or opened on that page.
   * Activity lists them too (ContactInboxRows.svelte); its count comes from here.
   */
  let { store }: { store: Store } = $props();
  type Row = { machine: Machine; view: ContactsView; key: string; createdAt: number }
    & ({ request: ContactRequest; letter?: undefined } | { letter: HeldContactLetter; request?: undefined });
  const watched = watchContacts(() => workspace.machinesOr(store).filter(machine => contactsShown(machine.store)));
  const waiting = $derived(watched().flatMap(({ machine, view }): Row[] => [
    ...(view.state?.requests ?? []).filter(request => request.direction === 'in' && request.status === 'pending')
      .map(request => ({ machine, view, key: `${machine.id}:${request.id}`, createdAt: request.createdAt, request })),
    ...(view.state?.mail ?? []).map(letter => ({ machine, view, key: `${machine.id}:mail:${letter.id}`, createdAt: letter.createdAt, letter }))
  ]).sort((a, b) => a.createdAt - b.createdAt));
  const pending = $derived(waiting.filter(row => row.machine.store.connection === 'ready'));
  $effect(() => {
    inbox.contacts = pending.length;
    return () => { inbox.contacts = 0; };
  });
  let seen = $state<string[]>([]);
  $effect(() => {
    const live = new Set(waiting.map(row => row.key));
    if (seen.some(id => !live.has(id))) seen = seen.filter(id => live.has(id));
  });
  const next = $derived(pending.find(row => !seen.includes(row.key)));
  let displayed = $state<Row>();
  let failed = $state('');
  const toast = new Closing();
  $effect(() => {
    if (next) {
      if (next.key !== untrack(() => displayed?.key)) failed = '';
      displayed = next;
      toast.show();
    } else toast.hide();
  });
  function dismiss() { if (displayed) seen = [...seen, displayed.key]; }
  function review(row: Row) {
    seen = [...seen, row.key];
    void openContact(row.machine.store, (row.request ?? row.letter).coreId);
  }
  async function decide(row: Row, accept: boolean) {
    if (!row.letter) return;
    const done = await row.view.decideMail(row.letter.id, accept);
    // The toast may show another letter by now: an answer only marks its own.
    if (untrack(() => displayed?.key) === row.key) failed = done ? '' : row.view.error;
  }
</script>

{#if displayed && toast.shown}
  <div class="notice notify-corner" class:closing={toast.closing} use:toast.attach use:notifyCorner onanimationend={toast.end} role="status" data-testid="contact-request-notice" data-kind={displayed.letter ? 'mail' : 'request'}>
    <div class="notify-card">
      {#if displayed.letter}
        {@const letter = displayed.letter}
        {@const busy = displayed.view.isBusy(`mail:${letter.id}`) || toast.closing}
        <span class="notify-mark"><Mail size={16} strokeWidth={1.75} /></span>
        <span class="notify-lines">
          {@render heading(fill(strings.contacts.mail.writes, { contact: letter.contact, thread: letter.thread }))}
          <span class="notify-text excerpt" data-testid="contact-mail-notice-text">{letter.text}</span>
          {#if failed}<span class="failed" role="alert">{failed}</span>{/if}
          <span class="notify-actions">
            <button type="button" class="primary small" disabled={busy} title={fill(strings.contacts.mail.deliverTip, { thread: letter.thread })}
              onclick={() => void decide(displayed!, true)} data-testid="contact-mail-notice-deliver"><Check size={14} strokeWidth={2.25} /><span class="ui-label">{strings.contacts.mail.deliver}</span></button>
            <button type="button" class="ghost small" disabled={busy} title={strings.contacts.mail.refuseTip}
              onclick={() => void decide(displayed!, false)} data-testid="contact-mail-notice-refuse"><X size={14} /><span class="ui-label">{strings.contacts.mail.refuse}</span></button>
            <button type="button" class="ghost small details" onclick={() => review(displayed!)} data-testid="contact-mail-notice-details"><span class="ui-label">{strings.contacts.mail.details}</span><ArrowRight size={14} strokeWidth={1.75} /></button>
          </span>
        </span>
      {:else}
        <span class="notify-mark"><Bell size={16} strokeWidth={1.75} /></span>
        <span class="notify-lines">
          {@render heading(fill(strings.contacts.requests.asks, { contact: displayed.request.contact }))}
          <span class="notify-text excerpt short">{displayed.request.text}</span>
        </span>
        <button type="button" class="small open" data-testid="contact-request-review" title={strings.contacts.requests.review} onclick={() => review(displayed!)}><span class="ui-label">{strings.common.open}</span></button>
      {/if}
      <button type="button" class="ghost icon notify-dismiss" aria-label={strings.common.dismiss} title={strings.common.dismiss} onclick={dismiss} data-testid="contact-request-dismiss"><X size={14} /></button>
    </div>
  </div>
{/if}

{#snippet heading(text: string)}
  <span class="notify-title"><span class="who">{text}</span><span class="notify-meta">{machineName(displayed!.machine)}{#if pending.length > 1}<span class="count"> · {count(pending.length)}</span>{/if}</span></span>
{/snippet}

<style>
  .notice { animation: rise var(--dur-3) var(--ease-out-quint); }
  .notice.closing { animation: fade-out var(--dur-2) var(--ease-out-quint) forwards; pointer-events: none; }
  .who { min-width: 0; }
  /* A message is read here before it is delivered: a few lines of it, the rest on its contact's page. */
  .excerpt { display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
  .excerpt.short { -webkit-line-clamp: 2; line-clamp: 2; }
  .failed { font-size: var(--text-xs); color: var(--color-danger); overflow-wrap: anywhere; }
  .details { margin-left: auto; color: var(--color-muted-foreground); }
  .open { flex: none; align-self: center; }
  /* Grey: amber is the "Needs you" word alone. */
  .count { color: var(--color-foreground); }
  @media (max-width: 720px) { .open { min-height: var(--touch-target); } }
  @media (prefers-reduced-motion: reduce) { .notice { animation-duration: 1ms; } }
  :global(html[data-motion='reduced']) .notice { animation-duration: 1ms; }
</style>
