# Mochis

A mochi is a conversation that keeps its name, its memory and its routines. It
works on its own, wakes on a schedule or when something happens in its
projects, and tells you what matters. Teams put a few mochis and you in one
chat.

On the desktop, each mochi and team shows as a picture in the app rail, the
column down the window's left edge. With Mochi layout turned off under Filter,
Display, open Mochis from the button at the foot of the sidebar to list them in
the left column instead. A phone shows a Mochis tab in its bottom bar. In the app rail, teams come first; drag a
picture up or down to put mochis and teams in your own order, which this device
keeps. A small mark on a picture says the mochi needs you, failed or is at
work; a mochi with unread answers shows how many, and a team shows a dot. A
circle runs around the picture while the mochi works. Point at the picture to
read it in words beside the mochi's name. A faded edge means there are more
pictures to scroll to.

## Create a mochi

1. On the desktop, press the `+` under the mochis in the app rail (under a
   mouse, it fades in when the pointer comes to the rail), or with Mochi layout
   off, open Mochis and press `+` in the column head, and pick New mochi. On a phone,
   open Mochis and press New mochi.
2. Give it a name and, under What it does, its standing instructions, for
   example "every morning, read the new issues and sum them up in five lines".
3. Its robot, model and projects come filled in; change them if you like. It
   starts on Full access; pick another permission mode before Create if you
   want it to ask.
4. Press Create. Its conversation opens: it introduces itself, reads its
   instructions, sets up the routines they call for and tells you its plan.

You can also ask the agent of any conversation to set a mochi up for you. A
card then appears in that conversation with the mochi's name, role, projects and
model, and the line "This mochi runs with full access to this machine". Approve
creates it; Decline creates nothing, and the agent is told either way. To let
agents create mochis without that card, turn on Create mochis without asking in
Settings, General, What agents may do alone. A mochi created this way has full
access to this machine. An install that already held conversations before this
setting existed starts with it on, as it worked before.

You talk to a mochi in its conversation like in any thread. On the desktop,
clicking its picture in the app rail opens it, with the mochi's column in place
of the thread list. The column stays when the mochi's Desk opens beside the
conversation. The head of that column shows what it does right now,
what it waits on, an error, or its next wake. Its more menu holds Edit,
Pause or Resume, Archive and the rest of the mochi's menu, plus Brain and the
mochi engine. A right click on its picture in the app rail opens the same
menu. Archive asks you to type the mochi's exact name; its conversation
stays readable.

## Routines and wakes

- Add a routine with the `+` beside its routines in the info panel, or ask
  the mochi to plan one. A routine runs Once, Every day, Some days, Monthly,
  Yearly or Repeatedly. Run now starts one at once. A mochi holds up to 50
  routines. A Once routine stays in the list for seven days after it ran,
  then goes; it no longer counts toward the 50.
- A mochi also wakes on its own when a turn ends in a thread on its desk, when
  that thread fails, asks you something, waits on a permission or stays
  silent for 20 minutes, and when a pull request there is merged or its
  checks start to fail. That includes a pull request opened by a subagent of
  one of those threads, even after the subagent is archived.
- A thread that carries on by itself, with its next message already sent, a
  goal or loop still running or its pull request being watched, wakes the
  mochi only once it stops. While the mochi's wakes about a thread find
  nothing to report, it waits longer before the next one: 30 seconds, then
  5, 15 and at most 30 minutes. A wake that has something to say brings it
  back to 30 seconds. Failures, questions, permissions, silences and merges
  never wait longer.
- A wake skipped for the daily budget, or one that failed before the mochi
  answered, keeps its news for the next wake.
- A routine brings what waited for it: the latest news of each thread, and
  how many more threads moved when they do not all fit.
- A wake with nothing to report folds to one "Checked" line and sends no
  notification.
- A routine can wake the mochi only when there is news. Under More options,
  "Only when there is news" takes a command, for example
  `gh pr list --json number,title`. When the routine is due, Boite runs it in
  the mochi's folder: the mochi wakes only if the command prints something it did
  not print the time before, or fails in a new way. A check that finds nothing new costs
  nothing, and the routine reads "nothing new". Run now skips the check. You
  can always set one; the mochi sets its own only when it runs with full access.
- Give a check to a routine that only watches for something: new issues or
  pull requests, a build that fails, a price, a reply, a file that changes. A
  routine that does work each time (a report, a post, a weekly review) needs
  none. The command prints only what should wake the mochi and nothing when all
  is as before. For example, a routine "New issues", every 30 minutes, with the
  check `gh issue list --repo owner/repo --state open --json number,title`
  wakes the mochi only when the list of open issues changes.
- When a routine without a check ends in "Checked" three times in a row, its
  next run tells the mochi so, with the command that adds a check. The count
  starts over when the mochi has something to say or the routine gets a check.
- After downtime, at most one missed occurrence of a routine runs.
- With "Resume threads after a usage limit" on (Settings, AI accounts,
  Limits), a routine or event that failed on a spent limit runs again once
  the limit resets.

## Triggers

Open **Triggers** below a mochi's routines. Use **Add trigger** to choose
the event that should wake it and say what to do when it wakes.

- **Webhook** gives another service a URL to POST to. Copy the secret when
  you create the trigger. **Rotate secret** gives you a new one and disables
  the old one immediately. Use the local app or an encrypted connection to
  create or rotate it. Use HTTPS when sending events over the internet.
- **Project files** watches a project you granted to the mochi on this
  machine. Enter comma-separated paths or patterns such as `src/**/*.{ts,tsx}`,
  or leave them blank for all source paths. Boite groups changes before
  waking the mochi, skips ignored, dependency, build and Git folders, and
  ignores changes in that project while that trigger's own turn is running.
  The trigger shows when Boite cannot watch the project (for example, if it
  has more than 512 watchable folders) and is retrying.
- **Pull requests** listens to pull requests that Boite already watches in a
  granted project. Choose failed CI, review requests, requests for changes,
  merge conflicts or merges.

Use **Test** to send a sample event without affecting real events or cooldowns.
The trigger shows when it received an event and whether the mochi woke, waited
or skipped it. A cooldown limits how often a trigger wakes it: project file
and pull request changes that arrive during cooldown wait and combine until it
ends, while webhooks receive a retry delay. A busy mochi takes the waiting
event for each trigger after its turn (for webhooks, the first request waits
and additional ones receive a busy retry response until it finishes). Paused or archived mochis and
mochis over their daily budget do not wake. Triggers stay owner-only, belong
to their machine and are removed when a mochi moves to another one.

## The info panel

The info button in the window's top bar opens the mochi's info panel on the
right, in one column with no tabs: its picture, name and description with its
model, machine and age; while it works, a Now card with the step, a timer and
its last steps; its routines; and its memory, with the note count and the
first three notes. A warning mark there means a memory update failed; its
tooltip holds the error.

The mochi's column starts with its name and one status: the step it is on, what
it waits for and how long it has waited, why it failed, or, at rest, its next routine and when. The "i"
beside its name says how often it woke on its own today and what it spent
today in all, your messages included, beside its daily budget when it has one.

The threads it started, was entrusted or follows sit in the mochi's column,
with their state, pull request and checks. A thread with no pull request of
its own shows the one its subagents opened. A Needs you row lets you answer its
question in place. Each section lists its threads in the order they were
started, first on top; a row moves only when it changes section.

You set its daily budget in the mochi's settings.

## Memory and brain

Each mochi has a brain folder: `AGENTS.md` holds its ways of working,
`MEMORY.md` its notes and `skills/` its procedures. After an answer you saw, a
small helper rewrites its memory from what you asked and what it answered;
turn off Update memory after each answer to stop it. The mochi also notes facts
as it learns them, under a heading of its memory or in place of the one line a
newer fact replaces. When only its memory changed since its last answer, the
mochi is told the lines added and removed rather than all it knows again. Its
memory and identity stay when you change its model.

The model, effort and permission chips under its message box change its
settings, as its settings page does, and its next answer uses them. On a
paired device they only show its settings.

Under Engine settings, Brain folder moves every mochi's brain to a folder you
choose, a Git repository of your own for example. Each mochi gets a folder named
after it.

### A new conversation

A mochi keeps one conversation, which grows until it is compacted. When it has
grown long or a piece of work is finished, the mochi can start a new
conversation in the same thread, with a short note of what to carry over. Its
memory, routines, desk and settings stay, and you still see everything above.
A line in the thread marks where the new conversation starts. If the mochi is
answering, the new conversation starts once that answer ends. A mochi starts
one by itself at most every 30 minutes; ask it when you want one sooner.

You can also start one yourself: open the mochi's menu, in the list or at the
top of its conversation, and choose New conversation. The note is optional and
the mochi reads it once, with its first message. While the mochi is answering,
the button reads After this turn. The line in the thread says who asked for it
and opens on the note.

## Projects and threads

- In its settings, Projects lists the projects it looks after. It follows
  their threads, starts new ones, steers them, answers their questions and
  tells you what matters.
- To hand one thread over, open its menu and pick Entrust to a mochi. The mochi
  takes the work where it stands and carries it to a verified result. Take it
  back ends it.
- Deleting a thread and approving a tool permission always stay yours.
- A mochi can propose a change to its own settings on a card. Nothing changes
  until you apply it.

## Cost and control

| Setting | What it does |
| --- | --- |
| Daily budget for its own wakes, in dollars | Past it, routines and events wait until tomorrow. Your messages always run |
| Automatic project and desk wakes | Off by default: only threads it started, was entrusted or watches wake it. Other events wait for the next routine |
| Add projects | Off by default: lets it add a folder on its own machine as a project and entrusts the new project to it |
| Allow subagents | Lets it hand work to [subagents](subagents.md), on the models listed under Subagent models |
| Pause | No routine or event wakes it. You can still write to it |
| Pause every mochi | The same for every mochi on this machine |

The budget counts its subagents and workflow steps, priced at the models'
public rates. A model with no known price that reports no cost adds nothing.

A mochi with a long conversation that stays idle for about an hour compacts it
just before its next wake would have to read it all again, unless automatic
compaction is off. The divider in its thread says `auto`.

## Move it to another machine

On the desktop, pick Move to a machine in the more menu at the head of its
column, or use the Machine row of its settings.
Its memory, notes, routines and the end of its conversation go along; the old
conversation stays archived where it was. A mochi at work moves once its turn
and the threads it started are done. Its `skills/` folder stays behind.

## Teams

1. Press the `+` under the mochis in the app rail and pick a new team.
2. Give it a name, an optional brief that every member reads, and its members:
   up to 12 mochis, at least one of this machine.
3. Press Create the team. Its chat opens.

In the team chat, `@name` wakes the mochis you name, `@everyone` wakes them all,
and a post that names nobody wakes every member. Reply wakes the author of the
post you answer. Who reads it makes a post private to one member. Each mochi
answers from its own conversation, in the group or privately to you.

- A mochi's post wakes no other mochi; teammates read it the next time they wake.
- A mochi can propose a team, a new member or its own leaving on a card: Create
  the team, Add to the team or Remove from the team, or Refuse.
- The menu holds Edit the team, Pause, Archive and Restore. A right click on
  the team's picture in the app rail opens it too. A paused team keeps your
  posts until it resumes.
- A team can take mochis of the other machines of your group. The machine that
  created it holds its chat.
- A post holds up to 4,000 characters and no attachment. Private posts are
  never hidden from you.
- A paired phone reads and posts. Creating or changing a team stays on the
  computer running Boite.

## Going further

- [Brain](brain.md): instructions and skills shared by every agent.
- [Subagents](subagents.md) and [Goals](goals.md).
- [Coordination](coordination.md): how conversations message each other.
- [Machines](machines.md): your group of machines.
- Technical reference: [mochis](internals/mochis.md), [teams](internals/teams.md).
