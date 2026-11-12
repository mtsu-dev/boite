import { expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import { store } from '../lib/store.svelte';
import { projectView, ProjectView } from '../lib/project-view.svelte';
import { query, test, type, waitFor } from '../test/app';

vi.mock('@tauri-apps/plugin-opener', () => import('../test/opener'));

/** The tag sections drawn in the sidebar, each with the names of its projects. */
function sections(): { tag: string; label: string; projects: string[] }[] {
  return [...document.querySelectorAll<HTMLElement>('[data-testid=sidebar] [data-testid=tag-section]')].map(section => ({
    tag: section.dataset['tag'] ?? '',
    label: section.querySelector('.fold-header .label')?.textContent?.trim() ?? '',
    projects: [...section.querySelectorAll<HTMLElement>('[data-testid=project]')].map(card => card.dataset['projectName'] ?? ''),
  }));
}

test('the project menu button edits tags with known tags offered, and grouping by tag folds per device', async ({ app: _app }) => {
  projectView.setByTag(false);
  await store.setProjectTags('p-notes', ['Docs', 'work']);
  // The menu's button, not a right-click: the same path a phone takes.
  query<HTMLButtonElement>('[data-project-id="p-boite"] [data-testid=project-menu]').click();
  await waitFor(() => document.querySelector('[data-testid=context-menu] [data-value=tags]') !== null);
  query<HTMLButtonElement>('[data-testid=context-menu] [data-value=tags]').click();
  await waitFor(() => document.activeElement?.getAttribute('data-testid') === 'tag-dialog-input');
  const known = () => [...document.querySelectorAll('[data-testid=tag-dialog-known] button')].map(button => button.textContent?.trim());
  expect(known()).toEqual(['Docs', 'work']);
  const input = query<HTMLInputElement>('[data-testid=tag-dialog-input]');
  await type(input, '  Client  ');
  // Escape that ends an IME composition leaves the dialog open with what it holds.
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
  flushSync();
  expect(document.querySelector('[data-testid=tag-dialog]')).not.toBeNull();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  flushSync();
  // A known tag picked in another case is the same tag: it is offered once, and taken as offered.
  await type(input, 'WOR');
  expect(known()).toEqual(['work']);
  query<HTMLButtonElement>('[data-testid=tag-dialog-known] button').click();
  flushSync();
  expect([...document.querySelectorAll('[data-testid=tag-dialog-tags] .chip')].map(chip => chip.textContent?.trim())).toEqual(['Client', 'work']);
  query<HTMLButtonElement>('[data-testid=tag-dialog-save]').click();
  await waitFor(() => store.projects.find(p => p.id === 'p-boite')?.tags?.join() === 'Client,work');
  await waitFor(() => document.querySelector('[data-testid=tag-dialog]') === null);

  const extra = await store.client!.call('projects.add', { path: 'C:\\src\\untagged', name: 'loose' });
  await waitFor(() => store.projects.some(p => p.id === extra.id));
  projectView.setByTag(true);
  await waitFor(() => sections().length > 0);
  expect(sections()).toEqual([
    { tag: 'client', label: 'Client', projects: ['boite'] },
    { tag: 'docs', label: 'Docs', projects: ['notes'] },
    { tag: 'work', label: 'work', projects: expect.arrayContaining(['boite', 'notes']) },
    { tag: '', label: 'No tag', projects: ['loose'] },
  ]);
  // boite sits under Client and work: every id its two cards draw stays unique.
  const ids = [...document.querySelectorAll('[data-testid=sidebar] [id]')].map(element => element.id);
  expect(ids.length).toBe(new Set(ids).size);
  // Dragging is off while grouped, so no grip shows even in the custom order.
  expect(document.querySelector('[data-testid=sidebar] [data-testid=project-row].grab')).toBeNull();

  query<HTMLButtonElement>('[data-tag="work"] [data-testid=tag-section-toggle]').click();
  flushSync();
  expect(query('[data-tag="work"] [data-testid=tag-section-toggle]').getAttribute('aria-expanded')).toBe('false');
  // A new view reads the folds back, as the app does after a restart.
  const restarted = new ProjectView();
  expect([restarted.byTag, restarted.tagOpen('work'), restarted.tagOpen('client')]).toEqual([true, false, true]);

  // Removing the last tag of a section takes the section away.
  await store.setProjectTags('p-boite', ['work']);
  await waitFor(() => !sections().some(section => section.tag === 'client'));
  expect(sections().map(section => section.tag)).toEqual(['docs', 'work', '']);
  projectView.setByTag(false);
});
