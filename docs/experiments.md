# Experiments

Experiments are features that are not finished yet. They can change or
disappear, so each one has a switch in Settings, Experiments.

## How the switches work

- Most switches belong to the device you flip them on. They start off and do
  not change another computer or phone.
- A phone or a browser starts with the switches of the desktop app on its
  computer, and follows it when they change. Settings, This phone has its own
  Experiments row. Flipping a switch there keeps the phone's own set; Same as
  the computer, at the top, follows the desktop app again.
- Three settings at the bottom of the page belong to a machine, not to the
  device. They change how that machine runs its conversations, for every
  device connected to it. Pick the machine in the bar above them. Only the
  owner sees them.
- When an experiment is finished, it leaves this page and its switch moves to
  the Settings page it belongs to.

## Current experiments

| Experiment | What it adds | Belongs to |
| --- | --- | --- |
| Grain theme | A grainy Grain theme in Settings, Appearance | This device |
| Claude Code session import | Turn a session started in the terminal into a thread, from the project menu and the palette | This device |
| Prompt cache timer | A clock beside the context meter counting down how long the provider keeps the conversation cached | This device |
| Bots | Persistent agents with their own brain, memory and routines, from the app rail | This device |
| Whip | An animated whip that follows your pointer or finger; flick to crack it, click or tap to drop it | This device |
| Show actions in recordings | Click markers and navigation keys in browser recordings, never typed text or passwords | This device |
| Contacts | Link your Boite with another owner's through Tailscale; needs Bots | This device |
| Pinned model quotas | The current provider's limits pinned in a corner of the conversation or below the thread list | This device |
| Automatic goals | A long prompt starts a reviewed goal with its checklist and a board card | This device |
| Teams | Bots that work together in a shared chat; needs Bots | The desktop app |
| Council | Several AIs review a piece of work or a plan, each alone and read-only | The desktop app |
| Keep the prompt cache warm | Short pings that keep the provider's cache while a conversation waits on its agents | The machine |
| Background compaction | A copy of the session compacts at 85% of the token limit while you keep working | The machine |
| Live device stream | The Device panel plays a plugged-in Android phone as live video | The machine |

## Notes on some experiments

- Bots: turning the switch off hides the Bots page only. Bots you already made
  keep their threads and routines and keep running.
- Teams and Contacts need Bots: their switches stay greyed while Bots is off,
  and turning Bots off turns them off too. Turning Contacts on creates the
  Operator, the built-in bot that carries every request.
- Teams and Council are also read by the machine, from its desktop app's
  switches, and a phone follows the desktop app for them. Turning Council off
  does not stop a review under way.
- Automatic goals has a Prompt length setting under its switch: a prompt that
  starts a turn with at least that many characters starts a goal.
- Grain theme: turning it off uses the system theme and keeps your saved
  choice.
- Whip: with reduced motion turned on in your system settings, the whip is
  greyed and does nothing.
- Each keep-warm ping and each compaction counts as usage. Background
  compaction works with Claude and Codex.

## Going further

- [Bots](bots.md), [contacts](contacts.md) and [council](council.md): the
  larger experiments.
- [Goals](goals.md): reviewed goals and automatic goals.
- [Context](context.md): compaction and the prompt cache.
- [Devices](devices.md): the Device panel.
- Technical reference: [experiments](internals/experiments.md).
