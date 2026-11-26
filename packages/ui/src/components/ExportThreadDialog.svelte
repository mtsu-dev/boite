<script lang="ts">
  import { Clipboard, Download, X } from '@lucide/svelte';
  import type { ThreadSummary } from '@boite/contracts';
  import { onMount } from 'svelte';
  import { Closing } from '../lib/closing.svelte';
  import { errorText } from '../lib/errors';
  import { focusedElement, restoreFocus } from '../lib/focus';
  import { projectName } from '../lib/format';
  import { mobileOverlay } from '../lib/mobile-history';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { downloadExport, exportFilename, exportThreadHtml, exportThreadMarkdown, type ExportOptions, type ExportProgress } from '../lib/thread-export';
  import PrivateText from './PrivateText.svelte';

  let { store, thread, onclose }: { store: Store; thread: ThreadSummary; onclose: () => void } = $props();
  let dialog: HTMLDialogElement;
  let options = $state<ExportOptions>({ format: 'markdown', includeTools: false, includeDiffs: false, includeThinking: false });
  let busyAction = $state<null | 'copy' | 'download'>(null);
  let busy = $derived(busyAction !== null);
  let progress = $state<ExportProgress | null>(null);
  let failure = $state('');
  let savedPath = $state('');
  let prepared: { key: string; content: string } | null = null;
  let releaseHistory: (() => void) | null = null;
  const controller = new AbortController();
  const overlay = new Closing();
  overlay.show();

  let loadingLabel = $derived.by(() => {
    if (!progress) return strings.threadExport.loading;
    if (progress.phase === 'tools' && progress.total) {
      return fill(strings.threadExport.loadingTools, { done: String(progress.done), total: String(progress.total) });
    }
    if (progress.phase === 'pages' && progress.done > 1) {
      return fill(strings.threadExport.loadingPages, { count: String(progress.done) });
    }
    return strings.threadExport.loading;
  });

  $effect(() => {
    // Clear prior desktop save confirmation once the user adjusts export options.
    void options.format;
    void options.includeTools;
    void options.includeDiffs;
    void options.includeThinking;
    savedPath = '';
  });

  onMount(() => {
    const focused = focusedElement();
    const trigger = document.querySelector<HTMLElement>('[data-testid="thread-menu-trigger"], [data-testid="agent-menu"]');
    const previous = !focused || focused.closest('[role="menu"]') ? trigger : focused;
    dialog.showModal();
    releaseHistory = mobileOverlay(close);
    return () => {
      controller.abort();
      releaseHistory?.();
      releaseHistory = null;
      dialog.close();
      restoreFocus(previous?.isConnected ? previous : trigger);
    };
  });

  function close(): void {
    controller.abort();
    releaseHistory?.();
    releaseHistory = null;
    overlay.hide();
  }

  $effect(() => { if (!overlay.shown) onclose(); });

  function keydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close();
  }

  function backdrop(event: MouseEvent): void {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
  }

  function cacheKey(selected: ExportOptions): string {
    const open = store.openThread?.id === thread.id ? store.openThread : null;
    const live = open
      ? `${open.messages.length}:${open.messages.at(-1)?.id ?? ''}:${open.messages.at(-1)?.parts.length ?? 0}`
      : '';
    return JSON.stringify([selected, thread.updatedAt, live]);
  }

  async function buildContent(selected: ExportOptions): Promise<string> {
    const key = cacheKey(selected);
    if (prepared?.key === key) return prepared.content;
    progress = null;
    const messages = await store.threadExportMessages(thread.id, selected, controller.signal, next => { progress = next; });
    controller.signal.throwIfAborted();
    const project = store.projects.find(entry => entry.id === thread.projectId);
    const model = store.modelsOf(thread.providerId, thread.accountId).find(entry => entry.id === thread.model);
    const meta = { projectName: project ? projectName(project) : null, modelName: model?.name };
    const content = selected.format === 'markdown'
      ? exportThreadMarkdown(thread, messages, selected, meta)
      : exportThreadHtml(thread, messages, selected, meta);
    prepared = { key, content };
    return content;
  }

  async function exportConversation(copy: boolean): Promise<void> {
    if (busy || controller.signal.aborted) return;
    busyAction = copy ? 'copy' : 'download';
    progress = null;
    failure = '';
    savedPath = '';
    const selected = { ...options };
    const key = cacheKey(selected);
    const markdown = selected.format === 'markdown';
    try {
      if (copy) {
        // When already built for the current conversation state, copy directly inside this click gesture.
        if (prepared?.key === key) {
          if (!await store.copy(prepared.content, { reportFailure: false, within: dialog })) {
            failure = strings.errors.clipboard;
            return;
          }
          close();
          return;
        }
        const pending = buildContent(selected);
        // Safari requires clipboard writes to start synchronously during the user gesture.
        const clipboard = navigator.clipboard;
        if (typeof ClipboardItem === 'function' && typeof clipboard?.write === 'function') {
          const item = new ClipboardItem({ 'text/plain': pending.then(text => new Blob([text], { type: 'text/plain' })) });
          try {
            await clipboard.write([item]);
            await pending;
            close();
            return;
          } catch {
            // Fall through to store.copy once the export text is ready.
          }
        }
        const content = await pending;
        if (!await store.copy(content, { reportFailure: false, within: dialog })) {
          failure = strings.errors.clipboard;
          return;
        }
        close();
      } else {
        const content = await buildContent(selected);
        const result = await downloadExport(exportFilename(thread.title, selected.format), content, `${markdown ? 'text/markdown' : 'text/html'};charset=utf-8`);
        if (result.cancelled) return;
        if (result.path) {
          savedPath = result.path;
          return;
        }
        close();
      }
    } catch (error) {
      if (!controller.signal.aborted) failure = errorText(error);
    } finally {
      busyAction = null;
      progress = null;
    }
  }
</script>

<dialog bind:this={dialog} use:overlay.attach class:closing={overlay.closing} onanimationend={overlay.end}
  aria-labelledby="thread-export-title" aria-describedby="thread-export-thread" aria-busy={busy}
  data-testid="thread-export-dialog" onclick={backdrop} onkeydown={keydown} oncancel={(event) => { event.preventDefault(); close(); }}>
  <header>
    <div class="heading">
      <h2 id="thread-export-title">{strings.threadExport.title}</h2>
      <p id="thread-export-thread" class="muted"><PrivateText text={thread.title} /></p>
    </div>
    <button type="button" class="ghost icon close-btn" aria-label={strings.common.close} onclick={close}><X size={16} /></button>
  </header>

  <div class="fields">
    <fieldset disabled={busy}>
      <legend>{strings.threadExport.format}</legend>
      <div class="formats">
        <label><input type="radio" name="thread-export-format" value="markdown" bind:group={options.format} /><span>{strings.threadExport.markdown}</span></label>
        <label><input type="radio" name="thread-export-format" value="html" bind:group={options.format} /><span>{strings.threadExport.html}</span></label>
      </div>
    </fieldset>
    <fieldset class="includes" disabled={busy}>
      <legend class="visually-hidden">{strings.threadExport.options}</legend>
      <label><input type="checkbox" bind:checked={options.includeTools} />{strings.threadExport.tools}</label>
      <label><input type="checkbox" bind:checked={options.includeDiffs} />{strings.threadExport.diffs}</label>
      <label><input type="checkbox" bind:checked={options.includeThinking} />{strings.threadExport.thinking}</label>
    </fieldset>
    {#if savedPath}<p class="saved" role="status">{fill(strings.threadExport.savedTo, { path: savedPath })}</p>{/if}
    {#if failure}<p class="error" role="alert">{strings.threadExport.failed}. {failure}</p>{/if}
  </div>

  <footer>
    {#if options.format === 'markdown'}
      <button type="button" class="ghost" disabled={busy} onclick={() => void exportConversation(true)}><Clipboard size={15} /><span>{busyAction === 'copy' ? loadingLabel : strings.threadExport.copy}</span></button>
    {/if}
    <button type="button" class="primary" disabled={busy} onclick={() => void exportConversation(false)}><Download size={16} /><span>{busyAction === 'download' ? loadingLabel : strings.threadExport.download}</span></button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(420px, calc(100vw - 24px));
    max-height: calc(100dvh - 24px);
    margin: auto;
    padding: 0;
    color: var(--color-foreground);
    background: var(--overlay-surface);
    border: 1px solid var(--overlay-edge);
    border-radius: var(--radius-overlay);
    box-shadow: var(--shadow-overlay);
    animation: pop var(--motion-duration) var(--motion-curve);
    overflow: auto;
    overscroll-behavior: contain;
  }
  dialog.closing { animation-name: pop-out; }
  dialog::backdrop { background: var(--color-scrim); }
  header, .fields, footer { padding: var(--space-4) var(--space-5); }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
  .heading { min-width: 0; }
  h2 { margin: 0; font-size: var(--text-md); font-weight: 650; }
  .muted { margin: var(--space-1) 0 0; font-size: var(--text-sm); overflow-wrap: anywhere; }
  .fields, footer { border-top: 1px solid var(--color-border); }
  fieldset { border: 0; min-width: 0; padding: 0; margin: 0; }
  legend { padding: 0; margin-bottom: var(--space-2); font-size: var(--text-sm); }
  .formats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-1); padding: var(--space-1); border-radius: var(--radius-md); background: var(--color-surface-3); }
  .formats label { position: relative; }
  .formats input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .formats span { display: grid; place-items: center; min-height: var(--control); padding: 0 var(--space-1); border-radius: var(--radius-sm); text-align: center; }
  .formats input:checked + span { background: var(--color-accent-soft); }
  .formats input:focus-visible + span { outline: var(--focus-ring); outline-offset: -2px; }
  .includes { display: grid; margin-top: var(--space-3); }
  .includes label { display: flex; align-items: center; min-height: var(--row); gap: var(--space-2); }
  .includes input { margin: 0; accent-color: var(--color-accent); }
  label, input { cursor: pointer; }
  fieldset:disabled { opacity: .65; }
  .saved { margin: var(--space-3) 0 0; color: var(--color-muted-foreground); font-size: var(--text-sm); overflow-wrap: anywhere; }
  .error { margin: var(--space-3) 0 0; color: var(--color-danger); overflow-wrap: anywhere; }
  footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); }
  footer button { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: var(--control); }
  @media (max-width: 720px) {
    .close-btn { min-width: var(--touch-target); min-height: var(--touch-target); }
    .formats span, .includes label, footer button { min-height: var(--touch-target); }
  }
</style>
