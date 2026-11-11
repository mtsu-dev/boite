# Experiments

Enable these separately in Settings > Experiments. The client switches are
off by default and belong to this device. They do not change a core's settings.
A phone has its own Experiments row under Settings, This phone.

A phone or a browser starts with the switches of the desktop app on its primary
machine, and changes when that app does. The core answers each app's report
(`client.preferences`) with the desktop app's experiments and announces their
changes (`client.desktopExperiments`); a desktop app on the machine's loopback
outranks one reached from elsewhere. Only an app on the owner's own token
counts: a paired device that calls itself a desktop app is not followed. The
core keeps them in memory, and the phone keeps the last set in
`boite.experiments.desktop`, with the id of the core that named it, so a reload
starts with it. A core that has heard no desktop app yet leaves that set in
place if it named it, and clears it if another machine did. Flipping a switch on the phone, from the page or from an agent's
card, keeps what it showed, with that flip, as its own (`boite.experiments`,
`boite.experiments.follow` set to `off`). "Same as the computer" at the top of
the phone's page follows the desktop app again. The desktop app follows no one.

A finished experiment leaves this page and its switch moves to the Settings
page it belongs to, on by default unless it changes what a familiar click does, as [chat files and previews](chat-files.md),
[open chat links](chat-files.md#open-chat-links-in-their-apps),
[preview comments](panel.md#preview-comments), the
[pointer interactions](interactions.md) did; [reviewed goals](goals.md) left with no switch. The agent's browser needs no switch: it runs on the machine of the
conversation ([the agent's browser](browser.md)).

## Other client switches

`EXPERIMENT_IDS` in `packages/contracts/src/setting-requests.ts` lists the
client switches; `lib/experiment-copy.ts` supplies their labels.

| Switch | What it adds |
| --- | --- |
| Grain theme (`theme-grain`) | A grain theme choice in Appearance. Disabling the experiment uses the system theme while preserving the saved choice. |
| Claude Code session import (`session-import`) | Import a terminal conversation from the project menu or palette; see [session import](imports.md). |
| Prompt cache timer (`prompt-cache`) | An idle-thread countdown based on reported writes or documented estimates; see [prompt cache](prompt-cache.md). |
| Show actions in recordings (`recording-indicators`) | Click markers and navigation keys in native browser recordings. Typed text and password input are not shown as key labels. |
| Automatic goals (`auto-goal`) | A long prompt starts a reviewed goal and a board card, and `boite goal track` lets the agent start one; see [automatic goals](goals.md#automatic-goals). Its threshold (`autoGoalMinChars`) is an owner-only core setting shown under the switch. |
| Pinned model quotas (`pinned-quotas`) | Pin the current model provider's limits in a conversation corner or below the thread list; see [placement and behavior](development.md#ui-spacing-and-motion). |

The page also has three owner-only core settings, separate from those client
switches: [Keep the prompt cache warm](prompt-cache.md#keeping-the-cache-warm)
(`cacheKeepalive`), [Background compaction](context.md#background-compaction)
(`backgroundCompaction`) and [Device live stream](devices.md#live-stream)
(`deviceStream`). They change execution on the machine picked in the bar
above them, which starts on the window's machine, and affect its clients;
none follows the desktop's experiment preferences. A thread takes the switch
of the machine it runs on: flipped for the desktop's own core, background
compaction does nothing for a thread on a server.

## Whip

A small Whip icon sits beside the other controls at the foot of the app rail
and in the phone navigation. Throw it to pick up the animated rope from Boite Legacy:
it follows the pointer, cracks on a fast flick, and falls off screen on a click.
On a phone, drag the rope with a finger and release to drop it. Escape also drops it.
The rail's control remains available to drop or rethrow while the previous rope falls.
After release, Escape resumes its usual app action.
The opening arc uses unstretched links and fits the available side of the screen.
The physics and canvas load only when the experiment is enabled; the animation
loop and audio context close when it is turned off.

A crack plays one of six recorded cracks from Boite Legacy's sprite, with a
synthesized burst as the fallback, and shakes the native Boite window before
returning it to its original position. Throwing the rope does neither. Maximized and fullscreen windows, browsers, phones and window managers
that ignore positioning shake the interface instead. Hits do not overlap.
Reduced motion stops any visible rope and greys the control (`aria-disabled`):
a click does nothing, and its tooltip says animations are off in the system
settings, with the Windows path. It comes back as soon as the setting changes.


## Bots

The Bots page ([bots](bots.md)) and every button that leads there: the
bots' pictures and `+` in the app rail, the phone's Bots tab, the command palette row and the link from a bot's
own thread. Turning
the switch off closes the page if it is open. It hides the page only: bots
already made keep their threads and routines on the core, which knows nothing
of a client's experiments.

## Teams

Teams of bots ([teams](teams.md)). Teams needs Bots: its switch stays greyed
while Bots is off, and turning Bots off turns Teams off too. The switch gates
the `teams.*` methods and `boite team` commands on the teams a machine holds,
on the core, which reads the desktop app's experiments, and the team lines of
the bots' guide. A machine with its switch off lets no bot of its own enter a
team; a bot already in a team another machine holds stays in it, and that
machine's switch decides ([teams](teams.md#across-machines)). Letters
already in a bot's inbox still go out once it is off. In the app it shows the
Teams section above the bots on the Bots page, on the desktop and on the
phone, and the team chats there ([teams](teams.md#in-the-app)); a phone
follows the desktop's switch.

## Council

Several AIs review one request ([council](council.md)). The id is still
`debates`, the name it had before the council, so a switch that was on stays on.
It gates every `council.*` method and `boite delegate council` on the core,
which reads the desktop app's experiments and refuses them with
`experiment-off`, and the council line of the subagent guide and the
`boite-council` skill. In the app it draws the card in the thread that started
a council and the salon, in the right panel on a desktop and full screen on a
phone; a phone follows the desktop's switch. Turning it off does not stop a
round under way: its answers still come back.

## Contacts

Contacts needs Bots: its switch stays greyed while Bots is off, and turning
Bots off turns Contacts off too. Turning it on creates the Contacts bot
([contacts](contacts.md#the-contacts-bot)) on the window's machine and on
every connected owner machine with a contact, once; turning it off leaves the
bot on the core, like any bot. A paired phone only flips its own switch.

The contacts column and the Contacts page ([contacts](contacts.md)). On a
desktop window the contacts stand in a column on the right edge, the thread
list keeping the left one: one row per contact with its link and what it asks.
Its title, with a house, opens the Contacts page with no contact picked, and
Add beside it the same page. A row opens that contact's page in the chat's
card, between the two lists. The column starts folded: the Contacts button in
the app rail unfolds and folds it, remembered on the device,
and shows a dot while a folded column hides a request. It slides in when
unfolded, not when the app starts or another machine is picked. The right panel leaves the column its width. A phone
has no right edge: its list shows the contacts as a section under the
projects, and the Contacts tab in the bottom navigation opens the page with no contact picked.

A contact's page shows what it asks, the projects each side shares with the
other with their read switch, then trust, the eight check words and Remove. With
no contact picked, the page lists the requests waiting for an answer, with
Accept on a picked project and Refuse with a reason; decided ones fold under a
count that says who decided. Invite makes a one-use link, copies it and says
whether Tailscale shared the machine or why it could not; Join takes a pasted
link and shows the eight words to compare. The Tailscale row says the policy
state; Configure unfolds the API key (stored or cleared, never shown back), the
policy lines to paste when it is open, and the weakest model tier a contact's
request may run on.

In a thread, a letter the core labelled with a contact shows that contact's
name in a dashed "remote" chip beside the sender. The chip is drawn whatever
the switch says: the label comes from the core. Turning the switch off closes
the Contacts page if it is open; contacts, grants and requests stay on the core.

## Verification

`whip.test.ts` covers the toggle, persistence, desktop and phone layout, drop and rethrow, whole
interface movement, rope drawing and release, cancellation and reduced motion. `shell.test.ts` verifies
native window movement and restoration, and refusal from a browser child webview.

The opt-in `codex.live.test.ts` attachment case asks a real Codex process to
discover file publication through `boite --help`. It checks the inherited CLI,
delivery during the active turn, and unchanged bytes after deleting the source.
It requires `BOITE_E2E_CODEX=1` and uses the default Codex login.

`fake-client.contacts.test.ts` covers the in-memory core's contacts: the seed,
the `contacts.updated` event after each change, the refusals with their field,
the invitation's share with and without a key, and `collaboration.ask`.
`HomePage.test.ts` renames, trusts and opens a project for reading on the seeded
contact, accepts a request through the menu, refuses one only with a reason,
removes the contact behind the confirm, creates and joins an invitation, clears
the key and moves the tier. `AgentDiscussion.svelte.test.ts` checks the remote chip.
