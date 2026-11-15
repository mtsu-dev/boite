import { afterEach, expect, test } from 'vitest';
import { pings } from './team-pings';

afterEach(() => { document.body.innerHTML = ''; });

const marked = (node: HTMLElement) => [...node.querySelectorAll('.ping')].map(ping => ping.textContent);

test('a ping follows the members: one who left loses its colour, and a second pass marks no more than the first', async () => {
  const node = document.createElement('div');
  node.innerHTML = '<p>@Alice@Bob and @Bob, <code>@Alice</code> aside</p>';
  document.body.append(node);
  const action = pings(node, ['Alice', 'Bob']);
  // `@Bob` glued to Alice's name is no ping, as the routing reads it; code keeps its own look.
  expect(marked(node)).toEqual(['@Alice', '@Bob']);
  // The prose drawn again around it: the same pings, never one more.
  node.querySelector('p')!.append(' again');
  await new Promise(resolve => setTimeout(resolve));
  expect(marked(node)).toEqual(['@Alice', '@Bob']);
  action.update(['Bob']);
  expect(marked(node)).toEqual(['@Bob']);
  expect(node.textContent).toBe('@Alice@Bob and @Bob, @Alice aside again');
  action.destroy();
});
