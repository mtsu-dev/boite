# Devices, windows and desktops

An agent can show you more than web pages. It can boot an Android emulator or
an iOS Simulator, capture a window of an app on your desktop, or run apps on a
desktop of its own. You watch the first two in the panel.

| Need | What the agent uses |
| --- | --- |
| Test a mobile app | An emulator, a simulator or a plugged-in Android phone, shown in the Device panel |
| Look at a desktop app you run, such as a game editor | A read-only capture of its window, shown in the Window panel |
| Run and click through a desktop app itself | A virtual desktop of its own |

## Simulators, emulators and Android devices

The agent uses the Android SDK and Xcode tools already on the machine that
runs the conversation. Boite installs nothing.

| Platform | Needs |
| --- | --- |
| Android | The Android SDK with Platform-Tools, and the Emulator package for emulators |
| iOS | A Mac with the Xcode command line tools |

Boite finds the Android SDK through `ANDROID_HOME`, then `ANDROID_SDK_ROOT`,
then Android Studio's own folder. Set one of them if your SDK is elsewhere.

### Watch and drive a device

1. Open the panel's Device surface, or let the agent open a device: the panel
   then opens on it.
2. Press Show on the card "This agent controls a device on" your machine.
   Nothing is captured before that. Hide stops it again.
3. To open one yourself, press **+** in the Device surface, then Open on the
   device you want. A platform that is missing says why.
4. On Android, tap or drag on the screen. The bar under it has Back, Home,
   Recent apps, Rotate, Power button, Enter and a delete key. Rotate works on
   emulators only.

On a computer, click the screen, then type. Escape is Back, and the wheel
scrolls. A phone uses the text field under the screen instead.

iOS Simulators are view only in the panel: the agent drives them itself.

### Live device stream

Experimental, in Nightly builds only: turn it on in Settings, Version,
Experiments, Live device stream.

Without it, the panel shows screenshots, a few per second, and only printable
ASCII text reaches an Android device. With it on, an Android emulator or phone
plays as live video, a drag is a real drag, any text can be typed, and copy
and paste work both ways. It has no sound. Text beyond ASCII goes through the
device's clipboard and replaces what it held.

## Windows of your desktop

An agent can capture a window of the machine's desktop, such as a Unity
editor, a game or Blender, as a picture, a short clip, or a live view in the
Window panel. Capture is read only: Boite never moves, raises or focuses the
window and never sends it input.

The first capture of an app in a project asks you in the chat:

- Allow once lets this one capture through.
- Always for this project adds the app to the project's allowed apps.
- Refuse, or no answer within 10 minutes, refuses it.

Every capture leaves a small picture of it in the conversation. On a phone you
get a notification for the request.

Settings, Safeguards has two lists:

- Windows agents may see: the apps each project may capture without asking. Remove
  one and the next capture asks again.
- Windows agents never see: names or paths no agent may capture, even with your
  permission. Password managers and the Windows sign-in and lock screens are
  always on it.

A minimized window is refused: restore it first. Window titles of apps you
have not allowed stay hidden from the agent.

| System | Window capture |
| --- | --- |
| Windows | Yes, even a window covered by others |
| Linux | On an X11 session only. Refused under Wayland and with no display |
| macOS | Not available yet |

## A virtual desktop for the agent

For an app the agent should run and click through itself, it starts a desktop
of its own. It reads the app's controls, clicks them and fills them, and
takes screenshots.

| System | What the desktop is |
| --- | --- |
| Linux | A private display in memory. Nothing reaches your screen, keyboard or speakers, so it also runs on a headless server |
| Windows | A hidden desktop of your session that no screen shows |
| macOS | The apps run in the background among your own |

On Windows and macOS the agent acts only through the app's controls: no
keyboard, mouse or clipboard, which stay yours. On macOS, grant Boite, or the
terminal that runs it, Accessibility and Screen Recording in System Settings,
Privacy & Security.

On Debian or Ubuntu, install what the Linux desktop needs once:

```sh
sudo apt install xvfb dbus-daemon at-spi2-core openbox
```

Windows and macOS need nothing installed. The desktop stops when the agent
stops it, when you archive the conversation, or when Boite stops.

## Limits

- Devices are those of the conversation's own machine. A phone plugged into
  another machine is not listed. A conversation shows at most four devices.
- Apps open on the virtual desktop with a fresh profile: your sign-ins are not
  there.
- An app that draws everything itself, such as a game, exposes no controls to
  the virtual desktop. The agent works from screenshots then.
- A conversation under an execution policy cannot start a virtual desktop.

## Going further

- [The right panel](panel.md): the Device and Window surfaces.
- [The agent's browser](browser.md): web pages the agent drives.
- [Experiments](experiments.md): features still being finished.
- [Phone](phone.md): watching a device from a paired phone.
- Technical reference: [devices](internals/devices.md),
  [windows](internals/windows.md), [desktop](internals/desktop.md)
