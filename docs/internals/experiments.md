# Experiments

An experiment is unfinished work behind a switch in Settings > Version > Experiments. It
exists in a Nightly or a source build and does not exist in a Release.

## Stages

Every switch has one stage, in `EXPERIMENT_STAGES`
(`packages/contracts/src/experiments.ts`) and nowhere else:

| Stage | Meaning | Ids |
| --- | --- | --- |
| `normal` | Finished. On in every build, with no switch. | `theme-grain`, `session-import`, `prompt-cache`, `resident-agents` (Bots), `recording-indicators`, `pinned-quotas` |
| `experimental` | May change or go away. A switch in a Nightly or a source build, absent from a Release. | `whip`, `contacts`, `auto-goal`, `teams`, `debates` (Council) |

A Release carries a plain version (`2.0.0`); a Nightly
(`2.0.0-nightly.20261111.1`) and a build from source (`2.0.0-beta.1`) carry a
prerelease part (`isReleaseVersion`: no `-`). An unknown version reads as a
Release, so nothing unfinished shows by accident. The same file gives the
answers both sides read: `experimentsRun(version)`, `listedExperiments(version)`
(the switches a build shows), `effectiveExperiments(chosen, version)` (what is
on: every finished feature, plus the chosen experiments where they run) and
`experimentRefusal(id, version)` (why a build has no switch for an id).

Three core settings are experiments too (`EXPERIMENTAL_SETTINGS`):
[Keep the prompt cache warm](prompt-cache.md#keeping-the-cache-warm)
(`cacheKeepalive`), [Background compaction](context.md#background-compaction)
(`backgroundCompaction`) and [Device live stream](devices.md#live-stream)
(`deviceStream`).

## Who decides

Each side decides for the build it is. No protocol field says "experiments
run": the version in the hello (`info.version`) is enough.

- The core (`client-preferences.ts`, `settings.ts`, `threads/cards.ts`)
  normalizes the experiments an app reports with `effectiveExperiments` for
  its own version, so nothing it gates runs because an app claimed it. It
  refuses a settings card for an experiment its build does not run
  (`experimentRefusal`), refuses a patch that turns an experimental setting on
  in a Release (`experimentalSettingRefusal`) and reads those settings as off
  there. `holdExperimentalSettings(settings, version)` is that reading: in a
  Release it returns the settings with `cacheKeepalive` null and
  `backgroundCompaction` and `deviceStream` false, the per-type compaction
  policies included, and leaves the saved file alone, so a machine that goes
  back to a Nightly finds its choice. A save on a Release never writes that
  reading back: `keepStoredExperimentalSettings(stored, patch, version)` drops
  the three settings from the patch and gives every per-type compaction policy
  the background choice already stored (a type customized for the first time
  takes the common stored one), so changing a compaction limit, or saving the
  values the app read, stores no "off". The copy from the group's settings
  home is the exception: `settings.follow` stores what the home holds, and
  the client that makes the copy reads both ends with
  `settings.get { stored: true }`, the settings as saved, so a Release home
  never hands a Nightly follower its own reading as a choice
  (`packages/ui/src/lib/settings-sync.ts`). The core also starts nothing new
  in Contacts on a Release (`contacts/gate.ts`, `experimentStartRefusal`):
  inviting, joining, granting, offering, asking, accepting a request or mail,
  trusting a contact, storing a Tailscale key and the Contacts bot's
  forwards are refused with the Nightly reason, while reading, refusing,
  revoking and removing what exists still answer. The same holds for what a
  Nightly left in the data directory: accepting an association, turning its
  board, compute or reviewer on, a new, edited or claimed card
  (`sharedBoard.apply`, `todos.update` on a shared card), a path override and
  a follow-up to a compute job are refused, while declining, turning off,
  removing a card, releasing a claim, cancelling a job and revoking go
  through. The Contacts bot proposes no plan (`contacts.bot.askOwner` with
  `connect` or `start`), and a Yes on a card drawn as a Nightly opens and
  starts nothing: the build is read when the owner answers and again when the
  plan runs, and the request goes back to the bot. A letter the bot held as a
  Nightly is not delivered either (`contacts.bot.flag` with `deliver: true`):
  its flag stays open, and blocking it still answers. A workflow step meets
  the same refusal, since the compute service reads the build itself.
  `packages/core/test/feature-stages.test.ts` covers it.
- The app (`packages/ui/src/lib/experiments.ts`) follows the version of its
  primary machine's core: the Store `followDesktopOf` names says it on every
  hello (`heardBuild`, from `store/events.ts` and `store/connection.svelte.ts`).
  The app keeps it in `boite.experiments.build` so a reload starts right, and
  before any hello with nothing stored it uses its own build version
  (`RELEASE_VERSION`). A second machine's core is not heard. `readExperiments()`
  and `isExperimentEnabled()` return what is in force,
  `effectiveExperiments(chosen, thatVersion)`: with empty storage the six
  finished features are on, and on a Release no experiment is, whatever
  storage holds. `setExperiment` refuses an id without a switch in that build.
  The stored choice (`boite.experiments`) is never rewritten by a version: a
  device that goes back to a Nightly finds its switches. The app still reports
  its chosen list in `client.preferences`; the core normalizes it for its own
  gates and tells phones the desktop app's list twice: in force in its build
  on the historic field, and as chosen on a separate one.
- Settings lists `listedExperiments(version)` and draws no Experiments card,
  nor the three machine cards after it, when experiments do not run (cards
  marked `experimental` in `SETTINGS_CARDS`, `cardShown` in
  `packages/ui/src/lib/settings-tabs.ts`, so the search finds none either): a
  route or a card that points at one opens the Version page from the top
  (`desktopPlace`). The three machine settings and the Automatic goals threshold
  show only while the core of the machine being configured is not a Release.
  A card about an experiment without a switch in this build can only be
  refused, and says why.
- The in-memory client (`lib/fake-client`) has a core version like the real
  one (`FakeClientOptions.version`, `?fake=1&version=2.0.0`), gives it to
  `checkSettingRequest` and `readSettings`, and gates teams, council and
  automatic goals on the list in force. It shares the core's helpers for the
  three experimental settings (the refusal, the reading as off, the stored
  values a save keeps, `settings.get { stored: true }`) and for the Contacts
  calls a Release refuses.

## Graduating an experiment

Change its line of `EXPERIMENT_STAGES` from `experimental` to `normal`. The
switch leaves the page in every build, the feature is on everywhere, and both
sides follow without another edit. Then, in the same change: drop its entry
from `lib/experiment-copy.ts` and `lib/strings/*/experiments.ts`
(`experiment-copy.test.ts` fails otherwise), name it in `graduated()` of
`lib/setting-requests.ts` so an old card keeps a readable title, and move its
guide text out of [the experiments guide](../experiments.md). The checks of a
finished id at its call sites keep passing and are deleted later; the id stays
in `EXPERIMENT_IDS` until they are. A finished feature a person would still
want off gets a switch in `lib/features.ts`, on the Settings card it belongs
to, as [chat files and previews](chat-files.md),
[open chat links](chat-files.md#open-chat-links-in-their-apps),
[preview comments](panel.md#preview-comments) and the
[pointer interactions](interactions.md) did.

## Devices and the desktop app

The client switches are off by default and belong to this device. They do not
change a core's settings. A phone has its own Experiments row in Settings.

A phone or a browser starts with the switches of the desktop app on its primary
machine, and changes when that app does. The core answers each app's report
(`client.preferences`) with the desktop app's experiments and announces their
changes (`client.desktopExperiments`); a desktop app on the machine's loopback
outranks one reached from elsewhere. Only an app on the owner's own token
counts: a paired device that calls itself a desktop app is not followed. Both
carry the list twice. The historic field (`desktop` in the answer,
`experiments` in the event) is what is in force in the core's build
(`ClientPreferencesBook.desktopExperiments`, which the core's own gates read
too): an app from before the stages takes that field for what is on, so a
Release names no experiment there. The separate field (`desktopChosen` in the
answer, `chosen` in the event) is the list as the desktop app chose it, not
cut down (`desktopChosen`): the phone keeps that one (`desktopHeard`) and
reads it with `effectiveExperiments` for the build that decides, so a machine
that spends a while on a Release does not erase the followed switches. A core
from before the separate field sends the historic one alone, and the phone
keeps it. The
core keeps them in memory, and the phone keeps the last set in
`boite.experiments.desktop`, with the id of the core that named it, so a reload
starts with it. A core that has heard no desktop app yet leaves that set in
place if it named it, and clears it if another machine did. Flipping a switch on the phone, from the page or from an agent's
card, keeps what it showed, with that flip, as its own (`boite.experiments`,
`boite.experiments.follow` set to `off`). "Same as the computer" at the top of
the phone's page follows the desktop app again. The desktop app follows no one.

## Other client switches

`EXPERIMENT_IDS` in `packages/contracts/src/experiments.ts` lists the ids;
`lib/experiment-copy.ts` supplies the labels of those with a switch.

| Switch | What it adds |
| --- | --- |
| Automatic goals (`auto-goal`) | A long prompt starts a reviewed goal and a board card, and `boite goal track` lets the agent start one; see [automatic goals](goals.md#automatic-goals). Its threshold (`autoGoalMinChars`) is an owner-only core setting shown under the switch. |

Finished, with no switch: the Grain theme (`theme-grain`, a choice in
Appearance), Claude Code [session import](imports.md) (`session-import`), the
[prompt cache](prompt-cache.md) timer (`prompt-cache`), click markers and
navigation keys in native browser recordings (`recording-indicators`, never
typed text or password input) and pinned model quotas (`pinned-quotas`, see
[placement and behavior](development.md#ui-spacing-and-motion)).

The page also has the three owner-only core settings named above, separate
from the client switches. They change execution on the machine picked in the
bar above them, which starts on the window's machine, and affect its clients;
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
bots' pictures and `+` in the app rail, the phone's Bots tab, the command
palette row and the link from a bot's own thread. Bots are finished
(`resident-agents` is `normal`): the page is there in every build, with no
switch.

## Teams

Teams of bots ([teams](teams.md)). The switch gates
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

Turning it on creates the Contacts bot
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

`ExperimentsPage.test.ts` covers the stages in the app: the five switches a
Nightly lists, the finished features on with empty storage, a Release that
turns the experiments off and drops the page while the stored choice stays,
and the machine settings hidden for a Release core. `tests/e2e/feature-stages.test.ts`
captures Settings on a Nightly and on a Release, desktop and phone.

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
