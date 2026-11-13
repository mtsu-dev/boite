# Experiments

Experiments are features that are not finished yet. They can change or
disappear, so each one has a switch in Settings, Experiments.

## Where they exist

Experiments exist in Nightly builds only. A Release has no Experiments page
and runs none of them, whatever was switched on before.

A few are still being built and exist only in Boite Dev, the build made from
the source code. There, each switch says whether it is in Nightly too or in
Dev only.

- To try them, switch the machine to Nightly: in Settings, Machines and
  updates, change the Release channel to Nightly
  ([updates](updates.md#switch-between-release-and-nightly)). Nightly may
  contain unfinished changes.
- Going back to Release turns every experiment off. Your switches are kept:
  they are as you left them the next time the machine runs a Nightly.
- The machine your window is connected to decides. A phone or a browser
  paired with a machine on a Release has no Experiments page either.
- When an experiment is finished, it leaves this page and is on for everyone,
  in a Release too. Bots, the Grain theme, Claude Code session import, the
  prompt cache timer, pinned model quotas and actions shown in recordings
  were experiments once: they need no switch any more.

## How the switches work

- Most switches belong to the device you flip them on. They start off and do
  not change another computer or phone.
- A phone or a browser starts with the switches of the desktop app on its
  computer, and follows it when they change. Settings on a phone has its own
  Experiments row. Flipping a switch there keeps the phone's own set; Same as
  the computer, at the top, follows the desktop app again.
- Three settings at the bottom of the page belong to a machine, not to the
  device. They change how that machine runs its conversations, for every
  device connected to it. Pick the machine in the bar above them. Only the
  owner sees them, and only for a machine that runs a Nightly.

## Current experiments

| Experiment | What it adds | Belongs to |
| --- | --- | --- |
| Whip | An animated whip that follows your pointer or finger; flick to crack it, click or tap to drop it | This device |
| Contacts | Link your Boite with another owner's through Tailscale | This device |
| Automatic goals | A long prompt starts a reviewed goal with its checklist and a board card | This device |
| Teams | Bots that work together in a shared chat | The desktop app |
| Council | Several AIs review a piece of work or a plan, each alone and read-only | The desktop app |
| Keep the prompt cache warm | Short pings that keep the provider's cache while a conversation waits on its agents | The machine |
| Background compaction | A copy of the session compacts at 85% of the token limit while you keep working | The machine |
| Live device stream | The Device panel plays a plugged-in Android phone as live video | The machine |

## Notes on some experiments

- Turning Contacts on creates the Operator, the built-in bot that carries
  every request.
- Teams and Council are also read by the machine, from its desktop app's
  switches, and a phone follows the desktop app for them. Turning Council off
  does not stop a review under way.
- Automatic goals has a Prompt length setting under its switch: a prompt that
  starts a turn with at least that many characters starts a goal.
- Whip: with reduced motion turned on in your system settings, the whip is
  greyed and does nothing.
- Each keep-warm ping and each compaction counts as usage. Background
  compaction works with Claude and Codex.

## Going further

- [Updates](updates.md): Release and Nightly.
- [Contacts](contacts.md) and [council](council.md): the larger experiments.
- [Bots](bots.md): teams.
- [Goals](goals.md): reviewed goals and automatic goals.
- [Context](context.md): compaction and the prompt cache.
- [Devices](devices.md): the Device panel.
- Technical reference: [experiments](internals/experiments.md).
