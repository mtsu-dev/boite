import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Subprocess } from 'bun';
import type { NativeWindow, WindowCapture, WindowGuide } from '../src/platform/types.ts';

/**
 * A WinForms form this file owns, in its own powershell.exe, that never takes
 * the focus: two enabled buttons, a disabled one and a text field. Posted
 * messages open a Win32 menu (WM_APP + 1), a WinForms dropdown (WM_APP + 2)
 * and close both (WM_APP + 3), as a click on File would.
 */
const FORM = `
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public class BoiteGuideWindow : Form {
  [DllImport("user32.dll")] static extern bool EndMenu();
  ContextMenu menu = new ContextMenu(new MenuItem[] { new MenuItem("Player Settings"), new MenuItem("Quit Editor") });
  ContextMenuStrip dropdown = new ContextMenuStrip();
  public BoiteGuideWindow(string title) {
    dropdown.Items.Add("Dropdown Item");
    Text = title;
    StartPosition = FormStartPosition.Manual;
    // Away from the windows window-capture-windows.test.ts opens at the same time near the top-left corner.
    Location = new Point(760, 420);
    Size = new Size(420, 260);
    TopMost = true;
    Controls.Add(new Button { Text = "Open project", Name = "openProject", Location = new Point(20, 20), Size = new Size(140, 40) });
    Controls.Add(new Button { Text = "Build  Settings", Location = new Point(180, 20), Size = new Size(140, 40) });
    Controls.Add(new Button { Text = "Disabled", Location = new Point(20, 80), Size = new Size(100, 40), Enabled = false });
    Controls.Add(new TextBox { Name = "search", Location = new Point(20, 140), Size = new Size(200, 24) });
    // A container that grows with the window, as a div with its page.
    Controls.Add(new GroupBox { Text = "Options", Location = new Point(240, 120), Size = new Size(140, 70), Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right });
  }
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override void WndProc(ref Message message) {
    // The Win32 menu runs its own loop until it closes: started after this message returns.
    if (message.Msg == 0x8001) { BeginInvoke((Action)(() => menu.Show(this, new Point(40, 40)))); return; }
    if (message.Msg == 0x8002) { dropdown.Show(this, new Point(60, 60)); return; }
    if (message.Msg == 0x8003) { EndMenu(); dropdown.Close(); return; }
    base.WndProc(ref message);
  }
  protected override CreateParams CreateParams {
    get { CreateParams parameters = base.CreateParams; parameters.ExStyle |= 0x08000000; return parameters; }
  }
}
`;

function openWindow(title: string): Subprocess {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'\n${FORM}\n'@`,
    `[System.Windows.Forms.Application]::Run((New-Object BoiteGuideWindow -ArgumentList '${title}'))`,
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return Bun.spawn(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { stdout: 'ignore', stderr: 'pipe', windowsHide: true });
}

describe.skipIf(process.platform !== 'win32')('window guide on Windows', () => {
  const tag = `boite-guide-${process.pid}-${Date.now()}`;
  let proc: Subprocess;
  let capture: WindowCapture;
  let guide: WindowGuide;
  let form: NativeWindow;

  beforeAll(async () => {
    const { loadWindowCapture } = await import('../src/platform/windows/window-capture.ts');
    const { loadWindowGuide } = await import('../src/platform/windows/window-guide.ts');
    const [loadedCapture, loadedGuide] = await Promise.all([loadWindowCapture(), loadWindowGuide()]);
    if ('unavailable' in loadedCapture) throw new Error(loadedCapture.unavailable);
    if ('unavailable' in loadedGuide) throw new Error(loadedGuide.unavailable);
    capture = loadedCapture;
    guide = loadedGuide;
    proc = openWindow(tag);
    // PowerShell loading WinForms takes seconds on a busy machine or CI runner.
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const found = (await capture.list()).find(window => window.pid === proc.pid && window.title === tag);
      if (found) { form = found; return; }
      if (proc.exitCode !== null) throw new Error(`test window exited ${proc.exitCode}: ${await new Response(proc.stderr as ReadableStream).text()}`);
      await Bun.sleep(100);
    }
    throw new Error(`test window of pid ${proc.pid} never showed`);
  }, 45_000);

  afterAll(() => {
    proc?.kill();
  });

  test('reads the enabled controls with their names and places inside the window', async () => {
    const frame = guide.frame(form.id)!;
    expect(frame.minimized).toBe(false);
    expect({ width: frame.rect.width, height: frame.rect.height }).toEqual({ width: form.width, height: form.height });
    const { controls, total } = await guide.controls(form.id, 50);
    expect(total).toBe(controls.length);
    const names = controls.map(control => `${control.type} ${control.name}`);
    expect(names).toContain('Button Open project');
    // Its two spaces read as one, and the letters stay: a name is what the agent says to the person.
    expect(names).toContain('Button Build Settings');
    expect(names).toContain('Edit ');
    expect(names).not.toContain('Button Disabled');
    const open = controls.find(control => control.name === 'Open project')!;
    expect(open.automationId).toBe('openProject');
    const build = controls.find(control => control.name === 'Build Settings')!;
    // Same row, left to right, both inside the window's frame, in physical pixels at any scaling.
    expect(build.rect.left).toBeGreaterThan(open.rect.left + open.rect.width - 1);
    expect(Math.abs(build.rect.top - open.rect.top)).toBeLessThan(2);
    for (const control of [open, build]) {
      expect(control.rect.left).toBeGreaterThanOrEqual(frame.rect.left);
      expect(control.rect.top).toBeGreaterThanOrEqual(frame.rect.top);
      expect(control.rect.left + control.rect.width).toBeLessThanOrEqual(frame.rect.left + frame.rect.width);
    }
    expect(await guide.controls(form.id, 1)).toMatchObject({ total });
  });

  test('a tracked control answers where it is now, after its window moved', async () => {
    const { controls } = await guide.controls(form.id, 50);
    const build = controls.find(control => control.name === 'Build Settings')!;
    const tracked = (await guide.track(form.id, build))!;
    expect(tracked).not.toBeNull();
    expect(tracked.rect()).toEqual(build.rect);
    const { dlopen, FFIType } = await import('bun:ffi');
    const user32 = dlopen('user32.dll', { SetWindowPos: { args: [FFIType.u64, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u32], returns: FFIType.i32 } });
    const frame = guide.frame(form.id)!.rect;
    // SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE.
    expect(user32.symbols.SetWindowPos(BigInt(form.id), 0n, frame.left + 30, frame.top + 20, 0, 0, 0x1 | 0x4 | 0x10)).not.toBe(0);
    try {
      const moved = guide.frame(form.id)!.rect;
      const dx = moved.left - frame.left, dy = moved.top - frame.top;
      expect([dx, dy]).not.toEqual([0, 0]);
      expect(tracked.rect()).toEqual({ ...build.rect, left: build.rect.left + dx, top: build.rect.top + dy });
    } finally {
      user32.symbols.SetWindowPos(BigInt(form.id), 0n, frame.left, frame.top, 0, 0, 0x1 | 0x4 | 0x10);
      user32.close();
    }
    tracked.release();
    expect(tracked.rect()).toBe('gone');
    expect(await guide.track(form.id, { ...build, name: 'No such button' })).toBeNull();
  });

  test('any reads the containers too, and a tracked one answers its new size', async () => {
    expect((await guide.controls(form.id, 50)).controls.map(control => control.type)).not.toContain('Group');
    const group = (await guide.controls(form.id, 50, true)).controls.find(control => control.type === 'Group' && control.name === 'Options')!;
    expect(group).toBeDefined();
    const tracked = (await guide.track(form.id, group))!;
    expect(tracked.rect()).toEqual(group.rect);
    const { dlopen, FFIType } = await import('bun:ffi');
    const user32 = dlopen('user32.dll', { SetWindowPos: { args: [FFIType.u64, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u32], returns: FFIType.i32 } });
    const frame = guide.frame(form.id)!.rect;
    // SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE: the window grows to the right, the group with it.
    expect(user32.symbols.SetWindowPos(BigInt(form.id), 0n, 0, 0, frame.width + 60, frame.height, 0x2 | 0x4 | 0x10)).not.toBe(0);
    try {
      const grown = guide.frame(form.id)!.rect.width - frame.width;
      expect(grown).toBeGreaterThan(0);
      let now = tracked.rect();
      for (let attempt = 0; attempt < 20 && typeof now === 'object' && now.width === group.rect.width; attempt++) { await Bun.sleep(25); now = tracked.rect(); }
      expect(now).toEqual({ ...group.rect, width: group.rect.width + grown });
    } finally {
      user32.symbols.SetWindowPos(BigInt(form.id), 0n, 0, 0, frame.width, frame.height, 0x2 | 0x4 | 0x10);
      user32.close();
      tracked.release();
    }
  });

  test('an open menu or dropdown of the app is read first, once, marked with its window, and has no frame once closed', async () => {
    const { dlopen, FFIType } = await import('bun:ffi');
    const user32 = dlopen('user32.dll', { PostMessageW: { args: [FFIType.u64, FFIType.u32, FFIType.u64, FFIType.u64], returns: FFIType.i32 } });
    const post = (message: number) => expect(user32.symbols.PostMessageW(BigInt(form.id), message, 0n, 0n)).not.toBe(0);
    const until = async <T>(check: () => Promise<T | undefined> | T | undefined): Promise<T> => {
      for (let attempt = 0; attempt < 100; attempt++) { const found = await check(); if (found !== undefined) return found; await Bun.sleep(20); }
      throw new Error('never happened');
    };
    try {
      expect((await guide.controls(form.id, 50)).controls.filter(control => control.popup !== undefined)).toEqual([]);
      // A Win32 menu: a top-level #32768 window of its own, not under the form in UI Automation.
      post(0x8001);
      const read = await until(async () => { const found = await guide.controls(form.id, 50); return found.controls.some(control => control.name === 'Player Settings') ? found : undefined; });
      const item = read.controls.find(control => control.name === 'Player Settings')!;
      expect(item.type).toBe('MenuItem');
      expect(item.popup).toMatch(/^\d+$/);
      expect(item.popup).not.toBe(form.id);
      expect(read.controls[0]!.popup).toBe(item.popup);
      const menu = guide.frame(item.popup!)!.rect;
      expect(item.rect.left).toBeGreaterThanOrEqual(menu.left);
      expect(item.rect.top + item.rect.height).toBeLessThanOrEqual(menu.top + menu.height);
      const tracked = (await guide.track(form.id, item))!;
      expect(tracked.rect()).toEqual(item.rect);
      tracked.release();
      // The form itself is not one of its popups.
      expect(await guide.track(form.id, { ...item, popup: form.id })).toBeNull();
      post(0x8003);
      await until(() => guide.frame(item.popup!) === null ? true : undefined);
      expect((await guide.controls(form.id, 50)).controls.some(control => control.name === 'Player Settings')).toBe(false);

      // A WinForms dropdown: owned by the form, which also lists its items; hidden, not destroyed, on closing.
      post(0x8002);
      const items = await until(async () => {
        const found = (await guide.controls(form.id, 50)).controls.filter(control => control.name === 'Dropdown Item');
        // WinForms lists the items under the form a moment before their window shows.
        return found.some(control => control.popup !== undefined) ? found : undefined;
      });
      expect(items).toHaveLength(1);
      expect(items[0]!.popup).toMatch(/^\d+$/);
      const followed = (await guide.track(form.id, items[0]!))!;
      expect(followed.rect()).toEqual(items[0]!.rect);
      followed.release();
      post(0x8003);
      await until(() => guide.frame(items[0]!.popup!) === null ? true : undefined);
      expect((await guide.controls(form.id, 50)).controls.some(control => control.name === 'Dropdown Item')).toBe(false);
    } finally {
      post(0x8003);
      user32.close();
    }
  });

  test('a window that is gone has no frame and no controls', async () => {
    expect(guide.frame('1')).toBeNull();
    expect(await guide.controls('1', 5).then(() => 'read', error => (error as Error).message)).toContain('window 1 is gone');
    const mouse = guide.mouse();
    expect(typeof mouse.pressed).toBe('boolean');
    expect(Number.isInteger(mouse.x) && Number.isInteger(mouse.y)).toBe(true);
  });
});
