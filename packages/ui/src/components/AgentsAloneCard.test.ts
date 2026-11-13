import { afterEach, expect } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { CLOSED_AGENT_DEFAULTS } from '@boite/contracts';
import { test } from '../test/fake-client';
import AgentsAloneCard from './AgentsAloneCard.svelte';
import BotRequestCard from './BotRequestCard.svelte';
import type { BotAsk } from '@boite/contracts';
import { Store } from '../lib/store.svelte';
import { strings } from '../lib/strings';

let mounted: Record<string, unknown> | null = null;

afterEach(() => {
  if (mounted) unmount(mounted, { outro: false });
  mounted = null;
  document.body.innerHTML = '';
});

const at = <T extends Element>(id: string) => document.querySelector<T>(`[data-testid=${id}]`)!;

test('the reach is three steps with the selected one explained, bot creation a switch, and each writes its setting', async ({ createClient }) => {
  const client = await createClient({ delayMs: 0 });
  await client.call('settings.set', CLOSED_AGENT_DEFAULTS);
  const store = new Store();
  store.attach(client);
  await store.connect();
  mounted = mount(AgentsAloneCard, { target: document.body, props: { store } });
  flushSync();
  const words = strings.agentsAlone;

  expect(document.querySelector('h2')!.textContent).toContain(words.heading);
  expect(at('coordination-reach-project').getAttribute('aria-pressed')).toBe('true');
  expect(at('coordination-reach-effect').textContent).toBe(words.effects.project);
  expect(at<HTMLInputElement>('setting-agent-bot-creation').checked).toBe(false);
  expect(document.body.textContent).toContain(words.botsEffect);

  at<HTMLButtonElement>('coordination-reach-group').click();
  await expect.poll(async () => (await client.call('settings.get', {})).coordinationReach).toBe('group');
  flushSync();
  expect(at('coordination-reach-group').getAttribute('aria-pressed')).toBe('true');
  expect(at('coordination-reach-effect').textContent).toBe(words.effects.group);

  at<HTMLInputElement>('setting-agent-bot-creation').click();
  await expect.poll(async () => (await client.call('settings.get', {})).agentBotCreation).toBe('free');
});

test('the bot card names the bot, its role, projects and model, says it has full access, and Approve creates it', async ({ createClient }) => {
  const client = await createClient({ delayMs: 0 });
  await client.call('settings.set', CLOSED_AGENT_DEFAULTS);
  const store = new Store();
  store.attach(client);
  await store.connect();
  const { id: threadId } = await client.call('threads.create', { projectId: 'p-boite', providerId: 'echo', accountId: 'a-echo' });
  await client.call('turns.start', { threadId, prompt: 'make me a bot' });
  const asked = await client.call('agents.create', { threadId, name: 'Scribe', domain: 'Keeps the notes', projects: ['notes'] }) as { questionId: string; setting: BotAsk };
  mounted = mount(BotRequestCard, { target: document.body, props: { store, threadId, questionId: asked.questionId, setting: asked.setting, answer: null, pending: true, respond: async () => true } });
  flushSync();

  expect(at('bot-request-name').textContent).toBe('Scribe');
  expect(at('bot-request-role').textContent).toBe('Keeps the notes');
  expect(at('bot-request-projects').textContent).toBe(asked.setting.projects.join(', '));
  expect(at('bot-request-model').textContent).toBe(asked.setting.model);
  expect(at('bot-request-access').textContent).toBe(strings.botRequest.fullAccess);
  expect(at('bot-request-decline').textContent).toContain(strings.botRequest.decline);

  at<HTMLButtonElement>('bot-request-approve').click();
  await expect.poll(async () => (await client.call('agents.snapshot', {})).profiles.map((profile) => profile.name)).toContain('Scribe');
  expect(await client.call('questions.list', { threadId })).toEqual([]);
});
