import { expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import { store } from '../lib/store.svelte';
import { effortDots, effortPicked, groupLabels, press, query, seats, shownModels, test, tiles, type, waitFor } from '../test/app';

vi.mock('@tauri-apps/plugin-opener', () => import('../test/opener'));

/** The picker opens on the models in use once there are two of them; every provider sits behind its source button. */
async function allModels(): Promise<void> {
  await waitFor(() => document.querySelector('[data-testid=composer-picker-menu]') !== null);
  const refresh = () => document.querySelector('[data-testid=composer-picker-menu] [data-testid=picker-refresh]');
  if (!refresh()) {
    // The source button unfolds the providers in place; the chip's own provider shows its catalogue.
    document.querySelector<HTMLButtonElement>('[data-testid=picker-all-models]')!.click();
    const providerId = store.openThread?.providerId ?? store.draftChoice?.providerId ?? store.defaultChoice()?.providerId;
    await waitFor(() => document.querySelector(`[data-testid=composer-picker-menu] .tile[data-provider="${providerId}"][data-row]`) !== null);
    document.querySelector<HTMLButtonElement>(`[data-testid=composer-picker-menu] .tile[data-provider="${providerId}"]`)!.click();
  }
  await waitFor(() => refresh() !== null);
}

/** The rows a query found in one provider's list, under its own line. */
function foundIn(providerId: string): (string | null)[] {
  return [...document.querySelectorAll(`[data-testid=picker-found] [data-source="${providerId}"] [data-model]`)].map((el) => el.getAttribute('data-model'));
}

/** The reasoning row lives in the model chip's popover: open it, then find the row. */
function effortRow(): HTMLElement | null {
  if (!document.querySelector('[data-testid=composer-picker-menu]')) {
    document.querySelector<HTMLElement>('[data-testid=composer-picker]')?.click();
    flushSync();
  }
  return document.querySelector<HTMLElement>('[data-testid=composer-effort]');
}

test('the picker rails the providers as logos and gives the shown one its accounts and models', async ({ app: _app }) => {
  await store.client!.call('accounts.login', { accountId: 'a-claude-side' });
  await store.client!.call('accounts.loginInput', { accountId: 'a-claude-side', text: 'test-code' });
  await waitFor(() => store.accountOf('a-claude-side')?.status === 'ok');
  query<HTMLButtonElement>('[data-testid=new-thread]').click();
  await waitFor(() => store.draft !== null);

  // A draft opens on the first available provider, its default model.
  await waitFor(() => query('[data-testid=composer-picker]').textContent?.includes('Opus 5.5') === true);

  query<HTMLButtonElement>('[data-testid=composer-picker]').click();
  await waitFor(() => document.querySelector('[data-testid=composer-picker-menu]') !== null);
  await allModels();
  await waitFor(() => shownModels().length === 3);
  // One tile per provider an account answers for, in the core's order: the
  // one still to download or sign into is Settings' business, one tile away.
  expect(tiles()).toEqual(['home', 'claude', 'echo', 'opencode', 'codex', 'pi', 'grok', 'muse', 'more']);
  // Claude is the shown one and has two logins, so they sit beside its name.
  expect(seats()).toEqual(['claude::a-claude-main', 'claude::a-claude-side']);
  // On the provider's own login the chip names the model alone.
  expect(document.querySelector('[data-testid=composer-picker-account]')).toBeNull();
  expect(shownModels()).toEqual(['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5']);

  // One account: nothing beside the name.
  query<HTMLButtonElement>('[data-testid=composer-picker-menu] [data-provider=echo]').click();
  await waitFor(() => shownModels().length === 1);
  expect(seats()).toEqual([]);

  query<HTMLButtonElement>('[data-testid=composer-picker-menu] [data-provider=claude]').click();
  await waitFor(() => shownModels().length === 3);
  query<HTMLButtonElement>('[data-testid=picker-legacy]').click();
  await waitFor(() => document.querySelectorAll('[data-model]').length === 7);

  // The second account of the same provider, then a model: one thread with both.
  query<HTMLButtonElement>('[data-instance="claude::a-claude-side"]').click();
  await waitFor(() => document.querySelector('[data-instance="claude::a-claude-side"]')?.getAttribute('aria-pressed') === 'true' &&
    store.probedModels['claude::a-claude-side'] !== undefined && document.querySelector('[data-model="claude-opus-5-5"]') !== null);
  query<HTMLButtonElement>('[data-model="claude-opus-5-5"]').click();
  await waitFor(() => document.querySelector('[data-testid=composer-picker-menu]') === null);
  // The pill names the model, and the login it runs on since its agent has two.
  expect(query('[data-testid=composer-picker] .label').textContent?.trim()).toBe('Opus 5.5');
  expect(query('[data-testid=composer-picker-account]').textContent?.trim()).toBe(store.accountOf('a-claude-side')!.label);
  query<HTMLButtonElement>('[data-testid=composer-picker]').click();
  await allModels();
  await waitFor(() => document.querySelector('[data-instance="claude::a-claude-side"]')?.getAttribute('aria-pressed') === 'true');
  query<HTMLButtonElement>('[data-testid=composer-picker]').click();
  await waitFor(() => document.querySelector('[data-testid=composer-picker-menu]') === null);

  const input = query<HTMLTextAreaElement>('[data-testid=composer-input]');
  input.value = 'On the second seat';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => !query<HTMLButtonElement>('[data-testid=composer-send]').disabled);
  query<HTMLButtonElement>('[data-testid=composer-send]').click();
  await waitFor(() => store.openThread !== null && store.draft === null);
  expect(store.openThread?.accountId).toBe('a-claude-side');
  expect(store.openThread?.model).toBe('claude-opus-5-5');
});

test('the picker reads an ACP agent models, showing the descriptor and a probing line meanwhile', async ({ app: _app }) => {
  query<HTMLButtonElement>('[data-testid=new-thread]').click();
  await waitFor(() => store.draft !== null);
  await waitFor(() => query('[data-testid=composer-picker]').textContent?.includes('Opus 5.5') === true);

  query<HTMLButtonElement>('[data-testid=composer-picker]').click();
  await waitFor(() => document.querySelector('[data-testid=composer-picker-menu]') !== null);
  await allModels();
  query<HTMLButtonElement>('[data-testid=composer-picker-menu] [data-provider=opencode]').click();

  // While the agent is being asked, its descriptor's one model stands.
  await waitFor(() => document.querySelector('[data-testid=picker-probing]') !== null);
  expect(shownModels()).toEqual([]);

  await waitFor(() => document.querySelector('[data-testid=picker-probing]') === null);
  // The agent lists more than the column shows at once; the first three are the ones it names first.
  expect(shownModels().length).toBe(22);
  expect(shownModels()).not.toContain('default');
  expect(shownModels()).toContain('openai/gpt-5-codex');

  query<HTMLButtonElement>('[data-model="openai/gpt-5-codex"]').click();
  await waitFor(() => document.querySelector('[data-testid=composer-picker-menu]') === null);
  expect(query('[data-testid=composer-picker]').textContent).toContain('GPT-5 Codex');

  // The reasoning scale comes from the same answer, not from the descriptor, and
  // it is a row of the model chip that carries it.
  await waitFor(() => effortRow() !== null);
  await waitFor(() => document.querySelector('[data-testid=composer-effort-menu]') !== null);
  expect(effortDots()).toEqual(['think', 'think-hard']);
  press('Escape');
  await waitFor(() => document.querySelector('[data-testid=composer-effort-menu]') === null);

  // The probed model reaches the thread the first send creates.
  const input = query<HTMLTextAreaElement>('[data-testid=composer-input]');
  input.value = 'On the agent own model';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => !query<HTMLButtonElement>('[data-testid=composer-send]').disabled);
  query<HTMLButtonElement>('[data-testid=composer-send]').click();
  await waitFor(() => store.openThread !== null && store.draft === null);
  expect(store.openThread?.model).toBe('openai/gpt-5-codex');
});

test('past twelve models the column gets a search field, prefix groups and keyboard picking', async ({ app: _app }) => {
  query<HTMLButtonElement>('[data-testid=new-thread]').click();
  await waitFor(() => store.draft !== null);
  await waitFor(() => query('[data-testid=composer-picker]').textContent?.includes('Opus 5.5') === true);

  query<HTMLButtonElement>('[data-testid=composer-picker]').click();
  await waitFor(() => document.querySelector('[data-testid=composer-picker-menu]') !== null);
  await allModels();
  await waitFor(() => document.querySelector('[data-testid=picker-search]') !== null);
  // Search is available even on the shorter Claude list.
  expect(document.querySelector('[data-testid=picker-search]')).not.toBeNull();
  await type(query<HTMLInputElement>('[data-testid=picker-search]'), 'opus 4.8');
  // A query searches every provider's list, each under one line naming it, the shown one first.
  await waitFor(() => foundIn('claude').length === 1);
  expect(foundIn('claude')).toEqual(['claude-opus-4-8']);
  expect(query('[data-testid=picker-found] [data-source]').getAttribute('data-source')).toBe('claude');
  expect(query('[data-source=claude] .source-line').textContent).toBe('Claude · Default');
  expect(document.querySelector('[data-testid=picker-legacy]')).toBeNull();
  // Escape clears the query, then the source button unfolds the providers over the list, and Escape folds them back first.
  press('Escape');
  await waitFor(() => document.querySelector('[data-testid=picker-found]') === null);
  query<HTMLButtonElement>('[data-testid=picker-all-models]').click();
  await waitFor(() => query('[data-testid=picker-all-models]').getAttribute('aria-expanded') === 'true');
  expect(query('[data-provider=claude] .mark svg')).not.toBeNull();
  press('Escape');
  await waitFor(() => query('[data-testid=picker-all-models]').getAttribute('aria-expanded') === 'false');
  expect(document.querySelector('[data-testid=composer-picker-menu]')).not.toBeNull();
  query<HTMLButtonElement>('[data-testid=picker-all-models]').click();

  query<HTMLButtonElement>('[data-testid=composer-picker-menu] [data-provider=opencode]').click();
  await waitFor(() => document.querySelector('[data-testid=picker-probing]') === null);
  await waitFor(() => document.querySelector('[data-testid=picker-search]') !== null);
  await waitFor(() => shownModels().length === 22);
  expect(shownModels().length).toBe(22);
  expect(groupLabels().sort()).toEqual(['anthropic', 'nvidia', 'openai', 'opencode', 'openrouter']);
  // The column opens on a long list, so the field already has the caret.
  const search = query<HTMLInputElement>('[data-testid=picker-search]');
  expect(document.activeElement).toBe(search);

  await type(search, 'sonnet');
  await waitFor(() => foundIn('opencode').length === 3);
  // The shown list answers first, the agent's own default pinned first whatever the query.
  expect(query('[data-testid=picker-found] [data-source]').getAttribute('data-source')).toBe('opencode');
  expect(foundIn('opencode')).toEqual([
    'anthropic/claude-sonnet-5',
    'opencode/claude-sonnet-5',
    'openrouter/anthropic/claude-sonnet-4-5'
  ]);
  expect([...document.querySelectorAll<HTMLElement>('[data-source=opencode] [data-group]')].map((el) => el.dataset.group)).toEqual(['anthropic', 'opencode', 'openrouter']);
  // Another provider's matches follow under their own line.
  expect(foundIn('claude')).toContain('claude-sonnet-5-5');

  // Down onto the first named match, Enter to take it.
  press('ArrowDown');
  expect((document.activeElement as HTMLElement).getAttribute('data-model')).toBe('anthropic/claude-sonnet-5');
  press('Enter');
  await waitFor(() => document.querySelector('[data-testid=composer-picker-menu]') === null);
  expect(query('[data-testid=composer-picker]').textContent).toContain('Sonnet 5');

  // A query nothing answers says so, and Escape clears it before it closes anything.
  query<HTMLButtonElement>('[data-testid=composer-picker]').click();
  await allModels();
  await waitFor(() => document.querySelector('[data-testid=picker-search]') !== null);
  await type(query<HTMLInputElement>('[data-testid=picker-search]'), 'nothing here');
  await waitFor(() => document.querySelector('[data-testid=picker-no-models]') !== null);
  expect(shownModels()).toEqual([]);

  press('Escape');
  await waitFor(() => shownModels().length === 22);
  expect(document.querySelector('[data-testid=composer-picker-menu]')).not.toBeNull();
  expect(query<HTMLInputElement>('[data-testid=picker-search]').value).toBe('');

  press('Escape');
  await waitFor(() => document.querySelector('[data-testid=composer-picker-menu]') === null);

  // The searched model is the one the first send writes on the thread.
  const input = query<HTMLTextAreaElement>('[data-testid=composer-input]');
  input.value = 'On the model I searched for';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => !query<HTMLButtonElement>('[data-testid=composer-send]').disabled);
  query<HTMLButtonElement>('[data-testid=composer-send]').click();
  await waitFor(() => store.openThread !== null && store.draft === null);
  expect(store.openThread?.model).toBe('anthropic/claude-sonnet-5');
});

test('the reasoning row names each level, sets the effort of the picked model, and the chip follows', async ({ app: _app }) => {
  query<HTMLButtonElement>('[data-testid=new-thread]').click();
  await waitFor(() => store.draft !== null);
  await waitFor(() => query('[data-testid=composer-picker]').textContent?.includes('Opus 5.5') === true);

  await waitFor(() => effortRow() !== null);
  await waitFor(() => document.querySelector('[data-testid=composer-effort-menu]') !== null);
  expect(effortDots()).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultrathink']);
  // Every level by its name, in the model's order, one per row under the Effort row.
  expect(Array.from(document.querySelectorAll('[data-testid=composer-effort-menu] [data-value]')).map((el) => el.textContent?.trim()))
    .toEqual(['Low', 'Medium', 'High', 'Extra high', 'Max', 'Ultra']);
  // Nothing chosen yet, so the model's own default reads as the active one.
  expect(effortPicked()).toBe('high');

  query<HTMLButtonElement>('[data-testid=composer-effort-menu] [data-value=xhigh]').click();
  await waitFor(() => effortPicked() === 'xhigh');
  // Picking a level keeps the popover open: it is a setting of the model, not a choice of its own.
  expect(document.querySelector('[data-testid=composer-effort-menu]')).not.toBeNull();
  // One chip form everywhere: the model's name, then its effort.
  expect(query('[data-testid=composer-picker]').textContent).toContain('Opus 5.5');
  expect(query('[data-testid=composer-picker-effort]').textContent).toBe('· Extra high');
  // One live choice, and no other.
  expect(document.querySelectorAll('[data-testid=composer-effort-menu] [aria-checked=true]')).toHaveLength(1);

  query<HTMLButtonElement>('[data-testid=composer-effort-menu] [data-value=high]').click();
  await waitFor(() => effortPicked() === 'high');

  // The draft carries the effort into the thread the first send creates.
  query<HTMLButtonElement>('[data-testid=composer-effort-menu] [data-value=xhigh]').click();
  await waitFor(() => effortPicked() === 'xhigh');
  press('Escape');
  const input = query<HTMLTextAreaElement>('[data-testid=composer-input]');
  input.value = 'Think harder about the caps';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => !query<HTMLButtonElement>('[data-testid=composer-send]').disabled);
  query<HTMLButtonElement>('[data-testid=composer-send]').click();
  await waitFor(() => store.openThread !== null && store.draft === null);
  expect(store.openThread?.effort).toBe('xhigh');
});

test('the picker opens on the models in use, one row each, with every provider behind All models', async ({ app: _app }) => {
  vi.spyOn(store, 'favorites', 'get').mockReturnValue([
    { providerId: 'claude', accountId: 'a-claude-main', model: { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5' }, items: [] }
  ]);
  query<HTMLButtonElement>('[data-testid=new-thread]').click();
  await waitFor(() => store.draft !== null);
  await waitFor(() => query('[data-testid=composer-picker]').textContent?.includes('Opus 5.5') === true);

  query<HTMLButtonElement>('[data-testid=composer-picker]').click();
  const short = () => [...document.querySelectorAll<HTMLElement>('[data-testid=picker-shortlist] .row.model')].map((row) => [row.dataset.testid, row.title]);
  await waitFor(() => short().length === 3);
  // The current choice first, then the star, then the latest threads' model; no provider rail on this level, the effort row under it.
  expect(short()).toEqual([['recent-model', 'claude-opus-5-5'], ['favorite-model', 'claude-sonnet-5-5'], ['recent-model', 'echo-1']]);
  // A name alone tells these rows apart: no provider under it, and the provider's own login is not printed, even beside another seat of it.
  expect(store.accountsOf('claude').length).toBeGreaterThan(1);
  expect(store.accountOf('a-claude-main')!.isolationDir).toBeNull();
  expect(document.querySelector('[data-testid=picker-shortlist] .row.current .source')).toBeNull();
  // The current row carries the check.
  expect(query('[data-testid=picker-shortlist] .row.current .mark svg')).not.toBeNull();
  expect(document.querySelector('[data-testid=composer-picker-menu] .rail')).toBeNull();
  expect(document.querySelector('[data-testid=composer-effort-menu]')).not.toBeNull();
  // The keys start in the search field, and the arrows go down into the rows under it.
  expect(document.activeElement).toBe(query('[data-testid=picker-search]'));
  press('ArrowDown');
  expect(document.activeElement).toBe(query('[data-testid=picker-shortlist] .row.current'));

  // The source button names the list and unfolds the providers in place, the models in use first and checked.
  expect(query('[data-testid=picker-all-models]').textContent?.trim()).toBe('Your models');
  query<HTMLButtonElement>('[data-testid=picker-all-models]').click();
  await waitFor(() => !query('[data-testid=picker-back]').closest('.sources')!.hasAttribute('hidden'));
  expect(tiles()[0]).toBe('home');
  expect(query('[data-testid=picker-back] .mark svg')).not.toBeNull();
  expect(document.querySelector('[data-testid=composer-picker-menu] .back-row')).toBeNull();
  query<HTMLButtonElement>('[data-testid=picker-back]').click();
  await waitFor(() => short().length === 3);
  expect(query('[data-testid=picker-back]').closest('.sources')!.hasAttribute('hidden')).toBe(true);

  // One click on a row picks it and closes.
  query<HTMLButtonElement>('[data-testid=favorite-model]').click();
  await waitFor(() => document.querySelector('[data-testid=composer-picker-menu]') === null);
  expect(query('[data-testid=composer-picker]').textContent).toContain('Sonnet 5.5');
});
