import { afterEach, expect, test, vi } from 'vitest';
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import { workspace } from '../lib/workspace.svelte';
import { viewMenuItems } from '../lib/view-menu';
import { projectView, type ProjectEntry } from '../lib/project-view.svelte';
import Sidebar from './Sidebar.svelte';
import MobileNavigation from './MobileNavigation.svelte';
import Inbox from './home/Inbox.svelte';
import Menu from './Menu.svelte';

/**
 * Round 13: Recent, the palette and the home cards named a machine one way,
 * "render-farm · ☰ Builder" and nothing for this PC, while the desktop
 * Projects headers drew a glyph before every name (🖥 for this PC), the phone
 * headers spent a second line on "This PC" and the view picker put "Builder"
 * on a line of its own. Every one of them now reads as the Recent rows do.
 */
let mounted: ReturnType<typeof mount> | undefined;
const stores: Store[] = [];
const previousActive = workspace.active;
const previousView = workspace.view;
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  for (const store of stores.splice(0)) { store.detach(); store.client?.close(); }
  workspace.machines = []; workspace.active = previousActive; workspace.view = previousView;
  vi.restoreAllMocks(); document.body.innerHTML = ''; localStorage.clear();
});

const settle = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); flushSync(); } };

async function twoMachines(): Promise<{ here: Store; builder: Store }> {
  const here = new Store(); here.machineId = 'local'; here.attach(new FakeClient({ delayMs: 0 })); await here.connect();
  const builder = new Store(); builder.machineId = 'http://builder.test'; builder.visible = false;
  builder.attach(new FakeClient({ delayMs: 0, coreId: 'fake-builder', coreName: 'Builder' })); await builder.connect();
  stores.push(here, builder);
  workspace.machines = [{ id: 'local', label: 'This PC', store: here }, { id: builder.machineId, label: 'Builder', store: builder, icon: 'rack' }];
  workspace.active = here;
  workspace.view = 'projects';
  return { here, builder };
}

/** The suffix a surface draws: after the name, its dot, a glyph and the machine's name (spaced by CSS), nothing on this PC. */
function suffixOf(scope: Element | null, testid: string): { text: string; glyph: boolean } | null {
  const suffix = scope?.querySelector(`[data-testid=${testid}]`);
  return suffix ? { text: suffix.textContent!.replace(/\s+/g, ' ').trim(), glyph: !!suffix.querySelector('svg') } : null;
}

test('the desktop Projects headers name another machine after the project, as Recent does, and this PC not at all', async () => {
  const { builder } = await twoMachines();
  mounted = mount(Sidebar, { target: document.body, props: { store: workspace.active } });
  await vi.waitFor(async () => { await settle(); expect(document.querySelector(`section[data-testid=project][data-machine-id="${builder.machineId}"]`)).not.toBeNull(); });
  const sections = [...document.querySelectorAll<HTMLElement>('section[data-testid=project]')];
  const local = sections.filter(section => section.dataset['machineId'] === 'local');
  const remote = sections.filter(section => section.dataset['machineId'] === builder.machineId);
  expect(local.length).toBeGreaterThan(0);
  expect(remote.length).toBeGreaterThan(0);
  for (const section of local) expect(suffixOf(section.querySelector('.head'), 'project-host')).toBeNull();
  for (const section of remote) {
    expect(suffixOf(section.querySelector('.head'), 'project-host')).toEqual({ text: '·Builder', glyph: true });
    // After the name: every name starts at one x, the tile's.
    const name = section.querySelector('.head .name')!;
    expect(name.compareDocumentPosition(section.querySelector('[data-testid=project-host]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
});

test('the phone Projects headings keep the machine on the name\'s line, and the view picker\'s rows on one line', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: true, onchange: null, addListener() {}, removeListener() {}
  }) as unknown as MediaQueryList);
  const { builder } = await twoMachines();
  mounted = mount(MobileNavigation, { target: document.body, props: { store: workspace.active, screen: 'threads' } });
  await vi.waitFor(async () => { await settle(); expect(document.querySelector(`[data-testid=mobile-project-group][data-machine-id="${builder.machineId}"]`)).not.toBeNull(); });
  const groups = [...document.querySelectorAll<HTMLElement>('[data-testid=mobile-project-group]')];
  for (const group of groups) {
    const heading = group.querySelector('h2')!;
    // No block of its own under the name: the old second line was a bare span.
    expect(heading.querySelector(':scope > span:not(.machine-suffix)')).toBeNull();
    if (group.dataset['machineId'] === 'local') expect(suffixOf(heading, 'mobile-project-machine')).toBeNull();
    else expect(suffixOf(heading, 'mobile-project-machine')).toEqual({ text: '·Builder', glyph: true });
  }

  // The picker: "render-farm · ☰ Builder" on the label's line, nothing for this PC, the path only with one machine.
  workspace.view = 'recent';
  const entries = workspace.machines.flatMap(machine => machine.store.projects.slice(0, 1).map(project => ({ machine, project }) as unknown as ProjectEntry));
  const rows = viewMenuItems(entries, true).filter(item => item.projectTile);
  expect(rows.map(item => [item.hint, item.count, item.machine?.label])).toEqual([[undefined, undefined, undefined], [undefined, undefined, 'Builder']]);
  const menu = mount(Menu, { target: document.body, props: { items: rows, onpick: () => {}, label: 'View', testid: 'view-menu', children: createRawSnippet(() => ({ render: () => '<span>Recent</span>' })) } });
  flushSync();
  document.querySelector<HTMLButtonElement>('[data-testid=view-menu]')!.click();
  await settle();
  const row = [...document.querySelectorAll('[role="menuitemradio"]')].find(node => node.textContent?.includes('Builder'));
  expect(row?.querySelector('.machine-suffix svg')).not.toBeNull();
  await unmount(menu);
  expect(viewMenuItems(entries.slice(0, 1), false).find(item => item.projectTile)?.hint).toBe(entries[0]!.project.path);
  expect(projectView.filter).toBeNull();
});

test('the home\'s working rows name another machine after the project with its glyph, and this PC not at all', async () => {
  const { here, builder } = await twoMachines();
  const busy = (store: Store) => { store.threads = store.threads.map((thread, index) => index < 1 ? { ...thread, status: 'running', runningSince: Date.now() - 60_000, parentThreadId: undefined } : { ...thread, status: 'idle' }); };
  busy(here); busy(builder);
  localStorage.setItem('boite.inbox.working', 'open');
  mounted = mount(Inbox, { target: document.body, props: { store: here } });
  await vi.waitFor(async () => { await settle(); expect(document.querySelectorAll('[data-testid=inbox-working]').length).toBe(2); });
  const row = (machine: string) => document.querySelector(`[data-testid=inbox-working][data-machine-id="${machine}"]`);
  expect(suffixOf(row('local'), 'inbox-working-machine')).toBeNull();
  expect(suffixOf(row(builder.machineId!), 'inbox-working-machine')).toEqual({ text: '·Builder', glyph: true });
  expect(row('local')!.querySelector('[data-testid=inbox-working-where]')!.textContent).not.toContain('·');
});
