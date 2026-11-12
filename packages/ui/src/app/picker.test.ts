import { expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import { store } from '../lib/store.svelte';
import { strings } from '../lib/strings';
import { effortDots, effortPicked, groupLabels, press, query, seats, shownModels, test, tiles, type, waitFor } from '../test/app';

vi.mock('@tauri-apps/plugin-opener', () => import('../test/opener'));

/** The popover is a chunk of its own: wait for it, then for the shown provider's rail tile. */
async function menuLoaded(): Promise<void> {
  await waitFor(() => document.querySelector('[data-testid=composer-picker-menu] .rail .tile[data-provider]') !== null);
}

/** The effort chip beside the model chip: open its slider, then hand the chip back. */
function effortRow(): HTMLElement | null {
  const chip = document.querySelector<HTMLElement>('[data-testid=composer-effort]');
  if (chip && !document.querySelector('[data-testid=composer-effort-menu]')) {
    chip.click();
    flushSync();
  }
  return chip;
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
  await menuLoaded();
  await waitFor(() => shownModels().length === 3);
  // One tile per provider an account answers for, in the core's order: the
  // one still to download or sign into is Settings' business, one tile away.
  expect(tiles()).toEqual(['favorites', 'claude', 'echo', 'opencode', 'codex', 'pi', 'grok', 'muse', 'more']);
  // Claude is the shown one and has two logins: its name is the button that lists them.
  expect(query('[data-testid=picker-account]').getAttribute('aria-expanded')).toBe('false');
  expect(seats()).toEqual([]);
  // On the provider's own login the name line names no account.
  expect(document.querySelector('[data-testid=picker-account-name]')).toBeNull();
  // On the provider's own login the chip names the model alone.
  expect(document.querySelector('[data-testid=composer-picker-account]')).toBeNull();
  expect(shownModels()).toEqual(['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5']);
  // The shown provider's name heads its column; its logo tile is the current one.
  expect(query('[data-testid=composer-picker-menu] .provider-name').textContent).toBe('Claude');
  expect(query('[data-testid=composer-picker-menu] .tile.current').dataset.provider).toBe('claude');

  // One account: the plain name, nothing to click.
  query<HTMLButtonElement>('[data-testid=composer-picker-menu] [data-provider=echo]').click();
  await waitFor(() => shownModels().length === 1);
  expect(document.querySelector('[data-testid=picker-account]')).toBeNull();
  expect(query('[data-testid=composer-picker-menu] .provider-name').textContent).toBe('Echo');

  query<HTMLButtonElement>('[data-testid=composer-picker-menu] [data-provider=claude]').click();
  await waitFor(() => shownModels().length === 3);
  expect(query('[data-testid=picker-legacy]').textContent?.trim()).toBe(strings.composer.legacyModels);
  query<HTMLButtonElement>('[data-testid=picker-legacy]').click();
  await waitFor(() => document.querySelectorAll('[data-model]').length === 7);

  // The second account of the same provider, then a model: one thread with both.
  query<HTMLButtonElement>('[data-testid=picker-account]').click();
  await waitFor(() => seats().length === 2);
  expect(seats()).toEqual(['claude::a-claude-main', 'claude::a-claude-side']);
  // Escape closes the account list alone; the model menu stays.
  press('Escape');
  await waitFor(() => seats().length === 0);
  expect(document.querySelector('[data-testid=composer-picker-menu]')).not.toBeNull();
  expect(document.activeElement).toBe(query('[data-testid=picker-account]'));
  query<HTMLButtonElement>('[data-testid=picker-account]').click();
  await waitFor(() => seats().length === 2);
  expect(query('[data-instance="claude::a-claude-main"]').getAttribute('aria-checked')).toBe('true');
  query<HTMLButtonElement>('[data-instance="claude::a-claude-side"]').click();
  // The list closes on the pick and the name line says which login the column runs on.
  await waitFor(() => seats().length === 0 && document.querySelector('[data-testid=picker-account-name]')?.textContent === 'Second seat' &&
    store.probedModels['claude::a-claude-side'] !== undefined && document.querySelector('[data-model="claude-opus-5-5"]') !== null);
  query<HTMLButtonElement>('[data-model="claude-opus-5-5"]').click();
  await waitFor(() => document.querySelector('[data-testid=composer-picker-menu]') === null);
  // The pill names the model, and the login it runs on since its agent has two.
  expect(query('[data-testid=composer-picker] .label').textContent?.trim()).toBe('Opus 5.5');
  expect(query('[data-testid=composer-picker-account]').textContent?.trim()).toBe(store.accountOf('a-claude-side')!.label);
  query<HTMLButtonElement>('[data-testid=composer-picker]').click();
  await menuLoaded();
  await waitFor(() => document.querySelector('[data-testid=picker-account-name]')?.textContent === 'Second seat');
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
  await menuLoaded();
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
  // the effort chip beside the model carries it.
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
  await menuLoaded();
  await waitFor(() => document.querySelector('[data-testid=picker-search]') !== null);
  // Search is available even on the shorter Claude list.
  expect(document.querySelector('[data-testid=picker-search]')).not.toBeNull();
  await type(query<HTMLInputElement>('[data-testid=picker-search]'), 'opus 4.8');
  await waitFor(() => shownModels().length === 1);
  expect(shownModels()).toEqual(['claude-opus-4-8']);
  expect(document.querySelector('[data-testid=picker-legacy]')).toBeNull();

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
  await waitFor(() => shownModels().length === 3);
  // The agent's own default is pinned first whatever the query.
  expect(shownModels()).toEqual([
    'anthropic/claude-sonnet-5',
    'opencode/claude-sonnet-5',
    'openrouter/anthropic/claude-sonnet-4-5'
  ]);
  expect(groupLabels()).toEqual(['anthropic', 'opencode', 'openrouter']);

  // Down onto the first named match, Enter to take it.
  press('ArrowDown');
  expect((document.activeElement as HTMLElement).getAttribute('data-model')).toBe('anthropic/claude-sonnet-5');
  press('Enter');
  await waitFor(() => document.querySelector('[data-testid=composer-picker-menu]') === null);
  expect(query('[data-testid=composer-picker]').textContent).toContain('Sonnet 5');

  // A query nothing answers says so, and Escape clears it before it closes anything.
  query<HTMLButtonElement>('[data-testid=composer-picker]').click();
  await menuLoaded();
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
  // Every level by its name, in the model's order, one dot each on the track.
  expect(Array.from(document.querySelectorAll('[data-testid=composer-effort-menu] [data-dot]')).map((el) => el.getAttribute('aria-label')))
    .toEqual(['Low', 'Medium', 'High', 'Extra high', 'Max', 'Ultra']);
  // Nothing chosen yet, so the model's own default reads as the active one.
  expect(effortPicked()).toBe('high');

  query<HTMLButtonElement>('[data-testid=composer-effort-menu] [data-value=xhigh]').click();
  await waitFor(() => effortPicked() === 'xhigh');
  // Picking a level keeps the popover open: it is a setting of the model, not a choice of its own.
  expect(document.querySelector('[data-testid=composer-effort-menu]')).not.toBeNull();
  // Two chips read at rest: the model's name, and the effort chip its level.
  expect(query('[data-testid=composer-picker]').textContent).toContain('Opus 5.5');
  expect(document.querySelector('[data-testid=composer-picker-effort]')).toBeNull();
  expect(query('[data-testid=composer-effort]').textContent?.trim()).toBe('Effort Extra high');
  // The heading names the live level, the line under the track what it costs.
  expect(query('[data-testid=effort-level]').textContent).toBe('Extra high');
  expect(query('[data-testid=effort-cost]').textContent).toBe(strings.composer.effortCost.high);

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

test('with a starred model the picker opens on its favorites; the arrows walk the tiles and rows, a letter goes to the search', async ({ app: _app }) => {
  vi.spyOn(store, 'favorites', 'get').mockReturnValue([
    { providerId: 'claude', accountId: 'a-claude-main', model: { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5' }, items: [] }
  ]);
  query<HTMLButtonElement>('[data-testid=new-thread]').click();
  await waitFor(() => store.draft !== null);
  await waitFor(() => query('[data-testid=composer-picker]').textContent?.includes('Opus 5.5') === true);

  const menu = '[data-testid=composer-picker-menu]';
  query<HTMLButtonElement>('[data-testid=composer-picker]').click();
  await menuLoaded();
  // The favorites tile is first in the rail and the one shown: its column lists the stars.
  expect(tiles()[0]).toBe('favorites');
  expect(query(`${menu} .tile.current`).dataset.provider).toBe('favorites');
  expect(query(`${menu} .provider-name`).textContent).toBe(strings.composer.favorites);
  await waitFor(() => document.querySelectorAll('[data-testid=favorite-model]').length === 1);
  expect(query('[data-testid=favorite-model]').title).toBe('claude-sonnet-5-5');

  // The arrows walk the tiles first, then the rows beside them.
  query<HTMLElement>(menu).focus();
  press('ArrowDown');
  expect(document.activeElement).toBe(query(`${menu} .tile[data-provider=favorites]`));
  press('ArrowDown');
  expect(document.activeElement).toBe(query(`${menu} .tile[data-provider=claude]`));

  // A provider tile shows its column; the search field takes the caret, the arrows go down into the models.
  query<HTMLButtonElement>(`${menu} .tile[data-provider=claude]`).click();
  await waitFor(() => shownModels().length === 3);
  await waitFor(() => document.activeElement === document.querySelector('[data-testid=picker-search]'));
  // Above the field, Claude's name: the button of its two accounts, then back down.
  press('ArrowUp');
  expect(document.activeElement).toBe(query('[data-testid=picker-account]'));
  press('ArrowDown');
  expect(document.activeElement).toBe(query('[data-testid=picker-search]'));
  press('ArrowDown');
  expect((document.activeElement as HTMLElement).getAttribute('data-model')).toBe('claude-fable-5-1');
  expect(query(`${menu} .row.current`).dataset.model).toBe('claude-opus-5-5');
  // A letter typed on a row goes to the search field.
  press('s');
  expect(document.activeElement).toBe(query('[data-testid=picker-search]'));
  press('Escape');
  await waitFor(() => document.querySelector(menu) === null);

  // One click on a favorite picks it and closes.
  query<HTMLButtonElement>('[data-testid=composer-picker]').click();
  await menuLoaded();
  await waitFor(() => document.querySelector('[data-testid=favorite-model]') !== null);
  query<HTMLButtonElement>('[data-testid=favorite-model]').click();
  await waitFor(() => document.querySelector(menu) === null);
  expect(query('[data-testid=composer-picker]').textContent).toContain('Sonnet 5.5');
});
