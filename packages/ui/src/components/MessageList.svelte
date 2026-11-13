<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { MESSAGE_PAGE, type Message } from '@boite/contracts';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import MessageTurnSummary from './MessageTurnSummary.svelte';
  import TurnFiles from './TurnFilesLoader.svelte';
  import { TurnChanges } from '../lib/turn-changes.svelte';
  import { TailHeight } from '../lib/tail-height.svelte';
  import TimelineFoot from './TimelineFoot.svelte';
  import MessageOutline from './MessageOutline.svelte';
  import AgentMessageGroup from './AgentMessageGroup.svelte';
  import TimelineCard from './TimelineCard.svelte';
  import WakeMarker, { wakeKind } from './WakeMarker.svelte';
  import TurnFoldRow from './TurnFoldRow.svelte';
  import DayDivider from './DayDivider.svelte';
  import { dayBreaks } from '../lib/day-breaks';
  import { AgentTimeline, memoryPassOf, summaryMarks } from '../lib/agent-turns';
  import { groupTimeline } from '../lib/timeline-group';
  import { agentMailFor } from '../lib/agent-mail';
  import { timelineCards } from '../lib/timeline-cards';
  import { asksDocked, failureCarded } from '../lib/one-status';
  import UserMessage from './UserMessage.svelte';
  import Deferred from './Deferred.svelte';
  import { parts } from '../lib/deferred-parts';
  import { decisionTail } from '../lib/decision-tail.svelte';
  import { ListViewer } from '../lib/list-viewer.svelte';
  import AssistantMessage from './AssistantMessage.svelte';
  import FailedAttempts from './FailedAttempts.svelte';
  import MoveMarker from './MoveMarker.svelte';
  import SpawnMarker from './SpawnMarker.svelte';
  import SwitchMarker from './SwitchMarker.svelte';
  import MessageActions from './MessageActions.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { movedBy, startedFrom, turnAnswer } from '../lib/message-display';
  import { focusComposer } from '../lib/focus';
  import { isSending } from '../lib/composer-queue';
  import { retryTurn } from '../lib/composer-edit';
  import { TurnProgress } from '../lib/turn-progress.svelte';
  import { GAP, OVERSCAN, SlotTotals, WINDOW_FROM, atOrBefore, estimateSlot, gapChanged, keepOnly, measurable, reaches, sameView, slotGap, windowStats, type WindowView } from '../lib/message-window';
  import { TimelineRows, rowEstimate, rowIndexOf, seam, type TimelineRow } from '../lib/timeline-rows';
  import { GapRows, NO_GAPS, READ_AHEAD, RangeAsk, gapHeight, heldNear, loadKeepingReader, wantedRange } from '../lib/history-gaps';
  import TimelineGap from './TimelineGap.svelte';
  import { latest } from '../lib/latest.svelte';
  import { glides } from '../lib/motion';
  import { BottomEdge, BottomGlide, PointerHold, keysUp, pointedTurn, timelineEndRoom, typingKey, watchWheel, wheelsUp } from '../lib/timeline-follow';
  import { selectionClicks } from '../lib/selection-clicks';
  import { editWhole, fillShort, pullNewer, pullOlder } from '../lib/reading-window';
  import { ReadingAnchor, type RowAnchor } from '../lib/reading-anchor';
  import { MediaQuery } from 'svelte/reactivity';
  import { MessageReveal } from '../lib/message-reveal.svelte';
  import { ViewPlacement, turnViews, viewPart } from '../lib/inline-view';
  import { filesLast, firstAssistantByTurn, firstByTurn, publishedFile, quietKeepalives } from '../lib/message-order';

  /** A phone has no room left of the bubbles for the outline rail: it is not drawn there. */
  const narrow = new MediaQuery('(max-width: 720px)');
  const reveal = new MessageReveal(() => messages, () => narrow.current);

  /** `closing`: a finished thread's last word (`lib/closing-line.ts`), drawn under the last message and scrolling with it. */
  let { store, threadId, messages, closing = null }: { store: Store; threadId: string; messages: Message[]; closing?: string | null } = $props();
  const viewer = new ListViewer();
  /** The find bar is its own chunk, fetched the first time it opens. A failed fetch tries again on the next open. */
  let FindBar = $state.raw<typeof import('./FindBar.svelte').default>();
  $effect(() => {
    if (store.findOpen && !FindBar) void import('./FindBar.svelte').then((module) => { FindBar = module.default; }).catch(() => { store.findOpen = false; });
  });
  const mail = $derived(agentMailFor(store, threadId));
  /** The thread's account is signed out and no other of its agent can take the next turn: an error carries the way back in. */
  const signedOut = $derived.by(() => {
    const thread = store.openThread;
    if (!thread || thread.id !== threadId) return null;
    const account = store.accountOf(thread.accountId);
    return account?.status === 'unauthenticated' && store.usableAccountOf(account.providerId, account.id) === null ? account : null;
  });
  /** Launches, workflow runs and contact requests, each a card where it happened, live or ended (`timelineCards`). */
  const cards = $derived(timelineCards(store, threadId, messages));
  /** A question at the top of the composer is the turn's status: the stream drops the running summary meanwhile, and its rows drop their own line for it. */
  const asking = $derived(asksDocked(store, threadId));
  /** The open thread's permissions waiting on their command rows, drawn or not: the strip's pill counts them (`DecisionPill`). */
  const permissionsWaiting = $derived(store.openThread?.id === threadId ? store.pendingPermissions.filter((request) => request.threadId === threadId).length : 0);
  $effect(() => {
    if (store.openThread?.id !== threadId) return;
    decisionTail.count = permissionsWaiting;
    return () => { decisionTail.count = 0; };
  });
  /** The turns of the thread this list shows, open or delegated. */
  const shownTurns = $derived(store.openThread?.id === threadId ? store.openThread.turns : store.delegationThread?.id === threadId ? store.delegationThread.turns : []);
  const grouped = $derived.by(() => groupTimeline(messages, threadId, shownTurns, mail, cards));
  /** The pages each turn published: its answer places them, or they go after it once the turn ends (`placeViews`). */
  let shownViews: ReadonlyMap<string, Message[]> | undefined;
  const views = $derived.by(() => (shownViews = turnViews(grouped.timeline, shownViews)));
  /** A finished turn's published files go after its answer, its pages after them; Boite's cache pings are one line; an agent's own thread folds its finished turns (`lib/agent-turns.ts`). */
  const agentTimeline = new AgentTimeline(), viewPlacement = new ViewPlacement();
  const placed = $derived(viewPlacement.build(filesLast(grouped.timeline, shownTurns), shownTurns, views));
  const shaped = $derived(agentTimeline.build(quietKeepalives(placed, shownTurns), shownTurns, memoryPassOf(store, threadId)));
  const timeline = $derived(shaped.timeline);
  const days = $derived(dayBreaks(timeline)); // The messages that open a new day, a divider above each.
  /** What the window lists and measures: a row per message, several for the message of a long turn (lib/timeline-rows.ts). */
  const cut = new TimelineRows(), gapRows = new GapRows();
  /** Where the held messages sit in the thread, on a core that says so: each stretch missing between them is a gap row. */
  const placement = $derived(store.openThread?.id === threadId ? store.messagePlacement?.(threadId, messages) ?? null : null);
  const positional = $derived((placement?.first ?? null) !== null);
  const gapped = $derived.by(() => {
    const placed = gapRows.place(cut.build(timeline, undefined, placement?.gaps), messages, placement?.gaps ?? NO_GAPS);
    // A row that grew or was cut weighs something else until it is measured.
    if (placed.at(cut.changedFrom) < slots.dirty) slots.dirty = placed.at(cut.changedFrom);
    return placed;
  });
  const rows = $derived(gapped.rows);
  const timelineOrder = $derived.by(() => { void rows; return gapped.gaps.length ? rows.map(row => row.id).join('\0') : cut.order; });
  const savedReading = untrack(() => store.readingPositions?.get(threadId));

  /** How often the bottom message's height is allowed to speak to the pin. */
  const TAIL_GAP_MS = 100;

  let viewport = $state<HTMLDivElement | undefined>(undefined);
  let pinned = $state(savedReading?.pinned ?? true);
  let behind = $state(false);
  /** The newest message the reader was at the bottom for; what came after it is what the button counts. */
  let seenLast = $state<string | null>(null);
  let unseen = $derived.by(() => {
    if (!behind || seenLast === null) return 0;
    const at = timeline.findIndex((message) => message.id === seenLast);
    return at < 0 ? 0 : timeline.length - 1 - at;
  });
  function markSeen() { seenLast = timeline.at(-1)?.id ?? null; }
  // The strip above the composer draws the way back (`JumpLatest.svelte`).
  $effect(() => { latest.behind = behind; latest.unseen = unseen; });
  onMount(() => { latest.jump = jump; return () => { if (latest.jump === jump) { latest.jump = null; latest.behind = false; latest.unseen = 0; } }; });
  let shown = savedReading ? untrack(() => threadId) : '';

  /** Measured slot heights by message id. What is not in here is worth its estimate. */
  const heights = new Map<string, number>(savedReading?.heights);
  /** Bumped by every measurement that moved a height, so the window recomputes on real numbers. */
  let measured = $state(0);
  /** Ids that already played the rise, so a message re-entering the window stays still. */
  const risen = new Set<string>([...(savedReading?.heights.keys() ?? []), ...untrack(() => messages.map(message => message.id))]);
  /** One observer for the viewport's height and for every rendered message. */
  let boxes: ResizeObserver | undefined;

  const slots = new SlotTotals<TimelineRow>(heights, row => row.gap ? gapHeight(row.gap.count) : rowEstimate(row, estimateSlot(row.message)));
  /** Where the reader is, and the rows on the page by id (lib/reading-anchor.ts). */
  const anchors = new ReadingAnchor(savedReading);
  const savedTop = untrack(() => {
    const anchor = savedReading?.pinned ? undefined : anchors.current;
    const at = anchor ? rows.findIndex(row => row.id === anchor.id) : -1;
    return at < 0 ? savedReading?.top ?? 0 : Math.max(0, (slots.totals(rows, timelineOrder)[at] ?? 0) - anchor!.offset);
  });
  let scrollTop = $state(savedTop);
  let column = $state<HTMLDivElement | undefined>(undefined);
  function rememberAnchor() { anchors.remember(viewport, column); }
  /** Typing in a field never leaves the thread: a chord, Enter, Escape or a key outside a field reads the anchor. */
  function rememberBeforeKey(event: KeyboardEvent) { if (!typingKey(event)) rememberAnchor(); }
  function restoreAnchor(anchor: RowAnchor | undefined = anchors.current) {
    if (!anchor || !viewport?.isConnected || pinned || navigationTarget || promptTarget) return;
    const delta = anchors.drift(viewport, anchor);
    if (delta === null) return;
    // A held row was read to the fraction: rounding to the nearest pixel leaves it at most half a pixel off.
    if (Math.abs(delta) > (anchors.held ? 0.5 : 1)) { viewport.scrollTop += delta; scrollTop = viewport.scrollTop; }
    anchors.current = anchor;
  }
  function releaseAnchor() { anchors.restoring = false; anchors.held = false; }
  onMount(() => {
    // Capture the settled layout before a navigation click removes this list.
    document.addEventListener('pointerdown', rememberAnchor, true);
    document.addEventListener('keydown', rememberBeforeKey, true);
    return () => {
      document.removeEventListener('pointerdown', rememberAnchor, true);
      document.removeEventListener('keydown', rememberBeforeKey, true);
    };
  });
  let restoredReading = false;
  onDestroy(() => {
    if (!viewport || !store.readingPositions) return;
    store.readingPositions.delete(threadId);
    store.readingPositions.set(threadId, { top: scrollTop, pinned, heights: new Map(heights), anchor: anchors.saved(), height: viewHeight, reservePrompt, followPrompt: promptTarget });
    while (store.readingPositions.size > 32) store.readingPositions.delete(store.readingPositions.keys().next().value!);
  });
  let viewHeight = $state(savedReading?.height ?? 0);
  /** What lies under the last row inside the viewport (`timelineEndRoom`), 20 px until read. */
  let endRoom = $state(20);
  const readEndRoom = (box: HTMLElement) => { endRoom = timelineEndRoom(box) ?? endRoom; };
  let navigationTarget = $state<string | null>(null);
  let failureTarget = $state<{ id: string } | null>(null);
  let promptTarget = $state<string | null>(savedReading?.followPrompt ?? null);
  let reservePrompt = $state<string | null>(savedReading?.reservePrompt ?? null);
  let lifting = $state(false);
  let liftFrame = 0;
  let liftFrom = 0;
  let handledFocus = untrack(() => store.promptFocus);
  function stopLift() { cancelAnimationFrame(liftFrame); liftFrame = 0; lifting = false; }
  function releaseNavigation(event?: KeyboardEvent) {
    releaseAnchor(); navigationTarget = null;
    if (promptTarget) pinned = false;
    promptTarget = null;
    stopLift();
    endGlide(false);
    if (event && !typingKey(event) && keysUp(event, viewport)) { pinned = false; leftBottom = true; }
  }
  onDestroy(stopLift);
  const activePrompt = $derived.by(() => {
    void measured;
    if (!pinned && promptTarget && timeline.some(message => message.id === promptTarget)) return promptTarget;
    const total = totals(rows);
    const at = pinned ? rows.length - 1 : atOrBefore(total, rows.length, scrollTop + 24);
    for (let index = Math.min(at, rows.length - 1); index >= 0; index--) {
      if (rows[index]?.message.role === 'user') return rows[index]!.message.id;
    }
    return null;
  });

  /** To a message, or to the row of it that draws `part` when a long one is cut in several. */
  function jumpToMessage(id: string, part?: number) {
    releaseNavigation();
    const box = viewport;
    const index = rowIndexOf(rows, id, part);
    if (!box || index < 0) return;
    failureTarget = { id };
    navigationTarget = rows[index]!.id;
    pinned = false;
    behind = true;
    box.scrollTop = totals(rows)[index] ?? 0;
    scrollTop = box.scrollTop;
  }

  // Keep the target aligned as estimated heights become real measurements; wheel, touch, scrollbar and keyboard input return control to the reader.
  $effect(() => {
    const id = navigationTarget;
    void measured;
    void view;
    if (!id) return;
    const frame = requestAnimationFrame(() => {
      const box = viewport;
      if (!box || navigationTarget !== id) return;
      const node = anchors.nodes.get(id);
      if (!node?.isConnected) return;
      node.style.animation = 'none';
      const delta = node.getBoundingClientRect().top - box.getBoundingClientRect().top - 20;
      if (Math.abs(delta) > 1) box.scrollTop += delta;
      scrollTop = box.scrollTop;
    });
    return () => cancelAnimationFrame(frame);
  });

  const windowed = $derived(rows.length > WINDOW_FROM);
  /** The window was opened around a reading position and stops short of the thread's last message. */
  const cutBelow = $derived((store.messagesAfter ?? null) !== null);

  function totals(list: TimelineRow[]): number[] { return slots.totals(list, timelineOrder); }

  const promptInset = $derived(Math.min(96, Math.max(48, viewHeight * 0.12)));
  const promptLead = $derived.by(() => {
    void measured;
    const before = reservePrompt ? totals(rows)[rows.findIndex(row => row.id === reservePrompt)] ?? 0 : Infinity;
    return Math.max(0, promptInset - 20 - before);
  });
  // Keep the remaining screen below the sent prompt. Real response height replaces the
  // reserved space, including in a virtualized conversation, without moving it. A question
  // at the composer's top gives it back: the last message then sits right over the question.
  const promptRoom = $derived.by(() => {
    void measured;
    if (!reservePrompt || asking) return 0;
    const at = rows.findIndex(row => row.id === reservePrompt);
    if (at < 0) return 0;
    const total = totals(rows);
    const content = (total[rows.length] ?? 0) - (total[at] ?? 0) - GAP;
    return Math.max(0, viewHeight - promptInset - endRoom - content);
  });

  function promptTop(id: string): number {
    const box = viewport!;
    const node = anchors.nodes.get(id);
    if (node?.isConnected) {
      node.style.animation = 'none';
      return box.scrollTop + node.getBoundingClientRect().top - box.getBoundingClientRect().top - promptInset;
    }
    const top = totals(rows)[rows.findIndex(row => row.id === id)];
    return top === undefined ? box.scrollTop : top + 20 + promptLead - promptInset;
  }

  $effect(() => {
    const request = store.promptFocus;
    if (!request || request === handledFocus || request.threadId !== threadId) return;
    const message = messages.findLast(message => message.role === 'user' && message.turnId === request.turnId && message.id !== request.after);
    if (!message || !viewport) return;
    handledFocus = request;
    untrack(() => {
      releaseNavigation();
      pinned = false;
      behind = false;
      // A prompt sent brings the reader back to the live end, whatever the wheel did before.
      leftBottom = false;
      reservePrompt = promptTarget = message.id;
      lifting = true;
      liftFrom = viewport!.scrollTop;
      const style = getComputedStyle(viewport!);
      const token = style.getPropertyValue('--dur-3').trim();
      const duration = parseFloat(token) * (token.endsWith('ms') ? 1 : 1000) || 0;
      let started: number | undefined;
      const step = (now: number) => {
        if (!viewport || promptTarget !== message.id) return;
        started ??= now;
        const progress = duration > 1 ? Math.min(1, (now - started) / duration) : 1;
        viewport.scrollTop = liftFrom + (promptTop(message.id) - liftFrom) * (1 - (1 - progress) ** 5);
        scrollTop = viewport.scrollTop;
        if (progress < 1) liftFrame = requestAnimationFrame(step);
        else { liftFrame = 0; lifting = false; }
      };
      liftFrame = requestAnimationFrame(step);
    });
  });

  $effect(() => {
    const id = promptTarget;
    void measured;
    void viewHeight;
    void view;
    const room = promptRoom;
    if (!id || lifting || !viewport) return;
    const frame = requestAnimationFrame(() => {
      if (!viewport || promptTarget !== id) return;
      if (room <= 1) {
        viewport.scrollTop = viewport.scrollHeight;
        scrollTop = viewport.scrollTop;
        pinned = true;
      } else {
        pinned = false;
        viewport.scrollTop = promptTop(id);
        scrollTop = viewport.scrollTop;
        behind = false;
        markSeen();
        rememberAnchor();
      }
    });
    return () => cancelAnimationFrame(frame);
  });

  /**
   * The slice of messages that meets the viewport, the overscan added, and the two heights the spacers carry for the rest.
   * While pinned the window hangs off the end of the list, not `scrollTop`, so the bottom is right on the first frame.
   */
  let lastView: WindowView | undefined;
  const view = $derived.by(() => {
    void measured;
    windowStats.recomputes += 1;
    const list = rows;
    if (!windowed) {
      return lastView = sameView(lastView, { start: 0, end: list.length, first: 0, above: 0, below: 0 });
    }

    const count = list.length;
    const total = totals(list);
    const whole = total[count] ?? 0;
    let first: number;
    let last: number;
    if (pinned) {
      first = atOrBefore(total, count, whole - viewHeight);
      last = count;
    } else {
      first = atOrBefore(total, count, scrollTop);
      last = reaches(total, count, first, scrollTop + viewHeight);
    }

    // At the live end, paint fewer offscreen rows. Reading history keeps the
    // larger buffer in both directions for wheel and touch navigation.
    const start = Math.max(0, first - (pinned ? 2 : OVERSCAN));
    const end = Math.min(count, last + OVERSCAN);
    // The same object while the window covers the same rows: a scroll inside them redraws nothing.
    return lastView = sameView(lastView, { start, end, first, above: total[start] ?? 0, below: whole - (total[end] ?? 0) });
  });

  const rendered = $derived(rows.slice(view.start, view.end));

  /**
   * A rendered message's real height replaces its estimate. One above what the user reads would push the text down
   * as it lands, so the same delta goes back into `scrollTop` and the viewport does not move.
   */
  function onMeasured(entries: ResizeObserverEntry[]): void {
    const box = viewport;
    const lastId = rows.at(-1)?.id;
    let shift = 0;
    let moved = false;
    for (const entry of entries) {
      const node = entry.target as HTMLElement;
      if (node === box) {
        viewHeight = node.clientHeight;
        readEndRoom(node);
        continue;
      }
      const id = node.dataset['mid'];
      if (!id) continue;
      // The box is measured already: `offsetHeight` would lay out, mid-scroll, what the window just mounted. Fractions
      // stay (rounded, each row above the reader left it up to half a pixel off); a continued message sits a gap under.
      const gap = slotGap(node.dataset['seam'], node.dataset['rest'] !== undefined);
      node.dataset['gap'] = String(gap);
      const next = (entry.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight) + gap;
      const at = slots.indexOf(rows, id);
      const previous = heights.get(id) ?? slots.estimateOf(rows[at]);
      if (previous === next) continue;
      heights.set(id, next);
      moved = true;
      if (at < 0) continue;
      // Everything from here down is worth a different number now.
      if (at < slots.dirty) slots.dirty = at;
      if (at < view.first) shift += next - previous;
      if (id === lastId) tail.note(next);
    }
    if (!moved) return;
    measured += 1;
    if (box && shift !== 0 && !pinned) {
      box.scrollTop += shift;
      // The window moves with it at once: computed on the old position, it mounted a message above
      // for a frame and dropped it unmeasured, moving the text with no scroll event to read the anchor.
      scrollTop = box.scrollTop;
      if (lifting) liftFrom += shift;
    }
  }

  /** The bottom message's height, at most ten times a second: what the pin follows. */
  const tail = new TailHeight(TAIL_GAP_MS, () => { const last = rows.at(-1); return last ? (heights.get(last.id) ?? slots.estimateOf(last)) : 0; });
  $effect(() => () => tail.stop());

  /**
   * Every rendered message reports its height here and says which id it is. The rise plays once per message: a second
   * element for the same id, minted when the window scrolled back over it, opens with the animation off.
   */
  function track(node: HTMLElement, { row }: { row: TimelineRow; joined: string | null }): { update(next: { row: TimelineRow; joined: string | null }): void; destroy(): void } {
    const id = row.id;
    node.dataset['mid'] = id;
    if (!row.first) { node.dataset['rest'] = ''; node.dataset['message'] = row.message.id; }
    // A message rises as it arrives at the bottom being watched. One that a
    // scroll up the history brings into the window is already there: rising
    // then animated every message a fast scroll crossed.
    // The core's copy of a prompt sent from here replaces the row already on
    // screen: same height, and it does not rise a second time.
    const local = row.first ? store.landedFrom?.(id) : undefined;
    if (local !== undefined && risen.has(local)) {
      risen.add(id);
      const height = heights.get(local);
      if (height !== undefined && !heights.has(id)) heights.set(id, height);
    }
    // The rest of a cut message is the same message going on: it never rises on its own.
    if (risen.has(id) || !pinned || !row.first) node.style.animation = 'none';
    risen.add(id);
    anchors.nodes.set(id, node);
    boxes?.observe(node);
    return {
      update: ({ row: next, joined }) => { if (gapChanged(node, joined, !next.first)) { boxes?.unobserve(node); boxes?.observe(node); } },
      destroy() {
        boxes?.unobserve(node);
        // A second element for the same row may already have taken its place.
        if (anchors.nodes.get(id) === node) anchors.nodes.delete(id);
      }
    };
  }

  $effect(() => {
    const box = viewport;
    if (!box) return;
    if (!restoredReading) {
      restoredReading = true;
      if (savedReading && !savedReading.pinned) {
        box.scrollTop = savedTop;
        // What is loaded now is the baseline: the button counts what arrives after.
        untrack(markSeen);
      }
    }
    viewHeight = box.clientHeight;
    readEndRoom(box);
    scrollTop = box.scrollTop;
    if (typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const pending = new Map<Element, ResizeObserverEntry>();
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) pending.set(entry.target, entry);
      // Pinned, the list follows what grows at its bottom in this same frame: the observer runs
      // after layout, so the new line is painted already in view (docs/internals/performance.md).
      if (following()) edge.follow(box);
      if (frame) return;
      // Applying slot heights inside ResizeObserver can resize that same batch.
      frame = requestAnimationFrame(() => {
        frame = 0;
        const batch = measurable([...pending.values()], id => slots.indexOf(rows, id) >= 0);
        pending.clear();
        // Estimated rows can be taller than their slot totals. Keep the actual
        // visible message, then align it after Svelte updates the spacers.
        rememberAnchor();
        const anchor = anchors.current;
        onMeasured(batch);
        // A row growing below moves no scroll position: the gap a later notch down is measured against grows with it.
        void tick().then(() => { restoreAnchor(anchor); if (box.scrollTop === scrollTop) scrolledGap = box.scrollHeight - box.scrollTop - box.clientHeight; });
      });
    });
    boxes = observer;
    observer.observe(box);
    for (const node of anchors.nodes.values()) observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      pending.clear();
      boxes = undefined;
    };
  });

  function atBottom(box: HTMLDivElement): boolean { return box.scrollHeight - box.scrollTop - box.clientHeight < 80; }

  let scrolledHeight = 0, scrolledGap = 0;
  function onscroll() {
    const box = viewport;
    if (!box) return;
    const height = box.scrollHeight;
    const resized = height !== scrolledHeight, shrank = height < scrolledHeight;
    scrolledHeight = height;
    // The browser keeping the text in place as a row above grows moves the list down, never nearer its bottom.
    const distance = height - box.scrollTop - box.clientHeight, closer = distance < scrolledGap - 1; scrolledGap = distance;
    // Pulled up by a finger or the scrollbar thumb, the list leaves the bottom as the wheel does.
    if (hold.held && box.scrollTop < scrollTop - 1) leftBottom = true;
    anchors.release(box);
    const relaid = edge.relaid(box), moved = edge.moved(box);
    // `scrollTop` lags the observer's follows; the edge alone counts this list's own corrections.
    const rose = moved < -1, descended = moved > 1 && box.scrollTop > scrollTop + 1;
    scrollTop = box.scrollTop;
    viewHeight = box.clientHeight;
    if (navigationTarget || promptTarget) return;
    // Read the anchor after the render, before another navigation can restore it.
    void tick().then(rememberAnchor);
    if (glide.active) {
      if (distance > 1) return;
      endGlide(false);
    }
    // A busy phone can deliver touchstart after its scroll; content growth alone cannot clamp it upward.
    if (rose && pinned && distance > 1 && !shrank && !relaid) leftBottom = true;
    // Scrolled down into the tolerance, the reader is back: a streaming answer keeps moving the very bottom. Moved down
    // as far from it, by a row growing above after a small notch up, the list took it back and bounced each notch.
    if (descended && closer && atBottom(box)) leftBottom = false;
    // A card shrinking can clamp scrollTop before new output grows the list again; so can its own box growing and shrinking back (`relaid`).
    pinned = !cutBelow && !leftBottom && (atBottom(box) || (pinned && (resized || relaid) && !hold.held));
    if (anchors.restoring) pinned = false;
    // Away from the bottom, the way back shows, whether or not anything new came in.
    behind = !pinned;
    if (pinned) markSeen();
    loadAbove(box);
    pullNewer(store, box, LOAD_AT);
  }

  /** A wheel turned up leaves the bottom at once: waiting for the 80 px that unpin it let a
   *  streaming answer pull the first notches of a smooth wheel back down, frame after frame. */
  let leftBottom = false;
  function onwheel(event: WheelEvent) {
    releaseNavigation();
    // Away from the bottom already, a notch releases nothing: asking where it turns would read the list's box.
    if (!viewport || (leftBottom && !pinned) || !wheelsUp(event, viewport)) return;
    leftBottom = true;
    if (pinned) { pinned = false; behind = true; }
  }

  /** A finger, a text selection or the scrollbar thumb holds the list where it is; the glide is what
   *  "Jump to latest" starts, whose scroll events neither unpin the list nor bring the button back. */
  const hold = new PointerHold(), glide = new BottomGlide(), edge = new BottomEdge();
  function press(event: PointerEvent | TouchEvent) { releaseNavigation(); hold.press(event); }
  function inspectFailures(opening: boolean) {
    if (opening) { releaseNavigation(); pinned = false; leftBottom = true; rememberAnchor(); }
    else if (viewport && viewport.scrollHeight <= viewport.clientHeight + 1) { pinned = true; leftBottom = false; behind = false; }
  }
  /** The turn whose answer is under the pointer: its summary shows from any of its messages (`pointedTurn`). */
  let pointed = $state<string | null>(null);
  /** Whether the list keeps to the bottom right now: pinned, and nobody is moving it. */
  const following = () => pinned && !navigationTarget && !glide.active && !hold.held;

  // -- paging: `pullOlder` and `pullNewer` (lib/reading-window.ts). Everything above is the windowing. --

  /** How close to the top the viewport gets before the page above it is asked for. */
  const LOAD_AT = 400;

  /** The page above the window, its height put back into the scroll position (`pullOlder`), on a core that pages by cursor alone. */
  const loadAbove = (box: HTMLElement) => positional ? undefined : pullOlder(store, box, LOAD_AT, rows[0]?.id, head => totals(rows)[Math.max(0, head ? rows.findIndex(row => row.id === head) : rows.length)] ?? 0, () => { scrollTop = box.scrollTop; }, id => anchors.nodes.get(id));
  // On a core that places pages, the gap within a screen of the bottom, or `READ_AHEAD` screens of a reader above it, is read before it shows (lib/history-gaps.ts).
  const asked = new RangeAsk(); onDestroy(() => asked.stop());
  $effect(() => { void [measured, store.loadingRange, rows, viewHeight, pinned, scrollTop]; asked.soon(() => { if (!gapped.gaps.length || store.loadingRange || glide.active || lifting) return null; const total = totals(rows), reach = Math.max(LOAD_AT, viewHeight * (pinned ? 1 : READ_AHEAD)), top = pinned ? (total[rows.length] ?? 0) - viewHeight : scrollTop;
    return { top, range: wantedRange(total, gapped.gaps, top - reach, top + viewHeight + reach, MESSAGE_PAGE) }; }, ({ from, limit, below }) =>
      // A page landing above the reader can weigh more than its gap: the row at the top of the view stays where it was, drawn.
      loadKeepingReader(landing => store.loadRange(from, limit, landing, below), () => pinned ? undefined : viewport, kept => { const total = totals(rows), at = slots.indexOf(rows, kept.id); if (at >= 0) scrollTop = Math.max(0, (total[at] ?? 0) - kept.offset); anchors.hold({ ...kept, message: anchors.nodes.get(kept.id)?.dataset['message'] ?? kept.id }); }, tick, top => { scrollTop = top; })); });
  // A list too short to scroll asks for the pages beside it, again after each lands (`fillShort`).
  $effect(() => { void rows.length; void viewHeight; fillShort(viewport, store.openThread?.id === threadId, () => !!(navigationTarget || promptTarget), LOAD_AT, box => { loadAbove(box); pullNewer(store, box, LOAD_AT); }); });

  // The reader's own prompt takes the bottom, wherever the history was scrolled to.
  let jumpedFor = '';
  $effect(() => {
    const last = messages.at(-1);
    if (!last || !isSending(last) || last.id === jumpedFor) return;
    jumpedFor = last.id;
    untrack(jump);
  });

  function jump() {
    releaseNavigation();
    const box = viewport;
    if (!box) return;
    // A window short of the end reads the last page first, then lands at its bottom.
    if (cutBelow) { void store.loadLatest().then(() => { if (!cutBelow) jump(); }); return; }
    reservePrompt = null;
    behind = false;
    markSeen();
    leftBottom = false;
    // The room reserved under a lifted prompt leaves with this flush: the bottom is read after it.
    void tick().then(() => { if (box.isConnected) descend(box); });
  }

  /** To the bottom of `box`: at once when it is there or motion is reduced, on a glide otherwise. */
  function descend(box: HTMLDivElement) {
    behind = false;
    if (glides() && box.scrollHeight - box.clientHeight - box.scrollTop > 1) { glide.start(box, () => endGlide(true)); return; }
    pinned = true;
    edge.follow(box);
    scrollTop = box.scrollTop;
  }

  /** The glide is over: arrived or out of time, the list pins again; taken over by the reader, it stays where it stopped. */
  function endGlide(arrived: boolean) {
    if (!glide.active) return;
    glide.stop();
    const box = viewport;
    if (!box) return;
    if (arrived) {
      edge.follow(box);
      scrollTop = box.scrollTop;
    }
    pinned = arrived || atBottom(box);
    behind = !pinned;
    if (pinned) markSeen();
  }

  $effect(() => () => { glide.stop(); hold.release(); });

  /** Follow new messages and measured tail growth, never text deltas. */
  $effect(() => {
    void timeline.length;
    // A long answer being written gains rows as it is cut: the bottom is still its last one.
    void rows.length;
    void tail.value;
    const box = viewport;
    if (!box) return;
    const opened = shown !== threadId;
    shown = threadId;
    if (promptTarget && !pinned) {
      behind = false;
      untrack(markSeen);
    } else if (opened || pinned) {
      // Held by the reader or on its way down, the list is still at the bottom: it takes the new height once free.
      if (opened || untrack(following)) {
        // Followed, the live end lets go of the messages far above it, and the heights measured for them; never those within reach of the view.
        if (untrack(following) && untrack(() => store.releaseOlder(threadId, () => heldNear(totals(rows), rows, messages, viewHeight * (READ_AHEAD + 1), views))) > 0) void tick().then(() => keepOnly([heights, risen], rows, messages));
        scrolledHeight = box.scrollHeight; edge.follow(box); scrollTop = box.scrollTop;
      }
      pinned = true; behind = false;
      untrack(markSeen);
    } else if (!glide.active) {
      behind = true;
    }
  });

  /** Only once the loaded window reaches the thread's end: newer history still unread is not its last word. */
  let closingShown = $derived(closing !== null && store.messagesAfter === null && !store.loadingNewer);
  /** A line lands at the foot of a pinned list: the bottom takes it in, like a new message. */
  function followFoot(): void {
    const box = viewport;
    if (box && following()) void tick().then(() => { if (following()) edge.follow(box); });
  }

  /** The window moving under a pinned viewport changes the spacers: take the bottom again. */
  $effect(() => {
    void view;
    if (!untrack(following)) return;
    const box = viewport;
    if (!box) return;
    edge.follow(box);
  });

  // Finished and streaming messages are derived apart, so a delta never rescans the thread.
  const progress = new TurnProgress(() => messages);
  /** One model attribution per turn, independent of the rendered window and streamed parts. */
  const firstAssistantInTurn = $derived(firstAssistantByTurn(messages));
  /** The last row of each turn: a later message of the same turn replaces an earlier one. */
  const lastInTurn = $derived(new Map(timeline.map((message): [string, string] => [message.turnId, message.id])));
  const firstInTurn = $derived(firstByTurn(messages));
  /** Each turn end's files and the tool line its count joins (`lib/turn-changes.svelte.ts`). */
  const turnChanges = new TurnChanges(() => store, () => threadId, () => messages,
    () => timeline.filter(message => !cards.has(message.id) && !grouped.groups.has(message.id) && !shaped.folds.has(message.id) && !movedBy(message) && !startedFrom(message)));

  /**
   * Edit and retry go through the core's rewind, fork through its fork, and only on a thread at rest: a turn still
   * running is stopped first (Escape). A persistent agent's thread rewinds like any other, but has no project to fork into.
   */
  const branchable = $derived(store.openThread?.id === threadId && (!!store.openThread.agentSessionId || store.openThread.projectId !== null));
  const forkable = $derived(branchable && !store.openThread?.agentSessionId);
  // A prompt still waiting in the queue would run after the edit, on the rewound thread, as would an edit started under a prompt still on its way to the core.
  const atRest = $derived(branchable && !store.busy && (store.composerStates[threadId]?.queued.length ?? 0) === 0 && !store.composerStates[threadId]?.sending);

  async function editMessage(message: Message): Promise<void> {
    if (await editWhole(store, threadId, message)) focusComposer({ typing: true });
  }

  /** The last turn again from its own prompt, on screen before the core rewinds (`retryTurn`). */
  async function retry(turnId: string): Promise<void> {
    const prompt = messages.find((message) => message.turnId === turnId && message.role === 'user');
    if (prompt) await retryTurn(store, threadId, prompt);
  }

</script>

<div class="timeline-wrap">
  {#if store.findOpen && FindBar}
    <FindBar {messages} {viewport} request={store.findRequest} jump={(id, part) => jumpToMessage(id, part)}
      rowOf={(id, part) => { const row = rows[rowIndexOf(rows, id, part)]; return row?.failures ? { id: `failure:${id}`, from: 0 } : row ?? { id, from: 0 }; }} onclose={() => (store.findOpen = false)} />
  {/if}
  {#if !narrow.current}<MessageOutline {messages} active={activePrompt} jump={id => void jumpToMessage(id)}
    hasOlder={store.messagesBefore !== null} loading={store.loadingOlder} loadOlder={() => { if (viewport) { releaseNavigation(); viewport.scrollTop = rows[0]?.gap ? Math.max(0, (totals(rows)[1] ?? 0) - viewport.clientHeight) : 0; pinned = false; loadAbove(viewport); } }} />{/if}
  <!-- Input releases restored and navigation anchors; programmatic corrections keep them. A tap on a phone shows a message's buttons. -->
  <!-- The top fade is sticky inside the padding: it is told the padding a sent prompt's lead adds, or it would hang that far under the header, a dark band across the prompt's lines. -->
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div class="timeline" bind:this={viewport} use:watchWheel={onwheel} use:selectionClicks onclick={reveal.tap} {onscroll} ontouchstart={press} onpointerdown={press} onpointerover={(event) => { pointed = pointedTurn(event); }} onpointerleave={() => { pointed = null; }} onkeydown={releaseNavigation} style:padding-top="{20 + promptLead}px" style:--scroll-edge-top="{20 + promptLead}px" style:overflow-anchor={timeline.at(-1)?.state === 'streaming' ? 'none' : undefined} class:below={!pinned} data-testid="timeline" data-media-gallery data-scroll-root>
    <div class="column" bind:this={column}>
      <!-- paging: the one line the top of the list shows while a page is in flight. -->
      {#if store.loadingOlder}<p class="loading-older" data-testid="loading-older">{strings.chat.loadingOlder}</p>{/if}
      {#if view.above > 0}<div class="spacer" data-testid="timeline-above" style="height: {view.above}px"></div>{/if}
      {#each rendered as row, index (row.id)}
        {#if row.gap}<TimelineGap {...row.gap} />{:else}
        {@const message = row.message}
        {@const group = grouped.groups.get(message.id)}
        {@const turn = store.openThread?.turns.find(turn => turn.id === message.turnId)}
        {@const source = group || viewPart(message) || publishedFile(message) ? messages.findLast(current => current.turnId === message.turnId) : message}
        {@const quietFold = shaped.folds.get(message.id)}
        {@const closes = row.last && !quietFold && turn !== undefined && turn.execution?.operation !== 'keepalive' && lastInTurn.get(turn.id) === message.id}
        {@const joined = seam(rows[view.start + index - 1], row)}
        {@const host = turn ? turnChanges.hostOf(turn.id) : null}
        <!-- The turn's change count, on the tool line of its last change (`inline`) or at its end. -->
        {#snippet changes(inline: boolean)}
          {@const files = turn ? turnChanges.filesOf(turn) : null}
          {#if files}<TurnFiles {store} {...files} {inline} acquireDiff={source => store.acquireToolOutput(threadId, source.messageId, source.toolId, false)} />{/if}
        {/snippet}
        <article
          use:track={{ row, joined }}
          class="message {message.role}"
          class:rest={!row.first} {...reveal.attrs(message)}
          data-seam={joined}
          style:margin-top={joined && 'calc(var(--chat-block-gap) - var(--chat-message-gap))'}
          data-testid={row.first ? 'message' : 'message-rest'}
          data-role={group ? 'agent-mail' : message.role} data-turn={message.turnId}
        >
          {#if row.first && days.has(message.id)}<DayDivider at={days.get(message.id)!} />{/if}
          {#if row.first && turn?.switched && message.role !== 'assistant' && firstInTurn.get(message.turnId) === message.id}<SwitchMarker names={store} shown={turn.switched} />{/if}
          {#if row.failures}
            <FailedAttempts {store} {threadId} messages={row.failures} turns={shownTurns} {signedOut} canFork={!narrow.current && forkable && !store.openThread?.incognito} reveal={failureTarget} oninspect={inspectFailures} />
          {:else if quietFold}
            <TurnFoldRow fold={quietFold} at={message.createdAt} compactions={shaped.compactions.get(quietFold.turnId)} />
          {:else if cards.has(message.id)}
            <TimelineCard {store} card={cards.get(message.id)!} {mail} />
          {:else if group}
            <AgentMessageGroup {store} {group} />
          {:else if movedBy(message)}
            <MoveMarker notice={movedBy(message)!} />
          {:else if startedFrom(message)}
            <SpawnMarker {store} link={startedFrom(message)!} direction="to" />
          {:else if message.role !== 'assistant' && firstInTurn.get(message.turnId) === message.id && wakeKind(turn) && (message.role === 'system' || turn?.execution?.operation === 'routine' || turn?.execution?.operation === 'event')}
            <WakeMarker {message} kind={wakeKind(turn)!} />
          {:else if message.role === 'user'}
            <UserMessage {store} {message} {turn} accepted={!!turn} responded={progress.responded(message.turnId)} edit={atRest && !isSending(message) ? () => void editMessage(message) : undefined} />
          {:else}
            <AssistantMessage {store} {threadId} {message} from={row.from} to={row.to} {signedOut} showModel={row.first && firstAssistantInTurn.get(message.turnId) === message.id}
              latestInTurn={lastInTurn.get(message.turnId) === message.id} views={views.get(message.turnId)}
              changes={host?.messageId === message.id ? { at: host.index, line: changes } : undefined} />
          {/if}
          {#if turn && closes}
            {@const marks = summaryMarks(shaped, turn.id, () => store.panel.open('desk'))}
            <!-- A line that counts the turn's steps carries its changes too: one line, never a card over it. -->
            {@const merged = !host && !!marks.steps && turn.status !== 'running'}
            {#snippet onLine()}{@render changes(true)}{/snippet}
            {#if !host && !merged}{@render changes(false)}{/if}
            {@const carded = failureCarded(turn, messages)}<!-- A failure's card holds its cause and its one Retry: the line keeps copy, fork and the background stop; a question at the composer's top is a running turn's status. -->
            {#if !(asking && turn.status === 'running')}
            <MessageTurnSummary {store} {threadId} {turn} {carded} turns={shownTurns} message={source ?? message} {messages} pointed={pointed === turn.id} tucked={!reveal.shows(message)}
              {...marks} changes={merged ? onLine : undefined}>
              {#snippet actions()}
                <MessageActions
                  text={() => turnAnswer(messages, turn.id)}
                  retry={atRest && !carded && store.openThread?.turns.at(-1)?.id === turn.id ? () => void retry(turn.id) : undefined}
                  fork={!narrow.current && forkable && !store.openThread?.incognito && source && source.state !== 'streaming' ? (worktree) => void store.fork(source.id, { worktree }) : undefined}
                  plugin={store === workspace.primary && source ? { threadId, messageId: source.id, role: 'assistant' } : undefined}
                />
              {/snippet}
            </MessageTurnSummary>
            {/if}
          {/if}
        </article>
        {/if}
      {/each}
      {#if view.below > 0}<div class="spacer" data-testid="timeline-below" style="height: {view.below}px"></div>{/if}
      {#if store.loadingNewer}<p class="loading-older" data-testid="loading-newer">{strings.chat.loadingNewer}</p>{/if}
      <TimelineFoot {store} {threadId} pending={!cutBelow && !isSending(timeline.at(-1) ?? { id: '' })} closing={closingShown ? closing : null} onlanded={followFoot} />
    </div>
    {#if promptRoom > 0}<div class="spacer" data-testid="prompt-room" style:height="{promptRoom}px" aria-hidden="true"></div>{/if}
  </div>

</div>
{#if viewer.viewing}{@const view = viewer.viewing}<Deferred part={parts.ImageViewer} floating>{#snippet children(ImageViewer)}<ImageViewer items={view.items} index={view.index} onclose={() => viewer.close()} />{/snippet}</Deferred>{/if}

<style>
  /* Chrome on demand: under a pointer, the fold chevrons of the tool rows and
     the transcript blocks and the turn's "i" show on the row's hover or
     keyboard focus; the rows stay buttons and the "i" stays in the tab
     order, so nothing is out of reach. A finger always sees them. */
  @media (hover: hover) {
    .timeline :global(:is(.fold-caret, .summary .info-tip)) { opacity: 0; transition: opacity var(--dur-2) var(--ease-out-quint); }
    .timeline :global(:is(button, summary):is(:hover, :focus-visible) .fold-caret),
    .timeline :global(.summary:is(:hover, :focus-within) .info-tip),
    .timeline :global(.info-tip[aria-expanded='true']) { opacity: 1; }
  }

  .timeline-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .timeline {
    flex: 1;
    min-height: 0;
    /* A column for the prompt's room under it; a short thread starts at the
       top, so a decision docking below moves none of its lines. */
    display: flex;
    flex-direction: column;
    overflow: auto;
    scrollbar-gutter: stable both-edges;
    /* Balance the outline rail on both sides. The dock below is in the flow,
       so the timeline ends where it starts and nothing runs under it; a line
       cut by that end fades over the shared edge (app.css `--scroll-edge`,
       `.below`). That fade takes its own room in the flow (`::after` below),
       so at the end the last table or code row sits clear of it and of the
       composer card. */
    --scroll-edge-bottom: 20px;
    padding: 20px var(--outline-room) var(--scroll-edge-bottom);
    overscroll-behavior: contain;
    /* Phone toasts reserve room above the composer (notify-corner.ts and .css). */
    transition: margin var(--dur-2) var(--ease-out-quint);
  }

  /* The bottom edge fades on the list's own state, the one that brings "Latest"
     back: whatever lies below, the last line over the dock fades instead of
     being cut. A state, not a scroll timeline, so a still frame shows it too;
     two attributes outrank app.css's shared `.scroll-edges` rule. */
  .timeline[data-scroll-root][data-testid]::after {
    /* In the flow, not pulled over the last row: scrolled to the end, the fade
       lies on empty room under it instead of on a table's last line. */
    margin-top: 0;
    animation: none;
    opacity: 0;
    transition: opacity var(--motion-duration) var(--motion-curve);
  }
  .timeline.below[data-scroll-root][data-testid]::after { opacity: 1; }
  /* Under the header the shared edge is a line tall, not a sliver: a line scrolled under it fades out whole, never cut through its letters. */
  @supports (animation-timeline: scroll()) {
    .timeline[data-scroll-root][data-testid]::before { --top-edge: calc(var(--scroll-edge) * 3); height: var(--top-edge); margin-bottom: calc(-1 * var(--top-edge));
      animation-range: var(--scroll-edge-top, 0px) calc(var(--scroll-edge-top, 0px) + var(--top-edge)); }
  }
  /* Where the fade exists it is the end's room, the shared edge, plus this padding. */
  @supports (animation-timeline: scroll()) { .timeline { --scroll-edge-bottom: var(--space-2); } }

  .column {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: var(--chat-message-gap);
    width: 100%;
    max-width: var(--content);
    margin: 0 auto;
    /* One reading column: bubbles, prose and cards take the dock's width. */
    --prose: var(--content);
  }

  /* What a long thread's unrendered messages weigh, above and below the window. */
  .spacer { flex: 0 0 auto; }

  /* paging: one muted line at the top while the page above is being read. */
  .loading-older { flex: 0 0 auto; text-align: center; color: var(--color-muted-foreground); font-size: var(--text-sm); }

  .message {
    display: flex;
    flex-direction: column;
    animation: rise var(--dur-3) var(--ease-out-quint);
  }

  .message.user { align-items: flex-end; }

  /* The rest of a cut message: the gap its first paragraph takes inside a message, and no rise of its own. */
  .message.rest {
    margin-top: calc(var(--chat-block-gap) - var(--chat-message-gap));
    animation: none;
  }
</style>
