# Teams

A team is a few bots ([bots](bots.md)) and the owner talking in one group.
Each bot answers from its own thread, with its own identity, memory and the
live context of its work; the team only carries posts between them. A post
wakes the bots it names, and a bot answers either in the group, which every
member reads, or privately to one member or the owner.

Teams sit behind the Teams switch in Settings > Experiments
([experiments](experiments.md)). While it is off on a machine, the `teams.*`
methods and `boite team` commands on the teams that machine holds refuse with
the reason `experiment-off`, and no bot of that machine can enter a team. The
core reads the desktop app's experiments;
[across machines](#across-machines) says what each machine's switch decides.

Contracts: `packages/contracts/src/teams.ts`; core:
`packages/core/src/teams/` (store, journal tables, prompt, RPC, what goes
between machines in `peers.ts`) and `packages/core/src/team-cli.ts`.

## Model

- A member is keyed by the core it joined on and its bot id,
  `<coreId>/<botId>`, everywhere: members, post authors, recipients, cursors
  and delivery states. The owner is `owner`, which only the owner's RPC
  writes. The member's `coreId` says where the bot runs now, which differs
  from its key once it [moved](#a-member-that-moves), and `machine` that
  machine's name when it is not the one answering.
- A team has a name (up to 60 characters, unique among live teams, case
  ignored), a brief of what it is for (up to 1,000 characters), 1 to 12
  members, each with the seq it joined at, a paused and an archived flag,
  and `createdBy`: the owner, or the bot whose card the owner accepted. Every
  change bumps its `version` and emits `teams.changed`.
- The team chat is a projectless thread with `teamId` that runs no agent.
  `requireAgent` (`threads/agentless.ts`) refuses there every call that would reach a
  provider: `turns.start`, `turns.steer`, `turns.recover`,
  `threads.retitle`, `threads.compact`, `threads.rewind`, `threads.fork`,
  `threads.move`, `threads.btw`, `threads.btw.fork`, `threads.update`,
  `threads.activity.set` and `threads.goal.track`. The composer posts through
  `teams.post`.
  Each post is one finished turn there, carrying the post. It holds the
  owner's view, private posts included, so coordination never lists it: the
  directory, search and `send` leave team threads out, and a bot reaches a
  team only through `boite team`, filtered to what it may see.
- A post has an id its writer picks (a retry with the same id and content
  returns the first post, other content under that id is refused), a seq
  (the team's order, from 1), an author, 1 to 4,000 characters of text, an
  audience (`team` or `private`), its recipients `to`, the rule that picked
  them (`routedBy`), an optional `inReplyTo`, the bot turn that wrote it, and
  a notice when it woke nobody.
- A bot's post marks the team chat unread, as a finished turn does, unless a
  client has it open; the owner's own posts do not. A bot's private post to
  the owner also sends the owner a notification, `<bot>: <text>`; group posts
  do not.
- A member may read group posts and the private posts it wrote or received.
  The owner reads every post and, alone, the delivery state of each post per
  recipient: waiting, delivered, held, expired, rejected or unreachable.

## Group or private

- A group post (`boite team say`) is read by every member in its next
  delivery. `@name`, `@tous` and `@everyone` wake; the rest read it only when
  something wakes them. An owner post that names nobody wakes every member
  ([routing](#routing)).
- A private post (`boite team dm <team> <member|owner> <text>`) has one
  recipient, always wakes it, and enters no other bot's delivery. It is not
  secret from the owner: the team chat shows every post.
- The bots' guide asks for the group for what changes what a teammate does
  or knows, in one to three lines, and private for what only one reader
  needs. Long content goes by path. A group post costs every member tokens
  at its next turn, and a delivery is capped (below), so noise pushes useful
  posts out to `boite team read`.

## Routing

The first rule that applies picks who a post wakes
(`routeTeamPost`). The author is never a recipient of its own post: when
the author is the only one a rule picks, the post wakes nobody.

0. A private post goes to its one recipient.
1. `@name` (a member's live name, case ignored, ending at a non-word
   character), `@tous` or `@everyone` (every member but the author), or the
   recipients the owner's composer picked.
2. A reply goes to the author of the post it answers. The owner's reply to
   its own post names no one else and falls to rule 3.
3. Otherwise an owner post wakes every member, bots of other machines
   included, as `@tous` would (`routedBy: 'everyone'`), so a team of one bot
   wakes that bot. A bot post wakes nobody, so bots never wake each other in a
   loop, and teammates read it in their next delivery.

An owner post that names nobody costs every member a turn, as `@tous` does.
Mentions keep the owner's way to wake fewer bots, so no dispatcher picks
recipients for it.

Posts routed before keep what they recorded: `routedBy: 'single'` for an owner
post in a team of one bot, and `routedBy: 'none'` with the notice "Nobody was
pinged: name a bot with @name, or everyone with @tous." for an owner post that
named nobody, which the team chat shows as having woken nobody.

## Delivery

A post addressed to a bot puts a team letter in that bot's inbox on the
coordination transport ([coordination](coordination.md)), through
`TeamLetters.accept` (`coordination-team.ts`), never through `send`, whose 4,000-character
cap stays. The letter keeps the operation `coordination`, so a team wake has
the whole letter lifecycle: the hook, the waiter, the steer into a running
turn, the wake, recovery after a restart and settlement.

- A bot holds at most one waiting team letter per team. A later addressed
  post joins it as another trigger and moves its expiry to six hours after
  the newest trigger, so a burst of mentions takes one batch slot.
- A letter with an owner post among its triggers starts its turn as the
  owner's own message. Any other waits while the bot or all bots are paused,
  and the daily budget gates its wake as for any letter.
- A letter reaches its bot only while the team exists, is neither paused nor
  archived, and still has the bot. Unpausing sends the held letters; a
  removal, a leave or an archive rejects them with the reason.
- Rendering freezes a snapshot: the triggers, whole and oldest first, then
  the posts the bot may read above its cursor that are neither seen nor held
  by another snapshot in flight, newest back. One team letter renders at most
  16 KB in UTF-8 and a batch takes at most two team letters, the others
  waiting for the next batch. Triggers that do not fit move to a new waiting
  letter; context that does not fit is named with `boite team read` and
  counts as seen. Two teams render apart.
- The hook and the waiter mark the snapshot seen when the letter is
  delivered. A steer and a wake hold it in flight, then mark it seen once the
  provider takes it, or release it when the wake ends without that (a
  refusal, an error, a stop, a restart). A released post renders again in
  the next delivery: a post can reach a bot twice when an outcome stays
  uncertain, never zero times.
- The post is written before its letters. A recipient whose letter a
  failure or a stop left unwritten gets it when the post is retried with the
  same id, or at the next start: a delivery still `waiting` whose post no
  received or uncertain team letter of that bot carries is handed again.
  Posts older than a letter's six hours are left as they are.
- At each start, snapshots in flight whose letter nothing will settle any
  more (a steer no provider acknowledged, a wake whose turn ended) are
  released; their letter stays as it is.
- A bot's own coordination switch (mode off, no remote, paused) leaves its
  team letters and their wakes alone: the team decides who receives.
- Each member's cursor moves up across seen posts and posts it may not read,
  so a private post between two others never pins it. A new member starts at
  the seq it joined at; older posts stay readable with `boite team read`.

## Reply

A wake records a reply envelope on its turn when every team letter it took
shares one channel: one team, and either the group or private with one
author. The turn's final answer then becomes a post on that channel, with an
id derived from the turn id, so a restart or a retried publication never
posts twice. An envelope stays pending until its answer is posted or found
to have none; the next start, and the end of any later turn, post what a stop
or a failure left pending. A final answer of `[quiet]` posts nothing; that is also how two
bots end an exchange.

A batch that mixes teams or private authors, and a letter steered into a
running turn, get no envelope: the prompt names each channel and the bot
answers with `boite team say` or `boite team dm`. A turn without an envelope
never posts to a team.

## Across machines

A team may take bots of any machine of the owner's group
([groups](groups.md)), written `<machine>/<bot>`: the machine by name or core
id, the bot by name or id. One bot per machine in one team is the usual shape.

The machine that creates a team holds it for good: its posts, their order, the
team chat and the owner's methods live there. Each other machine with a member
keeps a mirror: the team's state and the posts that machine may read, without
a chat thread. Everything between them is a sealed, group-only coordination
request (`team.*`, [coordination](coordination.md)), on the addresses
the group already keeps, so `network.groups` governs it
([network flows](network.md)).

**Delivery.** The holder sends each member's machine the team's state and new
posts (`team.sync`), from a per-machine mark that moves only once a batch was
taken. A private post goes only to its recipient's machine, not even back to
its author's. On the mirror a post becomes the same team letter a local bot
gets, through the same code, so its wake, budget, cap and cursor rules are the
ones under [Delivery](#delivery). The letter's outcome comes back
(`team.report`) and fills the holder's delivery state.

**Replies.** From a bot's thread on a member's machine, `boite team say`, `dm`
and `read` ask the holder (`team.post`, `team.read`), and `leave` draws its
card there. A turn born of a letter posts its final answer through the same
request. The agent token names only its own thread, as everywhere.

**Who may speak.** The holder takes a post only as a member running on the
machine asking, by that machine's group identity: the post's author is found in
the team from that identity and the bot id, never from what the request says.
A machine cannot post as another machine's bot, read for one, say one moved or
remove one. A machine out of the group is answered as an unknown peer. Only the
holder's `team.sync` changes a mirror.

**A machine that is away.** Posts wait for it. Their delivery reads
`unreachable` while it does not answer, and the holder retries after 5, 15 and
60 seconds, then every 5 minutes, and at once when that machine speaks in the
group again. Post and letter ids stay the same, so a machine that took a batch
without the holder hearing takes it again and wakes nobody twice. A post that
waited more than 7 days still arrives and stays readable, but wakes nobody; its
delivery reads `expired`.

**A holder that is away.** A bot's `say` or `dm` refuses with the reason
`unreachable`, and says the holder did not answer, that nothing is lost and
which `--request-id` to send again with; the same id posts once even if the
first try got through. `read`, and a card's Apply, say the holder did not
answer. A final answer waits in the member machine's durable outbox and posts
once, under the id derived from its turn. Outbox rows older than 30 days are
dropped at the next start.

**The switch.** Methods are filtered on the machine holding the team:

- While the holder's switch is off, `say`, `dm`, `read` and the owner's changes
  refuse, with the holder's name when they came from another machine. Final
  answers of turns under way, letters already flowing, reports and moves
  continue, as for a local bot.
- A machine's own switch decides whether its bots enter a team: while it is
  off, naming one of its bots (`team.bot`) refuses with
  `<machine>: teams need the Teams experiment…`, and the team is not created or
  the bot not added.
- A machine that turns its switch off after its bot joined keeps that member.
  Its letters still arrive, and its bot's commands on a team held elsewhere
  still go to the holder, whose switch decides. To take a bot out, remove it
  from the team.

**Versions.** Every machine of a team needs a version with this feature. An
older machine answers that it does not know the operation, and the command says
`Boite on <machine> is too old for teams across machines; update it first`.
Posts owed to it wait until it is updated.

### A member that moves

A member can move to another machine of the group ([bots](bots.md)), of a live
team or an archived one. Its key stays what it was, so posts, recipients, the
fingerprints of retried posts and the card of a proposal keep meaning the same
bot; its `coreId` and `machine` change, and the same `@name` still reaches it.
Rewriting the key would rewrite every post it wrote.

The machine it leaves tells the holder (`team.moved`, durable until it is
heard). Only that machine is believed for its bot. The holder sends the new
machine the team's state and the posts still waiting for the bot, which wake it
there. Posts it already read on the old machine stay read through
`boite team read`; a post that waited more than 7 days ends `expired`. If the
bot lands on the holder, it is a local member again.

Until the holder answers, the bot is on its new machine without its teams: its
`boite team` commands name no team there, and it joins them when the holder
returns. A bot on its way joins no team, because neither machine would answer
for it.

An archived team may still hold a member that moved away before teams followed
moves. When the owner restores that team, the member follows its bot to the
machine the move's receipt names. If no receipt says where the bot went, the
member leaves the team and the restore goes through.

## The owner

Owner methods: `teams.create`, `teams.update`, `teams.archive`,
`teams.members.add`, `teams.members.remove`, `teams.pause`, `teams.post` and
`teams.list` and `teams.read` without a thread. They see the teams this machine
holds; a team held elsewhere is managed on that machine's app. Members are
named by bot id, name or `<machine>/<bot>`. `teams.create`,
`teams.members.add` and `teams.members.remove` take the `card` of a bot's
proposal, which applies it and settles the card; without one, they are the
owner's own: the Bots page's New team and the team chat's menu call them
([In the app](#in-the-app)). A card a bot drew on a member's machine for a team
held elsewhere is applied on that machine, which asks the holder (`team.owner`).
The holder takes this only from a machine with a bot in the team. That machine
may add any bot of the group the card names, whose own machine still answers for
it (`team.bot`), and may take out only a bot of its own.

The app draws a bot's card (`boite team propose`, `invite` or `leave`) in
the dock above the bot's composer, with the core's only option, Refuse, and
an Apply button: Create the team, Add to the team or Remove from the team.
Apply calls the matching method with the card, so the members are the bot ids
the card stored. The settled card stays in the conversation as one row: team
created, member added, member removed or refused. Creating a team and changing
its members stay on the computer running Boite: a paired phone shows the card
and Refuse, and says so. A card left unanswered survives a restart of the core
and an update of the app.

### In the app

Teams needs Bots: its switch stays greyed while Bots is off, and turning Bots
off turns Teams off too. With the experiment on, a Teams section heads the
Bots page's list, above the bots, on the desktop and on the phone
(`components/agents/AgentsRail.svelte`). The heading stays while there is no
team yet, with one line under it, "No team yet: put a few bots in one chat.",
and beside it the New team button; a search shows the section only over the
teams it finds. Each team that is not archived is a
row in the style of a bot's: its members' pictures, its name, who is in it,
the time of its last post and the unread mark of its chat, the team with the
latest post first. The page's search filters the teams by name, as it filters
the bots. A row opens the team chat in the page's main pane
(`components/agents/AgentsPage.svelte`); on a phone the chat takes the screen
and its back arrow returns to the list. The chat is no thread row of the
Conversations lists, because the core refuses an agent's composer there, and
a thread with `teamId` opens on the Bots page.

New team opens a dialog (`components/teams/TeamDialog.svelte`, the checks
and calls in `lib/team-draft.ts`): a name, an optional brief, and the members,
picked among the bots of the page's machine and of the other machines of its
group this app reaches, each a row with its picture and, on another machine,
that machine's name. A bot of a machine outside the group, and a bot moving or
waiting to move, is listed greyed
with an "i" that says why, and a tap on it says the same under the list. The
dialog asks for a name, refuses one that starts with `@`, says a taken name as
it is typed, and asks for at least one bot of this machine, up to 12 in all: the
core's own checks, which still answer for themselves, so a machine that has the
experiment off or does not answer shows its refusal in the dialog. Create, or
Enter in the name, calls
`teams.create` on the page's machine without a card, so `createdBy` is the
owner, then opens the new team's chat. Escape, Cancel or the scrim close it,
and its exit animates.

The team chat (`components/teams/TeamChat.svelte`) replaces the conversation
view of a thread with `teamId`. The header (`components/teams/TeamHeader.svelte`)
shows the team's pictures, its name and "Team chat · N bots and you", or
Paused or Archived, without terminal or panel. Its menu holds Edit the team,
Pause or Resume, and Archive, which asks first; an archived team's menu holds
Edit the team and Restore. Edit opens the same dialog on the team: its name and
brief go through `teams.update`, then each bot taken out through
`teams.members.remove`, then each new one through `teams.members.add`, worked
out against the team `teams.list` returns at that moment; a refusal stops
there, shows the core's reason in the dialog, and what went before it stays
done, so Save again sends only what is still missing. A member this machine no
longer lists stays in the dialog, greyed, so it can be taken out; a member of
another machine stays with that machine's name, even when this app does not
reach that machine. An edit may leave a team with no member, a new team needs
one. An archived team takes no new member. Restoring it does not wait on a
member that moved, which follows its bot, and a bot that is gone leaves as the
team comes back.
Over the posts, the members; a member opens its bot's page. A member of another
machine shows that machine's name beside its own and opens nothing, its page
being on that machine. The posts are the
thread's messages, oldest first, paged like a thread's, so they arrive live and
opening the chat marks it read. Each post shows:

- its author: the bot's name, or You for the owner, and the machine of a bot
  of another machine;
- its time; posts of one author a few minutes apart read as one;
- "Private to …" and the recipient, on a private post;
- the post it answers, which scrolls to that post;
- whom it woke. An owner post routed before one naming nobody woke every
  member, which woke nobody, says so in the app's language rather than the
  core's English notice.

The composer (`components/teams/TeamComposer.svelte`) posts with `teams.post`
and says, before the post goes, whom it wakes, from the same rule the core
applies (`routeTeamPost`): the whole team when the post names nobody, the bots
it names with `@name`, which the mention menu writes at the caret, everyone
with `@tous` or `@everyone`, or a reply's author. The audience menu makes the post
private to one member, which wakes that member only. Both menus show a member's
machine when it is another one. Reply on a post answers
it. A post keeps its id until it lands, so a retry after a lost answer returns
the same post. A paused team still takes posts and says they wait; an archived
team keeps its chat readable and takes none. With the experiment off, or a
core that does not answer for the team, a note stands in the composer's place.

A paired phone lists the teams and posts as the owner (`teams.list`,
`teams.post` and the `teams.changed` event in `DEVICE_METHODS` and
`DEVICE_EVENTS`); the core still gates both on the desktop's experiment.
Creating, changing, pausing and archiving a team are not device methods: the
phone shows New team greyed, whose tap says "Only the computer running Boite
can create or change teams.", and the chat's menu with every item greyed and
the same reason.

## Commands

A bot posts, reads and proposes from its own thread; an agent token may only
name its own thread.

```sh
boite team list
boite team say <team> <text> [--reply <post-id>] [--request-id <id>]
boite team dm <team> <member|owner> <text> [--request-id <id>]
boite team read <team> [--before <seq>] [--limit <n>]
boite team propose --name <name> --members <bot,machine/bot> [--brief <text>]
boite team invite <team> <bot|machine/bot>
boite team leave <team>
```

`say` and `dm` print the post's seq and id and whom it wakes. `read` prints
the posts the bot may see, oldest first, and the command for the older page.
`propose`, `invite` and `leave` draw a card in the bot's thread and return at
once; the owner's choice arrives as a message, and without one nothing
changed. A team is named by id or name. A bot of another machine of the group
is written `<machine>/<bot>`, the machine by name or core id; quote the value
when a name has a space (`--members "Firebat/Scout,Pc portable/Atlas"`). `list`
shows a member of another machine as `name (machine)`.

The commands work from any machine with a member of the team; the machine that
created it answers them ([across machines](#across-machines)). When it does not
answer, the refusal says so: send the same command with the same
`--request-id` to post once.

The bots' guide gains three lines while the experiment is on: answer
`[quiet]` when nothing needs saying, group or private, and when to propose,
invite or leave.

## Limits

- A team stays on the machine that created it, and that machine needs a bot of
  its own in the team when it creates it: the team chat takes that bot's
  settings.
- A machine leaving the group leaves its members in its teams, with their
  posts `unreachable`, until the owner removes them. A team whose holder left
  the group refuses its commands on the members' machines, saying so.
- The switch lives in memory: a core no app has spoken to since it started
  (a headless machine, a restart) reads as off, so until an app connects it
  lets no bot of its own enter a team and refuses what is asked of the teams it
  holds.
- A member of another machine has no page here: its row opens nothing.
- `@name` wakes every member of that name, so two bots of one name on two
  machines wake together.
- An owner post that names nobody wakes every member: to wake fewer, name them.
- Posts carry no attachments; long content goes by path.
- Two bots that answer each other stop only when one answers `[quiet]`; the
  daily budget is the other bound.
- The experiment gates the methods and the commands, not delivery: letters
  already in an inbox still go out after the switch is turned off.
- Private keeps a post out of the other members' letters and
  `boite team read`. It is not secret from a bot allowed to read the
  recipient's own conversation (`collaboration.read`), which shows what that
  bot received, like a message the owner sends it directly. The team chat
  itself stays out of coordination.
- The app does not show where each post stands per recipient (`deliveries`
  of `teams.read`); the contracts and the in-memory client carry it.
