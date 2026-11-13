# Plugins

A plugin adds to Boite without a change to the app. It can give your agents
new `boite` commands, skills and guide lines, add slash commands to the
message box, run a background service, start a desktop app beside Boite, or
put its own buttons, panel tabs and commands in Boite's window.

A plugin is a program that runs on the machine hosting your core. Boite checks
the download against the SHA-256 its manifest publishes, but does not sandbox
it: install one only if you trust whoever publishes it.

## Install a plugin

Settings, Agents, Plugins is a grid of cards: your installed plugins first, then the
recommended ones. Search plugins finds one by name or author, and Show narrows
the grid to All, On or Off.

To install a recommended plugin, press Install on its card.

To install one from a repository:

1. Press From a URL and paste the Repository URL: its https URL, any page of
   it, or `owner/repo` for GitHub.
2. Optionally fill Branch, tag or commit. The default branch is used
   otherwise.
3. Press Preview. Boite reads the manifest and shows the source commit, the
   download URL, its SHA-256, and what the plugin adds and reaches. Nothing is
   downloaded or run yet.
4. Press Install. Boite installs exactly what the preview showed, even if the
   repository changed in between. A preview is valid for ten minutes.

You can also ask an agent: "add this plugin" with its link. The agent puts a
card in the conversation that opens the same preview, and you decide.

## Permissions a plugin asks for

Before an install, and before an update that asks for more, Boite shows
"<name> wants to access your Boite" with one line per permission. Untick what
the plugin should not get, then press Allow.

| Permission | What it lets the plugin do |
| --- | --- |
| Read your threads | Titles, messages, state, and the projects they sit in |
| Manage your threads | Create, archive, rename, start a turn. It spends your agents' quota |
| See your projects | Icons, file lists and the skill menu |
| Manage your projects | Add, rename or archive a project |
| Read your boards | The cards of every project board |
| Change your boards | Add, edit, move and remove cards |
| See your agents | Mochis, delegated work, workflows and teams |
| Direct your agents | Wake a mochi, write to a child or a team, stop their work |
| Read your files | Any file of your projects, their changes and this machine's folders |
| Answer for you | Approves the tools and answers the questions agents ask you. Shown in red |
| See your screens | What an agent's browser, an emulator or a window shows |
| Use your screens | Taps, types and opens there |
| Read this machine's state | Load, usage, quotas, agents and settings |
| Show a thread | Brings a thread or a mochi to the front in the app |
| Change Boite's interface | Its code runs in the app: it can do anything you do. Shown in red |

- A plugin with a program also shows Runs a program on this machine, which
  you cannot untick.
- Permissions limit what the plugin asks Boite. They do not limit what its
  program reads or runs on the machine, Boite's own files included.
- No plugin ever reaches your accounts and sign-ins, your secrets, other
  plugins, Boite's updates, pairing or your contacts.
- To change its grants later, press the gear on its card, then Edit under
  Authorizations. A running service or app restarts with the new ones.
- What a plugin does in your name is marked: a message it sent reads "By
  plugin" and its name, and a thread it archived says so.
- An older plugin shows Reaches all of Boite: its program gets your own
  access, not a list of permissions.

## Update a plugin

- A recommended plugin shows Update to and the version when a newer one is
  out. Boite checks a minute after it starts, then every six hours. Check for
  updates, behind the card's gear, asks now.
- When a check finds a release, the conversation view shows a notice with
  Update and Later, once per version.
- A plugin from a URL updates when you preview the same URL again at a newer
  branch, tag or commit. The preview names the version it replaces.
- A failed update keeps the version that worked.

## Turn off, run and stop

The switch on a card turns a plugin off without uninstalling it. Nothing of it
runs and agents no longer see what it adds; its files, data and settings stay.

The gear on a card opens the plugin's own settings, when it declares some,
with its Authorizations, source and updates.

A plugin with a service or a desktop app has Start, Stop and Restart behind
its gear, and a Start with Boite switch that decides whether it starts with
the app. After a crash Boite starts it again after 2, 10 and 30 seconds; a fourth
crash within five minutes leaves it Crashed until you start it.

On Linux without a display, a desktop app does not start, and its card says so.
A service runs anywhere, a headless server included.

## Plugins that change the interface

A plugin granted Change Boite's interface can add:

- buttons in a conversation's header, in the message box toolbar and at the
  foot of the sidebar;
- entries in a message's plugin menu, the puzzle button beside copy;
- tabs in the right panel, offered in its "+" menu;
- rows in the command palette.

They appear in every window of that core, the desktop app and your phones
included. That code runs as you: grant it only to a publisher you trust, as
you would a browser extension.

- When a plugin's interface fails, only that plugin's additions leave. Its
  card shows "Its interface stopped" with the error; Reload interface, behind
  its gear, tries again.
- Safe mode opens a window with no plugin interface: add `?safe=1` to the
  address. Boite also starts in Safe mode by itself when it closed while
  plugin interfaces were loading the time before. A notice says so, with a
  Load them button.
- A recommended plugin cannot bring an interface.

## Account pools

Some plugins keep several logins of an agent's command-line tool, under
Account pools behind their gear. Save current CLI login stores the login the tool
uses now, Use this account makes a saved one its default again, and Forget
account removes it. This changes the tool's default login, outside Boite too.
Boite's own accounts in Settings, AI accounts, Providers keep their own
login.

## Remove a plugin

Press the gear on its card, then Uninstall, and confirm. Boite deletes the plugin's folder in
its data directory. What the program saved elsewhere, such as saved logins,
stays where it is.

## Limits

- Each machine has its own plugins. With several machines connected, the
  Machine menu beside the heading switches between them.
- Only the owner installs, updates or removes plugins. A phone connected as
  the owner has the same page, with the gear opening as a sheet; a paired
  device has none.
- The download is limited to 64 MB, over https only.
- Plugins detected in your [brain](brain.md) folder are agent plugins, not
  these: install them through their agent.

## Write your own

A plugin is a Git repository with a `boite-plugin.json` at its root. The
[technical page](internals/plugins.md) walks through a complete example in five
minutes, the manifest fields, the permissions, the SDK, dev mode for testing
from a folder, and how to get a plugin recommended.

## Going further

- [Brain](brain.md): shared instructions and skills, with no program to run.
- [Secrets](secrets.md): what agents can and cannot read.
- [Accounts](accounts.md): Boite's own accounts per agent.
- Technical reference: [plugins](internals/plugins.md).
