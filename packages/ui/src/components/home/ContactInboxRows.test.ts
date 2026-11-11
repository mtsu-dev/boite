import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { setExperiment } from '../../lib/experiments';
import { FakeClient } from '../../lib/fake-client';
import { Store, store as primary } from '../../lib/store.svelte';
import { workspace } from '../../lib/workspace.svelte';
import ContactInboxRows from './ContactInboxRows.svelte';

let mounted: ReturnType<typeof mount> | undefined;
let stores: Store[] = [];
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  for (const store of stores) { store.client?.close(); store.detach(); }
  stores = [];
  workspace.machines = [];
  workspace.active = primary;
  document.body.innerHTML = '';
  setExperiment('contacts', false);
  localStorage.clear();
  vi.restoreAllMocks();
});

async function machine(id: string, label: string): Promise<{ id: string; label: string; store: Store }> {
  const store = new Store();
  store.machineId = id;
  store.attach(new FakeClient({ delayMs: 0, coreId: `core-${id}`, coreName: label }));
  await store.connect();
  stores.push(store);
  return { id, label, store };
}

/** Activity's contact rows over these machines, once the fake's pending ask from Chris shows. */
async function draw(...labels: string[]): Promise<void> {
  setExperiment('contacts', true);
  workspace.machines = await Promise.all(labels.map((label, index) => machine(`m${index}`, label)));
  workspace.active = workspace.machines[0]!.store;
  mounted = mount(ContactInboxRows, { target: document.body, props: { store: workspace.machines[0]!.store } });
  await vi.waitFor(() => { flushSync(); expect(one('activity-contact')).not.toBeNull(); });
}

const one = <T extends HTMLElement>(testid: string) => document.querySelector<T>(`[data-testid="${testid}"]`);

/** jsdom lays nothing out: the clamp's box reports `lines` of text behind a four-line window. */
function lay(lines: number) {
  const line = 20;
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('body') ? lines * line : 0; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('body') ? Math.min(lines, 4) * line : 0; });
}

test('a contact request reads whole above Accept, under its kind line, with no fold under four lines', async () => {
  lay(2);
  await draw('Studio');
  const row = one('activity-contact')!;
  // Its kind first, in words, so Accept and Refuse are expected.
  const kind = row.querySelector<HTMLElement>('[data-testid=activity-kind]')!;
  expect([kind.dataset.kind, kind.textContent]).toEqual(['request', 'Contact request']);
  expect(kind.compareDocumentPosition(one('activity-contact-open')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // The whole ask, never a cut line, and it comes before the decision.
  const text = one('activity-contact-text')!;
  expect(text.textContent).toBe('An agent on a project like the Boite pairing flow: our site embeds it and the redirect loops after login.');
  expect(one('clamp-text-toggle')).toBeNull();
  const accept = one<HTMLButtonElement>('activity-accept-creq-pending')!;
  expect(text.compareDocumentPosition(accept) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // One ask: the plain verbs, Accept the solid one after Refuse.
  expect([one('activity-refuse-creq-pending')!.textContent, accept.textContent, accept.classList.contains('primary')]).toEqual(['Refuse', 'Accept', true]);
  expect(one('activity-contact-copies')).toBeNull();
});

test('the same ask on two machines lists each copy, folds a long text behind Show all, and its verbs say they settle both', async () => {
  lay(6);
  await draw('Studio', 'Builder');
  const row = one('activity-contact')!;
  expect(row.dataset.count).toBe('2');
  expect(one('activity-contact-open')!.textContent).toBe('Chris sent 2 requests');
  // Each copy a line of its own: the contact's thread it came from, then where it arrived.
  const copies = [...document.querySelectorAll<HTMLElement>('[data-testid=activity-contact-copy]')];
  expect(copies.map(copy => copy.querySelector('.from')?.textContent)).toEqual(['Fix the login redirect in website', 'Fix the login redirect in website']);
  expect(copies.map(copy => copy.querySelector('.machine-place')?.textContent).sort()).toEqual(['on Builder', 'on Studio']);
  // Past four lines, the text folds to its first four and Show all opens it in place.
  const toggle = one<HTMLButtonElement>('clamp-text-toggle')!;
  expect([toggle.textContent?.trim(), toggle.getAttribute('aria-expanded')]).toEqual(['Show all', 'false']);
  toggle.click(); flushSync();
  expect([one('activity-contact-text')!.classList.contains('open'), toggle.textContent?.trim()]).toEqual([true, 'Show less']);
  // The group's actions settle every copy, and say so.
  expect([one('activity-refuse-creq-pending')!.textContent, one('activity-accept-creq-pending')!.textContent]).toEqual(['Refuse both', 'Accept both']);
});
