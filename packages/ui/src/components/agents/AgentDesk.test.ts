import { expect, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { test } from '../../test/fake-client';
import { AgentsView, openAgent } from '../../lib/agents.svelte';
import { setExperiment } from '../../lib/experiments';
import AgentDesk from './AgentDesk.svelte';
import BotWorkList from './BotWorkList.svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const deskCss = readFileSync(resolve('src/components/agents/agents.css'), 'utf8');

const chips = () => [...document.querySelectorAll('[data-testid=desk-chip]')].map(chip => chip.textContent?.trim());
const titles = (section: 'handling' | 'done') => {
  const heading = document.querySelector(`[data-testid=bot-${section}]`);
  const rows: string[] = [];
  for (let node = heading?.nextElementSibling; node && node.matches('[data-testid=desk-card]'); node = node.nextElementSibling) rows.push(node.querySelector('.desk-card-title')!.textContent!);
  return rows;
};
const card = (title: string) => [...document.querySelectorAll<HTMLElement>('[data-testid=desk-card]')].find(node => node.querySelector('.desk-card-title')?.textContent === title);

test('Nova\'s desk is one column: who it is, its routines and its notes, its live step only away from its conversation, and no spend', async ({ ready }) => {
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
    await vi.waitFor(() => expect(document.querySelector('[data-testid=desk-ident]')).not.toBeNull());
    flushSync();

    // What it is for, its model, its machine and since when; its face and name are the column's, not repeated here; no tabs and no day's spend.
    const ident = document.querySelector('[data-testid=desk-ident]')!;
    expect(ident.textContent).not.toContain('Nova');
    expect(ident.querySelector('.agent-avatar')).toBeNull();
    expect(ident.textContent).toContain(nova.domain);
    expect(document.querySelector('[data-testid=desk-model]')?.textContent?.trim()).not.toBe('');
    expect(document.querySelector('[data-testid=desk-since]')?.textContent).toMatch(/^Since /);
    expect(document.querySelector('[role=tablist]')).toBeNull();
    expect(document.querySelector('[data-testid=desk-today]')).toBeNull();
    expect(document.body.textContent).not.toContain('$');
    // On the Bots page of a desktop, the threads are in the column and the live step in the conversation, not here.
    expect(document.querySelector('[data-testid=desk-work]')).toBeNull();
    expect(document.querySelector('[data-testid=desk-now]')).toBeNull();

    // Away from that page the desk carries Now: the step its turn is on, live, and the calls so far on the rail.
    store.page = 'chat';
    await vi.waitFor(() => expect(document.querySelector('[data-testid=desk-now-step]')).not.toBeNull());
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

    // Memory: the count of its notes and the first three, in plain words; no pass line under them.
    await vi.waitFor(() => expect(document.querySelector('[data-testid=desk-memory]')?.textContent).toContain('3 notes'));
    expect([...document.querySelectorAll('[data-testid=desk-memory-text] li')].map(li => li.textContent)[0]).toBe('The login fix ships in it, PR #482.');
    expect(document.querySelector('[data-testid=desk-memory-text]')?.textContent).toContain('Release notes live in CHANGELOG.md, newest first.');
    expect(document.querySelectorAll('[data-testid=desk-memory-text] li').length).toBeLessThanOrEqual(3);
    expect(document.querySelector('[data-testid=desk-memory]')?.textContent).not.toContain('Updated');
    // A new snapshot flags a failed background memory update on its card.
    view.snapshot = { ...view.snapshot!, status: view.snapshot!.status.map(s => s.agentId === nova.id
      ? { ...s, memory: { ...s.memory!, status: 'error', summary: 'The rewritten memory ran past 8000 characters; it was kept as it is.' } } : s) };
    flushSync();
    expect(document.querySelector('[data-testid=desk-memory] [aria-label="Memory update failed"]')).not.toBeNull();
    expect(document.querySelector('[data-testid=desk-memory-alert]')?.getAttribute('title')).toContain('8000 characters');
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
    // The state in the lists' one slot after the title: an amber dot named in its tooltip, no word beside it.
    const asks = card('Pick the release icon set')!.querySelector('[data-testid=desk-row-mark]')!;
    expect([asks.getAttribute('aria-label'), asks.getAttribute('title'), asks.getAttribute('data-tone')]).toEqual(['Needs you', 'Needs you', 'live']);
    // A second line only when it says something: a silent turn, a pull request, a machine out of reach.
    expect(chips()).toEqual([expect.stringMatching(/^silent for 24m \d{2}s$/)]);
    expect(card('Fix login redirect loop')?.querySelector('[data-testid=desk-card-pr]')?.textContent).toMatch(/PR #482\s*checks failing/);
    expect(card('Fix login redirect loop')?.querySelector('[data-testid=desk-card-pr]')?.getAttribute('data-checks')).toBe('failing');
    expect(card('Release notes 2.0.4')?.querySelector('[data-testid=desk-card-pr]')?.textContent).toContain('PR #479 merged');
    // A thread of another machine names it, says it cannot be reached, and opens nowhere this client does not reach.
    const away = card('Fix the save migration')!;
    expect(away.querySelector('[data-testid=desk-card-machine]')?.textContent).toBe('skoll');
    expect(away.querySelector('[data-testid=desk-card-unreachable]')?.getAttribute('title')).toContain('its events reach you once it is back');
    // Out of reach is a machine state in words after its name, the card dimmed, never the failure red.
    expect(away.querySelector('[data-testid=desk-card-unreachable]')?.textContent).toBe('skoll offline');
    expect(away.classList.contains('away')).toBe(true);
    expect(deskCss).toMatch(/\.desk-card-unreachable \{[^}]*color: var\(--color-muted-foreground\)/);
    expect(deskCss).toMatch(/\.desk-row\.away \.desk-row-tile, \.desk-row\.away \.desk-row-text \{ opacity: 0\.6; \}/);
    expect(deskCss).not.toMatch(/\.desk-card-unreachable[^{]*\{[^}]*--color-danger/);
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
