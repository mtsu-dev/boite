# Goals and the project board

A goal keeps the agent working, turn after turn, toward one objective. A
reviewed goal adds a second opinion: a fresh reviewer must pass the work
before the goal counts as done. The project board turns a list of cards into
reviewed goals.

## Start a goal

| Command | What it does |
| --- | --- |
| `/goal <objective>` | Keep working toward an objective, until the agent says it is done |
| `/goal2 <objective>` | Work toward an objective until a fresh reviewer passes it |

1. Type the command and your objective in the message box, or pick it in the
   slash menu.
2. Send it. A bar above the box shows the goal, its state and its progress.
3. Use Pause, Resume, Remove or Mark complete on that bar when you need to.

When the agent stops on a blocker, the bar reads Waiting for your answer, and
your next message resumes the goal. Goals work with every agent.

## How a reviewed goal is checked

1. When the agent claims it is done, Boite starts a reviewer in a new
   conversation, in the same folder and permission mode, without the agent's
   history.
2. The reviewer inspects the changes, runs the checks, edits nothing and gives
   a verdict: Pass, Partial or Fail.
3. Pass completes the goal. Any other verdict sends the findings back to the
   agent, which keeps working.
4. After five reviews without a pass, the goal stops and waits for your reply.
   Each reply allows one more round.

The bar reads Reviewed goal, shows Reviewing during a review and draws one dot
per verdict. A dot opens that reviewer's conversation. The reviewer runs on
your delegation profile named `reviewer` if you have one, else on the
conversation's own model. A profile on another agent gives a cross-agent
review, for example Codex judging a Claude goal.

## The checklist

A reviewed goal also keeps a Checklist of what you asked for, so the agent
works on your requests rather than on its own plan.

- It is written from your objective, one short item per request.
- Each later message you send adds, drops or changes items. A dropped item
  stays, struck through, under a line such as "1 dropped".
- After each turn, the items the turn did are ticked. An item the turn never
  touched stays open, whatever the agent claims.
- A claim with open items goes back to the agent before any review. After two
  tries, the final review decides.

The bar shows the next open item and a count such as 3/5 done. On the desktop
it opens the side panel's Tasks tab; on a paired device the list unfolds in
the bar. Press an item to see what you wrote.

Settings, General, Conversations, Checklist model picks the model. Automatic
picks Opus at medium or Sol at high, the conversation's own agent first. Only
the owner sees this setting.

## Automatic goals

Experimental, in Nightly builds only: turn it on in Settings, Experiments
(Automatic goals).

A long prompt then starts a reviewed goal on itself, with its checklist and a
card on the project board. Prompt length sets the threshold, 1500 characters
by default. The agent may also start one when your prompt lists several
requests. Remove the goal from the bar to drop it.

## The project board

The board lists a project's cards in four columns: To do, In progress, In
review and Done. Every conversation of the project shows the same board.

1. Open it with the header's board button, or Ctrl+J, which opens the drawer
   under the chat on Board or Terminal. On a phone, use Project board in the
   title menu.
2. Press Add a card and write what needs doing.
3. Move the card to In progress. Boite starts a new conversation with the
   card's text as a `/goal2` objective, on the agent, model and mode of the
   conversation the board is open in.
4. When the review passes, the card moves to In review and waits for you.
5. Move it to Done to confirm it.

- On a desktop, drag cards between columns. Every card also has a menu with
  Move to, Open its conversation and Remove the card.
- On a phone, the board shows one column per screen: swipe between them, or
  tap a dot under the board.
- Moving a card back to To do unlinks its conversation, which goes on by
  itself.
- A card that reads Goal not running has lost its goal. Start its goal, in its
  menu, starts it again.
- Only you confirm or remove a card. An agent can only claim one.

## Limits

- The reviewer runs the checks itself and spends tokens doing so.
- There is no token budget: the five-review stop bounds a goal.
- The checklist adds one short pass per message you send and per finished
  turn.

## Going further

- [Context](context.md): queued messages and loops.
- [Subagents](subagents.md): delegation profiles.
- [Terminal](terminal.md): the other tab of the drawer.
- [Experiments](experiments.md): unfinished features, in Nightly builds.
- Technical reference: [goals](internals/goals.md),
  [board](internals/board.md).
