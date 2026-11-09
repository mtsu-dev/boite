<script lang="ts">
  import { tick } from 'svelte';
  import { ChevronDown, RefreshCw } from '@lucide/svelte';
  import type { GitChange, GitDiff, GitStatus, ThreadId } from '@boite/contracts';
  import type { BoundPanel, Surface } from '../lib/right-panel.svelte';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { diffCountsOf, type DiffSource } from '../lib/diff';
  import type { MenuItem } from '../lib/menu';
  import { changeCount, changeText } from '../lib/change-count';
  import { onView } from '../lib/on-view';
  import SurfaceHead from './SurfaceHead.svelte';
  import ChangeCount from './ChangeCount.svelte';
  import DiffView, { SPLIT_MIN_WIDTH } from './DiffView.svelte';
  import Menu from './Menu.svelte';
  import DiffOptions from './DiffOptions.svelte';
  import { shortPaths } from '../lib/short-paths';

  /**
   * Every changed file as one document: a sticky header per file (its status,
   * path and counts), its diff under it, one scroll for all of them. A file's
   * diff is read as it nears the screen, or at once when it is the one asked
   * for (`surface.path`), which the document scrolls to. The toolbar keeps the
   * file chip (the count of changes, its menu every file to jump to), the
   * layout menu and the refresh.
   */
  let { store, surface, panel }: { store: Store; surface: Surface; panel: BoundPanel } = $props();

  let status = $state<GitStatus | null>(null);
  let loading = $state(false);

  let threadId = $derived(store.openThread?.id ?? null);
  // Its bar is drawn in the panel's strip, which can read it once more after the tab is gone.
  let selected = $derived((surface as Surface | null)?.path ?? null);
  /** Every turn that ended, so the list is read again the moment the agent stops writing. */
  let finished = $derived(store.openThread?.turns.filter((turn) => turn.finishedAt !== null).length ?? 0);

  /** One letter per status, the one `git status --short` prints. */
  const LETTERS: Record<GitChange['status'], string> = {
    added: 'A',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
    untracked: 'U',
    conflict: '!'
  };

  function directory(path: string): string {
    const cut = path.lastIndexOf('/');
    return cut < 0 ? '' : path.slice(0, cut + 1);
  }

  function base(path: string): string {
    const cut = path.lastIndexOf('/');
    return cut < 0 ? path : path.slice(cut + 1);
  }

  /** Bumped by the refresh button, so the status and the diffs are all read again. */
  let asked = $state(0);
  /** The last status request; an older answer that lands after it is dropped. */
  let latest = 0;
  /** The thread the list on screen belongs to. */
  let listed: ThreadId | null = null;

  async function refresh(id: ThreadId): Promise<void> {
    const mine = ++latest;
    loading = true;
    try {
      const answer = await store.gitStatus(id);
      // The thread may have changed, or a newer read gone out, while the call
      // was out: an answer about another working tree must not land in this list.
      if (mine === latest && threadId === id) status = answer;
    } finally {
      if (mine === latest) loading = false;
    }
  }

  /** Under this width a header is a finger's target. */
  const NARROW_MAX = 600;
  let width = $state(0);
  let narrow = $derived(width > 0 && width < NARROW_MAX);
  let changes = $derived(status?.changes ?? []);
  /** The files drawn: the list, and the file asked for on top while the list does not hold it. */
  let entries = $derived<{ path: string; change: GitChange | null }[]>(
    status && selected !== null && !changes.some((change) => change.path === selected)
      ? [{ path: selected, change: null }, ...changes.map((change) => ({ path: change.path, change }))]
      : changes.map((change) => ({ path: change.path, change }))
  );

  /** The status dot's tone in the file menu, the same reading as the header's badge. */
  const TONES: Record<GitChange['status'], NonNullable<MenuItem['status']>['tone']> = {
    added: 'success', copied: 'success', modified: 'warning', deleted: 'danger', conflict: 'danger', renamed: 'neutral', untracked: 'neutral'
  };
  /** Each file by the shortest tail of its path no other changed file shares: two `+page.svelte` read apart. */
  let names = $derived(shortPaths(changes.map((change) => change.path)));
  let files = $derived<MenuItem[]>(changes.map((change) => ({
    id: change.path,
    label: names.get(change.path) ?? base(change.path),
    title: change.path,
    hint: ((lines) => changeText(changeCount(null, lines.added, lines.removed)) || undefined)(countsOf(change)),
    status: { tone: TONES[change.status], label: strings.changes.status[change.status] },
    checked: change.path === selected,
    radio: true,
    testid: 'changes-outline-file'
  })));

  /** A pick in the chip's menu: the tab remembers it, and the document scrolls to its header. */
  function pickPath(path: string): void {
    folded = { ...folded, [path]: false };
    jumped = path;
    panel.update(surface.id, { path });
    void tick().then(() => scrollTo(path));
  }

  /** A header folds its file away or opens it again; either way it becomes the file the tab remembers. */
  let folded = $state<Record<string, boolean>>({});
  function toggle(path: string): void {
    folded = { ...folded, [path]: !folded[path] };
    jumped = path;
    if (path !== selected) panel.update(surface.id, { path });
    // A file folded from its stuck header keeps its header in view, not the middle of the next file.
    void tick().then(() => {
      const section = sectionOf(path);
      if (section && body && section.offsetTop < body.scrollTop) body.scrollTop = section.offsetTop;
    });
  }

  /** A read diff, with the text pair it is drawn from: one object per answer, so its rows and counts are read once. */
  type Read = { diff: GitDiff | null; source: DiffSource | null };
  let diffs = $state.raw<Record<string, Read>>({});
  /** The files whose diff is wanted: seen near the screen. The file asked for always is. */
  let wanted = $state<Record<string, true>>({});
  /** The last read of each file: which round of triggers, with which origin. */
  const reads = new Map<string, { round: string; from: string | null | undefined; seq: number }>();
  let diffSeq = 0;
  /** The thread the diffs on screen belong to. */
  let diffThread: ThreadId | null = null;

  /**
   * A file's lines added and removed, counted from its diff once read, so the
   * figure beside it always matches the rows under it; git's own until then.
   */
  function countsOf(change: GitChange): { added: number | null; removed: number | null } {
    const source = diffs[change.path]?.source;
    return source ? diffCountsOf(source) : { added: change.additions, removed: change.deletions };
  }

  let branchTitle = $derived([status?.branch ?? strings.changes.noBranch, status?.upstream].filter(Boolean).join(' → '));
  /** The commits to send and to receive, in words: the layout menu's branch row says them under its name. */
  let tracking = $derived([
    status && status.ahead > 0 ? fill(strings.changes.ahead, { count: String(status.ahead) }) : '',
    status && status.behind > 0 ? fill(strings.changes.behind, { count: String(status.behind) }) : ''
  ].filter(Boolean).join(', '));

  /** Every file's lines in all: git's figures, each read file's counted from its diff. */
  let total = $derived(changes.reduce((sum, change) => {
    const lines = countsOf(change);
    return { added: sum.added + (lines.added ?? 0), removed: sum.removed + (lines.removed ?? 0) };
  }, { added: 0, removed: 0 }));

  // On mount, and again on every turn that ends: the working tree is what the
  // agent is changing, so the list is stale the moment a turn finishes.
  $effect(() => {
    const id = threadId;
    void finished;
    void asked;
    // Another thread's files never stay on screen while this one's are read.
    if (id !== listed) {
      listed = id;
      status = null;
    }
    if (id !== null) void refresh(id);
  });

  /** The rename origin the list gives a file: null for none, undefined while the list does not hold it. */
  function originOf(path: string): string | null | undefined {
    if (!status) return undefined;
    const change = status.changes.find((entry) => entry.path === path);
    return change ? (change.oldPath ?? null) : undefined;
  }

  // Each wanted file's diff, read on the same triggers as the status and at the
  // same time, not after it: the reads do not depend on each other. The list's
  // origin goes with it, so the core skips a second status of its own. A
  // refresh keeps the old diff on screen until the new one replaces it; only
  // another thread starts from blank.
  $effect(() => {
    const id = threadId;
    const round = `${finished}:${asked}`;
    const paths = new Set(Object.keys(wanted));
    if (selected !== null) paths.add(selected);
    if (id !== diffThread) {
      diffThread = id;
      diffs = {};
      reads.clear();
    }
    if (id === null) return;
    for (const path of paths) {
      const from = originOf(path);
      // A status that lands re-runs this. The read of this round still holds when
      // it went out with the same origin, or with none (the core then asked git
      // itself): only an origin that moved, a rename staged meanwhile, is read again.
      const last = reads.get(path);
      if (last && last.round === round && (last.from === from || last.from === undefined || from === undefined)) continue;
      const mine = ++diffSeq;
      reads.set(path, { round, from, seq: mine });
      void store.gitDiff(id, path, undefined, from).then((answer) => {
        if (reads.get(path)?.seq !== mine || diffThread !== id) return;
        const source = answer && !answer.binary ? { oldText: answer.oldText ?? '', newText: answer.newText ?? '' } : null;
        diffs = { ...diffs, [path]: { diff: answer, source } };
      });
    }
  });

  /** Near the screen, a file's diff is read. Without an observer only the file asked for is. */
  function near(node: HTMLElement, path: string) {
    if (typeof IntersectionObserver === 'undefined') return {};
    return onView(node, () => { if (!wanted[path]) wanted[path] = true; }, '600px');
  }

  /** The document's scroll; the file asked for is brought to its top once, when it is asked for or first drawn. */
  let body = $state<HTMLDivElement>();
  let jumped: string | null = null;
  /**
   * The file held at the top after a jump. The diffs above it land after the
   * jump and push it down, so each one that lands puts it back, until the
   * reader scrolls on their own.
   */
  let pinned: string | null = null;
  function sectionOf(path: string): HTMLElement | undefined {
    return [...(body?.querySelectorAll<HTMLElement>('[data-file]') ?? [])].find((node) => node.dataset['file'] === path);
  }
  function place(): void {
    const section = pinned === null ? undefined : sectionOf(pinned);
    if (section && body) body.scrollTop = section.offsetTop;
  }
  function scrollTo(path: string): void {
    pinned = path;
    place();
  }
  function release(): void {
    pinned = null;
  }
  $effect(() => {
    void diffs;
    if (pinned !== null) void tick().then(place);
  });
  $effect(() => {
    const path = selected;
    const count = entries.length;
    if (path === null || path === jumped || count === 0 || !body) return;
    jumped = path;
    void tick().then(() => scrollTo(path));
  });
  /** The code's own width: the side by side switch is offered only where two columns can be read. */
  let codeWidth = $state(0);
</script>

<div class="changes-surface" class:narrow data-testid="changes-panel" bind:clientWidth={width}>
  <!-- Its head: the files and their one count (the chip lists them), the layout, the refresh. -->
  <SurfaceHead>
    {#if status && changes.length > 0}
      <span class="picker">
        <Menu items={files} onpick={pickPath} placement="bottom" variant="text" label={strings.changes.fileList} testid="changes-pager">
          <span class="total" data-testid="changes-count"><ChangeCount files={changes.length} added={total.added} removed={total.removed} /></span>
          <ChevronDown size={13} strokeWidth={1.75} />
        </Menu>
      </span>
    {:else if status}
      <span class="total" data-testid="changes-count"><ChangeCount files={0} added={0} removed={0} /></span>
    {:else}
      <span class="total" data-testid="changes-count">{strings.changes.loading}</span>
    {/if}
    <span class="spacer"></span>
    {#if status}<DiffOptions split={codeWidth >= SPLIT_MIN_WIDTH} branch={{ name: status.branch ?? strings.changes.noBranch, title: branchTitle, hint: tracking || undefined }} />{/if}
    <button
      type="button"
      class="icon-button refresh"
      title={strings.common.refresh}
      aria-label={strings.common.refresh}
      data-testid="changes-refresh"
      disabled={loading}
      onclick={() => asked++}
    >
      <RefreshCw size={14} strokeWidth={1.75} />
    </button>
  </SurfaceHead>

  <!-- The reader's own wheel, touch, press or key lets go of a jump's hold; the scroll itself is no control. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="detail" bind:this={body} bind:clientWidth={codeWidth} onwheel={release} ontouchstart={release} onpointerdown={release} onkeydown={release}>
    {#if status && status.changes.length === 0 && entries.length === 0}
      <p class="empty" data-testid="changes-empty">{strings.changes.clean}</p>
    {/if}
    {#each entries as { path, change } (path)}
      {@const read = diffs[path]}
      {@const open = !folded[path]}
      <section class="file" data-file={path} use:near={path}>
        <button
          type="button"
          class="row"
          class:on={path === selected}
          aria-expanded={open}
          aria-current={path === selected ? 'true' : undefined}
          data-testid="changes-row"
          data-path={path}
          data-status={change?.status}
          title={[path, change?.oldPath ? fill(strings.changes.renamedFrom, { path: change.oldPath }) : '', change?.staged ? strings.changes.staged : ''].filter(Boolean).join('\n')}
          onclick={() => toggle(path)}
        >
          <span class="fold" class:open aria-hidden="true"><ChevronDown size={14} strokeWidth={1.75} /></span>
          {#if change}
            <span class="mark" data-status={change.status} title={strings.changes.status[change.status]}>
              <span class="ui-label">{LETTERS[change.status]}</span>
            </span>
          {/if}
          <span class="path">
            <span class="dir">{directory(path)}</span><span class="base">{base(path)}</span>
          </span>
          {#if change}
            {@const lines = countsOf(change)}
            {@const count = changeCount(null, lines.added, lines.removed)}
            <!-- Both counts keep their column, empty or not, so every header's figures line up. -->
            <span class="count added ui-label">{count.added ?? ''}</span>
            <span class="count removed ui-label">{count.removed ?? ''}</span>
          {/if}
        </button>
        {#if open}
          {#if !read}
            <!-- Read as it nears the screen: a quiet block holds its place meanwhile. -->
            <div class="pending" aria-busy="true"></div>
          {:else if !read.diff}
            <p class="empty">{strings.changes.clean}</p>
          {:else if read.diff.binary}
            <p class="empty" data-testid="changes-binary">{strings.changes.binary}</p>
          {:else}
            {#if read.diff.truncated}
              <p class="notice" data-testid="changes-truncated">{strings.changes.truncated}</p>
            {/if}
            <DiffView path={read.diff.path} oldText={read.diff.oldText ?? ''} newText={read.diff.newText ?? ''} doc={read.source ?? undefined} headless grow />
          {/if}
        {/if}
      </section>
    {/each}
  </div>
</div>

<style>
  .changes-surface {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }

  .spacer {
    flex: 1;
    min-width: 4px;
  }

  .total {
    flex: none;
    display: inline-flex;
    font-variant-numeric: tabular-nums;
  }

  .picker { flex: 0 1 auto; display: flex; min-width: 0; color: var(--color-foreground); }
  .picker :global(.menu), .picker :global(.trigger) { min-width: 0; max-width: 100%; }
  .picker :global(.trigger) { height: var(--control-sm); gap: 4px; }

  /* One scroll for every file, to the panel's edges and bottom; the last file's end is the document's. */
  .detail {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: auto;
    border-top: 1px solid var(--color-border);
  }
  .pending { height: 48px; }

  .file + .file { border-top: 1px solid var(--color-border); }

  /* A file's header stays at the top while its diff scrolls under it, then the next one takes its place. */
  .row {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: var(--row);
    padding: 0 10px 0 6px;
    border: none;
    border-bottom: 1px solid var(--color-border);
    border-radius: 0;
    background: var(--color-surface-3);
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    font-weight: 400;
    text-align: left;
  }
  /* Fingers, not a pointer: every header is a full target. */
  .narrow .row { height: auto; min-height: var(--touch-target); }

  .row:hover:not(:disabled),
  .row:focus-visible {
    background: color-mix(in srgb, var(--color-hover) 60%, var(--color-surface-3));
  }
  .row:focus-visible { outline-offset: -2px; }

  .row:active:not(:disabled) {
    transform: none;
  }

  .row.on {
    color: var(--color-foreground);
  }

  .fold { display: inline-flex; flex: none; color: var(--color-subtle); transform: rotate(-90deg); transition: transform var(--motion-duration, var(--dur-2)) var(--ease-out-quint); }
  .fold.open { transform: none; }
  @media (prefers-reduced-motion: reduce) { .fold { transition: none; } }

  /* One badge, its colour set by the status; the fill is the same colour mixed
     into the ground, so neither theme ends up light on light. */
  .mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    flex: none;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--mark) 18%, transparent);
    color: var(--mark);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .mark[data-status='added'],
  .mark[data-status='copied'] {
    --mark: var(--color-success);
  }

  .mark[data-status='deleted'],
  .mark[data-status='conflict'] {
    --mark: var(--color-danger);
  }

  /* Modified, renamed, untracked: the neutral ink. Amber means only that something needs the user, and the
     header's green and red counts already say how the file changed. */
  .mark[data-status='modified'],
  .mark[data-status='renamed'],
  .mark[data-status='untracked'] {
    --mark: var(--color-muted-foreground);
  }

  /* Cut in the middle: the folders give way first, so the path's start and the whole file name stay. */
  .path {
    display: flex;
    flex: 1;
    min-width: 0;
    white-space: nowrap;
  }

  .dir,
  .base {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dir {
    flex: 0 1000 auto;
    min-width: 3ch;
    color: var(--color-subtle);
  }
  .dir:empty { min-width: 0; }

  .base {
    flex: 0 1 auto;
    color: var(--color-foreground);
    font-weight: 500;
  }

  .count {
    flex: none;
    min-width: 4.5ch;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .count.added {
    color: var(--color-success);
  }

  .count.removed {
    color: var(--color-danger);
  }

  .empty {
    margin: 0;
    padding: 10px 12px;
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
  }

  .notice {
    margin: 0;
    padding: 6px 12px;
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
  }
</style>
