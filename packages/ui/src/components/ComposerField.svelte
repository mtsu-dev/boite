<script lang="ts">
  import type { Attachment, PreviewReference, PromptSuggestion, ThreadId } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { chatPrefs } from '../lib/chat-prefs.svelte';
  import { strings } from '../lib/strings';
  import { offeredSuggestion } from '../lib/prompt-suggestion.svelte';
  import ComposerSuggestion from './ComposerSuggestion.svelte';
  import ComposerImageReferences from './ComposerImageReferences.svelte';
  import PreviewReferences from './PreviewReferences.svelte';

  /**
   * The composer's text field and, while something in it is painted (a
   * command, a keyword, a mention or an image reference), the paint layer
   * that draws it under a transparent text, scrolled with the field. The
   * composer owns the text and every key; this draws them.
   */
  let {
    box = $bindable(), store, key, text, highlighted, keywords, command, references, attachments, gutter, scroll, placeholder, suggest = null, disabled,
    onsuggested, onreference, onopenimage, onhoverimage, onbeforeinput, oncopy, oncut, oninput, onkeydown, onpaste, ontrack, onscroll, onfocus, onblur
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
    /** The thread whose suggested next message the field may offer: given only while nothing else needs the box (Composer). */
    suggest?: { id: ThreadId; suggestion?: PromptSuggestion | null } | null;
    disabled: boolean;
    /** Writes the taken suggestion in as the draft; it never sends. */
    onsuggested: (text: string) => void;
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
  /** With the correction turned off, the phone keyboard also stops correcting and capitalizing. Spread because the textarea's typed attributes leave `autocorrect` out. */
  let typing = $derived<Record<string, string>>(chatPrefs.typingCorrection ? {} : { autocorrect: 'off', autocapitalize: 'off' });
  const uid = $props.id();

  /**
   * The agent's suggested next message in the empty field: ghost text with a
   * Tab badge on a desktop, a chip above the field on a phone. Tab or a tap
   * writes it in to edit, Esc or the x dismisses it for this turn.
   */
  let offered = $derived(text.length === 0 && attachments.length === 0 && references.length === 0 && !disabled ? offeredSuggestion(store, suggest) : null);
  let ghost = $derived(offered?.text ?? null);
  function takeSuggestion(): void {
    if (!offered) return;
    onsuggested(offered.text);
    box?.focus({ preventScroll: true });
  }
  function keydown(event: KeyboardEvent): void {
    const plain = !event.isComposing && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (offered && plain && (event.key === 'Tab' || event.key === 'Escape')) {
      event.preventDefault();
      if (event.key === 'Tab') takeSuggestion();
      else offered.dismiss();
      return;
    }
    onkeydown(event);
  }
</script>

{#if offered}<ComposerSuggestion text={offered.text} ontake={takeSuggestion} ondismiss={offered.dismiss} />{/if}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="input-wrap" onpointerdown={reach}>
{#if highlighted}
  <div class="input-highlight" aria-hidden={references.length || attachments.length ? undefined : true} data-testid="composer-highlight" style:right={`${gutter}px`}>
    <div class="input-paint input-mirror" style:transform={`translateY(${-scroll}px)`}><PreviewReferences {text} {references} {store} threadId={key} editing {keywords} command={command || undefined} {onreference}>{#snippet paint(parts)}<ComposerImageReferences segments={parts} {attachments} onopen={onopenimage} onhover={onhoverimage} />{/snippet}</PreviewReferences>{'\n'}</div>
  </div>
{/if}
{#if ghost}
  <div class="input-ghost" id="{uid}-ghost" data-testid="composer-suggestion" style:right={`${gutter}px`}><span class="visually-hidden">{strings.composer.suggestion.label}: </span><span class="ghost-text">{ghost}</span> <kbd class="ghost-key" aria-hidden="true">{strings.composer.suggestion.key}</kbd></div>
{/if}
<textarea
  class:highlighted
  bind:this={box}
  value={text}
  {onbeforeinput}
  {oncopy}
  {oncut}
  {oninput}
  onkeydown={keydown}
  {onpaste}
  onkeyup={ontrack}
  {onscroll}
  onclick={ontrack}
  onselect={ontrack}
  {onfocus}
  {onblur}
  rows="1"
  {disabled}
  placeholder={ghost ? '' : placeholder}
  aria-label={placeholder}
  aria-describedby={ghost ? `${uid}-ghost` : undefined}
  data-testid="composer-input"
  spellcheck={!command && chatPrefs.typingCorrection}
  {...typing}
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

  /* The suggestion sits where the placeholder would, in its color, one line cut short; a phone shows its chip instead (ComposerSuggestion). */
  .input-ghost {
    position: absolute;
    inset: 0;
    padding: var(--composer-input-padding, 12px 14px 0);
    pointer-events: none;
    color: var(--color-subtle);
    font-size: var(--text-reading);
    line-height: var(--leading-reading);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ghost-key {
    margin-left: var(--space-1);
    padding: 0 var(--space-1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-family: inherit;
    font-size: var(--text-xs);
    color: var(--color-muted-foreground);
    vertical-align: middle;
  }
  @media (max-width: 720px), (pointer: coarse) { .input-ghost { display: none; } }

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
