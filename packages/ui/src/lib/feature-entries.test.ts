import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import { followDesktopOf, heardBuild, writeExperiments } from './experiments';
import { resetFeatures, setFeature } from './features';
import { whipEntry } from './whip-entry.svelte';
import { loadCouncilSalon } from './council-entry';
import { parts } from './deferred-parts';

afterEach(() => {
  writeExperiments([]);
  resetFeatures();
  window.localStorage.clear();
});

function primarySays(version: string): void {
  const owner = {};
  followDesktopOf(owner);
  onTestFinished(() => followDesktopOf(null));
  heardBuild(owner, version);
}

test('the Whip is fetched the first time its Appearance switch is on, the control before the rope, on a Release too', async () => {
  const failed = vi.fn();
  primarySays('2.0.0');
  setFeature('whip', false);
  whipEntry.need(failed);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(whipEntry.feature).toBeUndefined();

  setFeature('whip', true);
  whipEntry.need(failed);
  await vi.waitFor(() => expect(whipEntry.overlay).toBeDefined(), { timeout: 10_000 });
  expect(whipEntry.feature?.WhipButton).toBeDefined();
  expect(failed).not.toHaveBeenCalled();
});

test('the Council\'s card and salon load', async () => {
  expect(await parts.CouncilCard.load()).toBeDefined();
  expect((await loadCouncilSalon()).default).toBeDefined();
});

test('holds the Contacts screens', async () => {
  const { contactsParts } = await import('./contacts-entry');
  expect(Object.keys(contactsParts ?? {})).toEqual(['HomePage', 'ContactsRail', 'ContactRows', 'ContactRequestNotice', 'ContactInboxRows', 'SidebarContacts', 'SharedThreadDialog']);
});
