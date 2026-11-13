# Task manager

The task manager shows what your agents cost each machine: CPU, memory, GPU,
disk and network, per agent and per machine. Next to it, Settings, Protection
keeps agents from filling the memory or stealing your screen and speakers.

## Open the task manager

1. Open Settings, Task manager. A card shows each connected machine: CPU and
   GPU over the last minute, memory with the share Boite's agents hold, and
   the free space of each fixed disk, in red when less than 10% is free.
2. Pick a machine's card to list its live processes, grouped by agent.
3. Use Find an agent to search, and Sort by usage to order them by Most
   memory, Most CPU, Most GPU, Most disk activity or Most network activity.
4. To end an agent's work, press Stop processes and confirm. Every process of
   that conversation stops.

The view updates every 2 seconds while it is on screen. On a paired phone you
can read the same numbers and open the agent's conversation, but not stop
processes. A machine with an older Boite asks you to update it.

## Read the numbers

- CPU is a share of all the machine's logical processors.
- Memory is what the processes hold now, not what they used over time.
- Not available means no measurement, not zero. A total that covers only some
  agents says so.
- Disk is reads and writes seen while the view is open. It is not folder size.
- Network is TCP traffic seen while the view is open. Brief connections and
  UDP traffic can be missed.
- An agent's GPU share is measured on Windows only.

What Boite measures for the whole machine depends on the system:

| System | Machine CPU and memory | GPU | Disks |
| --- | --- | --- | --- |
| Windows | Yes | Yes, with each agent's share | Fixed drives |
| Linux | Yes | NVIDIA and AMD cards; other cards listed without a load | Disk file systems |
| macOS | CPU, and the installed memory without how much is in use | Not measured | `/` and `/Volumes` |

## One conversation's processes

The panel's Trace surface lists the processes of the conversation on screen,
running ones first, then recent starts. Expand a row for its command, path,
process IDs, CPU time and I/O. The header says All child processes tracked on
Windows, or Limited process tracking elsewhere.

## Protect the machine

Settings, Protection holds the protections below. They are on by default.

### Peace and quiet

These apply when the agents run on Windows:

- Keep agent windows out of the foreground: a window an agent opens is sent
  behind, and Boite tries to give the focus back to the window you were in.
- Mute agent audio: sounds from agent processes are muted. A sound you muted
  yourself stays muted when Boite lets go.
- Stop what agents leave running: ten seconds after a turn, a process whose
  parent has exited is stopped.

### Keeping the machine awake

Keep this machine awake while agents work: the machine that runs the agents
does not go to sleep while a turn runs or waits in the queue, even with the
app closed. A conversation waiting for your answer does not keep it awake, and
the screen may still turn off. It is on by default; the switch sits with
Stop what agents leave running.

### Resource limits

- Protect available memory: over a limit, Boite stops the largest process
  tree an agent started, never the agent itself. Off also lifts the Windows
  memory caps.
- CPU cap, %: for all agents together. 0 means no cap. Windows only.
- Memory budget for all agents, %: from 10 to 90%. The default is 60%.
- Memory cap per conversation, MB: 0 takes half the agents' budget.
- Memory reserved for other apps, MB: 0 uses 10% of RAM, at least 3072 MB.
  Below 12288 MB of RAM it uses 25%.

When Boite stops a process, a card "Process stopped to free memory" appears
beside the tool that was interrupted, with the reason and a Memory settings
button. Only the owner changes these settings: a paired phone cannot.

## On Linux and macOS

- The memory guard works everywhere. The CPU cap, the foreground guard, the
  audio mute and Stop what agents leave running are Windows only.
- Boite tracks the processes it starts directly. A program that leaves its
  process group can keep running after its conversation stops.
- On Linux, when a system memory limit slows a conversation's processes
  instead of failing them, Boite tells you and the agent in the chat. It
  stops nothing for that.
- On macOS, an agent's memory is its processes' physical footprint, and an
  agent's CPU is not available. The machine's CPU is still shown.

## Going further

- [The right panel](panel.md): the Trace surface beside the chat.
- [Terminal](terminal.md): your own shells, kept apart from the agent's work.
- [Machines](machines.md): connect other machines and see them here.
- [Usage](usage.md): tokens, cost and subscription limits.
- Technical reference: [trace, caps and guards](internals/trace.md),
  [Linux and macOS readiness](internals/portability.md)
