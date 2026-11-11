<script lang="ts">
  import { tick } from 'svelte';
  import { Ellipsis } from '@lucide/svelte';
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
  import { hostMark } from '../../lib/machine-host';
  import MachinePlace from '../MachinePlace.svelte';
  import Menu from '../Menu.svelte';
  import DecisionActions from '../DecisionActions.svelte';
  import ActivityKind from '../ActivityKind.svelte';
  import ClampText from '../ClampText.svelte';

  /**
   * Activity's first rows: what contacts ask of the owner, on every listed
   * machine, oldest first. A request is accepted into the project it points
   * at (lib/contact-accept.ts), another one picked in the row's menu, or
   * refused with the reason its agent reads; a held message is
   * delivered or refused. Open shows the contact's page with the whole of it.
   * The rows of a thread's own: its kind ("Contact request", "Held message"),
   * who asks with the amber mark, where it arrived (the machine among several)
   * and since when, as a thread row's place line, then what is asked, whole up
   * to four lines and behind "Show all" past them, so nothing is accepted
   * unread; the decision pair beside or under them (DecisionActions.svelte):
   * Refuse outlined, Accept or Deliver solid. Identical asks merge into one row
   * that says how many in words ("Chris sent 2 requests") and lists each copy
   * under the text (the contact's thread it came from, where and when); its
   * actions settle them all and say so ("Accept both", lib/contact-inbox.ts).
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
  const several = $derived(workspace.machinesOr(store).length > 1);
  const labels = strings.contacts.requests;
  /** A merged ask's verbs say that they settle every copy. */
  const verbs = (count: number) => count === 1 ? { accept: labels.accept, refuse: labels.refuse }
    : count === 2 ? { accept: labels.acceptBoth, refuse: labels.refuseBoth } : { accept: labels.acceptAll, refuse: labels.refuseAll };
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
  <!-- Activity's row (ActivityRow.svelte): its kind, who asks, where and since when, then what, whole; the answer
       beside the content, under it on a phone. Another project waits in the row's menu. -->
  <article class="contact-row" data-testid="activity-contact" data-kind={row.letter ? 'mail' : 'request'} data-count={same.length}>
    <div class="lines">
      <ActivityKind kind={row.letter ? 'mail' : 'request'} />
      <p class="head">
        <!-- The title opens the contact's page, with the whole of it; the amber mark ends it as a thread row's. -->
        <button type="button" class="ghost title ui-label" title={labels.review} onclick={() => void openContact(row.machine.store, (row.request ?? row.letter!).coreId)} data-testid="activity-contact-open"><span class="clamp">{row.letter ? fill(strings.contacts.mail.writes, { contact: row.letter.contact, thread: row.letter.thread }) : fill(same.length > 1 ? labels.sentMany : labels.asks, { contact: row.request.contact, count: String(same.length) })}</span></button>
        <span class="mark" aria-hidden="true"></span>
        <!-- Merged letters say how many in words beside who writes; merged requests say it in the title. -->
        {#if same.length > 1}<span class="times" data-testid="activity-contact-count" data-count={same.length}>{#if row.letter}{fill(labels.same, { count: String(same.length) })}{/if}</span>{/if}
      </p>
      <p class="place">{#if several}<MachinePlace host={hostMark(row.machine.label)} />{/if}<time datetime={new Date(row.createdAt).toISOString()}>{ago(row.createdAt, minuteClock.now)}</time></p>
      <ClampText {text} testid="activity-contact-text" />
      {#if row.request && same.length > 1}
        <!-- Each copy of the ask, one line: the contact's thread it came from, where it arrived and when. -->
        <ul class="copies" data-testid="activity-contact-copies">
          {#each same as copy (copy.key)}
            {@const from = copy.request!.from}
            <li class="copy" data-testid="activity-contact-copy"><span class="from">{from.project ? fill(labels.from, { thread: from.title, project: from.project }) : from.title}</span>{#if several}<MachinePlace host={hostMark(copy.machine.label)} />{/if}<time datetime={new Date(copy.createdAt).toISOString()}>{ago(copy.createdAt, minuteClock.now)}</time></li>
          {/each}
        </ul>
      {/if}
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
    {#if refusing !== row.key}
      <!-- The decision pair, right under what it decides: Refuse outlined, then the answer, solid. -->
      <div class="pair">
        <DecisionActions>
          {#if row.request}
            {@const request = row.request}
            {@const chosen = acceptProject(row.view.store, request)}
            {@const tip = chosen ? fill(labels.acceptInto, { project: projectName(chosen) }) : labels.accept}
            {@const words = verbs(same.length)}
            <button type="button" class="secondary" disabled={busy} onclick={() => void openRefusal(row)} data-testid="activity-refuse-{request.id}"><span class="ui-label">{words.refuse}</span></button>
            <button type="button" class="primary answer" disabled={busy || !chosen} title={tip} aria-label={same.length > 1 ? undefined : tip}
              onclick={() => chosen && void accept({ ...row, request }, same, chosen.id)} data-testid="activity-accept-{request.id}"><span class="ui-label">{words.accept}</span></button>
          {:else}
            {@const letter = row.letter!}
            <button type="button" class="secondary" disabled={busy} title={strings.contacts.mail.refuseTip} onclick={() => answerMail(row, same, false)} data-testid="activity-mail-refuse-{letter.id}"><span class="ui-label">{strings.contacts.mail.refuse}</span></button>
            <button type="button" class="primary answer" disabled={busy} title={fill(strings.contacts.mail.deliverTip, { thread: letter.thread })}
              onclick={() => answerMail(row, same, true)} data-testid="activity-mail-deliver-{letter.id}"><span class="ui-label">{strings.contacts.mail.deliver}</span></button>
          {/if}
        </DecisionActions>
      </div>
    {/if}
    <!-- The title line's end, the menu under the pointer: another project to accept into. -->
    {#if row.request}
      {@const request = row.request}
      {@const chosen = acceptProject(row.view.store, request)}
      <div class="side">
        <Menu items={[{ id: INTO, label: labels.acceptOther, separator: true }, ...acceptItems(row.view.store, chosen)]}
          onpick={id => void accept({ ...row, request }, same, id as Project['id'])}
          label={labels.actions} placement="bottom" align="end" variant="ghost" disabled={busy} testid="activity-accept-into-{request.id}">
          <Ellipsis size={15} />
        </Menu>
      </div>
    {/if}
  </article>
{/each}

<style>
  /* Built as Activity's thread rows (ThreadCard.svelte's `.feed`): 8 px in, the kind line, then the title on the same
     edge as every row's; the title's line keeps its end for the menu, the place line and the text run under it, the
     pair beside or under. */
  .contact-row { --feed-pad: 8px; --feed-lead: 20px; --menu-room: 32px; --pad-x: 8px; --side-room: calc(var(--menu-room) + 8px + var(--pad-x));
    position: relative; display: flex; flex-direction: column; padding: var(--feed-pad) var(--pad-x); border-radius: var(--radius-md); }
  .contact-row + .contact-row { margin-top: 2px; }
  .contact-row:hover { background: var(--color-hover); }
  .lines { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  /* Baseline: the count reads on the name's first line, whatever height a phone gives the button. */
  .head { display: flex; align-items: flex-start; gap: 6px; margin: 0 calc(var(--side-room) - var(--pad-x)) 0 0; }
  /* Two lines of who asks before any ellipsis, as a thread row's title. */
  /* The clamp sits on an inner span, so the button itself does not clip and can carry a wider hit area. No
     .ui-label margin or trim: the line keeps its 20 px, or the text under it rides up into the title and the
     time, and the clamp cuts the descenders. */
  .title { position: relative; display: block; flex: 0 1 auto; min-width: 0; height: auto; padding: 0; margin: 0; text-box: normal; background: none; white-space: normal; text-align: start; font-weight: 400; line-height: 20px; color: var(--color-foreground); }
  .clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
  .title:hover { text-decoration: underline; background: none; }
  /* The user's turn, the thread rows' amber dot (ThreadState.svelte), right after the title's last word. */
  .mark { flex: none; width: 8px; height: 8px; margin-top: 6px; border-radius: var(--radius-full); background: var(--color-live); }
  .times { flex: none; line-height: 20px; font-size: var(--text-xs); color: var(--color-muted-foreground); }
  .times:empty { display: none; }
  /* Where it arrived and since when, a thread row's place line (ThreadCard.svelte's `.where`). */
  .place { display: flex; align-items: center; gap: 8px; min-width: 0; height: 18px; margin: -2px 0 0; font-size: var(--text-xs); line-height: 18px; color: var(--color-subtle); white-space: nowrap; overflow: hidden; }
  time { flex: none; font-variant-numeric: tabular-nums; }
  /* Each copy of a merged ask: one line on the desktop, its words whole; they wrap on a phone. */
  .copies { display: flex; flex-direction: column; gap: 2px; margin: 2px 0 0; padding: 0 0 0 10px; border-left: 2px solid var(--color-edge); list-style: none; }
  .copy { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 8px; min-width: 0; font-size: var(--text-xs); line-height: 18px; color: var(--color-subtle); }
  .from { min-width: 0; color: var(--color-muted-foreground); overflow-wrap: anywhere; }
  /* The menu at the title line's end, its end on the thread rows' (ThreadCard's 8 px), shown under the pointer or
     the keyboard as on a thread row; a 20 px track, so its taller trigger never grows the row. */
  .side { position: absolute; top: var(--feed-lead); right: 0; display: flex; align-items: center; height: calc(20px + 2 * var(--feed-pad)); padding-right: 8px; }
  .side :global(.trigger) { opacity: 0; }
  .contact-row:is(:hover, :focus-within) .side :global(.trigger) { opacity: 1; }
  /* The pair under what it decides, at the row's right edge as on a thread row (ThreadCard's `.feed-actions`). */
  .pair { margin-top: 8px; }
  /* Beside the text where Activity has room, as a thread row's pair (ThreadCard.svelte): Refuse in the outline
     column, the answer in the solid one, centred on the title's line, the pair's end on the thread rows' 8 px. */
  @container activity (min-width: 640px) {
    .contact-row { display: grid; grid-template-columns: subgrid; align-items: start; padding-right: 0; }
    .lines, .side { grid-column: 1; grid-row: 1; }
    /* In the flow of the text's cell, at its end, as a thread row's time; the row's top padding is its own. */
    .side { position: static; justify-self: end; margin-top: calc(var(--feed-lead) - var(--feed-pad)); }
    .lines { padding-right: 3px; }
    .pair { grid-column: 2 / -1; grid-row: 1; display: grid; grid-template-columns: subgrid; margin: calc(var(--feed-lead) + 10px - var(--control) / 2) 0 0; padding-right: 8px; }
    .pair > :global(.decision-actions) { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; gap: 0; }
    .pair :global(.decision-actions > button) { grid-column: 2; }
    .pair :global(.decision-actions > button:not(:last-child)) { grid-column: 1; margin: 0 8px 0 var(--space-4); }
    .copy { flex-wrap: nowrap; }
    .from { overflow-wrap: normal; white-space: nowrap; }
  }
  .actions { display: flex; flex: none; align-items: center; gap: 6px; }
  .actions :global(button) { gap: 5px; }
  .refusal { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
  .refusal input { width: 100%; min-width: 0; }
  .refusal .actions { justify-content: flex-end; }
  .failed { margin: 0; font-size: var(--text-xs); color: var(--color-danger); overflow-wrap: anywhere; }
  @media (max-width: 720px) {
    /* The phone row's own edge (MobileThreadRow.svelte): 12 px in; the menu always shows at the title line's end,
       so who asks keeps the row's width up to it. */
    .contact-row { --feed-pad: 10px; --pad-x: 12px; --side-room: calc(var(--touch-target) + 2px + var(--pad-x)); }
    .side { right: calc(var(--pad-x) - 12px); height: calc(22px + 2 * var(--feed-pad)); padding-right: 0; }
    .side :global(.trigger) { opacity: 1; min-width: var(--touch-target); }
    /* Who asks at a phone row title's size and spot (MobileThreadRow.svelte): that title is trimmed to its
       capitals, so this untrimmed 20 px line rises by the difference to sit as far under the kind line. */
    .head { margin-top: -4px; }
    .title { font-size: var(--text-reading); }
    .place { font-size: var(--text-sm); line-height: 1.4; height: auto; margin: 0; }
    .copy { font-size: var(--text-sm); line-height: 1.4; }
    .actions :global(button) { min-height: var(--touch-target); }
    /* The title line is the row's open button: a finger needs 44 px, not its text's height, with no taller row. */
    .title::after { content: ''; position: absolute; inset: 50% 0 auto; height: var(--touch-target); translate: 0 -50%; }
  }
</style>
