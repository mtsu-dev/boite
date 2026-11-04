# Virtual desktop

`boite desktop` gives a conversation a desktop of its own for GUI apps. An
agent starts apps there and drives them through their accessibility tree with
[agent-desktop](https://www.npmjs.com/package/agent-desktop): it reads the tree
as a snapshot of `@ref` elements, then clicks, fills and reads them.

- Linux: a private display in memory. Nothing reaches the user's screen,
  keyboard, session bus or speakers, so it also runs on a headless server.
- Windows: a hidden desktop of the user's session, which no screen shows and no
  keyboard or mouse reaches.
- macOS: the apps run in the background among the user's own, and
  agent-desktop reaches only them.

On Windows and macOS input is semantic only: see
[Windows and macOS](#windows-and-macos).

[`boite window`](windows.md) is the other way to see an app: it captures windows
of the user's real session and never sends them input.

## Commands

```sh
boite desktop status
boite desktop run gnome-calculator
boite desktop snapshot --app gnome-calculator -i --compact
boite desktop click @e12
boite desktop type @e3 "hello"
boite desktop screenshot --app gnome-calculator shot.png
(eval "$(boite desktop env)"; bun run test:gui)
boite desktop stop
```

- `status` shows the desktop, its apps with their exit codes and log files,
  and what the machine lacks to start one.
- `start [--size WxH]` starts the desktop, 1280x800 by default, from 320 to
  3840 pixels a side. `run` starts it too when needed.
- `run <program> [args...]` starts a program on the desktop in the current
  folder. It outlives the turn. Its output goes to a log file, capped at 1 MB.
  `run` waits a second, so a program that exits at once reports its code and
  log. A desktop remembers its last 32 apps.
- `env` (Linux) prints `export` and `unset` lines for the agent's own tools,
  such as a test runner that opens a window. Use them in a subshell: they also
  move `HOME` and the XDG folders, where tools such as `git` and `gh` keep
  their settings and logins.
- `stop` stops every app, then the desktop.
- Any other word runs agent-desktop on the desktop with the words as given:
  `snapshot`, `click`, `type`, `press`, `find`, `wait`, `screenshot`,
  `list-windows` and the rest. `boite desktop skills get desktop` prints
  agent-desktop's own guide. Its output and exit code come back unchanged;
  `--json` wraps them. The guides and `--help` pages name their commands
  `boite desktop <command>`, the form that reaches this desktop; an app's own
  text in a snapshot stays as the app wrote it.

On Linux, agent-desktop's `--headed` sends real keys and clicks through the X
server instead of accessibility actions. It is safe there, since nobody else
uses the display: a web page's text field, for one, takes `type` only with it.
Windows and macOS refuse it. Refs come
from the last snapshot. A command that needs the desktop before one
exists fails with `no desktop yet` and runs nothing.

## agent-desktop

Nobody installs agent-desktop by hand. The first desktop of a core, or the
first command that needs the tool, has the core fetch one pinned release
(`AGENT_DESKTOP_RELEASE` in `packages/core/src/desktop/agent-desktop.ts`) from
the npm registry. The core checks the archive's SHA-256, unpacks the binary
for the machine's system and CPU (Linux, Windows or macOS, x64 or arm64) and
its helper (the clipboard owner on Linux, the macOS helper) with `tar`,
Windows' own `System32\tar.exe` there, checks each file's SHA-256 and moves
them together into a folder of
their own, `<data dir>/tools/agent-desktop-<version>/<install id>/`. An archive
or a file that does not match installs nothing. Concurrent commands share one
download, and a later core checks the installed files and reuses them. An
install folder is never changed once in place, so cores sharing a data dir need
no lock: two that download at once each keep their own, and a core removes only
a folder whose files no longer match, then installs a fresh one.

The CLI asks the core for that path (`desktop.tool`) and runs it from the
agent's shell with the desktop's environment, on Windows through the launcher
onto the hidden desktop. When the core could not install
it (offline, the registry down) or predates `desktop.tool`, an agent-desktop on
the agent's `PATH` runs instead; with neither, the command fails with the
reason. A refusal is final: under the `agentDesktop` policy, or on a machine
without the desktop's programs, no agent-desktop runs, and a desktop that was
already running when the policy came takes only `status` and `stop`.

## The Linux desktop

The core starts four programs per desktop, each in its own process group:

1. `Xvfb -displayfd 1 -nolisten tcp -auth <dir>/Xauthority` picks a free
   display and draws in memory.
2. `dbus-daemon` on a socket in the desktop's folder, with the standard
   session policy and no service directory: nothing starts on demand, so no
   keyring password prompt, portal or notifier opens over an app.
3. `at-spi-bus-launcher`, the accessibility bus on that session bus. The core
   waits for `org.a11y.Bus` through `dbus-send` before it goes on.
4. `openbox`, the window manager. Without one, agent-desktop finds no window.

The folder is a fresh `boite-desktop-*` under the system temporary folder. It
holds the X cookie, the bus socket, the app logs, the apps' XDG folders and
agent-desktop's own state.

Apps on the desktop get this environment, which `env` prints:

- `DISPLAY`, `XAUTHORITY` and `DBUS_SESSION_BUS_ADDRESS` of the desktop.
- X11 forced for GTK and Qt (`GDK_BACKEND`, `QT_QPA_PLATFORM`,
  `XDG_SESSION_TYPE`), and the accessibility switches of Qt and Chrome
  (`QT_ACCESSIBILITY`, `QT_LINUX_ACCESSIBILITY_ALWAYS_ON`,
  `ACCESSIBILITY_ENABLED`). Chrome exposes its page without
  `--force-renderer-accessibility`.
- No sound: PulseAudio and PipeWire point to a socket that does not exist,
  and SDL uses its dummy driver.
- `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`,
  `XDG_STATE_HOME` and `XDG_RUNTIME_DIR` in the desktop's folder. A
  single-instance app (Chrome, Firefox, Electron, VS Code) keeps its profile,
  lock and socket there, so it never hands its window to the same app on
  another desktop or in the user's session. Apps start with a fresh profile;
  copy in what one needs.
- `AGENT_DESKTOP_HOME` in the desktop's folder.
- `WAYLAND_DISPLAY`, `WAYLAND_SOCKET`, `AT_SPI_BUS_ADDRESS`,
  `SESSION_MANAGER`, `DESKTOP_STARTUP_ID` and `NO_AT_BRIDGE` removed, so no app
  reaches the user's own session.
- `BOITE_DESKTOP_ID`, the mark the stop looks for. `env` leaves it out: a
  shell that exported it would have its own commands killed by the stop. What
  the agent starts with `env` belongs to its own shell: a GUI program there
  loses its display and exits when the desktop stops, and the rest ends with
  the agent's process tree.

## Windows and macOS

Both share the user's session, so `boite desktop` keeps the agent to what an
accessibility action does on the conversation's own apps:

- Passed: `snapshot`, `find`, `get`, `is`, `screenshot`, `click`,
  `right-click`, `set-value`, `clear`, `select`, `toggle`, `check`,
  `uncheck`, `expand`, `collapse`, `scroll`, `scroll-to`, `wait`, the
  `list-*` commands, the window commands and agent-desktop's own `status`,
  `permissions`, `skills` and `help`.
- Refused, with the command to use instead: `--headed`, `type`, `press`,
  `key-*`, `focus`, the mouse commands, `double-click`, `triple-click`,
  `hover`, `drag`, the clipboard, the notifications, `open-system-surface`,
  `cursor-overlay`, `launch` (use `run`) and `batch`. A `--surface` other than
  an app's own window, menu, sheet, popover or alert is refused. The keyboard,
  mouse, clipboard, notifications, taskbar and Dock are the user's.
- Refused because they reach past the app's window: `--screen` (a whole
  display), `--screenshot` and `--debug` (an HTML capture), `wait --event` and
  `wait --notification`. `permissions` only reads: `--request` and `--guide`
  open prompts and settings that are the user's to answer.
- `close-app` finds the app by its name, which may be the user's copy:
  Windows refuses it, macOS refuses `--force` and checks the name as `--app`.
  `boite desktop stop` ends the conversation's apps.
- Type text with `set-value @ref "text"`, press a button or menu item with
  `click @ref`.
- `env` is refused: an environment puts no window on these desktops.
- `start` takes no size: the desktop has the size of the screen.
- The folder is a fresh `boite-desktop-*` under the temporary folder with the
  app logs and `AGENT_DESKTOP_HOME`. Apps keep the user's `HOME`.
- An app that keeps one copy per user would hand a new launch to the user's
  running copy, which opens the window on the user's screen. Chromium
  browsers (Chrome, Edge, Brave, Vivaldi, Opera) and the Electron editors (VS
  Code, Cursor, Windsurf) get `--user-data-dir=<folder>/profiles/<app>`,
  Firefox `-no-remote -profile <folder>/profiles/firefox`, unless the command
  gives a profile. They start with a fresh profile; copy in what one needs.
  Explorer is refused, and so are Notepad, Calculator, Paint, Office, Teams,
  Discord, Slack, Spotify, Steam, Obsidian and Windows Terminal while the user
  runs them.

### Windows

The core creates a desktop named `boite-<id>` in the interactive window
station `WinSta0` with `CreateDesktopW`. No screen shows it and no keyboard or
mouse reaches it. A process lives on the desktop that its
`STARTUPINFO.lpDesktop` names, and its children inherit it. The core starts
each app, and the CLI each agent-desktop command, through a launcher:
`boite-core --desktop-exec WinSta0\boite-<id> <program> [args...]` starts the
program there, waits for it and returns its exit code. The launcher is a
normal child of the core, so the app stays in the conversation's job, its
trace and its log, and stopping the launcher's tree stops the app. A `.cmd` or
`.bat` runs through `cmd.exe`, each argument escaped so that `&`, `|` or
`%NAME%` stays text.

UI Automation, `PrintWindow` and Windows Graphics Capture work on a hidden
desktop: snapshots, accessibility actions and screenshots behave as on screen.
Input made with `SendInput` only reaches the desktop on screen, which is why
`press` and `--headed` are refused rather than sent to the user's front app.

The folder's DACL grants only the user's account, set before anything is
created in it: agent-desktop refuses a state folder another principal may
open, and a temporary folder often lets in more.

Limits:

- A core running in session 0, as a service, or outside `WinSta0` gets no
  desktop, and `status` says why.
- A single-instance app missing from the list above hands its window to the
  user's copy the same way; the window then shows on the user's screen.
- The clipboard is shared with the user's desktop; agent-desktop's clipboard
  commands are refused, and an app's own Copy button still writes it.

### macOS

macOS has no hidden desktop that accessibility reaches, so the apps run in the
user's session, behind the user's windows. `run TextEdit`, or the path of a
`.app`, opens the bundle with `open -n -g -W -a <bundle> [--args ...]`:

- macOS kills an Apple app's executable that a parent other than launchd
  starts, so the bundle goes through LaunchServices.
- `-n` makes a new copy beside any the user runs, `-g` leaves the user's front
  app in front, and `-W` keeps `open` the core's child until the app quits.
- `--env BOITE_DESKTOP_LAUNCH=<random>` marks the copy. The core finds its
  pid among the new processes running the bundle's executable
  (`Contents/MacOS/<its CFBundleExecutable>`) by that mark, which `ps -E`
  shows, so a copy the user opens at the same moment is never taken for it.
- A stop sends `SIGTERM`, then `SIGKILL` after 3 s, to each such app whose
  pid still carries its mark, so a reused pid is never signalled. An app
  found after a stop began is stopped as soon as it is found.
- The app gets the user's environment from LaunchServices, not the core's.

A program that is no bundle runs as the core's child.

Every agent-desktop command must aim at an app the conversation started, the
running apps and the processes under them:

- `--window-id` must name one of their windows.
- `--app` must name one of their apps. When the user runs the same app too,
  the command is refused and names the conversation's window to use with
  `--window-id`.
- A ref from a snapshot is accepted right after the command, as
  `snapshot --root` and as `wait --element`: snapshots only reach those apps.
- A command with no target, which would read the user's front app, is
  refused.
- `list-apps` and `list-windows` show only those apps.

agent-desktop needs the Accessibility permission, and Screen Recording for
screenshots, granted in System Settings > Privacy & Security to the app that
launches it: Boite, or the terminal running the core.
`boite desktop permissions` says what is missing. The user grants it, or runs
`agent-desktop permissions --guide` from a terminal of their own.

## Security

- Linux: the display takes only clients that hold its cookie, a random
  MIT-MAGIC-COOKIE-1 in a 0600 file. Another account on the machine cannot
  open it, read its apps or type into them. Xvfb listens on no TCP port.
- Linux: the session bus listens on a socket in the desktop's 0700 folder.
- Windows and macOS: input stays semantic and macOS commands stay on the
  conversation's apps, as [above](#windows-and-macos).
- A conversation under an execution policy is refused: what its desktop starts
  would run outside that policy.
- The `desktop.*` methods are agent methods for the agent's own conversation.
  A paired device cannot call them. A session must subscribe to the
  conversation first.
- An archived conversation can read its status and stop its desktop, but not
  start one or run a program.
- The [admin policy](enterprise.md) key `agentDesktop: false` refuses starting
  a desktop, running a program and the agent-desktop download. `status` says
  so, and `stop` still ends a desktop started before the file.

## Lifetime

A desktop has no idle timeout. It stops when:

- the agent runs `boite desktop stop`;
- its conversation is archived or removed;
- on Linux, Xvfb, the bus, the accessibility bus or openbox exits;
- the core stops.

A Windows or macOS desktop runs nothing of its own: it opens empty and lasts
until one of the other stops.

Stops that overlap share one teardown. A desktop still starting when its
conversation is archived or the core stops has its programs stopped at once
and never opens.
On Linux a stop ends the apps, then the stack from openbox down, then sends
`SIGKILL` to any process left whose environment carries the desktop's
`BOITE_DESKTOP_ID`, then deletes the folder. An app that daemonized out of its
process group is caught by that mark. On Windows it ends the apps, kills any
process that still owns a window on the hidden desktop, closes the desktop and
deletes the folder.

## Platforms

Linux, Windows and macOS, x64 and arm64. A Linux machine needs `xvfb`,
`dbus-daemon`, `at-spi2-core` and `openbox`; `dbus-send` is optional. On Debian
and Ubuntu:

```sh
sudo apt install xvfb dbus-daemon at-spi2-core openbox
```

`status` names the missing packages. Windows and macOS need nothing installed.

Chrome, Electron, Qt and GTK apps expose their tree. An app that draws
everything itself, such as a game, has none: use `screenshot` and coordinates.

## Tests

`packages/core/test/desktop.test.ts` covers the Xauthority layout, the
environment, tool detection, the validators and the argument parsing. A
release archive built in the test covers the agent-desktop install: one
download for concurrent calls, executable files, reuse by the next core, and
nothing installed from an archive or a file whose digest differs. With the
four tools installed, it also starts a real desktop. It checks that an app sees
the desktop's display and no Wayland, and that the display refuses a client
without the cookie. A fake stack covers a stop or an archive that comes while
a desktop starts or stops. It then checks that archiving leaves no marked process and
no folder. The CI's Linux core jobs install the tools and run it.

`packages/core/test/desktop-shared.test.ts` covers Windows and macOS: the
commands passed and refused, the macOS target checks and list filtering, the
app bundle executable, the Windows command line quoting, and the service with
fake hidden desktops. On Windows it starts a real hidden desktop, runs
`charmap` on it, checks that its window is on that desktop and that `stop`
ends it. `BOITE_E2E_DESKTOP=1` adds the pinned agent-desktop download and a
snapshot, `set-value`, `get` and `screenshot` of `charmap` there;
`BOITE_E2E_DESKTOP_SHOT=<file.png>` keeps the capture. A batch file run on a
hidden desktop gets back arguments holding `&`, `%PATH%`, quotes and carets
unchanged, and runs none of them. On macOS, in a GUI session that granted the
terminal Accessibility and Screen Recording, `BOITE_E2E_DESKTOP=1` opens
Calculator, clicks 7, captures its window and checks that the front app did
not change.

`BOITE_E2E_DESKTOP=1` with agent-desktop and `google-chrome` on `PATH` adds a
live test: Chrome opens a page, agent-desktop finds its button in a snapshot,
clicks it, and the window title changes. A second conversation's Chrome then
opens on its own desktop, not in the first one's window.
