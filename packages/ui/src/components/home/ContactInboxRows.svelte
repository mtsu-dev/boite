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
  /** The menu's own rows, beside the projects (whose ids are never these). */
  const INTO = '\u0000into', GAP = '\u0000gap', REFUSE = '\u0000refuse';

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
  <!-- Activity's row (ActivityRow.svelte): who asks, then what, whole; since when and the one answer end the
       title's line. Refusing and another project wait in the row's menu. -->
  <article class="contact-row" data-testid="activity-contact" data-kind={row.letter ? 'mail' : 'request'} data-count={same.length}>
    <span class="mark" aria-hidden="true">{#if row.letter}<Mail size={14} />{:else}<UserRound size={14} />{/if}</span>
    <div class="lines">
      <p class="head">
        <!-- The title opens the contact's page, with the whole of it. -->
        <button type="button" class="ghost title ui-label" title={labels.review} onclick={() => void openContact(row.machine.store, (row.request ?? row.letter!).coreId)} data-testid="activity-contact-open"><span class="clamp">{row.letter ? fill(strings.contacts.mail.writes, { contact: row.letter.contact, thread: row.letter.thread }) : fill(labels.asks, { contact: row.request.contact })}</span></button>
        {#if same.length > 1}{@const many = fill(labels.same, { count: String(same.length) })}<span class="times" data-testid="activity-contact-count" title={many} aria-label={many}>×{same.length}</span>{/if}
      </p>
      <p class="text">{text}</p>
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
    <!-- The title's line ends in since when (the menu in its place under the pointer) and the one answer, at the
         offset of a thread row's action (ThreadCard.svelte's `--feed-verb`). -->
    <div class="side">
      <span class="top">
        <time datetime={new Date(row.createdAt).toISOString()}>{ago(row.createdAt, minuteClock.now)}</time>
        {#if row.request}
          {@const request = row.request}
          {@const chosen = acceptProject(row.view.store, request)}
          <Menu items={[{ id: INTO, label: labels.acceptOther, separator: true }, ...acceptItems(row.view.store, chosen), { id: GAP, label: '', separator: true }, { id: REFUSE, label: labels.refuse, glyph: X, testid: `activity-refuse-${request.id}` }]}
            onpick={id => id === REFUSE ? void openRefusal(row) : void accept({ ...row, request }, same, id as Project['id'])}
            label={labels.actions} placement="bottom" align="end" variant="ghost" disabled={busy} testid="activity-accept-into-{request.id}">
            <Ellipsis size={15} />
          </Menu>
        {:else}
          {@const letter = row.letter!}
          <Menu items={[{ id: REFUSE, label: strings.contacts.mail.refuse, title: strings.contacts.mail.refuseTip, glyph: X, testid: `activity-mail-refuse-${letter.id}` }]}
            onpick={() => answerMail(row, same, false)} label={labels.actions} placement="bottom" align="end" variant="ghost" disabled={busy} testid="activity-mail-menu-{letter.id}">
            <Ellipsis size={15} />
          </Menu>
        {/if}
      </span>
      <span class="feed-action">
        {#if row.request && refusing !== row.key}
          {@const request = row.request}
          {@const chosen = acceptProject(row.view.store, request)}
          {@const tip = chosen ? fill(labels.acceptInto, { project: projectName(chosen) }) : labels.accept}
          <button type="button" class="small answer" disabled={busy || !chosen} title={tip} aria-label={tip}
            onclick={() => chosen && void accept({ ...row, request }, same, chosen.id)} data-testid="activity-accept-{request.id}"><Check size={14} strokeWidth={2.25} /><span class="ui-label">{labels.accept}</span></button>
        {:else if row.letter}
          {@const letter = row.letter}
          <button type="button" class="small answer" disabled={busy} title={fill(strings.contacts.mail.deliverTip, { thread: letter.thread })}
            onclick={() => answerMail(row, same, true)} data-testid="activity-mail-deliver-{letter.id}"><Check size={14} strokeWidth={2.25} /><span class="ui-label">{strings.contacts.mail.deliver}</span></button>
        {/if}
      </span>
    </div>
  </article>
{/each}

<style>
  /* Built as Activity's thread rows (ThreadCard.svelte's `.feed`): 10 px in, a 16 px mark, 10 px to the words; the
     title's line keeps its end for the time and the answer, the text runs under it to the row's end. */
  .contact-row { --feed-pad: 8px; --feed-time: 44px; --feed-verb: 92px; --pad-x: 10px; --side-room: calc(var(--feed-time) + 8px + var(--feed-verb) + var(--pad-x));
    position: relative; display: flex; gap: 10px; padding: var(--feed-pad) var(--pad-x); border-radius: var(--radius-md); }
  .contact-row + .contact-row { margin-top: 2px; }
  .contact-row:hover { background: var(--color-hover); }
  /* Grey: the section above already says the user's turn. */
  .mark { display: grid; place-items: center; flex: none; width: 16px; height: 20px; color: var(--color-muted-foreground); }
  .lines { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  /* Baseline: the count reads on the name's first line, whatever height a phone gives the button. */
  .head { display: flex; align-items: baseline; gap: 8px; margin: 0 calc(var(--side-room) - var(--pad-x)) 0 0; }
  /* Two lines of who asks before any ellipsis, as a thread row's title. */
  /* The clamp sits on an inner span, so the button itself does not clip and can carry a wider hit area. */
  .title { position: relative; display: block; min-width: 0; height: auto; padding: 0; background: none; white-space: normal; text-align: start; font-weight: 500; line-height: 20px; color: var(--color-foreground); }
  .clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
  .title:hover { text-decoration: underline; background: none; }
  .times { flex: none; line-height: 20px; font-size: var(--text-xs); font-weight: 600; color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }
  /* What is asked, whole: the answer is never given to a cut line. */
  .text { margin: 0; font-size: var(--text-sm); color: var(--color-muted-foreground); white-space: pre-wrap; overflow-wrap: anywhere; }
  .side { position: absolute; top: 0; right: 0; display: flex; align-items: center; gap: 8px; height: calc(20px + 2 * var(--feed-pad)); padding-right: var(--pad-x); }
  .top { display: grid; justify-items: end; align-items: center; width: var(--feed-time); height: 20px; }
  .top > :global(*) { grid-area: 1 / 1; }
  time { font-size: var(--text-xs); color: var(--color-subtle); text-align: end; font-variant-numeric: tabular-nums; }
  /* The menu takes the time's place under the pointer or the keyboard, as on a thread row. */
  .top :global(.trigger) { opacity: 0; }
  .contact-row:is(:hover, :focus-within) .top :global(.trigger) { opacity: 1; }
  .contact-row:is(:hover, :focus-within) time { visibility: hidden; }
  .feed-action { display: flex; flex: none; width: var(--feed-verb); }
  .answer { gap: 5px; width: 100%; justify-content: center; font-weight: 600; }
  .actions { display: flex; flex: none; align-items: center; gap: 6px; }
  .actions :global(button) { gap: 5px; }
  .refusal { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
  .refusal input { width: 100%; min-width: 0; }
  .refusal .actions { justify-content: flex-end; }
  .failed { margin: 0; font-size: var(--text-xs); color: var(--color-danger); overflow-wrap: anywhere; }
  @media (max-width: 720px) {
    /* The phone row's own edge (MobileThreadRow.svelte): 12 px in; the menu always shows beside the time, the answer
       at a finger's size and MobileThreadRow.svelte's one verb width, still on the title's line. */
    .contact-row { --feed-pad: 10px; --pad-x: 12px; --feed-time: 32px; --feed-verb: 88px; --side-room: calc(var(--feed-time) + var(--touch-target) + 8px + var(--feed-verb) + var(--pad-x)); }
    .side { height: calc(22px + 2 * var(--feed-pad)); gap: 4px; }
    .top { display: flex; gap: 2px; width: auto; }
    .top :global(.trigger) { opacity: 1; min-width: var(--touch-target); }
    .contact-row:is(:hover, :focus-within) time { visibility: visible; }
    .answer, .actions :global(button) { min-height: var(--touch-target); }
    /* The title line is the row's open button: a finger needs 44 px, not its text's height, with no taller row. */
    .title::after { content: ''; position: absolute; inset: 50% 0 auto; height: var(--touch-target); translate: 0 -50%; }
    /* The answer is a finger's height, taller than the title's line: the text under it starts below the button. */
    .head { min-height: calc(var(--touch-target) - var(--feed-pad)); }
  }
</style>
