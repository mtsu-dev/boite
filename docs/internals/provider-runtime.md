# Provider runtime

[Providers](providers.md) describes descriptors and supported agents.

## Turning a provider off

Every provider has a switch on the Providers page, for a machine that has
more agents installed than its user wants offered. `providers.setEnabled`
stores the choice per core, in the journal setting `provider-switches`, and
each summary carries it as `enabled`. A provider nobody touched follows its
descriptor: on, or off when it is `experimental`.

Off, nothing of that provider starts. A turn, a model probe and
`threads.capabilities` go through the same gate as a missing agent
(`assertDriverRunnable`) and answer with a sentence saying where to turn it
back on, and the capability reason `provider-disabled`. A sign-in and a banked
reset are refused the same way, and a connection check reads the login files
without starting the agent. The update check skips it, its program is not
even asked its version, its usage is not read, no title is written on it, a
delegated agent cannot be routed to it and no default account is adopted for
it. Its warm processes
are released at once; a turn already queued or running ends by itself. A mochi
on it keeps its event wakes, facts and letters waiting, its status says to turn
the provider back on or pick another model, and they run once one is done
([mochis](mochis.md)).

Nothing is removed. Accounts, threads, the managed install and the user's own
install stay as they are, and turning the provider back on adopts an existing
login the way a fresh install does. The page lists the off providers last,
dimmed, under Turned off, with no install or sign-in step. The clients hide an off provider from every list that offers one, the
model picker included, and a thread that was on it shows a Turned off chip in
its composer. The method is the owner's: a paired device reads `enabled` and
cannot change it.

## Retired providers

Boite once shipped `antigravity-cli`, which ran the user's own `agy` in print
mode; the managed `antigravity` ACP server replaces it. A data directory from
that Boite still names it, so `providers/retired.ts` lists the id and startup
cleans up after it (`account-retirement.ts`): its accounts and the limits
switch of its `quota:antigravity-cli` source leave. A conversation on it stays
listed and readable, and reads as on a removed account: its next turn refuses
until the user picks another account in its model picker. An installed plugin
whose account pool names it keeps loading, without that id.

## The models probe

`providers.probe` first considers the explicitly scoped composing or viewed
session for Codex and ACP. It reuses only a compatible account, descriptor,
environment, workspace and context mode. Codex asks the idle host for its list;
ACP shares compatible initialization and reads its catalog without changing its
model. Missing ACP effort metadata and invalidated catalogs use an isolated probe.

Otherwise it spawns one short-lived process under the synthetic thread
`probe:<providerId>:<accountId>`, exactly the way a session would, so it sits in
a Job Object and in the trace like any other, then asks the protocol's own question:

- Claude: SDK `supportedModels()` without a user prompt, with
  `settings.disableAllHooks` so no `SessionStart` hook fires, and
  `strictMcpConfig` with no servers so it starts none of the user's MCP servers
  (an empty `mcpServers` alone passes no flag). The CLI quota read, titles and
  side questions do the same. Effort levels, adaptive
  thinking and Fast support come from each returned model. Descriptor effort
  controls stay hidden until that account has answered. Once answered, the
  probe and the quota read end the prompt stream, which closes the CLI's stdin,
  and give it up to 30 seconds to exit before the stop (`ProbeContext.letExit`).
  The CLI refreshes an expired login at startup and can answer before that
  refresh is written; the server has already rotated the refresh token, so a
  stop in between leaves the account a spent token and a stale
  `.oauth_refresh.lock`, and the next CLI signs it out with `invalid_grant`.
- ACP: `initialize` and `session/new`, then whichever of two answers the agent
  sent. The `configOptions` whose category is `model` and `thought_level` win
  when there is a `model` one, since that option is what a turn sets. Mistral
  Vibe files its effort under `thinking` instead; that category is read, and
  set by a turn, when no `thought_level` option is listed.
  Otherwise `models.availableModels` is read: each entry is a model of its own,
  and under the `grok` quirk, read there even beside a `model` option, it
  carries its own effort scale out of `_meta.reasoningEfforts`, the level
  flagged `default: true` the one preselected. That effort scale describes only the current model, so Boite does not
  copy it to other models. An agent that sends neither leaves the descriptor's
  models standing. OpenCode names a model's `thought_level` only once a session
  is on that model: `providers.probe` takes an optional `model`, selects it with
  `session/set_config_option` in a fresh probe process and reads the scale the
  answer carries. One read per model is cached with the list, the composer asks
  for the model it lands on, and a failed read keeps the list already cached.
  A model's scale is read once, even when the agent names none for it. The
  config options a turn's own `session/new` or `session/load` answers are kept
  for the account too. A process that resumes a session loads it first and
  opens a discovery `session/new` only when the load answered no options and
  nothing is cached; both OpenCode majors answer them on load. A probe or a
  discovery session is deleted with `session/delete` when the agent advertises
  `sessionCapabilities.delete` (OpenCode 2 does), so none of them stays in the
  agent's own session list. A refresh drops cached catalogs but keeps the one
  a session still opening reads: the composer refreshes as the app opens while
  the draft's process starts, and that answer is as fresh as a probe's.
- ACP after a sign-in: the login process, already running and signed in,
  opens one `session/new` in an empty folder and its answer becomes the
  account's catalog, told to clients as `providers.probed`. No probe process
  starts for an account that just signed in. A sign-in whose session did not
  open within 30 seconds is still signed in; the next look at the models probes.
- Under the `antigravity` quirk a probe waits 90 seconds instead of 20. The
  agent is a PyInstaller one-file program that unpacks itself before its
  server reads a line: 45 to 54 seconds on an 8 GB laptop with 600 MB free
  under 1.1.1, whose Windows build unpacked about 1.2 GB. The 1.5.2 builds are
  smaller (Linux 714 MB plus a 139 MB harness, Windows 58 MB plus a 155 MB
  harness).
  Each launch, probe, sign-in or session, unpacks into its own folder under
  `<isolationDir>/tmp`, set as `TEMP`, `TMP` and `TMPDIR`, and the folder goes
  once the process has exited. Every one of them ends in a forced stop, which
  would otherwise leave the unpacked copy in the user's temp folder. What a
  stopped core left there is removed the first time the account launches again.
- ACP controls on a running session: a model, effort or mode goes out only
  when the session's own last answer does not already report it. OpenCode 2
  puts the effort back on `default` with any model change, so the effort goes
  again after one; a thread with no effort sends `default` when the agent lists
  it, and a thread back on the agent's own model asks for the model the
  session opened on. A refused effort is not asked again in that process.
  A model the agent lists without the selected value, or refuses after any
  injected-model retries, stops the turn before its prompt. A later turn can
  retry that model.
- Codex: `initialize`, the `initialized` notification, then `model/list` until no
  cursor comes back. Each model carries its own efforts and its own default, so
  two models on one account can offer two different scales. `serviceTiers` supplies
  speed choices without adding unlisted tiers. It answers before
  any login, so an unauthenticated account is no reason to skip the probe.
- Muse: `initialize`, `initialized`, then `model/list`, on a host started with
  `--no-session-log --disable-write --disable-shell` so a probe can neither write
  nor leave a session behind. Only models routed to `meta` are kept. `model/list`
  carries no efforts, so each model's tiers come from the catalog Muse caches
  under the `museHome` its `initialize` answer names
  (`model-catalog/*.json`, rows of the same profile with
  `reasoning_effort_variants`); a model the catalog does not describe gets
  `low` to `max` with `high` preselected, which is Muse's own default. A host
  that is not signed in lists nothing, and the descriptor's models stand.
- pi: `get_state`, `get_available_models` and `get_available_thinking_levels`.
  Each model id carries its provider prefix, because that is what pi's `--model`
  takes and two providers can ship a name. The thinking level `get_state` reports
  is the default effort of the model the probe's session is on, and of no other:
  pi does not say which level it would run another model on, so those models
  carry their scale without a default. A thread that picks one sends no level,
  pi keeps its own clamped to that model, and the reasoning chip reads Default
  until a level is picked. On such a model the reasoning popover, and the
  phone's options sheet, offer Default to hand a picked level back to pi. An unauthenticated pi answers with
  nothing, so the descriptor's models are left standing rather than replaced by an
  empty list.

The disposable child is killed through the registry on every path; a reused
session retains its ordinary lifecycle. The answer keeps the
descriptor's `default` first, so the choice can always go back to the agent, is
cached per provider and account until a `providers.reload` that changes a
descriptor, what one resolves to or a rejection, or a change to that
account, and reaches every client as `providers.probed`. A reload that changes
none of that emits no `providers.updated`. Two callers at once share
one process. `refresh: true` bypasses a completed cache entry, sharing any probe
already in flight. Until that read answers, the account's previous list still
answers model checks, and a read that fails leaves it in place; a reload or a
change to the account drops it as before. The caller is answered as soon as the
models are read: the process exits, its trace closes and its directory goes
afterwards, and the next probe of the same account that needs a fresh read waits
for that; a read the cache answers does not. Claude takes up to a second to exit. The UI keeps a persistent display cache and reads asynchronously.
Cleanup starts the registry's bounded stop before waiting for process pipes to
close. A missing close event gets one additional second, then a
`provider.probeCleanup` warning. The original models or discovery error still
reach the caller, and the next request for that account can proceed.

Every list an account answers is also saved in the journal
(`providers/saved-catalogs.ts`), under a hash of the descriptor, the resolved
executable, the account's gateway settings and its status, identity and
isolation folder. When the account has not answered since the core started, or
since a reload or an account change dropped its list, a probe with no `refresh`
and no `model`, on a provider turned on, returns the saved list at once if that
hash still matches, and a `refresh` read starts behind it; its answer reaches
clients as `providers.probed`. Until that read answers the saved list answers
model checks, and a read that fails leaves it in place, as a refreshed one does. Starting
the agent is what costs: on 2026-10-22 an Antigravity probe took 12.3 s on the
desktop, an OpenCode 2 probe 3 to 5 s on the server, and the picker showed
nothing until it answered. A list a driver already holds, from a sign-in's or
a turn's own session, answers instead and starts nothing. While nothing has
been read yet, every such probe gets the saved list, a second one while the
first refresh still reads and one after it failed included, held for model
checks the same way. Any change to the account (`accounts.updated`, a sign-in under
the same identity included) and its removal delete its saved list.
A model picked from a list the core gave on this connection lands at once, and
a draft created on it is not read again, except an ACP effort that list carries
no scale for. A list restored from browser storage, or one the core has not
given yet, is read before the pick or the send.
A probe that finds no executable, whose agent dies or that runs past
twenty seconds, thirty for pi, throws with the reason and caches nothing. `threads.create` and
`threads.update` accept what the last probe listed on top of the descriptor's; a
model nobody probed is refused, saying to open the picker.

A probed scale lives in memory. After a core restart a thread may carry an
effort whose scale is not read yet: `turns.start` lets it through, because it
was checked when it was chosen, and refuses only an effort missing from a scale
that is known.

## Permission modes

Boite has six: `default`, `acceptEdits`, `plan`, `bypassPermissions`, `yolo`, `dontAsk`.
Drivers translate them according to their protocol capabilities.

YOLO is separate from Auto (`bypassPermissions`). It selects the agent's most
permissive execution mode and automatically accepts tool approval requests that
still reach Boite, without a permission card. It keeps the user's configured
and plugin hooks; a context mode without hooks, protected execution and Boite's
internal runs (probes, Codex titles) still turn them off. Claude runs
with `bypassPermissions` and applies the mode live; a hook that answers `ask`
reaches the permission callback, which allows it. Codex runs with approvals
set to `never` and full filesystem access, and entering or leaving YOLO
replaces its process. No settings file is rewritten. ACP and Muse use their
native unrestricted mode and Boite accepts remaining approval requests.
Antigravity uses its permission-skip flag. Questions seeking input still ask for real
answers; YOLO does not invent form values or complete a device sign-in.

In Auto, Claude Code still sends its own safety checks to the permission
callback (2.1.323: `rm -rf "$D/$p"` on possibly-empty variables). Such an ask
sets `suppressAlwaysAllowRule`; a hook's ask does not. `drivers/claude/permissions.ts`
denies the first kind without a card, with the CLI's `decisionReason`, which
names the safe form, so the agent retries it. A hook's ask and an ask rule of
the user's settings (`matchedAskRule`) keep their card.

Protected shared work adds an immutable file/tool capability to the host-selected
mode and account. Claude removes native tools and user MCP/plugins/hooks and
provides only in-process protected tools. Codex disables alternate execution
features and MCP servers, applies a granular filesystem root deny and offline
profile, and provides host dynamic tools. `boite_exec` runs project commands
through the OS boundary; job-only `boite_commit` uses fixed trusted Git operations.
Default/acceptEdits require host approval, bypass/YOLO retain automatic approvals,
and plan/dontAsk refuse mediated commands. Restricted context tool lists expose
no generic command tool. Native mode changes retire/re-admit the capability.
The protected fingerprint participates in warm identity. Codex cold protected
starts replay through a fresh native thread because `thread/resume` cannot
replace dynamic tools. Ordinary local sessions keep the mappings below.
See [protected shared execution](contacts.md#native-linux-tool-execution) for
host prerequisites and the deterministic native driver proof.

OpenCode 1.19.3 uses its native ACP plugin hooks to deny every
non-core tool and command, plus a core-only remote MCP server. It supports only
its native default/build and plan modes. Other versions need a verified hook
path and bundled SDK inventory before admission. Other ACP implementations, including
OpenCode 2, cannot obtain this capability by advertising ACP permission support.
Private discovery retains the selected API/OAuth account and JSON provider/model
selection, including normalized JSONC and custom configuration files. Only SDKs
bundled by this native version may load; external SDK imports, legacy TOML and
remote-configuration credentials are refused explicitly. User plugins, MCP,
commands and project configuration cannot follow the protected session.
An explicit protected model must appear in the native catalogue or the selected
account's injected provider and be confirmed by ACP before a prompt. Missing,
refused or unconfirmed selections stop the turn without API traffic. Warm
turns recheck the current native model, including announced drift; choosing
the native default remains a separate selection. Ordinary local ACP keeps its
existing best-effort model preference.

pi 1.4.0 uses its own extension API: builtins, discovered extensions, MCP, skills,
prompts and project context are disabled, and a core extension registers only
protected tools and rejects other tool calls. Selected native account
authentication remains available to trusted provider control; model selection
is captured privately. Command-valued keys/headers and executable environment
preloads are refused before launch. Only YOLO and bypass modes
are admitted, because pi RPC has no native approval mode. The descriptor keeps
`capabilities.approvals: false`. ACP/pi fingerprints distinguish ordinary and
protected warm sessions, and every warm turn checks revocation before prompting.
Protected pi cold starts use a new private transcript and the core's captured
continuation instead of reopening ordinary or differently scoped native history.
The forced shared-turn context suppresses native resources while captured host
tool permissions control the protected tools. An actual host tool-free context
exposes neither native nor protected tools.

Muse 1.4.13 now supplies a verified mandatory MCP-only native registry gate;
its protected adapter uses the same OS executor and preserves selected native
account/model/approval semantics. Older Muse 1.3.0 remains refused because its
native file reads bypass its shell sandbox and its toolsets cannot retain only
MCP tools. Installed native production regressions cover both cases without
live inference. The exact release and gate are described under [Muse Code](#muse-code).

- Claude takes a changed mode in place through the SDK's `setPermissionMode`,
  sent before the next prompt and only when the mode moved. Claude can also move
  by itself: EnterPlanMode puts it in `plan`, and an ExitPlanMode the user
  refuses or stops leaves it there. The driver records the mode each `init`
  and `status` frame reports, so the next turn on the same process sees the
  drift and puts the thread's mode back before its prompt goes in.
- ACP standardises the call, `session/set_mode`, and standardises none of the ids
  inside `availableModes`: the same mode is spelled `acceptEdits`,
  `accept_edits` and `auto_edit` by three different agents (Mistral Vibe says
  `ask`, `accept-edits` and `auto-approve`). So each Boite mode
  carries an ordered candidate list matched without case, `_` or `-`, and the
  first spelling the agent lists wins. It goes out when the session opens and
  again at the start of any turn the agent has drifted from, and it is
  deliberately not part of the session key, so a warm session follows a change
  instead of being dropped. An agent that lists no modes or refuses the call is one
  warning in the log while the turn runs anyway: a mode is a preference, never a
  reason to refuse a turn, except for a protected turn or a
  [council](council.md#read-only) member, whose read-only rests on it. An agent may list its modes as a config option of
  category `mode` instead, with no `availableModes` at all, which is what
  OpenCode does with `build` and `plan`: the same candidates are matched
  against that option's values and the mode goes out as a
  `session/set_config_option`. A change the agent makes on its own reaches
  Boite as a `config_option_update`, which refreshes the kept value so the
  next turn puts the thread's mode back. Every Boite mode but `plan` ends its candidate
  list on the agent's plain mode (`default`, `build`, `normal`), so a thread
  that leaves `plan` for a mode the agent does not list goes back to the plain
  one instead of staying in `plan`.
- Codex takes a pair when the thread opens, an approval policy and a sandbox:
  `default` and `acceptEdits` are on-request plus workspace-write, `plan` never
  plus read-only, `bypassPermissions` and `dontAsk` never plus danger-full-access.
  On Windows `plan` also leaves the Microsoft Store's folders off the `PATH` when
  the first `pwsh` is the Store's, which cannot start under the read-only sandbox
  (`CreateProcessAsUserW failed: 5`, codex-cli 0.166); Codex then uses Windows PowerShell.
  No call changes that pair on a running turn, so the mode is part of the session
  key: changing it interrupts and resumes the active turn with the new pair,
  keeping the same Boite turn and conversation.
  Under on-request, a command, a file change, a wider sandbox
  (`item/permissions/requestApproval`, granted for the turn) and an MCP tool
  call each draw a permission card. Codex asks for the MCP tool call through
  `mcpServer/elicitation/request`, as does an MCP server asking a plain yes or
  no; an elicitation that needs a form with required fields, a url or a device
  check has no card yet and is declined, with a line in the log. Stop answers
  an open card with `cancel`, not with the user's refusal.
- Muse splits a mode in two. The approval mode goes on the wire, on
  `session/start` and through `session/setApprovalMode` when the host reports
  another, so a warm host follows it: `default` and `acceptEdits` are
  `promptUnmatched`, `plan` is `denyUnmatched`, `bypassPermissions` and `dontAsk`
  are `allowAll`. The sandbox posture is a host flag, fixed for the process:
  `plan` adds `--disable-write --disable-shell`, `bypassPermissions` and
  `dontAsk` add `--disable-sandbox`. Those flags join the session key, so only a
  change between the three postures drops the process, and the next host resumes
  the session. `acceptEdits` adds one rule of the driver's: a file write inside
  the thread's folder that Muse neither marks `protectedWrite` nor escalated
  through its own judge is approved once without a card.
- pi has no approval call anywhere in its RPC mode, so `capabilities.approvals` is
  false, the thread's permission mode never reaches the agent, and each session
  says so once in the log. A driver that waited for a permission question there
  cannot enforce a permission gate.

The composer offers four of the six and names each by what the agent may do
without asking (`lib/permission-modes.ts`): Ask, Edit freely, Auto and YOLO.
The list follows the agent. Codex loses Edit freely, which is the same pair as
its default, and its default reads "This folder", because workspace-write lets
it edit and run commands there without a card. An agent whose `capabilities.approvals` is false gets no mode chip: every
choice would describe something it does not do. No confirmation keeps the warning colour on its chip,
since it reaches the whole computer.

A permission is not the only thing an agent asks. A protocol that carries a
free-form question maps it to `askQuestion` on the turn context, which draws a
question card in the timeline and answers the agent with what the user picked;
Codex's `item/tool/requestUserInput` and Muse's `userInput/requested` are the two
that do today. A question is
not a permission mode and is never gated by one: an agent whose approvals are
off can still ask.

An answer can carry files when the question has a free field, as T3 Code's
question attachments do: a screenshot of the bug, a mockup. The card has no
field of its own. While such a question waits, the composer is its free answer:
its placeholder reads "Or type your own answer", and its send control reads
Answer and is the one commit, taking the card's picks with the text and files
(`lib/question-reply.svelte.ts`); it stays an outline, its tooltip saying why,
until there is a pick or text. The card then keeps its options, its pager and
Skip question, with no Answer of its own; a card the composer does not answer
(a subagent's question docked in its parent, a question without free text)
keeps its own. Files arrive by the composer's paperclip, a
paste or a drop, with its caps and image reduction, and a file alone is a valid
answer. Folding the question sets the thread's questions aside, and the composer
sends ordinary messages again; the card's "Answer in writing" brings it back.
A question never takes a composer the user is writing in. One that arrives
while its thread's composer holds text or files stays out of it until that
composer is empty, so Enter still sends the draft as a message; one that
arrives within 1.5 s of a keystroke waits for that pause. "Answer in writing"
takes it at once, draft included. Once a question has the composer, typing
again does not give it back.
No protocol carries an image in
a question's answer (Claude's `AskUserQuestion` takes strings, Codex's
`requestUserInput` and Muse's `userInput` take text, pi's dialogs a value), so
the core writes each file under `<dataDir>/attachments/` like a prompt's files
and appends their paths to the answer text, with the note prompts use; the
agent reads them with its own tools (Read, `view_image`). The journalled answer
and the card keep only each file's kind, type, name and size, never its bytes
or path. ACP and Antigravity questions offer options only, so they take no files.

## Claude's system prompt

Without a `systemPrompt` option the Agent SDK sends an empty one, and the CLI
then gives the model one identity line. The driver asks for Claude Code's own
prompt instead (`preset: 'claude_code'`), the one Anthropic tunes per model, and
appends Boite's guide to it. Measured on 2026-10-15 with Claude Code 2.1.300
against a local fake API server, with memory off and the dynamic sections moved
out, the preset adds these characters to the system prompt:

| Model | Characters | What it adds |
| --- | --- | --- |
| Opus 5.5, Sonnet 5.5 | 3,260 | Harness rules, safety, code style, confirmation of hard-to-reverse actions, honest reports, context management |
| Haiku 5.5 | 6,052 | The same, plus a section on finishing a turn's work before asking |
| Fable 5.1 | 9,332 | The same, plus rules for scope and for the final message |

`excludeDynamicSections` moves the working directory and memory path to the
first message, so threads in different worktrees share one cached system
prompt. `autoMemoryEnabled: false` keeps the preset's file-based memory out:
memory belongs to the user's brain and Boite's own notes. A context mode keeps
the preset, which carries Haiku's section, and drops only Boite's guide when it
drops guides.

The CLI records a session's system prompt on its first request and sends that
record until compaction, even when a later launch passes different text. A
thread started before this change keeps its empty prompt until it compacts or
starts a new session; a change to the guide reaches a running session the same
way.

## Reasoning and tool summaries

What a thread shows of an agent's reasoning is what its protocol sends. Measured
on 2026-10-14 with Claude Code 2.1.299 and Codex 0.162.1:

| Provider | Reasoning text | Batch summaries |
| --- | --- | --- |
| Claude | A summary per thinking block: the driver passes `--thinking-display summarized` through `extraArgs` | `tool_use_summary` with `CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES=1`, kept as each call's `summary`; off unless `Settings.toolSummaries` |
| Codex | Summary deltas, a bold heading then a paragraph; `auto` and `detailed` gave the same shape | none |
| ACP (Grok, OpenCode), pi | What the agent streams as thought chunks | none |

A CLI the SDK drives is non-interactive, and for that case Claude Code asks the
API to leave reasoning out (`omitted`): the blocks arrive with empty text, which
is what left a thread with "Thinking" rows and nothing in them. The display only
moves what comes back; the model thinks, and is billed, the same. Whether and how
much it thinks stays with the CLI (effort, `alwaysThinkingEnabled`), which is why
the driver sets the flag rather than the SDK's `thinking` option. The API
refuses `highlights` (one title per stretch of thinking) for a subscription
login: `thinking.adaptive.display: Input should be 'summarized', 'omitted'`, and
the CLI falls back to `omitted` for the rest of the process.

Claude 5.1 and later write the short line they put ahead of a tool call ("Now
I'll run the tests.") as a thinking block, not as text. When two non-empty
thinking blocks of one API message come right before a tool call, the driver
turns the second into a text part in place, so it reads as the agent's
narration between tool groups; the first stays folded as reasoning. One
thinking block before a call is reasoning, and a model before 5.1 (the model
of the stream's `message_start`, else the thread's) writes its updates as text,
so its consecutive thinking blocks share one part as before.

Tool summaries are off by default: the driver sets the variable only when the
owner turns on Settings > General > Tool summaries (`Settings.toolSummaries`),
read when a Claude process starts. Each tool summary is one request the CLI
sends to Haiku after a batch of calls finished (`source=tool_use_summary_generation` in its debug log), on the
thread's account. It names the calls it covers, so it can arrive while the next
batch already runs; a call of an earlier turn is not redrawn. The other
progress messages the CLI sends (`thinking_tokens`, `api_retry`, `status`,
`task_progress`) feed the turn's footer (`drivers/claude/progress.ts`, see
[trace](trace.md)); `prompt_suggestion` becomes the thread's suggested next
message (see Suggested next message below) and `rate_limit_event` stays unused
by the timeline.

Each streamed API request owns its output parts. When Claude Code reports
`api_retry` after an interrupted response, the driver clears that attempt's
text, thinking and unexecuted tool cards before the replacement streams.
Completed requests and their tools remain. A `message_delta` with a stop
reason confirms completion; `message_stop` alone does not, because the CLI
also emits it when a stream is interrupted.

Four system messages say something the CLI saves or reads went wrong while the
turn goes on (fields read from CLI 2.1.325, three of them missing from the
SDK's types): `session_writes_lost` (`error_code`, `lost`,
`transcript_session_ids`), `file_attachments_missing` (`message_uuid`,
`sent_count`, `missing`), `instruction_size_warning` (`total_chars`,
`total_limit_chars`, `file_count`, `largest_chars`) and `mirror_error`
(`error`, `key`). `drivers/claude/notices.ts` turns each into a `notice` part:
the fields a client words in its own language, and the CLI's own account as
`detail`, behind the notice's "i". The turn is neither stopped nor failed. The
CLI documents `session_writes_lost` as written on exit after the last result,
when the core closes its input (idle, shutdown, a changed setup): with no turn
attached, the session hands the part to `SessionContext.notice`, and the core
writes it as a finished `system` message of the thread's last turn, without
starting a turn or the agent, masking a secret in use on the thread as a
turn's parts are. A background compaction's copy keeps its notices to itself.

## Suggested next message

After a turn of a conversation the owner leads, the empty message box offers
the next message the agent expects (Settings > General > Suggest the next
message, `Settings.promptSuggestions`, on by default). Only the agent's own
prediction is used, never a separate model call:

- Claude: the driver starts the CLI with the Agent SDK option
  `promptSuggestions: true` (`drivers/claude/options.ts`). The CLI sends one
  `prompt_suggestion` message after the turn's `result`; the session hands it
  to `TurnContext.suggestion` with the turn it ended. The CLI skips a
  conversation with fewer than two answers (`early_conversation` in CLI
  2.1.x), so the first suggestion follows the second answer. The option is read when
  the process starts, so an open conversation follows a change of the setting
  at its next process start.
- Codex: after a completed turn the driver asks
  `thread/prediction/request {threadId, sourceTurnId}`, the app-server's
  experimental composer prediction (`drivers/codex/prediction.ts`). The answer
  is the notification `thread/prediction/updated` with
  `result: {type: "completed", text}` or `{type: "failed"}`. A failure, or an
  app-server that refuses the method (codex 0.169 answers "not implemented
  yet"), shows nothing; the session stops asking and logs it once at debug.
  `thread/sample` is not used: it bills a hidden fork. The setting is read at
  each turn.
- ACP agents, pi, Muse and echo give none.

Both arrive after the turn ended, so they need the process still open: a
thread the owner is looking at, or warm minutes above zero. A process closed
at the end of the turn gives no suggestion.

The core (`threads/agent-state.ts`) keeps one suggestion per thread in memory
(at most 256 threads, 2,000 characters), tied to its turn, and publishes it as
`thread.suggestion` and in `threads.get` (`Thread.suggestion`). It drops a
suggestion that arrives for a turn that is no longer the last, that ended in
error or interruption, or while a question or permission waits. A new turn
(not a keep-alive), a sent message, an archive or a removal clears it. No
suggestion is asked for a subagent or delegated child, a mochi thread, a
workflow step or team member, a council member, a background turn or a bare
preparation (`threads/turn-context.ts`). Paired devices receive the event: it
is text they already read in the thread's answers.

The composer (`ComposerField`, `lib/prompt-suggestion.svelte.ts`) shows it
as ghost text with a Tab badge in the empty field, or as a chip above it on a
phone or touch screen. Tab or a tap writes it in as a draft to edit; it is
never sent. Esc or the chip's x hides it for that turn, on that page only. It
hides while text is typed, while sending, during dictation and behind a
question or permission.

## Claude's start deadline

A Claude CLI that never says `system/init`, for example while a stdio MCP
server keeps it waiting, would otherwise hold its thread for good. From the
first message handed to a new process, the session gives the CLI
`START_DEADLINE_MS` (90 s, `packages/core/src/drivers/claude/start-deadline.ts`)
to say it. CLI 2.1.326 says it in 0.4 s and waits 30 s for an MCP server that
never answers before it starts without it (measured on 2026-11-17), so the
deadline is three times the CLI's own bound. On expiry the session stops the
CLI through `procs.stopChild` and settles the turn only once it exited, as a
lost session (`ClaudeTurn.loseSession`): the core runs the turn once more on a
fresh session whose prompt carries the conversation, the path a refused resume
takes. A second miss fails the turn with "Claude Code did not start within
90 s". The deadline is not a setting: a user's `MCP_TIMEOUT` longer than 90 s
is cut short.

## Claude's MCP servers on demand

The [MCP server manager](mcp.md) adds the core's configured servers alongside
these Claude-specific entries.

Claude Code starts every stdio server of the user's `mcpServers` with each
session, called or not. A Claude turn hands the CLI each of those servers as a
Streamable HTTP entry under the core's `/mcp/lazy/<registration>/<name>`
instead (`packages/core/src/mcp/lazy.ts`). The entry carries
`Authorization: Bearer ${BOITE_AGENT_TOKEN}`: the CLI expands the variable from
its environment, so the token never reaches its command line. A token of
another thread gets 404, a wrong one 401.

The servers come from the `.claude.json` the CLI reads (`CLAUDE_CONFIG_DIR`,
else the home directory), without the ones its project lists under
`disabledMcpServers`. HTTP and SSE servers stay the CLI's own. A passed entry
replaces the config's server of the same name, so the CLI starts none of them.

The first session of a server starts it for the handshake and saves what it
answered (`initialize` result and the tools, prompts, resources and templates
lists) in the journal setting `mcp-manifest:<fingerprint>`, keyed by command,
arguments and environment. The folder is not in the key: each worktree would
start every server once more. Later sessions with the same MCP protocol version
get the handshake, the lists, `ping` and `logging/setLevel` from that manifest
without a process. The first other request starts the real server under the
thread, in the thread's folder, with the CLI's environment plus the server's
own and the agent variables, then forwards it. A request that comes during the
server's handshake waits for it, and one the CLI cancels meanwhile is dropped
unanswered. The server stays for the rest of
the session. Its own requests (roots, sampling, elicitation) reach the CLI on
its GET stream, or on its newest open POST stream when there is none. Once a
server is live, the core reads its lists again and saves them; when its tools
differ from what the session was given, the session gets
`notifications/tools/list_changed`.

The CLI's end releases the registration, not the turn's: a warm or viewed
session keeps its CLI across turns, and the servers it started with it. The
core then closes each server's stdin and, after 3 seconds, stops it with what
it started. The core reads a server's stdout as lines of at most 16 MiB
through the drivers' shared `LineSplitter`; a longer line fails every call the
server owed and stops it the same way. A server
whose command, arguments or environment hold a `${...}` reference stays with
the CLI, which expands it. Set `BOITE_LAZY_MCP=0` in the core's environment
to leave the user's Claude configuration with the CLI.

## Stdio transport failures

Codex, Muse and pi use `drivers/stdio.ts` for request lifetime and newline
framing; their `rpc.ts` modules retain protocol-specific envelopes. Stdout lines
are bounded to 16 * 1024 * 1024 UTF-16 code units. A final line without a newline
is processed before EOF. Non-JSON or invalid object records produce a fixed
protocol diagnostic without copying their raw output into diagnostic logs.

Oversized stdout, failed reads/writes, stdout closure or a throwing message handler
close the transport and reject all pending requests once. The session marks
that captured child non-reusable, gives its exit diagnostic a 500 ms grace and
settles any active notification-driven turn even if the prompt response already
arrived. User Stop wins over a subsequent fault or exit. Callbacks from a retired
child cannot mutate a replacement; unrelated sessions continue running.

A clean stdin close makes the captured session non-reusable and refuses new
writes while already sent requests can still receive stdout responses, including
the final record at EOF. Their existing cancellation and expiry remain active.
Drainage ends at stdout EOF/close, an
explicit failure, a read/write error or the existing 500 ms exit grace, whichever
comes first. Stdout termination or drain expiry invokes the session fault
callback; with a live child and stdout that never closes, requests settle after
500 ms and session
teardown can take a further 500 ms for its exit diagnostic.

Request cancellation and explicit expiry remove the pending request, so late
responses cannot update its result. Prompts and reported active model runs have
no default control-read timeout. Raw provider output is classified separately
and omitted from [structured diagnostics](trace.md#structured-diagnostics);
visible provider errors retain their existing user-facing behavior.

### Codex startup

If Codex exits with code 1 while `initialize` is pending and its stderr reports
`failed to initialize sqlite state runtime`, Boite retries startup twice, after
500 ms and 1,000 ms. Each attempt uses the same account and configuration.
The native thread is created or resumed only after initialization succeeds;
the prompt is sent once. Stop cancels the retry wait. Other startup failures
and failures after initialization end the turn without an automatic retry.
Each retry is logged, and a third failure keeps the agent's exit error visible.
An initialization RPC error waits up to 2 seconds for process closure and remaining
stderr before the retry decision, so a process that stays alive cannot stall it.

Every `thread/start`, `thread/resume` and `thread/fork` sends
`mcp_optional_startup_grace_ms: 10000` in its per-thread configuration, unless
`config/read` shows the user set that key, `0` included (Codex then waits for
each server's own `startup_timeout_sec`). Codex
waits that long for the MCP servers of `config.toml` before the first model
request and leaves out any server still starting; its default of about a second
is too short for a cold `npx` or `uvx` server, whose tools would then be missing
from the first turn of each new process. A server that hangs delays only that
first turn, by 10 seconds.

A thread archived in the Codex app or CLI, which share the default account's
history, makes `thread/resume` answer `session <id> is archived`. Boite then calls
`thread/unarchive` on it and resumes once more, so the thread keeps its native
history instead of failing every turn. A rollout that is gone is different: the
turn starts a new native thread and carries the conversation in its prompt.

The app-server that writes a title or a branch name starts with
`features.plugins=false` and `features.apps=false`, reads the effective
configuration of the thread's folder with `config/read`, and opens its ephemeral
thread with every MCP server listed there set to `enabled = false`. Without it,
each title would start the user's MCP servers and plugins, and a server could act
on the prompt. A Codex that refuses `config/read` writes no title: the attempt
fails with that reason rather than start the servers, and the thread keeps the
title it has.

### Codex task tracking

Boite enables `tools.update_plan.enabled` through the per-thread configuration
on both `thread/start` and `thread/resume`. Codex disables this tool by default;
listening for `turn/plan/updated` alone does not make it available to the agent.
The native plan populates the thread's activity tasks. Goal instructions explain
this mapping so the agent uses its planning tools instead of legacy Boite todos.

### Muse Code

`packages/core/src/drivers/muse.ts` speaks MSP, Muse's session protocol:
JSON-RPC 2.0 as ndjson over `muse serve`'s stdio, with its own transport rather
than `@muse-code/sdk`, because the SDK spawns its own child and every agent
process here goes through `procs.spawnChild`. The driver refuses a host whose
`initialize` answer names another envelope version than 1.

- Every command carries a client-minted UUIDv7 `commandId`, and a new session's
  id is minted the same way. A fresh turn's id is the `commandId` of its
  `turn/start`, so an item that arrives before the answer still finds its turn.
- An item notification carries the whole item so far. Text already written from
  `item/delta` is remembered per item and field, and a snapshot only adds what
  lies past it, so an answer is drawn once whichever way it arrived. Only the
  running turn's items are recorded, and the record is emptied when the turn
  ends: a delta of another turn's item (a queued one, a replay) is dropped.
- Text sent while a turn runs, an asynchronous answer or a coordination
  message, goes out as `turn/steer` naming that turn in `expectedTurnId`. A
  host whose turn already ended refuses it, and the text waits for the next turn.
- Approvals and questions arrive as `approval/requested` and
  `userInput/requested` notifications and are answered with `approval/decide`
  and `userInput/answer`. Allow sends the narrowest approving choice the host
  offers, once before session before persistent; a stop sends `abort`, or the
  denial when there is none. The server-request forms are declined.
- A missing login ends the turn with `authRequired`, which the driver turns into
  a sentence saying to sign the account in from Providers.
- `threads.compact` sends `session/compact`; a `noop` answer fails the turn
  with Muse's reason. `session/todoListChanged` fills the thread's tasks, a
  cancelled item left out, and `session/contextUsage` feeds the context meter.
- Each startup step, `initialize` and then `session/start` or `session/resume`,
  has 90 s. A host that misses it is closed and the turn fails with the step's
  name. A stop during startup closes the host at once and ends the turn
  stopped, and a stop that lands before `turn/start` or `session/compact` sends
  neither, so a stopped turn never reaches the model.
- `session/closed` retires the host, idle or not. The turn it interrupts fails
  with Muse's reason, and the next turn resumes the session on a new host.
- Closing the host ends the thread's whole process tree on Windows. On Linux
  and macOS only the direct child is killed.
- The profile sets `MUSE_NO_AUTO_UPDATE=1`, so the launcher never updates what
  Boite pinned, and unsets `META_API_KEY`, so a key in the user's environment
  never replaces the account's login.
- From Muse 1.4.13, read from `.muse-version` beside a `muse` executable, the
  host starts with `MUSE_HOST_SETTINGS` (`drivers/muse/mapping.ts`). Older
  hosts refuse `-c`, so they start as before.
  - `run.reminder_roster={}` stops Muse's skill, goal and verify reminder
    agents. Each one calls the thread's model again at every step, and the
    blocking ones hold the turn open after the answer. On 2026-10-25, through
    Douane, `muse exec --json --model muse-wonder-full-1.0-contributor
    --reasoning-effort xhigh --workspace <empty dir> "<list this folder with a
    tool, then answer ok>"`, alternated with and without
    `-c 'run.reminder_roster={}'`, took 24.1 s and 25.1 s with the reminders and
    14.8 s and 16.3 s without.

Protected shared Muse sessions require native 1.4.13 and MSP fingerprint
`sha256:7fddaf646dbc317e5fcac0785e135eb04df14fbb0db1863089dfd6da21730e5b`.
`drivers/muse/protected.ts` writes a private native configuration with only
`mcp__boite_protected__boite_exec` and `mcp__boite_protected__boite_commit` in
`run.toolset`. The native registry rejects forged calls to other tools; a
required MCP failure or unresolved name stops run preparation before inference.
The native host reads selected auth through its private config root and retains
its account refresh, model, transport and approval semantics. Only model tool
commands enter the common offline OS executor. Native discovery sees an empty
workspace and core-owned HOME/XDG roots, including foreign `CODEX_HOME` and
Claude/plugin discovery roots. External hooks/MCP/plugins and experimental
environment overrides are excluded. Native shell and writes are also
disabled. Protected cold starts create a new private session and use the core's
captured continuation; ordinary local resume is unchanged. Native 1.3.0 and
unverified versions/fingerprints remain refused. These guarantees depend on the
verified native registry gate, not its shell sandbox or a permission callback.

### pi

`packages/core/src/drivers/pi.ts` and the modules under `drivers/pi/` speak
pi's RPC mode: JSON lines over the stdio of `pi --mode rpc`.

- A turn ends on `agent_settled`, never on `agent_end`. pi retries an overloaded
  or dropped request by itself inside the same run (`auto_retry_start`,
  `auto_retry_end`) and recovers from a context overflow by compacting, so only
  the outcome of the last assistant message counts. A 529 that pi recovered
  from ends the turn done; one it gave up on fails the turn with pi's final
  error.
- An extension command or input handler can answer `prompt` without starting
  a run or sending `agent_settled`. The driver reads `get_state` after prompt
  acceptance unless the turn already settled. It ends an idle run when
  `isStreaming` is false and races the read against the terminal event. The
  read expires after five seconds; a refused read gets the same bounded window
  for a terminal event. Missing both fails and retires the session. A reported
  active model run has no default duration deadline.
- Stop sends `abort`, after `clear_queue` when coordination steered the run. A
  pi that has not settled 15 s later is closed and the turn ends stopped. The
  same holds for a pi still in its prompt preflight, which answers `abort` and
  `get_state` but holds the answer to `prompt`. A stopped turn also ends
  stopped when the core shuts down before then.
  Closing a session ends the thread's whole process tree on Windows, so a dev
  server a tool left running goes with it. On Linux and macOS only the direct
  child is killed.
- Extension dialogs (`select`, `confirm`, `input`, `editor`) become question
  cards. A dialog with a `timeout` loses its card when the time runs out,
  because pi then answers it with its default. `notify` is drawn in the turn,
  and an error notice becomes an error card that does not fail the turn.
  `setStatus`, `setWidget`, `setTitle` and `set_editor_text` get no answer and
  are not drawn.
- A warm process follows a change of model or level with `set_model` and
  `set_thinking_level`. There is no call that goes back to pi's own model or to
  no level, so either change starts a new process.
- Pi can refresh prompt caches during a turn. Refreshes between turns require
  an explicit `"cacheWarming": "idle"` in the selected Pi profile's
  `settings.json`.
- After each turn `get_session_stats` feeds the context meter with a five-second
  control-read expiry. A timed-out response is removed and cannot update a later
  turn's context.

### Hermes

Hermes Agent (Nous Research, MIT) speaks ACP through `hermes acp` on stdio. It
runs hosted models and local ones through any OpenAI-compatible server
(llama.cpp, Ollama, vLLM, LM Studio). Read against Hermes 0.21.5
(`v2026.9.24`) on Linux.

- Install, per user, no root:
  `curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s -- --skip-setup`
  puts a checkout under `~/.hermes/hermes-agent` and links
  `~/.local/bin/hermes`; on Windows `install.ps1` uses
  `%LOCALAPPDATA%\hermes\hermes-agent`. The descriptor looks on PATH, then in
  `~/.local/bin`, then in the checkout's `venv`, and on Windows in the
  checkout's `venv\Scripts\hermes.exe` first. A pinned install in a virtual
  environment of your own is
  `python3 -m venv ~/.local/lib/hermes-agent && git clone --depth 1 --branch v2026.9.24 https://github.com/NousResearch/hermes-agent ~/.local/lib/hermes-agent/src && ~/.local/lib/hermes-agent/bin/pip install -e "$HOME/.local/lib/hermes-agent/src[acp]" && ln -s ~/.local/lib/hermes-agent/bin/hermes ~/.local/bin/hermes`.
  `hermes acp --check` answers `Hermes ACP check OK`.
- Each account has its own `HERMES_HOME` (`~/.hermes`, or
  `%LOCALAPPDATA%\hermes` on Windows, for the default account). It holds the
  model and provider (`config.yaml`), keys (`.env`), sessions (`state.db`) and
  memories. An account reads `ok` once `config.yaml` exists, which `hermes`
  does not write on its own. Login runs `hermes model` in a terminal, Hermes'
  own picker for a provider and model. `skills` and `SOUL.md` are shared from
  the user's own home. The profile unsets `OPENAI_API_KEY`, `OPENAI_BASE_URL`,
  `OPENROUTER_API_KEY` and `OPENROUTER_BASE_URL`, which Hermes reads ahead of an
  account's own `.env`, plus `HERMES_SESSION_ID` and `HERMES_TUI_GATEWAY_URL`,
  which would tie the process to another Hermes.
- A local model: start the server with a window of at least 64K tokens, since
  Hermes refuses a model under that, for example
  `llama-server -m qwen2.5-0.5b-instruct-q4_k_m.gguf --alias qwen2.5-0.5b -c 65536 -fa on -ctk q8_0 -ctv q8_0 --host 127.0.0.1 --port 8089`.
  Then pick "Custom endpoint" in `hermes model`, or write the account's
  `config.yaml`:

  ```yaml
  model:
    provider: custom
    default: qwen2.5-0.5b
    base_url: http://127.0.0.1:8089/v1
    context_length: 65536
  ```

  No key is needed for a local server.
- Models: the descriptor carries `default`, Hermes' configured model. The probe
  reads `models.availableModels` from `session/new`, ids `provider:model`
  (`custom:qwen2.5-0.5b`). Hermes 0.21.5 answers no config options, so the
  model goes out as `session/set_model` with no effort; Hermes answers -32603
  while a turn runs and -32602 for a model it does not have. A refused switch,
  including a return to the configured default, stops the turn before its
  prompt. Switching can take seconds, since Hermes rebuilds its agent.
- Modes: `default` asks before edits and dangerous commands, `accept_edits`
  allows edits inside the workspace and `dont_ask` allows edits outside
  sensitive paths. `acceptEdits` and `dontAsk` map to those two, the others to
  `default`, where every request reaches Boite as a permission card answered
  with Hermes' `allow_once` or `deny`. There is no plan mode. An unanswered
  request is denied by Hermes after its own `approvals.timeout`, 300 seconds by
  default.
- Resume: `session/load` replays the history before it answers, which the
  driver drops. For a session it no longer has, Hermes answers an empty result
  instead of an error, and a prompt on that id stops with `refusal`; the `hermes`
  quirk reads a load answer without `modes` as gone, and the turn runs again on
  a new session carrying the conversation.
- Images go as ACP image blocks; `initialize` advertises them.
- Hermes' own `/` commands reach Boite as `available_commands_update`. A prompt
  sent while Hermes runs a turn is queued by Hermes for the next one; Boite
  does not send one.
- Not covered: Hermes' `main` branch starts a gateway daemon per
  `HERMES_HOME` behind `hermes acp`, which outlives the ACP process; this
  descriptor was read against the release before it.
- Live test: `BOITE_E2E_HERMES=1 HERMES_E2E_BASE_URL=http://127.0.0.1:8089/v1 HERMES_E2E_MODEL=qwen2.5-0.5b bun test test/hermes.live.test.ts`
  in `packages/core`. It refuses a non-loopback URL, so no turn leaves the
  machine.

### Mistral Vibe

Mistral Vibe speaks ACP through `vibe-acp` on stdio, a binary the
`mistral-vibe` Python package installs beside `vibe`. Read against Vibe 3.1.2.

- Install: `uv tool install mistral-vibe` (Python 3.12 or 3.13; its `rpds-py`
  does not build on 3.15 yet). The descriptor looks on PATH, then in
  `~/.local/bin`. No managed install: the release archives are PyInstaller
  folders of several hundred files.
- `VIBE_HOME` moves the whole configuration. Vibe keeps an API key in the
  system keyring when it can, else in `$VIBE_HOME/.env`. The profile sets
  `VIBE_TEST_DISABLE_KEYRING=1` on every account, the default one included, so
  the key always lands in `.env`: one keyring entry would be shared by every
  isolated account, and a key kept only there is invisible to the session
  check. A key stored in the keyring by the user's own `vibe` needs one
  sign-in from Providers.
- `MISTRAL_API_KEY` is unset at spawn, so the account's `.env` decides which
  key a turn runs on.
- Login runs `vibe-acp --setup` in a terminal: it opens Mistral AI Studio in
  the browser, or takes a key from `chat.mistral.ai/code/extensions`.
- Models come from `config.toml` and reach the probe as the `model` config
  option; effort is the `thinking` option, `off` or `high`. A proxy is a
  `[[providers]]` entry there; keep its `backend` on `mistral` for a Mistral
  model, since `generic` sends the reasoning back as message text.
- Modes: `ask` is Boite's `default`, `accept-edits` is `acceptEdits`,
  `auto-approve` is `bypassPermissions`, `yolo` and `dontAsk`. There is no plan
  mode. Vibe opens in `accept-edits`, so a thread on `default` moves it to `ask`.
- `hooks.toml` is shared but not listed as a hook source: its format is Vibe's
  own.
- Live test: `BOITE_E2E_VIBE=1 bun test test/vibe.live.test.ts` in
  `packages/core`, on the default account (`VIBE_HOME`, else `~/.vibe`). It
  spends tokens.
