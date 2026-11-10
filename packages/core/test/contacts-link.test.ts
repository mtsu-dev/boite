/**
 * A contact's link on a network that behaves badly: a slow handshake, a path
 * that goes silent, a path that is cut, and two machines whose clocks differ.
 */
import { afterEach, expect, test } from 'bun:test';
import { badNetwork, type BadNetwork } from './bad-network.ts';
import { startTestCore, waitFor, type TestCore } from './harness.ts';
import { rejection } from './settle.ts';
import { funnelFetch, publicDns } from '../src/contacts/public-dns.ts';
import { CLOCK_INPUT, dialContact, dialDated } from '../src/contacts/link-hello.ts';

const cores: TestCore[] = [];
const networks: BadNetwork[] = [];
afterEach(async () => {
  for (const network of networks.splice(0)) network.stop();
  for (const core of cores.splice(0)) await core.stop();
});

const MINUTE = 60_000;

/** A host and a guest, the guest reaching the host only through `network`. `before` runs once both know their ids, before the join. */
async function pair(options: { latencyMs?: number; before?: (host: TestCore, guest: TestCore, hostId: string) => void } = {}) {
  const host = await startTestCore();
  const guest = await startTestCore();
  cores.push(host, guest);
  const network = badNetwork(host.url, options);
  networks.push(network);
  host.core.contacts.selfUrl = async () => network.url;
  const hostClient = await host.connect();
  const guestClient = await guest.connect();
  const hostId = host.core.coordination.card().coreId;
  const guestId = guest.core.coordination.card().coreId;
  options.before?.(host, guest, hostId);
  const invite = await hostClient.call('contacts.invite', {});
  const join = () => guestClient.call('contacts.join', { link: invite.link });
  return { host, guest, hostId, guestId, network, join };
}

async function linked(options: Parameters<typeof pair>[0] = {}) {
  const made = await pair(options);
  await made.join();
  await waitFor(() => made.host.core.contacts.linked(made.guestId));
  return made;
}

/** How many links the host took since this was called. */
function links(host: TestCore): () => number {
  let count = 0;
  const attach = host.core.contacts.attach.bind(host.core.contacts);
  host.core.contacts.attach = (data, socket) => { count += 1; attach(data, socket); };
  return () => count;
}

/** The guest's link carries its own requests: the host said it answers them there. */
const duplex = (guest: TestCore, hostId: string) => waitFor(() => guest.core.coordination.bridge.available(hostId));

test('a guest asks its host on the link it holds open, with no connection of its own', async () => {
  const { host, guest, hostId, guestId, network } = await linked({ latencyMs: 5 });
  await duplex(guest, hostId);
  // Nothing new gets through: a request that needed a connection of its own would fail.
  network.down = true;
  const opened = network.opened();
  for (let round = 0; round < 3; round++) {
    await guest.core.coordination.check(hostId);
    await host.core.coordination.check(guestId);
  }
  expect(network.opened()).toBe(opened);
});

test('a guest posts to a host that does not say it answers on the link', async () => {
  const made = await pair();
  // A host from before the link carried both ways: it never sends `caps`.
  const attach = made.host.core.contacts.attach.bind(made.host.core.contacts);
  made.host.core.contacts.attach = (data, socket) => attach(data, {
    send: frame => frame.includes('"caps"') ? 0 : socket.send(frame),
    close: (code, reason) => socket.close(code, reason),
  });
  await made.join();
  await waitFor(() => made.host.core.contacts.linked(made.guestId));
  await made.guest.core.coordination.check(made.hostId);
  expect(made.guest.core.coordination.bridge.available(made.hostId)).toBe(false);
  await made.host.core.coordination.check(made.guestId);
});

test('a request the link does not carry is asked at the host\'s address', async () => {
  const { guest, hostId, host } = await linked();
  await duplex(guest, hostId);
  // The host stops answering what comes up the link, as a link gone silent one way.
  host.core.contacts.frame = () => undefined;
  await guest.core.coordination.check(hostId);
}, 20_000);

test('a guest hangs up a link whose path died without a close, and dials again at once', async () => {
  const { host, guest, hostId, guestId, network } = await linked();
  await duplex(guest, hostId);
  guest.core.contacts.links.linkBeatMs = 200;
  guest.core.contacts.links.linkDeadMs = 1000;
  const taken = links(host);
  // The path under the link dies without a close, and a new connection would pass: before the guest asked for
  // signs of life, it held this link for ever and the host's requests went nowhere.
  network.freeze();
  await waitFor(() => taken() === 1 && guest.core.contacts.linkOf(hostId) === 'connected', 8000);
  await host.core.coordination.check(guestId);
  await guest.core.coordination.check(hostId);
}, 30_000);

test('a host drops a guest that stopped giving signs of life', async () => {
  const { host, guest, hostId, guestId, network } = await linked();
  await duplex(guest, hostId);
  guest.core.contacts.links.linkBeatMs = 100;
  host.core.contacts.links.linkDeadMs = 500;
  // The guest's pings arrive first: only a guest that sends them is held to them.
  await new Promise(resolve => setTimeout(resolve, 1500));
  expect(host.core.contacts.linked(guestId)).toBe(true);
  network.silent = true;
  await waitFor(() => !host.core.contacts.linked(guestId), 8000);
}, 20_000);

test('a link that was cut is dialed again at once', async () => {
  const { host, guest, hostId, guestId, network } = await linked();
  await duplex(guest, hostId);
  const taken = links(host);
  const started = performance.now();
  network.cut();
  await waitFor(() => taken() === 1 && host.core.contacts.linked(guestId) && guest.core.contacts.linkOf(hostId) === 'connected');
  // The first wait of the backoff alone is two seconds.
  expect(performance.now() - started).toBeLessThan(1500);
});

test('a guest whose clock is minutes away joins, links and asks all the same', async () => {
  // Both cores share this process's clock: the guest is told the host's is five minutes ahead, and dates by that.
  const made = await pair({ before: (_host, guest, hostId) => { guest.core.coordination.clocks.learn(hostId, Date.now() + 5 * MINUTE); } });
  const { host, guest, hostId, guestId, network } = made;
  expect(Math.abs(guest.core.coordination.clocks.offset(hostId))).toBeGreaterThan(4 * MINUTE);
  // The join: refused once with the host's time, signed, then sent again dated by it. The invitation is still unspent.
  await made.join();
  expect(Math.abs(guest.core.coordination.clocks.offset(hostId))).toBeLessThan(5000);
  await waitFor(() => host.core.contacts.linked(guestId));
  await duplex(guest, hostId);

  // A request: the same, on the link.
  guest.core.coordination.clocks.learn(hostId, Date.now() - 5 * MINUTE);
  await guest.core.coordination.check(hostId);
  expect(Math.abs(guest.core.coordination.clocks.offset(hostId))).toBeLessThan(5000);

  // The hello of a new dial: the refusal carries the host's time, and the next dial goes at once.
  guest.core.coordination.clocks.learn(hostId, Date.now() + 5 * MINUTE);
  const taken = links(host);
  network.cut();
  await waitFor(() => taken() === 1 && host.core.contacts.linked(guestId) && guest.core.contacts.linkOf(hostId) === 'connected', 8000);
  expect(Math.abs(guest.core.coordination.clocks.offset(hostId))).toBeLessThan(5000);

  // A probe of a group move dials outside the kept link: it learns the host's time the same way.
  guest.core.coordination.clocks.learn(hostId, Date.now() + 5 * MINUTE);
  const peer = { coreId: hostId, publicKey: host.core.coordination.card().publicKey };
  const probe = await dialDated(guest.core, peer, () => guest.core.contacts.helloHeaders(hostId), headers => dialContact(guest.core, network.url, headers));
  probe.close(1000);
  expect(Math.abs(guest.core.coordination.clocks.offset(hostId))).toBeLessThan(5000);
}, 20_000);

test('a host that signs another time at each hello is dialed at the backoff\'s pace', async () => {
  const { host, guest, hostId, network } = await linked();
  await duplex(guest, hostId);
  // Each refusal teaches a new clock, hours from the last: a guest that dialed again on each one never stopped.
  let hellos = 0;
  host.core.contacts.hello = request => {
    hellos += 1;
    const now = Date.now() + (hellos % 2 === 0 ? 1 : -1) * 60 * MINUTE;
    const hello = Buffer.from(request.headers.get('x-boite-hello') ?? '', 'base64url').toString('utf8');
    const proof = host.core.coordination.signature(Buffer.from(`${CLOCK_INPUT}${hello}\n${now}`)).toString('base64');
    return new Response('forbidden', { status: 403, headers: { 'x-boite-clock': String(now), 'x-boite-clock-proof': proof } });
  };
  network.cut();
  await new Promise(resolve => setTimeout(resolve, 1500));
  // The dial after the cut, the one its refusal's clock allows, then the backoff's.
  expect(hellos).toBeGreaterThan(1);
  expect(hellos).toBeLessThan(6);
});

test('a date a minute off is still refused, and tells its sender nothing it can replay', async () => {
  const { host, guest, hostId } = await linked();
  await duplex(guest, hostId);
  // The host refuses whatever is not dated by its own clock: only the sender moves.
  const refusals: string[] = [];
  const forward = host.core.coordination.forward.bind(host.core.coordination);
  host.core.coordination.forward = async params => { const answer = await forward(params); refusals.push(`${answer.status}`); return answer; };
  guest.core.coordination.clocks.learn(hostId, Date.now() + 3 * MINUTE);
  await guest.core.coordination.check(hostId);
  expect(refusals).toEqual(['409', '200']);
});

test('a Funnel name the resolver does not know yet is asked at the address its zone gives', async () => {
  const resolve = publicDns.resolve;
  const asked: string[] = [];
  try {
    publicDns.resolve = async host => { asked.push(host); return host === 'pc.tail1234.ts.net' ? ['203.0.113.7'] : []; };
    const calls: { url: string; host: string | undefined; serverName: string | undefined }[] = [];
    const send = (async (url: string, init: RequestInit & { tls?: { serverName?: string } }) => {
      calls.push({ url, host: (init.headers as Record<string, string> | undefined)?.['host'], serverName: init.tls?.serverName });
      if (new URL(url).hostname.endsWith('.ts.net')) throw Object.assign(new TypeError('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
      return new Response('ok');
    }) as unknown as typeof fetch;
    const response = await funnelFetch('https://pc.tail1234.ts.net:8443/contacts/join', { method: 'POST', headers: { 'x-boite-peer': 'a' } }, 1000, send);
    expect(await response.text()).toBe('ok');
    // The address in the URL, the name still the one the certificate is checked against.
    expect(calls[1]).toEqual({ url: 'https://203.0.113.7:8443/contacts/join', host: 'pc.tail1234.ts.net:8443', serverName: 'pc.tail1234.ts.net' });
    // A name its zone does not know either stays not found.
    expect((await rejection(funnelFetch('https://other.tail1234.ts.net:8443/x', {}, 1000, send))).reason).toMatchObject({ code: 'ENOTFOUND' });
    expect(asked).toEqual(['pc.tail1234.ts.net', 'other.tail1234.ts.net']);
  } finally { publicDns.resolve = resolve; }
});
