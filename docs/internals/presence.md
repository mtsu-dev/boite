# Discord rich presence

The `discord-presence` experiment, tagged `nightly`, shows "Playing Boite"
in the profile of the chat apps open on the computer that runs the desktop
app. The app builds the words, in its language, and the core sends them over
Discord's local IPC protocol to every chat app listening there. User guide:
[experiments](../experiments.md#discord-rich-presence).

## Pieces

| Piece | File | Role |
| --- | --- | --- |
| Contract | `packages/contracts/src/presence.ts` | `presence.set`, the `presence.status` event, the application id, the logo asset, the link and Discord's limits |
| Protocol | `packages/core/src/presence/ipc.ts` | Frames, the socket list, one connection per chat app |
| Service | `packages/core/src/presence/service.ts` | One activity, every socket, pacing, rescans, clearing |
| RPC | `packages/core/src/presence/rpc.ts` | Registers `presence.set`, refuses it in a build without the experiment and from any connection but this machine's owner |
| Words | `packages/ui/src/lib/presence/activity.ts` | Active threads to `details`, `state`, `startedAt` and `button` |
| Publisher | `packages/ui/src/lib/presence/publisher.svelte.ts` | Sends the words to the local core when they change, clears them when the switch goes off |
| Settings | `packages/ui/src/components/presence/PresenceSettings.svelte` | The project-name switch, a preview card and the list of chat apps that show it |

The core enters through `packages/core/src/presence-entry.ts` and the UI
through `packages/ui/src/lib/presence-entry.svelte.ts`. Each one writes
`__BOITE_HAS_DISCORD_PRESENCE__` in full, so a Release bundle holds none of
these modules ([out of the build](experiments.md#out-of-the-build)).

## The protocol

A frame is a little-endian `int32` op, a little-endian `int32` length and that
many bytes of UTF-8 JSON. Ops: 0 handshake, 1 frame, 2 close, 3 ping, 4 pong.
The core opens the socket, sends `{ v: 1, client_id }`, and waits up to 5 s
for the `READY` dispatch, which names the account (`global_name`, else
`username`). Each update is a `SET_ACTIVITY` command with
`{ pid, activity }` and a nonce; a command without `activity` clears it. A
`Close` frame, an `ERROR` event or a dropped socket ends that chat app's
connection and leaves the others alone. A frame over 64 KB closes the
connection.

Sockets are `discord-ipc-0` to `discord-ipc-9`:

- Windows: the named pipes `\\.\pipe\discord-ipc-N`.
- Linux and macOS: Unix sockets under `XDG_RUNTIME_DIR`, `TMPDIR`, `TMP`,
  `TEMP` and `/tmp`, and in the sandbox folders of the Flatpak and Snap
  packages of Discord, Canary, PTB, Vesktop, Equibop, Legcord and WebCord
  (`SANDBOXES` in `ipc.ts`). A path that does not exist is not dialled.

A chat app takes the first free number. Discord and a bridge for another app
listen side by side, so the core sends to every socket that answers, not
only the first. That is what makes one presence show in Discord and in a
second client at the same time.

## Clients

| Client | How it shows |
| --- | --- |
| Discord, Canary, PTB | Native IPC server |
| Vesktop, Equibop, Legcord, WebCord | arRPC, the same protocol; Linux sockets also in their Flatpak folders |
| Fluxer | No presence API yet. A community bridge that listens on `discord-ipc-N` and copies the activity to a Fluxer custom status shows it |
| Root | No presence or RPC API. Nothing shows until Root has one or a bridge exists |

arRPC answers `READY` with a placeholder user or none, so a target can have
`user: null`; Settings names it "a client without an account name".

## The service

- `presence.set(activity)` adopts the calling socket as owner. When that
  socket closes (the app quits or reloads), the presence is cleared.
- Each chat app gets at most one update every 4 s (`PRESENCE_PACE_MS`):
  Discord accepts five in 20 s. Updates inside the pause collapse into the
  last one, sent when the pause ends. An activity identical to the last sent
  is not sent again.
- While an activity is set, the sockets are looked for again every 15 s
  (`PRESENCE_SCAN_MS`): a chat app opened later shows it within that time.
- `presence.status` goes to the owner when a chat app answers or leaves.
- A clear sends an empty `SET_ACTIVITY`, then closes each socket with
  `end()`, so the clear frame is flushed before the close; a peer that keeps
  its side open is destroyed after 1 s.

The core adds the fixed parts: `type: 0` (Playing), the art asset `boite`
uploaded to Discord application `1575628367301058630` as the large image,
`large_text: "Boite"`, and one button to `https://mtsu.dev/projects/boite`.
`presenceParamsProblem` refuses lines outside 2 to 128 characters, a button
label over 32, a `startedAt` that is not a positive integer in milliseconds,
and any unknown field.

`presence.set` is owner only, and refused from a connection that is not
loopback (`ctx.connection.remote !== false`): the chat apps' sockets are on
the machine that runs the core, so a phone or a group member could only set
someone else's presence. A build without the experiment refuses an activity
with `experimentRefusal` and still accepts a clear.

## The words

`presenceActivity` reads the active threads (`running`, `queued`,
`waiting`) of every connected machine, private ones and archived ones left
out:

| Work | `details` | `state` |
| --- | --- | --- |
| None | Idle | none |
| One thread, names hidden | Coding with an agent | its model |
| Several, names hidden | Directing 3 agents | `Opus 5.5, GPT-6.2 Sol · 1 waiting` |
| Names shown | Working on boite +1 | `3 agents · Opus 5.5, GPT-6.2 Sol · 1 waiting` |

Two model names are listed, then `+N`. The project named first is the one
whose thread changed last. Lines over 128 characters are cut. The timer
starts at the earliest active thread's `runningSince` and holds while any
agent works, so a finished thread does not reset it; it is dropped when
nothing works.

Project names are off by default, per device (`localStorage`
`boite.presence.projects`): a profile is seen by everyone on the friend list.

The publisher runs in the desktop shell only. It talks to the store whose
core this shell started (`localCore`, connection `ready`) and calls
`presence.set` only when the JSON of the activity changes. Turning the switch
off, or that core going away, sends `null` to the core that showed it. A
reconnect has a new socket: the old one's close already cleared it, and the
next pass sets it again.

## Network

Boite opens no connection off the machine for this: it writes to local
sockets. The chat app then publishes the status to its own service, and it
fetches the logo from Discord's CDN by the asset key. Network flow row 48
lists it ([network](network.md)).

## Tests

- `packages/core/test/presence.test.ts`: fake chat apps on Unix sockets;
  broadcast to two, pacing, clear when the owner leaves, a late app, a `Close`
  frame, the socket list and the RPC refusals.
- `packages/ui/src/lib/presence/activity.test.ts`: the words.
- `tests/contract/presence.ts`: the same refusals and clear on the real core
  and the in-memory client.
- `packages/ui/src/components/ExperimentsPage.test.ts`: the preview under the
  switch.

Not covered by an automated test: Windows named pipes, which Bun's
`node:net` reaches by path, and a real Discord client.
