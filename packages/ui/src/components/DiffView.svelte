<script module lang="ts">
  /** Under this width two columns of code are too narrow to read: one column, and no switch. A pane that draws the switch itself reads it. */
  export const SPLIT_MIN_WIDTH = 560;
</script>

<script lang="ts">
  import { diffCounts, diffRows, diffRowsOf, splitRows, type DiffRow, type DiffSource } from '../lib/diff';
  import { diffPrefs } from '../lib/diff-prefs.svelte';
  import { markHtml, markText, wordMarks } from '../lib/diff-words';
  import DiffOptions from './DiffOptions.svelte';
  import ChangeCount from './ChangeCount.svelte';
  import { fill, strings } from '../lib/strings';
  import { codeLanguage, highlightCode } from '../lib/code-highlight';
  import { whenIdle } from '../lib/idle';
  import { boxWidth } from '../lib/box-width';

  let {
    path,
    oldText,
    newText,
    doc,
    headless = false,
    grow = false
  }: {
    path: string;
    oldText: string;
    newText: string;
    /** The document `oldText` and `newText` come from, when there is one: its rows are read once and kept across mounts. */
    doc?: DiffSource;
    /** Under a line that already names the file and counts the lines: no heading of its own. */
    headless?: boolean;
    /** The only thing in a scrolling pane: the rows grow with it instead of scrolling in a box of their own. */
    grow?: boolean;
  } = $props();

  /** Rows drawn before the show-all button: the box shows about fourteen. */
  const FIRST_ROWS = 300;
  let width = $state(0);
  let rows = $derived(doc ? diffRowsOf(doc, diffPrefs.ignoreWhitespace) : diffRows(oldText, newText, { ignoreWhitespace: diffPrefs.ignoreWhitespace }));
  let counts = $derived(diffCounts(rows));
  let expanded = $state(false);
  let shown = $derived(expanded ? rows : rows.slice(0, FIRST_ROWS));
  let splittable = $derived(width >= SPLIT_MIN_WIDTH);
  let split = $derived(splittable && diffPrefs.split);
  let pairs = $derived(split ? splitRows(shown) : []);
  /** The changed words of the drawn rows only: a folded tail costs nothing. */
  let words = $derived(wordMarks(shown));
  const language = $derived(codeLanguage(path));
  /** Highlighted lines, kept with the text and grammar they were read from so a changed text never shows stale colors. */
  type Coded = { text: string; grammar: string | null; lines: string[] | null };
  let oldCoded = $state.raw<Coded | null>(null);
  let newCoded = $state.raw<Coded | null>(null);
  const oldCode = $derived(oldCoded?.text === oldText && oldCoded.grammar === language ? oldCoded.lines : null);
  const newCode = $derived(newCoded?.text === newText && newCoded.grammar === language ? newCoded.lines : null);
  /** Only a removed line reads the old side: context lines read the new one. A new file or a pure addition skips it. */
  const needsOld = $derived(rows.some((row) => row.kind === 'remove'));

  $effect(() => {
    const before = needsOld ? oldText : null;
    const after = newText;
    const grammar = language;
    let cancelled = false;
    // The plain rows draw first; the grammar runs once the fold has opened and the page is idle.
    const cancel = whenIdle(() => {
      void Promise.all([before === null ? null : highlightCode(before, grammar), highlightCode(after, grammar)]).then(([oldLines, newLines]) => {
        if (cancelled) return;
        if (before !== null) oldCoded = { text: before, grammar, lines: oldLines };
        newCoded = { text: after, grammar, lines: newLines };
      }).catch(() => { /* The plain diff remains available if a grammar cannot load. */ });
    }, { timeout: 300, fallback: 0 });
    return () => { cancelled = true; cancel(); };
  });

  function codeOf(row: Exclude<DiffRow, { kind: 'gap' }>): string | undefined {
    return row.kind === 'remove' ? oldCode?.[row.oldLine - 1] : newCode?.[row.newLine - 1];
  }

  /** The gutter of a row: what a patch puts in its first column. */
  function sign(kind: string): string {
    if (kind === 'add') return '+';
    if (kind === 'remove') return '-';
    return ' ';
  }
</script>

<div class="diff code-syntax" class:grow data-testid="diff-view" data-path={path} data-language={language ?? 'text'} data-layout={split ? 'split' : 'unified'} use:boxWidth={(value) => (width = value)}>
  {#if !headless}
    <div class="head">
      <span class="path mono ui-label" title={path}>{path}</span>
      {#if counts.added > 0 || counts.removed > 0}
        <span class="count"><ChangeCount added={counts.added} removed={counts.removed} /></span>
      {/if}
      <DiffOptions split={splittable} />
    </div>
  {/if}
  <div class="rows mono">
    {#if rows.length === 0 && diffPrefs.ignoreWhitespace && oldText !== newText}
      <p class="same" data-testid="diff-whitespace-only">{strings.chat.diffWhitespaceOnly}</p>
    {:else if split}
      {#each pairs as pair, index (index)}
        {#if pair.kind === 'gap'}
          {@render gap(pair.hidden)}
        {:else}
          <div class="pair" data-testid="diff-pair">
            {@render side(pair.left, 'old')}
            {@render side(pair.right, 'new')}
          </div>
        {/if}
      {/each}
    {:else}
      {#each shown as row, index (index)}
        {#if row.kind === 'gap'}
          {@render gap(row.hidden)}
        {:else}
          <div class="row {row.kind}" data-kind={row.kind} data-testid="diff-row">
            <span class="num">{row.kind === 'remove' ? row.oldLine : row.newLine}</span>
            <span class="gutter">{sign(row.kind)}</span>
            <span class="text">{@render code(row)}</span>
          </div>
        {/if}
      {/each}
    {/if}
    {#if shown.length < rows.length}
      <button type="button" class="ghost small more" data-testid="diff-show-all" onclick={() => (expanded = true)}>
        <span class="ui-label">{fill(strings.chat.diffShowAll, { count: String(rows.length) })}</span>
      </button>
    {/if}
  </div>
</div>

{#snippet gap(hidden: number)}
  <div class="row gap" data-kind="gap">
    <span class="num"></span>
    <span class="gutter"></span>
    <span class="text">... {fill(strings.chat.diffHidden, { count: String(hidden) })}</span>
  </div>
{/snippet}

{#snippet code(row: Exclude<DiffRow, { kind: 'gap' }>)}
  {@const html = codeOf(row)}
  {@const marks = words.get(row)}
  <!-- highlightCode escapes source text before adding its token spans; the marks add only their own tags. -->
  {#if html !== undefined}{@html marks ? markHtml(html, marks) : html}{:else if marks}{#each markText(row.text, marks) as part, index (index)}{#if part.marked}<mark class="word">{part.text}</mark>{:else}{part.text}{/if}{/each}{:else}{row.text}{/if}
{/snippet}

{#snippet side(row: Exclude<DiffRow, { kind: 'gap' }> | null, which: 'old' | 'new')}
  {#if row === null}
    <div class="row empty"><span class="num"></span><span class="gutter"></span><span class="text"></span></div>
  {:else}
    <div class="row {row.kind}" data-kind={row.kind}>
      <span class="num">{row.kind === 'context' ? (which === 'old' ? row.oldLine : row.newLine) : row.kind === 'remove' ? row.oldLine : row.newLine}</span>
      <span class="gutter">{sign(row.kind)}</span>
      <span class="text">{@render code(row)}</span>
    </div>
  {/if}
{/snippet}

<style>
  .diff {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    max-width: 100%;
    overflow: hidden;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface-3);
  }

  .path {
    flex: 1;
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    display: inline-flex;
    font-size: var(--text-xs);
    flex: none;
  }

  .rows {
    max-height: 320px;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 4px 0;
  }

  /* One scroll for the page, not one inside another: what a finger can drag. */
  .grow .rows {
    max-height: none;
    overflow-y: visible;
  }

  /* The whole panel is the diff: no card inside the card, the code to the edges and the bottom. */
  .diff.grow {
    border: none;
    border-radius: 0;
    flex: 1 0 auto;
  }

  /* Each row names its fill once: the fixed number column wears it too, so code scrolling under it never shows through. */
  .row {
    --row-bg: var(--color-surface-2);
    display: flex;
    align-items: flex-start;
    gap: 0;
    line-height: 1.55;
    background: var(--row-bg);
  }

  .more {
    margin: 4px 10px;
  }

  /* Two halves of one line: each keeps its own number, sign and wrap. */
  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .pair > .row:first-child {
    border-right: 1px solid var(--color-border);
  }

  .row.empty {
    --row-bg: var(--color-surface-3);
  }

  .same {
    margin: 0;
    padding: 6px 10px;
    color: var(--color-subtle);
    font-size: var(--text-sm);
  }

  .num {
    flex: none;
    width: 34px;
    padding-right: 8px;
    text-align: right;
    color: var(--color-subtle);
    font-variant-numeric: tabular-nums;
    user-select: none;
    background: var(--row-bg);
  }

  .gutter {
    flex: none;
    width: 14px;
    text-align: center;
    color: var(--color-subtle);
    user-select: none;
    background: var(--row-bg);
  }

  /* Split halves and a phone wrap, so no line is ever cut at the edge. A wrapped
     line hangs 2ch in under its first, and only the first carries a number,
     so a continuation never reads as a line of its own. */
  .text {
    flex: 1;
    min-width: 0;
    padding: 0 10px 0 2ch;
    text-indent: -2ch;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* A changed line keeps its code's own colours on a light tint, marked by a
     bar in its gutter and its sign: no saturated block to read through. The
     family has no green or red surface token, so the tint is the status
     colour mixed into the well's own fill rather than a new hex. */
  .row.add {
    --row-bg: color-mix(in srgb, var(--color-success) 7%, var(--color-surface-2));
  }

  .row.remove {
    --row-bg: color-mix(in srgb, var(--color-danger) 7%, var(--color-surface-2));
  }

  /* The bar rides on the number, which stays put while the code scrolls sideways. */
  .row.add .num { box-shadow: inset 2px 0 0 var(--color-success); }
  .row.remove .num { box-shadow: inset 2px 0 0 var(--color-danger); }

  /* The words that changed inside a changed line: a deeper wash of the line's own status colour. */
  .text :global(mark.word) {
    border-radius: 2px;
    color: inherit;
    background: color-mix(in srgb, var(--color-success) 26%, transparent);
  }
  .row.remove .text :global(mark.word) { background: color-mix(in srgb, var(--color-danger) 26%, transparent); }

  .row.add .gutter { color: var(--color-success); }
  .row.remove .gutter { color: var(--color-danger); }

  .row.gap {
    --row-bg: var(--color-surface-3);
    color: var(--color-subtle);
    font-size: var(--text-sm);
  }

  .row.gap .text { text-indent: 0; }
  /* A phone's column: a narrower number column leaves the code its width. Lines
     wrap as on desktop, hanging under their first, so nothing hides past the
     screen's edge; a break falls between words first, inside one only when it
     alone is wider than the screen. */
  @media (max-width: 720px) {
    .num { width: 28px; padding-right: 6px; }
    .gutter { width: 12px; }
    .text { overflow-wrap: break-word; }
  }

  /* A desktop reads code as code: every line whole on one line, the rows
     scrolling sideways together under numbers that stay put. The column is
     as wide as the longest line, so every row's fill reaches the end. Split
     halves and a phone keep their wrap. */
  @media (min-width: 721px) {
    [data-layout='unified'] .rows { display: grid; grid-template-columns: minmax(100%, max-content); align-content: start; overflow-x: auto; }
    [data-layout='unified'] .text { padding-left: 0; text-indent: 0; white-space: pre; overflow-wrap: normal; }
    [data-layout='unified'] .num { position: sticky; left: 0; z-index: 1; }
    [data-layout='unified'] .gutter { position: sticky; left: 34px; z-index: 1; }
    [data-layout='unified'] .more { justify-self: start; }
  }
</style>
