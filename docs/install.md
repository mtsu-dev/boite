# Install Boite

Boite is a desktop app for Windows, macOS and Linux. This page covers where
to download it, how to install it on each system and which channel to follow.

> [!WARNING]
> Boite is in beta and the current downloads are nightly prereleases. Nightly
> builds are unstable and may contain bugs or unfinished changes. Back up your
> Boite data before you install a build or switch channels.

## Download

1. Open the [download page](https://github.com/mtsu-dev/boite/releases).
2. Pick the newest release. Its notes list the downloads by platform at the
   top, above the changelog.
3. Choose the file for your system and processor:

| System | File |
| --- | --- |
| Windows | The x64 installer |
| macOS | The DMG for Apple Silicon or the DMG for Intel |
| Debian or Ubuntu | The `.deb` package, x64 or ARM64 |
| Other Linux distributions | The AppImage, x64 or ARM64 |
| Android phone | The `boite-android-<version>.apk` file, when the release has one |

## System requirements

- Windows: x64.
- macOS: 13 or newer, on Apple Silicon or Intel.
- Linux: x64 or ARM64, glibc 2.35 or newer and WebKitGTK 4.1. The packages are
  built on Ubuntu 22.04, so older distributions cannot start them.
- AppImage only: FUSE 2 (the `libfuse2` package).

## Install on Windows

Run the installer. Running it again for an update or a reinstall replaces the
existing installation in place and keeps your Start menu and desktop
shortcuts. If Boite is open, the installer asks you to close it first.

## Install on macOS

1. Open the DMG and drag Boite to Applications.
2. Start Boite from Applications, not from the mounted DMG: a copy that runs
   from the DMG cannot update itself.

Releases signed with a Developer ID are notarized and open normally. A build
signed ad hoc is refused on its first start. Allow it in System Settings,
Privacy & Security, or clear its quarantine attribute once in a terminal:

```sh
xattr -cr /Applications/Boite.app
```

## Install on Linux

- `.deb`: install it with your package manager. The package declares its
  system dependencies.
- AppImage: make the file executable, then start it. Keep the file writable,
  because an update replaces it in place.

Boite keeps its data in `$XDG_DATA_HOME/boite2` when that variable names an
absolute folder, otherwise in `~/.local/share/boite2`.

## Stable and nightly channels

Boite has two channels, chosen in Settings, Machines and updates, under
Release channel:

| Channel | What you get |
| --- | --- |
| Release | Regular releases. Turned off until the first stable release is published. |
| Nightly | Checked daily builds. They may contain unfinished changes. |

Both channels share one installation, your conversations and your settings.
A nightly build calls itself boite (de nuit) in the window title and the tray
tooltip, and uses a violet and magenta icon. [Updates](updates.md) explains
how to switch and what to back up first.

## The Android app

The Android app shows Boite on your phone. It connects to a computer or a
server that already runs Boite; the agents run there, not on the phone.

1. Download the APK on the phone from the release page.
2. Allow your browser to install unknown apps when Android asks.
3. Open Boite and pair it with your computer ([phone](phone.md)).

An APK from a newer release installs over the old one.

## After installing

1. Install and sign in to your agents, then connect them in Settings,
   Providers ([supported agents](supported-agents.md)).
2. Open a project, choose a model and start a conversation
   ([first steps](first-steps.md)).

## Going further

- [First steps](first-steps.md): the tour, connecting an AI and a first message.
- [Updates](updates.md): how Boite and its agents stay up to date.
- [Troubleshooting](troubleshooting.md): problems specific to macOS and Linux.
- [Phone](phone.md) and [server](server.md): Boite on a phone or a machine
  without a screen.
- Technical reference: [desktop updates](internals/updates.md),
  [platform readiness](internals/portability.md),
  [Android app](internals/android.md).
