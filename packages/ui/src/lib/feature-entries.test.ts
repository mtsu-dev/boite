import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import { followDesktopOf, heardBuild, writeExperiments } from './experiments';
import { whipEntry } from './whip-entry.svelte';
import { councilBuilt, loadCouncilSalon } from './council-entry';
import { parts } from './deferred-parts';

afterEach(() => {
  writeExperiments([]);
  window.localStorage.clear();
});

function primarySays(version: string): void {
  const owner = {};
  followDesktopOf(owner);
  onTestFinished(() => followDesktopOf(null));
  heardBuild(owner, version);
}

test('the Whip is fetched the first time its switch is on, the control before the rope, and never on a Release', async () => {
  const failed = vi.fn();
  primarySays('2.0.0');
  writeExperiments(['whip']);
  whipEntry.need(failed);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(whipEntry.feature).toBeUndefined();

  primarySays('2.0.0-nightly.20261113.1');
  whipEntry.need(failed);
  await vi.waitFor(() => expect(whipEntry.overlay).toBeDefined(), { timeout: 10_000 });
  expect(whipEntry.feature?.WhipButton).toBeDefined();
  expect(failed).not.toHaveBeenCalled();
});

test('from source no flag is defined and the Council is there; a bundle defines it', async () => {
  expect(councilBuilt()).toBe(true);
  expect(await parts.CouncilCard.load()).toBeDefined();
  expect((await loadCouncilSalon())?.default).toBeDefined();
  // What Vite's define does to a Release bundle, where the bundler then drops the import.
  vi.stubGlobal('__BOITE_HAS_DEBATES__', false);
  onTestFinished(() => { vi.stubGlobal('__BOITE_HAS_DEBATES__', undefined); });
  expect(councilBuilt()).toBe(false);
  expect(loadCouncilSalon()).toBeNull();
});
