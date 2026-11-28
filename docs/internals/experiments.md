# Experiments

An experiment is unfinished work behind a switch in Settings > Experiments.
Every feature has a tag, `release`, `nightly` or `dev`, and exists only in the
builds at or above it: a Release has none of the unfinished ones.

Seven experiments exist today, all tagged `nightly`: a Nightly and a Dev
build list their switches, a Release has no Experiments page. They are the
[new thread background](#new-thread-background) (`draft-backdrop`) and six
features released on 2026-11-20 (#1176) before they had run in real use and
tagged `nightly` again on 2026-11-26: `contacts`, `teams`, `auto-goal`,
`session-import`, `background-compaction` and `device-stream`.

## Tags

Every feature has one tag, in `EXPERIMENT_STAGES`
(`packages/contracts/src/experiments.ts`) and nowhere else:

| Tag | Meaning | Ids |
| --- | --- | --- |
| `release` | Finished. On in every build, with no switch on the Experiments page. | `resident-agents` (Mochis) |
| `nightly` | May change or go away. A switch in a Nightly and in a Dev build, absent from a Release. | `draft-backdrop` (New thread background), `contacts`, `teams`, `auto-goal`, `session-import`, `background-compaction`, `device-stream` |
| `dev` | Being built. A switch in a Dev build only, absent from a Nightly and from a Release. | none today |

The six finished ids `theme-grain`, `prompt-cache`, `recording-indicators`,
`pinned-quotas`, `whip` and `debates` (Council) left the list once nothing
read them (`FINISHED_EXPERIMENT_IDS`). An
older app may still report them in `client.preferences`, a device may still
hold them in `boite.experiments`, and an older core may still send them in
`client.desktopExperiments`: each side drops an id it does not know, and
`checkClientPreferences` accepts a list of up to 32 ids, so such a report is
not refused.

A build has a kind, read from its version by one function, `buildKindOf`:

| Kind | Version | Built by |
| --- | --- | --- |
| Release | plain: `2.0.0` | the release workflow |
| Nightly | `2.0.0-nightly.YYYYMMDD.N` | the nightly workflow, which stamps it (`scripts/ci/nightly-build.ts`) |
| Dev | any other prerelease: `2.0.0-beta.1`, `2.0.0-test.0` | a build from source: `bun run dev:core`, `bun run build:shell:dev` (the app "Boite Dev"), a test core |

An unknown version reads as a Release, so nothing unfinished shows by
accident. A feature exists in a build whose kind is at or above its tag
(`stageRuns`): a Dev build has everything, a Nightly the `release` and
`nightly` features, a Release the `release` ones.

| | Release build | Nightly build | Dev build |
| --- | --- | --- | --- |
| `release` feature | on | on | on |
| `nightly` feature | absent | switch | switch |
| `dev` feature | absent | absent | switch |

So a feature merged with the `dev` tag reaches no Nightly and no Release, and
one tagged `nightly` reaches no Release. The same file gives the answers both
sides read: `featureRuns(id, version)`, `listedExperiments(version)` (the
switches a build shows), `effectiveExperiments(chosen, version)` (what is on:
every finished feature, plus the chosen ones whose tag the build reaches) and
`experimentRefusal(id, version)` (why a build has no switch for an id). The
refusal names the builds that have it and this one: "experiment.<id> runs in
Nightly and Dev builds only, and this machine runs a Release (2.0.0)". A
stored choice for a feature the build lacks is ignored and kept.
`experimentsRun(version)` and `isReleaseVersion(version)` remain for the
places that ask about the nightly tag as a whole.

In a Dev build the Experiments page lists the features of two tags, so each
switch shows its own beside its name ("Nightly", "Dev only"), on the desktop
and on a phone. A Nightly lists one tag and shows none.

## Setting experiments

Four experiments are switched by a machine setting the core stores, not by
the list an app reports (`EXPERIMENT_SETTINGS`): `contacts` by `contacts`,
`auto-goal` by `autoGoals`, `background-compaction` by
`backgroundCompaction` and `device-stream` by `deviceStream`. The core reads
them itself, so a restart or an app that has not connected yet changes
nothing. In a build below their tag:

- `SettingsStore.get()` reads each as `false`, and the per-type
  `backgroundCompaction` of `compactionByType` too
  (`holdExperimentalSettings`); the stored value is kept, so a machine that
  goes back to a Nightly finds it again. `settings.get` with `stored: true`
  and the settings home's copy read it as saved (`unheld()`).
- `settings.set` and a settings card refuse to turn one on, naming the builds
  that have it (`experimentalSettingRefusal`); a save that hands back the
  held `false` leaves the stored value alone
  (`keepStoredExperimentalSettings`). The fake client does the same
  (`settingsInForce`).

The Experiments page shows them beside the app's switches and writes the
setting on the machine picked above the page, as System does. `teams`,
`session-import` and `draft-backdrop` stay an app's choice; the core gates
its side of `teams` and `session-import` on its own version (`featureRuns`),
whatever an app reports.

[Keep the prompt cache warm](prompt-cache.md#keeping-the-cache-warm)
(`cacheKeepalive`) stays an ordinary owner setting, off by default, in
Settings > System.

## Who decides

Each side decides for the build it is. No protocol field says "experiments
run": the version in the hello (`info.version`) is enough.

- `client-preferences.ts` normalizes the experiments an app reports with
  `effectiveExperiments` for the core's version. `threads/cards.ts` uses
  `checkSettingRequest` to refuse change cards for experiments unavailable
  in that build. The core runs the Council in every build. Teams and session
  import follow the core's version, and the four setting experiments read
  the machine settings in force. These gates work before any app reports.
- The app (`packages/ui/src/lib/experiments.ts`) follows the version of its
  primary machine's core: the Store `followDesktopOf` names says it on every
  hello (`heardBuild`, from `store/events.ts` and `store/connection.svelte.ts`).
  The app keeps it in `boite.experiments.build` so a reload starts right, and
  before any hello with nothing stored it uses its own build version
  (`RELEASE_VERSION`). That version controls the list of switches.
  `readExperiments()` and `isExperimentEnabled()` use
  `effectiveExperiments` applied to the app's choices and the primary core's
  settings in force. Every finished feature is on. `setExperiment` changes
  app switches listed in that build. A version change leaves the stored
  choices (`boite.experiments`) intact. The app reports its chosen app switches
  in `client.preferences`. The core tells phones the desktop app's list twice:
  in force in its build on the historic field, and as chosen on a separate one.
- Settings has an Experiments page only where the build runs experiments and
  lists at least one switch (`experimentsAvailable`, read by `pageAvailable`
  in `lib/settings-tabs.ts`, the desktop nav, search and the phone list): a
  route or a card that points there lands on Home, the page Settings opens
  on. A Release lists none, so the page is gone there. A card about
  an experiment without a switch in this build can only be refused, and says
  why; a card about a finished one says it is no longer an experiment.
- The in-memory client (`lib/fake-client`) has a core version like the real
  one (`FakeClientOptions.version`, `?fake=1&version=2.0.0`). It gives the
  version to `checkSettingRequest`, uses `settingsInForce` for effective
  settings and applies the build gate to new team work and imports.

## Tagging and promoting a feature

A new feature gets an id in `EXPERIMENT_IDS` and a line in
`EXPERIMENT_STAGES`: `dev` while it is being built, so that merging it shows
it to nobody outside a build from source. Add its title and hint in
`lib/strings/*/experiments.ts`, which `lib/experiment-copy.ts` reads. App
features read `experimentOn(id)`. Core actions use the build gate, and a
machine switch also gets an entry in `EXPERIMENT_SETTINGS`.

Promoting it is one line: change its tag in `EXPERIMENT_STAGES` from `dev` to
`nightly`, then from `nightly` to `release`. Both sides, the Experiments page
and the builds' contents follow without another edit.

At `release` the switch leaves the page in every build and the feature is
available everywhere. In the same change, drop its copy from
`lib/strings/*/experiments.ts`
(`experiment-copy.test.ts` fails otherwise), name it in `graduated()` of
`lib/setting-requests.ts` so an old card keeps a readable title, and move its
guide text out of [the experiments guide](../experiments.md). A feature that
was cut from a build leaves `FEATURE_CUTS` and `scripts/ci/feature-modules.ts`,
and its modules drop their `markFeature` call; its lazy entries may stay as
plain imports, with the flag gone. The checks of a finished id at its call
sites keep passing and are deleted later; once none is left the id leaves
`EXPERIMENT_IDS` and `EXPERIMENT_STAGES`, and old stored or reported copies of
it are dropped as unknown. A finished feature a person would still want
off gets a switch in `lib/features.ts` or an owner setting, on the Settings
page it belongs to, as [chat files and previews](chat-files.md),
[open chat links](chat-files.md#open-chat-links-in-their-apps),
[preview comments](panel.md#preview-comments), the
[pointer interactions](interactions.md) and the [Whip](#whip) (Appearance) did.

## Out of the build

`FEATURE_CUTS` names the cuts in Release bundles. The UI loses
the new thread background, Contacts screens, Teams screens and the automatic
goal threshold control. The core loses the Teams runtime and the automatic
goal implementation. The Contacts core, session import, background compaction
and device stream are gated at run time. The Whip, the Council and Mochis
ship in every build.

A packaged build knows its kind when it is compiled. `featureDefines(version)`
turns the stamped version into `__BOITE_BUILD_KIND__` and one boolean per
feature tagged `nightly` or `dev`, derived from `EXPERIMENT_STAGES`. The cuts
use `__BOITE_HAS_DRAFT_BACKDROP__`, `__BOITE_HAS_CONTACTS__`,
`__BOITE_HAS_TEAMS__` and `__BOITE_HAS_AUTO_GOAL__`. Three builds receive the
kind and flags:

- the UI, through Vite's `define` (`packages/ui/vite.config.ts`), from the
  root `package.json`;
- the core bundle, through `bun build --define` (`packages/core/bin/build.ts`,
  what `bun run build:core` runs), from the core's `package.json`;
- the compiled core, the Linux and macOS sidecar (`packages/core/bin/compile.ts`),
  with the same flags (`bin/defines.ts`).

The nightly workflow stamps both `package.json` files before it builds, and a
Release carries its plain version there, so no workflow passes a kind. Under
`bun run` from source, in the dev server's own tests and in every test,
nothing is defined and the version rule above decides alone. A compiled
bundle also refuses what it was compiled without, whatever version it hears
(`featureCompiled`, read by `featureRuns`).

Neither Bun nor Rolldown folds a call, or a constant imported from another
module, so a helper cannot carry the gate. The lazy entries write the flag
in full before loading a module:

```ts
if (typeof __BOITE_HAS_SAMPLE__ === 'undefined' || __BOITE_HAS_SAMPLE__) return import('./sample/feature');
return null;
```

Defined as `false`, the branch and its import are dropped and no chunk holds
the feature's modules. Nothing else may import those modules: one static
import elsewhere puts them back in every build.

The UI entries are `lib/backdrop-entry.svelte.ts`, `lib/contacts-entry.ts`,
`lib/teams-entry.ts` and `lib/auto-goal-entry.ts`. Shared project rows and the
Team card also use their flags in `lib/deferred-parts.ts`. The Whip and
Council keep their lazy entries without build flags.

The core builds the Teams store in its constructor and admits a prompt
synchronously. `teams-entry.ts` and `auto-goal-entry.ts` put the flag before
`require`, which Bun can drop the same way. `teams-entry.ts` also gates the
dynamic import of `team-cli.ts`. The team tables and the code for reading and
removing stored records ship in every build.

### The proof

`FEATURE_CUTS`, beside the tags, says which features are cut from which
bundle. `scripts/ci/feature-modules.ts` lists the modules cut from each
bundle and names the files kept in each build under `STAYS`.
Every listed module calls `markFeature('boite-feature:<id>')` at its top
level (a component in its script). A call with an effect is one thing no
bundler drops, where an unused constant goes as soon as a module is imported
by name: so a module that reaches a bundle carries its marker there however
it got in. `scripts/ci/feature-cut.ts` reads a bundle and fails when it holds
the marker of a feature cut from that bundle and tagged above its kind (a
leak), or lacks the marker of a feature it must hold (the marker went, and
the first check would pass on anything):

```sh
bun scripts/ci/feature-cut.ts           # packages/ui/dist and packages/core/dist, as the kind package.json says
bun scripts/ci/feature-cut.ts --build   # builds the UI and the core for the three kinds aside, about a minute
```

The desktop jobs of `desktop.yml` run the first form on what they just
packaged, the compiled core included, so a Nightly and a Release are each
checked as what they are; the Linux x64 job also runs the second.
`scripts/ci/feature-cut.test.ts` plants a leak and a lost marker, checks the
marker call in every listed module and that no other module calls
`markFeature`, fails on a file of a feature's directory that is in neither
list of `feature-modules.ts` and checks that the Whip and Council left
`EXPERIMENT_IDS` and their entries read no flag. It also checks each cut's
entry and bundles a cut module with Bun as a Release. A direct import shows
up in the scan, while an import behind its flag drops out.

### Adding a feature so it can be cut

1. Keep everything of the feature in modules nothing else imports: its
   components, its state, its commands. Shared code it needs stays outside.
2. In each bundle that cuts it, give it a lazy entry that writes its flag in
   full as above and returns the dynamic import, or `null`. Declare the flag
   beside the others in `packages/contracts/src/experiments.ts`
   (`declare global`); `featureDefines` already defines it for every id that
   is not `release`.
3. The places that draw or call the feature go through the entry and handle
   `null`: draw nothing, or refuse with `experimentRefusal(id, version)`.
4. Call `markFeature('boite-feature:<id>')` at the top level of every module
   of the feature, list them in `scripts/ci/feature-modules.ts`, add the
   feature to `FEATURE_CUTS`, and name its entry in
   `scripts/ci/feature-cut.test.ts`.
5. Run `bun scripts/ci/feature-cut.ts --build`. A leak names the chunk that
   holds the marker: find who imports the feature outside its entry.

A service the core builds at startup can follow `teams-entry.ts`. It puts
`require` behind the flag and uses `HeldTeams` for a build below the tag.
That class extends `StoredTeams` and keeps the existing records accessible.

## Devices and the desktop app

The client switches are off by default and belong to this device. They do not
change a core's settings. A phone has its own Experiments row in Settings
while the page exists.

A phone or a browser starts with the switches of the desktop app on its primary
machine, and changes when that app does. The core answers each app's report
(`client.preferences`) with the desktop app's experiments and announces their
changes (`client.desktopExperiments`); a desktop app on the machine's loopback
outranks one reached from elsewhere. Only an app on the owner's own token
counts: a paired device that calls itself a desktop app is not followed. Both
carry the list twice. The historic field (`desktop` in the answer,
`experiments` in the event) is what is in force in the core's build
(`ClientPreferencesBook.desktopExperiments`). An app from before the stages
takes that field for what is on. A Release names no unfinished experiment
there. The separate field (`desktopChosen` in the answer, `chosen` in the
event) carries the desktop app's choices. The phone keeps that list (`desktopHeard`) and
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

`EXPERIMENT_IDS` in `packages/contracts/src/experiments.ts` lists the ids.
`lib/experiment-copy.ts` supplies the labels of the switches. The app's
switches are [New thread background](#new-thread-background), [Teams](#teams)
and [Session import](#session-import).

The Grain theme (a choice in Appearance), the [prompt cache](prompt-cache.md)
timer, click markers and navigation keys in native browser recordings
(never typed text or password input), pinned model quotas and the
[Council](#council) are finished. See
[placement and behavior](development.md#ui-spacing-and-motion) for pinned quotas.
[Mochis](#mochis) still read the finished id `resident-agents`.
The [Whip](#whip) has its own switch in Settings > Appearance, on by default
(`whip` in `lib/features.ts`).

## New thread background

The `draft-backdrop` experiment draws an animated scene behind the empty new
thread screen, in thin dark lines built around the middle of the block the
heading and the composer make (the middle of the canvas without them): a
wire tunnel, a tunnel of characters, the contour lines of a slow relief or a
belt of wire crates. With the switch on, Settings > Appearance offers Off, Random and the
four scenes for this device (`lib/backdrop/choice.svelte.ts`, key
`boite.backdrop`); nothing stored means Random, which draws one scene each
time the screen opens. That module follows the key's `storage` event, so a
pick made in another window reaches the picker and the screen.

The feature is cut from a Release's UI bundle. `lib/backdrop-entry.svelte.ts`
is its one entry: `ChatView` and the Appearance page ask it once the
experiment is found on, and draw nothing until `lib/backdrop/feature.ts` has
landed with the canvas (`components/backdrop/DraftBackdrop.svelte`) and the
picker's row (`components/backdrop/BackdropPicker.svelte`). The renderer,
`lib/backdrop/engine.ts`, is a second chunk the canvas fetches when it first
shows, so picking a scene in Settings does not load it.

The canvas is the first child of the chat column and takes no layer of its
own: the heading, the composer and the tail are positioned after it and
paint over it, and their menus keep their own layers. It never takes a
click. `lib/backdrop/scenes.ts` turns a time into triangles and the engine
draws them with WebGL 2 in one blended pass at the screen's density, capped
at two device pixels per CSS pixel, in the theme's text colour, its accent
and a mix of the two, never a hue of its own, over a transparent ground, so a
scene follows the theme, the accent and the code face. A pixel is a tint
times an opacity, kept low: the scene stays close to the ground it is drawn
on. The tunnel and the crates are strokes and discs a constant number of
pixels wide (`Batch.stroke`, `Batch.dot` in `lib/backdrop/batch.ts`); the
contours and the characters are one quad over the whole screen, which the
fragment shader fills from a handful of numbers the scene sets each frame
(`Frame.data`), the characters read from an atlas drawn at device pixel size
and never filtered. A window that moves to a screen of another density
keeps its size: a running scene compares the density at each frame, a still
one listens to a `resolution` media query. The words of the
empty screen (the pieces marked `data-backdrop-calm`) are measured, and the
shader dims the scene in an oval around them. A device that asks for reduced
motion gets one still frame. A phone keeps the draft mounted under its list
and its settings: `App.svelte` says so to `ChatView` (`covered`), which stops
the loop there and starts it again on the way back, on a browser without
`content-visibility` too. A
canvas that leaves deletes its program, buffer and texture, then drops its
context. Without WebGL 2 the canvas stays empty and the screen is the one it
was.

`bun test tests/e2e/backdrop.test.ts` turns the experiment on through
Settings, picks each scene, checks the still frame under reduced motion,
that nothing is drawn under a phone's list, and
writes desktop and phone captures under `tests/e2e/.artifacts/`. It prints
the frame rate and the page's own time in a frame. On a machine whose default
ANGLE backend draws no WebGL, `BOITE_E2E_ANGLE=vulkan` names one that does; a
runner without WebGL 2 checks the canvas and skips the frames.

## Whip

A small Whip icon sits beside the other controls at the foot of the app rail
and in the phone navigation. Throw it to pick up the animated rope from Boite Legacy:
it follows the pointer, cracks on a fast flick, and falls off screen on a click.
On a phone, drag the rope with a finger and release to drop it. Escape also drops it.
The rail's control remains available to drop or rethrow while the previous rope falls.
After release, Escape resumes its usual app action.
The opening arc uses unstretched links and fits the available side of the screen.
Its switch is in Settings > Appearance, on by default (`whip` in
`lib/features.ts`, kept on the device). The physics and canvas load only
while it is on; the animation loop and audio context close when it is turned
off.

A crack plays one of six recorded cracks from Boite Legacy's sprite, with a
synthesized burst as the fallback, and shakes the native Boite window before
returning it to its original position. Throwing the rope does neither. Maximized and fullscreen windows, browsers, phones and window managers
that ignore positioning shake the interface instead. Hits do not overlap.
Reduced motion stops any visible rope and greys the control (`aria-disabled`):
a click does nothing, and its tooltip says animations are off in the system
settings, with the Windows path. It comes back as soon as the setting changes.


## Mochis

The Mochis page ([mochis](mochis.md)) and every button that leads there: the
mochis' pictures and `+` in the app rail, the phone's Mochis tab and the link
from a mochi's own thread. The command palette has no Mochis row. Mochis are finished
(`resident-agents` is `release`): the page is there in every build, with no
switch.

## Teams

The `teams` switch shows the Teams section above the mochis and opens team
chats there on desktop and phone. The Nightly and Dev core runs team work
according to its own version, including after a restart. The Release core
refuses new work with `experiment-off` and keeps the methods for listing,
reading and archiving existing teams, removing members and leaving teams.
See [Teams](teams.md#in-the-app).

## Council

Several AIs review one request ([council](council.md)), finished. Its old id
was `debates`, the name it had before the council. Every `council.*`
method, `boite delegate council`, the council line of the subagent guide and
the `boite-council` skill are there in every build. In the app it draws the
card in the thread that started a council and the salon, in the right panel
on a desktop and full screen on a phone.

## Contacts

The `contacts` machine switch enables Contacts in Nightly and Dev, subject to
policy. The Release core holds it off with `contacts-off` for new operations
and still lets owners read, revoke and remove existing contacts. Opening the
enabled page or column for the first time in a session gives the group its
one Contacts mochi, the [Operator](contacts.md#the-contacts-mochi), never at boot
(`operatorOnOpen` in `lib/operator.ts`): when a connected owner machine
already has one nothing is made, else it is made on `operatorHost` (the
Bots machine, else the Settings machine, else the window's). A failure, or no
machine to hold it yet, lets the next opening try again. A paired phone makes
none.

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
name in a dashed "remote" chip beside the sender: the label comes from the
core.

## Automatic goals

The `autoGoals` machine switch enables automatic goals in Nightly and Dev.
While it is on, the Experiments page shows `autoGoalMinChars` under the
switch. `startsAutoGoal` checks the threshold for a new prompt. In a build
that runs the experiment, `boite goal track` refuses with `auto-goals-off`
while the setting is off. In a Release it refuses with `experiment-off`.
Existing goals can still be viewed and removed.
See [Automatic goals](goals.md#automatic-goals).

## Session import

In Nightly and Dev, the `session-import` app switch enables the project menu
row and the palette command. `imports.list` and `imports.run` use the core's
version and refuse with `experiment-off` in a Release. Imported sessions
remain threads. See [Session import](imports.md).

## Background compaction

The `backgroundCompaction` machine switch runs in Nightly and Dev. It uses
the thread's automatic compaction rule and can be overridden per type under
Settings > System > Automatic compaction. The thread uses its own machine's
settings. See [Background compaction](context.md#background-compaction).

## Device stream

The `deviceStream` machine switch allows live video from Android phones and
emulators in Nightly and Dev. With the switch off, the panel polls for frames.
See [Live stream](devices.md#live-stream).

## Verification

`packages/core/test/feature-stages.test.ts` covers build kinds, tags and flags,
Release reads for teams and councils before any app has reported, and the
automatic goal switch. It checks settings cards in Nightly and Release,
preserves stored choices on a Release save and checks the `contacts-off`
refusal. `teams.test.ts`, `imports.test.ts`, `auto-goal.test.ts` and
`contacts.test.ts` cover Release behavior for their features.

`ExperimentsPage.test.ts` checks that Nightly offers the machine switches on
desktop and phone and Release hides them. It also covers the followed list
and its cache. `tests/e2e/feature-stages.test.ts` checks that Release hides
the Experiments page and that Mochis appear on fresh desktop and phone
profiles. `lib/feature-entries.test.ts` covers lazy entries for the Whip,
Council and Contacts. `scripts/ci/feature-cut.test.ts` covers [the proof](#the-proof).

`whip.test.ts` covers the switch in Appearance, persistence, desktop and phone layout, drop and rethrow, whole
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
