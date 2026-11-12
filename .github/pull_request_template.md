<!--
The title becomes the squash commit and the release notes line:
type(scope): summary, with type one of feat, fix, perf, refactor, docs,
test, ci, build, chore or revert. The scope is optional.
-->

## Kind of change

- [ ] This is a bug fix, performance, documentation or a new plugin extension point (features go in plugins: [docs/internals/plugins.md](https://github.com/mtsu-dev/boite/blob/main/docs/internals/plugins.md))

## What changed

Describe the problem and the resulting behavior. Link the issue it closes.

## Verification

List the commands run, their results, and anything not verified.
Include desktop and phone captures for visual changes.

<!--
When CI's Bundle size job reports a measure growing more than 0.1 %, add a
"## Bundle size" section saying what grows and why, then rerun that job.
-->

## Affected paths

Tick what this change touches and was checked on. Leave the rest empty.

- [ ] Desktop and phone
- [ ] Each affected driver: Claude, ACP, Codex, Muse, pi, agy, echo
- [ ] Both transports: the real core and `lib/fake-client.ts`
- [ ] Reverse actions: archive, uninstall, unsubscribe, shutdown
- [ ] Windows and Linux
- [ ] Contract first: the domain file in `packages/contracts/src/`
- [ ] Documentation
