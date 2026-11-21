import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { NativeWindow, WindowCapture, WindowPixels } from '../src/platform/types.ts';
import { WindowCaptureError } from '../src/platform/window-pixels.ts';

/**
 * Test windows this file owns: a WinForms form in its own powershell.exe,
 * which never takes focus (`ShowWithoutActivation`, `WS_EX_NOACTIVATE`) so the
 * person working on this machine keeps theirs. `minimized` minimizes it from
 * inside its own process with `SW_SHOWMINNOACTIVE`.
 */
const FORM = `
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public class BoiteTestWindow : Form {
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  bool topMost;
  public BoiteTestWindow(string title, int color, int x, int y, bool topMost, bool minimized) {
    this.topMost = topMost;
    Text = title;
    BackColor = Color.FromArgb(color);
    StartPosition = FormStartPosition.Manual;
    Location = new Point(x, y);
    Size = new Size(360, 260);
    Shown += delegate {
      if (minimized) ShowWindow(Handle, 7);
      Console.WriteLine("Shown: hwnd=" + Handle + ", visible=" + IsWindowVisible(Handle) + ", minimized=" + IsIconic(Handle));
    };
  }
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams {
    get {
      CreateParams parameters = base.CreateParams;
      parameters.ExStyle |= 0x08000000;
      if (topMost) parameters.ExStyle |= 0x8;
      return parameters;
    }
  }
}
`;

const RED = 0xff0000;
const BLUE = 0x0000ff;

function openWindow(title: string, color: number, x: number, y: number, topMost: boolean, minimized: boolean) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::WriteLine("Compiling the WinForms fixture (session " + [Diagnostics.Process]::GetCurrentProcess().SessionId + ")")',
    `Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'\n${FORM}\n'@`,
    '[Console]::WriteLine("Starting the WinForms message loop")',
    `[System.Windows.Forms.Application]::Run((New-Object BoiteTestWindow -ArgumentList '${title}', ${color | 0xff000000 | 0}, ${x}, ${y}, $${topMost}, $${minimized}))`,
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const proc = Bun.spawn(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true,
  });
  const read = (stream: ReadableStream) => new Response(stream).text().catch(error => String(error));
  const output = Promise.all([read(proc.stdout), read(proc.stderr)]);
  return { proc, title, minimized, output };
}

type TestWindow = ReturnType<typeof openWindow>;

/** Share of the sampled pixels close to the colour `[r, g, b]`. */
function share(pixels: WindowPixels, [r, g, b]: [number, number, number]): number {
  const count = pixels.width * pixels.height;
  const step = Math.max(1, Math.floor(count / 20_000));
  let matching = 0;
  let sampled = 0;
  for (let index = 0; index < count; index += step) {
    const at = index * 4;
    sampled += 1;
    if (Math.abs(pixels.bgra[at + 2]! - r) < 40 && Math.abs(pixels.bgra[at + 1]! - g) < 40 && Math.abs(pixels.bgra[at]! - b) < 40) matching += 1;
  }
  return matching / sampled;
}

async function failure(run: () => Promise<unknown>): Promise<WindowCaptureError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof WindowCaptureError) return error;
    throw error;
  }
  throw new Error('expected a WindowCaptureError');
}

describe.skipIf(process.platform !== 'win32')('window capture on Windows', () => {
  const tag = `boite-capture-${process.pid}-${Date.now()}`;
  const windows: TestWindow[] = [];
  let capture: WindowCapture;
  let red: NativeWindow;
  let minimized: NativeWindow;

  async function closeWindows() {
    for (const { proc } of windows) if (proc.exitCode === null) proc.kill();
    await Promise.all(windows.map(({ proc }) => proc.exited));
  }

  async function findWindows() {
    const deadline = Date.now() + 30_000;
    let missing = windows;
    while (Date.now() < deadline) {
      const listed = await capture.list();
      const matches = windows.map(({ proc, title, minimized }) => listed.find(
        window => window.pid === proc.pid && window.title === title && window.minimized === minimized,
      ));
      const [redWindow, blueWindow, minimizedWindow] = matches;
      if (redWindow && blueWindow && minimizedWindow) {
        red = redWindow;
        minimized = minimizedWindow;
        return;
      }
      missing = windows.filter((_, index) => matches[index] === undefined);
      if (missing.some(({ proc }) => proc.exitCode !== null)) break;
      await Bun.sleep(100);
    }
    const reasons = missing.map(({ proc }) => proc.exitCode === null ? 'never showed' : `exited with code ${proc.exitCode}`);
    await closeWindows();
    const diagnostics = await Promise.all(missing.map(async ({ proc, title, output }, index) => {
      const [stdout, stderr] = await output;
      return `test window "${title}" (pid ${proc.pid}) ${reasons[index]}; stdout: ${stdout.trim() || '(empty)'}; stderr: ${stderr.trim() || '(empty)'}`;
    }));
    throw new Error(diagnostics.join('\n'));
  }

  beforeAll(async () => {
    const { loadWindowCapture } = await import('../src/platform/windows/window-capture.ts');
    const loaded = await loadWindowCapture();
    if ('unavailable' in loaded) throw new Error(loaded.unavailable);
    capture = loaded;
    windows.push(openWindow(`${tag}-red`, RED, 40, 40, false, false));
    windows.push(openWindow(`${tag}-blue`, BLUE, 60, 60, true, false));
    windows.push(openWindow(`${tag}-minimized`, RED, 80, 80, false, true));
    await findWindows();
  }, 45_000);

  afterAll(closeWindows);

  test('lists the window with its process and physical size', () => {
    expect(red.process.toLowerCase()).toBe('powershell.exe');
    expect(red.path.toLowerCase()).toEndWith('\\powershell.exe');
    expect(red.className).toStartWith('WindowsForms10.');
    expect(red.minimized).toBe(false);
    expect(red.width).toBeGreaterThan(200);
    expect(red.height).toBeGreaterThan(150);
  });

  test('captures a window hidden behind a topmost one, at the size list gave', async () => {
    const picture = await capture.capture(red.id);
    expect({ width: picture.width, height: picture.height }).toEqual({ width: red.width, height: red.height });
    expect(share(picture, [255, 0, 0])).toBeGreaterThan(0.6);
    expect(share(picture, [0, 0, 255])).toBeLessThan(0.05);
  });

  test('PrintWindow alone gives the same window at the same size', async () => {
    const { printWindow } = await import('../src/platform/windows/window-capture.ts');
    const picture = printWindow(red.id);
    expect(picture.via).toBe('printwindow');
    expect({ width: picture.width, height: picture.height }).toEqual({ width: red.width, height: red.height });
    expect(share(picture, [255, 0, 0])).toBeGreaterThan(0.6);
  });

  test('frames keep answering pictures of the window until closed', async () => {
    const frames = capture.frames(red.id);
    try {
      const first = await frames.next();
      const second = await frames.next();
      expect(share(first, [255, 0, 0])).toBeGreaterThan(0.6);
      expect({ width: second.width, height: second.height }).toEqual({ width: red.width, height: red.height });
    } finally {
      frames.close();
      frames.close();
    }
    expect((await failure(() => frames.next())).code).toBe('failed');
  });

  test('refuses a minimized window and a window that does not exist', async () => {
    expect((await failure(() => capture.capture(minimized.id))).code).toBe('minimized');
    expect((await failure(() => capture.frames(minimized.id).next())).code).toBe('minimized');
    expect((await failure(() => capture.capture('1'))).code).toBe('gone');
    expect((await failure(() => capture.capture('not-a-window'))).code).toBe('gone');
  });
});
