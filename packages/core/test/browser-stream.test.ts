import { expect } from 'bun:test';
import { BrowserStreamClose, groupRelayUrl, type RemoteStreamMessage, type RemoteStreamPage } from '@boite/contracts';
import { connect } from '../src/client.ts';
import { startTestCore, waitFor } from './harness.ts';
import { createBrowserFixture, jpegSize, picture } from './browser/fixture.ts';
import { thrown } from './settle.ts';

const browserFixture = createBrowserFixture();
const { real, url, evaluate } = browserFixture;

/** A viewer's socket: the pages and pictures it was sent, acknowledged as a viewer does unless `hold`. */
function watch(address: string, hold = false) {
  const socket = new WebSocket(address.replace(/^http/, 'ws'));
  socket.binaryType = 'arraybuffer';
  const pages: RemoteStreamPage[] = [], pictures: { jpeg: Buffer; page: RemoteStreamPage | undefined; at: number }[] = [];
  let closed: number | undefined, held = hold;
  socket.onmessage = ({ data }) => {
    if (typeof data === 'string') { const message = JSON.parse(data) as RemoteStreamMessage; if (message.type === 'page') pages.push(message.page); return; }
    pictures.push({ jpeg: Buffer.from(data as ArrayBuffer), page: pages.at(-1), at: Date.now() });
    if (!held) socket.send(JSON.stringify({ type: 'ack' }));
  };
  socket.onclose = ({ code }) => { closed = code; };
  socket.onerror = () => { closed ??= 0; };
  return {
    socket, pages, pictures,
    get closed() { return closed; },
    release() { held = false; socket.send(JSON.stringify({ type: 'ack' })); },
    size(maxWidth: number) { socket.send(JSON.stringify({ type: 'size', maxWidth })); },
  };
}
const size = (jpeg: Buffer) => jpegSize(jpeg.toString('base64'));

real('a viewer is pushed the page then its pictures on a socket of its own, at the size it shows, and its input names the page however long it rests', async () => {
  const { harness, owner, agent, threadId } = browserFixture;
  const { tabId } = await agent.call('browser.command', { threadId, action: { kind: 'open', url: url() } });
  expect(await thrown(owner.call('browser.remoteStream', { threadId, tabId }))).toThrow('subscribe');
  await owner.call('threads.subscribe', { threadId });
  expect(await thrown(owner.call('browser.remoteStream', { threadId, tabId, maxWidth: 99 }))).toThrow('maxWidth');
  expect(await thrown(owner.call('browser.remoteStream', { threadId, tabId: 'browser:none' }))).toThrow();
  // The page is drawn at twice its CSS size: a viewer on a dense screen is sent every pixel of it.
  expect(await evaluate('devicePixelRatio', tabId)).toBe(2);
  const css = await evaluate('[innerWidth, innerHeight]', tabId) as [number, number];

  const answer = await owner.call('browser.remoteStream', { threadId, tabId, maxWidth: 3840 });
  if (!('path' in answer)) throw new Error('a tab of the core\'s own Chromium is streamed');
  expect(answer.path).toMatch(/^\/browser-stream\/[A-Za-z0-9_-]{32}$/);
  const viewer = watch(harness.url + answer.path);
  await waitFor(() => viewer.pictures.length > 0, 20_000);
  expect(viewer.pages).toHaveLength(1);
  expect(viewer.pages[0]).toMatchObject({ tabId, title: 'Fixture', width: css[0], height: css[1], url: url() });
  expect(viewer.pages[0]).not.toHaveProperty('base64');
  expect(size(viewer.pictures[0]!.jpeg)).toEqual({ width: css[0] * 2, height: css[1] * 2 });
  // A ticket opens one socket, and an unknown one none.
  for (const path of [answer.path, '/browser-stream/' + 'a'.repeat(32), '/browser-stream/short']) {
    const again = watch(harness.url + path);
    await waitFor(() => again.closed !== undefined, 10_000);
    expect(again.pictures).toHaveLength(0);
  }

  // A page at rest sends nothing; its page is still the page, long after a pulled frame would have expired.
  await Bun.sleep(5600);
  const resting = viewer.pictures.length;
  const page = viewer.pages[0]!;
  await owner.call('browser.remoteInput', { threadId, frameId: page.id, input: { kind: 'tap', x: 200 / page.width, y: 140 / page.height, width: page.width, height: page.height } });
  for (let i = 0; i < 100 && await evaluate('document.title', tabId) !== 'clicked'; i++) await Bun.sleep(50);
  expect(await evaluate('document.title', tabId)).toBe('clicked');
  // The title changed: the viewer is told the page it sees now, then shown it.
  await waitFor(() => viewer.pages.length === 2 && viewer.pictures.at(-1)!.page === viewer.pages[1], 10_000);
  expect(viewer.pages[1]).toMatchObject({ title: 'clicked' });
  expect(viewer.pictures.length).toBeGreaterThan(resting);
  // Input aimed at the page before is refused once it is five seconds old, the page shown never.
  await owner.call('browser.remoteInput', { threadId, frameId: page.id, input: { kind: 'key', key: 'Tab' } });

  // The viewer shows the page smaller: the pictures follow.
  viewer.size(400);
  await waitFor(() => size(viewer.pictures.at(-1)!.jpeg).width === 400, 10_000);

  // A client from before the stream still asks for its frames, beside the stream.
  const old = await harness.connect();
  try {
    await old.call('threads.subscribe', { threadId });
    const frame = await picture(old.call('browser.remoteFrame', { threadId, tabId, maxWidth: 600, quality: 40 }));
    expect(jpegSize(frame.base64).width).toBe(600);
    expect(frame.width).toBe(css[0]);
    await old.call('browser.remoteInput', { threadId, frameId: frame.id, input: { kind: 'key', key: 'Tab' } });
  } finally { old.close(); }

  // The tab closes: so does the stream, saying why.
  await agent.call('browser.command', { threadId, tabId, action: { kind: 'close' } });
  await waitFor(() => viewer.closed !== undefined, 10_000);
  expect(viewer.closed).toBe(BrowserStreamClose.TabGone);
}, 120_000);

real('a moving page comes at the pace of the acknowledgements, a viewer that holds one back is sent nothing more, and the stream ends with its connection', async () => {
  const { harness, agent, threadId } = browserFixture;
  const { tabId } = await agent.call('browser.command', { threadId, action: { kind: 'open', url: url('/moving') } });
  const client = await harness.connect();
  await client.call('threads.subscribe', { threadId });
  const answer = await client.call('browser.remoteStream', { threadId, tabId, maxWidth: 800, quality: 60 });
  if (!('path' in answer)) throw new Error('a tab of the core\'s own Chromium is streamed');
  const viewer = watch(harness.url + answer.path);
  await waitFor(() => viewer.pictures.length > 3, 20_000);
  const from = viewer.pictures.length, started = Date.now();
  await Bun.sleep(2000);
  const rate = (viewer.pictures.length - from) / ((Date.now() - started) / 1000);
  // Each picture is acknowledged 100 ms after it came and Chromium keeps two unacknowledged: some twenty a second, never the screen's sixty.
  expect(rate).toBeGreaterThan(3);
  expect(rate).toBeLessThan(35);
  expect(size(viewer.pictures.at(-1)!.jpeg).width).toBe(800);

  // An unacknowledged picture holds the next ones back: nothing queues on a slow link.
  const held = watch(harness.url + ((await client.call('browser.remoteStream', { threadId, tabId, maxWidth: 800 })) as { path: string }).path, true);
  // The same client asked again: its first stream is replaced.
  await waitFor(() => viewer.closed !== undefined && held.pictures.length > 0, 20_000);
  expect(viewer.closed).toBe(1000);
  await Bun.sleep(1200);
  expect(held.pictures.length).toBeLessThanOrEqual(2);
  const before = held.pictures.length;
  held.release();
  await waitFor(() => held.pictures.length > before + 3, 10_000);

  // Leaving the conversation ends the stream; so does the connection going.
  await client.call('threads.unsubscribe', { threadId });
  await waitFor(() => held.closed !== undefined, 10_000);
  expect(held.closed).toBe(BrowserStreamClose.Refused);
  await client.call('threads.subscribe', { threadId });
  const last = watch(harness.url + ((await client.call('browser.remoteStream', { threadId, tabId })) as { path: string }).path);
  await waitFor(() => last.pictures.length > 0, 20_000);
  client.close();
  await waitFor(() => last.closed !== undefined, 10_000);
}, 120_000);

real('a phone paired with another member of the group is pushed the frames through it', async () => {
  const { harness: b, agent, threadId } = browserFixture;
  const a = await startTestCore();
  try {
    await a.core.group.create('Home');
    const { invite } = await a.core.group.invite();
    await b.core.group.join(invite);
    const coreId = b.core.coordination.card().coreId, relay = groupRelayUrl(a.url, coreId);
    const { tabId } = await agent.call('browser.command', { threadId, action: { kind: 'open', url: url('/moving') } });
    const phone = await connect(a.url, '', { grant: a.core.sessions.grant().grant, client: { name: 'pwa', version: '1' } });
    const { ticket } = await phone.call('group.ticket', { coreId });
    const onB = await connect(relay, '', { ticket, relay: phone.session!.token, client: { name: 'pwa', version: '1' } });
    try {
      // A paired device watches the conversation it is subscribed to, as it asks for its frames.
      await onB.call('threads.subscribe', { threadId });
      const answer = await onB.call('browser.remoteStream', { threadId, tabId, maxWidth: 800 });
      if (!('path' in answer)) throw new Error('a tab of the core\'s own Chromium is streamed');
      // The path sits under the address the phone reaches that machine at: the relay's route.
      const viewer = watch(relay + answer.path);
      await waitFor(() => viewer.pictures.length > 5, 30_000);
      expect(viewer.pages[0]).toMatchObject({ tabId, title: 'Moving' });
      expect(size(viewer.pictures.at(-1)!.jpeg).width).toBe(800);
      expect(a.core.relays.size).toBe(2);
      // Nothing but a ticket the other machine gave opens a stream through the relay.
      const unknown = watch(`${relay}/browser-stream/${'a'.repeat(32)}`);
      await waitFor(() => unknown.closed !== undefined, 10_000);
      expect(unknown.pictures).toHaveLength(0);
      // The tab closes on b: the phone hears why through a.
      await agent.call('browser.command', { threadId, tabId, action: { kind: 'close' } });
      await waitFor(() => viewer.closed !== undefined, 10_000);
      expect(viewer.closed).toBe(BrowserStreamClose.TabGone);
      await waitFor(() => a.core.relays.size === 1, 10_000);
    } finally { onB.close(); phone.close(); }
  } finally {
    await Promise.all([a.core.group.close(), b.core.group.close()]);
    await a.stop();
  }
}, 120_000);
