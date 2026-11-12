import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AgentAvatar from './AgentAvatar.svelte';
import source from './AgentAvatar.svelte?raw';

let mounted: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted, { outro: false });
  mounted = undefined;
  document.body.innerHTML = '';
  document.head.querySelector('style[data-avatar-rules]')?.remove();
});

/** The component's own rules, `:global(...)` unwrapped, so jsdom's cascade applies them to the mounted picture. */
function avatarRules(): void {
  const css = source.match(/<style>([\s\S]*)<\/style>/)![1]!;
  let plain = '';
  for (let at = 0; at < css.length;) {
    if (!css.startsWith(':global(', at)) { plain += css[at++]; continue; }
    let depth = 1, end = at + ':global('.length;
    for (; depth > 0; end++) depth += css[end] === '(' ? 1 : css[end] === ')' ? -1 : 0;
    plain += css.slice(at + ':global('.length, end - 1);
    at = end;
  }
  const style = document.createElement('style');
  style.dataset['avatarRules'] = '';
  style.textContent = plain;
  document.head.append(style);
}

test('a picture grey at rest leaves its ring its hue: no filter over the ring, the letters on the disc still grey', () => {
  avatarRules();
  // At work in a list: not lit, so grey, and the ring says the work in the accent.
  mounted = mount(AgentAvatar, { target: document.body, props: { kind: 'profile', id: 'a1', name: 'Ada', avatar: 'AB', ring: true, mood: 'working' } });
  flushSync();
  const picture = document.querySelector<HTMLElement>('.agent-avatar')!;
  expect(picture.dataset['ring']).toBe('working');
  expect(picture.hasAttribute('data-lit')).toBe(false);
  // A filter greys every descendant, so none may sit on the ring or any of its ancestors.
  for (let node: Element | null = picture.querySelector('.avatar-ring'); node; node = node.parentElement) {
    expect(getComputedStyle(node).filter, node.getAttribute('class') ?? node.tagName).toBe('none');
  }
  expect(getComputedStyle(picture.querySelector('.ui-label')!).filter).not.toBe('none');
});
