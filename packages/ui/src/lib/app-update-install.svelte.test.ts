import { afterEach, expect, test, vi } from 'vitest';
import { flushSync } from 'svelte';
import { AppUpdater, type AppUpdateBackend, type UpdateSnapshot } from './app-update.svelte';
import { AppUpdateInstall } from './app-update-install.svelte';
import { confirm } from './confirm.svelte';

const ready: UpdateSnapshot = {
  phase: 'ready',
  currentVersion: '2.0.0',
  currentChannel: 'stable',
  channel: 'nightly',
  version: '2.1.0-nightly.8',
  notes: null,
  publishedAt: null,
  received: 100,
  total: 100,
  error: null,
  supported: true
};

function setup(initial: UpdateSnapshot = ready) {
  let publish!: (snapshot: UpdateSnapshot) => void;
  const backend: AppUpdateBackend = {
    status: vi.fn(async () => initial),
    check: vi.fn(async () => ready),
    download: vi.fn(async () => ready),
    install: vi.fn(async () => undefined),
    listen: vi.fn(async (handler) => {
      publish = handler;
      return () => undefined;
    })
  };
  const updater = new AppUpdater(backend, undefined, () => true);
  const stop = updater.start();
  return { backend, updater, publish: (snapshot: UpdateSnapshot) => publish(snapshot), stop };
}

afterEach(() => confirm.answer(false));

test('one pending confirmation locks every install entry point and cancel leaves the update ready', async () => {
  const { backend, updater, stop } = setup();
  await updater.settled();
  await Promise.resolve();
  const install = new AppUpdateInstall();

  const first = install.request(updater);
  flushSync();
  expect(install.preparing).toBe(true);
  await expect(install.request(updater)).resolves.toBe(false);
  confirm.answer(false);
  await expect(first).resolves.toBe(false);
  expect(install.preparing).toBe(false);
  expect(backend.install).not.toHaveBeenCalled();
  stop();
});

test('a confirmed update installs only while its ready version and channel are unchanged', async () => {
  const { backend, updater, publish, stop } = setup();
  await updater.settled();
  await Promise.resolve();
  const install = new AppUpdateInstall();

  const stale = install.request(updater);
  publish({ ...ready, channel: 'stable', version: '2.0.0' });
  flushSync();
  confirm.answer(true);
  await expect(stale).resolves.toBe(false);
  expect(backend.install).not.toHaveBeenCalled();

  publish(ready);
  flushSync();
  const current = install.request(updater);
  confirm.answer(true);
  await expect(current).resolves.toBe(true);
  expect(backend.install).toHaveBeenCalledOnce();
  stop();
});

test('a release only found downloads after the answer, then installs once verified', async () => {
  const { backend, updater, stop } = setup({ ...ready, phase: 'available', received: 0, total: null });
  await updater.settled();
  const install = new AppUpdateInstall();

  const asked = install.request(updater);
  flushSync();
  // Nothing downloads while the question is open.
  expect(backend.download).not.toHaveBeenCalled();
  confirm.answer(true);
  await expect(asked).resolves.toBe(true);
  expect(backend.download).toHaveBeenCalledOnce();
  expect(backend.install).toHaveBeenCalledOnce();
  stop();
});

test('a retryable install failure keeps the verified release available to the install button', async () => {
  const { backend, updater, publish, stop } = setup();
  try {
    const message = 'The installer could not start';
    const retry = { ...ready, error: message };
    vi.mocked(backend.install).mockImplementationOnce(async () => {
      publish(retry);
      throw new Error(message);
    });
    await updater.settled();
    vi.mocked(backend.status).mockResolvedValue(retry);
    const install = new AppUpdateInstall();
    const first = install.request(updater);
    confirm.answer(true);
    expect(await first).toBe(true);
    await updater.settled();
    expect(updater.snapshot).toMatchObject({ phase: 'ready', error: message });
    const second = install.request(updater);
    confirm.answer(true);
    expect(await second).toBe(true);
    expect(backend.install).toHaveBeenCalledTimes(2);
    expect(backend.check).not.toHaveBeenCalled();
    expect(backend.download).not.toHaveBeenCalled();
  } finally { stop(); }
});
