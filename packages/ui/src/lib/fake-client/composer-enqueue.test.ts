import { expect } from 'vitest';
import { RpcErrorCode } from '@boite/contracts';
import { test } from '../../test/fake-client';

test('composer.enqueue rejects what the core rejects, with the core code, and queues nothing', async ({ ready }) => {
  const { client } = await ready({ delayMs: 0 });
  const queued = async () => (await client.call('composer.list', {})).flatMap((row) => row.value?.input?.queued ?? []).length;
  const before = await queued();
  // Mistyped fields fail the core's type checks: InvalidParams, before any lookup. Undefined and 12345678 read as
  // nine and eight URL-safe characters once a pattern test turns them into strings.
  for (const params of [{ clientRequestId: undefined }, { clientRequestId: 12345678 }, { threadId: 7 }, { prompt: 42 }, { prompt: '  ' }]) {
    await expect(client.call('composer.enqueue', { threadId: 't-trace', prompt: 'hello', clientRequestId: 'request-1', ...params } as never)).rejects.toMatchObject({ code: RpcErrorCode.InvalidParams });
  }
  // A string the pattern refuses stays the refusal it was.
  for (const clientRequestId of ['short', 'not url safe!', 'x'.repeat(129)]) {
    await expect(client.call('composer.enqueue', { threadId: 't-trace', prompt: 'hello', clientRequestId })).rejects.toMatchObject({ code: RpcErrorCode.Refused });
  }
  expect(await queued()).toBe(before);
});
