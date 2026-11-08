<script lang="ts">
  import { tick } from 'svelte';
  import { Check, Ellipsis, Mail, UserRound, X } from '@lucide/svelte';
  import type { ContactRequest, HeldContactLetter, Project } from '@boite/contracts';
  import { minuteClock } from '../../lib/clock.svelte';
  import { contactsShown } from '../../lib/contacts-rail.svelte';
  import { openContact, watchContacts, type ContactsView } from '../../lib/contacts.svelte';
  import { ago, projectName } from '../../lib/format';
  import { acceptItems, acceptProject } from '../../lib/contact-accept';
  import type { Store } from '../../lib/store.svelte';
  import { fill, strings } from '../../lib/strings';
  import { workspace, type Machine } from '../../lib/workspace.svelte';
  import { mergeAsks } from '../../lib/contact-inbox';
  import Menu from '../Menu.svelte';

  /**
   * Activity's first rows: what contacts ask of the owner, on every listed
   * machine, oldest first. A request is accepted into the project it points
   * at (lib/contact-accept.ts), another one picked in the row's menu, or
   * refused with the reason its agent reads; a held message is
   * delivered or refused. Open shows the contact's page with the whole of it.
   * One line per fact: who asks, what (cut, whole in its tooltip), since when
   * and the answers; identical asks merge into one row with their count, and
   * an answer settles them all (lib/contact-inbox.ts).
   */
  let { store }: { store: Store } = $props();
  type Row = { machine: Machine; view: ContactsView; key: string; createdAt: number }
    & ({ request: ContactRequest; letter?: undefined } | { letter: HeldContactLetter; request?: undefined });
  const watched = watchContacts(() => workspace.machinesOr(store).filter(machine => contactsShown(machine.store)));
  const rows = $derived(watched().flatMap(({ machine, view }): Row[] => machine.store.connection !== 'ready' ? [] : [
    ...(view.state?.requests ?? []).filter(request => request.direction === 'in' && request.status === 'pending')
      .map(request => ({ machine, view, key: `${machine.id}:${request.id}`, createdAt: request.createdAt, request })),
    ...(view.state?.mail ?? []).map(letter => ({ machine, view, key: `${machine.id}:mail:${letter.id}`, createdAt: letter.createdAt, letter }))
  ]));
  const merged = $derived(mergeAsks(rows));
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
  /** Accepting a merged row opens one thread, for its newest ask; the copies before it are refused as copies, so none waits on. */
  async function accept(row: Row & { request: ContactRequest }, same: Row[], projectId: Project['id']) {
    acted = row.key;
    if (!await row.view.decide(row.request.id, { accept: true, projectId })) return;
    for (const copy of same) if (copy !== row && copy.request) await copy.view.decide(copy.request.id, { accept: false, reason: labels.duplicate });
  }

  async function openRefusal(row: Row) {
    refusing = row.key;
    reason = '';
    await tick();
    reasonField?.focus();
  }
  /** One reason refuses every copy of the ask. */
  async function refuse(row: Row & { request: ContactRequest }, same: Row[]) {
    const text = reason.trim();
    acted = row.key;
    if (!text) return;
    let done = true;
    for (const copy of same) if (copy.request) done = !!await copy.view.decide(copy.request.id, { accept: false, reason: text }) && done;
    if (done) refusing = null;
  }
  /** A held letter delivered or refused, with its copies. */
  function answerMail(row: Row, same: Row[], deliver: boolean) {
    act(row, async () => { for (const copy of same) if (copy.letter) await copy.view.decideMail(copy.letter.id, deliver); });
  }
</script>

{#each merged as { row, same } (row.key)}
  {@const busy = row.view.isBusy(row.request ? `decide:${row.request.id}` : `mail:${row.letter!.id}`)}
  {@const text = (row.request ?? row.letter).text}
  <article class="contact-row" data-testid="activity-contact" data-kind={row.letter ? 'mail' : 'request'} data-count={same.length}>
    <span class="mark" aria-hidden="true">{#if row.letter}<Mail size={14} />{:else}<UserRound size={14} />{/if}</span>
    <div class="lines">
      <p class="head">
        <!-- The title opens the contact's page, with the whole of it: no Open button to wrap under the actions. -->
        <button type="button" class="ghost title ui-label" title={labels.review} onclick={() => void openContact(row.machine.store, (row.request ?? row.letter!).coreId)} data-testid="activity-contact-open">{row.letter ? fill(strings.contacts.mail.writes, { contact: row.letter.contact, thread: row.letter.thread }) : fill(labels.asks, { contact: row.request.contact })}</button>
        {#if same.length > 1}{@const many = fill(labels.same, { count: String(same.length) })}<span class="times" data-testid="activity-contact-count" title={many} aria-label={many}>×{same.length}</span>{/if}
        <span class="text" title={text}>{text}</span>
        {#if !(row.request && refusing === row.key)}
          <span class="actions">
            {#if row.request}
              {@const request = row.request}
              {@const chosen = acceptProject(row.view.store, request)}
              {@const tip = chosen ? fill(labels.acceptInto, { project: projectName(chosen) }) : labels.accept}
              <button type="button" class="primary small" disabled={busy || !chosen} title={tip} aria-label={tip}
                onclick={() => chosen && void accept({ ...row, request }, same, chosen.id)} data-testid="activity-accept-{request.id}"><Check size={14} strokeWidth={2.25} /><span class="ui-label">{labels.accept}</span></button>
              <button type="button" class="ghost small" disabled={busy} onclick={() => void openRefusal(row)} data-testid="activity-refuse-{request.id}"><X size={14} /><span class="ui-label">{labels.refuse}</span></button>
              <!-- The project choice behind the row's menu: Accept itself takes the one the request points at. -->
              <Menu items={acceptItems(row.view.store, chosen)} onpick={id => void accept({ ...row, request }, same, id as Project['id'])} label={labels.acceptOther} placement="bottom" align="end" variant="ghost" disabled={busy} testid="activity-accept-into-{request.id}">
                <Ellipsis size={15} />
              </Menu>
            {:else}
              {@const letter = row.letter!}
              <button type="button" class="primary small" disabled={busy} title={fill(strings.contacts.mail.deliverTip, { thread: letter.thread })}
                onclick={() => answerMail(row, same, true)} data-testid="activity-mail-deliver-{letter.id}"><Check size={14} strokeWidth={2.25} /><span class="ui-label">{strings.contacts.mail.deliver}</span></button>
              <button type="button" class="ghost small" disabled={busy} title={strings.contacts.mail.refuseTip}
                onclick={() => answerMail(row, same, false)} data-testid="activity-mail-refuse-{letter.id}"><X size={14} /><span class="ui-label">{strings.contacts.mail.refuse}</span></button>
            {/if}
          </span>
        {/if}
        <!-- Last, like the thread rows' time below: one right edge for every row's time, the answers ending where their status words end. -->
        <time datetime={new Date(row.createdAt).toISOString()}>{ago(row.createdAt, minuteClock.now)}</time>
      </p>
      {#if row.request && refusing === row.key}
        {@const request = row.request}
        <form class="refusal" onsubmit={event => { event.preventDefault(); void refuse({ ...row, request }, same); }}>
          <input aria-label={labels.reason} bind:this={reasonField} bind:value={reason} placeholder={labels.reasonPlaceholder} maxlength="500" data-testid="activity-refuse-reason"
            onkeydown={event => { if (event.key === 'Escape') { event.preventDefault(); refusing = null; } }} />
          <span class="actions">
            <button type="button" class="ghost small" onclick={() => { refusing = null; }}><span class="ui-label">{labels.cancel}</span></button>
            <button type="submit" class="danger small" disabled={busy || !reason.trim()} data-testid="activity-refuse-send"><span class="ui-label">{labels.send}</span></button>
          </span>
        </form>
      {/if}
      {#if acted === row.key && !busy && row.view.error}<p class="failed" role="alert">{row.view.error}</p>{/if}
    </div>
  </article>
{/each}

<style>
  /* The text edge of Activity's thread rows (ThreadCard.svelte): 10 px in, a 16 px mark, 10 px to the words. */
  .contact-row { display: flex; gap: 10px; padding: 6px 10px; border-radius: var(--radius-md); }
  .contact-row + .contact-row { margin-top: 2px; }
  .contact-row:hover { background: var(--color-hover); }
  /* Grey: amber is the "Needs you" word alone, and the section above already says it. */
  .mark { display: grid; place-items: center; flex: none; width: 16px; height: var(--control-sm); color: var(--color-muted-foreground); }
  .lines { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
  /* One line: who asks, how many times, what (cut), the answers, since when at the right edge. */
  .head { display: flex; align-items: center; gap: 8px; margin: 0; min-height: var(--control-sm); }
  .title { display: block; flex: none; max-width: 40%; height: auto; padding: 0; background: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: start; font-weight: 500; color: var(--color-foreground); }
  .title:hover { text-decoration: underline; background: none; }
  .times { flex: none; font-size: var(--text-xs); font-weight: 600; color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }
  .text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-sm); color: var(--color-muted-foreground); }
  time { flex: none; min-width: 6ch; font-size: var(--text-xs); color: var(--color-subtle); text-align: end; font-variant-numeric: tabular-nums; }
  .actions { display: flex; flex: none; align-items: center; gap: 6px; }
  .actions :global(button) { gap: 5px; }
  .refusal { display: flex; flex-direction: column; gap: 6px; }
  .refusal input { width: 100%; min-width: 0; }
  .refusal .actions { justify-content: flex-end; }
  .failed { margin: 0; font-size: var(--text-xs); color: var(--color-danger); overflow-wrap: anywhere; }
  @media (max-width: 720px) {
    /* The phone row's own edge (MobileThreadRow.svelte): 12 px in. Who and since when on the first line, what on
       the second, cut to one line, the answers under it at a finger's size. */
    .contact-row { padding: 10px 12px; }
    .head { display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto; row-gap: 4px; }
    .title { max-width: none; }
    .head time { grid-column: 4; grid-row: 1; }
    .text { grid-column: 1 / -1; grid-row: 2; }
    .head .actions { grid-column: 1 / -1; grid-row: 3; margin-top: 4px; }
    .actions :global(button) { min-height: var(--touch-target); }
    .actions :global(.trigger.ghost) { min-width: var(--touch-target); }
    /* The title line is the row's open button: a finger needs more than its 14 px of text. */
    .title { padding-block: 6px; margin-block: -6px; }
  }
</style>
