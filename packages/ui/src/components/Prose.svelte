<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { renderBlock } from '../lib/markdown';
  import { workspace } from '../lib/workspace.svelte';
  import { ParagraphScan, answerText } from '../lib/message-display';
  import { strings } from '../lib/strings';
  import { featureOn } from '../lib/features.svelte';
  import type { Store } from '../lib/store.svelte';
  import { fileChecks, linkMenu as fileMenu, openLink, type LinkContext } from '../lib/file-open.svelte';
  import { glides } from '../lib/motion';
  import TypingIndicator from './TypingIndicator.svelte';
  import { selectionClicks } from '../lib/selection-clicks';
  import { longPress } from '../lib/long-press';
  import { contextMenu } from '../lib/context-menu.svelte';
  import { writeClipboardLater } from '../lib/live-input';
  import type { Message } from '@boite/contracts';
  import { answerPieces, viewAt, viewPart, type AnswerPiece } from '../lib/inline-view';
  import InlineView from './InlineView.svelte';
  import { richMarkdown, type RichMarkdownOptions } from '../lib/rich-markdown';
  import { viewerHost, type Gallery, type MediaItem } from '../lib/media-gallery';
  import Deferred from './Deferred.svelte';
  import { parts } from '../lib/deferred-parts';

  /**
   * `views` are the pages the answer's turn published (`turnViews`): a line
   * of the answer that names one (`answerPieces`) draws it there, and the
   * text around it becomes a bubble above it and another under it.
   */
  let { text, live = false, typing = false, bubble = false, joined, anchor: elsewhere, store, threadId, views, revision }: {
    text: string; live?: boolean; typing?: boolean; bubble?: boolean; store?: Store; threadId?: string; views?: readonly Message[]; revision?: object;
    /** Set on one slice of a long answer cut in rows: its bubble continues the row above, the row below, or both. */
    joined?: { above: boolean; below: boolean };
    /** Set on one slice of a long answer: goes to the heading `id` when another slice draws it. */
    anchor?: (id: string) => void;
  } = $props();
  const directLinks = $derived(featureOn('open-chat-links'));
  const rich = $derived(featureOn('chat-artifacts') || directLinks);
  let opening = false;
  function follow(event: MouseEvent): void {
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!anchor || workspace.followThreadLink(event, store, threadId)) return;
    if (!anchor.dataset.filePath) {
      const href = anchor.getAttribute('href');
      if (href?.startsWith('#')) {
        try {
          const id = decodeURIComponent(href.slice(1));
          const heading = host?.querySelector(`[id="${CSS.escape(id)}"]`);
          if (heading) { event.preventDefault(); heading.scrollIntoView({ block: 'nearest', behavior: glides() ? 'smooth' : 'auto' }); }
          else if (elsewhere) { event.preventDefault(); elsewhere(id); }
        } catch { /* A malformed fragment is not a local file. */ }
      }
      return;
    }
    event.preventDefault();
    openFile(anchor.dataset.filePath, anchor.dataset.fileLine);
  }
  /** What a file link's click and menu need: the Store and thread it belongs to, and the viewer. */
  function linkContext(): LinkContext | null {
    if (!store || !threadId) return null;
    return { store, threadId, directLinks, show: showMedia };
  }
  function openFile(written: string, line: string | undefined): void {
    const context = linkContext();
    if (opening || !context) return;
    opening = true;
    void openLink(context, written, line ? Number(line) : undefined)
      .catch(reason => store?.reportError(reason, 'minor'))
      .finally(() => { opening = false; });
  }
  /**
   * A file or thread link's own menu, in place of the webview's: its "Copy
   * link" gave the `#file` placeholder, never the path (#779). A long press
   * opens it on a phone (`longPress`).
   */
  const MENU_LINK = 'a[data-file-path], a[data-thread-address]';
  const hasMenu = (target: Element) => target.closest(MENU_LINK) !== null;
  function linkMenu(event: MouseEvent): void {
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>(MENU_LINK) : null;
    if (!anchor) return;
    const thread = anchor.dataset.threadAddress;
    if (thread) {
      contextMenu.open(event, [{ id: 'copy', label: strings.chat.copyThreadAddress }], () => void copyText(thread));
      return;
    }
    const context = linkContext();
    if (!context) return;
    const line = anchor.dataset.fileLine;
    const menu = fileMenu(context, anchor.dataset.filePath!, line ? Number(line) : undefined, text => void copyText(text), reason => store?.reportError(reason, 'minor'));
    contextMenu.open(event, menu.items, menu.pick);
  }
  /** The path is looked up after the pick: the write starts within the gesture, which Safari's clipboard requires. */
  async function copyText(text: string | Promise<string>): Promise<void> {
    try { await writeClipboardLater(Promise.resolve(text)); } catch (reason) { store?.reportError(reason, 'minor'); }
  }
  // The scan resumes where the last delta stopped instead of reading the answer again.
  const scan = new ParagraphScan();
  const answer = $derived(answerText(text, live));
  let blocks = $derived(scan.blocks(answer, live, revision));
  // Completed blocks keep their DOM; only the unfinished paragraph changes on a delta.
  // It stays plain text until complete, so partial Markdown cannot rebuild earlier blocks.

  type Group = { kind: 'text'; key: string; blocks: Array<{ key: string; block: string }> } | { kind: 'view'; key: string; message: Message };
  /**
   * The answer cut at the pages it places: runs of text, each its own bubble,
   * and the views between them. A line naming no view of the turn stays text.
   * Null when the turn published no page. Otherwise the answer is drawn this
   * way from its first word, so the line that places a page, once written,
   * adds the page and a bubble under it without drawing again what is above.
   */
  const groups = $derived.by((): Group[] | null => {
    if (!views?.length || !store || !threadId) return null;
    const pieces = answerPieces(blocks) ?? blocks.map((block, index): AnswerPiece => ({ kind: 'text', key: String(index), block }));
    const out: Group[] = [];
    for (const piece of pieces) {
      const message = piece.kind === 'view' ? viewAt(views, piece.path) : null;
      if (message) { out.push({ kind: 'view', key: `${piece.key}:${message.id}`, message }); continue; }
      const block = piece.kind === 'text' ? piece.block : piece.line;
      const last = out.at(-1);
      if (last?.kind === 'text') last.blocks.push({ key: piece.key, block });
      else out.push({ kind: 'text', key: piece.key, blocks: [{ key: piece.key, block }] });
    }
    return out;
  });
  /** A diagram, formula or view being written shows as a placeholder, not as its source. */
  const drafting = $derived.by(() => {
    void blocks;
    if (!live) return { text: '', drawing: false };
    const draft = scan.drafting(answer, rich);
    // A partial page link waits until its view can replace it.
    return views?.length && !draft.drawing && /^ {0,3}!\[[^\n]*$/.test(draft.text) ? { text: '', drawing: false } : draft;
  });
  const hasPending = $derived(drafting.text.length > 0 || drafting.drawing);
  /**
   * The paragraph still being written, cut at its closed `code` spans (odd
   * pieces): those show as code at once, rather than as raw backticks until
   * the paragraph ends. An open span stays text until its backtick closes it.
   */
  const draftingPieces = $derived(drafting.text.split(/(`[^`\n]+`)/));

  let host = $state<HTMLDivElement>();

  /**
   * A diagram or file opens in the timeline's viewer, or in one of its own
   * (a file preview, a plan). Diagrams have an object URL to give back, while
   * media links load their URL when the viewer opens.
   */
  const viewers = viewerHost();
  /** Who the chips of this answer ask whether their file is there (`fileChecks`). */
  const chipOwner = () => ({ store, threadId });
  let viewing = $state<Gallery | null>(null);
  function showMedia(item: MediaItem): void {
    const gallery = { items: [item], index: 0 };
    if (viewers) {
      viewers.open(gallery);
      if (item.src) viewers.release(item.src);
      return;
    }
    closeViewer();
    viewing = gallery;
  }
  /** A ```view block opens as a page the conversation's machine serves. */
  const drawing = $derived.by((): RichMarkdownOptions => {
    const owner = store;
    return { onenlarge: showMedia, viewBlock: owner ? html => owner.viewBlock(html) : undefined };
  });
  function closeViewer(): void {
    const src = viewing?.items[0]?.src;
    if (src) URL.revokeObjectURL(src);
    viewing = null;
  }
  onDestroy(closeViewer);

  // Attach copy buttons once the final paragraph has reached the DOM.
  $effect(() => {
    void blocks;
    if (live) return;
    const node = host;
    if (!node) return;
    // The `{@html}` write lands with the rest of the render, so the buttons go
    // on one tick later, once the new blocks are the ones in the document. They
    // hang on the `pre` the renderer drew: a fence it nests, in a quote, is
    // one no reading of the raw lines would see.
    void tick().then(() => {
      for (const pre of node.querySelectorAll('pre')) hangCopy(pre);
    });
  });

  function hangCopy(pre: HTMLPreElement): void {
    // A diagram's, a view's or a native block's code has its own buttons.
    if (pre.parentElement?.matches('.code-block, .md-mermaid, .md-view, .md-native')) return;
    const wrap = document.createElement('div');
    wrap.className = 'code-block';
    pre.replaceWith(wrap);
    wrap.append(pre);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost small copy';
    button.textContent = strings.common.copy;
    button.title = strings.common.copy;
    button.setAttribute('data-testid', 'code-copy');
    const reset = () => {
      button.textContent = strings.common.copy;
    };
    button.addEventListener('click', () => void copy(pre, button));
    button.addEventListener('pointerleave', reset);
    button.addEventListener('blur', reset);
    wrap.append(button);
  }

  /** The label says it landed and goes back on the way out, so nothing times it. */
  async function copy(pre: HTMLPreElement, button: HTMLButtonElement): Promise<void> {
    const code = pre.querySelector('code');
    try {
      await navigator.clipboard.writeText((code ?? pre).textContent ?? '');
      button.textContent = strings.chat.copied;
    } catch {
      button.textContent = strings.common.copy;
    }
  }
</script>

{#snippet writing()}{#if drafting.text}<p class="pending" data-testid="paragraph-pending">{#each draftingPieces as piece, index (index)}{#if index % 2}<code>{piece.slice(1, -1)}</code>{:else}{piece}{/if}{/each}</p>{/if}{#if drafting.drawing}<div class="drawing-pending" role="status" aria-label={strings.chat.drawingPending} data-testid="drawing-pending"></div>{/if}{#if typing && text.trim().length > 0}<TypingIndicator />{/if}{/snippet}

{#if groups && store && threadId}
  {@const end = groups.at(-1)}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="flow" data-testid="text-part" bind:this={host} use:selectionClicks use:longPress={hasMenu} use:richMarkdown={drawing} use:fileChecks={chipOwner} onclick={follow} oncontextmenu={linkMenu}>
    {#each groups as group (group.key)}
      {#if group.kind === 'view'}
        <InlineView part={viewPart(group.message)!} {store} {threadId} messageId={group.message.id} partIndex={0} />
      {:else}
        <!-- A slice of a cut answer joins the slices around it at its continuous ends: its first and its last run of text. -->
        <div class="prose" class:live class:answer-bubble={bubble} class:joined-above={joined?.above && group === groups[0]} class:joined-below={joined?.below && group === end} data-testid="text-run">
          {#each group.blocks as piece (piece.key)}
            <div class="paragraph" data-testid="paragraph">{@html renderBlock(piece.block, rich)}</div>
          {/each}{#if group === end}{@render writing()}{/if}
        </div>
      {/if}
    {/each}
    {#if end?.kind !== 'text' && (hasPending || (typing && text.trim().length > 0))}
      <div class="prose" class:live class:answer-bubble={bubble && hasPending} data-testid="text-run">{@render writing()}</div>
    {/if}
  </div>
{:else}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="prose" class:live class:answer-bubble={bubble && (blocks.length > 0 || hasPending)} class:joined-above={joined?.above} class:joined-below={joined?.below} data-testid="text-part" bind:this={host} use:selectionClicks use:longPress={hasMenu} use:richMarkdown={drawing} use:fileChecks={chipOwner} onclick={follow} oncontextmenu={linkMenu}>
    {#each blocks as block, index (index)}
      <!-- Completed Markdown blocks stay mounted while the pending paragraph changes. -->
      <div class="paragraph" data-testid="paragraph">{@html renderBlock(block, rich)}</div>
    {/each}{@render writing()}
  </div>
{/if}
{#if viewing}{@const view = viewing}<Deferred part={parts.ImageViewer} floating>{#snippet children(ImageViewer)}<ImageViewer items={view.items} index={view.index} onclose={closeViewer} />{/snippet}</Deferred>{/if}

<style>
  /* The answer is the content: it reads one clear step above the tool rows and
     meta around it, at the size the composer types (app.css). */
  .prose {
    word-break: break-word;
    font-size: var(--text-reading);
    line-height: var(--leading-reading);
  }

  /* An answer cut by the pages it places: its text keeps the reading measure,
     each page takes the whole column, as far from the text as two messages are. */
  .flow {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--chat-message-gap);
  }

  .flow > .prose { max-width: min(100%, var(--prose)); }
  /* A drawn block lays out to the width it is given, so its run takes the measure, not its text's width. */
  .flow > .prose:has(:global(.md-native)) { align-self: stretch; }

  /* `pretty` keeps a paragraph from ending on one stranded word. */
  .prose :global(p) {
    white-space: pre-wrap;
    text-wrap: pretty;
    margin: 0 0 var(--chat-block-gap);
  }

  .prose :global(p:last-child) {
    margin-bottom: 0;
  }

  /* `#` to `####` arrive as h3 to h6 (lib/markdown.ts) and step down in size,
     so a section reads above its subsections. A heading sits closer to what it
     names than to what it follows. */
  .prose :global(h3),
  .prose :global(h4),
  .prose :global(h5),
  .prose :global(h6) {
    font-size: 1em;
    line-height: 1.35;
    letter-spacing: -0.005em;
    margin: 22px 0 8px;
  }

  /* The smallest heading still stands one step over the text it heads, in the titles' weight. */
  .prose :global(:is(h3, h4, h5, h6)) { font-weight: var(--weight-title); }
  .prose :global(h3) { font-size: 1.3em; letter-spacing: -0.015em; }
  .prose :global(h4) { font-size: 1.15em; letter-spacing: -0.01em; }
  .prose :global(:is(h5, h6)) { font-size: 1.075em; }
  .prose :global(h6) { color: var(--color-muted-foreground); }

  /* A heading alone in its block: its own bottom margin replaces the block gap under it. */
  .paragraph > :global(:is(h3, h4, h5, h6):last-child) { margin-bottom: -4px; }
  .paragraph:first-child > :global(:is(h3, h4, h5, h6):first-child) { margin-top: 0; }

  .prose :global(ul),
  .prose :global(ol) {
    margin: 0 0 var(--chat-block-gap);
    padding-left: 24px;
  }

  .prose :global(li) {
    text-wrap: pretty;
    margin: 4px 0;
  }

  .prose :global(li::marker) { color: var(--color-muted-foreground); }

  .prose :global(code) {
    font-family: var(--font-mono);
    font-size: 0.875em;
    padding: 1px 5px;
    border-radius: var(--radius-sm);
    background: var(--color-code-background);
    color: var(--color-code-foreground);
    border: 1px solid var(--color-border);
  }

  .prose :global(pre) {
    margin: 0 0 var(--chat-block-gap);
    padding: 12px 14px;
    font-size: var(--text-sm);
    line-height: 1.6;
    border-radius: var(--radius-md);
    background: var(--color-code-background);
    color: var(--color-code-foreground);
    border: 1px solid var(--color-border);
    overflow: auto;
  }

  /* The button sits over the block's top right corner and shows for a pointer
     or for the keyboard, never in a capture of the answer at rest. */
  .prose :global(.code-block) {
    position: relative;
  }

  .prose :global(.code-block .copy) {
    position: absolute;
    top: 8px;
    right: 8px;
    opacity: 0;
    transition: opacity var(--dur-2) var(--ease-out-quint);
  }

  .prose :global(.code-block:hover .copy),
  .prose :global(.code-block:focus-within .copy) {
    opacity: 1;
  }

  /* A touch screen has no hover to reveal it: the button stays in view, on the
     block's own fill so the first line of code does not show through it. */
  @media (hover: none) {
    .prose :global(.code-block .copy) { opacity: 1; background: var(--color-code-background); }
  }

  .prose :global(pre code) {
    font-size: inherit;
    padding: 0;
    border: none;
    background: transparent;
    white-space: pre;
  }

  .prose :global(a) {
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-decoration-color: color-mix(in oklch, currentColor 45%, transparent);
    text-underline-offset: 3px;
    transition: text-decoration-color var(--dur-2) var(--ease-out-quint);
  }

  .prose :global(a:hover) { text-decoration-color: currentColor; }
  /* A thread named in a code chip stays neutral like every other one: its underline says it is a link. */
  .prose :global(code a) { color: inherit; }

  /* A file link is a chip: the file's kind, its name, the whole path on hover
     (lib/file-links.ts). It reads as a thing to open, not as underlined text,
     and stays neutral like a code span. The icons are Lucide's, drawn as masks
     in the text's colour. */
  .prose :global(a.file-chip) {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    max-width: 100%;
    padding: 0 6px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-code-background);
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-size: 0.875em;
    font-weight: 400;
    text-decoration: none;
    white-space: nowrap;
    vertical-align: baseline;
    transition: background-color var(--dur-2) var(--ease-out-quint), border-color var(--dur-2) var(--ease-out-quint);
  }

  /* A chip that carries the agent's own words reads in the answer's type. */
  .prose :global(a.file-chip:not([data-source])) {
    font-family: inherit;
    font-size: 0.95em;
    white-space: normal;
  }

  .prose :global(a.file-chip::before) {
    content: '';
    flex: none;
    align-self: center;
    width: 1.05em;
    height: 1.05em;
    background: currentColor;
    opacity: 0.7;
    -webkit-mask: var(--chip-icon) center / contain no-repeat;
    mask: var(--chip-icon) center / contain no-repeat;
  }

  .prose :global(a.file-chip:hover) {
    background: var(--color-hover);
    border-color: var(--color-edge);
  }

  .prose :global(.file-chip-name) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The folder shows only when two files of one name share the answer. */
  .prose :global(.file-chip-dir) { display: none; color: var(--color-muted-foreground); }
  .prose :global(a.file-chip.collide .file-chip-dir) { display: inline; }

  /* A file found nowhere: still a chip, still clickable to say where it was looked for. */
  /* Not found: an outline only, its name struck through in the faint ink, still readable. */
  .prose :global(a.file-chip[data-missing]) {
    color: var(--color-subtle);
    border-style: dashed;
    background: transparent;
  }
  .prose :global(a.file-chip[data-missing] .file-chip-name),
  .prose :global(a.file-chip[data-missing]:not([data-source])) {
    text-decoration: line-through;
    text-decoration-color: var(--color-faint);
  }
  .prose :global(a.file-chip[data-missing]::before) { background: var(--color-faint); opacity: 1; }

  .prose :global(a.file-chip) { --chip-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'/%3E%3Cpath d='M14 2v4a2 2 0 0 0 2 2h4'/%3E%3C/svg%3E"); }
  .prose :global(a.file-chip[data-kind='code']) { --chip-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'/%3E%3Cpath d='M14 2v4a2 2 0 0 0 2 2h4'/%3E%3Cpath d='m10 13-2 2 2 2'/%3E%3Cpath d='m14 17 2-2-2-2'/%3E%3C/svg%3E"); }
  .prose :global(a.file-chip[data-kind='doc']) { --chip-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'/%3E%3Cpath d='M14 2v4a2 2 0 0 0 2 2h4'/%3E%3Cpath d='M10 9H8'/%3E%3Cpath d='M16 13H8'/%3E%3Cpath d='M16 17H8'/%3E%3C/svg%3E"); }
  .prose :global(a.file-chip[data-kind='image']) { --chip-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='18' height='18' x='3' y='3' rx='2'/%3E%3Ccircle cx='9' cy='9' r='2'/%3E%3Cpath d='m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'/%3E%3C/svg%3E"); }
  .prose :global(a.file-chip[data-kind='video']) { --chip-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='18' height='18' x='3' y='3' rx='2'/%3E%3Cpath d='M7 3v18'/%3E%3Cpath d='M3 7.5h4'/%3E%3Cpath d='M3 12h18'/%3E%3Cpath d='M3 16.5h4'/%3E%3Cpath d='M17 3v18'/%3E%3Cpath d='M17 7.5h4'/%3E%3Cpath d='M17 16.5h4'/%3E%3C/svg%3E"); }
  .prose :global(a.file-chip[data-kind='audio']) { --chip-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 18V5l12-2v13'/%3E%3Ccircle cx='6' cy='18' r='3'/%3E%3Ccircle cx='18' cy='16' r='3'/%3E%3C/svg%3E"); }
  .prose :global(a.file-chip[data-kind='archive']) { --chip-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='20' height='5' x='2' y='3' rx='1'/%3E%3Cpath d='M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8'/%3E%3Cpath d='M10 12h4'/%3E%3C/svg%3E"); }
  .prose :global(a.file-chip[data-kind='program']) { --chip-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 11 2-2-2-2'/%3E%3Cpath d='M11 13h4'/%3E%3Crect width='18' height='18' x='3' y='3' rx='2'/%3E%3C/svg%3E"); }
  .prose :global(a.file-chip[data-kind='folder']) { --chip-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'/%3E%3C/svg%3E"); }

  /* A long press opens the link's own menu, not the phone's preview of `#file`. */
  .prose :global(a[data-file-path]), .prose :global(a[data-thread-address]) { -webkit-touch-callout: none; }

  .prose :global(ul ul),
  .prose :global(ol ol),
  .prose :global(ul ol),
  .prose :global(ol ul) {
    margin: 2px 0 0;
  }

  /* A task box reads as a mark, never as a control: it takes no pointer. */
  .prose :global(li.task) {
    list-style: none;
    margin-left: -18px;
  }

  .prose :global(li.task input) {
    width: 13px;
    height: 13px;
    margin: 0 4px 0 0;
    vertical-align: -2px;
    accent-color: var(--color-foreground);
    pointer-events: none;
  }

  .prose :global(blockquote) {
    margin: 0 0 var(--chat-block-gap);
    padding: 8px 12px;
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-muted-foreground);
  }

  .prose :global(blockquote > :last-child) {
    margin-bottom: 0;
  }

  .prose :global(hr) {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: 14px 0;
  }

  .prose :global(del) {
    color: var(--color-muted-foreground);
  }

  /* A table sits in the text flow: no box or ground, a hairline under each row, its first
     column on the text's left edge. It takes its content's width up to the column's and its cells wrap their text
     to stay inside it. Only what cannot break, a long path or too many columns,
     scrolls inside the table: a table box ignores overflow, so it is a block here,
     or a wide one pans the whole conversation on a phone. */
  .prose :global(table) {
    display: block;
    width: max-content;
    max-width: 100%;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    margin: 0 0 var(--chat-block-gap);
    border-collapse: separate;
    border-spacing: 0;
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .prose :global(th),
  .prose :global(td) {
    padding: 6px 10px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--color-border);
    /* The app's data tables keep a row on one line; an answer's table wraps at
       spaces. Not inside a word: the reading text's break-word would let the
       table split a short one to narrow a column, so a path too long for the
       column scrolls instead. */
    white-space: normal;
    word-break: normal;
  }

  .prose :global(:is(th, td):first-child) { padding-left: 0; }

  .prose :global(th) {
    font-weight: 600;
    color: var(--color-muted-foreground);
  }

  .prose :global(tbody tr:last-child td) {
    border-bottom: none;
  }

  .paragraph + .paragraph { margin-top: var(--chat-block-gap); }
  /* A long answer cut in rows (lib/timeline-rows.ts) stays one bubble: a slice
     drops the edge it shares with the next one and reaches up through the
     block gap between their rows, where the paragraph gap would have been.
     Every slice takes the whole reading measure: one of them alone fits its
     own blocks, and a short last slice drew narrower than the slices above
     it. A text long enough to be cut has a paragraph that fills the measure,
     so the whole answer was that wide unsplit. */
  .answer-bubble:is(.joined-above, .joined-below) { width: auto; }
  .answer-bubble.joined-above {
    margin-top: calc(-1 * var(--chat-block-gap));
    padding-top: var(--chat-block-gap);
    border-top: 0;
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }
  .answer-bubble.joined-below {
    padding-bottom: 0;
    border-bottom: 0;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }
  /* Only a paragraph the answer is writing now eases in. One mounted from the
     history, as a scroll brings its message back into the window, is already
     there: animating it made every scroll restyle each paragraph it reached. */
  .live .paragraph { animation: paragraph-in var(--dur-3) var(--ease-out-quint); }
  @keyframes paragraph-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
  @media (prefers-reduced-motion: reduce) { .live .paragraph { animation: none; } }
</style>
