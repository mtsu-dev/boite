# Privacy

Boite runs on your machines and keeps your conversations there. This page
lists what it sends over the network, how to turn off its optional usage
analytics, and how an organization can lock these choices with a policy file.

## What Boite sends over the network

Your agents talk to their own model provider during a turn; Boite does not
change that traffic. Besides it, Boite connects out for the following:

| Purpose | Destination | When | How to stop it |
| --- | --- | --- | --- |
| Usage analytics | Boite's analytics relay | Every 5 minutes, a daily ping | Settings, General, Privacy and analytics |
| App and server update checks | GitHub releases | After start, every 6 hours, Check for updates | Policy file only |
| Agent version checks and updates | npm, the agent's vendor | After start, every 6 hours, Update | Turn the agent off |
| Agent installs and sign-ins | The agent's vendor | When you press Install or Sign in | Do not press |
| Limits | Each provider's usage service, with the account's token | Limits page and sidebar bars | Quota monitoring off for the account |
| Subscription gateway | The gateway you saved | While it is on | Turn the gateway off |
| Plugins | The plugin's Git repository and downloads | Install, update checks | Uninstall the plugin |
| Cloud dictation | Groq or OpenRouter, with your key | Each dictation with the API engine | Settings, Voice: the Local engine, fallback off |
| Phone notifications | Your browser vendor's push service, encrypted | Each notification | Turn notifications off on the device |
| Issue reports | GitHub, through your `gh` or a prefilled issue page | When you report a problem | Do not report |
| Pull requests | GitHub, through your `gh` | While `gh` is signed in | Policy file |
| Agent browser and previews | Any site the agent or you open | Agent browser commands, opening a preview | Policy file only |
| Machines, groups, contacts | Machines you added or joined, Tailscale | While connected | Remove the machine, leave the group |

A plugin you install is a program of its own and may reach any address.

## Usage analytics

Boite can count how it is used, to know what to fix first. There are three
modes:

| Mode | What is sent |
| --- | --- |
| Off | No usage data. Only the choice of Off itself is counted, as described below. |
| Anonymous counters (the default in published builds) | Active installations under a hashed random ID, and launches, conversations and turn outcomes under IDs that change every day. No profile. |
| Enhanced analytics (off by default) | Also the public models you pick, reasoning level, speed, permission modes, durations and token volumes, under a stable random ID. Private models count as "other". |

Every event carries the app version, the system and its version, and the
processor type. Boite never sends prompts, answers, reasoning, tool arguments,
file contents, project names, paths, account details, error messages,
screenshots or recordings. The relay sees your IP address to find the
country, build the daily IDs and limit requests; it does not forward it.

Your first choice is on the tour's last screen. Your choice of mode is
counted anonymously, without an installation ID, even when you pick Off.

### Turn analytics off

1. Open Settings, General, Privacy and analytics. On a phone connected as the
   owner, it is Settings, This phone, Privacy.
2. Turn off Anonymous counters and Enhanced analytics.

Turning Enhanced analytics off also asks for its data to be deleted. Deletion
takes some time; until it is accepted, the page says it is pending and Retry
deletion sends it again. Export analytics data downloads your enhanced events
as JSON.

- A paired device or an agent cannot read or change these settings.
- A build you made yourself has no relay and says that nothing is sent.
- To turn off all analytics traffic on a machine, start Boite with the
  environment variable `BOITE_TELEMETRY_URL` set to an empty string.

## The admin policy file for organizations

An administrator can lock what Boite does on a machine with one JSON file. A
key that is absent leaves the choice to the user, and a machine without the
file behaves as usual.

| System | Path |
| --- | --- |
| Linux | `/etc/boite/policy.json` |
| macOS | `/Library/Application Support/Boite/policy.json` |
| Windows | `%ProgramData%\Boite\policy.json` |

Only when no file is at that path does Boite read the file named by the
`BOITE_POLICY_FILE` environment variable, which suits a container. A user who
can set environment variables can point it elsewhere, so a machine-wide policy
belongs at the system path, writable only by administrators.

This example turns analytics and issue reports off and keeps updates manual:

```json
{
  "analytics": "off",
  "issueReports": false,
  "plugins": { "recommended": false },
  "updates": { "app": "check", "server": "check", "agents": "check" }
}
```

Keys exist for analytics, app, server and agent updates, allowed and blocked
agents, the subscription gateway, quota reads, plugins, issue reports,
dictation, remote resources in previews, the agent browser, the agent desktop,
local network access, Tailscale, groups, contacts, push notifications and pull
requests. [Network flows](internals/network.md) maps each connection to its
key, and [admin policy](internals/enterprise.md) lists every value.

- Boite looks at the file every 3 seconds: an edit applies without a
  restart. Only `network.lan` and `network.contacts` need one.
- A locked control is drawn disabled with a lock that names the key and the
  file. Settings, General lists the locks under Managed by your organization,
  and a banner above every settings page lists problems in the file.
- A file that cannot be read or is not valid JSON locks every key to its
  strictest value, with no agent allowed, until it is fixed. A key with a bad
  value takes its strictest value; the others still apply.
- The policy does not inspect where an allowed agent sends its model traffic.

## Going further

- [Troubleshooting](troubleshooting.md): what an exported report contains.
- [Usage](usage.md): quota reads per account.
- [Voice](voice.md): local and cloud dictation.
- [Plugins](plugins.md) and [machines](machines.md): what they connect to.
- Technical reference: [analytics](internals/analytics.md),
  [network flows](internals/network.md), [admin policy](internals/enterprise.md).
