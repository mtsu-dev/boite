<script lang="ts">
  import type { Attachment, PreviewReference } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import ComposerImageReferences from './ComposerImageReferences.svelte';
  import PreviewReferences from './PreviewReferences.svelte';

  /**
   * The composer's text field and, while something in it is painted (a
   * command, a keyword, a mention or an image reference), the paint layer
   * that draws it under a transparent text, scrolled with the field. The
   * composer owns the text and every key; this draws them.
   */
  let {
    box = $bindable(), store, key, text, highlighted, keywords, command, references, attachments, gutter, scroll, placeholder, disabled,
    onreference, onopenimage, onhoverimage, onbeforeinput, oncopy, oncut, oninput, onkeydown, onpaste, ontrack, onscroll, onfocus, onblur
  }: {
    box?: HTMLTextAreaElement;
    store: Store;
    key: string;
    text: string;
    highlighted: boolean;
    keywords: boolean;
    command: string;
    references: PreviewReference[];
    attachments: Attachment[];
    /** The field's scrollbar width, which the paint layer leaves out. */
    gutter: number;
    scroll: number;
    placeholder: string;
    disabled: boolean;
    onreference: (reference: PreviewReference) => void;
    onopenimage: (attachment: Attachment) => void;
    onhoverimage: (attachment: Attachment | null) => void;
    onbeforeinput: (event: InputEvent) => void;
    oncopy: (event: ClipboardEvent) => void;
    oncut: (event: ClipboardEvent) => void;
    oninput: (event: Event) => void;
    onkeydown: (event: KeyboardEvent) => void;
    onpaste: (event: ClipboardEvent) => void;
    ontrack: () => void;
    onscroll: () => void;
    onfocus: () => void;
    onblur: () => void;
  } = $props();

  /** A press on the gap under the field (the phone's, the wrap's padding) lands in the field. */
  function reach(event: PointerEvent): void {
    if (event.target !== event.currentTarget || !box || disabled) return;
    event.preventDefault();
    box.focus();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="input-wrap" onpointerdown={reach}>
{#if highlighted}
  <div class="input-highlight" aria-hidden={references.length || attachments.length ? undefined : true} data-testid="composer-highlight" style:right={`${gutter}px`}>
    <div class="input-paint input-mirror" style:transform={`translateY(${-scroll}px)`}><PreviewReferences {text} {references} {store} threadId={key} editing {keywords} command={command || undefined} {onreference}>{#snippet paint(parts)}<ComposerImageReferences segments={parts} {attachments} onopen={onopenimage} onhover={onhoverimage} />{/snippet}</PreviewReferences>{'\n'}</div>
  </div>
{/if}
<textarea
  class:highlighted
  bind:this={box}
  value={text}
  {onbeforeinput}
  {oncopy}
  {oncut}
  {oninput}
  {onkeydown}
  {onpaste}
  onkeyup={ontrack}
  {onscroll}
  onclick={ontrack}
  onselect={ontrack}
  {onfocus}
  {onblur}
  rows="1"
  {disabled}
  {placeholder}
  aria-label={placeholder}
  data-testid="composer-input"
  spellcheck={!command}
></textarea>
</div>

<style>
  /* The bottom gap sits under the box: a textarea scrolls its text through its own padding, up to the bar. */
  .input-wrap { position: relative; margin-bottom: var(--composer-input-gap, 6px); }
  .input-highlight {
    position: absolute;
    inset: 0; /* Stretched by CSS: clientWidth is rounded, and 0.4 px off broke lines a word apart, the caret trailing the paint. */
    overflow: hidden;
    pointer-events: none;
    z-index: 1;
  }

  .input-paint {
    white-space: pre-wrap;
    overflow-wrap: break-word;
    color: var(--color-foreground);
    /* Follows the textarea's scroll: reduced motion's blanket transition would paint each step a frame late. */
    transition-property: none;
  }

  textarea.highlighted { color: transparent; caret-color: var(--color-accent); }
  textarea.highlighted::selection { background: var(--color-accent-soft); }

  textarea, .input-paint {
    /* A textarea's own text-rendering: auto drops kerning on Android, and the caret drifted from the painted letters. */
    text-rendering: optimizeLegibility; font-kerning: normal; font-variant-ligatures: normal; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; width: 100%;
    min-height: calc(var(--composer-input-height, 44px) - var(--composer-input-gap, 6px));
    max-height: 200px;
    padding: var(--composer-input-padding, 12px 14px 0);
    border: none;
    background: transparent;
    font-size: var(--text-reading);
    line-height: var(--leading-reading);
  }

  textarea { display: block; }
  /* The hint is one line at any width: a box sized to its content would grow a second line for it. */
  textarea::placeholder { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .input-paint { max-height: none; }
  @supports (field-sizing: content) { textarea { field-sizing: content; max-height: min(200px, calc(8lh + 16px)); } }

  textarea:focus {
    outline: none;
    border: none;
  }

  @media (max-width: 720px) {
    textarea, .input-mirror { font-size: var(--text-md); }
    /* The gap under the field stays outside it, so a scrolled line stops short of the bar, but it is the wrap's
       padding: a finger landing there still reaches the field (`reach`), the whole height a target. */
    .input-wrap { margin-bottom: 0; padding-bottom: var(--composer-input-gap, 6px); }
    /* The microphone and send stand at the field's end (ComposerBar, `--composer-tools` in Composer): the text and its mirror stop short of them. */
    textarea, .input-paint { padding-right: calc(var(--composer-tools) + 8px); }
  }
</style>
