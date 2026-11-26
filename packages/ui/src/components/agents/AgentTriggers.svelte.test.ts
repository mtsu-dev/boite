import { groupRelayUrl, type Group } from '@boite/contracts';
import { flushSync, mount, unmount } from 'svelte';
import { expect, vi } from 'vitest';
import { triggerWebhookUrl } from '../../lib/agent-trigger';
import { AgentsView } from '../../lib/agents.svelte';
import { test } from '../../test/fake-client';
import AgentSheet from './AgentSheet.svelte';
import AgentTriggers from './AgentTriggers.svelte';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`)!;

test('a file trigger edit keeps brace globs, survives a trigger run, and refuses to overwrite a concurrent edit', async ({ ready }) => {
  const { store, client } = await ready({ delayMs: 0, agentsDemo: true });
  const view = new AgentsView(store);
  await view.refresh();
  const agent = view.snapshot!.profiles.find(profile => profile.name === 'Nova')!;
  const source = { kind: 'file' as const, projectId: agent.projectIds![0]!, patterns: ['src'], debounceMs: 100 };
  const { trigger } = await client.call('agents.trigger.save', { value: {
    agentId: agent.id, source, name: 'Code changes', prompt: 'Review changes.', enabled: true, cooldownSeconds: 60,
  } });
  await view.refresh();
  const component = mount(AgentTriggers, { target: document.body, props: { view, agentId: agent.id } });
  const click = (id: string) => flushSync(() => element(id).click());
  const patterns = (value: string) => {
    const input = element<HTMLInputElement>('trigger-patterns');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const snapshotTrigger = async () => (await client.call('agents.snapshot', {})).triggers!.find(row => row.id === trigger.id)!;
  try {
    expect(element('trigger-edit').getAttribute('aria-label')).toBe('Edit Code changes');
    click('trigger-edit');
    patterns('src/**/*.{ts,tsx}, package.json, src/items[,].txt');
    await client.call('agents.trigger.test', { triggerId: trigger.id, requestId: 'test-while-editing' });
    const afterTest = await snapshotTrigger();
    expect(afterTest.lastOutcome).toBe('queued');
    expect(afterTest.lastOutcomeAt).not.toBeNull();
    expect(afterTest.lastFiredAt).toBeNull();
    await view.refresh();
    click('trigger-save');
    await vi.waitFor(async () => expect((await snapshotTrigger()).source).toMatchObject({
      patterns: ['src/**/*.{ts,tsx}', 'package.json', 'src/items[,].txt'],
    }));
    expect((await snapshotTrigger())).toMatchObject({ lastOutcome: 'skipped', lastFiredAt: null });
    await vi.waitFor(() => expect(element('trigger-form')).toBeNull());

    click('trigger-edit');
    patterns('local.ts');
    const stored = await snapshotTrigger();
    await client.call('agents.trigger.save', { id: stored.id, expectedRevision: stored.revision, value: { ...stored, name: 'Edited elsewhere' } });
    await view.refresh();
    click('trigger-save');
    await vi.waitFor(() => expect(view.error).toBe('This trigger changed elsewhere. Reopen it to see the latest settings.'));
    expect((await snapshotTrigger()).name).toBe('Edited elsewhere');
    expect(element<HTMLInputElement>('trigger-patterns').value).toBe('local.ts');

    const latest = await snapshotTrigger();
    await client.call('agents.trigger.save', { id: latest.id, expectedRevision: latest.revision, value: { ...latest, enabled: false } });
    await client.call('projects.archive', { projectId: source.projectId });
    await expect(client.call('agents.trigger.save', { value: { ...latest, source } })).rejects.toThrow('granted');
    await view.refresh();
    flushSync(() => document.querySelector<HTMLButtonElement>('[data-testid="trigger-form"] button[type="button"].ghost')?.click());
    click('trigger-edit');
    expect(element<HTMLButtonElement>('trigger-save').disabled).toBe(false);
    patterns('kept.ts');
    click('trigger-save');
    await vi.waitFor(async () => expect((await snapshotTrigger()).source).toMatchObject({ patterns: ['kept.ts'] }));
  } finally { await unmount(component); view.close(); }
});

test('a relayed mochi copies its own webhook address or shows only the path when its address is unavailable', () => {
  const member = 'a'.repeat(64);
  const endpoint = groupRelayUrl('https://relay.example', member);
  const path = '/hooks/mochi/trigger';
  const group: Group = {
    id: 'group', name: 'Machines', self: member, devices: [],
    cores: [{ coreId: member, name: 'Worker', epoch: 1, addresses: ['https://worker.example', 'http://10.0.0.2:8777'] }],
  };
  expect(triggerWebhookUrl(path, endpoint, null, group, 'https://page.example')).toBe('https://worker.example' + path);
  expect(triggerWebhookUrl(path, endpoint, 'https://hooks.example', group, 'https://page.example')).toBe('https://hooks.example' + path);
  expect(triggerWebhookUrl(path, endpoint, null, null, 'https://page.example')).toBeNull();
  expect(triggerWebhookUrl(path, 'ws://127.0.0.1:8777', null, null, 'https://page.example')).toBe('http://127.0.0.1:8777' + path);
});

test('a file trigger over the watch limit shows the actionable folder-cap warning', async ({ ready }) => {
  const { store, client } = await ready({ delayMs: 0, agentsDemo: true });
  const view = new AgentsView(store);
  await view.refresh();
  const agent = view.snapshot!.profiles.find(profile => profile.name === 'Nova')!;
  const source = { kind: 'file' as const, projectId: agent.projectIds![0]!, patterns: [], debounceMs: 100 };
  const { trigger } = await client.call('agents.trigger.save', { value: {
    agentId: agent.id, source, name: 'Huge tree', prompt: 'Watch files.', enabled: true, cooldownSeconds: 60,
  } });
  await view.refresh();
  const row = view.snapshot!.triggers!.find(item => item.id === trigger.id)!;
  row.watchUnavailable = true;
  row.watchUnavailableReason = 'limit';
  const component = mount(AgentTriggers, { target: document.body, props: { view, agentId: agent.id } });
  try {
    expect(document.body.textContent).toContain('Too many folders to watch (over 512)');
  } finally { await unmount(component); view.close(); }
});

test('a compact webhook card shows the local-only warning, renders non-firing outcomes via lastOutcomeAt, and refuses padded names over 80 characters', async ({ ready }) => {
  const { store, client } = await ready({ delayMs: 0, agentsDemo: true });
  const view = new AgentsView(store);
  await view.refresh();
  const agent = view.snapshot!.profiles.find(profile => profile.name === 'Nova')!;
  await expect(client.call('agents.trigger.save', { value: {
    agentId: agent.id, source: { kind: 'webhook' }, name: ` ${'a'.repeat(80)} `, prompt: 'Check hook.', enabled: true, cooldownSeconds: 60,
  } })).rejects.toThrow('trigger:');
  const { trigger } = await client.call('agents.trigger.save', { value: {
    agentId: agent.id, source: { kind: 'webhook' }, name: 'Local hook', prompt: 'Check hook.', enabled: true, cooldownSeconds: 60,
  } });
  await view.refresh();
  const row = view.snapshot!.triggers!.find(item => item.id === trigger.id)!;
  row.lastFiredAt = null;
  row.lastOutcome = 'queued';
  row.lastOutcomeAt = Date.now();
  const component = mount(AgentTriggers, { target: document.body, props: { view, agentId: agent.id, compact: true } });
  try {
    expect(document.body.textContent).toContain('Queued · ');
    expect(document.body.textContent).not.toContain('Queued at');
    expect(document.body.textContent).toContain('Local address only');
    expect(element('trigger-test').classList.contains('ghost')).toBe(true);
  } finally { await unmount(component); view.close(); }
});

test('AgentSheet pins view.error, dismisses it, preserves errors across snapshots while closed, and clears on close or agent switch', async ({ ready }) => {
  const { store } = await ready({ delayMs: 0, agentsDemo: true });
  const view = new AgentsView(store);
  await view.refresh();
  const nova = view.snapshot!.profiles.find(profile => profile.name === 'Nova')!;
  const mira = view.snapshot!.profiles.find(profile => profile.name === 'Mira')!;
  const props = $state<{ view: AgentsView; agent: typeof nova; pane: 'settings' | null; onclose: () => void }>({
    view, agent: nova, pane: null, onclose: () => {},
  });
  const component = mount(AgentSheet, { target: document.body, props });
  try {
    flushSync();
    view.error = 'Desk action failed.';
    // A fresh snapshot copy of the same agent while the sheet is closed must not wipe Desk/Page errors.
    props.agent = { ...nova };
    flushSync();
    expect(view.error).toBe('Desk action failed.');

    props.pane = 'settings';
    flushSync();
    view.error = 'This trigger changed elsewhere. Reopen it to see the latest settings.';
    flushSync();
    const sheet = element('agent-sheet');
    expect(sheet.textContent).toContain('This trigger changed elsewhere. Reopen it to see the latest settings.');
    expect(sheet.querySelector('.agent-sheet-error')).not.toBeNull();
    flushSync(() => sheet.querySelector<HTMLButtonElement>('.agent-sheet-error button')?.click());
    expect(view.error).toBe('');

    view.error = 'Stale error';
    flushSync();
    props.agent = mira;
    flushSync();
    expect(view.error).toBe('');

    view.error = 'Close clears me';
    flushSync();
    props.pane = null;
    flushSync();
    expect(view.error).toBe('');
  } finally { await unmount(component); view.close(); }
});

test('an enabled file trigger warns when its project is archived or ungranted, and switching agent closes an open form', async ({ ready }) => {
  const { store, client } = await ready({ delayMs: 0, agentsDemo: true });
  const view = new AgentsView(store);
  await view.refresh();
  const nova = view.snapshot!.profiles.find(profile => profile.name === 'Nova')!;
  const mira = view.snapshot!.profiles.find(profile => profile.name === 'Mira')!;
  const projectId = nova.projectIds![0]!;
  const { trigger } = await client.call('agents.trigger.save', { value: {
    agentId: nova.id, source: { kind: 'file', projectId, patterns: [], debounceMs: 100 },
    name: 'Watch project', prompt: 'Inspect edits.', enabled: true, cooldownSeconds: 60,
  } });
  await client.call('projects.archive', { projectId });
  await view.refresh();
  const props = $state({ view, agentId: nova.id });
  const component = mount(AgentTriggers, { target: document.body, props });
  try {
    expect(element(`trigger-${trigger.id}`).textContent).toContain('Project is archived, removed or no longer granted to this mochi.');
    flushSync(() => element('trigger-edit').click());
    expect(element('trigger-form')).not.toBeNull();
    props.agentId = mira.id;
    flushSync();
    expect(element('trigger-form')).toBeNull();
  } finally { await unmount(component); view.close(); }
});
