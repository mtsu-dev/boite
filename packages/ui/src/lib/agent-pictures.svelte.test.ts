import { afterEach, expect, test, vi } from 'vitest';
import { flushSync } from 'svelte';
import { agentPictures, pictureSources } from './agent-pictures.svelte';
import type { Store } from './store.svelte';

afterEach(() => { pictureSources(() => []); });

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** A connected machine that holds `held`, or nothing. */
function machine(held: string | null) {
  const call = vi.fn(async (_method: string, params: { avatar: string }) => {
    if (params.avatar !== held) throw new Error('not found');
    return { dataUrl: PNG };
  });
  return { store: { client: { call }, connection: 'ready' } as unknown as Store, call };
}

test('a picture no machine held is asked of a machine that connects after the miss, without waiting a minute', async () => {
  const avatar = 'img:00112233aabbccdd';
  const desk = machine(null);
  const sources: Store[] = [desk.store];
  pictureSources(() => sources);

  await agentPictures.load(avatar);
  expect(agentPictures.url(avatar)).toBeNull();
  expect(agentPictures.missing[avatar]).toBeTypeOf('number');
  // Drawn again with the same machines: not asked again before the retry delay.
  await agentPictures.load(avatar);
  expect(desk.call).toHaveBeenCalledTimes(1);

  const pc = machine(avatar);
  sources.push(pc.store);
  await agentPictures.load(avatar);
  expect(pc.call).toHaveBeenCalledTimes(1);
  expect(agentPictures.url(avatar)).toBe(PNG);
  expect(agentPictures.missing[avatar]).toBeUndefined();
});

test('an avatar drawn while a fetch runs asks the machine that connected meanwhile once that fetch misses', async () => {
  const avatar = 'img:44556677eeff0011';
  let miss: () => void = () => {};
  const call = vi.fn(() => new Promise<never>((_resolve, reject) => { miss = () => reject(new Error('not found')); }));
  const desk = { client: { call }, connection: 'ready' } as unknown as Store;
  const pc = machine(avatar);
  const sources = $state<Store[]>([desk]);
  pictureSources(() => sources);

  // As AgentAvatar draws it: an effect that loads the picture.
  const stop = $effect.root(() => { $effect(() => { void agentPictures.load(avatar); }); });
  try {
    flushSync();
    expect(call).toHaveBeenCalledTimes(1);
    sources.push(pc.store);
    flushSync();
    expect(pc.call).not.toHaveBeenCalled();
    miss();
    await vi.waitFor(() => expect(agentPictures.url(avatar)).toBe(PNG));
    expect(pc.call).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});
