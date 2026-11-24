# Contributing

**Bug fixes only.** Pull requests from outside the maintainers must fix a bug.
Anything else is closed without review.

The maintainers are the people with write access to this repository. They
build the features and may open any pull request.

boite is built by a small team with a clear direction, and reviewing a pull
request takes more time than writing one. We close these without review:

- New features or new settings
- UI redesigns
- New providers, drivers or connection methods
- Architecture changes and rewrites
- Support for another platform
- Refactors and cleanup with no bug behind them

Want a feature? Build it as a [plugin](docs/internals/plugins.md) in your own
repository. If a plugin cannot do it yet, open an issue with the feature form
and describe what is missing. We decide what goes into boite and build it
ourselves.

## Rules for a pull request

Every pull request from outside the maintainers follows these rules, drafts
included. Maintainers follow the title rule and the checks too.

- **Fix a bug.** A crash, a regression or a real performance problem is a bug.
  A change to how boite behaves is a feature, even when the PR calls it a fix.
  A larger fix links the issue that shows the bug. The only exception is a PR a
  maintainer asked you to open: link the request.
- **One problem per PR.** Include everything the fix needs (contract, core, UI,
  tests, docs) and nothing else.
- **Show that it works.** Say how you found the bug, how you checked the fix and
  what you saw. "Tests pass" is not evidence. UI fixes need before and after
  captures at desktop and phone widths, uploaded to the PR, not committed.
- **Search first.** If an open PR already covers your bug, test it and comment
  there instead of opening another one.
- **Title.** It becomes the squash commit and the release notes line:
  `type(scope): summary`, for example `fix(ui): keep the composer above the
  keyboard`. Types are listed in [ci.md](docs/internals/ci.md).

A PR that follows the rules can still be closed. A PR that breaks one is closed
with the rule named; fix it and open a new PR that links the old one.

Never put credentials, pairing links, personal paths or provider transcripts in
an issue, a PR or a fixture. Report vulnerabilities privately as
[SECURITY.md](SECURITY.md) describes. Participation follows the
[code of conduct](CODE_OF_CONDUCT.md).

## Working from a fork

These steps are for you and for any agent writing the PR for you.

- **Allow edits by maintainers.** Tick it when you open the PR (`gh pr create`
  ticks it unless you pass `--no-maintainer-edit`), so a maintainer can push a
  small fix to your branch instead of waiting for you.
- **Start from the current `main`.** GitHub refuses a push that brings commits
  touching `.github/workflows/` from an OAuth or classic token without the
  `workflow` scope (`gh auth refresh -s workflow` when Git pushes through `gh`),
  or from a fine-grained token without write access to Workflows. Once the PR
  is open, its Update branch button, if available, merges `main` too. Do not base the branch on an older `main` to get
  around it; the tree you tested is then not the tree that merges.
- **Keep it a draft until the evidence is in the description.** The review
  starts when the PR is marked ready. Captures go in the description, not "in a
  comment later". `gh` cannot upload images: an agent saves the files and says
  where, and you drag them into the description on GitHub.
- **Run what the PR's CI skips.** A pull request runs the Linux checks and, for
  a UI change, three phone E2E files on Windows, and the Windows core suite
  only for protection code and shared toolchain inputs; the merge queue runs
  every E2E file, Windows and macOS
  ([pull request runs](docs/internals/ci.md#pull-request-runs)). A UI change
  runs `BOITE_E2E_SKIP_SHELL=1 bun run e2e` before it goes ready; a shell
  change builds the shell first
  ([shell build](docs/internals/development.md#rebuilding-the-shell-executable))
  and runs `bun run e2e`. A failure in the queue sends the PR back.
- **Run every test you add or change**, and check that it fails without your
  fix. Write its pass line in the description. A test that cannot pass, for
  example one that reads a CSS custom property jsdom does not compute, fails CI
  on every run.
- **Say what you did not run.** A change to the desktop shell, a native dialog
  or input handling that you checked only in a browser says so under
  Verification, with the platforms left untested.
- **Answer every review finding** on the current head: fix it and reply with
  the commit, or reply with the reason you decline it, then resolve the thread
  you fixed.

## Setup and checks

Code boundaries are in [AGENTS.md](AGENTS.md), setup in
[development.md](docs/internals/development.md). Before you push:

```sh
bun install --frozen-lockfile
bun run check
bun run test
```

A desktop or integration fix also follows the
[shell build and E2E steps](docs/internals/development.md#rebuilding-the-shell-executable).
Tests use temporary data directories and the echo provider; never point one at
a real installation.
