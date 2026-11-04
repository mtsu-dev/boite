# The council

A council asks models of several providers to review one request. Each member
reviews alone, read-only, without seeing the others, and gives a score out of
10 with its remarks. Nobody debates and nobody votes: the thread that started
the council reads the answers, summarizes them, fixes what it accepts and asks
for a fresh review. Every full pass counts as one round. The owner can follow
the members in a salon and write there.

It is an experiment, off by default: Settings, Experiments, Council. The stored
experiment id is still `debates`, so a switch that was on stays on
([experiments](experiments.md#council)). A thread asks for a council through the
`boite-council` skill, which lists how to read the answers and when to stop.

## Start a council

```sh
boite delegate council "<request>" [--models a,b,c] [--effort <level>] [--timeout <minutes>]
boite delegate council again <id> "<what changed>"
boite delegate council table <id>
```

| Flag | Default | Limits |
| --- | --- | --- |
| `--models` | `claude/claude-opus-5-5`, `codex/gpt-6.1-sol`, `antigravity/gemini-4-argon` | 2 to 6 members |
| `--effort` | `xhigh` | A model without that level runs at its strongest level below it, and a warning says so |
| `--timeout` | 30 minutes a round | 1 to 120 |

The request and the changes hold up to 12,000 characters. The command returns
the council id as soon as the members' model lists are read, which takes up to a
minute when none is saved yet; `delegate list` shows the council, `delegate wait` with
no agent id also waits for a round under way and `delegate stop <id>` stops it.
`requestId` on `council.start` and `council.again` makes a retry return the same
council or round.

A member whose provider is missing, or who cannot run, refuses the whole
council with the reason. Boite never replaces a member, so three providers do
not quietly turn into two of the same. A route that names a provider is that very
model: `twin/alpha` never falls through to `twin/alpha-next`, nor `antigravity/x` to
a gateway model spelled `codex/antigravity/x`. Before these checks Boite reads a
fresh model list when a named route is missing from the one it holds, which an
earlier version may have saved, and an ACP model's effort scale. A read still
going after 30 seconds carries on for the next try, and the refusal says the
models were not read yet.

A top-level thread starts a council. A subagent, a team chat, a salon, an
archived thread and a thread whose subagents are paused are refused.

## Rounds

Each member is a child thread of the parent. The first round sends the request;
`council again` sends the same members what changed and asks them to review the
whole work again from scratch. A member never reads another's answer.

A member ends its answer with `Score: n/10`, or `Score: none` when a score means
nothing for the request. Boite reads the last such line as written. Without one
the member shows `no score`; a score is never made up.

A round ends when every member has answered, when its time is up or when the
owner closes it. A member past the time is absent from that round, without a
score, and is asked again in the next one. A turn that ends on the member's own
background work is not its answer: the turn that work wakes is, within the same
time. A round nobody answers still goes back to the parent. A closed round leaves
the council in `waiting`.

## Answers and the table

The parent gets one message per round: each answer under `### name · score`,
then the table. The answers share 24,000 characters, and a cut answer names the
`boite delegate result` command that reads the rest.

```md
## Council review

Rounds: 2

| Delegate | Round 1 | Round 2 |
| --- | --- | --- |
| Opus 5.5 | 7/10 | 9/10 |
| GPT-6.1 Sol | 6/10 | 9/10 |
| Gemini 4 Argon | no score | 8/10 |
```

`council table <id>` prints the table at any time. The parent writes the
summary itself: Boite runs no summarizer. `council again` is refused while a
round runs, once the council is over, and until the last answers have reached
the thread.

## Anywhere, with or without a pull request

A council needs no git, no GitHub, no pull request and no code. It works in a
folder that is not a repository, and on a plan, an idea or a design choice as
well as on a diff. Read-only does not rest on git, and the context a member
needs is whatever the request says and the project folder holds.

Without a pull request, the table and the summary go in the parent's final
answer. `council table` works the same. With one, they go in its description.

## In the salon

The owner writes to every member, or to one with `@name` (`council.post`). A
member reads it at the start of the next round, so a post never changes a review
under way. `council.closeRound` ends the round without waiting for the rest.
`council.stop` ends the council: one in `waiting` becomes `done`, one in
`running` becomes `stopped` and sends the parent nothing.

## Read-only

A member keeps to read-only by its provider's strongest means.

| Provider | Read-only by |
| --- | --- |
| Claude, Codex, Muse, Grok, OpenCode, OpenCode v2 | The plan permission mode |
| Antigravity, Hermes, echo | Boite refuses every permission it asks, and a warning says so |
| pi | Nothing: no plan mode and no approvals, and a warning says so |

The members' prompt also tells each to change nothing, start no subagent and not
write to the parent. A question a member asks gets no answer, at once: nobody reads
its thread to reply. On pi only that prompt holds it back. OpenCode's plan agent
refuses edits and allows every command (`opencode debug agent plan`, 1.19.5,
2026-11-04), so that prompt alone holds its commands back, and a warning says so.
OpenCode 2 was not measured and gets the same warning.

An ACP agent that lists no plan mode, or refuses it, fails the member's turn, so
the member is absent from the round with the reason rather than running outside
read-only.

On Windows a read-only Codex session leaves the Microsoft Store's folders off its
`PATH` when the `pwsh` it would find is the Store's: that PowerShell cannot start
under Codex's sandbox (`CreateProcessAsUserW failed: 5`, codex-cli 0.166), and
Codex falls back to Windows PowerShell.

## In the app

The thread that started a council shows a card: faces of the members, the
request, the round or state, and **Open the salon**. A debate from before the
council draws the same card.

The salon opens in the right panel on a desktop and full screen on a phone. It
shows each round and each member's answer, with the score as text in the head of
the answer, and the table of rounds under them.

With the experiment off, every `council.*` method refuses with `experiment-off`,
the subagent guide says nothing, the `boite-council` skill is left out and the
app draws neither card nor salon. A round already under way still finishes and
its answers come back.

## Older debates

A debate stored before the council stays readable in the salon, read-only, with
neither score nor table; its summary is one of its posts. Its id still starts
with `dbt_`. The tables `debates` and `debate_posts`, the column
`threads.debate_id` and the experiment id `debates` keep their names, so nothing
is migrated. `boite delegate debate` starts nothing and points to
`boite delegate council`.

## Lifecycle

- Stopping the thread's subagents or archiving it stops a round under way and
  sends nothing back. A council between rounds stays; `council again` still
  works unless the parent is archived or its subagents are paused, which a Stop
  with other children under way does.
- A core that crashes stops its running rounds and tells the parent:
  `Boite restarted during the round, so it stopped.` A council in `waiting` stays.
- A [restart handoff](restart-handoff.md) lets a round go on: the next core asks
  again any member the restart cut, even one whose turn did not stop in time.
- A debate still running at this update stops and tells the parent:
  `Debates were replaced by the council at this update, so this one stopped. boite delegate council starts a review.`

## RPC and events

| Method | Owner | Device | Agent | What it does |
| --- | --- | --- | --- | --- |
| `council.start` | Yes | No | Own thread | Start a council |
| `council.again` | Yes | No | Own thread | Start a new round with what changed |
| `council.list` | Yes | Yes | Own thread | A thread's councils |
| `council.get` | Yes | Yes | No | A council and its posts |
| `council.table` | Yes | No | Own thread | The table of rounds |
| `council.post` | Yes | Yes | No | The owner's message, read next round |
| `council.closeRound` | Yes | Yes | No | End the round under way |
| `council.stop` | Yes | Yes | Own thread | Stop a council |

`council.changed` carries the council and salon ids and a version, and a client
reads the council again with `council.get`. The types are in
`packages/contracts/src/council.ts`.

## Credit

The rules of a council come from Theo Browne's council skill, in
[`t3dotgg/tstack`](https://github.com/t3dotgg/tstack) at `skills/council/SKILL.md`,
commit `1085050f`. Its license:

```text
MIT License

Copyright (c) 2026 Theo Browne

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
