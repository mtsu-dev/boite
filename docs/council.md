# Council

A council asks models from several providers to review one request. Each
member reviews alone, read-only, without seeing the others, and gives a score
out of 10 with its remarks. Use it for a second, third and fourth opinion on
a diff, a plan or a design choice.

Experimental: turn it on in Settings, Experiments, Council.

Nobody debates and nobody votes. The conversation that started the council
reads the answers, sums them up, fixes what it accepts and asks for a fresh
review. Each full pass is one round.

## Start a council

1. Turn on the Council experiment.
2. In a conversation, ask the agent for a council review, for example "ask a
   council to review this migration plan". You can name the models.
3. The conversation shows a council card: the members' faces, the request,
   the round or state, and Open the salon.
4. When every member has answered, the agent gets one message with each answer
   and its score, then a table of scores by round.
5. The agent fixes what it accepts and asks the same members for another
   round. They review the whole work again from scratch.

By default the members are one model each from Claude Code, Codex and
Antigravity, at the Xhigh reasoning level. A model without that level runs
at its strongest level below it.

A council needs no Git, no pull request and no code: it works on a plan, an
idea or a design choice as well as on a diff. With a pull request, the agent
puts the table and its summary in the pull request's description; without
one, in its final answer.

## Follow it in the salon

Press Open the salon on the card. It opens in the right panel on a desktop and
full screen on a phone. It shows each round, each member's answer with its
score, and the table of rounds under them.

- Write to every member, or type `@` to address one AI. A member reads your
  message at the start of the next round, so it never changes a review under
  way.
- Close this round ends the round now: whoever has not answered has no score in
  it.
- Stop the council ends it. A round under way then sends nothing back.

## The scores

| Shown | Meaning |
| --- | --- |
| `7/10` | The score the member wrote |
| `none` | The member said a score means nothing for this request |
| `no score` | The member gave no score line, or did not answer in time |

Boite never makes a score up and runs no summary of its own: the agent writes
the summary.

## How read-only is kept

| Agent | Read-only by |
| --- | --- |
| Claude Code, Codex, Muse Code, Grok, OpenCode, OpenCode 2 | Plan mode |
| Antigravity, Hermes Agent | Boite refuses every permission it asks |
| pi | Only the instruction to change nothing |

Each member is also told to change nothing and start no subagent. OpenCode's
plan mode refuses edits but allows every command, so only that instruction
holds its commands back. A warning says so whenever read-only is weaker than
plan mode.

## Limits

- 2 to 6 members. Each round has 30 minutes by default, 1 to 120.
- The request and each update hold up to 12,000 characters.
- A member that is not installed or cannot run refuses the whole council.
  Boite never swaps in another model.
- A member past the time is absent from that round and asked again in the next.
- Only a top-level conversation starts a council: not a subagent, a team chat,
  an archived conversation or one whose subagents are paused.
- Stopping the conversation's subagents or archiving it stops a round under
  way.
- After a crash, a running round stops and the agent is told. An update or a
  restart from the app lets the round go on.

## Going further

- [Subagents](subagents.md): handing work to one child at a time.
- [Workflows](workflows.md): plans of many steps.
- [Experiments](experiments.md): the switches in Settings, Experiments.
- Technical reference: [council](internals/council.md).
