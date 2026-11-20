<script lang="ts">
  import { tick } from 'svelte';
  import { ChevronRight, Ellipsis } from '@lucide/svelte';
  import type { ContactRequest, HeldContactLetter, Project } from '@boite/contracts';
  import { minuteClock } from '../../lib/clock.svelte';
  import { contactsShown } from '../../lib/contacts-rail.svelte';
  import { openContact, settledByBot, waitsForOwner, watchContacts, type ContactsView } from '../../lib/contacts.svelte';
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
   * its glyph the card's one mark, who asks, where it arrived (the machine
   * among several) and since when, as a thread row's place line, then what is asked, whole up
   * to four lines and behind "Show all" past them, so nothing is accepted
   * unread; the decision pair beside the head or under it all (DecisionActions.svelte):
   * Refuse outlined, Accept or Deliver solid. Identical asks are one request received more than once
   * (lib/contact-inbox.ts): one row titled as one ask ("Chris asks"), its copies folded into one quiet line under
   * the text ("Sent 2 times: on Builder Sep 5, on studio 3h"), which opens on each copy's line (the contact's thread
   * it came from, where and when); Accept and Refuse settle every copy. Only what waits for the owner shows
   * (lib/contacts.svelte.ts `waitsForOwner`), as on the toast that counts it; on a request for a thread the
   * Contacts bot settles, Accept lets the bot put the threads in touch, shares no project and has no project menu.
   */
  let { store }: { store: Store } = $props();
  type Row = { machine: Machine; view: ContactsView; key: string; createdAt: number }
    & ({ request: ContactRequest; letter?: undefined } | { letter: HeldContactLetter; request?: undefined });
  const watched = watchContacts(() => workspace.machinesOr(store).filter(machine => contactsShown(machine.store)));
  const rows = $derived(watched().flatMap(({ machine, view }): Row[] => machine.store.connection !== 'ready' ? [] : [
    ...(view.state?.requests ?? []).filter(waitsForOwner)
      .map(request => ({ machine, view, key: `${machine.id}:${request.id}`, createdAt: request.createdAt, request })),
    ...(view.state?.mail ?? []).map(letter => ({ machine, view, key: `${machine.id}:mail:${letter.id}`, createdAt: letter.createdAt, letter }))
  ]));
  const merged = $derived(mergeAsks(rows));
  const several = $derived(workspace.machinesOr(store).length > 1);
  const labels = strings.contacts.requests;
  /** The menu's own rows, beside the projects (whose ids are never these). */
  const INTO = '\u0000into';

  /** The merged rows whose copies are unfolded. */
  let unfolded = $state<string[]>([]);
  function fold(key: string) { unfolded = unfolded.includes(key) ? unfolded.filter(entry => entry !== key) : [...unfolded, key]; }
  /** The folded copies in one line: where each arrived (among several machines) and when. */
  function copiesLine(same: Row[]): string {
    const list = same.map(copy => several ? `${fill(strings.connection.onMachine, { name: copy.machine.label })} ${ago(copy.createdAt, minuteClock.now)}` : ago(copy.createdAt, minuteClock.now));
    return fill(labels.copies, { count: String(same.length), list: list.join(', ') });
  }

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
    for (const copy of same) if (copy.key !== row.key && copy.request) await copy.view.decide(copy.request.id, { accept: false, reason: labels.duplicate });
  }
  /** What the Operator will do once the owner accepts, as the request's card words it. */
  function operatorPlan(plan: NonNullable<ContactRequest['plan']>): string {
    return plan.kind === 'start' ? fill(labels.plan.start, { project: plan.project.name })
      : fill(plan.project ? labels.plan.connectIn : labels.plan.connect, { thread: plan.thread.title, project: plan.project ?? '' });
  }
  /** A thread request the Contacts bot settles: the bot connects its newest ask, the copies before it are refused as copies. */
  async function approve(row: Row & { request: ContactRequest }, same: Row[]) {
    acted = row.key;
    if (!await row.view.decide(row.request.id, { accept: true })) return;
    for (const copy of same) if (copy.key !== row.key && copy.request) await copy.view.decide(copy.request.id, { accept: false, reason: labels.duplicate });
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
       beside the head, under it all on a phone. Another project waits in the row's menu. -->
  <article class="contact-row" data-testid="activity-contact" data-kind={row.letter ? 'mail' : 'request'} data-count={same.length}>
    <div class="lines">
      <ActivityKind kind={row.letter ? 'mail' : 'request'} />
      <p class="head">
        <!-- The title opens the contact's page, with the whole of it. -->
        <button type="button" class="ghost title ui-label" title={labels.review} onclick={() => void openContact(row.machine.store, (row.request ?? row.letter!).coreId)} data-testid="activity-contact-open"><span class="clamp">{row.letter ? fill(strings.contacts.mail.writes, { contact: row.letter.contact, thread: row.letter.thread }) : fill(labels.asks, { contact: row.request.contact })}</span></button>
        <!-- A letter received more than once says how many times beside who writes; a request says it on its fold line. -->
        {#if same.length > 1 && row.letter}<span class="times" data-testid="activity-contact-count" data-count={same.length}>{fill(labels.sentTimes, { count: String(same.length) })}</span>{/if}
      </p>
      <p class="place">{#if several}<MachinePlace host={hostMark(row.machine.label)} />{/if}<time class="ui-label" datetime={new Date(row.createdAt).toISOString()}>{ago(row.createdAt, minuteClock.now)}</time></p>
    </div>
    <div class="content">
      <ClampText {text} testid="activity-contact-text" />
      {#if row.request && same.length > 1}
        {@const open = unfolded.includes(row.key)}
        <!-- The copies folded into one quiet line; a click lists each: the contact's thread it came from, where it
             arrived and when. -->
        <button type="button" class="ghost fold" aria-expanded={open} onclick={() => fold(row.key)} data-testid="activity-contact-copies-fold"><ChevronRight size={13} aria-hidden="true" /><span class="ui-label">{copiesLine(same)}</span></button>
        {#if open}
        <ul class="copies" data-testid="activity-contact-copies">
          {#each same as copy (copy.key)}
            {@const from = copy.request!.from}
            <li class="copy" data-testid="activity-contact-copy"><span class="from">{from.project ? fill(labels.from, { thread: from.title, project: from.project }) : from.title}</span>{#if several}<MachinePlace host={hostMark(copy.machine.label)} />{/if}<time datetime={new Date(copy.createdAt).toISOString()}>{ago(copy.createdAt, minuteClock.now)}</time></li>
          {/each}
        </ul>
        {/if}
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
            <button type="button" class="secondary" disabled={busy} onclick={() => void openRefusal(row)} data-testid="activity-refuse-{request.id}"><span class="ui-label">{labels.refuse}</span></button>
            {#if !settledByBot(request)}
              <button type="button" class="primary answer" disabled={busy || !chosen} title={tip} aria-label={tip}
                onclick={() => chosen && void accept({ ...row, request }, same, chosen.id)} data-testid="activity-accept-{request.id}"><span class="ui-label">{labels.accept}</span></button>
            {:else if request.plan || request.approved === false}
              <!-- Accept runs the Operator's choice and shares no project; the request's card offers the owner's own pick. -->
              {@const approveTip = request.plan ? `${operatorPlan(request.plan)}. ${labels.plan.acceptTip}` : labels.approveTip}
              <button type="button" class="primary answer" disabled={busy} title={approveTip} aria-label={approveTip}
                onclick={() => void approve({ ...row, request }, same)} data-testid="activity-approve-{request.id}"><span class="ui-label">{labels.accept}</span></button>
            {/if}
          {:else}
            {@const letter = row.letter!}
            <button type="button" class="secondary" disabled={busy} title={strings.contacts.mail.refuseTip} onclick={() => answerMail(row, same, false)} data-testid="activity-mail-refuse-{letter.id}"><span class="ui-label">{strings.contacts.mail.refuse}</span></button>
            <button type="button" class="primary answer" disabled={busy} title={fill(strings.contacts.mail.deliverTip, { thread: letter.thread })}
              onclick={() => answerMail(row, same, true)} data-testid="activity-mail-deliver-{letter.id}"><span class="ui-label">{strings.contacts.mail.deliver}</span></button>
          {/if}
        </DecisionActions>
      </div>
    {/if}
    <!-- The kind line's end, the menu under the pointer: another project to accept into. A request the Contacts bot
         settles shares no project, so it has none. -->
    {#if row.request && !settledByBot(row.request)}
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
  /* Built as Activity's thread cards (ThreadCard.svelte's `.feed`), on the ground the list gives every card
     (ActivityList.svelte, MobileNavigation.svelte): 12 px in on every side, the kind line with the
     menu at its end on the card's edge, then the title and every line after on the kind word's edge (`--gutter`),
     the place line under it, the text under that, the pair beside the head or under it all. */
  .contact-row { --feed-pad: 12px; --pad-x: 12px; --gutter: 19px; --menu-w: max(32px, var(--control-sm)); --menu-h: 20px;
    position: relative; display: flex; flex-direction: column; padding: var(--feed-pad) var(--pad-x); }
  .lines { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .lines > :global(.activity-kind) { margin: 0 calc(var(--menu-w) + 4px) 8px 0; }
  .content { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 8px 0 0 var(--gutter); }
  /* Baseline: the count reads on the name's first line, whatever height a phone gives the button. Its untrimmed
     20 px line rises by its leading, so its capitals stand as far under the kind line as a thread card's trimmed
     title. */
  .head { display: flex; align-items: flex-start; gap: 6px; margin: -4px 0 0 var(--gutter); }
  /* Two lines of who asks before any ellipsis, as a thread card's title, its strongest line. */
  /* The clamp sits on an inner span, so the button itself does not clip and can carry a wider hit area. No
     .ui-label margin or trim: the line keeps its 20 px, or the text under it rides up into the title and the
     time, and the clamp cuts the descenders. */
  .title { position: relative; display: block; flex: 0 1 auto; min-width: 0; height: auto; padding: 0; margin: 0; border: 0; text-box: normal; background: none; white-space: normal; text-align: start; font-size: var(--text-head); font-weight: var(--weight-title); line-height: 20px; color: var(--color-foreground); }
  .clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
  .title:hover { text-decoration: underline; background: none; }
  .times { flex: none; line-height: 20px; font-size: var(--text-xs); color: var(--color-muted-foreground); }
  /* Where it arrived and since when, a thread card's place line (ThreadCard.svelte's `.where`). */
  .place { display: flex; align-items: center; gap: 8px; min-width: 0; height: 20px; margin: 6px 0 0 var(--gutter); font-size: var(--text-xs); line-height: 20px; color: var(--color-subtle); white-space: nowrap; overflow: hidden; }
  time { flex: none; font-variant-numeric: tabular-nums; }
  /* The folded copies: one quiet line, the place line's ink, its chevron turned down while they show. */
  .fold { display: flex; align-items: center; gap: 4px; align-self: flex-start; max-width: 100%; height: 20px; padding: 0; margin: -2px 0 0; background: none; font-size: var(--text-xs); font-weight: 400; color: var(--color-subtle); }
  .fold:hover { color: var(--color-muted-foreground); background: none; }
  .fold > .ui-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fold :global(svg) { flex: none; transition: rotate var(--dur-2) var(--ease-out-quint); }
  .fold[aria-expanded='true'] :global(svg) { rotate: 90deg; }
  /* Each copy of a merged ask: one line on the desktop, its words whole; they wrap on a phone. */
  .copies { display: flex; flex-direction: column; gap: 2px; margin: 2px 0 0; padding: 0 0 0 10px; list-style: none; }
  .copy { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 8px; min-width: 0; font-size: var(--text-xs); line-height: 18px; color: var(--color-subtle); }
  .from { min-width: 0; color: var(--color-muted-foreground); overflow-wrap: anywhere; }
  /* The menu at the kind line's end, its glyph's box on the card's edge, as a thread card's; shown under the pointer
     or the keyboard. */
  .side { position: absolute; top: calc(var(--feed-pad) + 8px - var(--menu-h) / 2); right: calc(var(--pad-x) - (var(--menu-w) - 14px) / 2); display: flex; align-items: center; height: var(--menu-h); }
  .side :global(.trigger) { opacity: 0; width: var(--menu-w); min-width: 0; height: var(--menu-h); min-height: 0; }
  .contact-row:is(:hover, :focus-within) .side :global(.trigger) { opacity: 1; }
  /* The pair under what it decides, at the card's right edge as on a thread card (ThreadCard's `.feed-actions`). */
  .pair { margin-top: 8px; }
  /* Beside the head where Activity has room, as a thread card's pair (ThreadCard.svelte): Refuse in the outline
     column, the answer in the solid one, on the card's edge, centred on who asks. */
  @container activity (min-width: 640px) {
    .contact-row { display: grid; grid-template-columns: subgrid; align-items: start; }
    .lines { grid-column: 1; grid-row: 1; }
    /* What is asked runs under the head and the pair, the card's whole width: no empty band beside the pair. */
    .content { grid-column: 1 / -1; grid-row: 2; }
    .pair { grid-column: 2 / -1; grid-row: 1; display: grid; grid-template-columns: subgrid; margin: calc(24px + 10px - var(--control) / 2) 0 0; }
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
    /* The phone card's form (MobileThreadRow.svelte): the menu always shows, a finger's width and 32 px tall on the
       kind line's end, clear of the title 8 px under that line. */
    .contact-row { --menu-w: var(--touch-target); --menu-h: 32px; }
    .side :global(.trigger) { opacity: 1; }
    .lines > :global(.activity-kind) { margin-right: calc(var(--menu-w) - 8px); }
    .head { margin-top: -7px; }
    .title { font-size: var(--text-reading); }
    .place { font-size: var(--text-sm); line-height: 1.4; height: 1.4em; margin-top: 0; }
    /* Every copy said in full: the line wraps under itself, the chevron on its first line's capitals. */
    .fold { align-items: flex-start; height: auto; min-height: 24px; padding-block: 5px; font-size: var(--text-sm); text-align: start; }
    .fold > .ui-label { white-space: normal; }
    .fold :global(svg) { margin-top: calc(0.36em - 6.5px); }
    .copy { font-size: var(--text-sm); line-height: 1.4; }
    .actions :global(button) { min-height: var(--touch-target); }
    /* The title line is the row's open button: a finger needs 44 px, not its text's height, with no taller row. */
    .title::after { content: ''; position: absolute; inset: 50% 0 auto; height: var(--touch-target); translate: 0 -50%; }
  }
</style>
