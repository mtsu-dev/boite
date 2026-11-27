import { expect, vi } from 'vitest';
import { store } from '../lib/store.svelte';
import { openThreadExport, threadExport } from '../lib/thread-export-request.svelte';
import { test, waitFor } from '../test/app';

const { attempted } = vi.hoisted(() => ({ attempted: vi.fn() }));
vi.mock('../components/ExportThreadDialog.svelte', () => {
  attempted();
  throw new Error('Offline');
});

test('a failed export prefetch only shows an error when the dialog is requested', async ({ app: _app }) => {
  await waitFor(() => attempted.mock.calls.length > 0);
  await vi.dynamicImportSettled();
  expect(document.querySelector('[data-testid=error-toast]')).toBeNull();

  openThreadExport(store, store.openThread!);
  await waitFor(() => document.querySelector('[data-testid=error-toast]') !== null);
  expect(threadExport.request).toBeNull();
});
