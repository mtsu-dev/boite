# Use Boite from a phone

Your phone opens the Boite of your computers: the agents keep running on the
machine, and the phone reads, starts and answers conversations. Add the phone
once and it reaches every machine of your [group](machines.md).

## Pick an app

| App | How to get it |
| --- | --- |
| Web app on iPhone | Open a machine's HTTPS address in Safari, then Share, Add to Home Screen. There is no iOS package. |
| Web app on Android | Install Boite on the phone's Settings, Notifications screen, or the browser's install menu. |
| Android app | Download `boite-android-<version>.apk` from a nightly release on the phone, allow the browser to install unknown apps, open Boite. |

The Android app opens Boite's own address, `https://boite.mtsu.dev`, in
Chrome, so app updates need no new APK. That address only serves the app:
conversations go from the phone to your machines, never to it.

## Make your computer reachable

The phone talks to the machine directly. On the computer, open Settings,
Advanced, Phone app and pick one way. Install, notifications and opening
offline need HTTPS.

| Way | Setting | What you get |
| --- | --- | --- |
| Tailscale | HTTPS through Tailscale, then Enable HTTPS via Tailscale | An HTTPS address on your tailnet. The phone needs Tailscale connected. |
| Local network | Reachable on the local network | The phone on the same Wi-Fi reaches the machine over plain HTTP. |
| Your own domain | Use another HTTPS address | Your reverse proxy's address, see [server](server.md#reach-it-from-other-devices). |

- The Tailscale card says what is missing and offers the way out. If Linux
  refuses the change, run `sudo tailscale set --operator=$USER` once.
- The local network switch applies from the next start; the desktop app
  restarts its core itself and running agents finish their current step.
- On Windows, Boite opens only on private networks: press Allow in Windows
  Firewall when it blocks Boite, and mark a public network private first.

## Add the phone

1. On a computer, open Settings, Machines and updates, Add a device.
2. On the phone, open the Boite app and tap Scan the code, or send it the
   copied link and tap Paste the link.
3. The phone lists every machine of the group and opens on that computer.

- The code works once, for ten minutes: treat it like a password.
- To take a phone out, press Remove from the group on its row there.
- On iPhone, add the Home Screen app from inside it, with its Scan button:
  it does not share Safari's storage, and the Camera app opens Safari.
- A link to a machine without an HTTPS address opens that machine's own page
  to finish. A link to a machine this device never met asks first: that
  machine sees everything you type.

## Allow the local network

Chrome 142 and later, and the other Chromium browsers on Android, block a
public page such as Boite's own address from your machines until you allow
it. Answer yes when the browser asks. If you refused, the app shows Allow the
local network: in the browser that runs the app, open Settings, Site
settings, Local network and allow the app's address. On Android, also allow
Nearby devices for that browser in Apps, Permissions. The app icon's Site
settings shortcut does not lead there. Troubleshoot walks through these
checks; if the machine's own address does not load either, check Tailscale,
the VPN or the Wi-Fi.

## Use it

- The bottom bar holds Conversations, Activity, a + for a new conversation and
  Settings, plus Bots and Contacts when those experiments are on.
- Slide a row left for Pin and Archive. Tap a conversation's title for its
  menu: the side panel, pin, rename, find, archive and delete.
- Enter writes a new line and the send button sends. With a physical
  keyboard, Ctrl+Enter or Cmd+Enter sends. Back closes the open sheet first.
- Pictures shrink to 2000 px on the long edge before they leave the phone.
- In the [agent's browser](browser.md), press Show, tap to click, drag to
  scroll and type in the field below the preview.

Provider accounts, keyboard shortcuts, resource limits, the brain,
the task manager, worktrees, diagnostics, voice engines, server settings,
forks and moving a conversation stay on the desktop. The terminal is the
owner's: a phone connected as the owner has it, with each shell in its own
tab, and a paired device has none.

## What a phone may do

A paired phone is limited to this:

| It can | It cannot |
| --- | --- |
| Read, start and answer conversations and the agents' cards | Change settings or sign agents in |
| Add a project on a machine of the group | Use Boite's data folder or folders like `.git` and `.ssh` as one |
| Read the Changes and Files panels | Edit files, open the terminal or Tasks |
| Click and type in the agent's browser, on sites signed in on that machine | Run scripts in it |
| See the devices in Machines | Add or remove machines and devices |

A project that is your home folder also shows files where tools keep their
tokens. Make a narrower folder the project before you add a phone.

## Notifications

1. In an app installed from an HTTPS address (on iPhone, the Home Screen app
   on iOS 16.4 or later), open Settings, Notifications, Enable notifications.
2. Tap Send test notification to check the push service accepts it.
3. Turn off the kinds you do not want: Approvals, Questions, Finished, Errors
   and Limits. The choice belongs to this device.

The app gets the notifications of the machine it was installed from, and
through it those of every other machine of the group. A finished turn waits
while you watch that conversation on another device, and reaches the phone at
most 45 seconds after you stop. Questions and approvals arrive at once.

## When the connection drops

An installed HTTPS app opens even with the machine off and shows Connecting
until it is back, or opens on another machine of the group that answers. The
phone stores no history. A prompt typed in a conversation already open waits
on the phone and leaves when the machine is back, even if you closed the app.
Another network, a VPN or a blocked port all end on the Waiting for your
computer screen.

## Limits

- Boite needs Safari 15.4 or Chrome 111 (17 or 114 for the full layout).
- An installed web app reaches only the group of the machine it came from.
- Notifications need the machine on, and delivery is not guaranteed.
- Over plain HTTP on a local network, anyone on that network can read the
  traffic. Tailscale or HTTPS keeps it private.

## Going further

- [Machines](machines.md): groups, several computers and switching.
- [Server](server.md): a machine without the desktop app, or on Android.
- [Experiments](experiments.md): the Bots and Contacts tabs.
- Technical reference: [phone](internals/phone.md), [Android](internals/android.md).
