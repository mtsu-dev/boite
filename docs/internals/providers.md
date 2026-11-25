# Providers

This page is the technical reference for contributors. To see which agents
Boite runs and how to connect one, read [supported agents](../supported-agents.md).

## Subscription proxy

The [provider gateway](provider-gateway.md#subscription-proxy) reference covers
the Douane connection.

### Switching the gateway from Limits

See [switching the gateway](provider-gateway.md#switching-the-gateway-from-limits).

### Douane on this machine

See [local Douane setup](provider-gateway.md#douane-on-this-machine).

### Moving connections to Douane

See [moving connections](provider-gateway.md#moving-connections-to-douane).

## MCP servers

Boite's [MCP server manager](mcp.md) passes configured servers to Claude, Codex,
Muse versions with host config overrides, and ACP agents that support HTTP MCP.
OpenCode 2 uses its native remote-server configuration. The pi driver and echo
have no Boite-managed MCP transport.

## The fields

OpenCode's descriptor, with the `linux` and `macos` profiles, `shared` and
`hookSources` left out:

```json
{
  "id": "opencode",
  "schemaVersion": 1,
  "name": "OpenCode", "shortName": "OpenCode",
  "protocol": "acp",
  "roots": ["{home}/.local/share/opencode", "{home}/.config/opencode", "{isolationDir}"],
  "profiles": {
    "windows": {
      "detect": {},
      "executable": [
        { "kind": "file", "value": "{agentsDir}/opencode.exe" },
        { "kind": "file", "value": "{npmRoot}/opencode-ai/bin/opencode.exe" },
        { "kind": "path", "value": "opencode", "major": 1 }
      ],
      "launch": { "args": ["acp", "--port", "0"] },
      "isolation": { "XDG_DATA_HOME": "{isolationDir}", "XDG_CONFIG_HOME": "{isolationDir}" },
      "close": { "processes": ["opencode.exe"] }
    }
  },
  "auth": { "kind": "oauth-cli", "session": ["opencode/auth.json"] },
  "login": { "command": ["opencode", "auth", "login"], "terminal": true },
  "models": [{ "id": "default", "name": "OpenCode default", "default": true }],
  "capabilities": { "approvals": true, "hooks": true, "checkpoint": false, "images": false, "planMode": false, "resume": true }
}
```

- `id` is the key everything refers to, and a user descriptor may not reuse a
  shipped one. `schemaVersion` is `1` and is checked. `name` and `shortName` are
  what the picker and the chips show.
- `protocol` picks the driver: `claude-sdk`, `acp`, `codex-appserver`, `muse`,
  `pi` or `echo`. OpenCode uses `acp`. A protocol with no driver behind it has nothing to run,
  so it is the one field that cannot be invented.
- `roots` bounds core-owned provider file access. Paths outside them and `..`
  segments are refused. It is not an OS filesystem sandbox for the agent.
- `profiles` holds one `OsProfile` per operating system, keyed `windows`, `linux`,
  `macos`. A provider with no profile for the running OS is not offered.
- `env` supplies common environment defaults for every OS profile; each profile's
  `env` overrides them before path tokens are expanded.
- `auth.kind` is `oauth-cli`, `api-key` or `none`, and `auth.session` names the
  files inside the isolation directory that carry the login, which is what the
  core reads to tell `ok` from `unauthenticated`. `auth.sqlite` is the same
  question for an agent that keeps its sign-ins in a database: a `file` inside
  the isolation directory and the `tables` that hold them. The account reads
  `ok` once one of those tables has a row, `unauthenticated` while none does or
  the file is not there yet, and `unknown` when the file will not open. The
  core opens it read-only and never writes it. `auth.identity` says where the
  account name comes from.
- `login` is either `command`, the argv of the provider's own login command plus
  an optional `env`, or `acp: { methodId }`, the `authenticate` method of an ACP
  agent whose sign-in has no command. `terminal: true` beside a `command` runs it
  in a real shell the user answers, for a login drawn as a menu
  ([accounts.md](accounts.md#signing-in-from-a-terminal)); it is refused on an
  `acp` login. A provider without one cannot be logged in
  from Boite; its account controls show the refusal.
- `models` is a `ModelInfo` list: `id`, `name`, an optional `default`, `legacy`
  (still accepted, folded away in the picker), `badge: "new"`, and an `effort`
  block of named levels with a default. A native agent may declare an empty list
  and let the probe supply its catalog. The unnamed `default` alias remains
  accepted for existing descriptors. Echo requires at least one static model.
- `experimental: true` marks an agent Boite drives without long use behind it.
  It stays off until the user turns it on ([below](provider-runtime.md#turning-a-provider-off)),
  and its row on the Providers page carries an Experimental badge.
- `capabilities` is six booleans: `approvals`, `hooks`, `checkpoint`, `images`,
  `planMode`, `resume`. `approvals: false` means the thread's permission mode
  never reaches that agent, and the UI stops promising a gate that does not exist.
  `hooks: true` says the agent runs hooks of its own, which is what lets the
  descriptor name `hookSources` and puts the agent in Settings > Brain > Hooks.
  `images: false` refuses a turn's image attachments before anything is sent, so an unsupported image cannot reach the provider. Where `images` is
  true, each protocol hands an attachment over in its own shape: the Claude
  driver turns the prompt into a content-block array, one text block plus one
  `{ type: 'image', source: { type: 'base64', media_type, data } }` block per
  attachment; ACP sends a `{ type: 'image', mimeType, data }` block alongside
  the text block of `session/prompt`, but only once the agent's `initialize`
  answer says `agentCapabilities.promptCapabilities.image` is true, or the turn
  fails before anything goes out; Codex appends one
  `{ type: 'image', url: 'data:<mimeType>;base64,<data>' }` entry per attachment
  to `turn/start`'s `input`; Muse appends one
  `{ type: 'image', base64Data, mediaType }` part per attachment to its own
  `turn/start` `input`; pi adds an `images` array of
  `{ type: 'image', data, mimeType }` entries to the `prompt` command.
  Each of them takes a turn's 50 images (`ATTACHMENTS_PER_TURN`) in that one
  prompt, with no count of its own: the bytes are what weigh, and the 10 MB
  turn total keeps the frame each driver writes the size it was with 20.
  Claude's API counts the images of the whole request, earlier turns included
  (platform.claude.com, build-with-claude/vision, read 2026-10-28): past 20,
  each must be within 2000 px (`IMAGE_MAX_EDGE`); a request takes 100 images
  on a 200k-token model and 600 on a 1M one, and its body stops at 32 MB.
  What the Claude CLI does once a conversation holds more images than that is
  its own business and is not tested here.

A thread's `/commands` come from wherever the protocol says an agent lists its
own, never from the descriptor: `commands(list)` on `TurnContext` carries the
whole list each time a driver learns or relearns it, and the core dedups and
tells the clients only on a change. Claude reads `Query.supportedCommands()`
once the CLI is up and takes a `{ type: 'system', subtype: 'commands_changed' }`
message on top of it for a mid-session change. ACP takes a `session/update`
whose `sessionUpdate` is `available_commands_update`, which an agent may send
right after `session/new` or `session/load`, before any turn; the driver keeps
the thread's latest `TurnContext` outside the running turn for exactly that
window, since the update carries no turn of its own to report through. pi asks
once per process, right after it comes up, with the `get_commands` RPC
command. Codex has no command listing, so its skills stand in for one: the
driver asks `skills/list` for the thread's folder once per process and again
on `skills/changed`, and lists the enabled skills whose name is one command
token, the first of a name winning; an answer older than the newest request is
dropped. A turn that opens on `/name` waits up to 5 s for the newest list; a
steer goes out at once with the skills known by then. Either way a listed
skill goes the way Codex's own composer sends one: the text with `$name` in
place of `/name`, plus a `{ type: 'skill', name, path }` item. A
Codex without `skills/list` is one log line and an empty menu. `muse.ts`
reads no commands from Muse's session protocol.

## Inside an OS profile

- `detect` is `{ command }` or `{ file }`. A provider whose detect does not
  resolve reports unavailable rather than failing at spawn.
- `executable` is an ordered candidate list, first hit wins. `kind: "file"` is
  an exact path and `kind: "path"` a name looked up on PATH. On Windows a PATH
  lookup passes over `.cmd`, `.bat` and `.ps1` launchers to the next PATH
  directory holding a real program of that name, and misses when there is none:
  the drivers spawn through node, which refuses a launcher script with EINVAL,
  so the agent reads as not installed and its row offers the install instead.
  A turn started on it is refused with the launcher script's path, so the
  reason is on screen rather than a bare "not available".
  A profile that names a launcher script as a `file` candidate keeps them, as
  Muse Code does, since its driver maps its launcher to its program. `kind: "npm"` names
  a globally installed package, `@scope/name#bin`, for the agents npm installs
  as a `.cmd` shim Bun cannot spawn. The core looks for the package under the
  npm prefix (`npm_config_prefix`, `%APPDATA%/npm`, the directory of `npm`,
  `node` or the bin on PATH), pnpm's and Bun's global directories and the usual
  Unix prefixes. It reads the bin script from the package's own `package.json`
  and runs it with the Node installed beside that prefix, else Node on PATH,
  else Bun. The script goes first on the command line, before `launch.args`, and
  the summary shows the script as the executable. Only the `pi` and `acp`
  protocols take an `npm` candidate: the SDK and app-server drivers spawn the
  program with no leading argument.
- A `path` or `file` candidate may name a `major`. It then counts only when
  the program found there reports that major version, read with the profile's
  `update.versionArgs`, `--version` by default. Two majors of one agent can
  install under one name: `opencode` on PATH is OpenCode 1 or OpenCode 2, and
  each has a descriptor of its own. A program at another major is passed over
  for the next candidate. The reading is kept per program path, with the size
  and modification time of its file, in `<dataDir>/executable-versions.json`,
  so asking costs one run of the program per install and none at a restart.
  Until a program has answered, the profile resolves to nothing rather than
  to a later candidate; the answer lists the providers again and
  `providers.updated` follows. Whoever must know what is installed right now
  waits for it, five seconds at most: `providers.list`, `providers.reload`,
  the turns a restart hands over, and the version read after an update, whose
  updater has just rewritten the program. A program that could not be run is
  passed over for the candidate behind it and asked again a minute later. A
  provider that is turned off is listed from what is already known and its
  program is never asked; turning it on asks it. A launcher script that
  stays the same while the program behind it changes is covered by one check
  per run of the core, at the first resolution half a minute or more after the
  reading is first used, and by another after an agent update. A program
  stopped at its 20 second deadline has given no answer: it is passed over and
  asked again, never recorded as having no version. An `npm` candidate takes no `major`: it
  already names its package (`packages/core/src/providers/versions.ts`).
- A `file` candidate that starts with `{npmRoot}` is looked for under each
  global npm `node_modules` directory, the same list an `npm` candidate walks,
  with the profile's `path` names as the bin hints. That is how Claude, Codex and
  OpenCode find the program their npm package vendors under nvm-windows, fnm,
  scoop or a custom prefix, where the shim on PATH is a `.cmd`. The token is
  expanded at each resolution, not at load, and only at the start of a `file`
  value.
- A PATH lookup, for a candidate, a `detect.command` or the npm roots, is
  remembered for 30 seconds per name and PATH, so the provider list and each
  turn start do not walk PATH again. What an `npm` candidate resolves to is
  remembered the same way, per spec, PATH and npm prefix variables. A
  remembered program or script that is gone is looked up again. A reload, a
  managed install or uninstall and an update forget every lookup; a program
  installed outside Boite shows up within 30 seconds, or at once on a reload.
- On Linux and macOS, a `codex` that PATH resolves to npm's
  `@openai/codex/bin/codex.js` launcher is replaced by the executable vendor
  binary the launcher would start (the platform package beside it, or the
  launcher's own `vendor/`). The updater still runs the launcher, which tells
  `codex update` which package manager owns the install. The launcher is a
  Node process that otherwise stays up beside each Codex process. A wrapper script in front of it, which may set limits of its
  own, is still what runs (`packages/core/src/providers/codex-launcher.ts`).
- `launch.args` put the agent into the mode Boite speaks to.
- `isolation` is the environment that makes one account blind to the others, with
  `{isolationDir}` substituted per account at spawn ([accounts.md](accounts.md)).
- `close.processes` names what the core closes when an account is removed, and is
  empty for an agent running under `node`: the process in the job is `node`, not
  the agent. `install` is the optional managed release, below.

An `update` block says how the user's own install updates itself; see
[agent updates](agent-updates.md).

## Hooks and shared configuration

Three optional descriptor fields carry the user's own configuration to isolated
accounts and tell Settings where the agent's hooks are ([hooks.md](hooks.md)).
Codex's:

```json
"shared": [{
  "variable": "CODEX_HOME",
  "paths": ["config.toml", "hooks.json", "AGENTS.md", "skills", "rules", "prompts", "plugins"],
  "retarget": { "config.toml": ["hooks.json", "config.toml"] }
}],
"hookSources": [{ "variable": "CODEX_HOME", "path": "hooks.json", "format": "events" }]
```

- `shared[].variable` is an isolation variable of the profile. Each path is
  relative to the directory it names: for the default account, the user's own
  (`~/.codex`); for an isolated one, the account's. At every spawn a directory
  there is linked and a file is copied ([accounts.md](accounts.md#what-an-isolated-account-shares)).
- `retarget` maps a copied file to the shared paths whose absolute location it
  may spell. The copy has each spelling (raw, forward slashes, doubled
  backslashes) rewritten to the account's own path. Codex needs it for
  `config.toml`, which keys each hook's trust by the path of `hooks.json`.
- `hookSources[]` is a place the agent reads hooks from, with the same
  `variable` and relative `path`, or no variable and a path starting with `~/`,
  for a file another agent owns: Grok reads Claude's `~/.claude/settings.json`.
  `format` is `events`, a JSON file or directory of them shaped like Claude's
  `hooks` block, or `modules`, a directory of plugin scripts.
- `sharedKeys[]` names top-level keys of a JSON file the account keeps as its
  own, set from the user's copy before every spawn. Claude's user-scope MCP
  servers live under `mcpServers` in `.claude.json`, beside its sign-in
  identity, so that file is never copied whole:
  `{ "variable": "CLAUDE_CONFIG_DIR", "path": ".claude.json", "home": "~/.claude.json", "keys": ["mcpServers"] }`.
  The user's file is `path` under the variable when the core's environment sets
  it, else `home`, else `path` under the variable's default.

A share or a source is refused at load when a path is absolute or has a `..`,
`.` or empty segment, when no profile isolates its variable, when a share's
variable is set outside `{isolationDir}` by any profile, when a `retarget`
entry names something outside `paths`, or when a shared path covers or sits
inside a file the account keeps to itself: `auth.session`, a profile's
`session` or a `seedFiles` entry. That is why OpenCode, whose config and data
homes are the same directory, lists `opencode/opencode.json` and its siblings
one by one and never `opencode`, which holds `opencode/auth.json`.
`hookSources` also needs `capabilities.hooks`. A `sharedKeys` file obeys the
same limits as a shared path, and needs at least one key and a `home` under `~/`.

The [account sharing guide](accounts.md#what-an-isolated-account-shares)
lists shipped configuration paths and link/copy behavior. [Hooks](hooks.md)
lists hook sources, reporting and probe exclusions.

## The tokens

Four expand when the descriptor loads, in `roots`, in every executable candidate,
in `launch.args` and in a profile's `env`. `{home}` is the home directory,
`{appdata}` the Windows roaming per-user directory, `{agentsDir}` is
`<dataDir>/agents/<providerId>/current`, where a managed install puts its files
(it resolves to a path that does not exist until they land, which is what makes
such a provider read as absent), and `{browserNoop}` is the launcher that does
nothing, for a `BROWSER` variable. A fifth, `{shippedDir}`, points at the shipped
descriptor folder, so a shipped login command can name a script beside it.
`{isolationDir}` is separate: it is per account and substituted
at spawn, in the `isolation` map and in a login command's `env`.

The driver adds model, effort and permission arguments; they are not descriptor
tokens. Grok needs it for the permission mode alone: the `grok` quirk splices
`--permission-mode <mode>` before the `agent` subcommand, or `--always-approve`
after it, on the way to the spawn. A probe has no thread, so it launches the
declared line as it is.

## Managed installs

An `install` block is how Boite ships an agent whose binary is not on the machine
and which has no installer of its own: a `version` (letters, digits and `. _ + -`,
since it names the release directory), a zip `url`, its `sha256`, its
`archiveBytes`, and every `files` entry expected out of the archive with its exact
size, the first one the executable.
Additional executable files declare `executable: true`; the installer gives
those files execute permissions on Linux and macOS. An optional `arch` field
names `x64` or `arm64`. A mismatched archive stays visible with an explanation
and is refused before downloading. Antigravity's pinned archives support x64
on Windows/Linux and ARM64 on macOS.

`format` defaults to `zip`. A `binary` download installs one executable directly;
its single `files` entry must have the same size as `archiveBytes`. `tgz` is a
gzipped tar, the shape of an npm package tarball: its members sit under
`package/`, and `files` names them with that prefix. Every format verifies the
download's length and SHA-256 before making it available. Claude on
Windows uses the official x64 binary this way. Its managed copy lives under
Boite's data directory, without replacing a CLI installation elsewhere.

A `binary` install can also name its publisher in `latest`: `versionUrl`, a
plain-text file holding the newest version; `manifest`, that version's JSON
manifest; `platform`, the key under the manifest's `platforms`; and `url`, the
binary. `manifest` and `url` contain `{version}`, and all three URLs are https.
Claude's release bucket has this shape, and its manifest gives each platform's
`binary`, `checksum` (SHA-256) and `size`. Install reads the publisher first,
unless it was read in the last minute, and downloads the release it names,
checked against the manifest's digest and size like a pinned one. The manifest's
binary name has to be the file the descriptor installs, `versionUrl` carries no
`{version}`, and a redirect off https is refused. A publisher that cannot be
reached, or a manifest that does not describe that binary, leaves the last
release read, or the pin when none was, and the core log says why. A release
that follows its publisher never goes back: an install or update naming an
older version than the one on disk is refused as up to date. The install card reads the publisher when a
client lists the providers and the last read is an hour old, never at startup.
Without this, a first install would land the release the Boite build pinned,
and an update could only reach the next pin.

Codex and OpenCode ship a Windows x64 release the same way, from their GitHub
releases; the Codex archive also carries `codex-code-mode-host.exe`,
`codex-command-runner.exe` and `codex-windows-sandbox-setup.exe`, unpacked beside
the agent as upstream ships them. Codex spawns the code-mode host from its own
directory to run its tools, so a pin whose archive lacks it, as 0.155.1's
did, leaves the agent unable to run any tool. The
managed copy is the first executable candidate, so an update reaches the agent
Boite runs even when an npm copy exists. `test/shipped-installs.live.test.ts`,
opt-in behind `BOITE_E2E_INSTALLS=1`, downloads each pinned release and runs `--version`.
Muse Code ships the same way on Windows x64, as the single binary Meta's own
installer downloads (`format: "binary"`, pinned with its SHA-256). The official
installer puts a `muse.cmd` launcher on PATH instead, which Bun cannot spawn, so
the driver reads `.muse-version` beside it and runs the `muse-bin-<version>.exe`
it names; a launcher with no such binary beside it is refused with a sentence
saying to install Muse Code from Providers.
OpenCode 2 ships on Windows x64 as the tarball of its npm platform package,
`@opencode/cli-windows-x64` (`format: "tgz"`), since it publishes no GitHub
release. Grok and pi have no archive Boite can pin, so their row links to the
agent's own install guide.

Settings > Providers offers the next install or sign-in step. Install adopts
an existing CLI login before `providers.updated`; otherwise it continues to
sign-in. Cancellation or leaving the page cancels that continuation. Returning
to the window checks for external installs. Provider families can group multiple
descriptors in one row. [Accounts](accounts.md#the-guided-connection) describes
the guided connection and account controls.

`providers.install` streams the archive to
`<dataDir>/agents/<id>/downloads/<version>.zip.part`, hashing as it writes, and
refuses a wrong digest or a wrong length naming both values. It unpacks with a
streaming unzip, or a streaming gunzip and tar reader, into `releases/<version>/`,
so no member is held whole in memory:
an entry that is absolute or carries a `..` segment is refused by name, a member
the descriptor does not list is skipped rather than written, and each listed file
is checked against its size once it is out. Then `current` is repointed, a
junction on Windows and a symlink elsewhere, and `.install-complete.json` is
written beside the files: that record, with its version matching the descriptor's,
is the only thing that makes a provider read as `installed`.

A bad connection does not start the download over. A dropped connection, a
server answer of 408, 429 or 5xx, or 30 seconds without a byte ends one attempt,
and the download tries again after 1, 2, 4, 8 and 16 seconds. Each retry asks
only for the missing bytes (`Range`, with `If-Range` carrying the server's ETag
or date); a server that sends the whole file again is read from the start. Once
the retries run out the install fails with how far it got, and keeps the `.part`
beside a `.part.json` naming its URL and digest. The next install of the same
archive hashes those bytes again and resumes after them. A body longer than
`archiveBytes`, or a `Content-Length` that disagrees with it, is refused at once.

Free space is checked first, against the archive plus the unpacked files plus a
256 MB margin, less what a kept `.part` already holds. A cancel aborts the fetch
and leaves no `.part`. Nothing goes into the journal, so a core that stops
mid-download comes back saying `absent`, and its `.part` stays for the next
install to resume.
`providers.uninstall` deletes `<dataDir>/agents/<id>` and is refused while a lease
is held, and one is held for every process a thread, probe or login launched.

An update installs the new release beside the old one and repoints `current`.
The old release is deleted as soon as no lease is held: right after the update,
or when the last process of that provider ends. A core that starts also deletes
every release `current` does not point at, and every download except the `.part`
of the version the descriptor pins. A provider that follows its publisher keeps
its downloads at startup, since the release it was fetching may be newer than
the pin; each successful read of the publisher then deletes every download but
the one of the release it names. A file Windows still holds is logged and
left for the next of those moments.

## What ships

Eleven descriptors ship, and only the first ten are ever visible to a user: `echo`
is the deterministic fake the tests and the bench run on, loaded only under
`BOITE_ECHO=1`.

| Provider | Protocol | Launch |
| --- | --- | --- |
| Claude | `claude-sdk` | SDK-driven CLI |
| OpenCode | `acp` | `opencode acp --port 0` |
| OpenCode 2 | `acp` | `opencode2 acp`, experimental and off until turned on |
| Antigravity | `acp` | Managed `agy_acp_server` for the host OS |
| Grok | `acp` | `grok [permission flags] agent [approval flag] stdio` |
| Hermes Agent | `acp` | `hermes acp` ([below](provider-runtime.md#hermes)) |
| Mistral Vibe | `acp` | `vibe-acp` ([below](provider-runtime.md#mistral-vibe)) |
| Codex | `codex-appserver` | `codex app-server` |
| Muse Code | `muse` | `muse serve --trust-workspace [MUSE_HOST_SETTINGS] [mode flags]` |
| pi | `pi` | Package bin through Node or `pi --mode rpc` |
| Echo | `echo` | In-process fixture |

[Accounts](accounts.md#the-isolation-directory) owns isolation variables,
session-file locations and login behavior. Descriptor model lists are fallbacks;
native probes supply account-specific models and capabilities. Windows npm
shims require a vendored binary or supported `npm` candidate. Managed desktop
versions are pinned in `packages/core/src/providers/shipped/*.json`; server image
CLI versions are separate pins in `docker/agents/package.json`.

The Claude driver loads the SDK's `/core` entry on demand for queries, quota
reads and protected tools. This entry shares installed dependencies and leaves
the SDK's unused session helpers out of the core bundle.

Antigravity requires a managed install and always-isolated accounts. Its
descriptor uses additional fields available to other providers:

- `env`, on an OS profile, is environment every process of the provider gets,
  whatever its account, unlike `isolation`. Antigravity uses it for the harness
  path and for a `BROWSER` pointed at `{browserNoop}`, so the agent never opens a
  window on its own. Off Windows that is a script exiting 0 that the core writes
  under the data directory. On Windows it is the command line
  `'C:\Windows\System32\cmd.exe' /d /c exit 0 '"%s"'`: Python starts a `.cmd`
  file through `cmd.exe`, which split the sign-in link at its `&`, failed, and
  left Python to open the default browser. The `%s` makes Python split the value
  like a POSIX shell, so the path keeps its backslashes (`cmd` reads `C:/Windows`
  as switches) and the link reaches `cmd` quoted.
- `unsetEnv`, on an OS profile, names variables taken out of the inherited
  environment before the spawn, so a key the user set for their own tools cannot
  redirect the agent Boite runs.
- `session`, on an OS profile, replaces `auth.session` on that OS. An empty list
  says the login can live outside any file there: the `auth.session` files still
  read `ok` when present, and without them its accounts read `unknown` and turns
  still start. A CLI that is signed out reads `unknown` as well, so its default
  account is adopted instead of leaving room for the guided sign-in. Claude's
  macOS and Windows profiles set it. Claude Code keeps its login in the macOS
  Keychain, and writes `.credentials.json` only when the Keychain is out of
  reach. On Windows, Claude Code moves the login from `.credentials.json` into
  Credential Manager once the `tengu_windows_credman` flag, cached in Claude
  Code's config, turns that storage on; the move happens at the CLI's next
  start. Without the empty list, an account that read `ok` would read
  `unauthenticated` after that move and every turn would be refused, though the
  CLI stayed signed in.
- `seedFiles`, on the descriptor, maps a relative path to content written under
  the isolation directory before anything starts. Antigravity needs
  `antigravity-acp/settings.json` holding `{"auth":{"type":"oauth-personal"}}`.
- `login.acp.methodId` is the other shape of the login block: instead of a
  command, the core starts the agent itself, sends `initialize` then
  `authenticate` with that method, and forwards the sign-in link the server
  prints. The redirect URL pasted back is fetched once by the core, which is how
  a phone finishes a sign-in whose loopback listener runs on the core's machine.
  The paste is checked against the `redirect_uri` of the link the agent printed,
  same port and same path, so the fetch lands on the agent's listener and
  nowhere else on the machine. [accounts.md](accounts.md) has the flow.

`quirks` turns on a dialect the ACP driver knows, and there are three.
`quirks: ["antigravity"]` folds a tool call's command, working directory and
output under one spelling and draws an `interaction_` permission request as the
agent's own question; its modes are `default`, `auto_edit` and `yolo`, with no
plan mode. An `invoke_subagent` call (titled `Running invoke_subagent` or `Run
invoke_subagent?`; agents before 1.4.1 name it `start_subagent`; without
`_meta.is_mcp_tool_call`) carries the batch it launched as `nativeAgents`, listed in Subagents: the call returns once the batch
is launched, its output is the launch's description, and the agent reports no
child ids, names, models or results, so the batch stays running while the turn
runs and reads unknown after it; only a failed launch is final, with its error.
From 1.5 the children of an `invoke_subagent` call, and the workers a `swarm`
call adds, outlive the prompt: the coordinator ends it to wait for them, and
when one reports, the agent wakes the coordinator and streams its next reply
with no prompt open. The protocol says none of this, so after a prompt that
ends this way the driver reads the agent's records under `GEMINI_HOME`
(`antigravity-acp/brain/<session>/.system_generated/`: `subagents/`, each
conversation's `messages/` inbox, `swarm/members.json` and
`logs/transcript.jsonl`, in `drivers/acp/detached.ts`). The turn stays open
while a child launched by one of its calls has not reported in the session's
inbox and is neither killed nor parked, while the agent owes the session a
reply, while a tool that reply started runs and while a question or a
permission waits for the user. It ends 3 s after the last of these, with no
update from the session since. The reply the agent starts on its own is drawn
into that turn. Stop on a held turn closes the
process, and its children with it. An unreadable record holds nothing open.
The same quirk changes three things in how Boite talks to it, found on the 1.4.5
agent on 2026-11-04:

- Every `initialize` (probe, sign-in, session) names the client `zed`. Named
  anything else the agent lists Gemini 3.8 Flash only; named `zed` it adds
  Claude Sonnet 4.6 (Thinking), Claude Opus 4.6 (Thinking) and GPT-OSS 120B
  (Medium).
- From 1.4.2, every `session/new` and `session/load` carries
  `_meta.antigravity.disabledTools: ["run_workflow"]`. Without it the agent
  writes `skills/system/run-workflow/SKILL.md` into the project.
- The `model` option lists each family once (`gemini-3.8-flash`), and Gemini's
  thinking is a `thinking_level` option of category `thought_level` (low,
  medium, high), so Boite shows it as that model's effort; Claude and GPT have
  none. The `models` list of the same answer still carries the pre-1.4 ids
  `gemini-3.8-flash-low`, `-medium` and `-high`, which the agent takes as a
  model and turns into the family plus that level. A thread or mochi saved on one
  of them keeps running: its id is sent as is, and the check that refuses an
  unlisted model accepts an id that is a listed family followed by `-<level>`.
A shell call (`kind: execute`) still running when the prompt answers is the
thread's background work: the process stays up past the warm window, and the
thread's next turns run on it, until the command's own update ends it, and Stop on the idle thread closes the process,
the only way to end such a command since `session/cancel` stops prompts alone.
A GIF goes to the agent as a saved file, the server taking PNG, JPEG and WebP
blocks only. On Linux the launch environment names the first CA bundle found
(`NIX_SSL_CERT_FILE`, then the usual `/etc` paths) as `SSL_CERT_FILE` unless
`SSL_CERT_FILE` or `SSL_CERT_DIR` is set, since the server's bundled Python
finds none on NixOS. `quirks: ["grok"]` selects Grok behavior
(`packages/core/src/drivers/grok.ts`). Text sent while a prompt runs, an
asynchronous answer or a coordination message, goes out as Grok's
`_x.ai/interject { sessionId, text }`, which joins the running turn at its next
tool or model gap. It is sent only while the prompt is in flight, since an
idle Grok runs the text as a turn of its own; an agent that refuses the method,
Grok before 1.0.41, keeps the text for the next turn. The probe reads each model's own effort
scale out of its `_meta.reasoningEfforts`, which is where Grok writes a per-model
scale. The thread's model and effort go out as one
`session/set_model { sessionId, modelId, _meta: { reasoningEffort } }` right
after the session opens, never as a `session/set_config_option`, which Grok
answers with method-not-found; the call is skipped when the thread is on the
agent's own model with no effort set, and skipped again when the session answer
already reports that model and that effort. And the permission mode rides on the
command line, because Grok advertises no `availableModes` for a
`session/set_mode` to match: `default`, `acceptEdits` and `plan` become
`--permission-mode <name>` before the `agent` subcommand, `bypassPermissions` and
`dontAsk` become `--always-approve` after it. A mode is fixed for the life of the
process, so it joins the session key the way Codex's approval pair does and a
change drops the process. Nothing ever sends `authenticate` to Grok: an account
with no `auth.json` is refused before a turn starts, and `authenticate` on an
empty home opens a browser. `quirks: ["hermes"]` reads a `session/load` answer
without `modes` as a session that is gone ([Hermes](provider-runtime.md#hermes)).

An agent whose session answer lists `models` but offers no `model` config
option takes the thread's model as `session/set_model { sessionId, modelId }`,
with no effort, at the start of each turn the model moved; a thread put back on
the descriptor's `default` asks for the model the first session reported as
current. Hermes Agent is that agent today.

An ACP thread resumes its session with `session/load` when the agent
advertises `loadSession`. When the agent refuses that load while its process is
alive, what the refusal says decides. -32002 (resource not found), a missing
`session/load` method, or a reason that names a missing session means the
conversation is gone: the core forgets the session id, starts a new session
generation and runs the same turn again, once, on a fresh session whose prompt
carries the conversation so far. A turn the user stopped meanwhile stays
stopped. -32000 (authentication
required) and -32800 (cancelled) leave the session alone: the turn fails with
the agent's reason and the next turn loads the session again. Any other error,
such as an internal one, keeps the session the first time; the same session
refused that way on the next load too counts as gone, since OpenCode answers a
missing session with its generic -32603 "OpenCode service failure". An agent
without `loadSession` opens a new session whenever a turn finds no process
holding the thread's session, whatever ended it (the turn itself, the idle
window, an archive, a restart); that turn's prompt carries the conversation so
far, and the log says the agent cannot load a session. Stop sends
`session/cancel` and gives the agent three seconds to end the turn before the
process is dropped; a
stop while the process or the session is still starting drops it at once. An
agent that exits before it answers `initialize`, in a turn, a probe or a login,
fails with its exit code and the last line it wrote to stderr. Stderr is read in
whole lines, a line cut at 64 KB. A tool's text output and a markdown document
are cut at 64K characters with a note saying where, and a diff whose two sides
pass that size is drawn as a sentence giving its size.

## OpenCode 2

OpenCode 2 is another program than OpenCode 1, published as `@opencode/cli`
beside `opencode-ai`, and its descriptor `opencode-v2` ships beside `opencode`
as an experimental provider. Both speak ACP to the same driver. What the
descriptor accounts for, each point read off OpenCode 2.0.24 on Linux:

- The two install under one name. The npm package and the installer both put
  a program called `opencode` on the machine, where OpenCode 1 already is, and
  add `opencode2` beside it. So `opencode-v2` looks for `opencode2` first, then
  for the npm package's own binary, and takes a program called `opencode` only
  at major 2. `opencode` takes it only at major 1, and falls back to the
  `opencode-ai` package's own binary when the name on PATH went to version 2.
- `opencode acp` takes no `--port`: version 2 refuses the flag and exits.
- Its own subagent tool is denied, as version 1's `task` is, since delegation
  goes through Boite. The profile's `env` sends it in version 2's syntax, a
  `permissions` rule on the `subagent` action, as `OPENCODE_CONFIG_CONTENT`.
- Default profiles use separate XDG homes: `~/.local/share/opencode-v2`,
  `~/.config/opencode-v2`, `~/.local/state/opencode-v2` and
  `~/.cache/opencode-v2`. OpenCode adds its `opencode/` subdirectory to each.
  This keeps version 1's database locks and incompatible plugins out of version
  2. Login checks, login terminals, hooks and isolated-account sharing use
  these same homes, rather than an inherited version 1 XDG directory.
- A sign-in is a row of `opencode/opencode.db`, in its `credential`, `account`
  or `control_account` table, which `auth.sqlite` names. Version 2 never reads
  version 1's `auth.json`: each is signed in on its own, even on the default
  account. Session databases are separate too; a thread cannot reuse a native
  session from the other version.
- Every command but `acp` talks to a background service that outlives it and
  listens on one fixed port, so a second account could never start its own.
  Boite never starts it: turns and probes run over `acp`, which serves itself,
  and the login command is `opencode2 auth login --standalone`.
  `XDG_STATE_HOME` is isolated under `{isolationDir}/state`, beside the XDG
  pair OpenCode 1 isolates, so a command typed by hand in the login terminal
  registers its service in the account's folder and not in the user's.
- OpenCode Go usage is read with the key version 2 stored for `opencode-go`
  in the `credential` table (`packages/core/src/providers/opencode.ts`).
- The plugin API changed: a plugin written for version 1 does not load in
  version 2. Version 2 loads plugins from its own configuration home only.
  Isolated version 2 accounts share those plugins; Settings counts that source.
- Its managed install on Windows x64 is the npm platform tarball, unpacked to
  `{agentsDir}/package/bin/opencode.exe`, the first executable candidate. It
  never claims the `opencode` name, so OpenCode 1 stays where it is. Linux and
  macOS have no managed install and link to the install guide.

`test/opencode2.live.test.ts`, opt-in behind `BOITE_E2E_OPENCODE2=1`, turns the
provider on, runs a turn, resumes it on a new process and moves the session to
`plan`. Behind a [subscription proxy](#subscription-proxy) it was run against a
local stand-in for the gateway, which received the turn on its Chat
Completions route with the key and the gateway's own model id; no turn went
through a real Douane or CLIProxyAPI. Not verified either: Windows and macOS,
and an OAuth sign-in. Images are on: 2.0.30 answers `initialize` with
`promptCapabilities.image` true, and an ACP image block reached a stand-in
gateway, declared with the same provider block Boite writes, as a Chat
Completions `image_url` part. OpenCode 1 stays at `images: false`: 1.19.2 also
advertises images, but replaces one with an error text for a gateway model
that declares no image input, which is every model the gateway block lists.

## A local ACP command

The Providers page has a Local ACP command card for any agent that speaks ACP
over stdio: a name, the command that starts it, its arguments one per field and
its environment variables. `providers.addLocal` checks each field
(`checkLocalAcpCommand` in `packages/contracts/src/local-acp.ts`, which the
in-memory client runs too) and refuses with the field it names (`name`,
`command`, `args[1]`, `env.KEY`), which the form marks.

- The id comes from the name: lowercase letters, digits and dashes. A name
  whose id a provider already has, or whose `<id>.json` already exists, is
  refused; nothing is overwritten.
- The command is a program on PATH or an absolute path. A relative path is
  refused, and so is a program this machine cannot start; on Windows a `.cmd`,
  `.bat` or `.ps1` launcher is refused with the program to enter instead.
- Arguments go to the program as written, one argument per field, with no shell
  and no quoting. `{home}` and the other load-time tokens expand as in any
  descriptor.
- Environment values are saved in plain text in the provider file. An API key
  belongs in the agent's own sign-in. A variable named `__proto__` is refused:
  the descriptor loader builds a plain object, which drops that key.

The core writes an ordinary user descriptor to `<dataDir>/providers/<id>.json`
(`localAcpDescriptor` in `packages/core/src/providers/local-command.ts`) and
reloads, so the loader and the ACP driver treat it like a file written by
hand. It has no login and no isolation: the default account
starts the agent with its own sign-in and settings. Its only model is
`default`, which leaves the agent on the model it is configured with until the
models probe reads the agent's list. A file that fails to load is deleted again
and the refusal is returned.

The provider's details offer Remove provider. `providers.removeLocal` refuses a
shipped provider and a provider with a turn running, releases its warm
processes and deletes the file. Accounts and threads stay, and come back when
the same name is added again. Both methods are the owner's; there is no edit,
only remove and add.

## Provider runtime

See [provider runtime](provider-runtime.md) for permission modes, model
discovery, session startup, and protocol-specific behavior.

### The models probe

See [model discovery](provider-runtime.md#the-models-probe).

### Permission modes

See [approval and sandbox modes](provider-runtime.md#permission-modes).

### Claude's system prompt

See [Claude's system prompt](provider-runtime.md#claudes-system-prompt).

### Claude's MCP servers on demand

See [Claude's stdio MCP proxy](provider-runtime.md#claudes-mcp-servers-on-demand).

### Codex startup

See [Codex startup](provider-runtime.md#codex-startup).

### Mistral Vibe

See [Mistral Vibe](provider-runtime.md#mistral-vibe).
