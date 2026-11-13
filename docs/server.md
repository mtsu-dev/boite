# Run Boite on a server

Boite can run without the desktop app, on a server or a spare Android phone.
The agents run there under that machine's account, and your desktop app,
browser and phone connect to it.

## With Docker

The image holds the Boite web app, Git, ripgrep and the Claude Code, Codex,
OpenCode and pi agents, for Linux x64 and ARM64. Grok and Muse Code need an
image of your own. No sign-in is built in.

1. Download [compose.yaml](../compose.yaml) into an empty folder.
2. Start it and ask for a link:

   ```sh
   docker compose pull
   docker compose up -d
   docker compose exec boite-server boite-server pair --owner
   ```

3. Paste the printed link in your desktop app, Settings, Devices, Add
   machine. It works once: keep it out of logs.
4. Sign the agents in from Settings, AI accounts, Providers, or in the container, such as
   `docker compose exec boite-server codex login --device-auth`.

The server answers on `http://127.0.0.1:7337` of the Docker host. Put your
repositories in `/workspace`; paths you type in Boite are the container's.

| Volume | Path | Holds |
| --- | --- | --- |
| `boite-data` | `/data` | Conversations, accounts, settings |
| `boite-home` | `/home/node` | Agent sign-ins and your own tools |
| `boite-workspace` | `/workspace` | Your repositories and worktrees |

- A bind mount must be writable by UID 1000. Do not mount the Docker socket
  or the host's whole home.
- The memory cap is 4 GB and there is no CPU cap. Set `BOITE_MEM=2g` or
  `BOITE_CPUS=2` in a `.env` file beside `compose.yaml` to change them.

To update, stop the server, back up the three volumes, then pull:

```sh
docker compose stop -t 60
docker compose pull
docker compose up -d
```

`-t 60` lets running agents finish their current step; they resume after.
Pin a release with `BOITE_IMAGE=ghcr.io/mtsu-dev/boite/boite-server:v<version>`
in `.env`. To roll back, restore the matching backup and set `BOITE_IMAGE` to
the old image: an older version may not read newer data. Do not update with
`docker compose down -v`, which deletes your data. Give a nightly its own volumes.

## Reach it from other devices

- On a private network or VPN, set `BOITE_BIND` in `.env` to the host's
  private address, and change the host of the printed link to that address.
- For HTTPS, put a reverse proxy in front that forwards WebSockets and keeps
  the `Host` and `Origin` headers, and set `BOITE_PUBLIC_URL` to its exact
  `https://` address. Never expose plain HTTP to the internet.

## Without Docker

From a checkout of Boite, `bun run build:ui` then `bun run build:core:linux`
build a Linux x64 server. Copy `packages/core/dist/boite-core-linux-x64` as
`boite-core`, `packages/core/dist/boite`, and `packages/ui/dist` as `ui`, into
one folder such as `~/.local/lib/boite/`. Give it a private address and a
fixed port, never a public address: the connection is not encrypted. Keep it
running with `loginctl enable-linger <account>` and a systemd user service:

```ini
# ~/.config/systemd/user/boite.service
[Service]
ExecStart=%h/.local/lib/boite/boite-core --host <private address> --port <port>
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=BOITE_MACHINE_NAME=build-server
Restart=on-failure
RestartSec=5
KillMode=mixed
TimeoutStopSec=60

[Install]
WantedBy=default.target
```

`BOITE_MACHINE_NAME` is the name your devices see, else the host name. Data
lives in `~/.local/share/boite2`. On the server, run these with the path of
the install folder, here `~/.local/lib/boite/`:

- `~/.local/lib/boite/boite-core pair --owner` prints a link for a desktop
  app's Add machine.
- `~/.local/lib/boite/boite-core group join` joins your [group](machines.md)
  instead, so every desktop of the group drives it. It reads the invitation
  on standard input: paste it, then end the input.
- `~/.local/lib/boite/boite-core tailscale on` serves it on its tailnet
  HTTPS address. Linux may first need `sudo tailscale set --operator=$USER`.

Such a server, and the Android one below, update from Settings, Version,
Updates with owner access: Update installs, Cancel stops a download, and a
failed update restores the previous version and its data. On the server:
`boite server check`, `boite server update`, `boite server cancel`.

## On an Android phone

The Boite Server app runs Boite and its agents on the phone itself, in
[Termux](https://termux.dev); it is not the [phone app](phone.md). It needs a
64-bit ARM phone on Android 7 or later and Termux from F-Droid or GitHub.

1. Install Termux and Boite Server (`boite-server-android-<version>.apk` on
   each nightly release), then open Boite Server.
2. Allow it to run commands in Termux, then run the install command it shows.
3. Under Agents, press Sign in for Claude Code or Codex.
4. Run `boite-server pair` for a phone or browser link, or with `--owner` for
   a desktop app. The app also shows the link as a QR code.

`boite-server config host lan|tailscale|local` sets where it listens, and
`boite-server config name <text>` the name others see, from the next start.
Follow the app's Keep it running section: many phones stop background apps.

## What changes when Boite runs elsewhere

- Paths are the server's: type a project's path, there is no folder picker.
- Agents sign in on the server. Use the device-code sign-ins of
  [accounts](accounts.md), since a server has no browser.
- The CPU cap, focus guard and audio mute work on Windows only.

## Going further

- [Machines](machines.md): groups and switching between machines.
- [Phone](phone.md): HTTPS, installation and notifications.
- [Updates](updates.md): updating every machine.
- Technical reference: [server](internals/server.md), [Android](internals/android-server.md).
