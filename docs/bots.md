# Bots

A bot is a conversation that keeps its name, its memory and its routines. It
works on its own, wakes on a schedule or when something happens in its
projects, and tells you what matters. Teams put a few bots and you in one
chat.

Experimental: turn it on in Settings, Experiments, Bots. The desktop sidebar
then shows a Threads and Bots switch at the top, and the phone a Bots tab in
its bottom bar. Bots you made keep running while the switch is off.

## Create a bot

1. Open Bots and press New bot.
2. Give it a name and, under What it does, its standing instructions, for
   example "every morning, read the new issues and sum them up in five lines".
3. Its robot, model and projects come filled in; change them if you like. It
   starts on Full access; pick another permission mode before Create if you
   want it to ask.
4. Press Create. Its conversation opens: it introduces itself, reads its
   instructions, sets up the routines they call for and tells you its plan.

You talk to a bot in its conversation like in any thread. Its header shows
what it does right now, what it waits on, or its next routine. The header menu
holds Settings, Brain, Pause or Resume, and Archive. Archive asks you to type
the bot's exact name; its conversation stays readable.

## Routines and wakes

- Add a routine from the desk's Routines tab, or ask the bot to plan one. A
  routine runs Once, Every day, Some days, Monthly, Yearly or Repeatedly.
  Run now starts one at once. A bot holds up to 50 routines.
- A bot also wakes on its own when a thread on its desk ends, fails, asks you
  something, waits on a permission or stays silent for 20 minutes, and when a
  pull request there is merged or its checks start to fail.
- A wake with nothing to report folds to one "Checked" line and sends no
  notification.
- After downtime, at most one missed occurrence of a routine runs.

## The desk

The desk button in the header opens the bot's desk in the right panel: what it
does now, then three tabs.

| Tab | What it shows |
| --- | --- |
| Work | The threads it started, was entrusted or follows, with their state, pull request and checks. A Needs you row lets you answer its question in place |
| Routines | Its scheduled work, with the last run of each |
| Memory | Its notes, their last update and its Ways of working |

Today's turns, wakes and spend sit in a summary on the desk.

## Memory and brain

Each bot has a brain folder: `AGENTS.md` holds its ways of working,
`MEMORY.md` its notes and `skills/` its procedures. After an answer you saw, a
small helper rewrites its memory from what you asked and what it answered;
turn off Update memory after each answer to stop it. The bot also notes facts
as it learns them. Its memory and identity stay when you change its model.

Under Engine settings, Brain folder moves every bot's brain to a folder you
choose, a Git repository of your own for example. Each bot gets a folder named
after it.

## Projects and threads

- In its settings, Projects lists the projects it looks after. It follows
  their threads, starts new ones, steers them, answers their questions and
  tells you what matters.
- To hand one thread over, open its menu and pick Entrust to a bot. The bot
  takes the work where it stands and carries it to a verified result. Take it
  back ends it.
- Deleting a thread and approving a tool permission always stay yours.
- A bot can propose a change to its own settings on a card. Nothing changes
  until you apply it.

## Cost and control

| Setting | What it does |
| --- | --- |
| Daily budget for its own wakes, in dollars | Past it, routines and events wait until tomorrow. Your messages always run |
| Automatic project and desk wakes | Off by default: only threads it started, was entrusted or watches wake it. Other events wait for the next routine |
| Allow subagents | Lets it hand work to [subagents](subagents.md), on the models listed under Subagent models |
| Pause | No routine or event wakes it. You can still write to it |
| Pause every bot | The same for every bot on this machine |

The budget counts its subagents and workflow steps, priced at the models'
public rates. A model with no known price that reports no cost adds nothing.

## Move it to another machine

On the desktop, pick Move to a machine in its row's menu, or use the Machine
row of its settings.
Its memory, notes, routines and the end of its conversation go along; the old
conversation stays archived where it was. A bot at work moves once its turn
and the threads it started are done. Its `skills/` folder stays behind.

## Teams

Experimental: turn it on in Settings, Experiments, Teams. It needs Bots.

1. On the Bots page, press New team above the bots.
2. Give it a name, an optional brief that every member reads, and its members:
   up to 12 bots, at least one of this machine.
3. Press Create the team. Its chat opens.

In the team chat, `@name` wakes the bots you name, `@everyone` wakes them all,
and a post that names nobody wakes every member. Reply wakes the author of the
post you answer. Who reads it makes a post private to one member. Each bot
answers from its own conversation, in the group or privately to you.

- A bot's post wakes no other bot; teammates read it the next time they wake.
- A bot can propose a team, a new member or its own leaving on a card: Create
  the team, Add to the team or Remove from the team, or Refuse.
- The menu holds Edit the team, Pause, Archive and Restore. A paused team
  keeps your posts until it resumes.
- A team can take bots of the other machines of your group. The machine that
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
- Technical reference: [bots](internals/bots.md), [teams](internals/teams.md).
