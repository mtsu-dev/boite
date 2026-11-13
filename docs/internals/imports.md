# Importing a session

Importing a Claude Code transcript or a Codex rollout creates a Boite thread
with its history and CLI session ID. The next turn resumes that session.
`packages/core/src/imports.ts` picks the reader from the account's protocol:
`imports/claude.ts` for `claude-sdk`, `imports/codex.ts` for `codex-appserver`.

## Where the sessions come from

Claude Code writes one file per session under its config directory:
`<config dir>/projects/<folder>/<session id>.jsonl`, where `<folder>` is the
working directory with every character outside `A-Za-z0-9` replaced by `-`
(`C:\projects\sample` becomes `C--projects-sample`). The config directory is
the account's: its isolation directory for an isolated account, `~/.claude`
(or `CLAUDE_CONFIG_DIR`) for the default login ([accounts.md](accounts.md)).

`imports.list` takes a project and walks that folder for every Claude account,
and the Codex home of every Codex account (below), newest file first. Each entry names the account, the session id, the file, its
size and last write, the time of the first prompt, the title, and the thread
that already carries the session if one does. A file with no prompt is left
out, and one whose first prompt was recorded in another directory is skipped
with a line on the log. The listing reads a file from its start up to the
first prompt, then its last 256 KB for the latest title record, since the CLI
writes that record again all along the session. A file whose tail holds no
title, such as an old transcript with one `summary` near its start, is read
whole. The core keeps each file's entry while its size and last write stay the
same, and a second `imports.list` for a project that is still being listed
waits for the same answer, so reopening the list reads only what changed.

### Codex

Codex writes one rollout per session under its home, every working directory
in the same tree:
`<home>/sessions/<year>/<month>/<day>/rollout-<time>-<session id>.jsonl`. The
home is the account's: its isolation directory for an isolated account,
`~/.codex` (or `CODEX_HOME`) for the default login. Archived sessions
(`archived_sessions`) are not listed.

A rollout's first line is a `session_meta` record whose payload holds the
session `id`, the `cwd` it ran in and its `source`. The listing reads that
line of every file, keeps the sessions whose `cwd` is the project's folder and
whose `source` is a string (an object marks a subagent's session), and reads
on to the first prompt for those only. A first line that is not a JSON
object, not a `session_meta`, or lacks `payload.id` or `payload.cwd` leaves
the file out with one warning on the log naming the file, the field and what
was expected; the listing goes on. Lines are read under a bound
(`readBoundedLines`): a first line past 1 MB rejects the file the same way
once that much was read, and a later line past 8 MB is dropped without being
held, an import naming the dropped line numbers on the log. Over 1001 real
rollouts the longest first line was 23 KB and the longest line 21.6 MB
(2026-11-13). Each file's answer is kept while its size
and last write stay the same, so a home is read once: the first lines of 997
real rollouts took 0.7 s (2026-11-13, `listRollout` over each file of a
`~/.codex/sessions`, Linux). The title is the name
`<home>/session_index.jsonl` gives the session (`thread_name`, the last line
of an id winning, source `agent`), else the first line of the first prompt.

The conversation comes from the `event_msg` records, in two dialects
(`imports/codex-rollout.ts`). Since Codex 0.165 they are `item_completed`
events whose `item` is a `UserMessage`, `AgentMessage`, `Reasoning`,
`CommandExecution` (a `Bash` card), `FileChange` (an `ApplyPatch` card) or
`McpToolCall`. Before, they are `user_message`, `agent_message` and
`agent_reasoning` events, the tools being the `function_call`,
`custom_tool_call` and `local_shell_call` response items with their outputs.
Each turn speaks the dialect its prompt was first met in, so a session
started on an old CLI and continued on a new one keeps every turn. Within a
turn the other dialect's records are skipped, and its copy of the same prompt
within 2 s is dropped, so a CLI that writes both doubles nothing. `response_item` messages are never prompts: the
CLI also files its injected context under the user role. The model is the
last `turn_context`'s.

`sessionId` is the rollout's `payload.id`, which is the `threadId` the Codex
driver passes to `thread/resume` (`drivers/codex/session.ts`); the app-server
finds the rollout in the same home by that id. Codex resumes a rollout only
under the model provider that recorded it.

OpenCode, pi, Antigravity, Grok and Muse Code have their own stores; none is
read yet.

## What is imported

`imports.run` reads the whole file and writes one thread in one transaction,
so no client ever sees it empty:

- one finished turn per prompt, timed on the transcript's own timestamps, with
  the user's text and images;
- one assistant message per turn holding, in order, the reasoning (`thinking`
  parts), the tool calls (`tool` parts with the input, the result the CLI
  recorded, `done` or `error` as the CLI marked it, the output cut at 20 KB)
  and the text, consecutive text blocks joined;
- subagent conversations (the `isSidechain` records) left out;
- a call the transcript never answered closed as an error, "no result in the
  transcript";
- for Codex, two agent messages in a row joined by a blank line, and no
  images but those the rollout holds as `data:` URLs;
- the title: the CLI's own (`ai-title` or `summary` record, source `agent`)
  when it wrote one, the first line of the first prompt otherwise (source
  `prompt`, [titles.md](titles.md));
- the model the last answer names when the provider lists it, the default
  otherwise;
- `sessionId` set, so the first turn started on the thread passes `resume` to
  the CLI and the conversation goes on where the terminal left it.

Usage is not recovered: the turns carry none, and the Usage page counts only
what Boite ran itself.

## From the UI

The import is an experiment: it shows once `Claude Code session import` is on
in Settings, Experiments. It is a client preference: phones and browsers
follow their primary machine's desktop switches until they choose their own
([experiments](experiments.md)). The ids live in
`packages/contracts/src/setting-requests.ts`. With it off, the menu has no row,
the palette no command, and
the `import-session` chord does nothing.

`Import a session` sits in a project's menu (right click, or the
dots beside its name) and in the palette, where it takes the open thread's
project, else the draft's, else the first one. The dialog lists the sessions
with the account and the time of the last write; a session already imported
is greyed with `Imported`; picking one imports it and opens the thread. The
`import-session` command has no default chord ([keybindings.md](keybindings.md)).
When the list holds sessions of more than one provider, each row also shows
its provider's name.

## What is refused, by name

- the account's agent is neither Claude nor Codex;
- the session id carries anything but letters, digits, dashes and underscores;
- no file at the path the folder rule gives, which the error prints;
- the file has no prompt;
- the session is already a thread, which the error names;
- for Codex: no rollout whose file name ends with the id under the home's
  `sessions`, a first line that cannot be used (the error names the field), a
  subagent's rollout, or a `cwd` that is not the project's folder.

## Proof

`packages/core/test/imports-codex.test.ts` files synthetic rollouts of both
dialects under an isolated Codex account and checks the listing, the import,
the cache, the skipped files with their log lines and each refusal.
`packages/core/test/imports.test.ts` files a fixture transcript under an
isolated account and checks the listing, the import, the second attempt and
each refusal. The browser e2e does the same from the project menu on the real
core. `codex.live.test.ts`, behind `BOITE_E2E_CODEX=1`, runs `codex exec` itself in a
temporary folder with a word to remember, imports the session it left in
`~/.codex/sessions`, asks for the word on the imported thread and checks the
session id is still the rollout's, then deletes that rollout.
`claude.live.test.ts`, behind `BOITE_E2E_CLAUDE=1`, runs one real turn,
removes the project so the session is free, imports it from the user's own
`~/.claude/projects` and resumes it: the agent repeats the word it said.
