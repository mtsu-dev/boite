# Machines and groups

Boite can drive several computers and servers from one window. Each machine
runs its own agents on its own files; a group links your machines and phones
so that each one reaches all the others.

## Make a group

1. On the first computer, open Settings, Devices and press Add a device on the
   Group card. A machine in no group starts one named after itself.
2. Press Copy link.
3. On the other computer, open the same page and paste the link under Join.
   That machine joins the group, with the phones added on it.

The link works once, for ten minutes, and whoever holds it joins: send it like
a password. A phone scans the QR code of the same card instead
([phone](phone.md)). Click the group's name to rename it.

A machine without a window joins from a terminal, on the account that runs
it. `join` reads the invitation on its standard input: paste it, then press
Ctrl+D.

```sh
boite-core group create Home
boite-core group invite
boite-core group join
boite-core group status
boite-core group leave
```

## Trust

Every machine of a group has full control of the others: it can invite or
remove a machine and add or remove a device. Group only machines that are
yours: a friend's computer or a shared server stays out. To work with another
person's Boite, see [contacts](contacts.md). A phone or a browser joins as a
device: it reads and drives conversations and configures nothing.

What machines say to each other is encrypted end to end. What a phone or a
browser says to a machine is as private as the network: private on Tailscale
or HTTPS, readable by anyone on a local network over plain HTTP.

## How machines reach each other

Tailscale is the expected network: each machine gives the others its tailnet
address. On one local network, machines also find each other once they listen
on it. When a device cannot reach a machine itself, it goes through another
machine of the group that can; Settings, Devices, Machines shows Connected
through and the name of that machine.

On Windows, Boite opens the local network only on private networks. The group
card says when the firewall keeps it closed, with Allow on private networks,
or when the network is public and must be marked private in Windows settings.

## Switch between machines

- Opening a conversation switches the chat, the composer and Settings to its
  machine. Nothing moves between machines.
- The machine button at the foot of the app rail, or the display menu over
  the thread list, narrows the list from All machines to one machine.
- The command palette (Ctrl+K) finds conversations, projects and machine
  names. A new conversation's project picker lists every connected machine.
- A settings page whose cards belong to one machine says This machine and its
  name under its title; with several machines connected, pick another there.
  Appearance belongs to this device, and so does each card tagged This device.
- In a browser or on a phone that reaches several machines, Main machine
  chooses where Boite opens; Last one used follows you. The desktop app
  always opens on the machine used last.

Each machine's row in the group card holds its Machine name and Machine icon.
They are saved on this device. A server can set its own name, see
[server](server.md).

## When a machine is off

Its conversations stay listed, greyed, and still open with what was last
read. A prompt you send there waits on your device and goes out once the
machine is back; then it runs with the app closed. A machine that is off does
not hold the others back: the window opens on one that answers. A machine
out of reach shows a hollow grey ring beside Offline. The machine button at
the foot of the app rail shows a monitor with a green dot while every
machine answers, with the ring while one is offline, and a crossed monitor
once none answers. Its card
also counts the machines where you must act, such as a machine that refused
this device's key, which offers Add again.

## Group roles and switches

| Setting | Where | What it does |
| --- | --- | --- |
| Settings | Group card | Every other machine follows this one's settings. A setting changed on a follower stays there with a star; click the star to follow again. |
| Mochis | Group card | Hosts new mochis and the Contacts mochi. |
| Threads from the other machines | A machine's row | Agents on other machines may start threads in this machine's projects and add its folders. Off by default. |
| Mochis from the other machines | A machine's row | A mochi of another machine may look after this machine's projects entrusted to it. Off by default. |

The settings copy runs from a window connected to both machines, while it is
open. It covers conversation options such as short answers and automatic
compaction, keybindings, Install updates by itself when nothing runs and the
brain switches. Network settings, public addresses, provider sign-ins,
automatic agent updates and the two switches above stay on each machine.

Agents of machines in a group can find and message each other
([coordination](coordination.md)).

## Remove a machine or a device

| Action | Where | Effect |
| --- | --- | --- |
| Remove from the group | A machine's or a device's row | Every machine refuses it, as each one hears of it. |
| Leave the group | This machine | This machine forgets the group; phones added on it leave too. |
| Remove machine | A machine in the list | Forgets it on this device only. Agents and files stay. |

A machine that is off learns a removal when it comes back, and until then it
still trusts the removed machine. Remove a machine you think is compromised
while the others are on, or have every machine leave and start a new group.

## Limits

- A machine belongs to one group at most, of up to 32 machines and 200
  devices.
- Clocks of two machines may differ by one minute at most.
- Every machine needs a current Boite. An older one cannot add devices.
- A group gives keys, not reach: a machine that is asleep stays listed and
  unreachable.
- A page served from outside the group needs its origin in Settings, Devices,
  Allowed browser origins on each machine.

## Going further

- [Phone](phone.md): add a phone to the group.
- [Server](server.md): a machine without the desktop app.
- [Updates](updates.md): update every machine from one window.
- [Contacts](contacts.md): work with another person's Boite.
- [Coordination](coordination.md): agents talking across machines.
- Technical reference: [machines](internals/machines.md), [groups](internals/groups.md).
