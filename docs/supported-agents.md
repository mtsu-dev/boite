# Supported agents

Boite does not replace your coding agent. It runs the agent you already use,
with the account you already pay for, and shows its work in one app.

## The list

| Agent | Made by | On Windows | On macOS and Linux | Sign in |
| --- | --- | --- | --- | --- |
| [Claude Code](https://code.claude.com/docs/en/setup) | Anthropic | Boite installs it | Install it yourself | From Boite |
| [Codex](https://developers.openai.com/codex/cli) | OpenAI | Boite installs it | Install it yourself | From Boite |
| [OpenCode](https://opencode.ai/docs/) | OpenCode | Boite installs it | Install it yourself | From Boite |
| [Muse Code](https://developer.meta.com/ai/products/muse-code/) | Meta | Boite installs it | Install it yourself | From Boite |
| Antigravity | Google | Boite installs it | Boite installs it | From Boite, with a Google account |
| [Grok](https://grok.com/build) | xAI | Install it yourself | Install it yourself | From Boite |
| [Hermes Agent](https://hermes-agent.nousresearch.com/docs/getting-started/installation) | Nous Research | Install it yourself | Install it yourself | From Boite, by choosing a model and its key |
| [pi](https://github.com/earendil-works/pi) | Earendil Works | Install it yourself | Install it yourself | In pi itself |

[OpenCode 2](https://opencode.ai/v2/docs/) is also supported as an experiment.
It is turned off until you turn it on in Settings, Providers.

## Connect an agent

1. Open Settings, Providers and press Connect an AI.
2. Pick your agent. Boite installs it when it can and tells you the download
   size first. Otherwise it opens the agent's own installer page.
3. Sign in on the page your browser opens. This is the agent's own sign-in:
   your password never goes through Boite.
4. Start a conversation and pick the agent and model under the message box.

An agent you already use in a terminal shows up as ready, with your existing
sign-in. [Accounts](accounts.md) explains how to add a second account for the
same agent.

## What each agent can do in Boite

| Agent | Attach images | Plan mode | Asks before acting |
| --- | --- | --- | --- |
| Claude Code | Yes | Yes | Yes |
| Codex | Yes | Yes | Yes |
| OpenCode | No | Yes | Yes |
| OpenCode 2 | Yes | Yes | Yes |
| Muse Code | Yes | Yes | Yes |
| Antigravity | Yes | No | Yes |
| Grok | No | Yes | Yes |
| Hermes Agent | Yes | No | Yes |
| pi | Yes | No | No |

- Plan mode: the agent proposes a plan and waits for your approval before it
  changes anything.
- Asks before acting: the agent requests permission in the chat before it runs
  a command or edits a file. pi never asks.

Every agent keeps its conversation when you close and reopen Boite, and you can
[switch agent or model](models.md) in the middle of a conversation.

## Use an agent that is not listed

Any agent that speaks the Agent Client Protocol (ACP) works. In Settings,
Providers, fill the Local ACP command card with a name and the command that
starts the agent. It then appears in the model picker like the others.

## Hide an agent you do not use

Each card in Settings, Providers has a switch. An agent that is turned off
disappears from the model picker. Nothing is uninstalled and your sign-in stays.

## Going further

- [Accounts](accounts.md): several accounts for one agent.
- [Models](models.md): change agent or model inside a conversation.
- [Usage](usage.md): tokens, cost and subscription limits per agent.
- [Updates](updates.md): how Boite keeps the agents up to date.
- Technical reference: [providers](internals/providers.md), for contributors
  and for adding an agent to Boite.
