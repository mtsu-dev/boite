<script lang="ts">
  import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, GitBranch, RefreshCw } from '@lucide/svelte';
  import type { GitChange, GitDiff, GitStatus, ThreadId } from '@boite/contracts';
  import type { BoundPanel, Surface } from '../lib/right-panel.svelte';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { boxWidth } from '../lib/box-width';
  import { diffCountsOf, type DiffSource } from '../lib/diff';
  import type { MenuItem } from '../lib/menu';
  import DiffView, { SPLIT_MIN_WIDTH } from './DiffView.svelte';
  import Menu from './Menu.svelte';
  import DiffOptions from './DiffOptions.svelte';

  let { store, surface, panel }: { store: Store; surface: Surface; panel: BoundPanel } = $props();

  let status = $state<GitStatus | null>(null);
  let diff = $state<GitDiff | null>(null);
  let loading = $state(false);

  let threadId = $derived(store.openThread?.id ?? null);
  let selected = $derived(surface.path ?? null);
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

  /** Bumped by the refresh button, so the status and the diff are both read again. */
  let asked = $state(0);
  /** The last status request; an older answer that lands after it is dropped. */
  let latest = 0;
  /** The thread the list on screen belongs to. */
  let listed: ThreadId | null = null;
  /** The thread and path the diff on screen belongs to. */
  let shown: string | null = null;

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

  function select(change: GitChange): void {
    // The selection rides the tab, so it survives a switch to another surface.
    panel.update(surface.id, { path: change.path });
  }

  /** Under this width a row's targets are a finger's. */
  const NARROW_MAX = 600;
  /**
   * Under this width the list and a diff do not share the panel: the list
   * fills it until a file is picked, then the diff does, and the file chip's
   * menu is the list. From it the list is a narrow column beside the diff.
   */
  const STACKED_MAX = 900;
  let width = $state(0);
  let narrow = $derived(width > 0 && width < NARROW_MAX);
  let stacked = $derived(width > 0 && width < STACKED_MAX);
  /** At a 360 px phone the bar keeps the file's name whole; its line counts stay on its row in the list under the diff. */
  let tight = $derived(width > 0 && width < 380);
  let changes = $derived(status?.changes ?? []);
  /** Where the selected file stands in the list, -1 when it is not (or no longer) in it. */
  let at = $derived(selected === null ? -1 : changes.findIndex((change) => change.path === selected));

  /** A file open in a stacked panel: the diff fills it and the bar trades the count for the file choice. */
  let oneFile = $derived(stacked && selected !== null);
  let picked = $derived(at < 0 ? null : changes[at]!);
  /** The status dot's tone in the file menu, the same reading as the list's badge. */
  const TONES: Record<GitChange['status'], NonNullable<MenuItem['status']>['tone']> = {
    added: 'success', copied: 'success', modified: 'warning', deleted: 'danger', conflict: 'danger', renamed: 'neutral', untracked: 'neutral'
  };
  let files = $derived<MenuItem[]>(changes.map((change) => ({
    id: change.path,
    label: base(change.path),
    title: change.path,
    hint: ((lines) => [lines.added ? `+${lines.added}` : '', lines.removed ? `-${lines.removed}` : ''].filter(Boolean).join(' ') || undefined)(countsOf(change)),
    status: { tone: TONES[change.status], label: strings.changes.status[change.status] },
    checked: change.path === selected,
    radio: true,
    testid: 'changes-outline-file'
  })));

  function pickPath(path: string): void {
    panel.update(surface.id, { path });
  }

  /** The code's own width: the side by side switch is offered only where two columns can be read. */
  let codeWidth = $state(0);
  let textDiff = $derived(selected !== null && diff !== null && !diff.binary);
  /** The texts the diff on screen is drawn from, one object so its rows and counts are read once. */
  let source = $derived<DiffSource | null>(textDiff && diff ? { oldText: diff.oldText ?? '', newText: diff.newText ?? '' } : null);
  /**
   * The open file's lines added and removed, counted from the diff on screen,
   * so the figure beside it always matches the rows under it. The list's
   * figures for the other files are git's own, until one is opened.
   */
  let drawn = $derived(source !== null && diff?.path === selected ? diffCountsOf(source) : null);
  function countsOf(change: GitChange): { added: number | null; removed: number | null } {
    return change.path === selected && drawn !== null ? drawn : { added: change.additions, removed: change.deletions };
  }

  function back(): void {
    panel.update(surface.id, { path: undefined });
  }

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

  /** The rename origin the list gives the selected row: null for none, undefined while the row is not in it. */
  let origin = $derived(at < 0 ? undefined : (changes[at]?.oldPath ?? null));
  /** The last diff request: which row, which round of triggers, with which origin. */
  let reading: { key: string; round: string; from: string | null | undefined } | null = null;
  /** Bumped by every diff request; an older answer that lands after a newer one is dropped. */
  let diffSeq = 0;

  // The diff of the selected row, read on the same triggers as the status and
  // at the same time, not after it: the two reads do not depend on each other.
  // The row's origin from the list goes with it, so the core skips a second
  // status of its own. A refresh of the same row keeps the old diff on screen
  // until the new one replaces it; only another thread or another row starts
  // from blank.
  $effect(() => {
    const id = threadId;
    const path = selected;
    const from = origin;
    const round = `${finished}:${asked}`;
    const key = id === null || path === null ? null : `${id}\n${path}`;
    if (key !== shown) {
      shown = key;
      diff = null;
    }
    if (id === null || path === null || key === null) {
      reading = null;
      diffSeq += 1;
      return;
    }
    // A status that lands re-runs this. The read of this round still holds when
    // it went out with the same origin, or with none (the core then asked git
    // itself): only an origin that moved, a rename staged meanwhile, is read again.
    if (reading !== null && reading.key === key && reading.round === round && (reading.from === from || reading.from === undefined || from === undefined)) return;
    const mine = ++diffSeq;
    reading = { key, round, from };
    void store.gitDiff(id, path, undefined, from).then((answer) => {
      if (mine === diffSeq) diff = answer;
    });
  });
</script>

<div class="changes-surface" class:narrow class:stacked class:reading={oneFile} class:has-file={selected !== null} data-testid="changes-panel" bind:clientWidth={width}>
  <!-- One bar: the way back and the file choice when one file fills the panel, the branch, the count or the file's lines, the diff's switches. -->
  <div class="panel-toolbar">
    {#if oneFile}
      <button type="button" class="ghost small icon back" data-testid="changes-back" title={strings.changes.backToList} aria-label={strings.changes.backToList} onclick={back}>
        <ChevronLeft size={16} strokeWidth={1.75} />
      </button>
    {/if}
    <span class="branch" title={[status?.branch ?? strings.changes.noBranch, status?.upstream].filter(Boolean).join(' → ')}>
      <GitBranch size={13} strokeWidth={1.75} />
      <span class="branch-name ui-label">{status?.branch ?? strings.changes.noBranch}</span>
    </span>
    {#if status && status.ahead > 0}
      <span class="track" title={fill(strings.changes.ahead, { count: String(status.ahead) })}>
        <ArrowUp size={13} strokeWidth={1.75} /><span class="ui-label">{status.ahead}</span>
      </span>
    {/if}
    {#if status && status.behind > 0}
      <span class="track" title={fill(strings.changes.behind, { count: String(status.behind) })}>
        <ArrowDown size={13} strokeWidth={1.75} /><span class="ui-label">{status.behind}</span>
      </span>
    {/if}
    {#if oneFile && picked}
      <span class="picker">
        <Menu items={files} onpick={pickPath} placement="bottom" variant="text" label={picked.path} testid="changes-pager">
          <span class="dot" data-status={picked.status} aria-hidden="true"></span>
          <span class="file-name ui-label">{base(picked.path)}</span>
          <ChevronDown size={13} strokeWidth={1.75} />
        </Menu>
      </span>
    {/if}
    <span class="spacer"></span>
    {#if oneFile && picked && !tight}
      {@const lines = countsOf(picked)}
      <span class="lines" data-testid="changes-lines">
        {#if lines.added}<span class="count added ui-label">+{lines.added}</span>{/if}
        {#if lines.removed}<span class="count removed ui-label">-{lines.removed}</span>{/if}
      </span>
    {:else if !(oneFile && picked)}
      <span class="total" data-testid="changes-count">
        {status
          ? status.changes.length === 1
            ? strings.changes.oneCount
            : fill(strings.changes.count, { count: String(status.changes.length) })
          : strings.changes.loading}
      </span>
    {/if}
    {#if textDiff}<DiffOptions split={codeWidth >= SPLIT_MIN_WIDTH} />{/if}
    <button
      type="button"
      class="ghost small icon"
      title={strings.common.refresh}
      aria-label={strings.common.refresh}
      data-testid="changes-refresh"
      disabled={loading}
      onclick={() => asked++}
    >
      <RefreshCw size={13} strokeWidth={1.75} />
    </button>
  </div>

  <div class="split">
    <div class="list" role="listbox" aria-label={strings.rightPanel.changes} tabindex="-1">
      {#if status && status.changes.length === 0}
        <p class="empty" data-testid="changes-empty">{strings.changes.clean}</p>
      {/if}
      {#each status?.changes ?? [] as change (change.path)}
        {@const lines = countsOf(change)}
        <button
          type="button"
          class="row"
          class:on={change.path === selected}
          role="option"
          aria-selected={change.path === selected}
          data-testid="changes-row"
          data-path={change.path}
          data-status={change.status}
          title={[change.path, change.oldPath ? fill(strings.changes.renamedFrom, { path: change.oldPath }) : '', change.staged ? strings.changes.staged : ''].filter(Boolean).join('\n')}
          onclick={() => select(change)}
        >
          <span class="mark" data-status={change.status} title={strings.changes.status[change.status]}>
            <span class="ui-label">{LETTERS[change.status]}</span>
          </span>
          <span class="path">
            <span class="dir">{directory(change.path)}</span><span class="base">{base(change.path)}</span>
          </span>
          <!-- Both counts keep their column, empty or not, so every row's figures line up. -->
          <span class="count added ui-label">{lines.added ? `+${lines.added}` : ''}</span>
          <span class="count removed ui-label">{lines.removed ? `-${lines.removed}` : ''}</span>
        </button>
      {/each}
    </div>

    <div class="detail">
      {#if selected === null}
        <p class="empty">{strings.changes.pick}</p>
      {:else if diff === null}
        <p class="empty">{strings.changes.loading}</p>
      {:else if diff.binary}
        <p class="empty" data-testid="changes-binary">{strings.changes.binary}</p>
      {:else}
        {#if diff.truncated}
          <p class="notice" data-testid="changes-truncated">{strings.changes.truncated}</p>
        {/if}
        <!-- The bar above names the file and holds the switches: the code starts right under it. -->
        <div class="code" use:boxWidth={(value) => (codeWidth = value)}>
          <DiffView path={diff.path} oldText={diff.oldText ?? ''} newText={diff.newText ?? ''} doc={source ?? undefined} headless grow />
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .changes-surface {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    /* The split below asks this element's width, not the window's: the panel is
       dragged to any size and the query has to follow it. */
    container-type: inline-size;
  }

  .branch,
  .track {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
    flex: none;
    font-variant-numeric: tabular-nums;
  }

  .branch {
    flex: 0 1 auto;
    color: var(--color-foreground);
  }
  .branch :global(svg) { flex: none; }
  .branch-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .spacer {
    flex: 1;
    min-width: 4px;
  }

  .total {
    flex: none;
    font-variant-numeric: tabular-nums;
  }

  .split {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .list {
    flex: none;
    max-height: 45%;
    overflow-y: auto;
    padding: 2px 6px 6px;
  }

  /* The diff runs to the panel's edges and bottom: its own scroll, no card around it. */
  .detail {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border-top: 1px solid var(--color-border);
  }
  .detail > .empty, .detail > .notice { padding: 10px 12px; margin: 0; }
  /* The diff's own fill reaches the bottom however short the file. */
  .code { display: flex; flex-direction: column; min-height: 100%; }

  /* Wide enough for two columns: the list is a narrow column beside the diff. */
  @container (min-width: 900px) {
    .split {
      flex-direction: row;
    }

    .list {
      width: 240px;
      max-height: none;
      flex: none;
      border-right: 1px solid var(--color-border);
    }

    .detail {
      border-top: none;
    }
  }

  /* Stacked: the list fills the panel until a row is picked; then the diff
     does, the bar names the file, and its chip's menu holds the other files.
     The list stays in the page, hidden, so its rows keep their state. */
  .stacked .list {
    flex: 1;
    max-height: none;
  }
  .stacked .detail { display: none; }
  .stacked.reading .list { display: none; }
  .stacked.reading .detail { display: block; border-top: none; }
  /* Beside a desktop chat the chip is the way to the other files: the arrow back is a phone's. */
  @media (min-width: 721px) { .reading .back { display: none; } }

  /* The back arrow pulls into the bar's edge so its glyph lines up with the rows under it. */
  .back { flex: none; margin-left: -6px; }
  /* The file choice gives way to nothing but its own name: the branch shrinks first. */
  .picker { flex: 0 1 auto; display: flex; min-width: 0; color: var(--color-foreground); }
  .picker :global(.menu), .picker :global(.trigger) { min-width: 0; max-width: 100%; }
  .picker :global(.trigger) { height: var(--control-sm); }
  .file-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .reading .branch { flex-shrink: 4; }
  /* A phone's bar has room for the file or the branch, not both: the file being read wins, the list shows the branch. */
  @container (max-width: 480px) {
    .reading .branch, .reading .track { display: none; }
  }
  .lines { flex: none; display: inline-flex; gap: 6px; }
  .dot { width: 6px; height: 6px; flex: none; border-radius: var(--radius-full); background: var(--mark); }
  .dot[data-status='added'], .dot[data-status='copied'] { --mark: var(--color-success); }
  .dot[data-status='modified'] { --mark: var(--color-live); }
  .dot[data-status='deleted'], .dot[data-status='conflict'] { --mark: var(--color-danger); }
  .dot[data-status='renamed'], .dot[data-status='untracked'] { --mark: var(--color-subtle); }
  /* Fingers, not a pointer: every row is a full target. */
  .narrow .row { height: auto; min-height: var(--touch-target); }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: var(--row);
    padding: 0 6px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    font-weight: 400;
    text-align: left;
  }

  .row:hover:not(:disabled),
  .row:focus-visible {
    background: var(--color-hover);
  }

  .row:active:not(:disabled) {
    transform: none;
  }

  .row.on {
    background: var(--color-active);
    color: var(--color-foreground);
  }

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

  .mark[data-status='modified'] {
    --mark: var(--color-live);
  }

  .mark[data-status='deleted'],
  .mark[data-status='conflict'] {
    --mark: var(--color-danger);
  }

  .mark[data-status='renamed'] {
    --mark: var(--color-muted-foreground);
  }

  .mark[data-status='untracked'] {
    --mark: var(--color-muted-foreground);
  }

  .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }

  /* `direction: rtl` keeps the file name in view when the path is cut; each
     span reads left to right again so the text itself is not reversed. */
  .dir,
  .base {
    direction: ltr;
    unicode-bidi: embed;
  }

  .dir {
    color: var(--color-subtle);
  }

  .base {
    color: inherit;
  }

  .row.on .base {
    color: var(--color-foreground);
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
    padding: 10px 6px;
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
  }

  .notice {
    margin: 6px 0;
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
  }
</style>
