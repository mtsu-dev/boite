import type { Attachment, PreviewReference } from '@boite/contracts';
import { focusInitial } from './focus';
import { checkpoint } from './composer-history';
import type { ComposerState, SentPrompt } from './composer-queue';
import { restorePreviewMentions } from './preview-mentions';
import { clearStash, readStash, writeStash } from './prefs';
import { editWhole } from './reading-window';
import type { Store } from './store.svelte';
import { strings } from './strings';

/** What the composer shows the recall, read fresh at every call. */
export interface RecallHost {
  store: Store;
  key: string;
  /** The thread the box sends to: none when it speaks to an agent. */
  thread: Store['openThread'];
  composer: ComposerState | undefined;
  text: string;
  attachments: Attachment[];
  previewReferences: PreviewReference[];
  /** This thread's own sent prompts, most recent first: what ArrowUp walks. */
  sent: SentPrompt[];
  box: HTMLTextAreaElement | undefined;
  /** This input's state, created on first use. */
  state(): ComposerState;
  /** Writes a recalled or restored prompt in, caret at its end. */
  put(value: string, at?: number): void;
  /** The caret moved to `at` and the box is measured again on the next frame. */
  landed(at: number): void;
}

/**
 * ArrowUp and ArrowDown through this thread's sent prompts and queued ones, the
 * edit a recalled prompt opens, and the stash chord that sets text aside.
 */
export class PromptRecall {
  /** Where ArrowUp stands in this thread's sent prompts, or null outside recall. */
  at = $state<number | null>(null);
  /** A recalled edit still being read whole from the core. */
  read = $state<Promise<boolean> | null>(null);
  #host: () => RecallHost;

  constructor(host: () => RecallHost) {
    this.#host = host;
  }

  /** ArrowUp: one prompt older, or nothing when the user typed the text themselves. */
  older(): boolean {
    const { text, previewReferences, composer, attachments, sent } = this.#host();
    if (this.at === null && (text.length > 0 || previewReferences.length > 0)) return false;
    if (this.at === null && composer?.queued.length && !composer.sending && attachments.length === 0) {
      this.restoreQueued(composer.queued.length - 1);
      return true;
    }
    const next = this.at === null ? 0 : this.at + 1;
    const prompt = sent[next];
    if (prompt === undefined) return this.at !== null;
    this.at = next;
    this.#recallPrompt(prompt);
    return true;
  }

  /** An idle thread recalls a fully hydrated edit; a running thread recalls words to queue. */
  #recallPrompt(prompt: SentPrompt) {
    const host = this.#host();
    const { store, thread } = host;
    const state = host.state();
    const edit = !store.busy && state.queued.length === 0 && thread !== null && (!!thread.agentSessionId || thread.projectId !== null);
    if (edit) {
      const owner = store, inputKey = host.key, at = this.at;
      const message = thread?.messages.find(message => message.id === prompt.id);
      if (!message) return;
      checkpoint(state);
      const loading = editWhole(owner, inputKey, message, () => { const now = this.#host(); return now.store === owner && now.key === inputKey && this.at === at && this.read === loading; });
      this.read = loading;
      void loading.then(applied => {
        if (applied) this.#host().landed(state.text.length);
      }).finally(() => { if (this.read === loading) this.read = null; });
      return;
    }
    this.read = null;
    this.#restorePrompt(prompt.text, prompt.previewReferences);
    if (state.editing) state.attachments = [];
    state.editing = null;
  }

  /** Leaves edit mode: the box empties, nothing was rewound. */
  cancelEdit() {
    const host = this.#host();
    const state = host.state();
    checkpoint(state);
    state.editing = null;
    state.attachments = [];
    state.previewReferences = [];
    this.at = null; this.read = null;
    host.put('');
    focusInitial(host.box, host.box?.closest<HTMLElement>('[data-testid=composer]'));
  }

  restoreQueued(at: number) {
    const host = this.#host();
    const state = host.composer;
    if (!state || state.sending || host.text.length > 0 || host.attachments.length > 0 || host.previewReferences.length > 0) return;
    const entry = host.store.restoreQueued(host.key, at);
    if (!entry) return;
    checkpoint(state);
    state.attachments = entry.attachments;
    this.at = null;
    this.#restorePrompt(entry.text, entry.previewReferences ?? []);
    host.box?.focus({ preventScroll: true });
  }

  /** ArrowDown: one prompt newer, and past the newest the composer is empty again. */
  newer(): boolean {
    if (this.at === null) return false;
    const host = this.#host();
    const next = this.at - 1;
    if (next < 0) {
      this.at = null;
      const state = host.state();
      checkpoint(state);
      state.previewReferences = [];
      if (state.editing) { state.editing = null; state.attachments = []; }
      host.put('');
      return true;
    }
    const prompt = host.sent[next];
    if (prompt === undefined) return true;
    this.at = next;
    this.#recallPrompt(prompt);
    return true;
  }

  #restorePrompt(text: string, references: PreviewReference[]) {
    const host = this.#host();
    const restored = restorePreviewMentions(text, references);
    host.put(restored.text);
    host.state().previewReferences = restored.references;
  }

  /** The stash chord sets text aside for this thread; an empty composer takes it back. */
  stash() {
    const host = this.#host();
    const { store } = host;
    if (host.previewReferences.length) { store.error = strings.previewComments.stashUnsupported; return; }
    const stashKey = store.threadKey(host.key);
    if (host.text.trim().length > 0) {
      writeStash(stashKey, host.text);
      this.at = null;
      // The text set aside is plain text: the next prompt typed is not an edit of a sent one.
      const state = host.state();
      checkpoint(state);
      if (state.editing) { state.editing = null; state.attachments = []; }
      host.put('');
      return;
    }
    const stashed = readStash(stashKey);
    if (stashed === null) return;
    clearStash(stashKey);
    this.at = null;
    host.put(stashed);
  }
}
