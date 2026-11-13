import { selectionDiffers, statedSelection, type ModelInfo, type SwitchSide, type ThreadSummary, type Turn, type TurnSwitch } from '@boite/contracts';
import { count, effortName, providerName } from './format';
import { isNamedModel } from './model-order';
import { fill, strings } from './strings';

/** One side of a change before the core named its account: what a thread's own selection gives. */
export type Selection = Omit<SwitchSide, 'account'> & { account?: string };

/** A change of selection as a divider draws it: recorded on a turn, or only picked so far. */
export type SwitchShown = Pick<TurnSwitch, 'reason' | 'handover'> & { from: Selection; to: Selection };

/** What names a selection: the owning machine's providers, accounts and model lists. */
export interface SwitchNames {
  providers: readonly { id: string; name: string }[];
  accounts: readonly { id: string; providerId: string; label: string }[];
  modelsOf(providerId: string, accountId: string | null): ModelInfo[];
}

/**
 * The selection a thread holds for its next turn when the transcript last
 * stated another: the last turn that started, a cache ping aside, at the
 * effort and speed it started on. The core records the same difference on the
 * turn that first runs on it (`Turn.switched`); until then the timeline draws
 * it at its foot. Null on a thread that has run nothing, and again once the
 * user picks the stated selection back.
 */
export function pendingSwitch(thread: (Pick<ThreadSummary, 'id' | 'providerId' | 'accountId' | 'model' | 'effort' | 'speed'> & { turns: readonly Turn[] }) | null, threadId: string): SwitchShown | null {
  if (!thread || thread.id !== threadId) return null;
  let last: Turn | null = null;
  for (const turn of thread.turns) {
    if (turn.startedAt === null || !turn.execution || turn.execution.operation === 'keepalive') continue;
    if (last === null || turn.startedAt >= last.startedAt!) last = turn;
  }
  if (last === null) return null;
  const from = statedSelection(last.execution!);
  const to = { providerId: thread.providerId, accountId: thread.accountId, model: thread.model, effort: thread.effort, speed: thread.speed ?? null };
  return selectionDiffers(from, to) ? { from, to } : null;
}

function modelOf(names: SwitchNames, side: Selection): ModelInfo | undefined {
  if (side.model === null) return undefined;
  const own = names.modelsOf(side.providerId, side.accountId).find(model => model.id === side.model);
  if (own) return own;
  // An account removed since lists nothing: another account of the agent names the same model.
  for (const account of names.accounts) {
    if (account.providerId !== side.providerId || account.id === side.accountId) continue;
    const other = names.modelsOf(side.providerId, account.id).find(model => model.id === side.model);
    if (other) return other;
  }
  return undefined;
}

/** The model as an answer is signed with it: its name, or the agent's when the model has none of its own. */
function modelName(names: SwitchNames, side: Selection): string {
  const model = modelOf(names, side);
  return side.model && isNamedModel(model ?? { id: side.model, name: side.model }) ? model?.name ?? side.model : providerName(names, side.providerId);
}

function speedName(names: SwitchNames, side: Selection): string {
  if (side.speed === null) return strings.chat.switched.standard;
  return (modelOf(names, side)?.speeds?.find(speed => speed.id === side.speed)?.label ?? side.speed).toLocaleLowerCase();
}

function accountName(names: SwitchNames, side: Selection): string {
  return side.account || names.accounts.find(account => account.id === side.accountId)?.label || side.accountId;
}

/** The words of a divider. `lead` is the model both sides share, said once; each side says only what changed. */
export interface SwitchWords {
  lead: string | null;
  from: string;
  to: string;
  /** Another agent: each side carries its own mark. */
  agents: boolean;
}

/**
 * `Opus 5.5 high` to `GPT 6.1 Sol medium` when the model changed, `Opus 5.5`
 * then `high` to `medium` when only the effort did: the model, the effort,
 * the speed and the account each appear only when they differ. An effort the
 * agent picks by itself reads as the default beside a named one.
 */
export function switchWords(names: SwitchNames, { from, to }: Pick<SwitchShown, 'from' | 'to'>): SwitchWords {
  const agents = from.providerId !== to.providerId;
  const model = agents || from.model !== to.model;
  const effort = from.effort !== to.effort;
  const speed = (from.speed ?? null) !== (to.speed ?? null);
  const account = !agents && from.accountId !== to.accountId;
  const side = (own: Selection): string => {
    const words: string[] = [];
    if (model) words.push(modelName(names, own));
    if (effort && own.effort !== null) words.push(effortName(modelOf(names, own), own.effort).toLocaleLowerCase());
    else if (effort && !model) words.push(strings.chat.switched.defaultEffort);
    if (speed) words.push(speedName(names, own));
    const said = words.join(' ');
    if (!account) return said;
    return said ? `${said}, ${accountName(names, own)}` : accountName(names, own);
  };
  return { lead: model ? null : modelName(names, to), from: side(from), to: side(to), agents };
}

/** What follows the change on the line: why the core made it, and that a new session was handed the context. */
export function switchSuffix(names: SwitchNames, shown: SwitchShown): string[] {
  const t = strings.chat.switched;
  const said: string[] = [];
  if (shown.reason) {
    const account = shown.from.account || names.accounts.find(entry => entry.id === shown.from.accountId)?.label;
    said.push(account ? fill(t.reason[shown.reason], { account }) : t.reasonBare[shown.reason]);
  }
  if (shown.handover) said.push(shown.handover.session === 'resumed' ? t.resumed : t.handedOver);
  return said;
}

/** The counts behind "context handed over": the sentence for its kind of session, then what went and its size. */
export function handoverDetail(handover: NonNullable<TurnSwitch['handover']>): { text: string; counts: string } {
  const t = strings.chat.switched;
  const of = (one: string, many: string, value: number): string => fill(value === 1 ? one : many, { count: count(value) });
  const counts = [of(t.fullOne, t.fullMany, handover.full)];
  if (handover.cut > 0) counts.push(of(t.cutOne, t.cutMany, handover.cut));
  if (handover.omitted > 0) counts.push(of(t.omittedOne, t.omittedMany, handover.omitted));
  counts.push(of(t.charsOne, t.charsMany, handover.chars));
  return { text: handover.session === 'resumed' ? t.detailResumed : t.detailFresh, counts: counts.join(' · ') };
}
