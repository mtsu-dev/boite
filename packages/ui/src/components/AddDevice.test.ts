import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import { fill, strings } from '../lib/strings';
import AddDevice from './AddDevice.svelte';

let component: ReturnType<typeof mount> | undefined;
const opened: Store[] = [];

afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  for (const store of opened.splice(0)) { store.client?.close(); store.detach(); }
  document.body.innerHTML = '';
});

const one = <T extends HTMLElement>(testid: string) => document.querySelector<T>(`[data-testid="${testid}"]`);

/** A machine with no HTTPS address, on a tailnet: its link names its MagicDNS name over plain HTTP. */
async function drawn(): Promise<Store> {
  const store = new Store();
  store.attach(new FakeClient({ delayMs: 0, principal: 'owner' }));
  await store.connect();
  opened.push(store);
  await store.addDevice();
  component = mount(AddDevice, { target: document.body, props: { store } });
  flushSync();
  return store;
}

test('a machine with no HTTPS address names its MagicDNS name, and turns on HTTPS through a ready Tailscale in one click', async () => {
  const store = await drawn();
  expect(one<HTMLInputElement>('add-device-link')!.value).toMatch(/^http:\/\/boite-pc\.tail0d6070\.ts\.net:8777\/\?grant=/);
  await vi.waitFor(() => { flushSync(); expect(one('add-device-tailscale-enable')).not.toBeNull(); });
  expect(one('add-device-tailscale')!.textContent).toContain(fill(strings.group.tailscale.hint, { url: 'https://boite-pc.tail0d6070.ts.net' }));
  const call = vi.spyOn(store.client!, 'call');
  one<HTMLButtonElement>('add-device-tailscale-enable')!.click();
  // A new link through the HTTPS address, and the action is gone with the plain HTTP one.
  await vi.waitFor(() => { flushSync(); expect(one<HTMLInputElement>('add-device-link')!.value).toMatch(/^https:\/\/boite-pc\.tail0d6070\.ts\.net\/\?grant=/); });
  expect(call).toHaveBeenCalledWith('tailscale.enable', { replace: false });
  expect(one('add-device-tailscale')).toBeNull();
});

test('a link that is already HTTPS asks Tailscale nothing, and only the owner is offered the switch', async () => {
  const store = new Store();
  store.attach(new FakeClient({ delayMs: 0, principal: 'owner' }));
  await store.connect();
  opened.push(store);
  expect(await store.saveSettings({ publicUrl: 'https://boite.example.com' })).toBe(true);
  const call = vi.spyOn(store.client!, 'call');
  await store.addDevice();
  component = mount(AddDevice, { target: document.body, props: { store } });
  flushSync();
  await Promise.resolve();
  expect(one<HTMLInputElement>('add-device-link')!.value).toMatch(/^https:\/\/boite\.example\.com\/\?grant=/);
  expect(call).not.toHaveBeenCalledWith('tailscale.status', expect.anything());
  expect(one('add-device-tailscale')).toBeNull();
  await unmount(component);
  component = undefined;

  // A paired phone holds a link to show, but the switch is the owner's: it asks nothing.
  const device = new Store();
  device.attach(new FakeClient({ delayMs: 0, principal: 'session' }));
  await device.connect();
  opened.push(device);
  const asked = vi.spyOn(device.client!, 'call');
  device.deviceInvite = { url: 'http://boite-pc.tail0d6070.ts.net:8777/?grant=device-test-grant', expiresAt: Date.now() + 60_000 };
  component = mount(AddDevice, { target: document.body, props: { store: device } });
  flushSync();
  await Promise.resolve();
  expect(one('add-device')).not.toBeNull();
  expect(asked).not.toHaveBeenCalledWith('tailscale.status', expect.anything());
  expect(one('add-device-tailscale')).toBeNull();
});
