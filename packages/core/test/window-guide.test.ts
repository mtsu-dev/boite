import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { AGENT_ENV, type MessagePart, type WindowEdge, type WindowPointerLook, type WindowPointerStep } from '@boite/contracts';
import { runCli } from '../src/cli.ts';
import { connect, type CoreClient } from '../src/client.ts';
import type { AppWindow, ControlState, NativeControl, NativeWindow, ScreenRect, WindowCapture, WindowGuide } from '../src/platform/types.ts';
import { goneError } from '../src/platform/window-pixels.ts';
import { DesktopWindows } from '../src/windows/service.ts';
import { echoThread, startTestCore, type TestCore } from './harness.ts';
import { rejection, thrown } from './settle.ts';

const UNITY = 'C:\\Program Files\\Unity\\Hub\\Editor\\6000.0\\Editor\\Unity.exe';
const FOLLOW_MS = 10;
const SETTLE_MS = 120;
const VALUE_SETTLE_MS = 150;

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
  /**
   * Read only with `offscreen`: their app says they are out of view. Main
   * Camera is scrolled above the window; Animator lies on a tab not shown,
   * inside the window, so the app gives no way to scroll to it.
   */
  const outOfView: NativeControl[] = [
    { ...control('TreeItem', 'Main Camera', 1100, 300), offscreen: true },
    { ...control('TabItem', 'Animator', 1100, 600), offscreen: true },
  ];
  /** Scrolled past the window's right edge, though its provider says it is on screen. */
  const right = control('Button', 'Inspector', 1500, 600);
  // Read only with `any`: a card that holds the controls, as a div does.
  const containers: NativeControl[] = [{ type: 'Group', name: 'Card', automationId: '', rect: { left: 1100, top: 600, width: 120, height: 60 } }];
  /** The File menu, window 303 of Unity's, read with 101 while its frame is there; it reaches past 101's left edge. */
  const menu: NativeControl[] = [
    { ...control('MenuItem', 'Build Settings', 990, 530), popup: '303' },
    // Past the menu's bottom edge: out of view in the menu, though inside the window.
    { ...control('MenuItem', 'Below the menu', 990, 700), popup: '303' },
  ];
  const menuFrame = { rect: { left: 980, top: 524, width: 160, height: 60 }, minimized: false, above: false };
  const mouse = { pressed: false, x: 0, y: 0 };
  /** Whether Escape is down on the machine. */
  const keys = { escape: false };
  /**
   * The control a box follows, as its app answers: a rectangle, out of view,
   * or null once the app dropped it. Dropping it ends every element held so
   * far, as a re-rendered row does; it is found again once it has a rectangle.
   */
  const live = { rect: null as (ScreenRect & { offscreen?: true }) | 'hidden' | null, generation: 0, held: 0, asked: [] as NativeControl[], state: {} as ControlState };
  /** Unity's windows with a title bar, its dialogs included: what a box with `until: 'window'` watches. */
  const apps: AppWindow[] = [{ id: '101', title: 'Scene 101' }];
  const drop = () => { live.rect = null; live.generation += 1; };
  /** The window in front; the desktop app's frame brings one there. */
  const front = { id: '' };
  const capture: WindowCapture = {
    list: async () => windows.map(window => ({ ...window, minimized: frames.get(window.id)?.minimized ?? window.minimized })),
    capture: async id => { throw goneError(id); },
    frames: id => ({ next: async () => { throw goneError(id); }, close: () => {} }),
  };
  const guide: WindowGuide = {
    controls: async (id, limit, any, offscreen) => {
      if (!frames.has(id)) throw new Error('the window closed during the read');
      const own = id !== '101' ? [] : [...controls, ...(any ? containers : []), ...(offscreen ? [...outOfView, right] : [])];
      const all = id === '101' && frames.has('303') ? [...menu, ...own] : own;
      return { controls: all.slice(0, limit), total: all.length };
    },
    frame: id => {
      const frame = frames.get(id);
      return frame ? { rect: { ...frame.rect }, minimized: frame.minimized, above: frame.above } : null;
    },
    mouse: () => ({ ...mouse }),
    escape: () => keys.escape,
    foreground: id => front.id === id,
    appWindows: pid => pid === 101 ? apps.map(app => ({ ...app })) : [],
    track: async (_id, wanted) => {
      live.asked.push(wanted);
      if (live.rect === null) return null;
      const generation = live.generation;
      let held = true;
      live.held += 1;
      return {
        rect: () => !held || generation !== live.generation || live.rect === null ? 'gone' : typeof live.rect === 'string' ? live.rect : { ...live.rect },
        state: () => !held || generation !== live.generation ? 'gone' : { ...live.state },
        release: () => { if (held) live.held -= 1; held = false; },
      };
    },
  };
  return { windows, frames, mouse, keys, capture, guide, live, drop, front, menuFrame, apps };
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
  let boxes: { id: string; rect: ScreenRect | null; label: string; look: WindowPointerLook; frame?: { app: string; windowId: string }; edge?: WindowEdge; step?: WindowPointerStep }[];

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
      // An arrow turned back into the ring loses its edge.
      if (known) { delete known.edge; Object.assign(known, box); } else boxes.push({ ...box });
    });
    const core = harness.core as { windows: DesktopWindows };
    core.windows.stop();
    core.windows = new DesktopWindows(harness.core, {
      backend: async () => desk.capture, guide: async () => desk.guide, consentTimeoutMs: 60_000,
      tempRoot: join(harness.dataDir, 'window-temp'), guideTiming: { followMs: FOLLOW_MS, mouseMs: 5, settleMs: SETTLE_MS, frameIdleMs: 150, watchMs: 10, valueSettleMs: VALUE_SETTLE_MS },
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

  test('a box on a control follows each step of a scroll, out of view stays hidden, and a re-rendered control is found again', async () => {
    const answered = answer('once');
    await agent.call('windows.read', { threadId, target: { id: '101' } });
    await answered;
    desk.live.rect = { left: 1200, top: 530, width: 40, height: 20 };
    await agent.call('windows.point', { threadId, control: 3 });
    expect(desk.live.asked).toEqual([{ type: 'Button', name: 'Play', automationId: 'PlayButton', rect: { left: 1200, top: 530, width: 40, height: 20 } }]);
    await eventually(() => expect(boxes[0]!.rect).toEqual({ left: 1200, top: 530, width: 40, height: 20 }));

    // Shown at once where it was read, not after a settle.
    expect(boxes[0]!.rect).not.toBeNull();

    // A native app answers with each step of a scroll: the box follows every one at once and never hides.
    const steps: (ScreenRect | null)[] = [];
    app.on('windows.pointer', box => { if (box.id === boxes[0]!.id) steps.push(box.rect); });
    desk.live.rect = { left: 1200, top: 600, width: 40, height: 20 };
    await eventually(() => expect(boxes[0]!.rect).toEqual({ left: 1200, top: 600, width: 40, height: 20 }), SETTLE_MS / 2);
    desk.live.rect = { left: 1200, top: 640, width: 40, height: 20 };
    await eventually(() => expect(boxes[0]!.rect).toEqual({ left: 1200, top: 640, width: 40, height: 20 }), SETTLE_MS / 2);
    expect(steps).toEqual([{ left: 1200, top: 600, width: 40, height: 20 }, { left: 1200, top: 640, width: 40, height: 20 }]);
    // Dragging the window moves the box at once: the control stays put in it.
    desk.frames.get('101')!.rect.left += 10;
    desk.live.rect = { left: 1210, top: 640, width: 40, height: 20 };
    await eventually(() => expect(boxes[0]!.rect).toEqual({ left: 1210, top: 640, width: 40, height: 20 }), SETTLE_MS / 2);
    desk.frames.get('101')!.rect.left -= 10;
    desk.live.rect = { left: 1200, top: 600, width: 40, height: 20 };
    await eventually(() => expect(boxes[0]!.rect).toEqual({ left: 1200, top: 600, width: 40, height: 20 }));
    // With no place at all: hidden, still shown. Under the window's edge (it ends at 800): an arrow just inside it, level with the control.
    desk.live.rect = 'hidden';
    await eventually(() => expect(boxes[0]!.rect).toBeNull());
    desk.live.rect = { left: 1200, top: 805, width: 40, height: 20 };
    await eventually(() => expect(boxes[0]).toMatchObject({ rect: { left: 1204, top: 758, width: 32, height: 32 }, edge: 'below' }));
    desk.live.rect = { left: 1200, top: 700, width: 40, height: 20 };
    await eventually(() => expect(boxes[0]!.rect).toEqual({ left: 1200, top: 700, width: 40, height: 20 }));
    expect(boxes[0]!.edge).toBeUndefined();

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

  test('read with any adds the containers, and a box on one grows and shrinks with it', async () => {
    const answered = answer('always');
    const plain = await agent.call('windows.read', { threadId, target: { id: '101' } });
    await answered;
    expect(plain.controls.map(control => control.type)).not.toContain('Group');
    const read = await agent.call('windows.read', { threadId, target: { id: '101' }, any: true });
    expect(read.controls.find(control => control.type === 'Group')).toEqual({ id: 5, type: 'Group', name: 'Card', x: 100, y: 100, width: 120, height: 60 });
    expect(await thrown(agent.call('windows.point', { threadId, target: { id: '101' }, name: 'card' }))).toThrow('no control of Unity.exe is named "card"');

    desk.live.rect = { left: 1100, top: 600, width: 120, height: 60 };
    await agent.call('windows.point', { threadId, target: { id: '101' }, name: 'card', any: true });
    expect(desk.live.asked.at(-1)).toMatchObject({ type: 'Group', name: 'Card' });
    await eventually(() => expect(boxes.at(-1)!.rect).toEqual({ left: 1100, top: 600, width: 120, height: 60 }));
    // The card grows as what it holds does, then shrinks back: the box with it, at once.
    desk.live.rect = { left: 1090, top: 590, width: 160, height: 140 };
    await eventually(() => expect(boxes.at(-1)!.rect).toEqual({ left: 1090, top: 590, width: 160, height: 140 }), SETTLE_MS / 2);
    desk.live.rect = { left: 1100, top: 600, width: 120, height: 60 };
    await eventually(() => expect(boxes.at(-1)!.rect).toEqual({ left: 1100, top: 600, width: 120, height: 60 }), SETTLE_MS / 2);
  });

  test('a Chromium window is framed and brought to the front before its read, and the frame goes once no box shows in it', async () => {
    desk.windows[0]!.className = 'Chrome_WidgetWin_1';
    // The desktop app brings the framed window to the front a moment after it hears of it.
    app.on('windows.pointer', box => { if (box.frame && box.rect) setTimeout(() => { desk.front.id = box.frame!.windowId; }, 40); });
    const answered = answer('always');
    const started = Date.now();
    const read = await agent.call('windows.read', { threadId, target: { id: '101' } });
    await answered;
    expect(read.total).toBe(4);
    expect(desk.front.id).toBe('101');
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
    await eventually(() => expect(boxes).toMatchObject([{ rect: { left: 1000, top: 500, width: 400, height: 300 }, label: '', frame: { app: 'Unity', windowId: '101' } }]));

    // Chromium reports a scroll in bursts: the box hides on the first move, stays hidden while the control keeps moving, and shows where it settled.
    desk.live.rect = { left: 1200, top: 530, width: 40, height: 20 };
    await agent.call('windows.point', { threadId, control: 3 });
    const box = () => boxes.find(entry => !entry.frame)!;
    await eventually(() => expect(box().rect).toEqual({ left: 1200, top: 530, width: 40, height: 20 }));
    desk.live.rect = { left: 1200, top: 600, width: 40, height: 20 };
    await eventually(() => expect(box().rect).toBeNull());
    await Bun.sleep(SETTLE_MS / 2);
    desk.live.rect = { left: 1200, top: 640, width: 40, height: 20 };
    await Bun.sleep(SETTLE_MS * 0.75);
    expect(box().rect).toBeNull();
    await eventually(() => expect(box().rect).toEqual({ left: 1200, top: 640, width: 40, height: 20 }));
    // Scrolled under the window's edge: hidden while it moves, then an arrow on that edge once it settled.
    desk.live.rect = { left: 1200, top: 820, width: 40, height: 20 };
    await eventually(() => expect(box().rect).toBeNull());
    await Bun.sleep(SETTLE_MS / 2);
    expect(box().rect).toBeNull();
    await eventually(() => expect(box()).toMatchObject({ rect: { left: 1204, top: 758, width: 32, height: 32 }, edge: 'below' }));

    // A box in the window keeps the frame; the frame follows the window.
    desk.frames.get('101')!.rect.top += 20;
    await eventually(() => expect(boxes[0]!.rect).toMatchObject({ top: 520 }));
    await Bun.sleep(250);
    expect(boxes[0]!.rect).not.toBeNull();
    // Gone FRAME_IDLE_MS after the box.
    await agent.call('windows.unpoint', { threadId });
    await eventually(() => expect(boxes[0]!.rect).toBeNull(), 1000);
    expect(boxes.filter(box => box.frame)).toHaveLength(1);

    // A window already in front is framed and read at once; any other app is neither.
    expect(await agent.call('windows.read', { threadId, target: { id: '101' } })).toMatchObject({ total: 4 });
    expect(boxes.filter(box => box.frame)).toHaveLength(2);
    desk.windows[0]!.className = 'UnityContainerWndClass';
    await eventually(() => expect(boxes.at(-1)!.rect).toBeNull(), 1000);
    await agent.call('windows.read', { threadId, target: { id: '101' } });
    await Bun.sleep(50);
    expect(boxes.filter(box => box.frame)).toHaveLength(2);
  });

  test('read with offscreen lists the controls out of view with the way to scroll, and a box on one is an arrow on the window\'s edge until it scrolls in', async () => {
    const answered = answer('always');
    expect(await thrown(agent.call('windows.read', { threadId, target: { id: '101' }, offscreen: 'yes' as unknown as boolean }))).toThrow('offscreen must be true or false');
    const read = await agent.call('windows.read', { threadId, target: { id: '101' }, offscreen: true });
    await answered;
    // The controls in view come as without it, unmarked; the others say where they lie, in the window's pixels.
    expect(read.total).toBe(8);
    expect(read.controls.slice(0, 4).every(one => one.offscreen === undefined)).toBe(true);
    expect(read.controls.slice(4)).toEqual([
      { id: 5, type: 'ListItem', name: 'Hidden asset', offscreen: 'below', x: 0, y: 400, width: 40, height: 20 },
      { id: 6, type: 'TreeItem', name: 'Main Camera', offscreen: 'above', x: 100, y: -200, width: 40, height: 20 },
      { id: 7, type: 'TabItem', name: 'Animator', offscreen: 'unknown', x: 100, y: 100, width: 40, height: 20 },
      { id: 8, type: 'Button', name: 'Inspector', offscreen: 'right', x: 500, y: 100, width: 40, height: 20 },
    ]);
    expect(await thrown(agent.call('windows.point', { threadId, control: 7 }))).toThrow('#7 is out of view and Unity.exe does not say where');

    desk.live.rect = { left: 1000, top: 900, width: 40, height: 20 };
    const { pointer } = await agent.call('windows.point', { threadId, control: 5, label: 'Open the asset' });
    expect(pointer).toMatchObject({ offscreen: 'below', label: 'Open the asset', control: { name: 'Hidden asset' } });
    // An arrow inside the bottom edge, kept off the window's corner.
    await eventually(() => expect(boxes[0]).toMatchObject({ rect: { left: 1010, top: 758, width: 32, height: 32 }, label: 'Open the asset', edge: 'below' }));
    const waiting = agent.call('windows.waitClick', { threadId, timeoutSeconds: 5 });
    // A click on the arrow lands on the app, not on the control: it ends nothing.
    Object.assign(desk.mouse, { pressed: true, x: 1020, y: 770 });
    await Bun.sleep(60);
    Object.assign(desk.mouse, { pressed: false });
    expect(boxes[0]!.rect).not.toBeNull();
    // Scrolled past the right edge, the arrow moves there, level with it; on a tab not shown, by its app's word, it hides.
    desk.live.rect = { left: 1500, top: 600, width: 40, height: 20 };
    await eventually(() => expect(boxes[0]).toMatchObject({ rect: { left: 1358, top: 594, width: 32, height: 32 }, edge: 'right' }));
    desk.live.rect = { left: 1100, top: 600, width: 40, height: 20, offscreen: true };
    await eventually(() => expect(boxes[0]!.rect).toBeNull());
    // Scrolled into view: the ring, and a click on it is the click.
    desk.live.rect = { left: 1000, top: 700, width: 40, height: 20 };
    await eventually(() => expect(boxes[0]!.rect).toEqual({ left: 1000, top: 700, width: 40, height: 20 }));
    expect(boxes[0]!.edge).toBeUndefined();
    Object.assign(desk.mouse, { pressed: true, x: 1010, y: 705 });
    const clicked = await waiting;
    expect(clicked).toMatchObject({ clicked: true, pointer: { x: 0, y: 200 } });
    expect((clicked as { pointer: { offscreen?: string } }).pointer.offscreen).toBeUndefined();

    // A control the app does not let be followed keeps its arrow, through a minimize too.
    desk.live.rect = null;
    Object.assign(desk.mouse, { pressed: false });
    await agent.call('windows.point', { threadId, control: 6 });
    await eventually(() => expect(boxes.at(-1)).toMatchObject({ rect: { left: 1104, top: 510, width: 32, height: 32 }, edge: 'above' }));
    desk.frames.get('101')!.minimized = true;
    await eventually(() => expect(boxes.at(-1)!.rect).toBeNull());
    desk.frames.get('101')!.minimized = false;
    await eventually(() => expect(boxes.at(-1)).toMatchObject({ rect: { left: 1104, top: 510, width: 32, height: 32 }, edge: 'above' }));
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

  test('a box pointed with notify tells the agent of the click, or of its end without one, as a message, unless a wait took the click', async () => {
    // What reached the agent as a prompt: echo says it back, which is not counted.
    const told = () => harness.core.journal.listMessages(threadId).filter(message => message.role === 'user').flatMap(message => message.parts)
      .flatMap(part => part.type === 'text' && part.text.startsWith('Boite: ') ? [part.text] : []);
    const at = { x: 100, y: 100, width: 50, height: 50, unit: 'px' as const };
    const { pointer } = await agent.call('windows.point', { threadId, target: { id: '101' }, at, notify: true });
    expect(pointer.notify).toBe(true);
    await Bun.sleep(20);
    Object.assign(desk.mouse, { pressed: true, x: 1120, y: 620 });
    await eventually(() => expect(boxes[0]!.rect).toBeNull());
    await eventually(() => expect(told()).toEqual(['Boite: the user clicked the box on the 50x50 rectangle at 100,100 in window 101 (Unity.exe); the box is gone.']), 5000);

    // Timed out: said once. Replaced or taken away by the agent: nothing.
    Object.assign(desk.mouse, { pressed: false });
    await agent.call('windows.point', { threadId, target: { id: '101' }, at, notify: true, seconds: 1 });
    await eventually(() => expect(told()).toHaveLength(2), 5000);
    expect(told()[1]).toBe('Boite: the box on the 50x50 rectangle at 100,100 in window 101 (Unity.exe) timed out without a click.');
    await agent.call('windows.point', { threadId, target: { id: '101' }, at, notify: true });
    await agent.call('windows.point', { threadId, target: { id: '101' }, at, notify: true });
    await agent.call('windows.unpoint', { threadId });

    // A wait takes the click: the agent hears it there, not twice.
    await agent.call('windows.point', { threadId, target: { id: '101' }, at, notify: true });
    const waiting = agent.call('windows.waitClick', { threadId, timeoutSeconds: 5 });
    await Bun.sleep(20);
    Object.assign(desk.mouse, { pressed: true, x: 1120, y: 620 });
    expect(await waiting).toMatchObject({ clicked: true });
    await Bun.sleep(300);
    expect(told()).toHaveLength(2);
  }, 15_000);

  test('an open menu is read with its window, and a box on one of its items ends with a message when it closes', async () => {
    const told = () => harness.core.journal.listMessages(threadId).filter(message => message.role === 'user').flatMap(message => message.parts)
      .flatMap(part => part.type === 'text' && part.text.startsWith('Boite: ') ? [part.text] : []);
    desk.frames.set('303', desk.menuFrame);
    const answered = answer('always');
    const read = await agent.call('windows.read', { threadId, target: { id: '101' }, filter: 'build' });
    await answered;
    // In the window's pixels, left of its edge; the item below the menu's edge is out of view.
    expect(read.controls).toEqual([{ id: 1, type: 'MenuItem', name: 'Build Settings', popup: '303', x: -10, y: 30, width: 40, height: 20 }]);
    expect((await agent.call('windows.read', { threadId, target: { id: '101' } })).controls.map(one => one.name)).toEqual(['Build Settings', 'File', 'Edit', 'Play', 'Play Mode Options']);

    desk.live.rect = { left: 990, top: 530, width: 40, height: 20 };
    const { pointer } = await agent.call('windows.point', { threadId, control: 1, notify: true });
    expect(pointer).toMatchObject({ windowId: '101', popup: '303', x: -10, y: 30, control: { name: 'Build Settings' } });
    expect(desk.live.asked.at(-1)).toMatchObject({ name: 'Build Settings', popup: '303' });
    // Inside the menu, though left of the window: shown.
    await eventually(() => expect(boxes[0]!.rect).toEqual({ left: 990, top: 530, width: 40, height: 20 }));

    // A click elsewhere closes the menu: the box goes and the agent hears why.
    desk.frames.delete('303');
    await eventually(() => expect(boxes[0]!.rect).toBeNull());
    await eventually(() => expect(told()).toEqual(['Boite: the menu or popup under the box on MenuItem "Build Settings" in window 101 (Unity.exe) closed before a click.']), 5000);
    expect(desk.live.held).toBe(0);
    expect(await thrown(agent.call('windows.point', { threadId, control: 1 }))).toThrow('the menu or popup #1 lay in has closed');
  });

  test('a box with until change ends once a typed value settles, or at once on a toggle, and never says what the control holds', async () => {
    const told = () => harness.core.journal.listMessages(threadId).filter(message => message.role === 'user').flatMap(message => message.parts)
      .flatMap(part => part.type === 'text' && part.text.startsWith('Boite: ') ? [part.text] : []);
    expect(await thrown(agent.call('windows.point', { threadId, target: { id: '101' }, at: { x: 0, y: 0, width: 10, height: 10, unit: 'px' }, until: 'change' }))).toThrow('until change watches a control');
    expect(await thrown(agent.call('windows.point', { threadId, control: 1, until: 'hover' as 'click' }))).toThrow('until must be one of click, change, window');
    const answered = answer('always');
    await agent.call('windows.read', { threadId, target: { id: '101' } });
    await answered;
    desk.live.rect = { left: 1200, top: 530, width: 40, height: 20 };
    // A button holds nothing to change: refused, and the element is let go.
    expect(await thrown(agent.call('windows.point', { threadId, control: 3, until: 'change' }))).toThrow('Button "Play" has no value, check state or selection to watch');
    expect(desk.live.held).toBe(0);

    // The OS half hands over a hash of the value, never its text.
    desk.live.state = { value: 'hash-empty' };
    const { pointer } = await agent.call('windows.point', { threadId, control: 3, until: 'change', notify: true, label: 'Type your name' });
    expect(pointer.until).toBe('change');
    // A click on the field is not the change: the box stays.
    Object.assign(desk.mouse, { pressed: true, x: 1210, y: 535 });
    await Bun.sleep(60);
    Object.assign(desk.mouse, { pressed: false });
    // Each key changes the value: the box waits until it stays put.
    for (const typed of ['hash-T', 'hash-Ti', 'hash-Tim']) {
      desk.live.state = { value: typed };
      await Bun.sleep(VALUE_SETTLE_MS / 3);
      expect(boxes[0]!.rect).not.toBeNull();
    }
    await eventually(() => expect(boxes[0]!.rect).toBeNull());
    await eventually(() => expect(told()).toEqual(['Boite: the user changed the value of Button "Play" in window 101 (Unity.exe); the box is gone. What it holds now is not reported: ask the user if it matters.']), 5000);
    expect(desk.live.held).toBe(0);

    // Typed, then erased: no change. A toggle ends a blocking wait at once.
    desk.live.state = { value: 'hash-empty', toggle: 0 };
    await agent.call('windows.point', { threadId, control: 3, until: 'change' });
    const waiting = agent.call('windows.waitClick', { threadId, timeoutSeconds: 5 });
    desk.live.state = { value: 'hash-x', toggle: 0 };
    await Bun.sleep(VALUE_SETTLE_MS / 3);
    desk.live.state = { value: 'hash-empty', toggle: 0 };
    await Bun.sleep(VALUE_SETTLE_MS * 2);
    expect(boxes.at(-1)!.rect).not.toBeNull();
    desk.live.state = { value: 'hash-empty', toggle: 1 };
    expect(await waiting).toMatchObject({ clicked: false, changed: 'toggle', pointer: { until: 'change', control: { name: 'Play' } } });

    // Timed out: said once, as a change not seen.
    desk.live.state = { selected: false };
    await agent.call('windows.point', { threadId, control: 3, until: 'change', notify: true, seconds: 1 });
    await eventually(() => expect(told()).toHaveLength(2), 5000);
    expect(told()[1]).toBe('Boite: the box on Button "Play" in window 101 (Unity.exe) timed out without a change.');
  }, 15_000);

  test('a box with until window ends when the app opens a window or dialog, with its id, title and where to read it', async () => {
    const told = () => harness.core.journal.listMessages(threadId).filter(message => message.role === 'user').flatMap(message => message.parts)
      .flatMap(part => part.type === 'text' && part.text.startsWith('Boite: ') ? [part.text] : []);
    // A rectangle reads nothing, but the titles of the app's windows are read: the consent of a read.
    const answered = answer('always');
    await agent.call('windows.point', { threadId, target: { id: '101' }, at: { x: 0, y: 0, width: 40, height: 20, unit: 'px' }, until: 'window' });
    await answered;
    const waiting = agent.call('windows.waitClick', { threadId, timeoutSeconds: 5 });
    // A click on the box is not the window.
    Object.assign(desk.mouse, { pressed: true, x: 1010, y: 510 });
    await Bun.sleep(60);
    Object.assign(desk.mouse, { pressed: false });
    expect(boxes[0]!.rect).not.toBeNull();
    desk.apps.push({ id: '404', title: 'Build\nSettings', owner: '101' });
    expect(await waiting).toMatchObject({ clicked: false, opened: { windowId: '404', title: 'Build Settings', readWindowId: '101' }, pointer: { until: 'window' } });
    await eventually(() => expect(boxes[0]!.rect).toBeNull());

    // On a menu item: the click closes the menu first; the box hides and still hears the window open.
    desk.frames.set('303', desk.menuFrame);
    await agent.call('windows.read', { threadId, target: { id: '101' } });
    desk.live.rect = { left: 990, top: 530, width: 40, height: 20 };
    await agent.call('windows.point', { threadId, control: 1, until: 'window', notify: true });
    await eventually(() => expect(boxes.at(-1)!.rect).not.toBeNull());
    desk.frames.delete('303');
    await eventually(() => expect(boxes.at(-1)!.rect).toBeNull());
    await Bun.sleep(50);
    expect(told()).toEqual([]);
    desk.apps.push({ id: '505', title: 'Project Settings' });
    await eventually(() => expect(told()).toEqual(['Boite: Unity.exe opened window 505 "Project Settings" after the box on MenuItem "Build Settings" in window 101 (Unity.exe); the box is gone. Read it with boite window read --id 505.']), 5000);

    // Taken away by the agent: a window opening later says nothing. Its window closing: said.
    await agent.call('windows.point', { threadId, target: { id: '101' }, at: { x: 0, y: 0, width: 40, height: 20, unit: 'px' }, until: 'window', notify: true });
    await agent.call('windows.unpoint', { threadId });
    desk.apps.push({ id: '606', title: 'Later' });
    await Bun.sleep(80);
    expect(told()).toHaveLength(1);
    await agent.call('windows.point', { threadId, target: { id: '101' }, at: { x: 0, y: 0, width: 40, height: 20, unit: 'px' }, until: 'window', notify: true });
    desk.frames.delete('101');
    await eventually(() => expect(told()[1]).toBe('Boite: the window under the box on the 40x20 rectangle at 0,0 in window 101 (Unity.exe) closed before a new window.'), 5000);
  }, 15_000);

  test('the person ends a box from its card or with Escape, and the agent hears which, from its wait or as a message', async () => {
    const told = () => harness.core.journal.listMessages(threadId).filter(message => message.role === 'user').flatMap(message => message.parts)
      .flatMap(part => part.type === 'text' && part.text.startsWith('Boite: ') ? [part.text] : []);
    const ends = () => harness.core.journal.listMessages(threadId).flatMap(message => message.parts)
      .flatMap(part => part.type === 'window_guide' ? [part.end] : []);
    const at = { x: 100, y: 100, width: 50, height: 50, unit: 'px' as const };

    // Every client of the owner sees the box's card, naming the app and the label.
    const posted = owner.next('message.started', message => message.parts[0]?.type === 'window_guide', 5000);
    await agent.call('windows.point', { threadId, target: { id: '101' }, at, label: 'Scene view' });
    const card = (await posted).parts[0] as Extract<MessagePart, { type: 'window_guide' }>;
    expect(card).toMatchObject({ type: 'window_guide', process: 'Unity.exe', label: 'Scene view', end: null });
    // The answer is the person's: the agent ends its own box with unpoint.
    expect(await thrown(agent.call('windows.dismiss', { threadId, boxId: card.boxId, answer: 'dismissed' }))).toThrow('windows.dismiss is not one of the agent\'s methods');
    expect(await thrown(owner.call('windows.dismiss', { threadId, boxId: card.boxId, answer: 'later' as 'dismissed' }))).toThrow('answer must be one of dismissed, missing');

    // I cannot find it ends a wait with that answer, folds the card on every client and sends no message besides.
    const waiting = agent.call('windows.waitClick', { threadId, timeoutSeconds: 5 });
    await Bun.sleep(20);
    const folded = owner.next('message.part', event => event.part.type === 'window_guide' && event.part.end !== null, 5000);
    expect(await owner.call('windows.dismiss', { threadId, boxId: card.boxId, answer: 'missing' })).toEqual({ ok: true });
    expect(await waiting).toEqual({ clicked: false, reason: 'missing' });
    expect((await folded).part).toMatchObject({ boxId: card.boxId, end: 'missing' });
    await eventually(() => expect(boxes[0]!.rect).toBeNull());
    expect(await thrown(owner.call('windows.dismiss', { threadId, boxId: card.boxId, answer: 'dismissed' }))).toThrow('this box is no longer shown');

    // Escape held since before the box is not a press; pressed while it shows, it ends it, and the agent hears it
    // as a message though the box was drawn without notify and nothing waits.
    desk.keys.escape = true;
    await agent.call('windows.point', { threadId, target: { id: '101' }, at });
    await Bun.sleep(FOLLOW_MS * 5);
    expect(boxes[1]!.rect).not.toBeNull();
    desk.keys.escape = false;
    await Bun.sleep(FOLLOW_MS * 3);
    desk.keys.escape = true;
    await eventually(() => expect(boxes[1]!.rect).toBeNull());
    await eventually(() => expect(told()).toEqual(['Boite: the user dismissed the box on the 50x50 rectangle at 100,100 in window 101 (Unity.exe) before a click, with Done or Escape; the box is gone. They may have done it another way, or want to stop: ask before pointing again.']), 5000);
    desk.keys.escape = false;

    // Without a wait, I cannot find it reaches the agent as a message; a replaced box's card says the agent took it away.
    await agent.call('windows.point', { threadId, target: { id: '101' }, at, label: 'Old' });
    const next = owner.next('message.started', message => message.parts[0]?.type === 'window_guide', 5000);
    await agent.call('windows.point', { threadId, target: { id: '101' }, at, label: 'Hierarchy' });
    const last = (await next).parts[0] as Extract<MessagePart, { type: 'window_guide' }>;
    await owner.call('windows.dismiss', { threadId, boxId: last.boxId, answer: 'missing' });
    await eventually(() => expect(told()).toHaveLength(2), 5000);
    expect(told()[1]).toBe('Boite: the user cannot find the box on the 50x50 rectangle at 100,100 in window 101 (Unity.exe); the box is gone. It may be off screen, behind another window or on a closed menu: check with boite window screenshot, then point again or say where to look.');
    expect(ends()).toEqual(['missing', 'dismissed', 'cleared', 'missing']);
  }, 15_000);

  test('a box that is one step of a tour shows N / M on the screen and on its card, and the agent hears which step ended', async () => {
    const at = { x: 100, y: 100, width: 50, height: 50, unit: 'px' as const };
    // Refused before anything is drawn, naming the field and what it takes.
    for (const step of [{ index: 0, total: 3 }, { index: 4, total: 3 }, { index: 1, total: 21 }, { index: 1.5, total: 3 }, null]) {
      const { reason } = await rejection(agent.call('windows.point', { threadId, target: { id: '101' }, at, step: step as WindowPointerStep }));
      expect((reason as Error).message).toContain('step must be N/M, whole numbers with 1 <= N <= M <= 20');
      expect((reason as { rpc: { data: Record<string, unknown> } }).rpc.data).toMatchObject({ field: 'step' });
    }
    expect(await thrown(agent.call('windows.point', { threadId, target: { id: '101' }, at, step: { index: 4, total: 3 } }))).toThrow('not 4/3');
    expect(boxes).toEqual([]);

    const posted = owner.next('message.started', message => message.parts[0]?.type === 'window_guide', 5000);
    const { pointer } = await agent.call('windows.point', { threadId, target: { id: '101' }, at, label: 'Scene view', step: { index: 20, total: 20 } });
    expect(pointer.step).toEqual({ index: 20, total: 20 });
    const card = (await posted).parts[0] as Extract<MessagePart, { type: 'window_guide' }>;
    expect(card).toMatchObject({ type: 'window_guide', label: 'Scene view', step: { index: 20, total: 20 }, end: null });
    await eventually(() => expect(boxes).toMatchObject([{ label: 'Scene view', step: { index: 20, total: 20 } }]));
    // The box keeps its step as it follows its window.
    desk.frames.get('101')!.rect = { left: 1030, top: 500, width: 400, height: 300 };
    await eventually(() => expect(boxes[0]).toMatchObject({ rect: { left: 1130 }, step: { index: 20, total: 20 } }));

    // The agent hears which step the person ended.
    await owner.call('windows.dismiss', { threadId, boxId: card.boxId, answer: 'missing' });
    await eventually(() => expect(harness.core.journal.listMessages(threadId).filter(message => message.role === 'user').flatMap(message => message.parts)
      .flatMap(part => part.type === 'text' && part.text.startsWith('Boite: ') ? [part.text] : [])).toEqual([
      'Boite: the user cannot find the box on the 50x50 rectangle at 100,100 in window 101 (Unity.exe), step 20 of 20; the box is gone. It may be off screen, behind another window or on a closed menu: check with boite window screenshot, then point again or say where to look.',
    ]), 5000);
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
    expect((await run('read', '--id', '101', '--any', '--filter', 'card')).out).toBe('window: 101 (Unity.exe)\n#5 Group "Card" 100,100 120x60\n');
    expect((await run('read', '--id', '101', '--offscreen', '--filter', 'a')).out).toBe('window: 101 (Unity.exe)\n#3 Button "Play" 200,30 40x20\n#4 Button "Play Mode Options" 244,30 40x20\n'
      + '#5 ListItem "Hidden asset" 0,400 40x20 (out of view: below)\n#6 TreeItem "Main Camera" 100,-200 40x20 (out of view: above)\n#7 TabItem "Animator" 100,100 40x20 (out of view)\n');
    expect((await run('point', '6')).out).toMatch(/^pointing at TreeItem "Main Camera" of window 101 \(Unity.exe\) with "Main Camera" for 120 s\nit is out of view above: an arrow on that edge of the window points to it until the user scrolls it into view; tell them to scroll up\nkeep working/);
    desk.frames.set('303', desk.menuFrame);
    expect((await run('read', '--id', '101', '--filter', 'build')).out).toBe('window: 101 (Unity.exe)\n#1 MenuItem "Build Settings" -10,30 40x20 (in popup 303)\n');
    desk.live.rect = { left: 990, top: 530, width: 40, height: 20 };
    expect((await run('point', '1')).out).toMatch(/^pointing at MenuItem "Build Settings" of window 101 \(Unity.exe\) in its popup 303 with "Build Settings" for 120 s\n/);
    desk.frames.delete('303');
    await run('read', '--id', '101');
    expect((await run('point', '2', '--label', 'Open Edit')).out).toMatch(/^pointing at MenuItem "Edit" of window 101 \(Unity.exe\) with "Open Edit" for 120 s\nkeep working: the click, or the box timing out, arrives as a message\n$/);
    expect((await run('point', '--id', '101', '--at', '0,0,0.5,0.5', '--seconds', '30')).out).toMatch(/^pointing at 0,0 200x150 of window 101 \(Unity.exe\) for 30 s\n/);
    expect((await run('point', '--id', '101')).error).toContain('needs an id from window read (3 for #3), or a target with exactly one of --name or --at');
    Object.assign(desk.mouse, { pressed: false });
    setTimeout(() => Object.assign(desk.mouse, { pressed: true, x: 1010, y: 510 }), 50);
    expect((await run('wait-click', '--timeout', '5')).out).toBe('clicked: the user pressed inside the box, which is gone now\n');
    expect((await run('point', '--id', '101', '--at', '0,0,10,10', '--until', 'window')).out).toMatch(/^pointing at 0,0 10x10 of window 101 \(Unity.exe\) for 120 s\nkeep working: the new window, or the box timing out, arrives as a message\n$/);
    setTimeout(() => desk.apps.push({ id: '404', title: 'Build Settings', owner: '101' }), 50);
    expect((await run('wait', '--timeout', '5')).out).toBe('opened: window 404 "Build Settings"; the box is gone. Read it with boite window read --id 101: its controls come first (in popup 404)\n');
    expect((await run('point', '2', '--until', 'hover')).error).toContain('window point --until takes click, change, window');
    expect((await run('point', '--id', '101', '--at', '0,0,10,10', '--step', '2/5')).out).toMatch(/^pointing at 0,0 10x10 of window 101 \(Unity.exe\) as step 2 of 5 for 120 s\n/);
    expect((await run('point', '2', '--step', '2-5')).error).toContain('window point --step takes N/M, whole numbers with 1 <= N <= M <= 20, such as 2/5');
    expect((await run('point', '--id', '101', '--at', '0,0,10,10', '--step', '6/5')).error).toContain('step must be N/M, whole numbers with 1 <= N <= M <= 20, not 6/5');
    await run('point', '--id', '101', '--at', '0,0,10,10');
    setTimeout(() => { desk.keys.escape = true; }, 50);
    expect((await run('wait', '--timeout', '5')).out).toBe('dismissed: the user ended the box with Done or Escape before it was seen; it is gone. Ask before pointing again\n');
    desk.keys.escape = false;
    expect((await run('unpoint')).out).toBe('no box was shown\n');
  });
});
