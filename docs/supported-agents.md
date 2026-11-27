# Supported agents

Boite does not replace your coding agent. It runs the agent you already use,
with the account you already pay for, and shows its work in one app.

## The list

| Agent | Made by | On Windows | On macOS and Linux | Sign in |
| --- | --- | --- | --- | --- |
| [Claude Code](https://code.claude.com/docs/en/setup) | Anthropic | Boite installs it | Install it yourself | From Boite |
| [Codex](https://developers.openai.com/codex/cli) | OpenAI | Boite installs it | Install it yourself | From Boite |
| [OpenCode 2](https://opencode.ai/v2/docs/) | OpenCode | Boite installs it | Install it yourself | From Boite |
| [OpenCode 1](https://opencode.ai/docs/) (obsolete, replaced by OpenCode 2) | OpenCode | Boite installs it | Install it yourself | From Boite |
| [Muse Code](https://developer.meta.com/ai/products/muse-code/) | Meta | Boite installs it | Install it yourself | From Boite |
| Antigravity | Google | Boite installs it | Boite installs it | From Boite, with a Google account |
| [Grok](https://grok.com/build) | xAI | Install it yourself | Install it yourself | From Boite |
| [Hermes Agent](https://hermes-agent.nousresearch.com/docs/getting-started/installation) | Nous Research | Install it yourself | Install it yourself | From Boite, by choosing a model and its key |
| [Mistral Vibe](https://github.com/mistralai/mistral-vibe#installation) | Mistral AI | Install it yourself | Install it yourself | From Boite, in a browser or with a Vibe key |
| [pi](https://github.com/earendil-works/pi) | Earendil Works | Install it yourself | Install it yourself | Type `/login` in Boite's sign-in terminal |

## Connect an agent

1. Open Settings, Providers and press Connect an AI.
2. Pick your agent. Boite installs it when it can and tells you the download
   size first. Otherwise it opens the agent's own installer page.
3. Follow the agent's sign-in prompts in the browser or in Boite's terminal.
   For pi, type `/login` in that terminal and choose your sign-in method. For
   Hermes Agent, choose a model and enter its key in Boite.
4. Start a conversation and pick the agent and model under the message box.

An agent you already use in a terminal shows up as ready, with your existing
sign-in. [Accounts](accounts.md) explains how to add a second account for the
same agent.

OpenCode 2 is on by default when you have made no choice in Providers. OpenCode
1 still runs. In Providers, open the OpenCode row to see both versions and their
individual switches.

## What each agent can do in Boite

| Agent | Attach images | Plan mode | Asks before acting | Automatic titles | Side questions | Native fork and rewind |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | Yes | Yes | Yes | Yes | Yes | Yes |
| Codex | Yes | Yes | Yes | Yes | No | Yes |
| OpenCode 2 | Yes | Yes | Yes | No | No | No |
| OpenCode 1 (obsolete) | No | Yes | Yes | No | No | No |
| Muse Code | Yes | Yes | Yes | No | No | No |
| Antigravity | Yes | No | Yes | No | No | No |
| Grok | No | Yes | Yes | No | No | No |
| Hermes Agent | Yes | No | Yes | No | No | No |
| Mistral Vibe | Yes | No | Yes | No | No | No |
| pi | On models that read images | No | No | Yes | Yes | Yes |

- On a pi model that takes text only, you can still attach other files. If
  you switch to that model with an image in your draft, or add an image while
  pi picks that model from the folder's settings, remove the image or switch
  models to send.
- Plan mode: the agent proposes a plan and waits for your approval before it
  changes anything.
- Asks before acting: the agent requests permission in the chat before it runs
  a command or edits a file. pi never asks.
- Native fork and rewind can resume the agent's saved session at a turn
  boundary. Other cuts carry the retained conversation into a new session.

When Antigravity starts helpers (`/swarm` or its own subagents) and pauses to
wait for them, the conversation keeps working until they report and Antigravity
writes its answer. Stop ends Antigravity and its helpers.

Every agent keeps its conversation when you close and reopen Boite, and you can
[switch agent or model](models.md) in the middle of a conversation.

## Use an agent that is not listed

Any agent that speaks the Agent Client Protocol (ACP) works. In Settings,
Providers, fill the Local ACP command card with a name and the command that
starts the agent. It then appears in the model picker like the others.

## Hide an agent you do not use

Each card in Settings, Providers has a switch. An agent that is turned off
disappears from the model picker. Nothing is uninstalled and your sign-in stays.
If you own the machine, press the turned-off provider label below the
conversation to open Providers on a computer or phone.

## Going further

- [Accounts](accounts.md): several accounts for one agent.
- [Models](models.md): change agent or model inside a conversation.
- [Usage](usage.md): tokens, cost and subscription limits per agent.
- [Updates](updates.md): how Boite keeps the agents up to date.
- Technical reference: [providers](internals/providers.md), for contributors
  and for adding an agent to Boite.
