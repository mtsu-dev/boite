import { expect, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { test } from '../../test/fake-client';
import { AgentsView, openAgent } from '../../lib/agents.svelte';
import { setExperiment } from '../../lib/experiments';
import AgentDesk from './AgentDesk.svelte';
import BotWorkList from './BotWorkList.svelte';

const chips = () => [...document.querySelectorAll('[data-testid=desk-chip]')].map(chip => chip.textContent?.trim());
const titles = (section: 'handling' | 'done') => {
  const heading = document.querySelector(`[data-testid=bot-${section}]`);
  const rows: string[] = [];
  for (let node = heading?.nextElementSibling; node && node.matches('[data-testid=desk-card]'); node = node.nextElementSibling) rows.push(node.querySelector('.desk-card-title')!.textContent!);
  return rows;
};
const card = (title: string) => [...document.querySelectorAll<HTMLElement>('[data-testid=desk-card]')].find(node => node.querySelector('.desk-card-title')?.textContent === title);

test('Nova\'s desk is one column: who it is, its live step, its routines and its notes, and no spend', async ({ ready }) => {
  setExperiment('resident-agents', true);
  let desk: ReturnType<typeof mount> | null = null;
  try {
    const { store } = await ready({ delayMs: 0, agentsDemo: true });
    const view = AgentsView.of(store);
    await view.refresh();
    const nova = view.snapshot!.profiles.find(p => p.name === 'Nova')!;
    store.showAgents();
    await openAgent(store, nova.id);
    desk = mount(AgentDesk, { target: document.body, props: { store } });
    await vi.waitFor(() => expect(document.querySelector('[data-testid=desk-now-step]')).not.toBeNull());
    flushSync();

    // Who it is: its name, what it is for, its model, its machine and since when; no tabs and no day's spend.
    const ident = document.querySelector('[data-testid=desk-ident]')!;
    expect(ident.textContent).toContain('Nova');
    expect(ident.textContent).toContain(nova.domain);
    expect(document.querySelector('[data-testid=desk-model]')?.textContent?.trim()).not.toBe('');
    expect(document.querySelector('[data-testid=desk-since]')?.textContent).toMatch(/^Since /);
    expect(document.querySelector('[role=tablist]')).toBeNull();
    expect(document.querySelector('[data-testid=desk-today]')).toBeNull();
    expect(document.body.textContent).not.toContain('$');
    // On the Bots page of a desktop, the threads are in the column, not here.
    expect(document.querySelector('[data-testid=desk-work]')).toBeNull();

    // Now: the step its turn is on, live, and the calls so far on the rail.
    expect(document.querySelector('[data-testid=desk-now]')?.getAttribute('data-state')).toBe('working');
    expect(document.querySelector('[data-testid=desk-now-step]')?.textContent).toBe('Run the UI tests');
    expect(document.querySelector('[data-testid=desk-now]')?.textContent).toContain('4 steps so far');
    expect(document.querySelector<HTMLDetailsElement>('[data-testid=desk-activity]')?.open).toBe(false);
    expect(document.querySelectorAll('[data-testid=desk-steps] li')).toHaveLength(4);
    expect(document.querySelector('[data-testid=desk-steps] li:last-child')?.getAttribute('data-status')).toBe('running');

    // Routines: Run now waits while Nova works, as the core refuses a second turn in flight.
    const run = document.querySelector<HTMLButtonElement>('[data-testid=routine-run]')!;
    expect(run.disabled).toBe(true);
    expect(run.title).toBe('It is at work: run it again once its turn ends');
    expect(document.querySelector('[data-testid=desk-schedule]')?.textContent).toContain('Release check');
    document.querySelector<HTMLButtonElement>('[data-testid=routine-add]')!.click();
    flushSync();
    expect(document.querySelector('[data-testid=desk-schedule] textarea')).not.toBeNull();

    // Memory: the count of its notes and the first ones, in plain words, the whole file on request.
    await vi.waitFor(() => expect(document.querySelector('[data-testid=desk-memory]')?.textContent).toContain('3 notes'));
    expect([...document.querySelectorAll('[data-testid=desk-memory-text] li')].map(li => li.textContent)[0]).toBe('The login fix ships in it, PR #482.');
    expect(document.querySelector('[data-testid=desk-memory-text]')?.textContent).toContain('Release notes live in CHANGELOG.md, newest first.');
    expect(document.querySelector('[data-testid=desk-memory-pass]')?.textContent).toMatch(/Updated 37 min\. ago\s*·\s*PR #482 fails its e2e redirect test/);
    // A new snapshot flags a failed background memory update on its card.
    view.snapshot = { ...view.snapshot!, status: view.snapshot!.status.map(s => s.agentId === nova.id
      ? { ...s, memory: { ...s.memory!, status: 'error', summary: 'The rewritten memory ran past 8000 characters; it was kept as it is.' } } : s) };
    flushSync();
    expect(document.querySelector('[data-testid=desk-memory] [aria-label="Memory update failed"]')).not.toBeNull();
    expect(document.querySelector('[data-testid=desk-memory-pass]')?.textContent).toContain('8000 characters');
  } finally {
    if (desk) await unmount(desk);
    document.body.innerHTML = '';
    setExperiment('resident-agents', false);
  }
});

test('Nova\'s threads: what it handles, needs-you first, then what it is done with; a question answered in place, a thread dropped', async ({ ready }) => {
  setExperiment('resident-agents', true);
  let list: ReturnType<typeof mount> | null = null;
  try {
    const { store } = await ready({ delayMs: 0, agentsDemo: true });
    const view = AgentsView.of(store);
    await view.refresh();
    const nova = view.snapshot!.profiles.find(p => p.name === 'Nova')!;
    view.showDesk(nova.id);
    await view.refresh();
    list = mount(BotWorkList, { target: document.body, props: { view, agentId: nova.id } });
    await vi.waitFor(() => expect(document.querySelectorAll('[data-testid=desk-card]').length).toBeGreaterThan(5));
    flushSync();

    // Handling: what needs the user first, the silent turn, the work, the open pull request, the other machine's quiet thread; Done: the merged one.
    expect(titles('handling')[0]).toBe('Pick the release icon set');
    expect(titles('handling')).toEqual(expect.arrayContaining(['Migrate the settings store', 'Fix login redirect loop', 'Fix the save migration']));
    expect(titles('done')).toEqual(['Release notes 2.0.4']);
    expect(card('Release notes 2.0.4')?.classList.contains('done')).toBe(true);
    // A second line only when it says something: needs you, a silent turn, a pull request, a machine out of reach.
    expect(chips()).toEqual(['Needs you', 'silent for 24 min']);
    expect(card('Fix login redirect loop')?.querySelector('[data-testid=desk-card-pr]')?.textContent).toMatch(/PR #482\s*checks failing/);
    expect(card('Fix login redirect loop')?.querySelector('[data-testid=desk-card-pr]')?.getAttribute('data-checks')).toBe('failing');
    expect(card('Release notes 2.0.4')?.querySelector('[data-testid=desk-card-pr]')?.textContent).toContain('PR #479 merged');
    // A thread of another machine names it, says it cannot be reached, and opens nowhere this client does not reach.
    const away = card('Fix the save migration')!;
    expect(away.querySelector('[data-testid=desk-card-machine]')?.textContent).toBe('skoll');
    expect(away.querySelector('[data-testid=desk-card-unreachable]')?.getAttribute('title')).toContain('its events reach you once it is back');
    expect(away.querySelector('.desk-card-open')).toBeNull();

    // The question is answered from the row, and leaves it.
    const icons = card('Pick the release icon set')!;
    expect(icons.querySelector('[data-testid=desk-question]')?.textContent).toContain('Which one should the app ship with?');
    const asked = store.pendingQuestions.find(q => q.text.includes('icon sets'))!;
    [...icons.querySelectorAll<HTMLButtonElement>('[data-testid=desk-answer]')].find(b => b.textContent === 'Phosphor')!.click();
    await vi.waitFor(() => expect(store.pendingQuestions.some(q => q.id === asked.id)).toBe(false));
    await vi.waitFor(() => expect(document.querySelector('[data-testid=desk-question]')).toBeNull());

    // The cross takes a thread off the desk.
    card('Release notes 2.0.4')!.querySelector<HTMLButtonElement>('[data-testid=desk-card-drop]')!.click();
    await vi.waitFor(() => expect(card('Release notes 2.0.4')).toBeUndefined());
    expect(view.snapshot!.watches.some(w => w.title === 'Release notes 2.0.4')).toBe(false);
    expect(document.querySelector('[data-testid=bot-done]')).toBeNull();
  } finally {
    if (list) await unmount(list);
    document.body.innerHTML = '';
    setExperiment('resident-agents', false);
  }
});
