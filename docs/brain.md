# Brain

The brain is a folder of instructions and skills that every agent in Boite
shares. Connect it once and Claude Code, Codex and the others all start each
conversation with the same rules and the same skill catalog. Keep it in Git to
use the same brain on several computers.

## Connect a folder

1. Open Settings, Agents, Instructions and skills.
2. Press Browse and pick the folder, or type its path.
3. Press Connect folder.
4. Leave Share instructions automatically on to add the instructions and the
   skill catalog to each turn.

Each machine keeps its own path, so the same repository can live in different
places on different computers. Change folder edits the path. Disconnect
removes the setting and leaves your files alone.

## What Boite reads

| In the folder | Read as |
| --- | --- |
| `AGENTS.md`, `.agents/AGENTS.md` | Instructions, for every agent |
| `CLAUDE.md` | Instructions, for Claude Code only |
| `GEMINI.md` | Instructions, for Antigravity only |
| `skills`, `.agents/skills`, `.claude/skills`, `.codex/skills` | Skills: each a `SKILL.md` with a name and a description |
| `plugins`, `.claude/plugins`, `.codex/plugins` | Agent plugins, listed only |

The page shows Instructions, Skills and Plugins tabs with a count each. Select
a file to see its description and path. A malformed entry stays listed with
the reason.

- Edits apply on the next turn, with no restart.
- Skill bodies stay on disk; the agent reads one when it needs it.
- A skill marked `disable-model-invocation: true` becomes a `/name` command in
  the message box's slash menu. An agent's own command of the same name wins.
- Boite does not install the plugins it lists. Install them through their
  agent. Boite's own plugins are a separate thing, in Settings, Agents,
  Plugins.

## Use it outside Boite too

Global AGENTS.md links the brain's `AGENTS.md` into each agent's own user
profile on this machine, so the agents read it in a terminal as well. It is off
by default and needs automatic sharing on. Existing files are backed up first
and put back when you turn it off. Connected harnesses shows each link.

On Windows, these links need Developer Mode. If Windows refuses them, press
Win+R, open `ms-settings:developers`, turn on Developer Mode, accept the
confirmation, then come back to Brain and press Try again.

## Sync between computers

Use a Git checkout with an upstream branch on each computer, with Git and its
sign-in already working there. A plain folder still shares instructions, but
does not sync.

- Synchronize fetches, fast-forwards incoming commits and pushes yours.
- It never commits, stashes, resets or force-pushes. Uncommitted changes,
  diverging histories or a missing upstream stop it: commit with Git first.
- Pull automatically has two options, both off: At startup, and Periodically,
  every 1 to 1440 minutes. Automatic pulls never push.
- Sync details shows what is waiting to send and receive and the last sync.

Boite does not clone a repository or commit your edits.

## The Boite guide

Separate from your brain, Boite gives every agent session a short guide to its
own commands and panel, about 300 tokens. The Boite guide switch on this page
turns it off. Short answers, in Settings, Conversations, Agent replies, on by
default, adds one
paragraph to each turn asking for brief, plain answers; turning the Boite
guide off removes it too.

## Hooks

A hook is a script an agent runs on its own events, such as before a tool
call or when a turn ends. Boite never runs one itself. It makes sure each of
your accounts finds your hooks, and shows what they did on the Hooks card of
this page, with or without a brain folder.

| Agent | Where its hooks live | Runs reported |
| --- | --- | --- |
| Claude Code | `hooks` in its `settings.json`, plus plugin hooks | Yes |
| Codex | `hooks.json`, each hook trusted in `config.toml` | Yes |
| Grok | `hooks/*.json`, and Claude's `~/.claude/settings.json` | No |
| pi | Its extensions | No |
| OpenCode and OpenCode 2 | Its plugins | No |

- Each agent has one row with what Boite found, such as "13 hooks". For
  Claude Code and Codex it also counts runs, blocked, failed and skipped.
  Open the row to see each source path.
- Recent lists the runs that blocked or failed, newest first, with the agent,
  event, hook and reason.
- A hook that refuses your prompt or stops the turn also shows in the
  conversation with its reason.
- Counts start when Boite starts on this machine.
- A Codex hook nobody reviewed counts as skipped. Review new hooks in your own
  Codex profile; the next start copies the trust to your other accounts.

Hooks still run in a mode that skips approvals. They are off in a Neutral
[subagent](subagents.md#context-modes) and in Boite's own background checks.

## Limits

- Only the owner sees and changes the brain, from the desktop app or a
  browser of any size. A paired device cannot.
- Instructions already in a conversation stay there after you disconnect:
  start a new conversation to drop them.
- Instructions and catalog together are limited to 128 KiB. The scan stops
  at 500 entries and 64 KiB per file, and says so.
- Links that point outside the folder are reported and not read.

## Going further

- [Bots](bots.md): each bot has a brain folder of its own.
- [Plugins](plugins.md): Boite's own extensions.
- [Accounts](accounts.md): separate accounts and what they share.
- [Subagents](subagents.md): context modes that leave the brain out.
- Technical reference: [brain](internals/brain.md),
  [hooks](internals/hooks.md).
