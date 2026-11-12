# Contributing

boite is built by a small team with a clear direction. Reviewing a pull request
takes more time than writing one, so we only take pull requests that fix bugs.

We close these without review:

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

- **Fix a bug.** A crash, a regression or a real performance problem is a bug.
  A change to how boite behaves is a feature, even when the PR calls it a fix.
  A larger fix links the issue that shows the bug. The only exception is a PR a
  maintainer asked for: link the request.
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
