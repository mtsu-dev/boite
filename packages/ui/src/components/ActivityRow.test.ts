import type { PermissionRequest, ThreadSummary } from '@boite/contracts';
import { projectName } from '../lib/format';
import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import { activityFeed, feedGroups } from '../lib/activity-feed';
import { setExperiment } from '../lib/experiments';
import { workspace } from '../lib/workspace.svelte';
import ActivityRow from './ActivityRow.svelte';
import ContactInboxRows from './home/ContactInboxRows.svelte';

let mounted: ReturnType<typeof mount> | undefined;
let client: FakeClient;
let store: Store;
const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flushSync(); } };
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  store?.detach(); client?.close();
  document.body.innerHTML = ''; localStorage.clear();
});

async function rows(command: string) {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const parent = store.threads.find(thread => !thread.parentThreadId && thread.projectId && thread.id !== store.openThread?.id)!;
  parent.status = 'waiting';
  const child = { ...parent, id: 'helper-child', title: 'Check the parser', status: 'waiting', parentThreadId: parent.id } as ThreadSummary;
  store.threads = [...store.threads, child];
  store.pendingPermissions = [{ id: 'perm', threadId: parent.id, toolName: 'Bash', input: { command }, description: null, createdAt: Date.now() } as unknown as PermissionRequest];
  store.pendingQuestions = [{ id: 'q', threadId: child.id, text: 'Which retry policy?', options: [], createdAt: Date.now() } as never];
  const machine = { id: 'local', label: 'Local', store };
  const project = store.projects.find(project => project.id === parent.projectId);
  const groups = feedGroups(activityFeed([parent, child].map(thread => ({ machine, thread, project }))));
  return { parent, child, groups };
}

test('a permission reads whole under its row, its sub-agent\'s question is a row of its own, and each row\'s one action opens its thread', async () => {
  const command = 'git push --force-with-lease origin feature/a-branch-name-long-enough-to-wrap-in-the-row\n&& gh pr create --fill';
  const { parent, child, groups } = await rows(command);
  // One event, one row: a question is not the same ask as a permission, so the sub-agent does not ride its parent's row.
  expect(groups).toHaveLength(2);
  const own = groups.find(group => group.row.thread.id === parent.id)!;
  const asks = groups.find(group => group.row.thread.id === child.id)!;
  expect(own.helpers).toEqual([]);
  expect(asks.helpers).toEqual([]);
  mounted = mount(ActivityRow, { target: document.body, props: { ...own, now: Date.now() } });
  await settle();
  expect(document.querySelectorAll('[data-testid=thread-row]')).toHaveLength(1);
  // The card opens on its kind, so its verbs are expected: a permission.
  const kind = document.querySelector<HTMLElement>('[data-testid=activity-kind]')!;
  expect([kind.dataset.kind, kind.textContent]).toEqual(['permission', 'Permission']);
  expect(kind.compareDocumentPosition(document.querySelector('[data-testid=thread-row] .title')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // The decision is titled by what it does, the composer's own title (lib/decision-title.ts), whole.
  const reason = document.querySelector('[data-testid=thread-reason]')!;
  expect(reason.textContent).toBe('Push feature/a-branch-name-long-enough-to-wrap-in-the-row');
  // Where it comes from first: the place line under the title names its project, then the ask, then the command.
  const where = document.querySelector('[data-testid=thread-where]')!;
  expect(where.textContent).toContain(projectName(store.projects.find(project => project.id === parent.projectId)!));
  expect(where.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(reason.compareDocumentPosition(document.querySelector('[data-testid=thread-operation]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // The command whole, both lines, never cut to its first.
  expect(document.querySelector('[data-testid=thread-operation]')?.textContent).toBe(command);
  // It wraps at spaces only: the branch name is one unbreakable word, never cut at a hyphen.
  expect([...document.querySelectorAll('[data-testid=thread-operation] .word')].map(word => word.textContent)).toContain('feature/a-branch-name-long-enough-to-wrap-in-the-row');
  expect(document.querySelector('[data-testid=thread-helper]')).toBeNull();
  const verbs = document.querySelectorAll<HTMLButtonElement>('[data-testid=thread-verb]');
  expect([...verbs].map(verb => [verb.textContent?.trim(), verb.dataset.verb])).toEqual([['Allow once', 'allow']]);
  // The row's action ranks: Allow is the solid neutral fill (button.primary), never the accent's send.
  expect(verbs[0]!.classList.contains('primary')).toBe(true);
  expect(verbs[0]!.classList.contains('send')).toBe(false);
  // One decision pair, the composer's: Deny outlined before Allow, in one right-aligned group.
  const deny = document.querySelector<HTMLButtonElement>('[data-testid=thread-verb-secondary]')!;
  expect([deny.textContent?.trim(), deny.dataset.verb, deny.classList.contains('secondary')]).toEqual(['Deny', 'deny', true]);
  expect(deny.parentElement).toBe(verbs[0]!.parentElement);
  expect(deny.parentElement!.classList.contains('decision-actions')).toBe(true);
  expect(deny.compareDocumentPosition(verbs[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  verbs[0]!.click(); await settle();
  await vi.waitFor(() => expect(store.openThread?.id).toBe(parent.id));
  await unmount(mounted); document.body.innerHTML = '';
  // Opening the parent kept only its own requests; Activity holds every thread's (permissionRead 'all').
  store.pendingQuestions = [{ id: 'q', threadId: child.id, text: 'Which retry policy?', options: [], createdAt: Date.now() } as never];
  mounted = mount(ActivityRow, { target: document.body, props: { ...asks, now: Date.now() } });
  await settle();
  expect(document.querySelector('[data-testid=activity-kind]')?.textContent).toBe('Question');
  const verb = document.querySelector<HTMLButtonElement>('[data-testid=thread-verb]')!;
  expect([verb.textContent?.trim(), verb.dataset.verb]).toEqual(['Answer', 'answer']);
  // Skip settles the question in place, without leaving Activity.
  const answer = vi.spyOn(store, 'skipQuestion').mockResolvedValue(true);
  const skip = document.querySelector<HTMLButtonElement>('[data-testid=thread-verb-secondary]')!;
  expect([skip.textContent?.trim(), skip.dataset.verb]).toEqual(['Skip', 'skip']);
  skip.click(); await settle();
  expect(answer).toHaveBeenCalledWith(child.id, 'q');
  expect(store.openThread?.id).toBe(parent.id);
});

test('Deny settles the permission in place, with the request the row shows', async () => {
  const { parent, groups } = await rows('bun test');
  const deny = vi.spyOn(store, 'answer').mockResolvedValue(true);
  mounted = mount(ActivityRow, { target: document.body, props: { ...groups.find(group => group.row.thread.id === parent.id)!, now: Date.now() } });
  await settle();
  document.querySelector<HTMLButtonElement>('[data-testid=thread-verb-secondary]')!.click(); await settle();
  expect(deny).toHaveBeenCalledWith('perm', 'deny');
  expect(store.openThread?.id).not.toBe(parent.id);
});

test('a command too long to read in the row asks for Review before any Allow', async () => {
  const { parent, groups } = await rows(Array.from({ length: 12 }, (_, line) => `echo step ${line}`).join('\n'));
  mounted = mount(ActivityRow, { target: document.body, props: { ...groups.find(group => group.row.thread.id === parent.id)!, now: Date.now() } });
  await settle();
  const verb = document.querySelector<HTMLButtonElement>('[data-testid=thread-verb]')!;
  expect([verb.textContent?.trim(), verb.dataset.verb]).toEqual(['Review', 'review']);
  // Reading first is not a decision: an outline button, never plain text, and no Deny beside it.
  expect(verb.classList.contains('secondary')).toBe(true);
  expect(verb.classList.contains('primary')).toBe(false);
  expect(document.querySelector('[data-testid=thread-verb-secondary]')).toBeNull();
});

test('an Updates row has no pair, and its time stands where the Needs you rows\' time stands', async () => {
  const { parent, groups } = await rows('bun test');
  const own = groups.find(group => group.row.thread.id === parent.id)!;
  mounted = mount(ActivityRow, { target: document.body, props: { ...own, row: { ...own.row, section: 'updates', verb: null, kind: null }, now: Date.now() } });
  await settle();
  // Nothing to decide, no kind line: the title keeps the row's top.
  expect(document.querySelector('[data-testid=activity-kind]')).toBeNull();
  // With no event to name, the time ends the place line as a Needs you row's; nothing to decide, no pair.
  expect(document.querySelector('[data-testid=thread-where] > time.since')).not.toBeNull();
  expect(document.querySelector('[data-testid=thread-verb]')).toBeNull();
});

test('an update leads with what happened in words, its time beside the word, and its place line only says where', async () => {
  const { parent, groups } = await rows('bun test');
  const own = groups.find(group => group.row.thread.id === parent.id)!;
  mounted = mount(ActivityRow, { target: document.body, props: { ...own, row: { ...own.row, section: 'updates', verb: null, kind: 'done', thread: { ...own.row.thread, status: 'idle' } }, helpers: [], now: Date.now() } });
  await settle();
  const kind = document.querySelector<HTMLElement>('[data-testid=activity-kind]')!;
  expect([kind.dataset.kind, kind.classList.contains('news'), kind.querySelector('.ui-label')?.textContent]).toEqual(['done', true, 'Finished']);
  expect(kind.querySelector('time')?.textContent).toBeTruthy();
  expect(document.querySelector('[data-testid=thread-where] > time')).toBeNull();
});

test('the kind\'s glyph is every card\'s one mark: no state mark beside the title, at either end', async () => {
  const { parent, child, groups } = await rows('bun test');
  const own = groups.find(group => group.row.thread.id === parent.id)!;
  const asks = groups.find(group => group.row.thread.id === child.id)!;
  const failed = { ...own, row: { ...own.row, kind: 'failed' as const, verb: 'review' as const, thread: { ...parent, status: 'error' } as ThreadSummary } };
  for (const group of [own, asks, failed]) {
    mounted = mount(ActivityRow, { target: document.body, props: { ...group, now: Date.now() } });
    await settle();
    // The kind line leads the card with its glyph; the title's line starts on the title.
    expect(document.querySelector('[data-testid=activity-kind] svg')).not.toBeNull();
    expect(document.querySelector('.title-line')?.firstElementChild?.classList.contains('headline')).toBe(true);
    expect(document.querySelector('.title-line .when')).toBeNull();
    await unmount(mounted); mounted = undefined;
  }
});

test('a stop wears the quiet stop glyph, never the failure\'s red one, which only a failure keeps', async () => {
  const { parent, groups } = await rows('bun test');
  const own = groups.find(group => group.row.thread.id === parent.id)!;
  // The thread no longer asks: what is left is its own end.
  store.pendingPermissions = []; store.pendingQuestions = [];
  store.threads = store.threads.filter(thread => thread.parentThreadId !== parent.id);
  const stoppedThread = { ...parent, status: 'idle', backgroundWait: { state: 'interrupted', for: 'release build', reason: 'error', at: Date.now() } } as ThreadSummary;
  const failedThread = { ...parent, status: 'error' } as ThreadSummary;
  for (const [kind, thread, verb] of [['stopped', stoppedThread, null], ['failed', failedThread, 'review']] as const) {
    mounted = mount(ActivityRow, { target: document.body, props: { ...own, helpers: [], row: { ...own.row, section: verb ? 'needs' : 'updates', kind, verb, thread }, now: Date.now() } });
    await settle();
    const line = document.querySelector<HTMLElement>('[data-testid=activity-kind]')!;
    expect(line.dataset.kind).toBe(kind);
    // The glyph is red for a failure only; a stop reads in the quiet ink.
    expect([line.classList.contains('alarm'), line.classList.contains('news')]).toEqual(kind === 'failed' ? [true, false] : [false, true]);
    expect(line.querySelector('svg.lucide-circle-alert') !== null).toBe(kind === 'failed');
    expect(line.querySelector('svg.lucide-circle-stop') !== null).toBe(kind === 'stopped');
    await unmount(mounted); mounted = undefined;
  }
});

test('the menu stands in one place on every kind of card, Needs you and Updates alike: the card\'s last part, after its pair', async () => {
  const { parent, child, groups } = await rows('bun test');
  const own = groups.find(group => group.row.thread.id === parent.id)!;
  const asks = groups.find(group => group.row.thread.id === child.id)!;
  const failed = { ...own, row: { ...own.row, kind: 'failed' as const, verb: 'review' as const, thread: { ...parent, status: 'error' } as ThreadSummary } };
  const update = { ...own, row: { ...own.row, section: 'updates' as const, verb: null, kind: 'done' as const, thread: { ...parent, status: 'idle' } as ThreadSummary }, helpers: [] };
  const menus: (string | null)[] = [];
  /** The card's last part is its menu (the page's last column), every pair before it; returns the menu's name. */
  const place = (card: HTMLElement, pair: string) => {
    const last = card.lastElementChild as HTMLElement;
    const pairBox = card.querySelector(pair);
    if (pairBox) expect(pairBox.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    menus.push((last.matches('button') ? last : last.querySelector('button'))?.getAttribute('aria-label') ?? null);
  };
  for (const group of [own, asks, failed, update]) {
    mounted = mount(ActivityRow, { target: document.body, props: { ...group, now: Date.now() } });
    await settle();
    place(document.querySelector<HTMLElement>('.thread.feed')!, '.feed-actions');
    await unmount(mounted); mounted = undefined;
  }
  // A contact request: its menu (another project to accept into) in the same place.
  setExperiment('contacts', true);
  workspace.machines = [{ id: 'local', label: 'Local', store }];
  mounted = mount(ContactInboxRows, { target: document.body, props: { store } });
  await vi.waitFor(() => { flushSync(); expect(document.querySelector('[data-testid=activity-contact]')).not.toBeNull(); });
  place(document.querySelector<HTMLElement>('[data-testid=activity-contact]')!, '.pair');
  expect(menus).toEqual([...Array(4).fill('Thread actions'), 'More actions']);
  setExperiment('contacts', false);
  workspace.machines = [];
});

/** jsdom lays nothing out: the clamp's box reports `lines` of text behind a four-line window. */
function lay(lines: number) {
  const line = 20;
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('body') ? lines * line : 0; });
  const client = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('body') ? Math.min(lines, 4) * line : 0; });
  return () => { scroll.mockRestore(); client.mockRestore(); };
}

test('a question is read whole above Answer: four lines in full, past them a Show all that unfolds in place', async () => {
  const { child, groups } = await rows('bun test');
  const asks = groups.find(group => group.row.thread.id === child.id)!;
  const short = 'Which retry policy?\nExponential backs off to 30 s.\nLinear retries every 5 s.';
  store.pendingQuestions = [{ id: 'q', threadId: child.id, text: short, options: [], createdAt: Date.now() } as never];
  let restore = lay(3);
  try {
    mounted = mount(ActivityRow, { target: document.body, props: { ...asks, now: Date.now() } });
    await settle();
    // Every line of the question, not its first alone, and no fold under four lines.
    expect(document.querySelector('[data-testid=thread-reason]')?.textContent).toBe(short);
    expect(document.querySelector('[data-testid=clamp-text-toggle]')).toBeNull();
    const reason = document.querySelector('[data-testid=thread-reason]')!;
    expect(reason.compareDocumentPosition(document.querySelector('[data-testid=thread-verb]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  } finally { restore(); }
  await unmount(mounted); mounted = undefined; document.body.innerHTML = '';
  const long = Array.from({ length: 7 }, (_, line) => `Option ${line + 1}: a policy worth reading before choosing.`).join('\n');
  store.pendingQuestions = [{ id: 'q', threadId: child.id, text: long, options: [], createdAt: Date.now() } as never];
  restore = lay(7);
  try {
    mounted = mount(ActivityRow, { target: document.body, props: { ...asks, now: Date.now() } });
    await settle();
    const reason = document.querySelector<HTMLElement>('[data-testid=thread-reason]')!;
    // Past four lines: the whole text is there, folded to its first four, and Show all opens it in place.
    expect(reason.textContent).toBe(long);
    expect(reason.classList.contains('open')).toBe(false);
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid=clamp-text-toggle]')!;
    expect([toggle.textContent?.trim(), toggle.getAttribute('aria-expanded'), toggle.classList.contains('text')]).toEqual(['Show all', 'false', true]);
    toggle.click(); await settle();
    expect([reason.classList.contains('open'), toggle.textContent?.trim(), toggle.getAttribute('aria-expanded')]).toEqual([true, 'Show less', 'true']);
    // Unfolding is not a decision: the thread stays where it was.
    expect(store.openThread?.id).not.toBe(child.id);
  } finally { restore(); }
});
