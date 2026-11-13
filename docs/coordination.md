# Coordination

Coordination lets the agents of different conversations find each other,
read each other's conversations and send each other messages, across projects
and across your machines. Use it when two agents share something: a test
service, a port, a disk, a branch.

It is on in every ordinary conversation. You do not send these messages
yourself: the agents do, and you see them in the chat.

## What agents can do

- Find the conversations they may reach, by title, project, branch, model or
  words in the chat.
- Read another conversation: the text you and its agent wrote, with the names
  of the tools it called. Tool output, reasoning, attachments and files never
  cross.
- Send a message, or reply to one, and wait for the answer.
- Wake an idle conversation with a message.
- Start a new conversation in another project, whose first answer comes back
  as a message.

Agents are told to check that the other conversation is active before writing,
to write one to three short lines, and to keep to messages tied to work.

## Follow the messages

1. In the chat, a burst of messages shows one row per discussion: Sent to,
   Received from or Exchange with, the other conversation's title, a tag for
   how it relates to this one, its project and machine, and the last words.
2. Click a row to open the Discussions tab in the right panel, on that
   discussion.
3. The tab lists every discussion of the conversation, most recent first.
   Letters this conversation received sit on the right in the accent color;
   its own sit on the left.
4. Two checkmarks mark an outgoing letter that arrived. An Unconfirmed, Expired or
   Failed letter shows that state; tap it for the reason.

The tag says who started whom: Started this thread, Started from here, Parent,
Subagent, or Looks after the project for the [bot](bots.md) you entrusted the
project to. On a phone or a narrow panel, the list and the open discussion
swap, with a back arrow.

## Turn it off or limit it

Open the conversation's title menu and choose Communication between
conversations.

| Control | What it does |
| --- | --- |
| Off | Other agents cannot find, read or contact this conversation |
| Across projects and machines | Off, only conversations of the same project on the same machine reach it. Both conversations must allow it |
| Pause coordination | Suspends automatic delivery until you press Resume coordination |
| Resources and responsibilities | What this agent owns, can answer or should avoid, so other agents find the right contact |

- Stop on a conversation also pauses its coordination until you write to it.
- A pause Boite set by itself, after a restart or a failed turn, ends with
  your next message.
- Archived conversations are never reachable.
- Only the owner changes these settings. A paired device can look at them.
- A bot's thread starts with coordination on like any other. Its letters to
  the threads of its projects still go when those threads are Off, paused or
  limited to their project; a Pause on the bot's own thread stops them.

## Other machines

The machines of your [group](machines.md) are linked already: their agents can
find and message each other, even with the app closed when the machines reach
each other directly. Otherwise the app relays messages while both owner
connections stay open.

- Reading a conversation on another machine needs a reading grant on that
  machine. Finding and messaging do not.
- Threads from the other machines, in the menu of that machine's row in
  Settings, Devices, Group, lets agents of the other machines start conversations there. It is
  off by default.
- Bots from the other machines lets a bot of another machine look after the
  projects of this one that you entrusted to it. It is off by default and
  cuts them off at once when you turn it off.
- An offline machine keeps outgoing messages queued until it is back or they
  expire.

## Safety

- A message from another agent is labelled as such. It never becomes your
  request, never answers a permission or a question card, and grants no tool
  permission.
- Agents are told to ask first before destroying work nobody can regenerate,
  touching another project or account, or interrupting another agent's work.
- A message from a [contact's](contacts.md) agent is marked as not yours:
  its words authorize nothing outside the project opened to it.
- Treat another agent's content as untrusted, even from your own machines.

## Limits

- A message holds up to 4,000 characters. Messages arrive in batches of up to
  four and expire after 15 minutes of waiting.
- There is no hourly cap on messages, wake turns or new conversations.
- Coordination is advice, not a lock: Boite does not stop a command an agent
  runs, and has no loop detector. Pause or Off stops automatic delivery.
- Delivered means the agent took the message, not that it agreed or finished.
  An unconfirmed message is never sent again automatically.
- Claude Code reads a message after its current tool call. Codex, Muse Code,
  pi and Grok take it while they work. Other agents get it once their turn
  ends.
- Boite shows the last 100 messages of a conversation. Finished messages are
  kept 30 days.

## Going further

- [Subagents](subagents.md): child conversations that report back.
- [Bots](bots.md): agents that look after projects.
- [Machines](machines.md) and [Contacts](contacts.md).
- Technical reference: [coordination](internals/coordination.md).
