<script lang="ts">
  import { tick } from 'svelte';
  import { Ellipsis, Mail, UserRound } from '@lucide/svelte';
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
  import DecisionActions from '../DecisionActions.svelte';

  /**
   * Activity's first rows: what contacts ask of the owner, on every listed
   * machine, oldest first. A request is accepted into the project it points
   * at (lib/contact-accept.ts), another one picked in the row's menu, or
   * refused with the reason its agent reads; a held message is
   * delivered or refused. Open shows the contact's page with the whole of it.
   * One line per fact: who asks, what (cut, whole in its tooltip), since when,
   * then the decision pair under them (DecisionActions.svelte, the composer's):
   * Refuse outlined, Accept or Deliver solid. Identical asks merge into one row
   * that says how many in words ("Chris sent 2 requests"), and an answer
   * settles them all (lib/contact-inbox.ts).
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
  /** The menu's own rows, beside the projects (whose ids are never these). */
  const INTO = '\u0000into';

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
  <!-- Activity's row (ActivityRow.svelte): who asks, then what, one line, whole in its tooltip and on the contact's
       page; since when and the one answer end the title's line, the answer after the content on a phone. Refusing
       and another project wait in the row's menu. -->
  <article class="contact-row" data-testid="activity-contact" data-kind={row.letter ? 'mail' : 'request'} data-count={same.length}>
    <span class="mark" aria-hidden="true">{#if row.letter}<Mail size={14} />{:else}<UserRound size={14} />{/if}</span>
    <div class="lines">
      <p class="head">
        <!-- The title opens the contact's page, with the whole of it. -->
        <button type="button" class="ghost title ui-label" title={labels.review} onclick={() => void openContact(row.machine.store, (row.request ?? row.letter!).coreId)} data-testid="activity-contact-open"><span class="clamp">{row.letter ? fill(strings.contacts.mail.writes, { contact: row.letter.contact, thread: row.letter.thread }) : fill(same.length > 1 ? labels.sentMany : labels.asks, { contact: row.request.contact, count: String(same.length) })}</span></button>
        <!-- Merged letters say how many in words beside who writes; merged requests say it in the title. -->
        {#if same.length > 1}<span class="times" data-testid="activity-contact-count" data-count={same.length}>{#if row.letter}{fill(labels.same, { count: String(same.length) })}{/if}</span>{/if}
      </p>
      <p class="text" title={text}>{text}</p>
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
      {#if refusing !== row.key}
        <!-- The decision pair, right under what it decides: Refuse outlined, then the answer, solid. -->
        <div class="pair">
          <DecisionActions>
            {#if row.request}
              {@const request = row.request}
              {@const chosen = acceptProject(row.view.store, request)}
              {@const tip = chosen ? fill(labels.acceptInto, { project: projectName(chosen) }) : labels.accept}
              <button type="button" class="secondary" disabled={busy} onclick={() => void openRefusal(row)} data-testid="activity-refuse-{request.id}"><span class="ui-label">{labels.refuse}</span></button>
              <button type="button" class="primary answer" disabled={busy || !chosen} title={tip} aria-label={tip}
                onclick={() => chosen && void accept({ ...row, request }, same, chosen.id)} data-testid="activity-accept-{request.id}"><span class="ui-label">{labels.accept}</span></button>
            {:else}
              {@const letter = row.letter!}
              <button type="button" class="secondary" disabled={busy} title={strings.contacts.mail.refuseTip} onclick={() => answerMail(row, same, false)} data-testid="activity-mail-refuse-{letter.id}"><span class="ui-label">{strings.contacts.mail.refuse}</span></button>
              <button type="button" class="primary answer" disabled={busy} title={fill(strings.contacts.mail.deliverTip, { thread: letter.thread })}
                onclick={() => answerMail(row, same, true)} data-testid="activity-mail-deliver-{letter.id}"><span class="ui-label">{strings.contacts.mail.deliver}</span></button>
            {/if}
          </DecisionActions>
        </div>
      {/if}
    </div>
    <!-- The title's line ends in since when, the menu in its place under the pointer: another project to accept into. -->
    <div class="side">
      <span class="top">
        <time datetime={new Date(row.createdAt).toISOString()}>{ago(row.createdAt, minuteClock.now)}</time>
        {#if row.request}
          {@const request = row.request}
          {@const chosen = acceptProject(row.view.store, request)}
          <Menu items={[{ id: INTO, label: labels.acceptOther, separator: true }, ...acceptItems(row.view.store, chosen)]}
            onpick={id => void accept({ ...row, request }, same, id as Project['id'])}
            label={labels.actions} placement="bottom" align="end" variant="ghost" disabled={busy} testid="activity-accept-into-{request.id}">
            <Ellipsis size={15} />
          </Menu>
        {/if}
      </span>
    </div>
  </article>
{/each}

<style>
  /* Built as Activity's thread rows (ThreadCard.svelte's `.feed`): 10 px in, a 16 px mark, 10 px to the words; the
     title's line keeps its end for the time, the text runs under it to the row's end, the pair under that. */
  .contact-row { --feed-pad: 8px; --feed-time: 44px; --pad-x: 10px; --side-room: calc(var(--feed-time) + 8px + var(--pad-x));
    position: relative; display: flex; gap: 10px; padding: var(--feed-pad) var(--pad-x); border-radius: var(--radius-md); }
  .contact-row + .contact-row { margin-top: 2px; }
  .contact-row:hover { background: var(--color-hover); }
  /* Grey: the section above already says the user's turn. */
  .mark { display: grid; place-items: center; flex: none; width: 16px; height: 20px; color: var(--color-muted-foreground); }
  .lines { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  /* Baseline: the count reads on the name's first line, whatever height a phone gives the button. */
  .head { display: flex; align-items: baseline; gap: 8px; margin: 0 calc(var(--side-room) - var(--pad-x)) 0 0; }
  /* Two lines of who asks before any ellipsis, as a thread row's title. */
  /* The clamp sits on an inner span, so the button itself does not clip and can carry a wider hit area. No
     .ui-label margin or trim: the line keeps its 20 px, or the text under it rides up into the title and the
     time, and the clamp cuts the descenders. */
  .title { position: relative; display: block; min-width: 0; height: auto; padding: 0; margin: 0; text-box: normal; background: none; white-space: normal; text-align: start; font-weight: 500; line-height: 20px; color: var(--color-foreground); }
  .clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
  .title:hover { text-decoration: underline; background: none; }
  .times { flex: none; line-height: 20px; font-size: var(--text-xs); color: var(--color-muted-foreground); }
  .times:empty { display: none; }
  /* What is asked, one secondary line: the title opens the contact's page with the whole, its tooltip holds it too. */
  .text { margin: 0; font-size: var(--text-sm); color: var(--color-muted-foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* Its end on the thread rows' (ThreadCard's 8 px), so the time stands in one column down both sections. */
  .side { position: absolute; top: 0; right: 0; display: flex; align-items: center; height: calc(20px + 2 * var(--feed-pad)); padding-right: 8px; }
  /* One 20 px track: the menu's taller trigger overflows it instead of growing the row and pushing the time down. */
  .top { display: grid; grid-template-rows: 20px; justify-items: end; align-items: center; width: var(--feed-time); height: 20px; }
  .top > :global(*) { grid-area: 1 / 1; }
  time { font-size: var(--text-xs); color: var(--color-subtle); text-align: end; font-variant-numeric: tabular-nums; }
  /* The menu takes the time's place under the pointer or the keyboard, as on a thread row. */
  .top :global(.trigger) { opacity: 0; }
  .contact-row:is(:hover, :focus-within) .top :global(.trigger) { opacity: 1; }
  .contact-row:is(:hover, :focus-within) .top:has(:global(.trigger)) time { visibility: hidden; }
  /* The pair under what it decides, at the row's right edge as on a thread row (ThreadCard's `.feed-actions`). */
  .pair { margin-top: 4px; }
  .actions { display: flex; flex: none; align-items: center; gap: 6px; }
  .actions :global(button) { gap: 5px; }
  .refusal { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
  .refusal input { width: 100%; min-width: 0; }
  .refusal .actions { justify-content: flex-end; }
  .failed { margin: 0; font-size: var(--text-xs); color: var(--color-danger); overflow-wrap: anywhere; }
  /* On the desktop the title and the time stand on the thread rows' columns (ThreadCard.svelte's `.feed`): their
     tile leaves 6 px to the title and their headline rides 5 px over the padding; measured in Activity, round 20. */
  @media (min-width: 721px) {
    .contact-row { gap: 4px; }
    .lines { margin-top: -5px; }
    time { line-height: 20px; }
  }
  @media (max-width: 720px) {
    /* The phone row's own edge (MobileThreadRow.svelte): 12 px in; the menu always shows before the time on the
       title's line, so who asks keeps the row's width up to them. */
    .contact-row { --feed-pad: 10px; --pad-x: 12px; --feed-time: 32px; --side-room: calc(var(--feed-time) + var(--touch-target) + 2px + var(--pad-x)); }
    .side { right: var(--pad-x); height: calc(22px + 2 * var(--feed-pad)); padding-right: 0; }
    /* The menu before the time, so the time stands in the thread rows' column. */
    .top { display: flex; flex-direction: row-reverse; gap: 2px; width: auto; }
    .top :global(.trigger) { opacity: 1; min-width: var(--touch-target); }
    .contact-row:is(:hover, :focus-within) .top:has(:global(.trigger)) time { visibility: visible; }
    .actions :global(button) { min-height: var(--touch-target); }
    /* The title line is the row's open button: a finger needs 44 px, not its text's height, with no taller row. */
    .title::after { content: ''; position: absolute; inset: 50% 0 auto; height: var(--touch-target); translate: 0 -50%; }
  }
</style>
