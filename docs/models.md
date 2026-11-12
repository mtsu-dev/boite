# Models, effort and speed

Each conversation runs on one agent, account and model at a time. You can
change any of them, along with the reasoning effort and the speed, in the
middle of a conversation without losing it.

## Pick a model

1. Open the agent chip under the message box (Provider and model).
2. Choose an agent in the left column, then an account if it has several.
3. Choose a model. Search models filters the list by name or id; older models
   sit under Legacy models.
4. Open the effort chip beside it to set the Reasoning effort, and press the
   lightning button to cycle the Response speed.

- The star on a model adds it to Favorites, the first entry of the column.
  Your favorites follow you on every machine you own. A paired phone or
  browser shows them but cannot change them.
- The effort scale has one notch per level the model reports. Default lets
  the agent pick its own level for that model.
- The lightning button goes through the speeds the model offers, such as Fast
  and Ultrafast, then back to Standard speed.
- Refresh models reads the agent's list again. The list also refreshes by
  itself when you reopen the picker after five minutes.
- On a phone, the agent logos form a strip above the models instead of a
  column, and the search field waits for a tap.

## Default models

Settings, Providers, Default models sets a model and effort per agent for new
threads, on this device. Existing threads keep their own choice. Without one,
Claude starts on Opus 5.5 at high effort, Codex on GPT 6.1 Sol at medium and
Grok on Grok 4.7 at high.

## Change during a conversation

A new model or account applies to your next message. A turn that is already
running, or a message waiting in the queue, keeps the one it started with.

Effort and speed can reach the turn that is running, from its next model
request, when the agent allows it:

| Agent | Effort during a turn | Speed during a turn |
| --- | --- | --- |
| Claude Code | Yes | Turning fast off, yes; on, next turn |
| Codex | Yes | Yes |
| ACP agents, such as OpenCode | As the agent applies it | Next turn |
| pi | Yes | Next turn |
| Grok, Muse Code, Antigravity | Next turn | Next turn |

A change never interrupts a turn. A change of permission mode applies at once;
see [Permissions](permissions.md).

## What carries over

| Change | What happens |
| --- | --- |
| Model, same account | The agent keeps its session. |
| Account or agent | The new agent starts a fresh session with excerpts of the conversation. |
| Back to an account used before | The session left there resumes, with what you missed since. |

- The excerpts cover the opening and the most recent exchanges, about 20k
  tokens, plus tool results and recent images. Older details may be missing.
  Private reasoning and past approvals do not carry over.
- When the conversation holds more than 200,000 tokens, Boite asks before it
  switches account or agent. Compacting first changes nothing.
- An agent that cannot read images refuses a conversation that holds images.
- The conversation, its folder and its worktree stay where they are.

## The prompt cache

Changing the model or the effort can make the provider read the whole
conversation again without its cache, which uses more of your quota. When the
conversation holds more than 100,000 tokens and was measured less than an hour
ago, Boite asks first: Change or Keep as is. See [Usage](usage.md) for the
cache timer.

## Words Claude Code acts on

With Claude Code on a Claude model, typing `ultrathink` anywhere in a prompt
asks for the deepest thinking on that turn, and `ultracode` lets the turn use
workflows when your account has them. The message box colours both words.
Another agent reads them as plain words.

## Limits

- A model the account no longer offers is refused by name, including a
  favorite.
- An ACP agent that refuses the model you picked fails the turn before it
  runs, rather than running on the old model.
- Ultrathink is offered for Claude only.

## Going further

- [Supported agents](supported-agents.md): which agents Boite runs.
- [Accounts](accounts.md): several accounts for one agent.
- [Context](context.md): context usage and compaction.
- [Usage](usage.md): tokens, cost and limits.
- Technical reference: [model switching](internals/model-switching.md).
