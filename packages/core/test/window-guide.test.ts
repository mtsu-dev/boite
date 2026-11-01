import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { AGENT_ENV, type MessagePart, type WindowPointerLook } from '@boite/contracts';
import { runCli } from '../src/cli.ts';
import { connect, type CoreClient } from '../src/client.ts';
import type { NativeControl, NativeWindow, ScreenRect, WindowCapture, WindowGuide } from '../src/platform/types.ts';
import { goneError } from '../src/platform/window-pixels.ts';
import { DesktopWindows } from '../src/windows/service.ts';
import { echoThread, startTestCore, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';

const UNITY = 'C:\\Program Files\\Unity\\Hub\\Editor\\6000.0\\Editor\\Unity.exe';
const FOLLOW_MS = 10;

function win(id: string, overrides: Partial<NativeWindow> = {}): NativeWindow {
  return { id, pid: Number(id), path: UNITY, process: 'Unity.exe', title: `Scene ${id}`, className: 'UnityContainerWndClass', width: 400, height: 300, minimized: false, ...overrides };
}

const control = (type: string, name: string, left: number, top: number, automationId = ''): NativeControl =>
  ({ type, name, automationId, rect: { left, top, width: 40, height: 20 } });

/**
 * A desktop the test edits: windows, where each lies on the screen, their
 * controls in screen pixels and the mouse. The boxes are what the desktop app
 * is told to draw (`windows.pointer`).
 */
function fakeDesktop() {
  const windows = [win('101'), win('202', { path: 'C:\\Tools\\KeePass\\KeePass.exe', process: 'KeePass.exe' })];
  const frames = new Map<string, { rect: ScreenRect; minimized: boolean; above: boolean }>([
    ['101', { rect: { left: 1000, top: 500, width: 400, height: 300 }, minimized: false, above: false }],
    ['202', { rect: { left: 0, top: 0, width: 400, height: 300 }, minimized: false, above: false }],
  ]);
  const controls: NativeControl[] = [
    control('MenuItem', 'File', 1004, 504),
    control('MenuItem', 'Edit', 1048, 504),
    control('Button', 'Play', 1200, 530, 'PlayButton'),
    control('Button', 'Play Mode Options', 1244, 530),
    // Scrolled out of the window, though its provider says it is on screen.
    control('ListItem', 'Hidden asset', 1000, 900),
  ];
  const mouse = { pressed: false, x: 0, y: 0 };
  /**
   * The control a box follows, as its app answers: a rectangle, out of view,
   * or null once the app dropped it. Dropping it ends every element held so
   * far, as a re-rendered row does; it is found again once it has a rectangle.
   */
  const live = { rect: null as ScreenRect | 'hidden' | null, generation: 0, held: 0, asked: [] as NativeControl[] };
  const drop = () => { live.rect = null; live.generation += 1; };
  const capture: WindowCapture = {
    list: async () => windows.map(window => ({ ...window, minimized: frames.get(window.id)?.minimized ?? window.minimized })),
    capture: async id => { throw goneError(id); },
    frames: id => ({ next: async () => { throw goneError(id); }, close: () => {} }),
  };
  const guide: WindowGuide = {
    controls: async (id, limit) => {
      if (!frames.has(id)) throw new Error('the window closed during the read');
      return { controls: id === '101' ? controls.slice(0, limit) : [], total: id === '101' ? controls.length : 0 };
    },
    frame: id => {
      const frame = frames.get(id);
      return frame ? { rect: { ...frame.rect }, minimized: frame.minimized, above: frame.above } : null;
    },
    mouse: () => ({ ...mouse }),
    track: async (_id, wanted) => {
      live.asked.push(wanted);
      if (live.rect === null) return null;
      const generation = live.generation;
      let held = true;
      live.held += 1;
      return {
        rect: () => !held || generation !== live.generation || live.rect === null ? 'gone' : typeof live.rect === 'string' ? live.rect : { ...live.rect },
        release: () => { if (held) live.held -= 1; held = false; },
      };
    },
  };
  return { windows, frames, mouse, capture, guide, live, drop };
}

/** Retries an assertion until it holds: the box events reach the desktop app's socket, not the caller's. */
async function eventually(check: () => void, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { check(); return; } catch (error) { if (Date.now() > deadline) throw error; }
    await Bun.sleep(5);
  }
}

describe('window guide', () => {
  let harness: TestCore, owner: CoreClient, agent: CoreClient, app: CoreClient, threadId: string, desk: ReturnType<typeof fakeDesktop>;
  /** Each box the desktop app was told about, in order: where it is now, null once hidden or taken away. */
  let boxes: { id: string; rect: ScreenRect | null; label: string; look: WindowPointerLook }[];

  beforeEach(async () => {
    harness = await startTestCore();
    owner = await harness.connect();
    ({ threadId } = await echoThread(harness, owner));
    agent = await connect(harness.url, harness.core.agents.tokenFor(threadId), { client: { name: 'boite-cli', version: 'test' } });
    desk = fakeDesktop();
    // The desktop app of this machine: the core sends it the boxes to draw.
    app = await connect(harness.url, harness.token, { client: { name: 'shell', version: 'test' } });
    boxes = [];
    app.on('windows.pointer', box => {
      const known = boxes.find(entry => entry.id === box.id);
      if (known) Object.assign(known, box); else boxes.push({ ...box });
    });
    const core = harness.core as { windows: DesktopWindows };
    core.windows.stop();
    core.windows = new DesktopWindows(harness.core, {
      backend: async () => desk.capture, guide: async () => desk.guide, consentTimeoutMs: 60_000,
      tempRoot: join(harness.dataDir, 'window-temp'), guideTiming: { followMs: FOLLOW_MS, mouseMs: 5 },
    });
    await owner.call('threads.subscribe', { threadId });
    const finished = owner.next('turn.finished', turn => turn.threadId === threadId, 10_000);
    await owner.call('turns.start', { threadId, prompt: 'hello' });
    await finished;
  });

  afterEach(async () => {
    agent.close();
    app.close();
    owner.close();
    await harness.stop();
  });

  /** Answers the next consent card, which must ask to read Unity. */
  const answer = (choice: 'once' | 'always' | 'refuse') => owner.next('message.started', message => message.parts[0]?.type === 'window_consent', 5000).then(message => {
    const part = message.parts[0] as Extract<MessagePart, { type: 'window_consent' }>;
    expect(part).toMatchObject({ kind: 'read', process: 'Unity.exe', path: UNITY, answer: null });
    return owner.call('windows.consent', { threadId, requestId: part.requestId, answer: choice });
  });

  test('read asks to read the app, numbers its controls in window pixels and keeps those inside the window', async () => {
    const answered = answer('always');
    const read = await agent.call('windows.read', { threadId, target: { process: 'unity' } });
    await answered;
    expect(read).toEqual({
      windowId: '101', process: 'Unity.exe', total: 4,
      controls: [
        { id: 1, type: 'MenuItem', name: 'File', x: 4, y: 4, width: 40, height: 20 },
        { id: 2, type: 'MenuItem', name: 'Edit', x: 48, y: 4, width: 40, height: 20 },
        { id: 3, type: 'Button', name: 'Play', automationId: 'PlayButton', x: 200, y: 30, width: 40, height: 20 },
        { id: 4, type: 'Button', name: 'Play Mode Options', x: 244, y: 30, width: 40, height: 20 },
      ],
    });
    // The app is allowed now: a filtered, limited read asks nothing more.
    expect(await agent.call('windows.read', { threadId, target: { id: '101' }, filter: 'PLAY', limit: 1 }))
      .toMatchObject({ total: 2, controls: [{ id: 3, name: 'Play' }] });
    expect(await thrown(agent.call('windows.read', { threadId, target: { id: '101' }, limit: 0 }))).toThrow('limit must be a whole number from 1 to 400');
    expect(await thrown(agent.call('windows.read', { threadId, target: { id: '202' } }))).toThrow('KeePass.exe is never captured');
  });

  test('point draws over a control of the last read, by id or by name, and replaces the previous box', async () => {
    expect(await thrown(agent.call('windows.point', { threadId, control: 1 }))).toThrow('nothing was read in this conversation yet');
    const answered = answer('once');
    await agent.call('windows.read', { threadId, target: { id: '101' } });
    await answered;
    const { pointer } = await agent.call('windows.point', { threadId, control: 3 });
    expect(pointer).toMatchObject({ windowId: '101', label: 'Play', x: 200, y: 30, width: 40, height: 20, control: { type: 'Button', name: 'Play' } });
    await eventually(() => expect(boxes).toMatchObject([{ rect: { left: 1200, top: 530, width: 40, height: 20 }, label: 'Play' }]));
    expect(await thrown(agent.call('windows.point', { threadId, control: 9 }))).toThrow('#9 is not among the 4 controls of the last read');

    // "Play" is exact and wins over "Play Mode Options"; "pla" matches both and is refused with their ids.
    const again = answer('once');
    const named = await agent.call('windows.point', { threadId, target: { id: '101' }, name: 'play', label: 'Press Play', shape: 'round', pad: 12 });
    await again;
    expect(named.pointer).toMatchObject({ label: 'Press Play', control: { name: 'Play' }, look: { shape: 'round', pad: 12 } });
    await eventually(() => expect(boxes.at(-1)!.look).toEqual({ shape: 'round', pad: 12 }));
    await eventually(() => expect(boxes.map(box => [box.label, box.rect !== null])).toEqual([['Play', false], ['Press Play', true]]));
    const ambiguous = answer('once');
    expect(await thrown(agent.call('windows.point', { threadId, target: { id: '101' }, name: 'pla' }))).toThrow('2 controls of Unity.exe match "pla"; point at one by id:\n  #3 Button "Play"\n  #4 Button "Play Mode Options"');
    await ambiguous;
    expect(await thrown(agent.call('windows.point', { threadId, control: 3, name: 'Play' }))).toThrow('exactly one of control, name or at');

    expect(await agent.call('windows.unpoint', { threadId })).toEqual({ cleared: true });
    await eventually(() => expect(boxes.every(box => box.rect === null)).toBe(true));
    expect(await agent.call('windows.unpoint', { threadId })).toEqual({ cleared: false });
  });

  test('a rectangle reads nothing, so it asks nothing; the box follows its window and goes with it', async () => {
    const cards = () => harness.core.journal.listMessages(threadId).flatMap(message => message.parts).filter(part => part.type === 'window_consent');
    const { pointer } = await agent.call('windows.point', { threadId, target: { id: '101' }, at: { x: 0.5, y: 0, width: 0.25, height: 0.1, unit: 'fraction' }, label: 'Scene view' });
    expect(cards()).toEqual([]);
    expect(pointer).toMatchObject({ x: 200, y: 0, width: 100, height: 30, label: 'Scene view' });
    expect(pointer.control).toBeUndefined();
    await eventually(() => expect(boxes[0]!.rect).toEqual({ left: 1200, top: 500, width: 100, height: 30 }));
    expect(await thrown(agent.call('windows.point', { threadId, target: { id: '202' }, at: { x: 0, y: 0, width: 10, height: 10, unit: 'px' } }))).toThrow('KeePass.exe is never captured');

    desk.frames.get('101')!.rect = { left: 10, top: 20, width: 400, height: 300 };
    await eventually(() => expect(boxes[0]!.rect).toEqual({ left: 210, top: 20, width: 100, height: 30 }));
    desk.frames.get('101')!.minimized = true;
    await eventually(() => expect(boxes[0]!.rect).toBeNull());
    desk.frames.get('101')!.minimized = false;
    await eventually(() => expect(boxes[0]!.rect).toEqual({ left: 210, top: 20, width: 100, height: 30 }));

    const waiting = agent.call('windows.waitClick', { threadId, timeoutSeconds: 5 });
    await Bun.sleep(20);
    desk.frames.delete('101');
    expect(await waiting).toEqual({ clicked: false, reason: 'gone' });
    await eventually(() => expect(boxes[0]!.rect).toBeNull());
  });

  test('a box on a control follows it as the window scrolls, hides out of view, and finds it again once the app re-renders it', async () => {
    const answered = answer('once');
    await agent.call('windows.read', { threadId, target: { id: '101' } });
    await answered;
    desk.live.rect = { left: 1200, top: 530, width: 40, height: 20 };
    await agent.call('windows.point', { threadId, control: 3 });
    expect(desk.live.asked).toEqual([{ type: 'Button', name: 'Play', automationId: 'PlayButton', rect: { left: 1200, top: 530, width: 40, height: 20 } }]);
    await eventually(() => expect(boxes[0]!.rect).toEqual({ left: 1200, top: 530, width: 40, height: 20 }));

    // The window scrolls: the box moves with the control, and a click is looked for where it is now.
    desk.live.rect = { left: 1200, top: 600, width: 40, height: 20 };
    await eventually(() => expect(boxes[0]!.rect).toEqual({ left: 1200, top: 600, width: 40, height: 20 }));
    // Out of view, by the app's word or under the window's edge (it ends at 800): hidden, still shown.
    desk.live.rect = 'hidden';
    await eventually(() => expect(boxes[0]!.rect).toBeNull());
    desk.live.rect = { left: 1200, top: 805, width: 40, height: 20 };
    await Bun.sleep(FOLLOW_MS * 5);
    expect(boxes[0]!.rect).toBeNull();
    desk.live.rect = { left: 1200, top: 700, width: 40, height: 20 };
    await eventually(() => expect(boxes[0]!.rect).toEqual({ left: 1200, top: 700, width: 40, height: 20 }));

    // The app drops the element: hidden, then found again near where it was last seen.
    desk.drop();
    await eventually(() => expect(boxes[0]!.rect).toBeNull());
    desk.live.rect = { left: 1210, top: 690, width: 40, height: 20 };
    await eventually(() => expect(boxes[0]!.rect).toEqual({ left: 1210, top: 690, width: 40, height: 20 }), 3000);
    expect(desk.live.asked.at(-1)!.rect).toEqual({ left: 1200, top: 700, width: 40, height: 20 });

    const waiting = agent.call('windows.waitClick', { threadId, timeoutSeconds: 5 });
    await Bun.sleep(20);
    Object.assign(desk.mouse, { pressed: true, x: 1215, y: 695 });
    expect(await waiting).toMatchObject({ clicked: true, pointer: { x: 210, y: 190 } });
    // The element is let go with the box.
    expect(desk.live.held).toBe(0);
  });

  test('wait-click ends on a press inside the box, not on one outside or a button already held', async () => {
    await agent.call('windows.point', { threadId, target: { id: '101' }, at: { x: 100, y: 100, width: 50, height: 50, unit: 'px' } });
    // Held since before the wait: a drag that started elsewhere, not this click.
    Object.assign(desk.mouse, { pressed: true, x: 1120, y: 620 });
    const waiting = agent.call('windows.waitClick', { threadId, timeoutSeconds: 5 });
    await Bun.sleep(80);
    expect(boxes[0]!.rect).not.toBeNull();
    Object.assign(desk.mouse, { pressed: false });
    await Bun.sleep(80);
    Object.assign(desk.mouse, { pressed: true, x: 900, y: 620 });
    await Bun.sleep(80);
    Object.assign(desk.mouse, { pressed: false });
    await Bun.sleep(80);
    expect(boxes[0]!.rect).not.toBeNull();
    Object.assign(desk.mouse, { pressed: true, x: 1149, y: 649 });
    expect(await waiting).toMatchObject({ clicked: true, pointer: { windowId: '101', x: 100, y: 100 } });
    await eventually(() => expect(boxes[0]!.rect).toBeNull());
    expect(await thrown(agent.call('windows.waitClick', { threadId }))).toThrow('nothing is pointed at in this conversation');

    // No click in time leaves the box up for the next try, even past the time it was drawn for; unpoint ends a wait.
    Object.assign(desk.mouse, { pressed: false });
    await agent.call('windows.point', { threadId, target: { id: '101' }, at: { x: 0, y: 0, width: 10, height: 10, unit: 'px' }, seconds: 1 });
    expect(await agent.call('windows.waitClick', { threadId, timeoutSeconds: 1 })).toEqual({ clicked: false, reason: 'timeout' });
    await Bun.sleep(50);
    expect(boxes[1]!.rect).not.toBeNull();
    const cleared = agent.call('windows.waitClick', { threadId, timeoutSeconds: 5 });
    await Bun.sleep(20);
    await agent.call('windows.unpoint', { threadId });
    expect(await cleared).toEqual({ clicked: false, reason: 'cleared' });
  });

  test('an archived conversation takes its box away', async () => {
    await agent.call('windows.point', { threadId, target: { id: '101' }, at: { x: 0, y: 0, width: 10, height: 10, unit: 'px' } });
    await owner.call('threads.archive', { threadId });
    await eventually(() => expect(boxes.map(box => box.rect)).toEqual([null]));
  });

  test('only a desktop app of this machine draws the box, so without one point is refused', async () => {
    app.close();
    // A browser tab or a phone of the owner has no screen of this computer's.
    const tab = await connect(harness.url, harness.token, { client: { name: 'pwa', version: 'test' } });
    const heard: unknown[] = [];
    tab.on('windows.pointer', box => heard.push(box));
    owner.on('windows.pointer', box => heard.push(box));
    try {
      await eventually(() => expect(harness.core.subscribers.pointer({ id: 'probe', rect: null, label: '', look: { shape: 'box', pad: 5 } })).toBe(0));
      const refusal = await thrown(agent.call('windows.point', { threadId, target: { id: '101' }, at: { x: 0, y: 0, width: 10, height: 10, unit: 'px' } }));
      expect(refusal).toThrow('the box is drawn by the Boite desktop app of this computer, and none is open');
      expect(await agent.call('windows.unpoint', { threadId })).toEqual({ cleared: false });
      expect(heard).toEqual([]);
    } finally {
      tab.close();
    }
  });

  test('boite window read, point, wait-click and unpoint', async () => {
    const run = async (...args: string[]) => {
      let out = '', error = '';
      const code = await runCli(['window', ...args], { cwd: harness.core.threads.require(threadId).cwd,
        env: { [AGENT_ENV.threadId]: threadId, [AGENT_ENV.coreUrl]: harness.url, [AGENT_ENV.token]: harness.core.agents.tokenFor(threadId) },
        out: text => { out += text; }, err: text => { error += text; } });
      return { code, out, error };
    };
    const answered = answer('always');
    const read = await run('read', '--id', '101', '--limit', '2');
    await answered;
    expect(read.out).toBe('window: 101 (Unity.exe)\n#1 MenuItem "File" 4,4 40x20\n#2 MenuItem "Edit" 48,4 40x20\n2 more: narrow with --filter or raise --limit\n');
    expect((await run('point', '2', '--label', 'Open Edit')).out).toMatch(/^pointing at MenuItem "Edit" of window 101 \(Unity.exe\) with "Open Edit" for 120 s\n$/);
    expect((await run('point', '--id', '101', '--at', '0,0,0.5,0.5', '--seconds', '30')).out).toMatch(/^pointing at 0,0 200x150 of window 101 \(Unity.exe\) for 30 s\n$/);
    expect((await run('point', '--id', '101')).error).toContain('needs an id from window read (3 for #3), or a target with exactly one of --name or --at');
    Object.assign(desk.mouse, { pressed: false });
    setTimeout(() => Object.assign(desk.mouse, { pressed: true, x: 1010, y: 510 }), 50);
    expect((await run('wait-click', '--timeout', '5')).out).toBe('clicked: the user pressed inside the box, which is gone now\n');
    expect((await run('unpoint')).out).toBe('no box was shown\n');
  });
});
