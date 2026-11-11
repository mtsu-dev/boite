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
  // The kind's glyph is the card's one mark: nothing else is drawn before who asks.
  const before = [...row.querySelectorAll('svg, .mark')].filter(mark => mark.compareDocumentPosition(one('activity-contact-open')!) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(before.length).toBe(1);
  expect(kind.contains(before[0]!)).toBe(true);
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

test('the same ask on two machines lists each copy and folds a long text behind Show all', async () => {
  lay(6);
  await draw('Studio', 'Builder');
  const row = one('activity-contact')!;
  expect(row.dataset.count).toBe('2');
  expect(one('activity-contact-open')!.textContent).toBe('Chris asks for a project');
  // Unfolded, each copy a line of its own: the contact's thread it came from, then where it arrived.
  one<HTMLButtonElement>('activity-contact-copies-fold')!.click(); flushSync();
  const copies = [...document.querySelectorAll<HTMLElement>('[data-testid=activity-contact-copy]')];
  expect(copies.map(copy => copy.querySelector('.from')?.textContent)).toEqual(['Fix the login redirect in website', 'Fix the login redirect in website']);
  expect(copies.map(copy => copy.querySelector('.machine-place')?.textContent).sort()).toEqual(['on Builder', 'on Studio']);
  // Past four lines, the text folds to its first four and Show all opens it in place.
  const toggle = one<HTMLButtonElement>('clamp-text-toggle')!;
  expect([toggle.textContent?.trim(), toggle.getAttribute('aria-expanded')]).toEqual(['Show all', 'false']);
  toggle.click(); flushSync();
  expect([one('activity-contact-text')!.classList.contains('open'), toggle.textContent?.trim()]).toEqual([true, 'Show less']);
});

test('one request sent twice reads as one request: "Chris asks for a project", "Sent 2 times" on its fold, single verbs that settle both copies', async () => {
  lay(2);
  await draw('Studio', 'Builder');
  // The data: the same ask from the same contact, received on two machines, merged into one row.
  expect(document.querySelectorAll('[data-testid=activity-contact]').length).toBe(1);
  expect(one('activity-contact')!.dataset.count).toBe('2');
  // The title says one request, never a count of requests; the count is how many times it was sent.
  expect(one('activity-contact-open')!.textContent).toBe('Chris asks for a project');
  expect(one('activity-contact-copies-fold')!.textContent).toMatch(/^Sent 2 times: on (Studio|Builder) /);
  // One verb each, as for a single ask.
  const accept = one<HTMLButtonElement>('activity-accept-creq-pending')!;
  expect([one('activity-refuse-creq-pending')!.textContent, accept.textContent]).toEqual(['Refuse', 'Accept']);
  // Accept answers every copy: no row is left waiting on the other machine.
  accept.click();
  await vi.waitFor(() => { flushSync(); expect(one('activity-contact')).toBeNull(); });
});

test('identical copies fold into one quiet line under the text, where and when each arrived, which opens on each copy', async () => {
  lay(2);
  await draw('Studio', 'Builder');
  const fold = one<HTMLButtonElement>('activity-contact-copies-fold')!;
  // One line after the text, in words: how many, then each copy's machine and time; no sub-rows yet.
  expect(fold.textContent).toMatch(/^Sent 2 times: on (Studio|Builder) [^,]+, on (Studio|Builder) [^,]+$/);
  expect(fold.textContent).toContain('on Studio');
  expect(fold.textContent).toContain('on Builder');
  expect(one('activity-contact-text')!.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect([fold.getAttribute('aria-expanded'), one('activity-contact-copies')]).toEqual(['false', null]);
  fold.click(); flushSync();
  expect([fold.getAttribute('aria-expanded'), document.querySelectorAll('[data-testid=activity-contact-copy]').length]).toEqual(['true', 2]);
  fold.click(); flushSync();
  expect(one('activity-contact-copies')).toBeNull();
});
