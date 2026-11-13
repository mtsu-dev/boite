# Context, queued messages and side questions

The context is what the agent holds of your conversation. Boite shows how full
it is, compacts it when you ask or when a limit you set is reached, and lets
you keep writing while the agent works.

## Read the context meter

The ring beside the send button fills as the conversation grows. Hover it,
focus it or tap it to see the exact counts:

- Used, and the tokens available before the model's limit, or before
  auto-compaction when you set a token limit.
- Input, Cached input and Output, when the agent reports that breakdown.
- Compactions and Messages sent in this conversation.

The numbers come from the agent itself: Boite never estimates them. The ring
stays empty until the agent sends a first measurement. On a Claude thread,
What the agent sees opens the system prompt and tool definitions of the last
request, with an estimated size.

## Compact the conversation

Compaction replaces the history with a summary, so the next turn starts
smaller. A compaction can count as usage.

1. Open the context meter.
2. Press Compact context.

The button is off while a turn runs, before the first message, and for an
agent that does not offer compaction. Stop cancels it. A compaction shows in
the chat with the token counts before and after.

### Automatic compaction

Settings, Advanced, Automatic compaction sets when Boite compacts for you.
Without it, each agent keeps its own behaviour.

| Setting | What it does |
| --- | --- |
| Token limit | Compacts when the context reaches it, from 1,000 to 10,000,000 tokens. |
| As soon as the agent has finished | Two seconds after an answer that left nothing running. A message sent right after waits. |
| While the agent waits on background work | After an answer that left a command or a monitor running. |
| Before the prompt cache expires | One minute before the provider drops the cached conversation. |

- With a token limit, As soon as the agent has finished and While the agent
  waits on background work wait until 85% of it, and at least 64,000 tokens.
  Before the prompt cache expires does not depend on the limit.
- Compaction defaults by agent type keeps separate settings for
  Conversations, Subagents and Bots. Each uses Common until you pick Customize
  this type.
- Claude summary instructions replaces the summary prompt of Claude.
  `/compact` followed by your own instructions wins over it.
- Automatic compactions wait while a goal or a loop is active.
- On a phone connected as the owner, Automatic compaction is a row in the
  machine's settings.

Experimental, in Nightly builds only: Background compaction, in Settings,
Experiments. With a token
limit, a copy of the session compacts once the conversation reaches 85% of it,
while you keep working. It works with Claude and Codex; OpenCode 2 uses its
own. Copies spend the same account and are not counted in usage.

## Queue a message while the agent works

1. Press Enter while a turn runs. The message waits above the box with a
   dashed outline.
2. The agent receives it after its next tool, when the agent supports that,
   or when the turn ends.
3. To change it, press Up in the empty box or click it.
4. To send it now, press Send now or Enter in the empty box. This stops the
   current turn.

Escape stops the current turn. When Escape first closes a menu or a popover,
press it again to stop. While you answer an agent's question, Escape stops
nothing: Skip and the stop button still end the turn. On a phone, Enter writes a new line and the send
button sends. When the machine is offline, your messages wait on the device
and go out in order once it is back.

## Goals and loops

- `/goal <objective>` keeps the agent working, turn after turn, until it says
  the objective is reached and verified. See [Goals](goals.md).
- `/loop 2 <prompt>` runs the prompt twice, from 1 to 1000 times.
- `/loop 5m <prompt>` repeats it 5 minutes after each finished turn. Use `s`,
  `m` or `h`, from one second to 24 hours. A loop needs a count or an
  interval.

Both work with every agent and keep running when you switch conversations or
close the app. The bar above the box can pause, resume or remove them. After a
restart of Boite, press resume to continue.

## Ask a side question

In a Claude conversation, type `/btw <question>` to ask something while the
agent keeps working, even while it waits for a permission.

- The answer shows above the box. Escape or the close button dismisses it.
- It does not enter the conversation or change the context meter.
- Fork opens a new conversation that starts from that answer.
- Side questions take text only and need the machine online. Other agents do
  not offer `/btw`.

## Edit a sent message

Edit a message you sent to replace it and everything after it. Boite also
restores the files the removed turns changed, unless something else edited
them since or another agent still works in the folder. File backups cover the
newest 50 turns of a conversation.

## Going further

- [Models](models.md): what carries over when you change model.
- [Usage](usage.md): tokens, cost and the prompt cache timer.
- [Goals](goals.md): reviewed goals and the project board.
- [Experiments](experiments.md): unfinished features, in Nightly builds.
- Technical reference: [context](internals/context.md),
  [prompt cache](internals/prompt-cache.md).
