import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { ProviderSummary } from '@boite/contracts';
import { strings } from '../lib/strings';
import ProviderTiles from './ProviderTiles.svelte';

let mounted: ReturnType<typeof mount> | undefined;
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = '';
});

const provider = (id: string, name: string, available = true) => ({ id, name, available, enabled: true }) as unknown as ProviderSummary;

test('a provider row says where it leads: Set up beside one with no account, a chevron on every row', () => {
  const providers = [provider('claude', 'Claude'), provider('grok', 'Grok')];
  // Nothing connected yet: every offered provider shows, each needing its setup.
  const store = { providers, offeredProviders: providers, accountsOf: () => [], providerOf: (id: string) => providers.find((entry) => entry.id === id) ?? null };
  mounted = mount(ProviderTiles, { target: document.body, props: { store: store as never, choice: null, locked: false, current: null, onpick: () => {} } });
  flushSync();
  const tiles = Array.from(document.querySelectorAll<HTMLElement>('.tile[data-provider]'));
  expect(tiles.map((tile) => tile.dataset.provider)).toEqual(['claude', 'grok']);
  for (const tile of tiles) {
    expect(tile.querySelector('.reason')?.textContent).toBe(strings.composer.noAccount);
    expect(tile.querySelector('.lead')?.textContent).toBe(strings.composer.setUp);
    expect(tile.querySelector('.chevron')).not.toBeNull();
  }
});
