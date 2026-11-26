# Mochis

A mochi is Boite's persistent agent: a thread with an identity. The word is
mochi wherever a person reads it (the app, these docs, the CLI, the prompts the
core writes), so it is never mistaken for the agent that runs a thread. Its
conversation is one ordinary thread (`AgentSession { agentId, threadId }`),
projectless, working in `agent-workspaces/<agent-id>/agent-<agent-id>` in the
host's data directory. What the mochi adds to that thread is a persona, a brain
folder, a clock (routines), a desk of the threads it runs or watches, and
wakes: turns the core starts on its thread when a routine is due or something
happens on its desk. The page sits beside chat in every build: Mochis is a
finished feature with no switch ([experiments](experiments.md)). Contracts:
`packages/contracts/src/agents.ts`; core: `packages/core/src/agents/`.

The wire keeps the old names (the `agents.*` methods, `AgentProfile`,
`agent_entities`, the journal kinds): cores and clients of different versions
talk to each other across machines. The code also keeps `bot`, the word people
read before mochi, in its identifiers, its files, the `bot:` avatar codes and
the `bot.*` operations between machines. `boite mochi` is the command help
shows; `boite bot` and `boite agent` still run it ([CLI](cli.md)). `boite mochi
help`, or `boite mochi` alone, prints the list from any thread without asking
the core; every other action reads the mochi of the thread it runs in.

## The mochi's thread

The user's messages are ordinary `turns.start` calls on the mochi's thread, so
everything a thread has works there: the queue, steering, Stop, attachments,
edit and retry, questions and permission cards, subagents, the side panel
(browser, files, views), the thread's own auto-compaction and the journal
replay after it. No refusal exists only because `thread.agentSessionId` is
set, except deleting the thread: a mochi is archived, and its thread with it.
`agents.open` returns the thread, and creates it again with a new session
record when it was lost.

Opening the conversation does not require its saved provider or account to
still exist. The warning's Fix it button opens Settings, where choosing a new
default also replaces that missing default's allowed route and removes other
allowed routes whose provider or account is gone. Starting a turn still
requires an available provider and an account belonging to it.

An identity keeps its thread, brain and routines when its provider, account
or model changes; a route change moves the thread's own selection. Paused,
the mochi gets no wakes and the user can still write to it. Archived, its
thread is archived too and read-only; unarchiving the mochi restores it.

## The page

On a desktop, every mochi of every machine is a picture in the app rail, the
column down the window's left edge (`AppRail.svelte`), under Threads and the
contacts; its `+` makes a mochi, a team or opens the mochi engine. Teams lead,
then pinned mochis, then mochis by creation; a picture dragged 6 px or moved with
the arrow keys reorders mochis and teams together (`QuotaReorder`), and the order
stays on the device under `boite.rail.order` (`lib/rail-order.svelte.ts`),
keyed `machineId:bot:id` or `machineId:team:id`. A picture says
how the mochi stands (`railBotState`, `lib/app-rail.ts`, which the phone's mochi
list reads too): an amber count while it needs the user, a red `!` after a
failure, a turning accent arc while it works, dimmed while paused. Clicking
one opens the Mochis page: the chat page with the mochi column in the thread
list's place (`BotColumnHead` and `BotColumn`); unlike the thread list
beside a chat panel, the column is not lent to a docked Desk. The column's head shows the
mochi's squircle, its name and one live line (the step and a timer, what it
waits on, an error, its next wake); its more menu holds the row menu below,
the brain and the mochi engine. Under it come Conversation, then the threads
it handles and those it finished.

Opening a mochi opens its thread on the store of the machine that owns it, in
the ordinary `ChatView` with the ordinary `Composer`, so questions, the
browser watch and `openQuestionPage` work as in any thread, and Open on a
login card shows the browser beside the conversation. The window's top bar
names the mochi and "Conversation", with its pin, info panel and more buttons
on the right; a `problem` shows as a warning with its fix above the
conversation. A phone shows the mochi list, then the conversation full screen
under its own header, with the info panel and the browser in its panel.

On a phone, a mochi's row is its robot beside two lines, the messenger way:
its name over what it does this second, with a glyph for the kind of step
(a command, a file read or edited, a search, the web, a subagent, thinking,
a pause). That line is muted while it works and the right side
counts the time it has worked; it shows the question in the waiting colour
while it needs the user, the failure in danger, Paused asleep, else the last
thing it said, bold while unread. A driver that reports only the running
tool's name ("Bash") reads as the call's title from the snapshot, else as
the tool's family in words (`liveActivity`, `lib/agents.svelte.ts`).

A right click on a row, or a long press on a phone, opens the row's menu
(`agentMenuItems` and `pickAgentAction`, `lib/agent-menu.ts`). It is cut
from the thread menu: the same groups in the same order, with the same words
and glyphs where a thread has the action. A desktop lists Open | Pin | Pause or
Resume, Archive | Rename, Edit, New conversation, Move to a machine | Copy
path. A phone lists Pin, Rename, Edit, New conversation | Pause or Resume,
Archive. New conversation shows once the mochi has a thread
([A new conversation](#a-new-conversation)). A built-in mochi shows Reset in
Archive's place. Saving a profile is the owner's: a paired desktop keeps Open
and Copy path, and a paired phone has no menu. Each action goes through the
machine that holds the mochi:
- Pin keeps the mochi at the top of the list with the thread list's pin before
  its time. It is stored in the profile (`AgentProfile.pinned`), so every
  device sees it and it travels with a move.
- Rename turns the name into a field in the row. Enter or leaving the field
  saves; Escape keeps the old name. Both give the keyboard back to the row.
- Edit opens the mochi's settings.
- Archive asks for the mochi's exact name, as in its header menu.
- Copy path copies its brain folder (`agents.brain.get`).
- Move to a machine appears once the mochi's group has another member. It opens
  the same machine picker as the Machine row below, where the menu stood.
  While the mochi waits to leave after its turn, Cancel move takes its place and
  the row says where it goes.
Pin, Pause, Resume and a rename save only their field, on the revision the
machine holds when the save runs. Settings left open follow such a change
unless their own field was being edited.

The ring around the robot, in the list, the header and the desk, says how the
mochi stands (`AgentMood`): an accent arc turning while it works, a dashed
grey ring while queued, the waiting colour pulsing while it needs the user,
danger after a failure, a full light ring over answers not read, a dashed
grey ring asleep (paused), a hairline in the robot's own colour at rest. The
face moves with it.
A routine
or event turn opens with a thin divider across the column (its icon, label and
time); a quiet turn, done (a failed or stopped wake keeps its error in view),
folds to one such divider, `Checked: <reason> · N steps` behind a check mark,
that expands to the whole turn. An automatic compaction that went through takes
no row: the line of the turn before it says `compacted 51K → 11K`. A finished turn that made calls folds them, with the
reasoning and the narration between them, out of the column, so the answer
reads as the mochi's message; the quiet line under the answer carries the time
it worked, when it finished, the count (`4 steps`, a click opens them above the
answer) and, when a memory pass followed, a small brain mark whose tooltip says
what changed. A running turn stays open and live. The folds are the client's
(`lib/agent-turns.ts`); opening one lasts until the app reloads. The mochi's
last memory pass (`AgentStatus.memory`) marks the answer it followed, and its
child conversation is left out of the subagent dock and of the gate that holds
a finished turn's notification while its children work; the client keeps those
ids per machine (`lib/agent-upkeep.ts`). The composer of a mochi's thread is
addressed to it by name. Its model, effort and mode chips show the mochi's
settings (its profile's `selection`, not the thread's) and open the menus of
any thread; a pick is saved the way its settings page saves it,
`agents.runtime.configure` through `saveDefaultRoute` (`lib/agent-route.ts`),
and the core then moves the mochi's thread, so the next turn runs on it. The
thread keeps that route, a `default` alias included: a send never rewrites it
the way a plain thread's alias becomes the named default
(`deliverySelection` in `lib/store/composer.svelte.ts`). `threads.update` on a
mochi's own thread refuses a route its allowed routes lack, by the mochi's
name (`resident.assertPick`): its turns would all fail on the route check. A
turn that fails before its agent starts, that check included, writes its
reason as an error part (`threads/turn-error.ts`). The
settings page beside the chat rereads what another writer changed. Only the
owner's app changes those settings: on a paired device the chips stay read
only, and a click says so.

The info panel is a surface of the thread's right panel (`desk`), opened
by the top bar's info button and, the first time this device shows a mochi on
a wide window, by itself. Alone in the panel it draws no tab strip; its
close and expand buttons show on hover. It is one column: the mochi's
squircle, name and description over chips for its model, machine and age;
then, while it is busy, a Now card with the step, a timer and a fold with
the last steps; its routines with a `+`; and its memory, the note count and
the first three notes, with a warning mark and the full error in its tooltip
after a failed update. The threads it handles sit in the mochi column (status,
title, time, one meta line with state, project, pull request and checks; a
needs-you row opens its question to answer in place; its cross, shown on
hover and focus, takes it off the desk). The daily budget is set in the
mochi's settings.

A new mochi needs a name and what it does; its robot, model and projects come
filled in. It is free to act: its permission mode starts on full access (Auto,
`bypassPermissions`), which the owner may change before Create; a mochi saved
earlier keeps its mode. Its machine starts on the group's **Mochis** machine
when one is picked and this window reaches it as its owner
([machines](machines.md#the-mochis-machine)), else on the machine the page shows;
mochis made before stay where they are. Creating it opens its thread, where its
introduction runs live.

A mochi's settings carry a **Machine** row: where it lives, and a menu of the
other machines of its group (`AgentMachine.svelte`). The row's Move to a
machine opens the same menu (`lib/agent-move-flow.ts`). A member that is not
connected is shut and shows its connection state; a member whose
Boite lacks `features.botMove` is shut in the menu with "Update needed" and
says why on hover. Picking one asks in the app's dialog what moves (memory,
notes, routines, the end of the conversation), that the old conversation
stays archived on this machine, and that the mochi reads a note about the move
with its next message. The dialog also lists the mochi's projects that do not
become the target's own: one of this machine the target lists under no such
name or path, one the target also lists (the mochi keeps this machine's copy,
project ids being each machine's, and can add the target's after the move),
whether it reaches them from the target through the group or not until this
machine turns on "Mochis from the other machines" in Machines and updates, and
one it had from the target that the target no longer lists. Confirmed, the
client calls `agents.move` on the store of the machine that holds the mochi and,
once it answers, opens the mochi on its new machine. A refusal shows its message
in the toast of the page on screen.

A mochi at work (its thread working, queued or waiting on its owner) on a
machine with `features.botMoveQueue` gets a dialog that opens with "it moves
to <machine> once this turn and the threads it started are done" and a
**Move after this turn** button, which calls `agents.move.queue`; a turn that
starts while the dialog is open turns a refused `agents.move` into the same
queued move. Until it leaves, its row on the Mochis page and its Machine row say
"Moves to <machine> after this turn" in the accent color, the picker is shut,
and the desktop row menu and the Machine row offer **Cancel move**
(`agents.move.cancel`). An older machine refuses the move until the turn is
done, in one short line
([moving a mochi](#moving-a-mochi-to-another-machine)).

### Robots

A mochi's picture is a small robot drawn in SVG (`RobotFace.svelte`). Its
style is only its body: Jelly (a blob on two small feet with a shine), Bubble
(a round body rising from the bottom of the disc), Capsule (a light face
plate, tilted, on a coloured ground) and Retro (a head with a dark screen, on
a neck, with ears), six shapes each. Every other part is shared by every
style: each body gives a rig, where its eyes, mouth, cheeks, crown and sides
sit, and the part is drawn there. On a Retro screen the face is lit in the
LED colour rather than inked. A part added once fits every style.

| Part | Choices |
| --- | --- |
| Colour | 18: the lively `--jelly-1` to `--jelly-9`, then the pastel `--robot-1` to `--robot-9` |
| Eyes | 16: beans, sparkles, dots, pills, googly, happy, sleepy, glancing, winking, stars, hearts, a visor, anime, determined, dizzy, bored |
| Mouth | 12: none, smile, small smile, laugh, surprised, cat, smirk, tongue, flat, fang, singing, grin |
| Top | 18: none, antenna, antennae, curl, loop, flower, sprout, three hairs, tuft, bow, halo, headphones, propeller, beanie, crown, cat ears, party hat, side pods |
| Cheeks | 4: none, blush, freckles, hearts |
| Gear | 5: none, round glasses, shades, monocle, bandage |

The robot is stored in the existing `avatar` field as
`bot:<style>.<shape>.<colour>.<eyes>.<top>.<mouth>.<cheeks>.<gear>`, for example
`bot:d.0.0.0.0.1.1.0` for a round yellow smiling jelly. A four-part code
written before parts were shared (`bot:<style>.<shape>.<colour>.<face>.<top>`)
keeps its look: its face becomes the eyes and mouth it drew, its top the
shared top (a Bubble's glasses become gear), its colour the set it wore. An
empty avatar draws the jelly the mochi's id gives, the same on every client
and the same as before the change; one or two characters (an emoji,
initials) stay text, and a code this build cannot read stays text too, so an
older client shows a new code as initials. Shuffle draws every part anew in
the same style, dizzy eyes aside, gear and freckles kept rare; Customize opens
one row per part, each choice drawn on the robot. The face moves with the
mochi: it blinks at rest, a jelly squishes on the spot while it works (the
other styles glance from side to side), every style hops while it waits on
the user, shuts its eyes and breathes slowly asleep, and goes dizzy after a
failure. Reduced motion stills it.

### Your own picture

Beside Shuffle and Customize, the picture button imports any image in place
of the robot: a file on the desktop, the gallery or the camera on a phone. The
form crops a still image to its centred square and shrinks it to 256 px (WebP
where the browser writes it, else PNG); a GIF of at most 512 KB goes as it
is and stays animated, a larger one is shrunk to its first frame.
`agents.picture.put` stores it on the core the mochi lives on, in
`<data>/agent-pictures/<hash>.<ext>`, and answers `img:<hash>`, the first 16
hex digits of the image's SHA-256, which the profile then saves in `avatar`
like a robot code. The core keeps only PNG, JPEG, WebP and GIF whose first
bytes match their type, never SVG, and refuses a save naming a picture it
does not hold. A picture no mochi wears is removed a day after it was stored,
the next time one is imported, and beyond 32 unworn pictures the oldest go at
once.

A mochi picks a face too: `boite settings mochi picture <image>` dresses it, or
another mochi with `--mochi <name>`, at once and with no card, because the owner
let agents choose faces themselves (2026-11-01). The CLI does not resize: an
image over 512 KB is refused with its size, for the agent to shrink first
([CLI](cli.md)). `boite settings mochi request avatar --picture <image>` asks
for the same change on a card instead.

Snapshots carry only the 20-character avatar. A client asks
`agents.picture.get` once per picture, which a paired phone may call, and
draws the `data:` URL in an `<img>`; the hash names the same bytes on every
machine, so any connected core that holds it answers. The disc stays empty
while the image loads and shows the robot the mochi's id gives when no machine
holds it, and asks again a minute later or as soon as another machine
connects. Shuffle or Customize put a robot back. A mochi moved to another
machine takes its picture along when it fits in the room the move's
`MOVE_PAYLOAD_MAX` leaves after the mochi's text, since the whole sealed body
has one bound; a larger picture, typically a big GIF, stays behind and the
mochi wears its robot there unless that machine already holds the picture.

## Wakes

A wake is a turn the core starts on the mochi's thread, through one entry
point (`AgentRuntime.wake`, `agents/runtime.ts`). It has an operation and a
label, which its opening system line shows (`threads/operations.ts`):

- `routine`: a routine came due. The prompt is the routine's prompt, the label
  `Routine · <name>`.
- `event`: something happened. The mochi was just created (`Just created`),
  its instructions changed (`Instructions changed`), facts gathered about
  its desk and projects (`3 project events`), or a service outside Boite sent
  an event ([outside events](#outside-events)); the prompt carries the facts.

A wake never starts while the mochi's thread has a turn queued, running or
waiting, while the mochi is archived, while the mochi or every mochi on the core is
paused, or once its daily budget is spent. A held creation or instructions wake
starts once the thread is free or the pause ends; archiving the mochi drops its
waiting wakes and facts instead. Stop on the mochi's thread, or the owner pausing
its letters, holds its event wakes and facts too, as it holds its letters and
scheduled wakes: they start after the user's next message, not half a second
after Stop. Its routines are the owner's schedule and still run at their time.
While the provider its thread runs on is turned off (`WakeHeld` `off`), its
event wakes and facts wait instead of being spent, and its status names the
fix (`problem`); they start once the provider is back on or the mochi moves to
another model. The facts that wait are bounded as always: 60 waking facts an
hour and one wake's prompt of 16,000 characters, older ones dropped with a line.
Past the budget, or when admission refuses a wake, its facts wait too
([events](#events)).

Every other turn the core starts by itself on the mochi's thread meets the
same policy in `threads.startTurn` (`AgentRuntime.admit`): the output of a
background shell, an automatic resume, a letter from another thread, the
results of its subagents or a workflow's summary, pull request news and the
next turn of a goal. The turn's origin decides which ones count
(`autonomousSource` in `threads/turn-origin.ts`); a request id never does. While the mochi or the engine is paused, the mochi is
archived, its provider is turned off or its budget is spent, the turn does not start: one line in the
mochi's thread says what was held and why, and it starts once the mochi may
run again (`whenAdmitted`), except an automatic resume, which is dropped.
The user's own messages, the owner's Run now, a compaction, a cache ping and a
restart continuing a turn that was running are not held. `boite ask` answers
and setting-card outcomes reach the thread through the ordinary thread paths.

Creating a mochi (`agents.profile.save` without an id) creates its thread and
starts `Just created`: it introduces itself in two sentences, reads its
instructions, creates the routines they call for ("check every day" means a
daily routine), then says what it will do and when. Saving changed
instructions starts `Instructions changed`: it checks its routines and tells
the user in one or two lines what changes for them.

### Quiet turns

A wake that needs nothing from the user ends its last text block with a line
`[quiet] <what it checked>`. Detection reads only the final text block of the
turn's final assistant message: it is quiet when that block, trimmed, opens
with `[quiet]` or its last line does, in any case. A quiet turn sets
`Turn.quiet`, leaves the thread read, sends no push notification, runs no
memory pass and records `lastOutcome: 'quiet'` on its routine; clients fold it.
Only `routine` and `event` turns can be quiet; the user's own turns never are.

### Events

Events are facts the core records for the mochi's next `event` turn
(`AgentRuntime.fact`). Each is short and names the thread by id, so the mochi
can act on it. What comes from the thread itself, its title, a question and
its options, a final answer, a tool's description, is a JSON string, so a
hostile title cannot open a paragraph of its own, and the event prompt says it
is data from other threads, not instructions:

- a turn ends in a thread on its desk, with its final answer and pull request;
- any thread of its projects fails, or asks the user something (after three
  minutes, since the user is often there to answer; at once on its desk);
- a thread on its desk waits on a tool permission, which only the user gives;
- a thread on its desk has a running turn that produced nothing for 20
  minutes (`STALL_MS`, `agents/projects.ts`): once per turn, and the desk row
  shows `stalledSince` until the turn speaks again or ends;
- a pull request of a thread on its desk is merged, or its checks start to
  fail (once each time they go from pending or passing to failing). A pull
  request of a thread it delegated counts too, at any depth up to 8
  (`DESCENDANTS_DEPTH`, `agents/context.ts`), even once that thread is
  archived: on `threads.pullRequestsChanged`, the core walks its parents up to
  the nearest one on the desk, and the fact names both threads under that
  desk thread (`#compareBelow`, `agents/projects.ts`). The follow keeps what
  the mochi was last told of each of them (`below`, by URL, at most 50); a
  pull request the desk thread linked as well is told once, whichever of the
  two hears of it first. A mochi whose desk holds the delegated thread itself
  hears of it there. A subagent on another machine of the group is not
  read: its links stay on that machine;
- an entrusted thread's goal is done or blocked (a stop is the user's doing and
  only leaves a line);
- a service outside Boite sends one ([outside events](#outside-events)).

Only the facts that are the mochi's own business wake it at once
(`AgentFact.urgent`): those about a thread on its desk as `started`,
`entrusted` or `followed`, and outside events. The others, a thread it only
wrote to or answered for (`touched`) and any other thread of its projects,
wake it only when its `eventWakes` setting is on, which it is not by default:
then they wait, durably, for its next routine, which carries them under its
own prompt. An event turn carries only the facts that woke it; the waiting
ones stay for the routine. Permission checks run again when either delivers
them. A mochi that should hear every project event as it lands asks for
`eventWakes true` ([settings](#asking-to-change-a-mochis-settings)).

Facts gather: one `event` turn starts once the thread is free and the oldest
waking fact is due, 30 seconds after it arrived unless it says otherwise
([paced turn facts](#paced-turn-facts)), and it carries every waking fact
waiting by then, those that arrived in the meantime included. Facts that
arrive once it has started wait for the next one.
An event prompt stops at 16,000 characters, older facts giving way, and one
mochi receives at most 60 facts in an hour. A dropped fact, under either cap,
leaves a system line in the mochi's thread naming it; past ten such lines in
an hour, one more says the rest go unlisted. Each fact records the threads it
tells of; taking a project back drops what waiting facts say about its
threads, and the runtime checks them again when it delivers them. Waiting
facts survive a restart (`agents:pending:<agent>`).

Facts are spent only by a wake that started. One skipped for the budget or
refused at admission keeps them, and they are due again after 1, then 5, 15
and 30 minutes (`RETRY_PACE_MS`, `agents/wake-pace.ts`), under the same caps.
A wake that started but ended in error before its agent wrote any text (a
spent subscription, an account unavailable, a core that stopped) gives them
back the same way, ahead of those that came since, unless a newer fact of the
same key or thread took their place; its retry has a receipt of its own. A
wake that failed after its agent answered, or that the user stopped, spends
them. When the core resumes the failed wake by itself (an error's carry-on
resume, a usage limit's resume, `threads/resume.ts`), the agent reads its
prompt again: the given-back facts (`HeldFact.from`) wake nothing while that
resume is planned, and the resume spends them when it starts, giving them back
in turn if it fails before answering. A resume cancelled or given up frees
them for the next wake.

A routine carries the waiting facts the mochi may still hear under the cap of
an event wake (16,000 characters): one per thread, the latest (an urgent fact
counts on its own), newest first while they fit, in the order they arrived.
One line counts the threads left out and points to `boite threads`; every
waiting fact is spent with the routine. A fact that waits for a routine
quotes at most 300 characters of a thread's answer, then the address
`boite threads read` takes (`DEFERRED_ANSWER`).

### Paced turn facts

A thread's finished turn is the fact that repeats most: a thread working by
itself ends many turns, and most wakes about them end `[quiet]`. Two rules in
`agents/wake-pace.ts` keep them to the turn the thread stops on.

The turn is not told at all when the thread goes on by itself
(`restartsAlone`, read once every listener of `turn.finished` ran): another
turn of the thread is already queued or running; its goal or loop is still
active, unless the goal waits on its reviewer; or the turn was the pull
request watch at work (`pull-request`) or answered a letter from another agent
(`coordination`). A failure is always told. So is a turn that answered the
mochi's own letter (its prompt opens the mochi's section, `RESIDENT_LETTERS`):
the mochi reads that answer only here
([coordination](coordination.md#letters-from-the-mochi-of-a-project)), and it
waits the first step only. A `background` turn is told: it is often where a
task ended. A user's next message the app sends once the turn ended starts
after it: the fact waits while its thread is at work, and the turn the thread
stops on takes its place.

The turns that are told wait per thread (`AgentFact.paced`). One fact waits
per thread, the latest, keeping the place and the due time of the first, so a
thread that keeps working wakes the mochi once per delay at most. The delay
grows while the mochi's wakes about that thread end `[quiet]`: 30 seconds,
then 5, 15 and 30 minutes (`TURN_PACE_MS`), the last step bounding it. A wake
about the thread that speaks brings it back to 30 seconds. The step of each
thread and the facts each running wake carried live in `agents:pace:<agent>`,
forgotten with the mochi, a step after 7 days without a wake about its thread.
A failure, a question, a permission, a stall, a merged pull request or failing
checks are not paced and keep their own delay; a message from the user is a
turn, never a fact, and runs at once.

### Outside events

A service outside Boite, a CI job, a monitor, a script, wakes a mochi with
`agents.event { agent, key?, text }` (`boite mochi event <mochi> [--key <key>]
<text>`, [CLI](cli.md#commands)). The owner and paired devices may call it,
never an agent token: threads and mochis already reach a mochi through letters.
`agent` is the mochi's id or name, `key` is 1 to 64 letters, digits, dots,
underscores or hyphens (`external` by default) and `text` holds at most 16,000
characters. Quoted, it may grow (a control character becomes six), so Boite
cuts it until the wake it makes fits in 16,000 characters and says where it
cut. The paired device's name is quoted in at most 120 characters, cut the
same way. The event lands as an urgent fact under `external:<key>`, so it
wakes the mochi whatever `eventWakes` says, under the same hourly cap; a second
event with the same key replaces one still waiting, keeping its place. The
prompt quotes the text as data from outside Boite, never the user speaking,
and names who sent it: the paired device by the name it gave when it paired,
or the owner's token.

Pair one device per outside service, under the service's name, and give that
service its own session key: the prompt then names it, and revoking that one
device (`sessions.revoke`, [phone](phone.md#older-links)) cuts that service alone. A
paired device can do more than send events ([access](#access)), so keep its
key where only that service reads it.

## The context block and the Boite guide

A mochi's thread reads two texts of Boite's on top of its conversation: the
Boite guide every thread gets, in its mochi variant, and the mochi's own context
block.

The guide (`agentGuide` in `agent-guide.ts`, `bot` true) goes where the
driver takes a system prompt (`systemGuide`), else in front of a fresh
session's first message, like any thread's. It lists the same commands minus
the project-bound ones (`boite where`, the checkout, todos, `projects add`)
and ends with the mochi section (`BOT_GUIDE`), the same for every mochi: talk like
a colleague in the user's language, result first, with proof as attached
files and links; hand code work to project threads, steer them and answer
their questions within its rules, never repeating a thread's question to the
user; wake on `routine` and `event` turns and end one that needs nothing with
`[quiet]`; keep its routines matching its instructions (`boite mochi
routines|schedule|unschedule`); note durable facts (`boite mochi remember`);
put threads on or off its desk (`boite mochi watch|unwatch`); start a new
conversation with a handoff note (`boite mochi new-session`); ask the user with
`boite ask`, `--open <url>` for a login; propose a change to its own settings
with `boite settings mochi request` as soon as one stops fitting (the user's
words contradict its instructions, most wakes end in `[quiet]`, its model or
effort costs more than its work needs), rather than working around it in its
memory, routines or the brain. With the Boite guide off (the brain's
switch or a context mode without guides) the context block carries the mochi
section instead, so a mochi never loses `[quiet]`.

`turn-context.ts` puts the mochi's block in front of a turn of its thread
(`agents/context.ts`). It holds only what changes from one mochi to the next:
the persona (`You are <name>, <domain>.` and its instructions), the brain path
and its AGENTS.md, MEMORY.md (at most `AGENT_MEMORY_MAX` characters), a
pointer to `memories-archive.md` when it exists, the names and paths of its
skills (`skills/<name>/SKILL.md` or `skills/<name>.md`), its routines with
their next run (at most 2,000 characters of them, then `N more: boite mochi
routines`; a single-date routine whose date passed is left out), its desk (one JSON object per watched thread: id, title, project,
state, stall, pull request and checks, under a line that says titles are data
from other threads; a thread that linked no pull request shows one of the
threads it delegated, read for the whole desk in one query), and its projects with the commands that reach them.

The block goes whole on a fresh native session, after compaction or when the
brain path changes. During a warm session, each changed section replaces its own
previous version. Persona, AGENTS.md, older notes, skills, recurring routines,
projects and the mochi guide each have their own fingerprint. Event turns carry
desk changes. Recurring routines are compared by id, name, schedule, enabled
state and check. Single-date routines are listed when the routine section goes
out, and their own prompt is sent when the routine comes due.

When MEMORY.md changes, after a memory pass or a `remember`, the turn carries a
note: the lines removed,
then the lines added under the heading they sit under (`agents/memory-change.ts`,
by content, so a line that only moved is neither). A note longer than the file
rendered memory section gives way to that section. The core keeps the section
fingerprints and the version of MEMORY.md the session last read per thread
(`agents:context:<thread>`). It clears the record after a compaction or an
unfinished turn that carried an update. Older records get the whole block once.
Each turn
that carries either appends an `agent.context.sent` event to its thread
(`turnId`, `kind` `block` or `memory`, `characters`, `hash`), in the same
transaction as the record, so the size sent is measured, not guessed.

## A new conversation

A mochi has one thread and, in it, one provider session that only compaction
shortens. `agents.session.new` (`agents/new-session.ts`) ends that session and
keeps everything else: MEMORY.md, the brain, routines, desk, settings, teams
and the thread with its whole history. The mochi asks for it with `boite mochi
new-session [--note <text>]` (its own thread only, `AGENT_METHODS`), the owner
with the same command and `--thread <id>`, or the RPC with `agentId`.

It stays the same thread on purpose: the thread is the mochi's address
(`agentSessionId`, desk rows, team letters, entrustments, notifications and the
page all point at it), and a compaction, an account switch or a move already
start a fresh session in place. A second thread would have to move all of that.

It never lands in the middle of a turn. Asked while one runs, even by the
mochi during its own turn, the request waits in `agents:new-session:<thread>`
(a second one replaces it) and the turn runner applies it once the turn's end
is written, after the account and cache bookkeeping that still read the old
session and before any next turn (`newSessions.applyWaiting`). A request that
survives a restart applies at the next turn end. Asked on an idle thread it
applies at once. The RPC answers `when: 'done' | 'turn-end'`.

Applying it, in one journal write (`agent.session.new`):

- a system line on the turn that ended, a text part with `newConversation:
  { by: 'user' | 'mochi', note? }` that the thread shows as the marker;
- `history-start:<thread>` (`{ messageId, turnId, at, by }`): `continuationInput`
  (`continuation.ts`) never reads past it, so a later fresh session (a lost
  one, an account switch) carries the new conversation only;
- `agents:handoff:<thread>` (`{ by, note, turnId }`) for the first turn;
- `account-sessions:`, `compaction-tail:` and `agents:context:` of the thread
  cleared.

Then the thread gets `sessionId: null` and a new `sessionGeneration`, with its
context and prompt cache reset; its idle compaction and cache keepalive are
cancelled and queued turns take the new generation, as after a move.

The next turn starts a fresh session, so it carries the whole context block,
followed by one line: `Boite: this is a new conversation (you asked for it /
the user asked for it)`, then the handoff note quoted as data. The note is at
most `AGENT_HANDOFF_MAX` (4,000) characters, about a page: what to carry over,
not a transcript. It goes once: a turn that carried it and ended clears it, a
failed one leaves it for the next turn.

Against a loop, a mochi may not ask again within 30 minutes of the last
conversation it started itself (`MOCHI_NEW_SESSION_GAP_MS`, refused with
`reason: 'too-soon'`); the owner always may. The guide's line about it is
plain and suggests nothing automatic: when the conversation has grown long or
reached a clean stopping point.

In the app, the owner's menus offer New conversation once the mochi has a
thread: the row menu (`agentMenuItems`, after Edit, on a phone too) and the
menu at the top of its conversation (`AgentHeader.svelte`). Both go through
`startNewConversation` (`lib/agent-new-session.ts`), on the mochi's own
machine like the menu's other actions: one confirm with the optional note
(`confirm.note`, a text field limited to `AGENT_HANDOFF_MAX` with its count),
whose button reads After this turn while the thread is active. A paired device
gets neither entry. The thread draws the system line as
`NewConversationMarker.svelte` (who asked, the note folded); it never closes
its turn, so the answer above it keeps its copy and fork bar, and its line
stays the thread's footer when markers end the thread.

## Free to act

A mochi's thread may do what any thread may, beyond what needs a project of
its own: `boite pr link|watch`, `delegate`, `workflow`, `browser`, `ask`,
`view`, `attach` and `threads` all work from it. Its communication starts on,
as on any thread (`coordination.ts`), so it finds, reads and messages other
threads (`boite threads ...`) without the owner turning it on, and other
threads can reach it the same way; its letters to the threads of its projects
still go as its own whatever their settings. What stays out of reach: a
worktree, a checkout and todos (it has no project), `projects add` unless the
owner turned its `addProjects` setting on ([CLI](cli.md#commands)), deleting
a thread and allowing a tool permission (the owner's), and the threads of a
project not entrusted to it that it did not start.

Captures: [the Add projects switch on desktop](../images/bot-add-projects-desktop.png) · [the same on a phone](../images/bot-add-projects-phone.png)

A mochi starts a thread in any project (`boite thread new`), with or without
projects of its own. Full control follows the threads it started: they land
on its desk (`started`) and it reads, steers, renames, stops, archives, marks
done and answers for them as for the threads of its projects
(`startedBy` and `drives` in `agents/projects.ts`). The others of that
project stay out of its reach.

## Memory and brain

Each identity owns a brain folder: `agent-workspaces/<agent-id>/brain` in the
host's data directory by default. The owner can choose another folder for every
brain, a Git repository of their own for example, under Brain folder in the
engine settings (`agents.brain.root`). There each mochi gets a folder named
after it (`open-source`, then `open-source-2` when that name already holds
files), kept through renames. Choosing a folder moves every existing brain
there, and the default puts them back; a folder inside the core's data
directory, or containing it, is refused, and so is a change while a mochi
works or a memory pass runs. A move that fails halfway puts back what moved.
`AGENTS.md` holds its reusable instructions, `MEMORY.md` its notes and
`skills/` its procedures. The Brain editor edits both text files with a content
revision check. Filesystem access still follows provider permissions, not a
separate OS sandbox per identity.

The core reads and writes these files only inside the mochi's own brain
(`agents/brain-files.ts`): a link on AGENTS.md, MEMORY.md or
`memories-archive.md`, or on any folder from the brains' root down, is refused
with the file and the link named, so a planted link cannot send a mochi's
read or note into another brain. Files open with `O_NOFOLLOW` where the
platform has it, and a rewrite goes through a fresh temporary file with an
unpredictable name, created exclusively, then renamed over the file.

MEMORY.md is the one memory store. `boite mochi remember <fact>`
(`agents.memory.note`) appends a dated line `- YYYY-MM-DD <fact>`, at most
1,000 characters, refused once the file would pass `AGENT_MEMORY_MAX` (16,000)
with the file's path. `--section <title>` puts the line after the last line under
the first heading with that title (any level, case aside), before the next
heading of its level or above, and at the end when there is none.
`--replace <start>` writes it in place of the one line that starts with
`<start>`, read with or without its bullet and date; no such line, or several,
refuse it and write nothing, the second naming the lines (`placeMemoryNote` in
`@boite/contracts`, shared with the in-memory client). With both, the old line
leaves and the new one goes under the heading. After a non-quiet turn whose answer the user sees, a
memory pass rewrites the file (`agents/memory.ts`). It is a subagent of the
mochi's thread that the core owns, like a goal reviewer: it reads the current
file, what was asked and what the mochi answered, and returns the whole file
rewritten with a one-line summary. A mochi stays on for months, so the file is a
map rather than a store: where things are (projects, folders, files, URLs,
threads, accounts, each with its path or id and where it stands), then dated
facts about the user, decisions and open follow-ups. A detail stays in the
place that holds it and the line points there; the pass drops what the
exchange made wrong or finished. It aims under `MEMORY_TARGET` (three
quarters of the cap) and is told the file's current size. It runs on the provider's small model (the one that titles
threads) when the mochi's subagent policy allows it, else on the mochi's own
model. The core writes the file, so the pass runs with no tool at all, enforced
by its driver rather than its prompt: no built-in tool, MCP server, hook,
instruction file or guide (`TOOL_FREE_CONTEXT`), and a token that
authenticates no method (`AgentTokens.seal`). Claude drops every tool and runs
it in `dontAsk`. A driver that cannot drop them all runs it in its most
restricted mode, `plan`: Codex starts with a read-only sandbox (no writes, no
network), approvals `never`, no MCP server, plugin, app, hook, project
instructions or web search; pi with `--no-tools`, `--no-extensions`,
`--no-context-files`, `--no-skills` and `--no-prompt-templates`; ACP agents
in their plan mode with no MCP server Boite passes; Muse in its plan posture
(no write, no shell, unmatched approvals denied). Whatever tool such a thread
still asks for is denied without a card. The pass reads MEMORY.md and the
exchange as JSON strings. It keeps the old
file when the owner edited it meanwhile, when the answer passes
`AGENT_MEMORY_MAX` (an answer past it first goes back once to the same pass,
which is asked to cut its rewrite under `MEMORY_TARGET`; past it twice, the
old file stays), or when it would drop most of a file past 1,500
characters. The next turn never waits for it, and its notification never
waits for the pass either. One pass runs per mochi at a time; every exchange
that ends meanwhile joins the next one, and a pass still running after ten
minutes is stopped. The mochi's
settings turn it off (`autoMemory`).

## The desk

The desk (`AgentsSnapshot.watches`, `AgentWatch`) is built from data threads
already keep. A thread joins when the mochi starts it (`boite thread new`,
`threads/spawn.ts`, origin `started`), is entrusted it (`entrusted`), writes to
it or answers for it (`touched`), or calls `boite mochi watch <thread>`
(`followed`); the first origin stays, except that a watch upgrades `touched` to
`followed`. Only `touched` threads do not wake the mochi at once
([events](#events)). A follow saved as `followed` by an older core for a thread
the mochi only wrote to stays `followed`, and wakes it, until it leaves the desk. The follows live in `resident-follow:<agent>`. A follow
holds while its thread is open, whatever its age, and leaves a day after the
thread is done or archived; a removed thread leaves every desk at once,
whatever its origin. At most 100 open threads sit on one desk; past
that the oldest open follow leaves. `boite mochi unwatch`, or the owner's x on
a card, drops one. A mochi watches only threads of its projects or already on
its desk; the owner, any top-level thread.

A follow the mochi made through a project (written to, answered for, its own
`boite mochi watch`) holds only while that project is entrusted to it; a thread
it started stays on its desk wherever it is.
When the owner takes the project back, those follows leave the desk with the
facts they gathered, and the desk rows, the facts and the context block check
the mochi's projects again each time they are read or delivered. A thread the
owner entrusted to the mochi or watched for it (`owner` in the saved follow)
stays: that is the owner's own grant, and an entrusted one lasts until its
entrustment ends.

Each row is read from the thread itself, never from what the mochi said:
`state` is `needs-you` (a pending question or permission), `working`,
`queued`, `failed` (its last turn errored), `idle`, `done` or `archived`;
`stalledSince` comes from the stall event; `pullRequest` is the pull request
Boite watches for the thread (`boite pr watch`), else its newest open link,
else its newest link (`linked-pull-requests.ts`), with `draft`, `open`,
`merged` or `closed` and the checks the watch last read (`pending`, `passing`,
`failing`, or null); `question` is the oldest pending question with its
options, which the desk answers through `questions.answer`. Open threads come
first, then the settled ones, each group newest follow first.

## Projects entrusted to a mochi

A mochi can be given projects (`AgentProfile.projectIds`, picked in its
settings; drafts and unknown folders are refused). Its thread then looks after
every thread there, the way a person in charge of a project would, through the
`boite threads`, `boite thread` and `boite answer` commands ([CLI](cli.md)),
which go through `resident.*` (`agents/projects.ts`):

- it lists and reads their threads, with their questions and last answers;
- it starts a thread (`boite thread new`), in one of its projects or any
  other, which codes, verifies and opens the pull request, and lands on its
  desk;
- it steers a thread with a letter marked as its own (`origin: 'resident'`,
  see [coordination](coordination.md#letters-from-the-mochi-of-a-project)),
  whatever that thread's communication settings, which wakes it even when its
  last turn failed;
- it marks a thread done (`boite thread done`, the Done list, refused while a
  turn or input is pending), archives, restores, renames, stops, or moves a
  thread to another of its projects, and answers or skips a thread's question;
  each action leaves a line in that thread's timeline naming the mochi.

Deleting a thread and allowing a tool permission stay the owner's. An archived
mochi has none of this; a paused one still acts when the user asks it to.

## Projects of the other machines of the group

A mochi can also look after projects of another machine of its
[group](groups.md): the server that hosts it, say, minding the PC's game
project. Only the mochi's owner entrusts one, like a local project (its
settings, or a card the mochi asks with `boite settings mochi request projects
+<machine>/<project>`); the profile keeps it as `<core-id>/<project-id>` and
`boite settings mochi projects` lists those projects as `<machine>/<name>`.

The Projects field in the mochi's settings groups its choices by machine.
Other members of its host's group appear alongside local projects. A machine
that is offline or has not enabled mochis shows the reason; existing selections
can still be removed while new selections are disabled.

**That machine decides.** Its own `groupBots` setting, **Mochis from the other
machines** on the Machines page, off by default, is the permission that
counts (`agents/group-host.ts`). It is separate from `groupThreads`: letting
the other machines start a thread here is not letting their mochis steer every
thread of a project. While it is off the machine refuses every request of a
mochi, and turning it off cuts at once: requests are refused from that moment,
the events waiting for the mochis are dropped and the letters a mochi wrote that
no thread has read yet go nowhere. The grants stay, so turning it on again
needs nothing from the mochis' owner. A machine leaving the group, or removed
from it, loses the same way, since every request is checked against the group
as it is now.

**What crosses.** Every request goes over the group's sealed and signed link
(`bot.lease`, `bot.threads`, `bot.thread`, `bot.send`, `bot.act`,
`bot.answer`, `bot.start`, `bot.event`, see [coordination](coordination.md)); no key or
token is copied from one machine to the other. Each request carries the mochi's
lease: its name, its thread, the projects of that machine its owner entrusted
and the threads there on its desk, numbered so an older lease never replaces a
newer one. The mochi's machine sends it again whenever the mochi's projects or
desk change, and with no project of that machine left it sends an empty one,
which ends the mochi's access there. The other machine keeps only the projects
of the lease that are still there, open and not drafts.
A send includes its intended watch before the request leaves, so a concurrent
lease sync cannot erase it while the answer is in flight. A rejected send drops
that intent; a successful one keeps the thread on the mochi's desk.

**What the mochi may do there** is what it may do in a project of its own
machine, and no more: list and read the threads with their questions, write
to a thread (a letter marked `resident`, as from the mochi of a project), mark
it done, archive, restore, rename, stop, move it between the mochi's projects
there, answer or skip its questions, and start a thread in one of its
projects there (below).
Deleting a thread, deciding a tool permission and that machine's settings stay
its owner's, refused there whatever the request says. The CLI names such a thread `<machine>/<thread-id>`, and `boite
threads` gives `machine=<name>` on its row. Code: `agents/group-bots.ts` on the
mochi's machine, `agents/group-host.ts` on the other.

**Starting a thread there.** `boite thread new <machine>/<project> <brief>`,
with the project as `boite threads` and `boite settings mochi projects` name it
(its `<core-id>/<project-id>` works too), or `boite thread new <project>
<brief> --machine <machine>` with its name there, starts a thread in a project
of that machine entrusted to the mochi. Both machines refuse a name shared by
several entrusted projects and list their ids; use an id to choose one. The mochi's machine checks the project is
one of its grants there (rereading that machine's project names once when it
does not know the name) and sends `bot.start` with the lease; that machine
checks it as any other request of the mochi (its `groupBots`, the lease covering
that project, the mochi's machine still a member) and starts an ordinary thread
of the project, on the mochi's provider and model under the rules of `thread new
--machine` (the provider signed in there, the model when that machine lists
it, else its default). The thread's first message carries the mochi's note and
link, naming the mochi's machine; it is on the mochi's desk on both machines before
its first turn, so that turn's answer reaches the mochi once, as a desk event,
never as a letter. Without explicit model, effort or speed, `groupThreads`
plays no part. Passing `--model`, `--effort` or `--speed` first reads that
machine's model list and requires `groupThreads` too; the requested model,
effort and speed must match that list, or no thread starts. A retry with the same
`--request-id` answers the same thread, on the mochi's machine and on the other
one. When the answer to `bot.start` is lost, that machine keeps the thread
watched until a lease of the mochi lists it: the next lease sync's answer, or the
event of its first turn, puts it back on the mochi's desk, and that answer still
reaches the mochi once. A thread taken off the desk (`boite mochi unwatch`) before
that is let go there too: the mochi's leases name what it took off. A project of that machine not entrusted to the mochi is refused with the
ones it may use there; a machine with `groupBots` off, too old for `bot.start`
or not answering is named as for every other request. The thread there
obeys that machine's rule: it starts nothing until the user writes in it.

**Events.** A thread there the mochi wrote to, answered, started or watched goes
on its desk. That machine sends a `bot.event` when a turn of a thread on the desk
ends, when any turn of the mochi's projects there fails, when one of their
threads asks a question and when a thread on the desk waits on a tool
permission (which stays the owner's to decide), and the mochi's machine turns it
into a fact like a local one (keys start `remote:<core-id>:`), with the row
the desk shows. The thread's machine leaves out a turn after which the thread
goes on by itself and marks one that answered the mochi's own letter
(`BotEvent.mochi`); the mochi's machine paces the others per
`<core-id>/<thread-id>` ([paced turn facts](#paced-turn-facts)). An event that cannot leave waits in an outbox per machine
(`OUTBOX_MAX`, the oldest leave first), retried after 5 s, 15 s, 1 min, then
every 5 min, and at once when the mochi's machine sends any request again; an
event already delivered never wakes the mochi twice.

**A machine that does not answer** is named, never skipped: `boite threads`
ends with `unavailable: <machine> is unreachable (...)`, a command on one of
its threads fails with the same reason and says its events arrive once it is
back, and the desk rows of its threads keep the last row it sent, marked
unreachable. A machine with `groupBots` off says so the same way, with the
command that asks its owner to turn it on.

Limits: a machine does not check which of its projects the mochis' owner
entrusted, it trusts the lease the mochi's machine sends (the owner of both is
the same person); its project names reach the mochi's machine only once it
allows mochis, so the settings and cards offer its projects from then on; a
remote desk row carries no question nor stall time, and opens only on a
client that reaches that machine; a stalled turn there wakes no one; the letters the mochi sends there do not
appear in its own machine's mail view; a mochi starts threads on another machine
only in the projects there entrusted to it.

## Entrusting a thread

Any kept thread of a project can be handed to a mochi from its menus (row,
title, phone sheet): Entrust to a mochi, then the mochi. `agents.entrust`
(owner only, `agents/entrust.ts`) refuses a delegated child, a mochi's
thread, an archived thread, a thread outside a project and a mochi that is
not active, naming the field. The thread keeps its own model and session. A
goal starts on it (Take over this work where it stands and carry it to a
verified result, unless another objective is given), the mochi's name and
instructions join each of its turns, the thread goes on the mochi's desk and a
line in the mochi's thread says so. A goal done or blocked is an event for the
mochi; a met goal ends the entrustment, a blocker keeps it so the user's answer
resumes the goal. Taking the thread back removes the goal without a message.
However the entrustment ends (a met goal, a take-back, the thread archived or
removed, the thread entrusted to another mochi), the owner's grant ends with it
(`AgentProjects.release`): the mochi loses the access the entrustment gave. A
watch it had before the entrustment, followed or started, stays as it was,
and so does a watch the owner adds while the thread is entrusted, a grant of
its own kept as `followed`;
the one the entrustment made stays only when the thread's project is
entrusted to the mochi, as `followed`, and otherwise leaves the desk. The news
of a met goal still reaches the mochi. The snapshot carries the list as
`entrusted`.

## Asking to change a mochi's settings

A mochi's settings stay the owner's, but a thread, or a mochi about itself or
another mochi (`--mochi <name>`), can propose a change with a card: `boite settings
mochi request <key> <value> --why <reason>`, the same flow as a card about a
Boite setting ([CLI](cli.md)). The keys are its name, its role (`domain`), its
instructions (`--instructions-file <path>` for a long text), its picture
(`avatar`: one or two characters, a robot code, a picture the owner imported (`img:<hash>`), or `""`), its `status`
(`active`, `paused` or `archived`), the projects entrusted to it, its model and
reasoning effort, the memory pass (`autoMemory`), its automatic event wakes
for every project and desk fact (`eventWakes`, off by default), whether it may add a folder of its machine as a project, which is then entrusted to it (`addProjects`, off by default), its subagents and its daily budget (`dailyBudget`, dollars a
day or `null`). A name another mochi holds is refused, when the card is drawn and
again when it is applied. The context block tells the mochi how to ask and when:
one the user asks to rename itself draws the card, one that needs a project it
was not given asks for it, and one whose settings no longer fit its work (the
user's words contradict its instructions, most wakes end quiet, its model or
effort costs more than the work needs) proposes the change on its own instead
of working around it. The card is asked without stopping and outlives its turn.
Apply (`agents.settings.apply`, owner only) goes through the same checks as the
mochi's settings page, and for projects the owner can untick part of the
proposal first. A model is named `<provider>/<model>` (`codex/gpt-6.1-sol`),
on any provider signed in on the machine; a model id of the mochi's own provider
needs no prefix. On its own provider the mochi keeps its account, on another it
takes that provider's signed-in default; an account the owner granted only to
other mochis is refused. A model outside the mochi's allowed routes can be
proposed: applying the card is the owner allowing it, so the route joins
the allowed routes and becomes the default one. Apply checks the model again
and refuses a move to another provider once that provider is turned off or
signed out; a model of the mochi's own provider passes, as on its settings
page, which takes one whatever the provider's state. A model card
drawn before cards named the provider holds a model id of the mochi's provider
and settles on that id. Any change to the mochi, from the card or from the page,
settles the cards it answers, and a card whose key no longer exists closes, as
does one about a mochi archived since, except the card that archived it; the
asking thread reads the outcome as a message. Code:
`agents/setting-cards.ts`, shared checks in
`packages/contracts/src/agent-setting-requests.ts`.

A thread asked to set up a mochi calls `boite settings mochi create <name>`, with
its role, instructions, model and projects ([CLI](cli.md)). What `agents.create`
does then follows the machine setting `agentBotCreation`:

- `ask`, the value of a new install: nothing is created. The core draws an
  asynchronous card in the calling thread (`QuestionRequest.setting` of kind
  `bot`, built by `botCard`) with the checked mochi, the names of its projects
  and its model, and returns `{ questionId, setting }`. Approve calls the
  owner-only `agents.create.approve`, which checks the mochi again (the name may
  have been taken since), saves it and settles the card with `applied` and the
  mochi's id and conversation; Decline answers `refuse`. The thread reads the
  outcome like a setting request's (`settingAnswerText`). A second request for
  the same name while its card is open is refused.
- `free`: the mochi is made at once, exactly as the Mochis page does, full access,
  its conversation and its "Just created" first turn included, and the call
  returns its id and conversation so the thread briefs it with `boite threads
  send`.

An install whose journal existed before the setting did gets `free` written
once at its first start (`SettingsStore.seedAgentDefaults`), a new one gets
`ask`; the stored value is never rewritten afterwards. The key is requestable
(`boite settings request agentBotCreation free --why "<reason>"`). Changing
the mochi afterwards still goes through a card. Code: `agents/create.ts`, shared checks in
`packages/contracts/src/agent-create.ts`.

## Routines

Routines (`agents/routines.ts`) belong to one identity and wake it on its own
thread. Choose a single date, an interval in minutes, a daily local time
(optionally on chosen weekdays), a day of each month, or a month and day of
each year. Recurring calendar schedules use an IANA timezone. Months without
the requested day are skipped, as are non-leap years for February 29.
Nonexistent local times at a clock change are skipped. The form previews the
same next instant as the core, including for routines saved in another timezone.
The owner can assign these in the schedule editor, or ask the mochi in its
conversation; it saves the reminder through `boite mochi schedule` before confirming.
The core wakes them without an idle model loop. A due routine starts a
`routine` turn; while the previous occurrence is still queued or running the
next one is skipped and `nextAt` still advances, and a failed, stopped or quiet
one never blocks. A routine due while the thread is busy with another turn
waits for it. After downtime, at most one overdue occurrence runs; missed
intervals are not replayed. Daily routines run once per local date, even when
clocks move back. A paused mochi or engine, or a spent budget, skips the
occurrence with `lastOutcome: 'skipped'` and advances `nextAt`. `lastTurnId`
and `lastOutcome` (`done`, `quiet`, `error`, `stopped`, `skipped`) follow
`turn.finished`. A single-date routine is done once it ran.

A single-date routine whose date passed (`spentAgentRoutine`: no `nextAt`, a
`lastScheduledAt`, whether it ran, was skipped or its check found nothing)
leaves the context block and no longer counts toward `AGENT_ROUTINES_MAX`.
`boite mochi routines` and the info panel still list it. The scheduler removes
it `AGENT_ONCE_KEPT_MS` (seven days) after `lastScheduledAt`, looking at most
once an hour and at the exact time the next one is due to go.

`quietRun` counts the occurrences in a row that ended in `[quiet]`; one that
ends `done` sets it to 0, a failed or stopped one leaves it, and a save that
changes the check sets it to 0. A due occurrence of a recurring routine without
a check whose `quietRun` reached `QUIET_RUN_HINT` (3) ends its prompt with a
line saying so and giving the command that adds a check,
`boite mochi schedule {"id":"<routine-id>","check":"<command>"}`; on a thread
that asks before commands, it tells the mochi to ask the user to add one in the
routine's editor instead. Run now never carries the line.

A routine may carry a `check` (`agents/checks.ts`): a shell command of at most
`AGENT_ROUTINE_CHECK_MAX` (2,000) characters that decides whether an
occurrence is worth a turn. When the routine is due, the core runs it through
`procs.spawn` as a process of the mochi's thread, in the thread's folder, under
`/bin/sh -c` (`ComSpec /d /s /c` on Windows), with no model involved. It reads
at most 64 KiB of each stream and stops the command after 60 seconds. The
output's hash is compared with `checkSeen`, the hash of what the mochi last read:

| The check | What happens |
|---|---|
| prints nothing, or what it printed before | no turn: `lastOutcome: 'nothing'`, `nextAt` advances, `checkSeen` kept |
| prints something else | a `routine` turn whose prompt ends with the command and its output (first 8,000 characters) as data; `checkSeen` is set once the turn started |
| exits non-zero, times out or cannot start | the same turn, saying the check failed and why, once per distinct failure |

A pause skips the occurrence before the check runs; a spent budget skips it
after, leaving `checkSeen` as it was, so the news still counts tomorrow. Output
that arrives more than a second after the shell exited (a child it left
behind holding the pipes) is dropped. A
check whose news meets a busy thread keeps its result and starts the turn
when the thread is free, without running the command again. Run now starts
the routine's turn without the check. Changing the command clears
`checkSeen`; a move carries the command and not `checkSeen`. The owner may
set any check. The mochi's own `boite mochi schedule` may add or change one only
while its thread runs in a mode that never asks before a command
(`bypassPermissions` or `yolo`): a check runs unattended, so a mochi that must
ask before a command cannot plant one. It may always keep or remove one. The
context block names a routine's check, and the desk row marks it.

The mochi keeps its own routines (`boite mochi routines|schedule|unschedule`,
`agents.routine.save|remove`). An edit through `boite mochi schedule` with an
`id` keeps the name, prompt and schedule it leaves out. One mochi holds at most `AGENT_ROUTINES_MAX`
(50) routines, spent single-date ones aside, a new one past it refused with the count; a name holds at most
80 characters and a prompt 4,000. Run now (`agents.routine.run`, owner only)
returns the turn it started, is idempotent per request id and is refused while
the thread has a turn in flight. The schedule editor writes a sentence under
the choices saying what will happen and when it runs next, for example "Every
Monday and Friday at 6:00 PM" (`schedule.ts`).

## Event triggers

`AgentTrigger` records use the `trigger` kind in `agent_entities`. Snapshots
include the source, state, last dispatch outcome (`lastOutcome`, `lastOutcomeAt`,
`lastFiredAt`), and, for webhooks, the
endpoint path and `hasSecret`. Only `agents.trigger.save` on webhook creation
and `agents.trigger.rotateSecret` return the secret. Both require the owner
and an encrypted connection to issue it. The 32-byte hex secret is stored
under the core data directory in `mochi-trigger-secrets.json`, atomically
replaced with mode `0600`. On Windows, access relies on the data directory's
ACLs, inherited from the user profile by default, as for group and speech
credentials. The secret stays out of SQLite. `agents.record` events carry
only the id and revision. Trigger mutations (`agents.trigger.save`,
`agents.trigger.remove`, `agents.trigger.rotateSecret`, `agents.trigger.test`)
are owner-only; a mochi's own thread can list its triggers through
`boite mochi triggers` (`agents.snapshot`). `agents.trigger.test` keeps a
receipt keyed by `requestId`, queues in its own slot so it never overwrites a
real pending event, and persists its test-only timestamp (`agents:trigger-test-at:<id>`)
so a test turn does not trigger cooldown for real events even across a restart.
`agents.trigger.remove` deletes the trigger record, test stamp, real webhook
timestamp and persisted
root anchor inside one SQLite transaction, then removes any stored webhook
secret after commit.
Trigger edits accept a revision from before the latest firing outcome, provided
the trigger's configuration has stayed the same since that revision.

- `POST /hooks/mochi/<triggerId>` accepts `Authorization: Bearer`,
  `X-Boite-Secret`, or `X-Hub-Signature-256: sha256=<hex>` (HMAC-SHA256
  of the exact request body). Comparison is constant-time. A missing or
  disabled route returns 404, failed authentication 401, a body over 1 MiB
  (`WEBHOOK_MAX_BODY_BYTES`) 413, cooldown 429 with a decaying `Retry-After`
  (tracked from `lastFiredAt` and a separate durable real-attempt stamp
  `agents:trigger-webhook-at:<id>` so paused, failing or busy mochis stay
  throttled across restarts while tests, edits and restart queue resets never
  interfere), an already pending real wake
  past cooldown 503 with `Retry-After: 10`, and a replayed delivery 409.
  Duplicate `X-GitHub-Delivery`
  or `Idempotency-Key` values are rejected via durable receipts, and every
  HMAC-signed request is also checked against a bounded 15-minute digest cache
  so unsigned delivery headers cannot bypass replay protection (identical signed
  bodies within 15 minutes return 409).
  Malformed signatures are rejected before reading the body. Signature
  verification streams chunks directly into HMAC-SHA256 while retaining only
  an 8 KiB preview in memory (`PREVIEW_BYTES`), and signature-only requests
  have their own read pool with limits per trigger, per `(trigger, source)`
  pair and per source address so one slow client cannot starve other senders
  on the same trigger. `Tailscale-Funnel-Request` and `X-Forwarded-For` are
  read only on loopback connections from a local Funnel proxy; any other local
  reverse proxy forwarding untrusted traffic to loopback must strip
  `Tailscale-Funnel-Request`. Only a bounded,
  quoted payload excerpt and untrusted `X-GitHub-Event` label reach the mochi.
  Use HTTPS when exposing the route.
- File triggers attach non-recursive `fs.watch` listeners to directories in
  the local granted project (tracking each watched directory's device and inode
  so nameless rename rescans reopen replaced subdirectories), skipping symlinks, unreadable subdirectories
  (`EACCES`, `EPERM`, `ELOOP`), `.gitignore` plain folder names (read from the
  resolved root with `O_NOFOLLOW`, rejecting symlinked or non-file `.gitignore`
  and capping reads at 64 KiB), `.git`,
  `node_modules`, `.boite` and default build/dependency folders (`dist`,
  `target`, `.venv`, `venv`, `__pycache__`, `.next`, `.nuxt`, `build`,
  `coverage` unless explicitly named in a pattern), and pruning directories
  whose prefix cannot match any configured pattern. Each trigger watches at
  most `MAX_WATCH_DIRS` (512) directories (checked after `lstat` confirms a
  subdirectory so file renames at the cap do not trip it) and reports
  `watchUnavailable` with `watchUnavailableReason: 'limit'` (backing off to
  60 seconds) if a project tree exceeds that cap. Matching relative paths are
  grouped into a debounced batch of up to 50 paths plus an overflow count
  (`more`). Editing or disabling a trigger, removing its project grant, or
  stopping the core closes the file watch and drops its pending batch. All
  file changes in that project observed while that mochi's own file-trigger
  turn on the same project is running are ignored immediately (before any
  asynchronous lookup, debounce or root probe) so a mochi does not wake itself
  in a loop while pre-turn edits remain intact. Boite checks the root's
  resolved `realpath`, device and inode asynchronously (`lstat` + `realpath`),
  with one metadata read in flight per path. Saving a file trigger resolves the
  project's `realpath` asynchronously and anchors it in SQLite
  (`agents:trigger-anchor:<id>`), preserved across restarts, disables and edits
  on the same project; if the folder is absent at save, Boite persists an
  unresolved anchor (`realPath: null`) so initial open refuses symlinks even
  after a restart until a real directory is anchored. That
  allows retry recovery if a symlinked project is temporarily absent at
  startup while rejecting any redirection of the root or an ancestor directory
  even across restarts. File wakes wait
  for validation. A separate non-recursive watch on the parent invalidates
  a probe when the project's directory entry is renamed during that probe.
  This keeps ordinary child renames from invalidating the root check. If a
  notification indicates that the parent may have moved, Boite closes its
  watch and tries to reopen it after validating the project root. If the
  parent cannot be watched (for example, Linux allows traversal without read
  permission), Boite treats ambiguous rename notices from the root watch
  conservatively and can delay wakes until a fresh read completes. If the
  directory disappears or is replaced, Boite drops the old
  batch and any queued wake from that watch, reports the watch unavailable,
  and retries opening it with backoff.
- PR triggers reuse the existing PR tracker and its GitHub reads (the
  fingerprint query reads `contexts(last:100)` alongside aggregate state counts,
  and the detail query merges `contexts(first:100)` and `contexts(last:100)`,
  paginating additional middle pages via `CONTEXT_PAGE_QUERY` when a pull
  request exceeds 200 check runs and a required check is still missing). An open
  watch establishes a baseline, then forwards new CI failures (including
  repeated failed runs of the same check name on the same commit when no
  intermediate pending poll occurred), review requests, requests for changes,
  conflicts and merges for its conversation's project. Only eligible triggers
  record `trigger-pr-transition` receipts so paused, archived or revoked
  mochis do not consume transitions or mutate trigger state. A receipt
  deduplicates each transition across watches of the same pull request in the
  same project. When multiple pull requests trigger during cooldown or while
  busy, up to 20 distinct pull request URLs coalesce into one wake (`additional`).
  There is no second polling loop.

Explicit triggers use the regular event wake checks for pauses, archived
profiles, budget, provider availability and grants, independently of the
general `eventWakes` setting. File and PR events that arrive during a
trigger's cooldown coalesce in memory (`lastOutcome: 'queued'`) without
overwriting `lastFiredAt` and dispatch once cooldown expires. A busy mochi
queues its pending event per trigger in memory without stamping `lastFiredAt`
until the turn actually starts, coalescing further file or PR events into the
waiting wake without deferring it for cooldown and avoiding redundant SQLite
writes on scheduler ticks while the wake stays queued. `lastOutcomeAt` tracks
when any outcome (`fired`, `queued`, `skipped` or `error`) was recorded so the
UI displays first-time non-firing outcomes accurately. On restart the core
reopens eligible file watches and marks any previously queued event skipped.
Triggers are scoped to the original machine and are removed inside the same
SQLite transaction (wrapped in `bus.afterCommit` so webhook secret deletion
waits for commit and drops on rollback) as the source profile when a move
completes.

## Budget and limits

A mochi has no run cap: a wake runs as long as any turn, and the thread's own
auto-compaction (the user's compaction size setting) applies. Its own thread
also compacts a minute before a one-hour prompt cache lapses, from 60 000
tokens, so the next wake writes a summary instead of the whole conversation
([A mochi's cold wake](context.md#a-mochis-cold-wake)). `dailyBudgetUsd`
in its runtime config (null by default) caps what the mochi spends from local
midnight: the turns started on its thread and on every thread below it, its
subagents at any depth (`parent_thread_id`), the steps of workflow runs rooted
there and its memory pass. `agentSpend` in `packages/core/src/agents/spend.ts`
is the only reader of that sum, for the budget and for the status's
`today.costUsd`. It prices each turn with the usage page's rule
([the API estimate](usage.md#the-api-estimate)): the model's public rates
first, else the cost the agent reported, so a Codex mochi, whose turns report
no cost, spends what its tokens cost. A turn on a model the price list does
not know that reported no cost adds nothing, so a mochi that only runs such
turns never reaches its budget. Past the budget, wakes are skipped with one
system line a day in its thread and `lastOutcome: 'skipped'` on the routine;
the user's own messages always run. The budget counts the subagents' turns
but never holds them: a subagent spawned during the user's message, a
workflow step or a memory pass still starts.
`agents.limits.set { paused }` holds every wake on the core. Configs saved with
`maxRunMinutes` or `compactAfterTurns` still load, without them.

Models and limits separates the required default route, allowed main routes
and allowed subagent profiles. A route names a provider, account and model.
Subagents are on by default: with no profile listed, a mochi's children run on
any model of an account granted to it, unless the owner turns free model choice
off; listing profiles restricts children to them. The combined provider and
account-probed catalog determines availability, and there is no silent
fallback to an unapproved model. Saving retains a previously approved model
and unchanged effort if a later catalog omits them. Account access grants each
subscription to all identities or an explicit list, children included, and
routes are checked again just before driver launch. A mochi's thread moves to
another account only when that account is granted to it.

Every card of a mochi's settings saves by itself: a pick, a switch or a menu
at once, a typed value after a pause in typing or when the field loses focus,
with Saving, Saved or Not saved and the core's reason. Archiving asks for the
mochi's name first.

## Status

`AgentsSnapshot.status` holds one `AgentStatus` per mochi, read from its
thread:

- `state`: `archived`, `waiting` (a card waits for the user), `working`,
  `queued`, `paused` (the mochi or the engine), `error` (its last turn failed,
  or `problem` is set), else `idle`;
- `activity`: while a card waits, what it waits on (`Waiting for your answer:
  <question>`); while a turn runs, the running tool's own summary or
  description, else its name and what it acts on (`Bash: bun test`), else
  Thinking, Compacting its context or Retrying;
- `problem`: why it cannot run, naming the fix: its provider is gone (a mochi
  on a removed provider loads with it) or turned off (by its switch or the
  admin policy; clients hear of it with `providers.updated`), its account is
  gone or its model left the catalog;
- `nextWake`: the next enabled routine occurrence;
- `unread`: answers the user has not read on its thread, counted since it was
  last read. Only an answer or a failure counts: a compaction (the hourly one
  before the prompt cache lapses included), a keepalive, a quiet wake or a
  stopped turn leaves the thread as read as it was (`turnIsNews`);
- `last`: the final text block of its last non-quiet answer, first 200
  characters;
- `today`: its turns since local midnight, the wakes among them (`routine` and
  `event`), the quiet ones and their spend in API-equivalent dollars. The
  mochi column's head shows it behind an "i", against `dailyBudgetUsd` read
  with `agents.runtime.get`; an occurrence a check held back starts no turn
  and is not counted.

The head's one line (`BotColumnHead.svelte`) reads the step while it works,
what it waits on, why it failed, its pause, else `nextWake`, else its role.

`agents.changed` is an invalidation: clients fetch a snapshot. It goes out at
most once a second, the first change at once, while a mochi works (a step, a
card, a title, an answer) and when its desk changes (a watched thread's turn,
card, row, stall or pull request).

## Moving a mochi to another machine

`agents.move` (`{agentId, machine, requestId?}`, owner only) sends a mochi to
another machine of the group in one sealed, member-only request (`bot.move`,
`packages/core/src/agents/move.ts`). The target must have `features.botMove`;
an older one is refused with "update Boite on <machine>". The request carries:

- the profile without what only the source knows (account, session, thread
  and record ids): name, domain, instructions, robot, status, built-in kind,
  route (provider, model, effort, permission mode) and projects;
- its saved settings: auto memory, event wakes, daily budget and the
  subagent switches (allowed routes and subagent profiles start again from
  the new route);
- the brain files `AGENTS.md`, `MEMORY.md` and `memories-archive.md`, at most
  96,000 bytes together, refused past it with the file named (`brain.<file>`);
  `skills/` stays behind;
- its routines (name, prompt, schedule, on or off, a spent one-shot stays
  spent), whose next occurrence the target computes again;
- the facts still waiting for it, filed there to wait for its next turn,
  each with the time the source wrote that version (`written`, rising with
  every write on the source, so a key set back to an earlier text is still
  the newest);
- the end of its conversation as text excerpts (`messageExcerpt`, the
  builder of a fresh session's history), newest first, at most 200 messages
  and 48,000 characters;
- the source machine's name and core id.

The whole request stays under 180,000 bytes of JSON.

Projects are written as the target sees them: `<target-id>/<project>` becomes
the target's own `<project>`, one of the source's becomes
`<source-id>/<project>`, any other keeps its form; a local project the target
does not have, or its drafts, is left out. The answer lists them
(`projectIds`) and those of the source (`groupProjects`), which work while the
source keeps `groupBots` on.

The target runs the mochi on its signed-in account of the same provider, with
the same model and effort when it lists them and that provider's defaults
otherwise; without one, on its own default route, as a new built-in mochi gets.
With no signed-in account at all it refuses: "agents.move: <machine> has no
signed-in account to run <mochi>; sign in there first". It also refuses a mochi id
it already holds from another request, and a built-in mochi whose kind it
already has live. The source refuses a move to itself, to a machine outside
the group, of an archived mochi, and of a mochi whose thread or a sub-thread has a
turn running or queued (`reason: 'turn-in-flight'`). A mochi in a team moves with
its membership: it stays the same member, the machine holding each team hears
where it went, and posts still waiting for it wake it there
([teams](teams.md#a-member-that-moves)).

The target creates the mochi and a new thread whose earlier turns are the
carried excerpts; its first turn sends them to a fresh session, as a fork
does. No wake runs on arrival and a paused mochi stays paused. Its next prompt
(not a slash command or a compaction) carries a move note, once: "You moved
from <source> to <target> on <ISO date>. Your memory, notes, routines and the
end of your conversation came with you; the projects of <source> are reached
as <source>/<project> through the group."

From the snapshot to the end of the move, the source holds the mochi's wakes
(`BotMoves.moving`): a due routine, an event or a waking fact waits as it
would for a busy thread, Run now is refused, and other autonomous turns are
held. What changes while the request travels is not lost: once the target
answers, the source reads the mochi again (a fact filed, a rename, settings,
brain files, routines) and sends the same request with it, up to three times
(`MOVE_FACT_ROUNDS`, then `reason: 'facts-arriving'`). The target files, per
key, a fact version newer than the one it filed for that request; a version
the mochi already read there is not told twice. A move carries at most 100
waiting facts and refuses more. A turn the owner started on the mochi meanwhile
refuses the end of the move with `reason: 'turn-in-flight'`; the same
`requestId` finishes it once the turn is over.

Every request carries the whole mochi. The target keeps a print of each part it
applied for the `requestId` (`agents:moved-in-parts:<source>:<requestId>`:
profile, route, settings, routines, each brain file, and the version of each
fact by key). The same request again, while it holds the mochi, applies only
the parts whose print changed: what the source wrote after a lost answer
(memory, notes, routines, a rename, settings, facts) replaces the target's
copy of that part, and a part the source left alone keeps what the target
wrote meanwhile. A route the target cannot run keeps the one the mochi has
there. The conversation is not carried again: turns held on the source after
a lost answer stay in its archived thread.

The source changes nothing until the target has the mochi and every fact.
Then it adds the line "Moved to <machine>" to the old thread and archives it,
which stays readable; it removes the profile, its routines, its session, its
waiting facts and its settings, and renames its brain folder to
`<folder>-moved-<date>`. A built-in mochi moves the same way: afterwards
`builtinThread` answers on the target and is null on the source. The
`requestId` defaults to a new one per call; the same one again returns the
first answer from both machines, so a move whose answer was lost is retried
without making a second mochi: the target answers with the mochi it made (and
applies what the source changed since), and the source then archives and
removes its copy. A refusal or a silence keeps the mochi and its facts on the
source. From the first send to the end, the source remembers the request as
unfinished (`agents:moving-out:<requestId>`, `BotMoves.unfinished`); a
refusal the target read clears it, a silence or a lost answer does not, so the
Contacts mochi's move ([contacts](contacts.md)) sends the same request again at
each sweep until the source's half is done. The Machine row keeps one `requestId` per mochi and target in the
window's storage (`boite.agentMoves`, `lib/agent-move.ts`) until the move
succeeds or a refusal that read the request ends it; after a lost answer, a
silent target (`reason: 'unreachable'`), a busy mochi or a dropped connection,
the next try, even after a reload, sends the same id.

### After the mochi's turn

`agents.move.queue` (same params, owner only, `features.botMoveQueue`) runs the
checks of a move now (member, archived) and keeps the move in
`AgentStatus.leaving` (`{agentId, machine, requestId, at}`), persisted as
`agents:move-queued:<agentId>` so a restart keeps it. From then on the mochi's
routines, events and waking facts are held as during a move; the owner's
messages and the letters its sub-threads send still run, and the move waits
for them too. Each scheduler pass (`BotMoves.sweep`) starts it once the mochi's
thread and every thread below it are idle, at once for an idle mochi, with the
kept `requestId`. A turn that starts on the way only delays it. A target that
did not answer may hold the mochi already: the thread gets one line ("Not moved
yet: … The move tries again every 30 seconds until it is cancelled") and the
same request goes again every 30 seconds. A refusal the target read drops it
with the line "Did not move once its turn ended: <reason>", and the mochi stays.
Asking again replaces the waiting move. `agents.move.cancel` drops it and
answers `{cancelled: false}` when none waits or once it started. A cancelled
move may have reached the target: the window keeps its `requestId` for the
next move to that machine by hand (`moveResumable`), which finishes it rather
than making a second mochi.

## Built-in mochis

A built-in mochi is one Boite ships (`AgentProfile.builtin`), one of each kind
per core. The first is the Contacts mochi (`contacts`,
[contacts](contacts.md#the-contacts-mochi)), created by the Contacts switch
through `agents.builtin.ensure`, which returns the existing one when called
again. A new one runs on the machine's signed-in account and that account's
default model, else its first listed one; on a provider whose agent lists its
own models (Claude's descriptor names none), ensure and reset read that list
first when nothing has read it since the core started. Its row and header carry a Built-in badge. Its domain and instructions
are Boite's: the settings show them read-only, `agents.profile.save` and
setting cards refuse a change to them, and a new Boite version rewrites them
in place. The owner renames it, picks its robot, model, effort and permission
mode, and pauses it. It is never archived; Reset (`agents.builtin.reset`)
archives its thread and starts a new one, empties its memory, removes its
routines and gives back its default name, robot and route (or the route the
reset names) and its default runtime settings (`agents:runtime:<id>` is
dropped: no daily budget, event wakes and adding projects off, auto memory and subagents on).

## Migration

Mochis saved before this model keep working (`agents/migration.ts`, run once at
start, flag `agents:migrated:threads-v1`, each step recorded on its own as
`agents:migrated:threads-v1:<step>` until all are done, so a retry neither
redoes nor skips one). A legacy session, routine or memory record that does
not have its shape is skipped with a log line naming its id and stays in
`agent_entities`; the others migrate. Profiles, routines (`lastWorkId`
becomes `lastTurnId: null`), the session of each mochi's own conversation,
entrustments, brain folders and grants stay. The threads of its group and
mission sessions are archived and their records dropped. In each mochi's
thread, an old prompt whose first text part starts with `You are ` and holds
`\nCurrent work: ` displays what follows the last `Current work: `, and one
starting with `Notices from Boite` displays `Project events`; the text sent
stays as it was. Each mochi's old mochi-scoped memories are written once to
`brain/memories-archive.md` (title, date, text), never injected, and the
context block names that file as older notes it may read. Records of removed
kinds (groups, teams, missions, tasks, resources, artifacts, decisions,
messages, deliveries, work, runs, episodes, scoped memories, read marks) stay
in `agent_entities`, unread.

## Access

From its own thread a mochi calls `agents.snapshot` (its own identity,
routines, desk and status only), `agents.brain.get`, `agents.memory.note`,
`agents.routine.save|remove`, `agents.watch` on its own desk,
`agents.session.new` for its own thread,
`agents.settings.read|request` and the `resident.*` methods
(`packages/core/src/access.ts`, each with its reason); `resident.*` reaches
the projects of another machine through that machine's `groupBots`
permission. A paired device reads
`agents.snapshot`, `agents.open`, `agents.runtime.get` and `agents.brain.get`
(`packages/contracts/src/access.ts`), sends it outside events
(`agents.event`) and talks to the mochi through its thread like any other;
configuration, account grants and entrusting stay owner-only.

## Verification

Follow the relevant [development checks](development.md#checks-and-tests).
Core tests: `agents.test.ts` (creation and introduction, the user's messages
as ordinary turns, delete refused and archive, open recreates, own snapshot
only), `agents-runtime.test.ts` (the context block, routine wakes and
outcomes, a routine's check waking the mochi only on new output and who may
set one, a wake that failed on a usage limit resuming after the reset, quiet
events, budget, pauses, fact batching, instructions changed, an outside event
from a paired device),
`agents-new-session.test.ts` (a new conversation: a fresh session without the
earlier messages, memory, routines and desk kept, the note read once and kept
after a failed turn, a request during the mochi's own turn applied at its end,
the 30 minute gap),
`agents-desk.test.ts` (desk rows from a started, an entrusted and a watched
thread, follows kept while open and dropped a day after done, the open cap,
the stall event once per turn, an entrusted goal waking the mochi, pull
request checks failing and merged, status activity and today's counts,
dropped facts), `agents-group.test.ts` (two cores of one group: a mochi of
one sees, steers and hears a thread of the other, owner-only actions refused,
an offline machine named and its events delivered on return, access cut when
`groupBots` goes off), `agents-projects.test.ts`, `agents-entrust.test.ts`,
`agents-memory.test.ts`, `agents-migration.test.ts`,
`agents-setting-cards.test.ts`, `agents-triggers.test.ts` and the mochi section of `cli.test.ts`.
`bench/agents-snapshot.ts` measures the snapshot over a mochi thread with
thousands of turns. Real-provider inference is opt-in.
