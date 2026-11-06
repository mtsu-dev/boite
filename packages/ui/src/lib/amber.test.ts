import { expect, test } from 'vitest';

/**
 * Amber (`--color-live`, `--color-live-fill`) means the user's turn and
 * nothing else. These components draw work that runs, ran or changed, never
 * something waiting on the user: a spinner, a live card, a diff, a trace, the
 * context meter. A running mark in amber would read as "answer me".
 */
const sources = import.meta.glob([
  '../components/ActivityCard.svelte',
  '../components/ChangesSurface.svelte',
  '../components/ContextControl.svelte',
  '../components/DelegationActivity.svelte',
  '../components/FileSurface.svelte',
  '../components/PullRequestBadge.svelte',
  '../components/ThinkingPart.svelte',
  '../components/ToolCard.svelte',
  '../components/ToolGroup.svelte',
  '../components/TraceSurface.svelte',
  '../components/TraceTable.svelte',
  '../components/WakeMarker.svelte',
  '../components/WorkflowActivity.svelte',
  '../components/WorkflowGraph.svelte',
  '../components/council/CouncilCard.svelte'
], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

test('the components that show work never wear the needs-you amber', () => {
  expect(Object.keys(sources)).toHaveLength(15);
  const amber = Object.entries(sources).filter(([, source]) => source.includes('--color-live')).map(([path]) => path);
  expect(amber).toEqual([]);
});
