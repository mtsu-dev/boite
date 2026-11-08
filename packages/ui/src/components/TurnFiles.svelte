<script lang="ts">
  // The files one finished answer made or changed, at its end. A row opens the
  // file in the side panel, which already reads text, shows pictures and offers
  // a download for the rest. "Show in folder" hands the path to the system file
  // manager, only in the shell on its own core, and never opens the file itself.
  import { errorText } from '../lib/errors';
  import { ChevronRight, ChevronsDownUp, ChevronsUpDown, FileDiff, FilePenLine, FilePlus2, FileMinus2, Folder, FolderOpen, PanelRightOpen } from '@lucide/svelte';
  import { revealFile } from '../lib/links';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { countsOf, turnFileTree, turnLineCounts, type TurnDiff, type TurnFile, type TurnFileNode } from '../lib/turn-files';
  import Deferred, { parts } from './Deferred.svelte';
  import ChangeCount from './ChangeCount.svelte';
  import { changeCount, changeText } from '../lib/change-count';
  import { chatPrefs } from '../lib/chat-prefs.svelte';

  /**
   * `diffs` is what the answer's own calls changed, shown here on demand. What
   * the whole thread changed is the working tree against its last commit: the
   * Changes panel, one click away for whoever can read the repository.
   */
  let { store, files, diffs = [], cwd, deferred = [], loadDiffs, inline = false }: {
    store: Store; files: TurnFile[]; diffs?: TurnDiff[]; /** The directory `files` were read against. */ cwd: string; deferred?: { messageId: string; toolId: string }[]; loadDiffs?: () => Promise<void>;
    /** On the tool line of the turn's last change (ToolGroup), which already names the files: the lines it adds, no title or card of its own. */
    inline?: boolean;
  } = $props();
  let diffToggled = $state<boolean | null>(null);
  let showDiff = $derived(diffToggled ?? chatPrefs.expandDiffs);
  /** Folded by default: the count and the lines added and removed say enough until the list is wanted. */
  let open = $state(false);
  let lines = $derived(turnLineCounts(diffs, cwd));
  let total = $derived(changeCount(files.length, diffs.length > 0 ? lines.total.added : null, diffs.length > 0 ? lines.total.removed : null));
  let repository = $derived(store.openProject?.repository === true);
  let tree = $derived(turnFileTree(files));
  let expanded = $state<Record<string, boolean>>({});
  let allExpanded = $state(false);
  let hasFolders = $derived(tree.some((node) => node.kind === 'folder'));
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let attempt = $state(0);
  let attempted = '';
  $effect(() => {
    const key = `${attempt}:${deferred.map(source => `${source.messageId}/${source.toolId}`).join(',')}`;
    if (!showDiff || !deferred.length || !loadDiffs || loading || attempted === key) return;
    attempted = key;
    loadError = null;
    loading = true;
    void loadDiffs().catch(reason => { loadError = errorText(reason); }).finally(() => { loading = false; });
  });

  function toggleAll(): void {
    allExpanded = !allExpanded;
    expanded = {};
  }

  const CHANGE_LABEL = {
    created: () => strings.chat.fileCreated,
    changed: () => strings.chat.fileChanged,
    deleted: () => strings.chat.fileDeleted
  } satisfies Record<TurnFile['change'], () => string>;

  /** A paired device reads files too (read-only); a deleted one has nothing left to open. */
  function openable(file: TurnFile): boolean {
    return file.relative !== null && file.change !== 'deleted';
  }

  async function reveal(file: TurnFile): Promise<void> {
    if (file.absolute === null) return;
    try {
      await revealFile(file.absolute);
    } catch (error) {
      store.reportError(fill(strings.chat.revealFailed, { reason: errorText(error) }), 'minor');
    }
  }
</script>

<section class="turn-files" class:inline data-testid="turn-files" aria-label={strings.chat.turnFiles}>
  <header>
    <button type="button" class="ghost small fold" data-testid="turn-files-toggle" aria-expanded={open} title={`${strings.chat.turnFiles}: ${changeText(total)}`} onclick={() => (open = !open)}>
      <!-- On the tool line the count is the opener: the run's own caret is just before it. -->
      {#if !inline}<ChevronRight size={14} class={open ? 'fold-caret open' : 'fold-caret'} /><span class="ui-label">{strings.chat.turnFiles}</span>{/if}
      <!-- "1 file, +7 −2": the one count of changes (lib/change-count.ts). On the tool line, whose words already count the files, the lines alone when known. -->
      <span class="count"><ChangeCount files={inline && diffs.length > 0 ? null : files.length} added={diffs.length > 0 ? lines.total.added : null} removed={diffs.length > 0 ? lines.total.removed : null} testid="turn-lines" /></span>
    </button>
    {#if open && hasFolders}
      <button type="button" class="ghost small icon expand" data-testid="turn-files-expand"
        title={allExpanded ? strings.chat.collapseFileFolders : strings.chat.expandFileFolders}
        aria-label={allExpanded ? strings.chat.collapseFileFolders : strings.chat.expandFileFolders}
        onclick={toggleAll}>
        {#if allExpanded}<ChevronsDownUp size={14} />{:else}<ChevronsUpDown size={14} />{/if}
      </button>
    {/if}
    <!-- One action: the answer's own diff, the same rows its counts are read from. The folder's whole change set is offered under it. -->
    {#if diffs.length > 0 || deferred.length > 0}
      <span class="tools">
        <button type="button" class="ghost small" data-testid="turn-diff-toggle" aria-expanded={showDiff} onclick={() => { if (!showDiff) { attempt += 1; loadError = null; } diffToggled = !showDiff; }}>
          <FileDiff size={14} /><span class="ui-label">{showDiff ? strings.chat.hideTurnDiff : strings.chat.showTurnDiff}</span>
        </button>
      </span>
    {:else if repository}
      <span class="tools">{@render allChanges()}</span>
    {/if}
  </header>
  {#if open}<div class="tree" data-testid="turn-files-tree">{@render branch(tree, 0)}</div>{/if}
  {#if showDiff}
    <div class="diffs" data-testid="turn-diff">
      {#if loading}<p data-testid="turn-diff-loading">{strings.app.loading}</p>{/if}
      {#if loadError}<p role="alert">{loadError}</p>{/if}
      {#each diffs as doc, index (index)}
        <Deferred part={parts.DiffView}>{#snippet children(DiffView)}<DiffView path={doc.path} oldText={doc.oldText} newText={doc.newText} {doc} />{/snippet}</Deferred>
      {/each}
      {#if repository}<span class="all">{@render allChanges()}</span>{/if}
    </div>
  {/if}
</section>

{#snippet allChanges()}
  <!-- The working tree against its last commit, in the side panel, on this answer's first file. -->
  <button type="button" class="ghost small" data-testid="turn-all-changes" title={strings.chat.allChanges}
    onclick={() => store.panel.openChanges(files.find(openable)?.relative ?? undefined)}>
    <PanelRightOpen size={14} /><span class="ui-label">{strings.chat.allChanges}</span>
  </button>
{/snippet}

{#snippet fileIcon(file: TurnFile)}
  <span class="file-icon" data-testid="turn-file-change" title={CHANGE_LABEL[file.change]()}>
    {#if file.change === 'created'}<FilePlus2 size={14} strokeWidth={1.75} />
    {:else if file.change === 'deleted'}<FileMinus2 size={14} strokeWidth={1.75} />
    {:else}<FilePenLine size={14} strokeWidth={1.75} />{/if}
    <span class="visually-hidden">{CHANGE_LABEL[file.change]()}</span>
  </span>
{/snippet}

{#snippet branch(nodes: TurnFileNode[], depth: number)}
  <ul>
    {#each nodes as node (node.key)}
      {#if node.kind === 'folder'}
        {@const open = expanded[node.key] ?? allExpanded}
        <li>
          <button type="button" class="folder-row" data-testid="turn-file-folder" aria-expanded={open}
            style:--depth={depth} title={node.name}
            onclick={() => expanded[node.key] = !open}>
            <ChevronRight size={14} class={open ? 'fold-caret open' : 'fold-caret'} />
            {#if open}<FolderOpen size={14} strokeWidth={1.75} />{:else}<Folder size={14} strokeWidth={1.75} />{/if}
            <span class="folder ui-label">{node.name}</span>
            <span class="count ui-label">{node.count}</span>
          </button>
          {#if open}{@render branch(node.children, depth + 1)}{/if}
        </li>
      {:else}
      {@const file = node.file}
      {@const fileLines = countsOf(lines.byPath, file)}
      <li class="row" data-change={file.change} style:--depth={depth} title={file.path}>
        {#if openable(file)}
          <button
            type="button"
            class="open"
            data-testid="turn-file"
            aria-label={`${fill(strings.chat.openFile, { name: file.name })}, ${CHANGE_LABEL[file.change]()}`}
            onclick={() => store.panel.openFile(file.relative!)}
          >
            {@render fileIcon(file)}
            <span class="name ui-label">{file.name}</span>
          </button>
        {:else}
          <span class="open" data-testid="turn-file">
            {@render fileIcon(file)}
            <span class="name ui-label">{file.name}</span>
          </span>
        {/if}
        {#if fileLines}<span class="lines"><ChangeCount added={fileLines.added} removed={fileLines.removed} /></span>{/if}
        {#if store.pickerAvailable && file.absolute !== null && file.change !== 'deleted'}
          <button
            type="button"
            class="ghost small icon reveal"
            data-testid="turn-file-reveal"
            title={strings.chat.revealFile}
            aria-label={strings.chat.revealFile}
            onclick={() => void reveal(file)}
          >
            <FolderOpen size={14} strokeWidth={1.75} />
          </button>
        {/if}
      </li>
      {/if}
    {/each}
  </ul>
{/snippet}

<style>
  .turn-files {
    display: flex;
    flex-direction: column;
    min-width: 0;
    /* The answer's parts sit 4px in; the card lines up with them. */
    margin: var(--chat-block-gap) 0 0 4px;
    background: var(--color-surface);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  /* One row at every width: the fold shrinks, its action stays whole. */
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--row);
    padding: 3px 12px;
    font-size: var(--text-xs);
    font-weight: 500;
  }
  /* A pointer gets 28 px on the head's buttons; the row keeps its height. */
  header button.small { min-height: 28px; }

  .count {
    flex: none;
    color: var(--color-muted-foreground);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    font-weight: 400;
  }
  .fold {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 6px;
    margin-left: -6px;
    padding: 0 6px;
    font-weight: 500;
  }
  .fold :global(.fold-caret) { color: var(--color-muted-foreground); }
  .lines {
    display: inline-flex;
    flex: none;
    font-size: var(--text-xs);
    font-weight: 400;
  }
  .row .lines { padding-right: 6px; }
  .expand, .tools { margin-left: auto; }
  .expand ~ .tools { margin-left: 0; }
  .tools { display: flex; flex: none; align-items: center; gap: 2px; }
  .tools button, .all button { display: inline-flex; align-items: center; gap: 6px; }
  .all { display: flex; }
  .tree { padding: 0 6px 6px; }
  .diffs { display: flex; flex-direction: column; gap: 8px; padding: 0 12px 12px; }

  /* On the tool line: its buttons join the line's row, the list and diffs open
     under it at full width, with no surface of their own. */
  .inline, .inline header { display: contents; }
  .inline .fold { margin-left: 0; }
  /* Its own line on a phone, under the run's words rather than its glyph. */
  @media (max-width: 720px) { .inline .fold { margin-left: calc(var(--activity-glyph) + var(--activity-gap)); } }
  .inline .tree, .inline .diffs { flex: 1 0 100%; min-width: 0; }
  .inline .tree { padding: 0 0 6px; }
  .inline .diffs { padding: 4px 0 8px; }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: var(--control);
    padding-left: calc(8px + var(--depth) * 14px + 22px);
    border-radius: var(--radius-sm);
  }

  .row:hover { background: var(--color-hover); }

  .open {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: auto;
    min-height: var(--control);
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    justify-content: flex-start;
    text-align: left;
  }

  /* The row carries the hover, so the button inside it stays flat. */
  button.open:hover:not(:disabled) { background: none; }
  button.open:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }
  .file-icon { display: flex; flex: none; color: var(--color-muted-foreground); }

  .name {
    font-size: var(--text-xs);
    font-weight: 400;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .folder {
    flex: 1;
    min-width: 0;
    font-size: var(--text-xs);
    color: var(--color-muted-foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .folder-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
    min-height: var(--control);
    height: auto;
    padding: 4px 8px 4px calc(8px + var(--depth) * 14px);
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    text-align: left;
    font-weight: 400;
    color: var(--color-muted-foreground);
  }
  .folder-row :global(svg) { flex: none; }
  .folder-row :global(.fold-caret) { color: inherit; }
  .folder-row:hover { background: var(--color-hover); }
  .folder-row:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }

  [data-change='deleted'] .name { text-decoration: line-through; color: var(--color-muted-foreground); }

  [data-change='created'] .file-icon { color: var(--color-success); }
  [data-change='deleted'] .file-icon { color: var(--color-danger); }

  .reveal { flex: none; opacity: 0; }
  .row:hover .reveal, .row:focus-within .reveal { opacity: 1; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  @media (pointer: coarse), (max-width: 720px) {
    .folder-row, .row, .open { min-height: var(--touch-target); }
    .reveal { opacity: 1; }
  }
</style>
