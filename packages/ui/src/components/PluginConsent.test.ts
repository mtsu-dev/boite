import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PluginConsent, { type ConsentRequest } from './PluginConsent.svelte';

let mounted: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = '';
});

const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-testid="plugin-consent-row"]')];
const box = (permission: string) => q(`[data-testid="plugin-consent-row"][data-permission="${permission}"] input`) as HTMLInputElement;

function show(request: ConsentRequest): (grants: string[] | null) => void {
  const onanswer = vi.fn<(grants: string[] | null) => void>();
  mounted = mount(PluginConsent, { target: document.body, props: { request, onanswer } });
  flushSync();
  return onanswer;
}

const bureau: ConsentRequest = {
  name: 'Bureau', mode: 'install', source: { url: 'https://github.com/exemple/bureau', commit: '4db2663a1c' },
  requested: ['ui', 'todos.write', 'questions.write', 'threads.read'], ticked: ['ui', 'todos.write', 'questions.write', 'threads.read'], added: [], runsProgram: true,
};

test('each permission is a ticked line in the table\'s order, the dangerous ones last and red, and the program a line with no box', () => {
  const onanswer = show(bureau);
  expect(q('#consent-title')?.textContent).toBe('Bureau wants to access your Boite');
  expect(q('[data-testid="plugin-consent"]')?.textContent).toContain('github.com/exemple/bureau, commit 4db2663');
  expect(rows().map((row) => [row.dataset.permission, row.dataset.danger])).toEqual([
    ['threads.read', 'false'], ['todos.write', 'false'], ['questions.write', 'true'], ['ui', 'true'],
  ]);
  expect(rows().every((row) => (row.querySelector('input') as HTMLInputElement).checked)).toBe(true);
  expect(q('[data-permission="ui"]')?.textContent).toContain('Change Boite\'s interface');
  expect(q('[data-permission="ui"]')?.textContent).toContain('it can do anything you do');
  const program = q('[data-testid="plugin-consent-program"]')!;
  expect(program.textContent).toContain('Runs a program on this machine');
  expect(program.querySelector('input')).toBeNull();

  // Unticked, a permission is left out; the rest come back in the order the plugin asked.
  box('questions.write').click();
  box('ui').click();
  q('[data-testid="plugin-consent-allow"]')!.click();
  expect(onanswer).toHaveBeenCalledWith(['todos.write', 'threads.read']);
});

test('Cancel and Escape answer null, granting nothing', () => {
  const onanswer = show(bureau);
  q('[data-testid="plugin-consent-cancel"]')!.click();
  expect(onanswer).toHaveBeenLastCalledWith(null);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(onanswer).toHaveBeenCalledTimes(2);
  expect(onanswer).toHaveBeenLastCalledWith(null);
});

test('an update ticks what was granted and what is new, marked New, and leaves a refused one unticked', () => {
  show({ ...bureau, requested: ['threads.read', 'todos.read', 'agents.read'], ticked: ['threads.read', 'agents.read'], added: ['agents.read'], runsProgram: false });
  expect(box('threads.read').checked).toBe(true);
  expect(box('todos.read').checked).toBe(false);
  expect(box('agents.read').checked).toBe(true);
  expect([...document.querySelectorAll('[data-testid="plugin-consent-new"]')].map((el) => el.closest<HTMLElement>('[data-permission]')?.dataset.permission)).toEqual(['agents.read']);
  expect(q('[data-testid="plugin-consent-program"]')).toBeNull();
});

test('the editor saves only a change, and a schema 1 plugin says it gets the owner\'s own access', () => {
  const onanswer = show({ ...bureau, mode: 'edit', source: null, requested: ['threads.read', 'todos.read'], ticked: ['threads.read'] });
  expect(q('#consent-title')?.textContent).toBe('What Bureau may reach');
  const save = q('[data-testid="plugin-consent-allow"]') as HTMLButtonElement;
  expect(save.textContent).toBe('Save');
  expect(save.disabled).toBe(true);
  box('todos.read').click();
  flushSync();
  expect(save.disabled).toBe(false);
  save.click();
  expect(onanswer).toHaveBeenCalledWith(['threads.read', 'todos.read']);
  unmount(mounted!);
  mounted = undefined;

  show({ ...bureau, requested: null, ticked: [] });
  expect(rows()).toEqual([]);
  expect(q('[data-testid="plugin-consent-owner"]')?.textContent).toContain('Reaches all of Boite');
  expect(q('[data-testid="plugin-consent-program"]')).not.toBeNull();
});
