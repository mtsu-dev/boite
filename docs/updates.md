# Updates

Boite checks for new versions of itself and of your agents, and installs them
without losing the work under way. This page covers both, and what happens to
an agent that is running when an update starts.

## How the app updates

The desktop app checks for a new release 8 seconds after it starts, then
every six hours, and again when you bring the window back after more than 15
minutes. When something can update, an update button appears at the foot of
the app rail, beside Settings.

1. Press the update button. Its card lists each machine with the version it
   runs and the new one.
2. Press Update the app for this app alone, or Update all to update the app,
   your other machines and their agents at once.
3. Once the download is verified, press Restart.
4. Confirm in the Install the Boite update? dialog. Boite restarts on the new
   version.

On a wide window the card opens by itself once per release. Remind me later
puts that release off, even after a restart; a newer release shows it again.
On a phone the card opens only when you press the button, as a sheet.

Settings, Machines and updates has the same controls: the installed version,
the release found with its changelog, the channel, Check for updates and
Update. Each machine's row there reads Up to date, Update available,
Updating or Update failed.

### Install updates by itself

Turn on Install updates by itself when nothing runs, in Settings, Machines
and updates, to skip the click. It is off by default. A release found by the
six-hour check then installs only while the window is hidden in the tray and
no conversation, queued message or process runs. Boite comes back in the
tray. Otherwise it tries again at the next check. It does not touch agents.

### Switch between Release and Nightly

1. Back up your Boite data. On Windows it is in `%LOCALAPPDATA%\boite2`, on
   macOS in `~/Library/Application Support/boite2`; on Linux,
   [install](install.md#install-on-linux) gives the folder.
2. In Settings, Machines and updates, press Release or Nightly.
3. Boite checks that channel at once and downloads its newest release.
4. Press Restart, then confirm. Boite comes back on the other channel.

Going back from Nightly to Release is allowed even when the version number is
lower. Both channels keep the same conversations, accounts and settings. When
the other channel's newest build cannot read your data yet, or does not say
whether it can, the card says so and installs nothing: Boite stays where it is
and offers the first build of that channel that can read it.

### Limits

- Only installed builds update: the Windows x64 installer, the macOS app and
  the Linux `.deb` or AppImage. A browser cannot install an update.
- A `.deb` update asks for the administrator password. An AppImage needs its
  file to stay writable. A macOS copy running from the mounted DMG cannot
  update.
- Another Windows PC of your group can be updated from here, but only while
  Boite is open there, even hidden in the tray. Otherwise its row reads Boite
  is not open on, followed by the machine's name.
- A failed check or download shows in the card with a retry. When GitHub
  limits requests from your network, the card shows how long it waits.

## How agents are updated

Each machine checks its own agents every six hours. Open Settings, Providers
for that machine and find the Agent updates card:

- Each agent shows its installed and available version, with Update and Skip.
- Skip stops offering that version. A later one is offered again, and Offer
  it again brings back the skipped one.
- Automatic updates makes that machine update its agents by itself. It is off
  by default.
- An agent whose newest version Boite cannot read shows Checks by itself and
  Run its updater.

The app rail's update card and Update all include agent updates too.

## What happens to running agents

### During an app update

Agents finish their current tool call, 30 seconds at most, then Boite
updates and restarts. After the restart:

- A cut turn continues as Resumed after a restart. The agent is asked to
  check the results of interrupted commands before going on. Images of the
  original request are not sent again.
- Queued messages stay queued and run on the new version.
- Subagents and workflow steps continue the same way.
- Nothing resumes for a conversation you stopped, or when Boite stayed
  stopped for more than an hour.

### During an agent update

An agent update never cuts a tool call. Each running turn goes on until no
tool runs and no card waits for you, then pauses: the conversation shows, for
example, Paused while Codex updates. Once the update is done, the same turn
continues and shows Resumed after the Codex update, with the new version, or
Resumed: the Codex update failed.
Messages you send meanwhile wait in the queue and start on the new version.

- If other turns of the agent have not reached a pause 15 minutes after the
  first one, the paused turns go on and the update runs as soon as nothing of
  that agent runs.
- Stop during a pause ends the turn; the update goes on.
- An automatic update also waits, two hours at most, for background work an
  agent left running, such as a test loop or a dev server. An update you start
  by hand does not wait. Work it ended resumes on the new version.

## Going further

- [Install](install.md): downloads and channels.
- [Machines](machines.md) and [server](server.md): updating other machines
  and a headless server.
- [Subagents](subagents.md) and [workflows](workflows.md): delegated work
  across restarts.
- Technical reference: [desktop updates](internals/updates.md),
  [agent updates](internals/agent-updates.md),
  [restart handoff](internals/restart-handoff.md).
