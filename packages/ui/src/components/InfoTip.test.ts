import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import InfoTip from './InfoTip.svelte';

let running: Record<string, unknown> | null = null;

afterEach(() => {
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
});

function mountTip(): HTMLButtonElement {
  const target = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  document.body.append(target);
  running = mount(InfoTip, { target, props: { topic: 'Notifications', text: 'A toast when a thread finishes.' } });
  target.append(input);
  flushSync();
  return document.querySelector<HTMLButtonElement>('[data-testid=info-tip]')!;
}

/** jsdom has no PointerEvent constructor; the component only reads `pointerType`. */
function pointer(node: Element, type: string, pointerType: string): void {
  const event = new Event(type, { bubbles: type === 'pointerdown' });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  node.dispatchEvent(event);
  flushSync();
}

const bubble = () => document.querySelector('[data-testid=info-tip-text]');

test('names what it explains and shows nothing until asked', () => {
  const button = mountTip();
  expect(button.getAttribute('aria-label')).toBe('About Notifications');
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(bubble()).toBeNull();
});

test('a mouse shows it on hover and hides it on leave', () => {
  const button = mountTip();
  pointer(button, 'pointerenter', 'mouse');
  expect(bubble()?.textContent).toBe('A toast when a thread finishes.');
  expect(bubble()?.getAttribute('role')).toBe('tooltip');
  expect(button.getAttribute('aria-describedby')).toBe(bubble()?.id);
  pointer(button, 'pointerleave', 'mouse');
  expect(button.getAttribute('aria-expanded')).toBe('false');
});

test('a tap pins it open without flipping the switch in its label, a press elsewhere closes it', () => {
  const button = mountTip();
  const input = document.querySelector<HTMLInputElement>('input')!;
  pointer(button, 'pointerenter', 'touch');
  expect(bubble()).toBeNull();
  button.click();
  flushSync();
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(input.checked).toBe(false);
  // A pinned tip survives the pointer leaving.
  pointer(button, 'pointerleave', 'mouse');
  expect(button.getAttribute('aria-expanded')).toBe('true');
  pointer(document.body, 'pointerdown', 'touch');
  expect(button.getAttribute('aria-expanded')).toBe('false');
});

test('Escape closes it and gives the focus back to the button', () => {
  const button = mountTip();
  button.click();
  flushSync();
  expect(button.getAttribute('aria-expanded')).toBe('true');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  flushSync();
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(button);
  // A second click opens it again.
  button.click();
  flushSync();
  expect(button.getAttribute('aria-expanded')).toBe('true');
});

test("a settings card's title tip says what its rows' tips say, so one \"i\" serves the section", () => {
  const card = document.createElement('section');
  card.className = 'card';
  const settings = document.createElement('div');
  settings.className = 'settings';
  settings.append(card);
  document.body.append(settings);
  const title = document.createElement('h2');
  const row = document.createElement('label');
  card.append(title, row);
  const rowTip = mount(InfoTip, { target: row, props: { topic: 'Notifications', text: 'A toast when a thread finishes.' } });
  running = mount(InfoTip, { target: title, props: { topic: 'Conversations', text: '', testid: 'section-info' } });
  flushSync();
  const section = document.querySelector<HTMLButtonElement>('[data-testid=section-info]')!;
  expect(section.hasAttribute('data-gather')).toBe(true);
  expect(section.hidden).toBe(false);
  // The row's own "i" carries what it says, for app.css to hide and the title's to read.
  expect(row.querySelector('.info-tip')?.getAttribute('data-tip-text')).toBe('A toast when a thread finishes.');
  pointer(section, 'pointerenter', 'mouse');
  expect(document.querySelector('[data-testid=section-info-text]')?.textContent).toBe('Notifications A toast when a thread finishes.');
  unmount(rowTip);
});
