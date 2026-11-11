import { expect, test } from 'bun:test';
import type { StreamCdp } from '../src/browser/frames.ts';
import {
  PushStream, SCREENCAST_ACK_PACE_MS, SCREENCAST_SETTLE_MS, StreamWire, VIEWER_OUTPUT_LIMIT, type Picture,
} from '../src/browser/push-stream.ts';

const JPEG = Buffer.from('picture').toString('base64');

/** A DevTools connection that records what it is sent and lets the test play Chromium's screencast. */
function fakeCdp() {
  const sent: { method: string; params: Record<string, unknown>; at: number }[] = [];
  const listeners = new Set<(params: Record<string, unknown>, sessionId: string | undefined) => void>();
  let frames = 0;
  const cdp: StreamCdp = {
    send: async <T>(method: string, params: Record<string, unknown> = {}) => {
      sent.push({ method, params, at: Date.now() });
      if (method === 'Target.attachToTarget') return { sessionId: 'viewer' } as T;
      if (method === 'Page.captureScreenshot') return { data: Buffer.from('still').toString('base64') } as T;
      return {} as T;
    },
    on: (_method, listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return {
    cdp, sent,
    /** Chromium draws a picture. */
    draw() { const sessionId = ++frames; for (const listener of listeners) listener({ data: JPEG, sessionId }, 'viewer'); return sessionId; },
    of: (method: string) => sent.filter(one => one.method === method),
    get listening() { return listeners.size; },
  };
}

const text = (picture: Picture) => Buffer.from(picture.jpeg).toString();
const settle = () => Bun.sleep(5);

test('a stream opens with a still, hands on each picture and acknowledges it no sooner than the pace after it came', async () => {
  const chromium = fakeCdp(), taken: Picture[] = [];
  const stream = new PushStream(chromium.cdp, 'target', { maxWidth: 1280, quality: 70 }, run => run());
  stream.attach(picture => taken.push(picture));
  await stream.start();
  // A page at rest draws nothing for a new screencast: the viewer is shown a still at once.
  expect(chromium.of('Page.startScreencast').map(one => one.params)).toEqual([{ format: 'jpeg', quality: 70, maxWidth: 1280, maxHeight: 4320 }]);
  expect(taken.map(text)).toEqual(['still']);
  const drawnAt = Date.now(), id = chromium.draw();
  expect(taken.map(text)).toEqual(['still', 'picture']);
  // Not acknowledged until the viewer has it.
  await Bun.sleep(SCREENCAST_ACK_PACE_MS + 30);
  expect(chromium.of('Page.screencastFrameAck')).toHaveLength(0);
  taken[1]!.ack(); taken[1]!.ack();
  await settle();
  expect(chromium.of('Page.screencastFrameAck').map(one => one.params)).toEqual([{ sessionId: id }]);
  // Acknowledged at once by the viewer, held back for Chromium.
  const nextAt = Date.now(), next = chromium.draw();
  taken[2]!.ack();
  await settle();
  expect(chromium.of('Page.screencastFrameAck')).toHaveLength(1);
  await Bun.sleep(SCREENCAST_ACK_PACE_MS);
  const acks = chromium.of('Page.screencastFrameAck');
  expect(acks.map(one => one.params)).toEqual([{ sessionId: id }, { sessionId: next }]);
  expect(acks[1]!.at - nextAt).toBeGreaterThanOrEqual(SCREENCAST_ACK_PACE_MS - 2);
  expect(drawnAt).toBeLessThanOrEqual(nextAt);
  stream.close();
  await settle();
  expect(chromium.listening).toBe(0);
  expect(chromium.of('Target.detachFromTarget').map(one => one.params)).toEqual([{ sessionId: 'viewer' }]);
  chromium.draw();
  expect(taken).toHaveLength(3);
});

test('pictures come at half size and lighter while the viewer scrolls, and a full still follows once the page rests', async () => {
  const chromium = fakeCdp(), taken: Picture[] = [];
  const stream = new PushStream(chromium.cdp, 'target', { maxWidth: 1000, quality: 70 }, run => run());
  stream.attach(picture => { taken.push(picture); picture.ack(); });
  await stream.start();
  // A burst nobody scrolled for (an animation) stays whole.
  for (let i = 0; i < 5; i++) { chromium.draw(); await Bun.sleep(20); }
  await settle();
  expect(chromium.of('Page.startScreencast')).toHaveLength(1);
  await Bun.sleep(SCREENCAST_SETTLE_MS + 150);
  const before = taken.length;
  stream.scrolledAt = Date.now();
  for (let i = 0; i < 5; i++) { chromium.draw(); await Bun.sleep(20); }
  await settle();
  expect(chromium.of('Page.startScreencast').at(-1)!.params).toEqual({ format: 'jpeg', quality: 50, maxWidth: 500, maxHeight: 2160 });
  expect(taken.length).toBe(before + 5);
  // Nothing more is drawn: the screencast goes back to full size and the page is shown whole.
  await Bun.sleep(SCREENCAST_SETTLE_MS + 80);
  expect(chromium.of('Page.startScreencast').at(-1)!.params).toEqual({ format: 'jpeg', quality: 70, maxWidth: 1000, maxHeight: 4320 });
  expect(text(taken.at(-1)!)).toBe('still');
  expect(chromium.of('Page.captureScreenshot').at(-1)!.params).toEqual({ format: 'jpeg', quality: 70 });
  // Another width asked by the viewer restarts the screencast at it.
  stream.resize(640);
  await settle();
  expect(chromium.of('Page.startScreencast').at(-1)!.params).toMatchObject({ maxWidth: 640 });
  stream.close();
});

test('pictures wait for a viewer up to the limit; one past it is dropped and acknowledged', async () => {
  const chromium = fakeCdp();
  const stream = new PushStream(chromium.cdp, 'target', { maxWidth: 1280, quality: 70 }, run => run());
  await stream.start();
  for (let i = 0; i < VIEWER_OUTPUT_LIMIT + 1; i++) chromium.draw();
  await Bun.sleep(SCREENCAST_ACK_PACE_MS + 30);
  // The still took one place, so two pictures found the queue full.
  expect(chromium.of('Page.screencastFrameAck').map(one => one.params)).toEqual([{ sessionId: VIEWER_OUTPUT_LIMIT }, { sessionId: VIEWER_OUTPUT_LIMIT + 1 }]);
  const taken: Picture[] = [];
  stream.attach(picture => taken.push(picture));
  expect(taken).toHaveLength(VIEWER_OUTPUT_LIMIT);
  stream.close();
});

test('one picture is on the wire at a time and only the newest waits behind it', () => {
  const written: string[] = [], acked: string[] = [];
  const wire = new StreamWire(picture => written.push(text(picture)));
  const picture = (name: string): Picture => ({ jpeg: Buffer.from(name), ack: () => acked.push(name) });
  wire.offer(picture('a')); wire.offer(picture('b')); wire.offer(picture('c')); wire.offer(picture('d'));
  expect(written).toEqual(['a']);
  // Never sent, yet Chromium is released for them.
  expect(acked).toEqual(['b', 'c']);
  wire.acked();
  expect(written).toEqual(['a', 'd']);
  expect(acked).toEqual(['b', 'c', 'a']);
  wire.offer(picture('e'));
  wire.close();
  expect(acked).toEqual(['b', 'c', 'a', 'd', 'e']);
  expect(written).toEqual(['a', 'd']);
});
