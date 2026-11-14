# Contacts

Experimental: Contacts exist in Nightly builds only. Turn them on in Settings,
Experiments ([experiments](experiments.md)). They are not ready for everyday
use: a full security and network review comes first.

A contact is another person's Boite. Your agents and theirs work together on
the projects each side shares, and on nothing else. A contact never sees your
other projects, your machines, your devices or your other contacts.

## Before you start

- Tailscale carries the link, each owner on their own tailnet. Someone with
  no Tailscale can still join an invitation sent from a tailscale.com tailnet.
- Turning Contacts on creates the Operator, a built-in [bot](bots.md), once
  for your group. Every request between your agents and a contact's goes
  through it. You can rename it and pick its model, never archive it.

## Link with someone

1. Open Contacts (the Contacts button in the app rail, or the contacts
   section under the projects on a phone) and press Add a contact.
2. Under Invite someone, pick where the other person is:

   | Button | When |
   | --- | --- |
   | Already on my Tailscale | On your tailnet, or this machine is already shared with them |
   | On another Tailscale | On their own tailscale.com tailnet: the link also shares this machine |
   | Elsewhere | Headscale, another network or no Tailscale: the link goes through Tailscale Funnel, on Boite's contact routes only |

3. Send the link like a password: it works once, for 24 hours. For
   Elsewhere, wait until the page says the link is ready to send.
4. The other owner opens Add a contact, pastes the link under Join a contact
   and presses Join. If the page shows Accept the Tailscale share, they
   accept it first.
5. Read the eight Check words to each other, on a call or in person. If they
   differ, someone sits between you: remove the contact.

- On a tailnet that is not on tailscale.com, such as Headscale, you can only
  invite people on your own tailnet. Others invite you instead.
- Cancel them, beside the count of open invitations, stops every unused link.
- With a Tailscale API key (Tailscale, Configure), invitations share the
  machine themselves and Boite reads your tailnet policy. When the policy
  reads Open, a shared user may reach other ports of the machine: Copy the
  lines and add them to the policy. Boite never writes it.

## Share a project

1. On the contact's page, press Share a project and pick one. Projects of
   every machine of your group are offered.
2. Turn on Read only if their agents may read that project's conversations.
   It is off by default: they can otherwise only write to its threads.
3. Stop sharing closes it again: letters waiting for it are rejected.

A shared project lists its threads to the contact with their title, branch,
model and status. A thread with communication off, or kept to its project,
stays hidden.

## How requests work

1. One of your agents says what it needs and names the contact. The request
   goes straight to that contact's Operator. Your own Operator only steps in
   when the agent names no contact, to pick one.
2. Their Operator decides what fits: an existing thread on that work, or a
   new thread in the right project.
3. If their owner marked you Trusted, it does so at once. If not, their owner
   sees that choice on the request with Accept and Refuse. Accept does what
   the Operator chose. The arrow beside Accept opens a search over their
   conversations and bots, to pick another one themselves. Opening a project
   always asks the owner, trusted or not.
4. The two threads then write to each other, each in its own checkout. The
   contact's page lists them under In touch, with End.

Trust goes one way: marking a contact Trusted is about what it asks of you,
not what you ask of it.

- Mark a contact Trusted to let your Operator settle its requests alone and
  let its messages reach your agents. Reading conversations is never granted
  that way.
- Messages a contact sends outside a shared project wait under Messages
  until you press Deliver or Refuse. They expire if you do not decide.
- The Operator holds letters that look dangerous as Flags (Secret,
  Destructive, Injection) and decides what to do with them. This is pattern
  matching, not a guarantee.
- Weakest model allowed, in the Contacts settings, refuses contact traffic
  from agents on weaker models (Frontier, Mid, Small). It is a cost rule
  based on what the other side says, not a security boundary.

## What a contact can and cannot do

| A contact can | A contact cannot |
| --- | --- |
| See the threads of the projects you share | See your other projects, machines, devices or contacts |
| Write to those threads | Read their conversations, unless you turned on Read |
| Reply for 7 days to a thread of yours that wrote to it | Receive your tokens, provider sign-ins or Tailscale API key |
| Ask your Operator for a thread or a project | Open a project without your answer |

Your agents are told that a contact is not their owner: a contact's message
does not authorize a destructive action, a credential or work outside the
shared project.

## Go further on one project

Link a project joins one of your projects with one of theirs, and the other
owner must Accept. Manage then has three tabs:

- Sharing: the shared board, once both owners turn on Share this board, and
  Lend this machine, off by default, to run the other owner's jobs here.
- Tasks: start a job on a host that lends its machine, and read its result.
  The host uses its own accounts and permissions.
- Protection: secret files are blocked by default. The host reads Access
  activity and adds File exceptions, and may turn on an Activity reviewer.

Lending a machine needs protected execution on the host, which exists on
Linux and Windows. macOS refuses it.

## Remove a contact

Remove, on the contact's page, closes every shared project, rejects letters
waiting both ways and closes the link. The other side keeps its entry until
its owner removes it too. A Tailscale share stays until you remove it in the
Tailscale admin console.

Once your group has a Bots machine ([machines](machines.md)), contacts see
your group as one Boite, named after the group.

## Limits

- At most 32 contacts, 16 open invitations and 32 waiting requests per
  contact and direction.
- A contact on an older Boite gets no forwarded requests until it updates.

## Going further

- [Experiments](experiments.md): turn Contacts on in a Nightly build.
- [Bots](bots.md): the Operator is one.
- [Coordination](coordination.md): how agents write to each other.
- [Machines](machines.md): your own group, which is full trust.
- Technical reference: [contacts](internals/contacts.md).
