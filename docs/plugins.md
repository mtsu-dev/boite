# Plugins

A plugin adds to Boite without a change to the core. It can give agents
`boite <name>` commands, skills and lines in their Boite guide, give the
composer slash commands, run a background service that talks to the core, and
the three features older plugins have: account pools, which save and switch
the default login of an agent CLI ([Account pools](#account-pools)), desktop
apps, which Boite starts beside itself ([Desktop apps](#desktop-apps)), and
gateways, which Boite runs in the background for the subscription proxy
([Gateways](#gateways)).

A plugin is a git repository with a `boite-plugin.json` at its root and,
unless it only adds text, one executable that Boite downloads over https and
checks against the SHA-256 the manifest publishes. Schema 2 is the format to
write today ([Schema 2](#schema-2)); schema 1 manifests keep loading as they
always did ([Schema 1 manifest](#schema-1-manifest)).

Settings > Plugins is one grid of cards, with a search field (name, id,
description or author) and a filter: All, On or Off.

- A card holds the name, version, author, two lines of description, small
  chips for what the plugin touches (its permissions, account pools, a desktop
  app or service, a gateway, a program or text only), an on/off switch and a
  gear. A state worth a look (installing, refused, an error, off, a crashed
  app, an update) takes one line on the card, its detail behind an "i".
- The plugins on this core come first, then the recommended ones: those Boite
  ships a manifest for and that are not installed yet, in the order Boite lists
  them. Today that is [Bots](https://github.com/Skollheim/bots), the desktop
  companion, and [Douane](https://github.com/mtsu-dev/douane), the subscription
  gateway. Their card carries a Recommended chip and Install instead of a switch.
- From a URL, beside the filter, opens the form that reads any repository with
  a `boite-plugin.json` at its root and shows it before installing.
- The gear opens the plugin's dialog: its [settings](#settings), what its
  token may call (Authorizations, whose Edit opens the grant editor of
  [Consent and grants](#consent-and-grants)), where it comes from, its updates, its pools,
  its interface state with Reload interface ([Interface](#interface)), its desktop
  app or gateway with Start, Stop and Restart, and Uninstall. On a phone it is a
  bottom sheet.

A plugin installed as recommended that a later Boite no longer lists, such as
kebacc-switcher before 2026-10-16, stays in the grid with its pools until the
owner uninstalls it; it no longer receives updates.

Plugins are administration of the machine that hosts the core, so every
`plugins.*` method is owner only, except `plugins.command`, which an agent
calls to run a plugin's command ([Agent commands](#agent-commands)),
`plugins.settings.get`, which a plugin calls for its own settings, and
`plugins.ui`, which every client reads to draw the interfaces ([Interface](#interface)).
The owner's phone has the same page under Settings > Plugins; a paired device has none.

### Turning a plugin off

The switch on a card turns an installed plugin off without uninstalling it
(`plugins.setEnabled`). Off stops its desktop app, service and gateway, revokes
its token (its sockets close), unloads its interface, and drops its commands,
skills, guide lines and slash commands. Its files, data directory and settings stay. On starts again
what it runs. The core keeps the choice across restarts. `PluginState.enabled` is `false` while
it is off; an older core leaves the field out, and every installed plugin is on.

Each core has its own plugins. The page opens on this PC when the window has
one, since a desktop app shows its window there, whichever machine the open
conversation runs on. With several machines connected, a menu beside the
heading names the machine shown and switches to another one this window owns.

## Write a plugin in 5 minutes

The example in [`examples/plugins/hello`](../examples/plugins/hello) is a
complete plugin on the `bun` runtime. It gives agents `boite hello-threads`,
which prints the five conversations that changed last, a skill, a guide line
and the slash command `/recap`. Start from a copy of it.

1. The manifest, `boite-plugin.json`:

   ```json
   {
     "schema": 2,
     "id": "hello",
     "name": "Hello",
     "version": "0.1.0",
     "description": "An example plugin: lists the conversations that changed last.",
     "homepage": "https://github.com/mtsu-dev/boite/tree/main/examples/plugins/hello",
     "runtime": "bun",
     "executable": "hello",
     "artifacts": {
       "any": { "url": "https://example.com/boite-plugins/hello/0.1.0/hello.js", "sha256": "<written by pack>" }
     },
     "permissions": ["threads.read"],
     "provides": {
       "commands": [{ "name": "hello-threads", "description": "Prints the titles and ids of the five conversations that changed last.", "usage": "[--json]" }],
       "skills": [{ "name": "hello-threads", "description": "Find the conversations the user worked on last.", "body": "<copied from skills/hello-threads.md by pack>" }],
       "prompt": "Run `boite hello-threads` to see which conversations the user worked on last.",
       "slashCommands": [{ "name": "recap", "description": "Recap the conversations that changed last.", "hint": "<topic>", "prompt": "Run `boite hello-threads`, then recap in a few lines what each of those conversations is about. Focus on:" }]
     }
   }
   ```

2. The command, `src/main.ts`, with the SDK (`@boite/plugin-sdk`,
   [`packages/plugin-sdk`](../packages/plugin-sdk)):

   ```ts
   import { runCommands } from '@boite/plugin-sdk';

   await runCommands({
     'hello-threads': async (args, ctx) => {
       const client = await ctx.connect();
       const threads = await client.call('threads.list', {});
       for (const thread of threads.toSorted((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)) {
         console.log(thread.title);
       }
     },
   });
   ```

3. In the plugin's folder, in a terminal of your own:

   ```sh
   bun install
   bun run pack
   boite plugin dev .
   ```

   `pack` bundles `src/main.ts` into `hello.js`, the file the manifest's
   `executable` names, and writes its SHA-256 into `artifacts.any`.
   `boite plugin dev .` runs the plugin from the folder
   ([Dev mode](#dev-mode)). An agent in a new conversation now lists
   `boite hello-threads` in its guide and can run it.

4. To publish, upload `hello.js` at the URL `artifacts.any` names, for example
   as a release asset, and push the folder to a public git repository with the
   manifest at its root. To share it, send its link or `owner/repo`: the
   other owner pastes it in Settings > Plugins, or asks an agent to add it,
   and installs after reading the preview ([Install and run](#install-and-run)).

## Schema 2

```json
{
  "schema": 2,
  "id": "standup",
  "name": "Standup",
  "version": "1.0.0",
  "description": "Writes the morning summary of every project.",
  "homepage": "https://github.com/example/standup",
  "runtime": "bun",
  "executable": "standup",
  "artifacts": { "any": { "url": "https://github.com/example/standup/releases/download/v1.0.0/standup.js", "sha256": "<64 hex characters>" } },
  "permissions": ["threads.read", "todos"],
  "provides": {
    "service": {},
    "commands": [{ "name": "standup", "description": "Prints this morning's summary.", "usage": "[--project <name>]" }]
  }
}
```

| Field | What Boite accepts |
| --- | --- |
| `schema` | `2`. |
| `id`, `name`, `version`, `description`, `homepage` | As in [schema 1](#schema-1-manifest). |
| `runtime` | `"native"` or `"bun"` ([Runtime](#runtime)). Absent means `"native"`. |
| `executable` | As in schema 1. Absent exactly when the plugin provides only `skills`, `prompt` and `slashCommands`: a plugin of text that downloads nothing. |
| `artifacts` | `native`: keyed by platform as in schema 1. `bun`: exactly one key, `any`, `{ "url", "sha256" }`. Absent exactly when `executable` is. |
| `permissions` | A list of distinct permission names ([Permissions](#permissions)), `todos` standing for `todos.read` and `todos.write`. Absent means none. |
| `settings` | Up to 30 settings Boite draws for the owner ([Settings](#settings)). Absent means none. |
| `provides` | At least one of `accountPools`, `desktopApp`, `gateway` (as in schema 1), `service`, `commands`, `skills`, `prompt`, `slashCommands` and `ui` ([Interface](#interface)). |

Unknown fields at any depth are refused, as in schema 1, and the manifest file
may be 256 KB. Every limit is under [Limits](#limits).

### Runtime

- `native`: a program built for each platform, one artifact per platform key,
  saved as `<executable>` (`<executable>.exe` on Windows), as in schema 1.
- `bun`: one JavaScript file for every machine. Boite saves it as
  `<executable>.js` and runs it with the core's own Bun, so
  `process.argv.slice(2)` are the arguments, as under `bun <file>.js <args>`.
  The file must be self-contained: bundle its dependencies into it (the SDK's
  `pack` does). Node's built-in modules and Bun's APIs are there, and
  `import.meta.main` is true. Bun reads no `.env` and no `bunfig.toml` from
  the directory the plugin runs in. In the compiled core the core's own
  executable runs the file with `BUN_BE_BUN=1`, removed from `process.env`
  before the file loads; `Bun.spawn` without an `env` still passes it on, so a
  plugin that starts a compiled Bun program that way passes
  `env: process.env`.

### Permissions

A schema 2 plugin's processes do not get the owner token. The core mints a
token for the plugin that reaches only the permissions the owner granted of
those its `permissions` ask for; its connections speak as the principal
`plugin`.

Each permission is a domain, read or write. Every method and event a paired
device may use is filed into exactly one, or in the closed list below; a
method added to Boite later joins its domain in the same table, and the
plugins granted that domain reach it with no change of their own.

| Permission | What it opens |
| --- | --- |
| `threads.read` | Every conversation of every project, read only: rows, transcripts, pull request links, cards waiting on the owner, the composer's drafts, the project list, and their events. |
| `threads.write` | Creates, starts, steers, stops, renames, moves, forks, archives and deletes conversations: it spends the owner's agent quota. Archiving keeps its guards ([Archiving](#archiving-threads)). |
| `projects.read` | The projects' icons, file lists and changes, and the composer's skill menu. |
| `projects.write` | Adds a folder as a project, renames or archives one. |
| `todos.read` | The project boards, read only. |
| `todos.write` | Adds, updates and removes cards. |
| `agents.read` | Agents, delegations, workflows, teams and councils, read only. |
| `agents.write` | Opens agents, posts to teams and councils, sends and stops delegations, controls workflows. |
| `files.read` | Git status and diffs, the files of a project and their content. |
| `questions.write` | Answers the cards agents wait on, permission requests included: shown in red at install, since it answers in the owner's name. |
| `screens.read` | The devices, windows and remote browser Boite shows, their frames included. |
| `screens.write` | Types and clicks in them, opens and closes them, reads the emulator's clipboard. |
| `status.read` | Machine usage, quotas, providers, settings, the scheduler and key bindings, read only. |
| `ui.reveal` | Brings a conversation, a bot or the app updates to the front of the owner's desktop window ([Showing Boite](#showing-boite)). |
| `ui` | Runs its `provides.ui` script and style inside Boite's window, on every client of this core ([Interface](#interface)). The token gains nothing, but that code can do anything you can in the app: shown in red at install. |

The table is `PLUGIN_PERMISSIONS` in `packages/contracts/src/plugins.ts`, with
each domain's methods and events; `packages/core/test/plugin-permissions.test.ts`
fails when a device method is in no domain and not closed. A manifest may
still ask for `todos`, which reads as `todos.read` and `todos.write`.

Never open to a plugin, whatever it asks for (`PLUGIN_CLOSED`, each with its
reason): accounts and provider sign-ins, secrets, plugins and their grants,
updating, restarting or stopping Boite, the admin policy (read or changed),
the composer's queue (a queued line goes out as the owner's), paired sessions and
pairing, the machine group, push subscriptions, the client's own settings,
which conversation the owner is looking at, dictation, diagnostics reports,
window capture consent, contacts and shared projects. A method in no domain
and not closed (settings changes, hooks, the brain) is the owner's.

A refused call names the method and the permission it needs:

```
turns.start needs the plugin permission threads.write, which the owner did not grant (granted: threads.read)
secrets.list is never open to plugins: secrets reach only the agent that asked for one
```

#### Consent and grants

On install, and on an update that asks for more, the app shows "<name> wants
to access your Boite": one line per permission asked for, ticked unless the owner refused it
before.
The owner unticks what the plugin should not get; `plugins.add` and
`plugins.install` carry the ticked list as `grants`, which must be among the
permissions the manifest asks for (else refused naming `grants[<index>]`).
The line for `questions.write` is red. A plugin with an executable adds a line
with no box: it runs a program on this machine with Boite's rights.

The grant is stored per installed plugin, apart from the manifest. An install
with no `grants` (`boite plugin install`, an older app) grants everything on a
first install; an update keeps what was granted and grants nothing it asks
for anew. A dev load (`boite plugin dev`) grants what the folder asks for. The
owner changes a grant later with `plugins.setGrants`: the old token and every
socket it opened close, and a running app or service restarts with the new
one. An uninstall forgets the grant.

#### In the plugin's name

Every change a plugin's token makes is in the core's log as
`<method> by plugin <name>`. The records that name who acted name the plugin,
by id and by its name at that time, so they still read after an uninstall:

- a conversation it creates carries `createdBy`;
- a prompt it sends or steers into a running turn carries `byPlugin` on the
  message, shown above it;
- a card it adds or changes carries `plugin`, until another hand changes it;
- a conversation it archives carries `archiveReason` of type `plugin`.

A plugin passes the same checks as a paired device (`deviceBound` in
`packages/contracts/src/access.ts`, which every core guard asks): reads held
to the projects and never credential files or Boite's data folder, a project
folder it adds held to the same rules, the working tree's diff against HEAD
only, the last quota reading only, a desktop, device or window only of a
conversation it subscribed to, no workflow retry or resume. It neither reads
nor changes a shared board's cards, and archives only when idle.

#### Archiving threads

A plugin's `threads.archive` is always a Mark done, whatever it passes:

- The core forces `onlyIfIdle: true` and checks the family as an automatic
  pass does: a turn running or queued, background work, a subagent at work
  on another machine, a move, a message
  waiting to be delivered, a workflow (a paused one included), unsent input
  on a device, a side question or a card waiting for an answer refuses it,
  naming `threadId`.
- A pinned thread is refused naming `pinned`. `pinned` is already in the
  `ThreadSummary` rows `threads.list` answers, so a plugin can skip them
  first.
- `archived: false` is refused: restoring is the owner's.
- An already archived thread is answered unchanged.
- The row's `archiveReason` becomes `{ type: 'plugin', pluginId, pluginName,
  archivedAt }`. The app shows "Archived by plugin <name>" under the done row
  and in Settings, Archived threads, and the core's log records the archive.
  An owner's restore drops it.
- Being done, the thread counts toward Delete done threads after, as after
  the owner's Mark done.

A thread in error is idle: a plugin that must leave those alone reads
`status` in `threads.list` (permission `threads.read`) first.

### Environment

Every process Boite starts for a schema 2 plugin gets the core's environment
minus every variable it gives an agent (`BOITE_AGENT_TOKEN`, `BOITE_THREAD_ID`
and any other `BOITE_AGENT_*`), plus:

| Variable | Value |
| --- | --- |
| `BOITE_CORE_URL` | The core's base URL, `http://<host>:<port>`. |
| `BOITE_TOKEN` | The plugin's own token ([Permissions](#permissions)). |
| `BOITE_PLUGIN_ID` | The plugin's id. |
| `BOITE_PLUGIN_DATA` | A folder of the plugin's own. It survives updates and uninstalls: keep settings and caches there. |
| `BOITE_CALLER_THREAD_ID` | An agent command only: the thread whose agent ran it. |

A [gateway](#gateways) is the exception: it gets neither `BOITE_CORE_URL` nor
`BOITE_TOKEN`, whatever its schema, since a gateway never talks to the core.

The core speaks JSON-RPC 2.0 over a WebSocket at `<BOITE_CORE_URL>/rpc`. The
first message is the `hello`:

```json
{ "jsonrpc": "2.0", "id": 1, "method": "hello",
  "params": { "token": "<BOITE_TOKEN>", "protocolVersion": 2, "client": { "name": "plugin", "version": "1.0.0" } } }
```

Its answer carries `core` (with `protocolVersion`) and `principal`. After it,
each request is `{ "jsonrpc": "2.0", "id", "method", "params" }`, and each
event the plugin may hear arrives as `{ "jsonrpc": "2.0", "method": "<event>",
"params": <payload> }`. Methods, events and their types are in
`packages/contracts/src/`. The SDK's `connect` does all of this
([SDK](#sdk)); a native plugin in another language does the same.

### Agent commands

`provides.commands` lists `boite <name>` commands for agents:

```json
"commands": [{ "name": "standup", "description": "Prints this morning's summary.", "usage": "[--project <name>]" }]
```

- `name`: lowercase words joined by hyphens. The name of a built-in `boite`
  command is refused, since the built-in would win, and so is a name another
  installed plugin already gives a command; the same holds for slash commands.
- `description`: the one line agents read in their guide.
- `usage`: optional, the arguments as `boite help` words them.

An agent runs `boite standup --project web`. The CLI has no built-in of that
name, so it calls `plugins.command`, and the core:

- runs the executable with the arguments `standup --project web`, the
  command's name first, in the agent's current directory;
- adds `BOITE_CALLER_THREAD_ID` to the [environment](#environment) and gives
  it an empty stdin;
- waits up to 10 minutes, and keeps at most 1 MB of stdout and 1 MB of
  stderr; past that the output is cut and marked `truncated`.

The CLI prints the command's stdout and stderr and exits with its exit code.
A name no plugin provides exits 2, like any unknown command, with the list of
the plugin commands there are.
Write for an agent: plain text, one fact per line, a `--json` form when the
output is data, and an error that says what to run instead.

Every agent's guide lists every installed command with its usage and
description.

### Skills

`provides.skills` ships skills to every agent:

```json
"skills": [{ "name": "standup", "description": "When and how to write the morning summary.", "body": "# Standup\n\nRun `boite standup` when the user asks what happened overnight." }]
```

`body` is the text of a SKILL.md, in Markdown. The guide lists each skill's
name, description and the path of its SKILL.md, which the core writes to
`<dataDir>/plugins/<id>/skills/<name>/SKILL.md`;
the agent reads the file when the skill fits its task. With the SDK, write
the body in `skills/<name>.md` and `pack` copies it into the manifest.

### Prompt

`provides.prompt` is a few lines added to every agent's Boite guide. Keep it to what an agent must know without asking: when to
reach for the plugin's commands.

### Slash commands

`provides.slashCommands` adds entries to the composer's `/` menu:

```json
"slashCommands": [{ "name": "recap", "description": "Recap the conversations that changed last.", "hint": "<topic>", "prompt": "Run `boite hello-threads`, then recap them. Focus on:" }]
```

Sending `/recap the release` sends the `prompt` followed by a space and
`the release`. `hint` is shown after the name in the menu. A slash command is
text only: it runs nothing until the agent acts on the prompt.

### Service

`provides.service` is `{}`, an object with no field. Boite runs the
executable in the background with no argument and no window, on any machine,
a headless server included. It is started, stopped, kept running and
relaunched after a crash exactly like a [desktop app](#desktop-apps): the same
Start, Stop and Restart and Start with Boite switch behind its gear
(`plugins.app`), the same 2, 10 and 30 second retries and the same `crashed`
state after a fourth exit within five minutes. Its state is
`PluginState.app` with `kind: "service"`.

A service is how a plugin watches the core: it connects with its token, listens
to the events its permissions grant and acts on them. With the SDK, pass
`service` to `runCommands`, which runs it when the arguments are empty.

### Interface

`provides.ui` is `{ "script"?: <path>, "style"?: <path> }`, at least one of
the two, each a file of the plugin's repository: a JavaScript module and a
stylesheet that run inside Boite's window. It needs the `ui` permission, which
the install preview and the plugin's card show in red.

```json
"permissions": ["threads.read", "ui"],
"provides": { "ui": { "script": "ui/index.js", "style": "ui/style.css" } }
```

How the files get to the window:

- At install and update the core reads them out of the same commit as the
  manifest, from git, as blobs: the install preview refuses a missing file or
  one past its limit, naming `provides.ui.script` or `provides.ui.style`.
  It saves them under the plugin's directory as `ui/<sha-256>.js` and
  `.css` and writes their digests in `installed.json`. A file whose bytes no
  longer match is not served: its gear says the files are missing or altered
  and to reinstall. A recommended entry has no repository, so it cannot bring
  an interface.
- Every client reads them with `plugins.ui`, an RPC rather than an HTTP route
  so that it reaches the desktop app, a browser and a paired phone over the
  connection each already has. It answers the plugins that are installed,
  turned on and granted `ui`, with their files, the permissions granted and
  the settings' values. The core sends `plugins.uiUpdated` with a digest when
  that answer changes: an install, an update, an uninstall, turning it off or
  on, a grant taken back or given, or a setting.
- The window loads them once it has started, never before its first screen:
  the style goes in a `<style>` element, the script is imported as a module
  from a `blob:` URL.

The script's default export (or an export named `activate`) is called once
with the plugin's API, and may return a cleanup function:

```js
export default function hello(boite) {
  boite.ui.addButton({ id: 'recent', slot: 'thread-header', label: 'Recent', icon: '👋', onClick: () => boite.ui.openPanelTab('recent') });
  boite.ui.addPanelTab({ id: 'recent', title: 'Recent', mount(element, { threadId }) {
    element.textContent = 'Hello';
    return () => element.replaceChildren();
  } });
}
```

| Part | What it does |
| --- | --- |
| `ui.addButton({ id, slot, label, icon?, onClick })` | A button in `thread-header` (the conversation's header), `composer` (the composer's toolbar, kept on a phone) or `sidebar` (the sidebar's foot). `icon` is a few characters, an emoji say, or SVG markup; absent, the label's first letter. `onClick({ threadId })`. |
| `ui.addMessageAction({ id, label, onClick })` | An entry in a message's plugin menu, the puzzle button beside copy. `onClick({ threadId, messageId, role, text })`. |
| `ui.addPanelTab({ id, title, icon?, mount })` | A tab of the right panel, offered in its "+" menu. `mount(element, { threadId })` draws into the element and may return a cleanup, run when the tab closes. |
| `ui.addCommand({ id, title, onRun })` | A row of the command palette. |
| `ui.openPanelTab(id)` | Opens one of the plugin's own tabs in the open conversation's panel. |
| `rpc.call(method, params)`, `rpc.on(event, handler)` | The window's own connection, limited to the methods and events of the permissions the plugin was granted ([Permissions](#permissions)); anything else is refused with the permission it needs. On a paired phone the core also refuses what a phone may not call. |
| `settings.get()`, `settings.onChange(fn)` | The plugin's settings; a change reaches `onChange` without reloading the script. |
| `onCleanup(fn)` | Runs when the plugin is disabled, updated, uninstalled or fails. |
| `id`, `name`, `version`, `permissions` | Who it is. |

Every `add*` returns a function that takes the entry away. An `id` is letters,
digits, `-` and `_`, at most 40, unique per plugin and kind; a `label` or
`title` is 1 to 60 characters.

The script runs as written, neither bundled nor transpiled, on every client,
so it must run on the oldest browser the UI supports, Safari 15.4 and Chrome 111
([Oldest browsers](phone.md#oldest-browsers)): `[...list].sort()` rather than
`list.toSorted()`, and no regex lookbehind.

The slots are the stable API. Boite's interface is Svelte, recompiled at every
release: its markup, class names and CSS variables change without notice. A
script may reach the DOM and a stylesheet may style anything, at the plugin's
own risk; what goes through the slots keeps working across releases.

A script that throws while loading, or later in a function it handed Boite (a
click, a tab's mount, an event handler, an unhandled error from its own
module), stops that plugin only: its entries leave, its cleanups run, its
stylesheet goes and its card in Settings > Plugins shows the error with a
Reload interface button. The same files are not run again until they change
or that button is pressed.

Safe mode starts a window with no plugin script or style:

- add `?safe=1` to the address, or
- the window starts in safe mode by itself when the previous start died while
  scripts were loading (the window closed or crashed within 1.5 seconds of
  running them).

A notice says so, with a button to load them anyway. Cards show
"Interface not loaded: safe mode".

### Dev mode

`boite plugin dev <folder>` runs a plugin from a folder on the core's machine,
without publishing anything. The folder holds `boite-plugin.json` and the
executable file: `<executable>.js` for `bun`, `<executable>` or
`<executable>.exe` for `native`. `artifacts` and digests are not needed; when
present they are ignored.

- Commands, skills, the prompt and slash commands are read from the folder on
  each use, so an edit applies at once. The interface files are read on each
  `plugins.ui` read with no digest to match: after an edit, press Reload
  interface on the plugin's card.
- The schema, the permissions and what Boite starts for it (a desktop app, a
  service, a gateway, account pools) stay those of the last
  `boite plugin dev`. An edit that changes one turns the card to an error
  and closes the plugin's token, its sockets with it, until you run
  `boite plugin dev <folder>` again: anything that can write the folder, an
  agent working in it say, cannot give the plugin more than you loaded.
- Run `boite plugin dev <folder>` again to read the manifest again and restart
  the plugin's service or desktop app.
- `boite plugin dev --remove <id>` removes it.
- Its card in Settings > Plugins wears a Dev chip, and its gear shows the folder.

It is the owner's (`plugins.dev`): run it from your own terminal. The core
refuses it to an agent or a paired device.

### Settings

A schema 2 manifest declares the settings it wants from the owner. Boite draws
them in the plugin's gear dialog, in the manifest's order, keeps the values on
the core and hands them to the plugin; the plugin draws no settings page of
its own.

```json
"settings": [
  { "key": "includeTodos", "type": "switch", "label": "Include todos", "description": "Lists the todos closed today under each thread.", "default": true },
  { "key": "lookback", "type": "slider", "label": "Look back", "min": 4, "max": 72, "step": 4, "default": 24 },
  { "key": "tone", "type": "select", "label": "Tone", "default": "plain", "options": [
    { "value": "plain", "label": "Plain" }, { "value": "short", "label": "Short" }
  ] },
  { "key": "maxThreads", "type": "number", "label": "Threads at most", "min": 1, "max": 50, "default": 8 },
  { "key": "signature", "type": "text", "label": "Signature", "default": "" }
]
```

| Field | What Boite accepts |
| --- | --- |
| `key` | A letter, then letters, digits and `_`, at most 40 characters, distinct within the plugin. |
| `type` | `switch`, `number`, `slider`, `text` or `select`. |
| `label` | At most 60 characters. |
| `description` | Optional, at most 200 characters: one line under the label. |
| `default` | Valid for the type: `true` or `false`, a number within the bounds, a line of at most 1,000 characters, or one of the options' values. |
| `min`, `max`, `step` | `number` and `slider` only. A slider needs `min` and `max`; `max` must be above `min`, `step` above 0. A value must be a multiple of `step` from `min` (from 0 without `min`). |
| `options` | `select` only: 1 to 30 `{ "value", "label" }`, values distinct, each at most 60 characters. |

Any other field in a setting is refused, as everywhere in the manifest.

- A switch, a slider and a choice save as soon as they change; a number and a
  line of text save when the field is left or Enter is pressed. A value outside
  the setting's rule is refused in the dialog with what is expected, and the
  core checks it again.
- `plugins.settings.set { id, values }` is the owner's. Every key must be
  declared and every value valid, or nothing is stored and the refusal names
  the key. Keys left out keep their value.
- `plugins.settings.get { id }` answers every declared key with the owner's
  value or the default. A plugin's token may call it for its own id with no
  permission; any other id is the owner's.
- After a change, the core sends `plugin.settings.changed { id, values }`
  with every value, to the owner and to that plugin's sockets only.
- A new version that drops a key or makes a stored value invalid falls back
  to the default; the stored value is not shown.
- The values stay through turning the plugin off and on, and through updates;
  uninstalling removes them.

In the SDK, `settings()` reads them and `onSettingsChanged(handler)` hears
each change ([SDK](#sdk)).

### Limits

The core refuses a schema 2 manifest past any of these:

| What | Limit |
| --- | --- |
| The manifest file | 256 KB (64 KB for schema 1) |
| A command, skill or slash command name | 40 characters, lowercase words joined by hyphens |
| A command, skill or slash command description | 200 characters |
| A command's `usage` | 200 characters |
| A skill's `body` | 32 KB |
| `prompt` | 1,000 characters |
| A slash command's `prompt` | 8 KB |
| Entries | 20 commands, 20 skills, 20 slash commands |
| `provides.ui.script` | 512 KB, a path ending in `.js` or `.mjs` |
| `provides.ui.style` | 128 KB, a path ending in `.css` |
| A `provides.ui` path | 200 characters of letters, digits, `.`, `_`, `/` and `-`, relative, with no `.` or `..` segment |

### Schema 1 desktop apps

A schema 1 manifest loads unchanged. Its desktop app keeps the owner token in
`BOITE_TOKEN` and reaches everything the owner can ([Desktop apps](#desktop-apps),
[Security model](#security-model)); it gets neither `BOITE_PLUGIN_DATA` nor a
permission check. A desktop app moved to schema 2 gets the plugin's token
instead, held to the permissions the owner granted.

## SDK

`@boite/plugin-sdk` lives in [`packages/plugin-sdk`](../packages/plugin-sdk),
a workspace package of this repository; it is not on npm yet. A plugin inside
the repository depends on it with `"@boite/plugin-sdk": "workspace:*"`, as the
example does. Its code is a few hundred lines with no runtime dependency, and
`pack` bundles what a plugin uses into its one file.

```ts
import { connect, definePlugin, runCommands, RpcError } from '@boite/plugin-sdk';
```

- `runCommands(handlers, options?)`: the entry point of the executable. It
  runs the handler `process.argv[2]` names with the remaining arguments and
  exits with the code the handler returns (0 when it returns nothing, 1 with
  its message on stderr when it throws). An unknown name prints the usage on
  stderr and exits 2. `options.service` runs instead when there is no
  argument ([Service](#service)). `dispatch` does the same without exiting,
  for tests.
- Each handler gets `(args, ctx)`. `ctx` holds `name`, `cwd`, `callerThreadId`
  (null when the owner ran the command), `pluginId`, `dataDir` and
  `connect()`, which opens the core's socket on first use and is closed when
  the handler ends.
- `connect(options?)`: opens the socket with `BOITE_CORE_URL` and
  `BOITE_TOKEN` (or `options.url` and `options.token`) and says hello as
  `plugin`. It returns `{ core, principal, call(method, params), on(event,
  handler), closed, close() }`, typed from `@boite/contracts`: `call` answers
  the method's result, `on` returns the function that stops listening. A call
  the core refuses rejects with an `RpcError` carrying the core's `message`,
  `code` and `data`.
- On the object `connect` returns, `settings()` answers the values of the
  plugin's declared [settings](#settings), and `onSettingsChanged(handler)`
  calls `handler` with every value after each change and returns the function
  that stops listening. Both use `BOITE_PLUGIN_ID`, or `options.pluginId`.
- `definePlugin(manifest)`: returns its argument, typed as `PluginManifest`,
  to write a manifest in TypeScript with the editor's checks.

The SDK reads frames itself over `node:net` rather than through the runtime's
`WebSocket`, whose Bun client has closed long-lived sockets to the core with a
protocol error.

### Pack

```sh
bun packages/plugin-sdk/bin/pack.ts --entry src/main.ts [--dir <folder>] [--url <https URL>]
```

A package that depends on the SDK also has it as `boite-plugin-pack`. It:

1. reads `<folder>/boite-plugin.json` (the current folder by default), which
   must be schema 2 with `runtime: "bun"` and an `executable`;
2. copies each `skills/<name>.md` into the body of the skill of that name;
3. bundles `--entry` with `bun build --target=bun` into `<executable>.js`;
4. writes `artifacts.any`: `--url`, or the URL already there, with the file's
   SHA-256;
5. checks the [limits](#limits) and writes the manifest back.

Publish the packed file at that URL unchanged: one changed byte and the
install refuses it.

## Schema 1 manifest

Put `boite-plugin.json` at the root of the repository:

```json
{
  "schema": 1,
  "id": "seat-pool",
  "name": "Seat pool",
  "version": "1.4.0",
  "description": "Keeps several OpenCode logins and switches the active one.",
  "homepage": "https://github.com/example/seat-pool",
  "executable": "seat-pool",
  "artifacts": {
    "win32-x64": {
      "url": "https://github.com/example/seat-pool/releases/download/v1.4.0/seat-pool-win32-x64.exe",
      "sha256": "c41e9b0a7d3f5e2b8a6c4d1f0e9b7a5c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a"
    },
    "linux-x64": {
      "url": "https://github.com/example/seat-pool/releases/download/v1.4.0/seat-pool-linux-x64",
      "sha256": "0d2f4b6a8c1e3f5a7b9c2d4e6f8a0b1c3d5e7f9a2b4c6d8e0f1a3b5c7d9e2f4a"
    }
  },
  "provides": {
    "accountPools": { "providers": ["opencode"] }
  }
}
```

| Field | What Boite accepts |
| --- | --- |
| `schema` | `1`. |
| `id` | Lowercase letters, digits and inner hyphens, 1 to 64 characters. It names the install directory and must not be a recommended plugin's id. |
| `name` | 1 to 60 characters, no control characters. |
| `version` | `MAJOR.MINOR.PATCH`, optionally followed by `-` or `+` and a suffix: `1.2.0`, `1.2.0-beta.1`. |
| `description` | 1 to 300 characters, no control characters. |
| `homepage` | An https URL with a host and no user or password, at most 2048 characters. The page links to it as the source code. |
| `executable` | The file name Boite saves the download as: a letter or digit, then letters, digits, `_` and `-`, 64 characters at most, no extension. Boite adds `.exe` on Windows. |
| `artifacts` | An object keyed by platform, at least one of `win32-x64`, `win32-arm64`, `darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`. Each value is `{ "url", "sha256" }`: an https URL as for `homepage`, and the file's SHA-256 as 64 lowercase hexadecimal characters. |
| `provides` | An object naming at least one feature, among `accountPools`, `desktopApp` and `gateway`. `accountPools` is `{ "providers": [...] }`: a non-empty list of distinct provider ids among `antigravity`, `claude`, `codex`, `grok`, `muse`, `opencode`, `opencode-v2` and `pi`; a retired provider id (`antigravity-cli`) is accepted and dropped, so a plugin installed under an older Boite keeps loading. `desktopApp` and `gateway` are `{}`, objects with no field ([Desktop apps](#desktop-apps), [Gateways](#gateways)). A plugin may provide several. |

The platform key is `process.platform` and `process.arch` of the machine that
runs the core, joined by a hyphen. A core on a Linux server downloads the
`linux-x64` artifact even when the owner clicks from Windows.

All fields are required; unknown fields at any depth are refused. Errors name
the file, field and expected value:

```
boite-plugin.json: artifacts.win32-x64.sha256 must be 64 lowercase hexadecimal characters, found "ABC123"
```

The page shows the same three parts, and installs nothing.

## Account pools

A plugin that provides `accountPools` answers five command lines. Boite runs
nothing else, and the page lists these lines before the owner installs:

```
seat-pool list -<pool> -Json
seat-pool list -<pool> -Json -Refresh
seat-pool add -<pool>
seat-pool switch -<pool> -Email <email> -Yes
seat-pool remove -<pool> -Email <email> -Yes
```

`<pool>` is one of the provider ids the manifest lists. `add` saves the login
the CLI uses now into the pool, `switch` makes a saved login the CLI's default
again, `remove` forgets a saved login. `-Refresh` asks for fresh quota readings
instead of cached ones. These three change nothing Boite reads on stdout; they
succeed with exit code 0.

`list` prints one JSON object on stdout:

```json
{
  "accounts": [
    { "email": "team@example.com", "live": true, "checkedSecondsAgo": 42, "fiveHour": 18, "sevenDay": 51 },
    { "email": "side@example.com" }
  ]
}
```

- `email` is required, a non-empty string.
- `live: true` marks the login the CLI uses now.
- `checkedSecondsAgo` is how old the quota reading is.
- `fiveHour` and `sevenDay` are the percentage used of the five-hour and weekly
  windows. Boite clamps them to 0 to 100.
- A reading that is absent is shown as unavailable, never as zero. Other fields
  are ignored.

Each run:

- starts through the core's process launcher, traced as `plugin:<id>:<n>`, in
  the plugin's directory with the core's environment;
- has a 60-second deadline and registry cleanup on exit. Windows Job Objects
  track its descendants; POSIX cleanup signals its process group and cannot
  catch descendants that leave it ([trace](trace.md#platform-boundary));
- may write at most 4 MB on stdout and on stderr.

A nonzero exit is reported as `seat-pool switch -opencode failed with exit code 1.`
Boite never forwards the program's stdout or stderr to a client, because a
login tool may print tokens. Write your diagnostics to your own log.

Readings are cached for a minute, and a refresh runs the program again only
when the last reading is older than ten seconds.

Pools change the CLI's default login. [Isolated Boite accounts](accounts.md)
keep their own credentials. Before `add`, `switch` or `remove`, Boite refuses
while a turn on that provider's default login is running, queued or waiting,
releases any warm agent on that login, and holds new turns on it until the
command exits. One login change runs at a time across all plugins.

## Desktop apps

A plugin that provides `desktopApp` is a program with a window of its own,
such as [Bots](https://github.com/Skollheim/bots). Boite starts it and keeps it
running; the app then talks to the core like any client.

```json
{
  "schema": 1,
  "id": "bots",
  "name": "Bots",
  "version": "0.1.0",
  "description": "Little robots on your desktop, one for each agent at work.",
  "homepage": "https://github.com/Skollheim/bots",
  "executable": "bots",
  "artifacts": {
    "win32-x64": { "url": "https://github.com/Skollheim/bots/releases/download/v0.1.0/bots.exe", "sha256": "<64 hex characters>" }
  },
  "provides": { "desktopApp": {} }
}
```

`desktopApp` takes no field; any key in it is refused. The artifact is the
app's single release executable.

The core starts an installed app:

- when the core starts, if Start with Boite is on (`autostart`);
- right after its install or an update finishes, if it is on (`enabled`);
- when the owner clicks Start or Restart in Settings > Plugins
  (`plugins.app {id, action: "start" | "stop" | "restart"}`).

It runs the executable with no argument, from the plugin's directory, through
the core's process launcher as `plugin:<id>:app`. On Windows its window is not
hidden. Its stdout and stderr are read and dropped; no client ever sees them.

The environment is the core's, minus every variable the core gives an agent
(`BOITE_THREAD_ID`, `BOITE_AGENT_TOKEN` and any other `BOITE_AGENT_*`), plus:

| Variable | Value |
| --- | --- |
| `BOITE_CORE_URL` | The core's address, `http://<host>:<port>`, in the form the `boite` CLI reads. |
| `BOITE_TOKEN` | The owner token. |
| `BOITE_PLUGIN_ID` | The plugin's id. |

The app connects to `BOITE_CORE_URL` with `BOITE_TOKEN` as an owner client.
Its `hello` names the client `plugin`, not `shell`: the core then adds no
"sent from the desktop app" note to its prompts and refuses it as the agent
browser's host. A thread it subscribes to is not on anyone's screen: a turn
that ends there still marks the thread unread, and `panel.open` still answers
`shown: false` when no window has it open.

Exits and stops:

- An exit with code 0 leaves the app stopped. It starts again on the next core
  start while Start with Boite is on, or when the owner starts it.
- Any other exit, or a signal, starts it again after 2 seconds, then 10, then
  30. A fourth crash within five minutes leaves it crashed, with the exit code
  and a message on its card, until the owner starts it.
- Stop kills the app's process tree and turns it off until the next core
  start, or for good while Start with Boite is off. Start and Restart turn it
  back on.
- Uninstall kills it first. An update kills it before the new executable
  replaces the old one, and starts the new one after.
- Core shutdown kills it.

Start with Boite is the switch under the app's state behind its gear
(`plugins.autostart {id, autostart}`). It decides only what the next core
start does: nothing running starts or stops when it changes.

Both choices are kept in `<dataDir>/plugins/<id>/app.json`
(`{"enabled": true, "autostart": true}`), across core restarts and updates. A
first install turns both on. A file written before `autostart` existed starts
with the core when it was left on, as that core did.

A Linux core with neither `DISPLAY` nor `WAYLAND_DISPLAY` set has no desktop to
show a window on: it does not start the app, and its card says so.

The plugin's card shows the app's state (running, starting again, stopped,
crashed with its exit code, or unavailable with the reason) with Start, Stop
and Restart. `plugins.app` answers with the plugin's state, and every change is
announced by `plugins.updated`. The state is `PluginState.app`:

```ts
{ enabled: boolean; autostart: boolean; status: 'stopped' | 'starting' | 'running' | 'crashed' | 'unavailable';
  pid: number | null; exitCode: number | null; error: string | null; startedAt: number | null }
```

A core older than `plugins.autostart` sends no `autostart`, and the gear shows
no switch.

### Showing Boite

An app that wants the owner to look at something calls
`ui.reveal {target}`, where `target` is `{ "kind": "thread", "threadId": "<thread id>" }`,
`{ "kind": "agent", "agentId": "<agent id>" }` or `{ "kind": "update" }`, the app updates
a newer Boite is installed from. A thread must exist on the core; an
agent id is 1 to 200 characters. The core sends the `ui.reveal` event to every
owner connection except desktop-app plugins, the caller included, and answers
`{delivered}`, the number of connections it reached.

A thread or an agent on another machine of the user's Boite takes that
machine's core id as `coreId`, on a thread target as on an agent one:
`{ "kind": "thread", "threadId", "coreId" }`. The id is the 64 hex character
fingerprint `collaboration.peers` and `group.get` list. The core accepts it
when it is a member of its group or a machine trusted for coordination, and
refuses any other with `target.coreId`; it cannot see that machine's journal,
so the thread id there is only checked for length (1 to 200). The core's own
id means the core itself and is dropped from the event, so a target on this
core reads the same with or without it. A core that understands `coreId` says
so in its `hello` answer, `core.features.revealMachines`. An older core drops
the field, refuses a thread it does not have and opens its own agent page, so
an app checks the flag before it names a machine.

The desktop shell connected to the core it started on the same computer
answers it: it unminimizes and focuses its window, then opens the thread, the
Bots page on that bot (switching the Bots experiment on if it was
off), or the app updates in Settings, Machines. A target with `coreId` opens on
the window's machine whose core has that id; when the window has no such
machine, or has it but not connected, it says so on the page it shows and opens
nothing. Browser tabs, paired devices and windows following another machine do
nothing.

The owner and a plugin granted the `ui.reveal` permission may call `ui.reveal`;
the event stays owner-only. A paired device or an agent that calls it is
refused, and neither receives it.

## Gateways

A plugin that provides `gateway` is a subscription gateway speaking Douane's
runtime contract, such as [Douane](https://github.com/mtsu-dev/douane). Boite
runs it in the background; the subscription proxy's local mode points at it
([providers](providers.md#douane-on-this-machine)).

```json
"provides": { "gateway": {} }
```

`gateway` takes no field; any key in it is refused. The executable answers:

- `<executable> --config <file>`: it reads the TOML file Boite wrote, whose
  relative paths resolve from the file's folder.
- `GET /health` with `{"status":"ok","version":"<version>"}` once it serves.
- `GET /admin/api/summary` with `in_flight`, the requests it is serving, open
  on loopback without a token.

Its data lives outside the plugin directory, so an uninstall keeps it:
`<dataDir>/douane/` for Douane, `<dataDir>/gateways/<id>/` for any other. Boite
writes `<executable>.toml` there once:

```toml
[server]
listen = "127.0.0.1:8787"
auth_dir = "auth"
database = "douane.sqlite"
```

and afterwards only moves its `listen` line, because the gateway saves its own
settings into the same file. The port is the one remembered for the plugin
(journal setting `gateway-port:<id>`) when it is free, 8787 otherwise, any free
port last; a new port is remembered and, for Douane, written into the proxy's
URLs.

The core runs it:

- when the core starts while Start with Boite is on, after its install or an
  update while it is on, and on Start or Restart
  (`plugins.gateway {id, action: "start" | "stop" | "restart"}`);
- from its data directory, through the core's process launcher as
  `plugin:<id>:gateway`, with no window and no `DISPLAY` requirement;
- with the core's environment minus every agent variable, `BOITE_TOKEN` and
  `BOITE_CORE_URL`: a gateway never talks to the core. `NO_COLOR=1` is added.

Its stdout and stderr go to the core log line by line (`source: plugins`,
`event: gateway.output`), never to a client. It counts as started once
`/health` answers, within 30 seconds; one that stays silent is stopped and
treated as a crash. Crashes, Stop, uninstall and core shutdown follow the
[desktop apps](#desktop-apps)' rules: 2, 10 and 30 seconds, then `crashed`
after a fourth exit within five minutes; whether it is on and whether it
starts with Boite are kept in `<dataDir>/plugins/<id>/gateway.json`, and the
same switch sits behind its gear.

An update waits until `in_flight` reads 0 (five minutes at most, then it goes
ahead), stops the gateway, keeps the old executable as `<executable>.previous`
and starts the new one. The old one is deleted once the new one answers
`/health`. When it does not, the old one goes back and starts again, and the
update fails with the reason, keeping the version that worked.

On Linux, a gateway a dead core left running is stopped at the next start when
its command line still names this configuration (`gateway.pid` in its data
directory). Elsewhere the core's Job Object (Windows) or service manager takes
it down with the core.

`PluginState.gateway` carries its state:

```ts
{ enabled: boolean; autostart: boolean; status: 'stopped' | 'starting' | 'running' | 'updating' | 'crashed';
  port: number; version: string | null; pid: number | null; exitCode: number | null;
  error: string | null; startedAt: number | null; dataDir: string }
```

Douane's gear in Settings > Plugins shows it with Start, Stop and Restart, Open
Douane (its dashboard, beside the core only) and Move my connections to Douane,
which moves this machine's sign-ins into the plugin (`subscriptionProxy.move`
with `target: "plugin"`, [providers](providers.md#moving-connections-to-douane)).
Its uninstall confirmation says where the sign-ins stay.
`BOITE_DOUANE_BINARY=<path>` runs that executable for Douane instead of the
installed one; a `.ts` or `.js` path runs with the core's Bun, which is how the
tests' fake Douane starts.

## Install and run

A recommended plugin installs from its card. A plugin from a URL takes two
steps:

1. The owner pastes the repository and, optionally, a branch, tag or commit
   (the default branch otherwise), then clicks Preview. The repository is
   read the way people share it: its https URL, any page of it (a release,
   tag, commit, branch, folder or file page names that ref; for a folder or
   file, the core asks the repository for its branches and tags,
   `git ls-remote`, to tell where the ref ends and the path begins),
   `owner/repo` for GitHub, or the `git@host:path` clone URL, which names the
   same repository over https. A ref typed apart wins over the page's and,
   like a release, tag or commit page's, is fetched exactly: a missing one
   is refused, never cut back to a branch that exists. Or
   the owner tells an agent "add this plugin: <link>": the agent runs
   `boite plugin add <link> --why <reason>`, and the card it puts in the
   conversation opens this preview ([CLI](cli.md#commands)). The core fetches
   that one commit and reads the manifest (`plugins.inspect`). The page shows
   the name, version, source commit, download URL, SHA-256, the command lines
   and the pools, and for schema 2 the permissions and the commands, skills
   and slash commands it adds. Nothing is downloaded or run yet.
2. Install (`plugins.add`) installs exactly the manifest the preview showed, at
   the commit it showed. A push to the repository in between changes nothing.
   A preview is valid for ten minutes and is used once.

The download:

- is the artifact for the core's platform, over https, redirects included;
- takes at most 64 MB, and stops after 30 seconds without a byte or after 30
  minutes in all, so a slow link that keeps sending still finishes;
- shows its progress and can be cancelled.

The SHA-256 is checked before anything is written as the executable. The core
then records the install:

```
<dataDir>/plugins/seat-pool/
  seat-pool.exe        the executable (no extension off Windows)
  installed.json       what was installed, from where, when
  app.json             a desktop app only: whether it is on and starts with Boite, once changed
  gateway.json         a gateway only: whether it is on and starts with Boite, once changed
```

```json
{
  "schema": 1,
  "origin": "url",
  "source": {
    "url": "https://github.com/example/seat-pool",
    "ref": "v1.4.0",
    "commit": "3f9c2a7e5b1d4c6a8e0f2b4d6c8a0e2f4b6d8c0a"
  },
  "installedAt": 1789816835477,
  "manifest": { "schema": 1, "id": "seat-pool" }
}
```

`manifest` is the whole manifest as read; it is cut short above. A recommended
plugin records `"origin": "recommended"` and `"source": null`. Both files are
written under a `.part` name and renamed into place.

A first install that fails or is cancelled deletes the directory. An update that
fails keeps the version that worked.

Updating:

- A recommended plugin shows Update to X.Y.Z when a newer version is
  available: either Boite ships a newer entry, or the plugin's update source
  publishes a newer release (see [Updates from the source](#updates-from-the-source)).
  The newest of the two wins, and the version installed is never replaced by
  an older one. The card shows the download's progress, Cancel and any error.
- A URL plugin updates when the owner reads the same URL again at a newer ref;
  the preview names the version it replaces.
- An id already installed from another URL is refused, so one repository cannot
  take over another's install.
- Reinstall downloads again from the manifest recorded in `installed.json`,
  without fetching the repository.

### Updates from the source

A recommended entry may name an update source, so a plugin release reaches
installed copies without a Boite release:

```json
"updates": { "repository": "https://github.com/Skollheim/bots", "ref": "main" }
```

The field sits in Boite's reviewed list only. A plugin's own
`boite-plugin.json` refuses it like any unknown field, so a plugin cannot point
Boite anywhere else.

When the core checks:

- a minute after it starts, then every six hours, for the recommended plugins
  that are installed. A core whose owner never installed one sends nothing.
- when the owner clicks Check for updates behind the plugin's gear
  (`plugins.checkUpdates {id?}`), whether it is installed or not. A check
  finished less than ten seconds before answers instead of a new read.
- when the owner opens Settings > Plugins, for recommendations not installed
  yet. The list appears immediately and the available versions refresh as
  their sources answer. Their gears also offer Check for updates and their cards show
  checking or failure notes before installation.
- when the owner installs or updates the plugin, before the download: a first
  install brings the release the source names, not a pinned entry several
  releases behind. A source that fails or takes more than 15 seconds leaves
  the newest version already known.
- A read that fails waits 15 minutes, then twice as long each time, up to six
  hours. The card shows the failure as a quiet note, never as an install error.

The core reads `boite-plugin.json` at the ref through the same git path,
limits and rules as `plugins.inspect`. It offers the manifest found only when:

- it passes every manifest rule: every artifact https, with a SHA-256;
- its `id`, `name`, `homepage`, `executable` and `provides` are those of the
  reviewed entry;
- its version is strictly newer, by semver, than both the entry and the
  version installed;
- it has an artifact for the core's platform.

Otherwise it is not offered, and the gear says why. A release
taken back at the source stops being offered at the next check. Installing
what was found is the owner's click. It takes the usual path: download, SHA-256
check, and a desktop app stopped before the binary is replaced and started
after. `installed.json` records the manifest that was installed, as for any
install, with no new field, so an older core still reads it.

`PluginState.updates` carries the source, whether a check is running, when the
last one finished and the next is due, the release on offer (version, commit,
time), and the reason a release was ignored or the check failed. Every change is
announced by `plugins.updated`. An older core sends no `updates` field, and the
UI then shows no check.

When a check finds a release, the owner's conversation view shows a notice in
its top right corner: « B.O.T.S 0.1.10 est disponible », with Plus tard and
Mettre à jour. It waits while Settings are open, where the Plugins page shows
the same update. It
shows once per version and machine: either answer holds until a newer version.
The answers are kept in the window's local storage. A paired device sees no
notice and cannot call `plugins.checkUpdates`.

Uninstall deletes `<dataDir>/plugins/<id>/`, which is everything an install
wrote. Whatever the program itself saved elsewhere, such as the logins in its
pools, stays where it put it. Say in your README where that is.

When `installed.json` cannot be read, the card reports the file and offers a
reinstall. When it reads but breaks a rule above, the card says the plugin was
refused, with the file, the field and the expected value, and offers only
Uninstall.

## Security model

Plugins run with the core user's permissions. Manifest validation and SHA-256
checks establish which bytes run; they do not sandbox the executable. The
preview states this before installation. Every `plugins.*` method but
`plugins.ui` is owner-only; a paired device receives
`plugins.list is for the owner only`. `plugins.ui` is the device's too: a
phone draws the interfaces the owner installed.

Reading the repository:

- The URL must be https, with a host and no user or password. A query and a
  fragment are dropped before git runs, so a token pasted there never reaches
  the install record. Other transports are refused, never rewritten, except
  `git@host:path`, read as `https://host/path`.
- An install from `<url>.git` and an update read from `<url>` are the same
  repository: the host is compared in any case, `.git` and a trailing slash
  ignored.
- git runs through the core's process launcher, traced as `plugin:fetch:<n>`.
  It runs with `protocol.allow=never` and https as the one allowed transport,
  so `ext::`, `file://`, ssh and plain http are refused by git itself.
- Credential helpers and askpass are emptied and `GIT_TERMINAL_PROMPT=0` is
  set. A private or missing repository fails at once and never opens a
  sign-in.
- The core fetches the one commit with `--depth 1 --no-tags` into a
  temporary bare repository under `<dataDir>/plugins/` and reads
  `boite-plugin.json` out of it as a blob. There is no checkout, no hook, no
  submodule and no LFS, and the directory is deleted afterwards.
- Each git call has 60 seconds. git must be on the core's PATH.
- A ref is letters, digits, `.`, `_`, `/` and `-`, at most 200 characters. It
  must not start with `-`, contain `..`, or end with `/` or `.lock`.

Refused before anything installs:

- a missing `boite-plugin.json`, one over 64 KB (256 KB for schema 2), or one
  that is not valid JSON;
- any field outside the table above, or a value that breaks its rule;
- an http URL, or one carrying credentials, anywhere in the manifest;
- no artifact for the core's platform;
- the id of a recommended plugin;
- an id already installed from another URL;
- the id of a broken install, until the owner removes it;
- a download that redirects off https, is larger than 64 MB, or does not match
  its SHA-256;
- a plugin directory that is a symbolic link.

For account pools, Boite passes only the arguments above, checks the email is
an address, parses stdout only for `list`, and never shows a client the
program's output. An agent command's output goes to the agent that ran it,
and to nobody else.

A schema 2 plugin's processes hold the plugin's own token, which reaches only
the methods and events of the permissions the owner granted of those its
manifest asks for ([Permissions](#permissions)); the owner ticks that list
before installing.
The token limits what the plugin does through the core, not what its
executable does on the machine: it still runs as the core's user, like any
program you install, and can read that user's files, Boite's data directory
and the owner token in its `core.json` included. Permissions keep a plugin
that follows its manifest within it; they do not contain a program written to
get out, and the preview says so beside the list. A plugin with no executable runs nothing on the
machine; its skills, prompt and slash commands are text agents read.

A plugin granted `ui` runs code in every window of the core, the owner's
desktop app and paired phones included. That script is not limited by the
plugin's token: it runs in the page, as the person using it, and can call
anything that window can, read what it shows and change what it draws. The
`rpc` client it is handed is limited to its permissions so that a script that
follows its manifest stays within it, not to contain one that does not. Grant
`ui` only to a publisher you trust, as you would a browser extension.

A schema 1 desktop app holds the owner token. With it the app can do anything the owner
can: read every thread, start turns, change settings, install other plugins.
That is the price of a companion app that follows and drives your agents, and
why the preview says so before installation. It never receives an agent's
token or thread, so an agent cannot borrow the app's access, and an app is no
more trusted than any other executable you install: install one only from a
publisher you trust.

An update source moves part of that trust from the Boite review to the
plugin's repository. Whoever can push to its ref can offer new binaries, and
the SHA-256 then only proves the download is the one the manifest names. They
cannot:

- offer anything until the owner clicks Update;
- change the id, name, homepage, executable, features, schema, permissions or
  service: a plugin that wants the owner token, a permission or an account
  pool it did not have needs a Boite pull request;
- send an older version, an http download or a download without a digest;
- point Boite at another repository, since the source sits in Boite's list.

A recommended entry should name a source only when its publisher guards that
ref like a release.

## Test a plugin locally

For a schema 2 plugin, [dev mode](#dev-mode) is the short path:
`boite plugin dev <folder>` runs it from the folder, no publishing needed. The
steps below test the whole install, from a git URL with real downloads.

1. Build the release binaries and take their digests:
   `sha256sum seat-pool-linux-x64`, or in PowerShell
   `(Get-FileHash seat-pool-win32-x64.exe -Algorithm SHA256).Hash.ToLower()`.
2. Run the command lines by hand. `seat-pool list -opencode -Json` must print
   the JSON above and exit 0.
3. Publish the artifacts at https URLs, for example a pre-release, and push
   the manifest to a branch of a public repository.
4. Start a core on a throwaway data directory and the UI beside it:
   `bun run dev:core --data-dir <empty directory>` and `bun run dev:ui`.
   In Settings > Plugins, paste the repository URL and the branch name, read
   the manifest and install.

`add`, `switch` and `remove` act on the real CLI logins of the machine
whatever data directory the core uses. Try `list` first.

The core tests show a whole install without the network:

- `packages/core/test/plugins.test.ts` builds a repository with `git init`
  in a temporary directory.
- It sets `allowLocalSources` on the plugin store, which lets
  `plugins.inspect` read that repository by its path. It is a tests-only field
  no client can reach.
- It serves the artifact from a mocked `fetch`.

Run them from `packages/core`:

```sh
bun test test/plugins.test.ts test/plugin-manifest.test.ts test/plugin-updates.test.ts
```

`plugin-updates.test.ts` swaps the source read for a published manifest, and
its clock for one the test moves, to cover the checks, the backoff and every
refusal without waiting hours.

## Getting recommended

The recommended plugins are `packages/core/src/plugins/recommended.json`, an
array of manifests in the format above. Adding one is a pull request with one
entry:

- the artifact URLs pinned to a tagged release, not a moving `latest`;
- the SHA-256 of each artifact, which the reviewer checks against the download;
- a `homepage` where the source is public;
- optionally `updates`, the repository and ref where the plugin's
  `boite-plugin.json` describes its latest release. Name a branch only you can
  push to, and keep that manifest's id, name, homepage, executable and
  features as reviewed.

The core parses the list when it loads, and `plugin-manifest.test.ts` fails on
an entry the reader refuses. Once recommended, the id is reserved: nobody can
add a plugin with that id from a URL.

With an update source, a release is a push of the new `boite-plugin.json` to
that ref, after its artifacts are published. Installed copies find it within
six hours or at the owner's Check for updates. Without one, updating is the
same pull request with a new `version`, URLs and digests. A pinned entry newer
than what the source offers wins. Bump the entry now and then anyway: a fresh
install never reads the source by itself until the plugin is installed.
`BOITE_E2E_PLUGIN_INSTALL=1` runs the real download of Bots and its
uninstall in a temporary data directory ([development](development.md)).
