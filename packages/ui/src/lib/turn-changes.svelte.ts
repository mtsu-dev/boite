import type { Message, Turn } from '@boite/contracts';
import { chatPrefs } from './chat-prefs.svelte';
import { windowStats } from './message-window';
import type { Store } from './store.svelte';
import { TurnFileCache, answersByTurn, changeHost, showsTurnFiles, type TurnFilesData } from './turn-files';

/**
 * A turn end's change count for the timeline (MessageList): the files a turn
 * touched, and the tool line its count joins. Answers are rebuilt when a
 * message comes or goes, never on a part or a delta, and each closing row
 * derives its own summary, so a part on the running turn rereads no finished one.
 */
export class TurnChanges {
  readonly #store: () => Store;
  readonly #threadId: () => string;
  readonly #messages: () => readonly Message[];
  readonly #drawn: () => readonly Message[];
  readonly #cache = new TurnFileCache();
  /** Each turn's answers. */
  #answers = $derived.by(() => answersByTurn(this.#messages()));
  /** Each turn's answers as drawn (a bot's fold took its calls out), rebuilt when the timeline is. */
  #drawnAnswers = $derived.by(() => answersByTurn(this.#drawn()));

  /** `drawn`: the timeline's messages that are drawn as messages (not cards, groups, folds or markers). */
  constructor(store: () => Store, threadId: () => string, messages: () => readonly Message[], drawn: () => readonly Message[]) {
    this.#store = store;
    this.#threadId = threadId;
    this.#messages = messages;
    this.#drawn = drawn;
  }

  /** A turn end's file summary, or null when it has none to show. */
  filesOf(turn: Turn): TurnFilesData | null {
    const thread = this.#store().openThread;
    if (!thread || thread.id !== this.#threadId() || !showsTurnFiles(turn, chatPrefs.groupChanges)) return null;
    windowStats.turnFiles += 1;
    const data = this.#cache.read(turn.id, this.#answers.get(turn.id) ?? [], thread.cwd, turn.status === 'running');
    return data.files.length ? data : null;
  }

  /** The tool line a turn's change count joins, or null when it stands at the turn's end. */
  hostOf(turnId: string): { messageId: string; index: number } | null {
    const own = this.#drawnAnswers.get(turnId);
    return own ? changeHost(own) : null;
  }
}
