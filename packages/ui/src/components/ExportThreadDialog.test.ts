import { expect, onTestFinished, vi } from 'vitest';
import { store } from '../lib/store.svelte';
import { query, test, waitFor } from '../test/app';

const dialog = '[data-testid=thread-export-dialog]';
const trigger = '[data-testid=thread-menu-trigger]';

function button(label: string): HTMLButtonElement {
  const found = [...query(dialog).querySelectorAll('button')].find(entry => entry.textContent?.trim() === label);
  if (!found) throw new Error(`Button ${label} was not offered`);
  return found;
}

function mockDialogMethods(): () => void {
  const prototype = HTMLDialogElement.prototype;
  const original = Object.getOwnPropertyDescriptors(prototype);
  Object.defineProperties(prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
  return () => {
    for (const method of ['showModal', 'close'] as const) {
      const descriptor = original[method];
      if (descriptor) Object.defineProperty(prototype, method, descriptor);
      else Reflect.deleteProperty(prototype, method);
    }
  };
}

test('the header menu opens export, downloads the chosen format and restores focus', async ({ app: _app }) => {
  onTestFinished(mockDialogMethods());
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  const blobs: (Blob | MediaSource)[] = [];
  URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:thread-export'; };
  URL.revokeObjectURL = vi.fn();
  let filename = '';
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
  onTestFinished(() => { URL.createObjectURL = create; URL.revokeObjectURL = revoke; vi.restoreAllMocks(); });

  await store.open('t-trace');
  const menu = query<HTMLButtonElement>(trigger);
  menu.focus();
  menu.click();
  const item = '[data-testid=thread-menu-trigger-menu] [data-value=export-thread]';
  await waitFor(() => !!document.querySelector(item));
  query<HTMLButtonElement>(item).click();
  await waitFor(() => document.querySelector<HTMLDialogElement>(dialog)?.open === true);

  const includes = [...query(dialog).querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
  expect(includes.map(input => input.checked)).toEqual([false, false, false]);
  includes[0]!.click();
  includes[1]!.click();
  includes[2]!.click();
  query<HTMLInputElement>(`${dialog} input[value=html]`).click();
  await waitFor(() => !query(dialog).textContent?.includes('Copy Markdown'));
  const history = vi.spyOn(store, 'threadExportMessages');
  button('Download').click();
  await waitFor(() => filename.endsWith('.html') && !document.querySelector(dialog));
  expect(history).toHaveBeenCalledWith('t-trace', { format: 'html', includeTools: true, includeDiffs: true, includeThinking: true }, expect.any(AbortSignal));
  const blob = blobs[0];
  expect(blob).toBeInstanceOf(Blob);
  if (!(blob instanceof Blob)) throw new Error('No export Blob was created');
  expect(blob.type).toBe('text/html;charset=utf-8');
  expect(await blob.text()).toContain('<summary>Thinking</summary>');
  expect(document.activeElement).toBe(menu);
});

test('the palette opens export and copies the Markdown conversation', async ({ app: _app }) => {
  onTestFinished(mockDialogMethods());
  onTestFinished(() => { vi.restoreAllMocks(); });
  await store.open('t-trace');
  const copy = vi.spyOn(store, 'copy').mockResolvedValue(true);
  store.paletteOpen = true;
  await waitFor(() => !!document.querySelector('[data-testid=palette-input]'));
  const input = query<HTMLInputElement>('[data-testid=palette-input]');
  input.value = 'Export conversation';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => !![...document.querySelectorAll('[role=option]')].find(entry => entry.textContent?.includes('Export conversation')));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await waitFor(() => document.querySelector<HTMLDialogElement>(dialog)?.open === true);
  query<HTMLInputElement>(`${dialog} input[type=checkbox]`).click();
  const history = vi.spyOn(store, 'threadExportMessages');
  button('Copy Markdown').click();
  await waitFor(() => copy.mock.calls.length === 1 && !document.querySelector(dialog));
  expect(history).toHaveBeenCalledWith('t-trace', { format: 'markdown', includeTools: true, includeDiffs: false, includeThinking: false }, expect.any(AbortSignal));
  expect(copy.mock.calls[0]?.[0]).toMatch(/^# .+\n/);
  expect(copy.mock.calls[0]?.[0]).not.toContain('<summary>Thinking</summary>');
});

test('a rejected clipboard write keeps the export dialog open and allows retry', async ({ app: _app }) => {
  onTestFinished(mockDialogMethods());
  const writeText = vi.fn().mockRejectedValueOnce(new Error('Denied')).mockResolvedValue(undefined);
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  onTestFinished(() => {
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  });
  await store.open('t-trace');
  query<HTMLButtonElement>(trigger).click();
  const item = '[data-testid=thread-menu-trigger-menu] [data-value=export-thread]';
  await waitFor(() => !!document.querySelector(item));
  query<HTMLButtonElement>(item).click();
  await waitFor(() => document.querySelector<HTMLDialogElement>(dialog)?.open === true);
  button('Copy Markdown').click();
  await waitFor(() => writeText.mock.calls.length === 1 && document.querySelector(dialog)?.getAttribute('aria-busy') !== 'true');
  expect(query(dialog).querySelector('[role=alert]')?.textContent).toMatch(/clipboard/i);
  expect(button('Download').disabled).toBe(false);
  button('Copy Markdown').click();
  await waitFor(() => writeText.mock.calls.length === 2 && !document.querySelector(dialog));
});

test('copy fallback selects text inside the export dialog after its button loses focus', async ({ app: _app }) => {
  onTestFinished(mockDialogMethods());
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const execCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  const copy = vi.fn(() => document.activeElement?.closest(dialog) !== null);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: copy });
  onTestFinished(() => {
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
    if (execCommand) Object.defineProperty(document, 'execCommand', execCommand);
    else Reflect.deleteProperty(document, 'execCommand');
  });
  await store.open('t-trace');
  query<HTMLButtonElement>(trigger).click();
  const item = '[data-testid=thread-menu-trigger-menu] [data-value=export-thread]';
  await waitFor(() => !!document.querySelector(item));
  query<HTMLButtonElement>(item).click();
  await waitFor(() => document.querySelector<HTMLDialogElement>(dialog)?.open === true);
  const buttonToCopy = button('Copy Markdown');
  buttonToCopy.focus();
  buttonToCopy.click();
  buttonToCopy.blur();
  expect(document.activeElement).toBe(document.body);
  await waitFor(() => copy.mock.calls.length === 1);
  expect(copy).toHaveReturnedWith(true);
  await waitFor(() => !document.querySelector(dialog));
});

test('retrying clipboard copy reuses the fetched export without re-reading history', async ({ app: _app }) => {
  onTestFinished(mockDialogMethods());
  const writeText = vi.fn().mockRejectedValueOnce(new Error('Denied')).mockResolvedValue(undefined);
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  onTestFinished(() => {
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  });
  await store.open('t-trace');
  const history = vi.spyOn(store, 'threadExportMessages');
  query<HTMLButtonElement>(trigger).click();
  const item = '[data-testid=thread-menu-trigger-menu] [data-value=export-thread]';
  await waitFor(() => !!document.querySelector(item));
  query<HTMLButtonElement>(item).click();
  await waitFor(() => document.querySelector<HTMLDialogElement>(dialog)?.open === true);
  button('Copy Markdown').click();
  await waitFor(() => writeText.mock.calls.length === 1 && document.querySelector(dialog)?.getAttribute('aria-busy') !== 'true');
  expect(history).toHaveBeenCalledTimes(1);
  button('Copy Markdown').click();
  await waitFor(() => writeText.mock.calls.length === 2 && !document.querySelector(dialog));
  expect(history).toHaveBeenCalledTimes(1);
});
