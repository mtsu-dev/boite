# Permissions

A permission mode sets what the agent may do without asking you first. You
pick it per conversation from the mode chip (Permissions) under the message
box, and the agent asks in the chat for anything the mode does not cover.

## The modes

| Mode | What the agent may do without asking |
| --- | --- |
| Ask | Reads freely, asks before editing a file or running a command |
| Edit freely | Edits files without asking, asks before running a command |
| Auto | Runs everything without asking, anywhere on this computer |
| YOLO | Approves every tool request; your hooks still run |

- The chip offers these four. Plan (plan only, no changes) and Auto-deny
  (deny anything that would need asking) also exist. Claude can enter Plan
  by itself.
- Auto keeps a warning colour on its chip, since it reaches the whole
  computer. Boite asks for no confirmation.
- YOLO picks the agent's most permissive mode and also accepts every request
  that still reaches Boite, without a card. Your own hooks and plugin hooks
  still run.
- A mode never answers a question for you. YOLO does not fill in a form or
  complete a sign-in.

## Change the mode

1. Open the Permissions chip under the message box.
2. Pick a mode. The draft heading says it, for example "with edits allowed".

The new mode reaches the agent before its next prompt. Codex cannot change
it during a turn, so a running Codex turn is interrupted and resumed with the
new mode, in the same conversation.

## Per agent

| Agent | How the mode applies |
| --- | --- |
| Claude Code | All four modes, changed in place. When Claude moves to Plan by itself, the next turn puts your mode back. |
| Codex | No Edit freely. Its default reads This folder: it edits and runs commands in the folder without asking, and asks to go beyond it. |
| Muse Code | Edit freely approves a file write inside the conversation's folder once, without a card. |
| OpenCode, Grok and other ACP agents | Boite picks the agent's own mode with the same meaning. An agent that has no such mode runs the turn anyway. |
| Antigravity | YOLO uses the agent's own option to skip permissions. |
| pi | No Permissions chip. pi never asks, so no mode can hold it back. |

## Approve a request

When the agent needs your approval, a card appears in the chat with one line
saying what it wants, such as Run a command or Change followed by the
file name.

1. Read the line, and open Technical details for the exact command or input.
2. Press Allow or Deny.

The call then carries a shield: Allowed by you or Denied by you.

With Codex in its default mode, a command, a file change, a wider sandbox
(granted for the rest of the turn) and a tool from an MCP server each draw a
card. A request that needs a form, a link or a device check is declined for
now. Stop cancels an open Codex card rather than refusing it.

## Questions are not permissions

An agent can also ask you a question, under Asks you. No mode answers it, and
an agent that never asks for permission can still ask a question.

- Pick an option, or Answer in writing: the message box below becomes your
  answer, with any photos or files.
- Skip leaves the question unanswered.
- A card headed Question does not stop the agent: it keeps working, and goes
  on with a default if you do not answer.
- A question never takes over a message box you are typing in. It waits until
  the box is empty.

## Going further

- [Supported agents](supported-agents.md): which agents have plan mode and
  ask before acting.
- [Models](models.md): change the agent or model in a conversation.
- [Secrets](secrets.md): give an agent a key without pasting it in the chat.
- Technical reference: [providers](internals/providers.md#permission-modes).
