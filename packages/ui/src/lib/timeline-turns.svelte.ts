import type { Message, Turn } from '@boite/contracts';
import { chatPrefs } from './chat-prefs.svelte';
import { retryTurn } from './composer-edit';
import { focusComposer } from './focus';
import { firstAssistantByTurn, firstByTurn } from './message-order';
import { windowStats } from './message-window';
import { editWhole } from './reading-window';
import type { Store } from './store.svelte';
import { TurnFileCache, answersByTurn, showsTurnFiles, type TurnFilesData } from './turn-files';
import { TurnProgress } from './turn-progress.svelte';

/**
 * What the message list knows about each turn of its thread, and what a turn
 * offers from its rows: its first and last messages, its files, and edit,
 * retry and fork. Derived once per list, never per drawn row.
 */
export class TimelineTurns {
  #store: () => Store;
  #threadId: () => string;
  #messages: () => Message[];
  #timeline: () => Message[];

  constructor(store: () => Store, threadId: () => string, messages: () => Message[], timeline: () => Message[]) {
    this.#store = store;
    this.#threadId = threadId;
    this.#messages = messages;
    this.#timeline = timeline;
    this.progress = new TurnProgress(messages);
  }

  // Finished and streaming messages are derived apart, so a delta never rescans the thread.
  readonly progress: TurnProgress;
  /** One model attribution per turn, independent of the rendered window and streamed parts. */
  readonly firstAssistant = $derived.by(() => firstAssistantByTurn(this.#messages()));
  /** The last row of each turn: a later message of the same turn replaces an earlier one. */
  readonly last = $derived.by(() => new Map(this.#timeline().map((message): [string, string] => [message.turnId, message.id])));
  readonly first = $derived.by(() => firstByTurn(this.#messages()));
  /** Each turn's answers, rebuilt when a message comes or goes, never on a part or a delta. */
  readonly #answers = $derived.by(() => answersByTurn(this.#messages()));
  readonly #fileCache = new TurnFileCache();

  /** A turn end's file summary, derived per closing row: a part on the running turn rereads no finished turn. */
  filesOf(turn: Turn): TurnFilesData | null {
    const thread = this.#store().openThread;
    if (!thread || thread.id !== this.#threadId() || !showsTurnFiles(turn, chatPrefs.groupChanges)) return null;
    windowStats.turnFiles += 1;
    const data = this.#fileCache.read(turn.id, this.#answers.get(turn.id) ?? [], thread.cwd, turn.status === 'running');
    return data.files.length ? data : null;
  }

  /**
   * Edit and retry go through the core's rewind, fork through its fork, and
   * only on a thread at rest: a turn still running is stopped first (Escape).
   * A persistent agent's thread rewinds like any other, but has no project to
   * fork into.
   */
  readonly #branchable = $derived.by(() => {
    const store = this.#store();
    return store.openThread?.id === this.#threadId() && (!!store.openThread.agentSessionId || store.openThread.projectId !== null);
  });
  readonly forkable = $derived.by(() => this.#branchable && !this.#store().openThread?.agentSessionId);
  // A prompt still waiting in the queue would run after the edit, on the rewound thread, as would an edit started under a prompt still on its way to the core.
  readonly atRest = $derived.by(() => {
    const store = this.#store(), threadId = this.#threadId();
    return this.#branchable && !store.busy && (store.composerStates[threadId]?.queued.length ?? 0) === 0 && !store.composerStates[threadId]?.sending;
  });

  async edit(message: Message): Promise<void> {
    if (await editWhole(this.#store(), this.#threadId(), message)) focusComposer({ typing: true });
  }

  /** The last turn again from its own prompt, on screen before the core rewinds (`retryTurn`). */
  async retry(turnId: string): Promise<void> {
    const prompt = this.#messages().find((message) => message.turnId === turnId && message.role === 'user');
    if (prompt) await retryTurn(this.#store(), this.#threadId(), prompt);
  }
}
