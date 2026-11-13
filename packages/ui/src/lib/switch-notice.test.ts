import { expect, test } from 'vitest';
import type { ModelInfo, Turn, TurnExecution } from '@boite/contracts';
import { handoverDetail, pendingSwitch, switchSuffix, switchWords, type Selection, type SwitchNames } from './switch-notice';

const effort = { levels: [{ id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }], default: 'high' };
const MODELS: Record<string, ModelInfo[]> = {
  claude: [
    { id: 'opus', name: 'Opus 5.5', effort, speeds: [{ id: 'fast', label: 'Fast' }] },
    { id: 'default', name: 'Default (recommended)' },
  ],
  codex: [{ id: 'sol', name: 'GPT 6.1 Sol', effort }],
};
const names: SwitchNames = {
  providers: [{ id: 'claude', name: 'Claude' }, { id: 'codex', name: 'Codex' }],
  accounts: [
    { id: 'a-main', providerId: 'claude', label: 'Main' },
    { id: 'a-side', providerId: 'claude', label: 'Second seat' },
    { id: 'a-codex', providerId: 'codex', label: 'Work' },
  ],
  // The account signed out since lists nothing.
  modelsOf: (providerId, accountId) => accountId === 'a-side' ? [] : MODELS[providerId] ?? [],
};
const opus: Selection = { providerId: 'claude', accountId: 'a-main', model: 'opus', effort: 'high', speed: null };

function execution(selection: Selection, extra: Partial<TurnExecution> = {}): TurnExecution {
  return { ...selection, permissionMode: 'default', sessionId: null, sessionGeneration: 0, selectionVersion: 0, ...extra } as TurnExecution;
}
function turn(id: string, startedAt: number | null, selection: Selection, extra: Partial<TurnExecution> = {}): Turn {
  return { id, threadId: 't', status: startedAt === null ? 'queued' : 'done', queuedAt: startedAt ?? 9, startedAt, finishedAt: startedAt, usage: null, error: null, execution: execution(selection, extra) };
}
const thread = (selection: Selection, turns: Turn[]) => ({ id: 't', ...selection, turns });

test('each side says only what changed, and the model both share is said once', () => {
  expect(switchWords(names, { from: opus, to: { ...opus, effort: 'medium' } })).toEqual({ lead: 'Opus 5.5', from: 'high', to: 'medium', agents: false });
  expect(switchWords(names, { from: opus, to: { providerId: 'codex', accountId: 'a-codex', model: 'sol', effort: 'medium', speed: null } }))
    .toEqual({ lead: null, from: 'Opus 5.5 high', to: 'GPT 6.1 Sol medium', agents: true });
  // Another model at the same effort: the effort is not repeated.
  expect(switchWords(names, { from: opus, to: { providerId: 'codex', accountId: 'a-codex', model: 'sol', effort: 'high', speed: null } }))
    .toEqual({ lead: null, from: 'Opus 5.5', to: 'GPT 6.1 Sol', agents: true });
  // An effort the agent picks by itself reads as the default; a speed with no tier as standard.
  expect(switchWords(names, { from: { ...opus, effort: null }, to: opus })).toMatchObject({ from: 'default', to: 'high' });
  expect(switchWords(names, { from: opus, to: { ...opus, speed: 'fast' } })).toMatchObject({ lead: 'Opus 5.5', from: 'standard', to: 'fast' });
  // Another account of the same agent: the accounts, and the model named from the account that still lists it.
  expect(switchWords(names, { from: { ...opus, accountId: 'a-side' }, to: opus })).toEqual({ lead: 'Opus 5.5', from: 'Second seat', to: 'Main', agents: false });
  // A model with no name of its own is said as its agent.
  expect(switchWords(names, { from: { ...opus, model: 'default' }, to: opus })).toMatchObject({ from: 'Claude', to: 'Opus 5.5' });
});

test('a thread shows a pending change only against the last turn that started', () => {
  const picked = { ...opus, effort: 'medium' };
  // Nothing ran: nothing to compare with.
  expect(pendingSwitch(thread(picked, []), 't')).toBeNull();
  expect(pendingSwitch(thread(picked, [turn('queued', null, opus)]), 't')).toBeNull();
  // A cache ping states nothing.
  expect(pendingSwitch(thread(picked, [turn('ping', 5, opus, { operation: 'keepalive' })]), 't')).toBeNull();
  expect(pendingSwitch(thread(picked, [turn('a', 1, opus)]), 't')).toEqual({ from: opus, to: picked });
  // Picked back: the row goes.
  expect(pendingSwitch(thread(opus, [turn('a', 1, opus)]), 't')).toBeNull();
  // The later turn is the one the transcript last stated, whatever their order in the page.
  expect(pendingSwitch(thread(picked, [turn('b', 2, picked), turn('a', 1, opus)]), 't')).toBeNull();
  // A turn whose effort changed while it ran still states the one it started on.
  expect(pendingSwitch(thread(picked, [turn('a', 1, picked, { startedOn: { effort: 'high', speed: null } })]), 't')).toEqual({ from: opus, to: picked });
  // Another thread's turns say nothing of this one.
  expect(pendingSwitch(thread(picked, [turn('a', 1, opus)]), 'other')).toBeNull();
});

test('a handover says its kind of session and counts what went', () => {
  expect(handoverDetail({ session: 'fresh', full: 3, cut: 1, omitted: 0, chars: 1840 })).toEqual({
    text: 'A new session started on excerpts of this conversation, not on what the previous one held.',
    counts: '3 messages in full · 1 shortened · 1,840 characters',
  });
  expect(handoverDetail({ session: 'resumed', full: 1, cut: 0, omitted: 2, chars: 1 }).counts).toBe('1 message in full · 2 left out · 1 character');
  const moved = { from: { ...opus, accountId: 'a-side', account: 'Second seat' }, to: opus };
  expect(switchSuffix(names, { ...moved, reason: 'signed-out', handover: { session: 'fresh', full: 2, cut: 0, omitted: 0, chars: 40 } }))
    .toEqual(['Second seat signed out', 'context handed over']);
  expect(switchSuffix(names, { from: { ...opus, accountId: 'gone' }, to: opus, reason: 'removed', handover: { session: 'resumed', full: 0, cut: 0, omitted: 0, chars: 0 } }))
    .toEqual(['account removed', 'session resumed']);
  expect(switchSuffix(names, { from: opus, to: { ...opus, effort: 'low' } })).toEqual([]);
});
