# Experiments

Experiments are features that are not finished yet. They can change or
disappear, so each one has a switch in Settings, Experiments.

Seven experiments exist today: the [new thread background](#new-thread-background),
[Contacts](contacts.md), [Teams](mochis.md#teams),
[automatic goals](goals.md#automatic-goals), session import,
[background compaction](context.md) and the
[live device stream](devices.md#live-device-stream). The last six were on in
every build for a few days from 2026-11-20 and came back here on 2026-11-26:
they had not been tried enough in real use.

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
  in a Release too. A finished feature you may want off gets its own switch
  on the Settings page it belongs to.

## How the switches work

- Contacts, automatic goals, background compaction and the live device
  stream run on a machine, not in a window: their switch belongs to the
  machine picked at the top of the page, like the settings in System, and
  every window connected to it sees the same state.
- The other switches belong to the device you flip them on. They start off
  and do not change another computer or phone.
- A phone or a browser starts with the switches of the desktop app on its
  computer, and follows it when they change. Settings on a phone has its own
  Experiments row. Flipping a switch there keeps the phone's own set; Same as
  the computer, at the top, follows the desktop app again.

## New thread background

An animated scene plays behind the empty new thread screen, drawn in thin
dark lines around the heading and the message box: a wire tunnel, a tunnel of
characters, contour lines or a belt of wire crates. It follows your theme and
accent colour, and stays dim around the heading so the words remain easy to
read.

1. In Settings, Experiments, turn on New thread background.
2. In Settings, Appearance, pick it under New thread background: Off,
   Random or one of the four scenes. Random shows a different one each time
   the screen opens.

The pick belongs to the device. A device that asks for reduced motion gets a
still picture. On a device whose browser cannot draw it, the screen stays as
it was.

## Finished experiments

| Feature | Where it is now |
| --- | --- |
| Mochis, the Grain theme, the prompt cache timer, pinned model quotas, actions shown in recordings | On, with no switch |
| Whip | On, with a switch in Settings, Appearance ([first steps](first-steps.md#the-whip)) |
| Council | On ([council](council.md)) |
| Keep the prompt cache warm | Off by default, in Settings, System ([usage](usage.md)) |

## Going further

- [Updates](updates.md): Release and Nightly.
- Technical reference: [experiments](internals/experiments.md).
