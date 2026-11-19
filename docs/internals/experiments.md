# Experiments

An experiment is unfinished work behind a switch in Settings > Experiments.
Every feature has a tag, `release`, `nightly` or `dev`, and exists only in the
builds at or above it: a Release has none of the unfinished ones.

There is no experiment today: every feature is tagged `release`, so no build
lists a switch and Settings has no Experiments page. The machinery below
stays for the next one.

## Tags

Every feature has one tag, in `EXPERIMENT_STAGES`
(`packages/contracts/src/experiments.ts`) and nowhere else:

| Tag | Meaning | Ids |
| --- | --- | --- |
| `release` | Finished. On in every build, with no switch on the Experiments page. | `theme-grain`, `session-import`, `prompt-cache`, `resident-agents` (Mochis), `recording-indicators`, `pinned-quotas`, `whip`, `contacts`, `auto-goal`, `teams`, `debates` (Council) |
| `nightly` | May change or go away. A switch in a Nightly and in a Dev build, absent from a Release. | none today |
| `dev` | Being built. A switch in a Dev build only, absent from a Nightly and from a Release. | none today |

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

The three core settings that used to be experiments,
[Keep the prompt cache warm](prompt-cache.md#keeping-the-cache-warm)
(`cacheKeepalive`), [Background compaction](context.md#background-compaction)
(`backgroundCompaction`) and [Device live stream](devices.md#live-stream)
(`deviceStream`), are ordinary owner settings now, off by default, in
Settings > System on the desktop and on a phone. The core reads them as
stored in every build, and an agent may ask for any of them with a settings
card (`REQUESTABLE_SETTINGS`).

## Who decides

Each side decides for the build it is. No protocol field says "experiments
run": the version in the hello (`info.version`) is enough.

- The core (`client-preferences.ts`, `threads/cards.ts`) normalizes the
  experiments an app reports with `effectiveExperiments` for its own version,
  so nothing it gates runs because an app claimed it, and it refuses a
  settings card for an experiment its build does not run
  (`experimentRefusal`). Teams, the Council and automatic goals are finished:
  the core runs them in every build, whatever an app reports, so no list held
  in memory can turn them off after a restart. Automatic goals have their own
  switch, the owner setting `autoGoals` (on unless `false`), which belongs to
  the machine: `startsAutoGoal` and `boite goal track` read it with the
  threshold `autoGoalMinChars`, and a track the owner turned off is refused
  with the reason `auto-goals-off`. `settings.get` returns the settings as
  stored, with the policy overlay; `{ stored: true }` is still accepted, and
  `settings-sync.ts` still asks for it, for a core from before this change.
  The Contacts' start gate (`contacts/gate.ts`, `experimentStartRefusal`)
  refuses nothing while Contacts are `release`.
- The app (`packages/ui/src/lib/experiments.ts`) follows the version of its
  primary machine's core: the Store `followDesktopOf` names says it on every
  hello (`heardBuild`, from `store/events.ts` and `store/connection.svelte.ts`).
  The app keeps it in `boite.experiments.build` so a reload starts right, and
  before any hello with nothing stored it uses its own build version
  (`RELEASE_VERSION`). A second machine's core is not heard. `readExperiments()`
  and `isExperimentEnabled()` return what is in force,
  `effectiveExperiments(chosen, thatVersion)`: every finished feature is on,
  whatever storage holds. `setExperiment` refuses an id without a switch in
  that build. The stored choice (`boite.experiments`) is never rewritten by a
  version. The app still reports its chosen list in `client.preferences`; the
  core normalizes it for its own gates and tells phones the desktop app's
  list twice: in force in its build on the historic field, and as chosen on a
  separate one.
- Settings has an Experiments page only where the build runs experiments and
  lists at least one switch (`experimentsAvailable`, read by `pageAvailable`
  in `lib/settings-tabs.ts`, the desktop nav, search and the phone list): a
  route or a card that points there lands on Home, the page Settings opens
  on. Today no build lists one, so the page is gone everywhere. A card about
  an experiment without a switch in this build can only be refused, and says
  why; a card about a finished one says it is no longer an experiment.
- The in-memory client (`lib/fake-client`) has a core version like the real
  one (`FakeClientOptions.version`, `?fake=1&version=2.0.0`), gives it to
  `checkSettingRequest`, reads the settings as stored, and runs teams, the
  council and automatic goals in every build, automatic goals following
  `autoGoals` as the core does.

## Tagging and promoting a feature

A new feature gets an id in `EXPERIMENT_IDS` and a line in
`EXPERIMENT_STAGES`: `dev` while it is being built, so that merging it shows
it to nobody outside a build from source. It also gets a title and a hint in
`lib/experiment-copy.ts` and `lib/strings/*/experiments.ts`, and its code
reads `experimentOn(id)` in the app and the list in force in the core.

Promoting it is one line: change its tag in `EXPERIMENT_STAGES` from `dev` to
`nightly`, then from `nightly` to `release`. Both sides, the Experiments page
and the builds' contents follow without another edit.

At `release` the switch leaves the page in every build and the feature is on
everywhere. Then, in the same change: drop its entry
from `lib/experiment-copy.ts` and `lib/strings/*/experiments.ts`
(`experiment-copy.test.ts` fails otherwise), name it in `graduated()` of
`lib/setting-requests.ts` so an old card keeps a readable title, and move its
guide text out of [the experiments guide](../experiments.md). A feature that
was cut from a build leaves `FEATURE_CUTS` and `scripts/ci/feature-modules.ts`,
and its modules drop their `markFeature` call; its lazy entries may stay, the
flag they read being defined by no build any more. The checks of a finished
id at its call sites keep passing and are deleted later; the id stays in
`EXPERIMENT_IDS` until they are. A finished feature a person would still want
off gets a switch in `lib/features.ts` or an owner setting, on the Settings
page it belongs to, as [chat files and previews](chat-files.md),
[open chat links](chat-files.md#open-chat-links-in-their-apps),
[preview comments](panel.md#preview-comments), the
[pointer interactions](interactions.md), the [Whip](#whip) (Appearance) and
[automatic goals](goals.md#automatic-goals) (`autoGoals`, General) did.

## Out of the build

A build below a feature's tag does not ship the feature's code. Refusing at
run time is not enough: the bundler has to drop the modules. No feature is
cut today (`FEATURE_CUTS` is empty): the Whip, the Council, Contacts, Teams
and Automatic goals were, and are finished, so every build holds them. What
follows is how the next one is cut.

A packaged build knows its kind when it is compiled. `featureDefines(version)`
turns the stamped version into `__BOITE_BUILD_KIND__`, the one constant, and
one boolean per feature not tagged `release`, derived from it and from
`EXPERIMENT_STAGES` (`__BOITE_HAS_<ID>__`; today none). Three builds receive
them:

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
module, so a helper cannot carry the gate. Each cut feature has one lazy
entry that writes its flag in full before a dynamic import:

```ts
if (typeof __BOITE_HAS_WHIP__ === 'undefined' || __BOITE_HAS_WHIP__) return import('./whip/feature');
return null;
```

Defined as `false`, the branch and its import are dropped and no chunk holds
the feature's modules. Nothing else may import those modules: one static
import elsewhere puts them back in every build.

The five finished features keep their entries, now always taken: in the UI
`lib/whip-entry.svelte.ts`, `lib/council-entry.ts`, `lib/teams-entry.ts`,
`lib/contacts-entry.ts` and their parts in `lib/deferred-parts.ts`; in the
core `council-entry.ts` (with `delegate-cli.ts`), `teams-entry.ts` and
`auto-goal-entry.ts`. The core's entries also hold the stand-in a build
without the feature would get, written for exactly what the rest of the core
calls; no build reaches it today. In the core a store is built in the
constructor and a prompt is admitted in one synchronous step, so the entries
there use `require` behind the flag, not `import()`: Bun drops a folded
`require` the same way. The journal's tables are created in every build.

Contacts' core side was never cut, and its start gate (`contacts/gate.ts`)
refuses nothing while Contacts are `release`.

### The proof

`FEATURE_CUTS`, beside the tags, says which features are cut from which
bundle, and `scripts/ci/feature-modules.ts` lists the modules of each: all
that its lazy entry loads and nothing else imports. Both are empty today.
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
checked as what they are; the Linux x64 job also runs the second. With
nothing cut, both pass on any bundle that builds.
`scripts/ci/feature-cut.test.ts` plants a leak and a lost marker, checks the
marker call in every listed module and that no other module calls
`markFeature`, fails on a file of a feature's directory that is in neither
list of `feature-modules.ts`, checks that the five finished features' entries
still write their flag in full, and bundles a cut module with Bun itself as
a Release, once imported directly and once behind its flag: the scan must see
the first and not the second.

### Adding a feature so it can be cut

1. Keep everything of the feature in modules nothing else imports: its
   components, its state, its commands. Shared code it needs stays outside.
2. Give it one lazy entry, a small file that writes the feature's flag in
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

A service the core builds at startup follows `teams-entry.ts`: a `require`
behind the flag, and a stand-in typed with `Pick` of the real class for the
members the rest of the core calls, so a new caller fails the type check
until the stand-in answers it.

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
`lib/experiment-copy.ts` supplies the labels of those with a switch. None
has one today.

Finished, with no switch: the Grain theme (`theme-grain`, a choice in
Appearance), Claude Code [session import](imports.md) (`session-import`), the
[prompt cache](prompt-cache.md) timer (`prompt-cache`), click markers and
navigation keys in native browser recordings (`recording-indicators`, never
typed text or password input), pinned model quotas (`pinned-quotas`, see
[placement and behavior](development.md#ui-spacing-and-motion)), Mochis
(`resident-agents`), [Contacts](#contacts) (`contacts`), [Teams](#teams)
(`teams`) and the [Council](#council) (`debates`). Finished, with a switch of
their own elsewhere: the [Whip](#whip) (`whip`, Settings > Appearance, on by
default) and [automatic goals](goals.md#automatic-goals) (`auto-goal`, the
owner setting `autoGoals` in Settings > General > Agent replies, on by
default, beside its threshold `autoGoalMinChars`).

The three owner settings that were experiments, the cache keepalive,
background compaction and the device live stream, are in Settings > System,
off by default. They change execution on the machine picked in the bar above
them and affect its clients. A thread takes the setting of the machine it
runs on: turned on for the desktop's own core, background compaction does
nothing for a thread on a server.

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
mochis' pictures and `+` in the app rail, the phone's Mochis tab, the command
palette row and the link from a mochi's own thread. Mochis are finished
(`resident-agents` is `release`): the page is there in every build, with no
switch.

## Teams

Teams of mochis ([teams](teams.md)), finished: the `teams.*` methods and
`boite team` commands, and the team lines of the mochis' guide, are there in
every build, whatever an app reports, so a restart of the core turns nothing
off. In the app it shows the Teams section above the mochis on the Mochis
page, on the desktop and on the phone, and the team chats there
([teams](teams.md#in-the-app)).

## Council

Several AIs review one request ([council](council.md)), finished. The id is
still `debates`, the name it had before the council. Every `council.*`
method, `boite delegate council`, the council line of the subagent guide and
the `boite-council` skill are there in every build. In the app it draws the
card in the thread that started a council and the salon, in the right panel
on a desktop and full screen on a phone.

## Contacts

Contacts are finished. Opening them the first time in a session, the page or
the unfolded column, gives the group its one Contacts mochi, the Operator
([contacts](contacts.md#the-contacts-mochi)), never at boot
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

## Verification

`packages/core/test/feature-stages.test.ts` covers the three kinds and the
three tags with a stand-in feature of each, the build's constants, a Release
core with every feature on before any app reported, the `autoGoals` setting for
prompts and `boite goal track`, the card of a former experiment, the three
machine settings saved like any other, and Contacts starting something on a
Release. `ExperimentsPage.test.ts` covers the app: every feature on whatever
storage holds and no Experiments page while no switch is listed, a phone that
keeps its desktop app's list, the followed cache and the desktop app that
follows no one. `tests/e2e/feature-stages.test.ts` captures Settings on a Dev
and on a Release build, desktop and phone, with no Experiments page.
`lib/feature-entries.test.ts` covers the lazy entries of the Whip, the Council
and Contacts, and `scripts/ci/feature-cut.test.ts` [the proof](#the-proof),
with a synthetic module that stands in for a cut feature.

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
