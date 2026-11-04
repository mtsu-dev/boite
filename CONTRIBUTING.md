# Contributing

Read [AGENTS.md](AGENTS.md) for the code boundaries and
[development.md](docs/development.md) for the test setup.

Use the Bun version in `package.json` and install with
`bun install --frozen-lockfile`. Windows desktop builds also need Rust and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

## Features belong in plugins

A new feature that does not need a change to the core is built as a plugin:
agent commands, skills, guide lines, slash commands and background services
are all a plugin can add, with the permissions it declares
([plugins](docs/plugins.md)). Publish it from your own repository and share
its link or `owner/repo`: anyone pastes it in Settings > Plugins, or asks their
agent to add it, reads the preview and installs.

Pull requests are for:

- bug fixes;
- performance;
- documentation;
- new extension points that plugins need. Describe the plugin that needs it
  and what it cannot do today.

A pull request that adds a feature a plugin could provide is closed with a
pointer to the [plugin docs](docs/plugins.md).

## Pull requests

Keep a change focused on one problem. Explain what happens before and after it,
and include the commands you ran. UI changes need desktop and phone captures.
Do not include credentials, pairing links, personal paths or provider transcripts
in reports or fixtures.

Every change reaches `main` through a pull request. Its title becomes the squash
commit and the release notes line, so it reads `type(scope): summary`, for
example `fix(ui): keep the composer above the keyboard`. The accepted types are
listed in [ci.md](docs/ci.md).

Report vulnerabilities privately as [SECURITY.md](SECURITY.md) describes, never
in a public issue. Participation follows the [code of conduct](CODE_OF_CONDUCT.md).

Before submitting:

```sh
bun run check
bun run test
```

For integration or desktop changes, follow the build, staging and E2E procedure
in [development](docs/development.md#rebuilding-the-shell-executable). Native
shell coverage depends on the host platform; see the
[portability matrix](docs/portability.md).

Tests use temporary data directories and the echo provider. Live-provider tests
are opt-in because they use real accounts and spend tokens. Never point a test
at an existing installation's data directory.

For server packaging, run the Docker smoke test described in
[server.md](docs/server.md). For CI and release behavior, see [ci.md](docs/ci.md).
