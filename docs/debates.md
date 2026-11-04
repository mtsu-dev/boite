# Debates between AIs

A debate asks several models one question. They answer in rounds: blind
first, then reading each other under anonymous letters, and voting in the last
round. A model that did not debate writes the summary, which comes back to the
thread that started the debate like a [subagent](delegation.md) result. The
owner follows the debate in its salon and can write there.

Debates sit behind the AI debates experiment (`debates`,
[experiments](experiments.md#ai-debates)), off by default.

## Start a debate

An agent starts one from its thread:

```sh
boite delegate debate "Where should the sync engine keep its cache?" \
  --models claude/claude-sonnet-5-5,codex/gpt-6.1-sol,claude/claude-haiku-5-5 \
  --rounds 3 --angles "battery first,latency first,simplicity first" \
  --summary claude/claude-opus-5-5 --effort xhigh --timeout 10
```

| Flag | Meaning | Default and bounds |
| --- | --- | --- |
| `--models` | The debaters, as routes from `boite delegate models`, comma-separated. The same route may appear twice. | 2 to 6 |
| `--rounds` | Rounds played, the last one with a vote. | 3; 1 to 5 |
| `--angles` | One angle per model, in the same order: the point of view each one argues from. | none; 200 characters each |
| `--summary` | The model that writes the summary. It does not debate. | `claude/claude-opus-5-5` |
| `--effort` | The reasoning effort of every debater and the summarizer. A model without that effort runs at its default, and the start says so. | the route's default |
| `--timeout` | Minutes a round may last. | 10; 1 to 60 |

The question holds at most 4,000 characters. The command returns at once with
the debate id (`dbt_…`), the salon's thread id, the debaters with their angle
and any warning; the summary arrives later as a message. `boite delegate list`
shows each debate of the thread with its round, time and models, and
`boite delegate stop <dbt_id>` stops one. `boite delegate stop` with no id
stops the thread's debates with its subagents.

Only a top-level thread starts a debate. A subagent, a team chat, a salon and
an archived thread are refused, and so is a thread whose subagents are paused.
Each model is checked as `delegate spawn --model` checks it: a bot only uses the
accounts and models it was given.

The RPC is `debates.start` (`packages/contracts/src/debates.ts`). A
`requestId` makes a retried start return the same debate; the same id with
other parameters is refused.

## Rounds

Each debater is a child thread of the thread that started the debate, created
before round 1. The core asks every debater once per round and collects its
final answer as a post of the salon.

- **Round 1 is blind.** Each debater answers the question alone.
- **Later rounds** give each debater the previous round's answers, under the
  letters of their authors. A debater must name at least one concrete objection
  before agreeing with an opinion, and says when another opinion convinced it.
- **Letters are anonymous.** Debaters read "Opinion A", "Opinion B", drawn at
  random per debate, never a model or a maker. The salon shows the owner the
  names.
- **Angles.** A debater with an angle is told to argue from it.
- **Answers** are at most 300 words, in the question's language, and start
  with `Position: <proposal in 12 words>`.
- **The last round votes.** Each debater ends with `Vote: <proposal>`, any
  opinion's, by its words or its letter. A letter counts with a reason after
  it (`B - proven`, `Option B: proven`); a proposal that merely starts with
  one (`A plan to…`) counts as words. A one-round debate has no vote.
- **Consensus.** When every debater backs the same position in round 1, the
  debate goes straight to the summary.
- **Quorum.** A round closes once every debater answered or the timeout
  passed; a debater that did not answer is absent from that round, its turn is
  stopped and it is asked again next round. Fewer than two answers in round 1
  stop the debate; fewer than two in a later round end the rounds and the
  summary follows.

## In the salon

The salon is a thread with no project that runs no agent: a turn started on it
is refused. The owner writes there with `debates.post`:

- Without `@`, every debater reads the message next round.
- With `@Name` (the handle the `@` list offers), only that debater reads it.

Debaters read the owner's messages as "the user", to everyone or to them only.

**Next round** (`debates.next`) closes the round now: whoever has not answered
is absent from it. **Conclude and summarize** (`debates.conclude`) lets the
current round finish, then goes to the summary. **Stop** (`debates.stop`) ends
the debate at once and nothing goes back to the thread. Once the summary is
being written the salon takes no more messages.

## Summary

The summarizer is a fresh child thread that took no part in the debate. It
reads the whole transcript under letters, the votes the core counted per
proposal and who was absent, and writes, in the question's language and under
3,500 characters:

1. each proposal with its strongest arguments for and against;
2. the votes per proposal as `n/m`, weighed against the arguments;
3. a table of the disagreements that remain;
4. the debaters who did not answer.

The summary reaches the starting thread as one message, once that thread is
idle, as a [subagent](delegation.md#follow-and-steer) result does. It starts
with a legend that maps each letter back to its model and angle, and is cut at
4,000 characters. A debate that stops on its own (quorum, a failed
summarizer) sends its reason instead. A stop asked by the owner or the agent
sends nothing.

The summarizer has twice the round timeout.

## Read-only

Debaters and the summarizer only read. A provider with a plan mode runs them in
it: Claude, Codex, Muse, Grok and OpenCode v2. A provider that asks for
approvals (Antigravity, Hermes, OpenCode, echo) has every permission refused by
the core. A provider with neither, pi, could change files: the start warns, and
the warning stays on the debate. Every debater's prompt also says it is
read-only.

## In the app

The thread that started a debate shows a card on the turn that ran the
command: up to three debaters' faces and the owner, the topic, the round or
the final state, and **Open the salon**. Once the summary is back, the card
shows its first lines.

The salon opens in the right panel on a desktop and full screen on a phone. Its
header lists the debaters with their angle, the summarizer marked as outside
the debate, the owner, a reminder that the AIs see each other anonymously, and
one bar per round. Posts are grouped by round under a line that says what the
round asks; a message to one debater says so. The verdict shows the votes
table and the summary. Under the posts, a line says who is still writing, then
the round controls and the composer, whose `@` button and list name one
debater.

With the experiment off, the core refuses every `debates.*` method with
`experiment-off`, the subagent guide does not mention debates, and the app
draws no card and no salon.

## Lifecycle

- Archiving the starting thread, or stopping all its subagents, stops its
  debates and sends nothing back; deleting it deletes them with their salons.
- A core that restarts after a crash stops its running debates and tells the
  starting thread why. A restart for an update carries them over, as it does turns
  ([restart handoff](restart-handoff.md)).
- Debaters and the summarizer are put away like finished subagents once the
  debate is over.

## RPC and events

| Method | Who | What |
| --- | --- | --- |
| `debates.start` | owner, agent | start a debate from a thread |
| `debates.list` | owner, device, agent | a thread's debates, the 30 newest first |
| `debates.get` | owner, device | one debate and its posts |
| `debates.post` | owner, device | write in the salon |
| `debates.next` | owner, device | close the round now |
| `debates.conclude` | owner, device | summarize after this round |
| `debates.stop` | owner, device, agent | stop; an agent only stops its own thread's debates |

`debates.changed` carries the debate id, the starting thread, the salon and a
version; a client reads the debate again with `debates.get`. Agents and paired
devices are allowed in `packages/contracts/src/access.ts`.
