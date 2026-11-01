import { afterEach, expect, test, vi } from 'vitest';
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
