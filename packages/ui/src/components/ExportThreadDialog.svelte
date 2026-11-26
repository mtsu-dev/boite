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
  import { activeLocale } from '../lib/i18n.svelte';
  import { downloadExport, exportFilename, exportThreadHtml, exportThreadMarkdown, type ExportOptions, type ExportProgress } from '../lib/thread-export';
  import PrivateText from './PrivateText.svelte';

  let { store, thread, onclose }: { store: Store; thread: ThreadSummary; onclose: () => void } = $props();
  let currentThread = $derived(store.threads.find(entry => entry.id === thread.id) ?? thread);
  let dialog: HTMLDialogElement;
  let options = $state<ExportOptions>({ format: 'markdown', includeTools: false, includeDiffs: false, includeThinking: false });
  let busyAction = $state<null | 'copy' | 'download'>(null);
  let busy = $derived(busyAction !== null);
  let progress = $state<ExportProgress | null>(null);
  let failure = $state('');
  let savedPath = $state('');
  let shareReady = $state(false);
  let retryCopy: { key: string; content: string } | null = null;
  let retryShare: { filename: string; content: string; mimeType: string } | null = null;
  let releaseHistory: (() => void) | null = null;
  const controller = new AbortController();
  const overlay = new Closing();
  overlay.show();

  let loadingLabel = $derived.by(() => {
    if (!progress) return strings.threadExport.loading;
    if (progress.phase === 'tools' && progress.total) {
      return fill(strings.threadExport.loadingTools, { done: String(progress.done), total: String(progress.total) });
    }
    if (progress.phase === 'messages' && progress.total) {
      return fill(strings.threadExport.loadingMessages, { done: String(progress.done), total: String(progress.total) });
    }
    if (progress.phase === 'pages' && progress.done > 1) {
      return fill(strings.threadExport.loadingPages, { count: String(progress.done) });
    }
    return strings.threadExport.loading;
  });

  $effect(() => {
    // Clear prior save/share state once the user adjusts export options or language.
    void options.format;
    void options.includeTools;
    void options.includeDiffs;
    void options.includeThinking;
    void activeLocale();
    savedPath = '';
    shareReady = false;
    retryShare = null;
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
    const tail = open?.messages.at(-1);
    const parts = tail?.parts.map(part => {
      if (part.type === 'text') return `t:${part.text.length}:${part.displayText?.length ?? 0}`;
      if (part.type === 'thinking') return `k:${part.text.length}`;
      if (part.type === 'tool') return `o:${part.toolId}:${part.status}:${part.output?.length ?? 0}:${part.documents?.length ?? 0}`;
      if (part.type === 'error') return `e:${part.message.length}`;
      return part.type;
    }).join(',') ?? '';
    return JSON.stringify([selected, activeLocale(), currentThread.updatedAt, currentThread.title, currentThread.branch ?? '', currentThread.model ?? '', open?.status ?? '', open?.messages.length ?? 0, tail?.id ?? '', tail?.state ?? '', parts]);
  }

  async function buildContent(selected: ExportOptions): Promise<string> {
    progress = null;
    const target = currentThread;
    const messages = await store.threadExportMessages(target.id, selected, controller.signal, next => { progress = next; });
    controller.signal.throwIfAborted();
    const project = store.projects.find(entry => entry.id === target.projectId);
    const model = store.modelsOf(target.providerId, target.accountId).find(entry => entry.id === target.model);
    const meta = { projectName: project ? projectName(project) : null, modelName: model?.name };
    return selected.format === 'markdown'
      ? exportThreadMarkdown(target, messages, selected, meta)
      : exportThreadHtml(target, messages, selected, meta);
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
        shareReady = false;
        retryShare = null;
        // After a failed clipboard write, retry synchronously inside the next click gesture if nothing changed.
        if (retryCopy?.key === key) {
          if (!await store.copy(retryCopy.content, { reportFailure: false, within: dialog })) {
            failure = strings.errors.clipboard;
            return;
          }
          retryCopy = null;
          close();
          return;
        }
        retryCopy = null;
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
          // Only cache for retry if the conversation did not mutate while reading history.
          retryCopy = cacheKey(selected) === key ? { key, content } : null;
          failure = strings.errors.clipboard;
          return;
        }
        close();
      } else {
        retryCopy = null;
        // If mobile Web Share lost user activation on a slow read, invoke it synchronously on this fresh tap.
        if (retryShare) {
          const prepared = retryShare;
          retryShare = null;
          shareReady = false;
          const result = await downloadExport(prepared.filename, prepared.content, prepared.mimeType, { retryShare: true });
          if (result.cancelled) return;
          close();
          return;
        }
        const content = await buildContent(selected);
        const filename = exportFilename(currentThread.title, selected.format);
        const mimeType = `${markdown ? 'text/markdown' : 'text/html'};charset=utf-8`;
        const result = await downloadExport(filename, content, mimeType);
        if (result.sharePending) {
          retryShare = { filename, content, mimeType };
          shareReady = true;
          return;
        }
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
  aria-labelledby="thread-export-title" aria-describedby="thread-export-thread"
  data-testid="thread-export-dialog" onclick={backdrop} onkeydown={keydown} oncancel={(event) => { event.preventDefault(); close(); }}>
  <header>
    <div class="heading">
      <h2 id="thread-export-title">{strings.threadExport.title}</h2>
      <p id="thread-export-thread" class="muted"><PrivateText text={currentThread.title} /></p>
    </div>
    <button type="button" class="ghost icon close-btn" aria-label={strings.common.close} onclick={close}><X size={16} /></button>
  </header>

  <div class="fields">
    <div class="controls" aria-busy={busy}>
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
    </div>
    {#if savedPath}<p class="saved" role="status">{fill(strings.threadExport.savedTo, { path: savedPath })}</p>{/if}
    {#if shareReady}<p class="saved" role="status">{strings.threadExport.shareReady}</p>{/if}
    <p class="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-testid="thread-export-status">{busy ? loadingLabel : ''}</p>
    {#if failure}<p class="error" role="alert">{strings.threadExport.failed}. {failure}</p>{/if}
  </div>

  <footer>
    {#if options.format === 'markdown'}
      <button type="button" class="ghost" disabled={busy} aria-busy={busyAction === 'copy'} onclick={() => void exportConversation(true)}><Clipboard size={15} /><span>{busyAction === 'copy' ? loadingLabel : strings.threadExport.copy}</span></button>
    {/if}
    <button type="button" class="primary" disabled={busy} aria-busy={busyAction === 'download'} onclick={() => void exportConversation(false)}><Download size={16} /><span>{busyAction === 'download' ? loadingLabel : shareReady ? strings.threadExport.share : strings.threadExport.download}</span></button>
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
  .formats span { display: grid; place-items: center; min-height: var(--control); margin: 0; padding: 0 var(--space-1); border-radius: var(--radius-sm); text-align: center; }
  .formats input:checked + span { background: var(--color-accent-soft); color: var(--color-foreground); }
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
