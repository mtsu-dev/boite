import { expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import WorkflowRunPane from './WorkflowRunPane.svelte';

test('the workflow distinguishes partial, unknown and measured zero usage', async () => {
  const client = new FakeClient({ delayMs: 0, delegationDemo: true });
  const store = new Store();
  store.attach(client);
  await store.connect();
  await store.open('t-trace');
  await store.probeModels('claude', 'a-claude-main');
  const [run] = await client.call('workflows.list', { threadId: 't-trace' });
  const review = run!.nodes.find(node => node.id === 'review')!;
  Object.assign(review.instances[0]!, { effort: 'high', usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 200, cacheWriteTokens: 30, costUsdEquivalent: null } });
  Object.assign(review.instances[1]!, { effort: 'high', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, costUsdEquivalent: null } });
  run!.usage = { inputTokens: 110, outputTokens: 25, cacheReadTokens: 200, cacheWriteTokens: 30, costUsdEquivalent: null };
  const target = document.createElement('div'); document.body.append(target);
  let component = mount(WorkflowRunPane, { target, props: { store, run: run!, onback() {} } });
  try {
    flushSync();
    expect(target.querySelector('[data-node-id="review"]')?.textContent).toContain('Sonnet 5.5');
    expect(target.querySelector('[data-node-id="review"] [data-testid="workflow-context"]')?.textContent?.trim()).toBe('Light');
    expect(target.querySelector('[data-node-id="review"] [data-testid="workflow-effort"]')?.textContent).toBe('High');
    expect(target.querySelector('[data-node-id="review"] [data-testid="workflow-node-tokens"]')?.textContent).toBe('365 tokens (partial)');
    expect(target.querySelector('[data-testid="workflow-meta"]')?.textContent).toContain('365 tokens (partial)');
    target.querySelector<HTMLButtonElement>('[data-node-id="review"]')!.click();
    flushSync();
    expect(target.querySelector('[data-testid="workflow-instance"]:last-child')?.textContent).toContain('Tokens unknown');
    await unmount(component);
    const empty = structuredClone(run!); empty.usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsdEquivalent: null };
    for (const node of empty.nodes) for (const instance of node.instances) instance.usage = null;
    component = mount(WorkflowRunPane, { target, props: { store, run: empty, onback() {} } });
    flushSync();
    expect(target.querySelector('[data-testid="workflow-meta"]')?.textContent).toContain('Tokens unknown');
    await unmount(component);
    for (const node of empty.nodes) for (const instance of node.instances) instance.usage = empty.usage;
    component = mount(WorkflowRunPane, { target, props: { store, run: empty, onback() {} } });
    flushSync();
    expect(target.querySelector('[data-testid="workflow-meta"]')?.textContent).toContain('0 tokens');
  } finally {
    await unmount(component); target.remove(); store.detach(); client.close();
  }

});
