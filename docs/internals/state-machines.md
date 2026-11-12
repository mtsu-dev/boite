# State machines

Every explicit and implicit state machine in the app: its owner files, its
states, the invariants the rest of the code relies on, and a transition table
(from, event, guard, to, side effects, where the transition is written).
The last section lists the invalid states and transitions this audit found
reachable, what was fixed, and what is only suspected.

How to read the tables: a row is one transition the code performs. "Writer"
is the only place that transition should be written; a second writer of the
same state is a bug by the house rule in
[architecture](architecture.md). Line numbers are from the commit this file
landed with; the symbol beside them is the stable part.

Most core machines share two structural facts:

- The journal (SQLite) is the durable state. In-memory maps are mirrors or
  timers, rebuilt or re-armed at startup. A machine whose pending state is
  memory-only says so, because a restart then loses it by construction.
- The code is single-threaded. Races come from `await` boundaries and from
  synchronous reentry through the bus: a committed listener runs inside the
  call that emitted the event (`packages/core/src/bus.ts:58` `afterCommit`,
  `packages/core/src/bus.ts:85` `whenCommitted`). Several machines exist only
  to fence those two interleavings.

## 1. Turn

Owner: `packages/core/src/threads.ts` (`startTurn`),
`packages/core/src/scheduler.ts`,
`packages/core/src/threads/turn-runner.ts`,
`packages/core/src/threads/turn-attempts.ts`,
`packages/core/src/threads/turn-settlement.ts`,
`packages/core/src/threads/recovery.ts`.
State type: `TurnStatus` (`packages/contracts/src/turns.ts:6`):
`queued`, `running`, `done`, `stopped`, `error`. A queued turn may also carry
`queueHold` (admitted but held, for example after a core restart), which is a
sub-state of `queued`, not a status.

Invariants:

- At most one turn of a thread is `queued` or `running` at a time. Admission
  refuses a second one (`packages/core/src/threads.ts:633` `isBusy` check in
  `startTurn`); the scheduler holds one running entry per thread
  (`packages/core/src/scheduler.ts:141`).
- `done`, `stopped` and `error` are terminal. Nothing writes a turn after one
  of them lands. Settlement proves it still owns the row before writing
  (`packages/core/src/threads/turn-settlement.ts:98` `ownsTurn`).
- A request id admits at most one turn per thread: a second start with the
  same id and content returns the first turn, with different content it is
  refused (`packages/core/src/threads/inputs.ts:10` `checkTurnRequest`).
- The turn row and everything it carries (prompt message, the thread's
  `queued` status) commit together before any driver runs
  (`packages/core/src/threads.ts:722`).

| From | Event | Guard | To | Side effects | Writer |
| --- | --- | --- | --- | --- | --- |
| none | `threads.startTurn` (user, delegation, resume, operation) | thread exists, not busy, selection current, driver runnable | `queued` | prompt message written, request receipt stored, thread marked `queued`, scheduler enqueue | `packages/core/src/threads.ts:613` `startTurn` |
| `queued` | scheduler pump | no `queueHold`, team not paused, account not blocked by a plugin, provider not updating, no turn of the thread running | `running` | `startedAt` set, `turn.started` emitted, thread marked `running` or `waiting` | `packages/core/src/scheduler.ts:114` `#pump`, `packages/core/src/threads/turn-runner.ts:92` `runTurn` |
| `queued` | delegation or coordination refuses the wake at start | `prepareTurn` false, or letters cannot cross | `stopped` | letters return to the inbox in the same transaction | `packages/core/src/threads/turn-runner.ts:96`, `packages/core/src/threads/turn-settlement.ts:57` `markQueuedStopped` |
| `queued` | user stop, or shutdown drain | entry still in the scheduler queue, not held for a handoff | `stopped` | queue entry removed | `packages/core/src/scheduler.ts:83` `stop`, `packages/core/src/scheduler.ts:159` `drain` |
| `queued` with `queueHold` | `turns.recover` resume | unsent conversation prompt, thread not archived, saved account still runnable | `queued` without hold | re-enqueued under the same turn id | `packages/core/src/threads/recovery.ts:98` `recover` |
| `queued` with `queueHold` | `turns.recover` discard | none | `stopped` | scheduler entry removed | `packages/core/src/threads/recovery.ts:107` |
| `running` | driver settles `done` | settlement still owns the row (`ownsTurn`) | `done` | usage and checkpoint stored, thread rests, after-finish work runs (moves, spawns, resumes, compaction, keepalive) | `packages/core/src/threads/turn-settlement.ts:133` `settleTurn`, `packages/core/src/threads/turn-runner.ts:149` |
| `running` | driver settles `error` | as above | `error` | still-running tool parts closed as failed, thread rests in `error`, resume planning may start | `packages/core/src/threads/turn-settlement.ts:33` `finishTurn`, `packages/core/src/threads/turn-settlement.ts:79` `closeTools` |
| `running` | user stop, driver answers | stop deadline not reached | `stopped` | open cards cleared first so the driver is not parked on one | `packages/core/src/threads/turn-attempts.ts:589` `stopRunning` |
| `running` | user stop, driver never answers | 10 s, then processes ended, then 2 s (`STOP_DEADLINE`) | `stopped` with `STOP_DEADLINE_ERROR` | process tree killed, session released, result forced locally | `packages/core/src/threads/turn-attempts.ts:631` `#armStopDeadline` |
| `running` | provider refusal at capacity | fewer than 3 tries spent, core not stopping | `running` (retry wait sub-state) | thread row shows the retry and its time; slot kept | `packages/core/src/threads/turn-attempts.ts:433` `#waitToRetry` |
| `running` (retry wait) | timer, stop, or user cancel | none | next attempt, `stopped`, or `error` with the refusal | a cancel keeps the refusal as the turn's error | `packages/core/src/threads/turn-attempts.ts:421` `cancelRetry`, `packages/core/src/threads/turn-attempts.ts:589` |
| `running` | agent update wants the process | no tool call running, no blocking card | `running` (paused-for-update sub-state), then a new attempt | the agent is told it paused; same session resumes | `packages/core/src/threads/turn-attempts.ts:523` `#toolBoundary`, `packages/core/src/threads/turn-attempts.ts:547` `#pause` |
| `running` | native session lost | first time only, turn is not a keepalive | `running`, new attempt on a fresh session | session generation increments, history is carried in the prompt | `packages/core/src/threads/turn-attempts.ts:578` `#dropLostSession` |
| `queued` or `running` | core stops (crash, kill, shutdown past drain) | next core's recovery, before it accepts connections | see section 6 | never replayed blindly | `packages/core/src/threads/recovery.ts:37` `recoverStuckTurns` |

Settlement retries only the local write, with backoff, holding the scheduler
slot and the original provider result
(`packages/core/src/threads/turn-settlement.ts:133`). A result whose row no
longer matches (another execution owns it) is discarded with a log record,
never written over the newer one
(`packages/core/src/threads/turn-settlement.ts:149`).

Driver output after the core stops awaiting an attempt is dropped at the
attempt's emit wrapper (`packages/core/src/threads/turn-attempts.ts:217`
`listening`, closed in a `finally` around the driver start and its race at
`packages/core/src/threads/turn-attempts.ts:301`, so a rejected `done` or a
start that throws closes it too). Messages an attempt opened are closed with
the attempt, after its held errors go out
(`packages/core/src/threads/turn-attempts.ts:323` `closeBegan`), so none is
left `streaming` past settlement. Before this audit late output was written
into messages of a turn already settled and an open message was never
closed; see finding F2.

## 2. Thread status, archive and deletion

Owner: `packages/core/src/threads/lifecycle.ts` is the only writer of the
stored status. State type: `ThreadStatus`
(`packages/contracts/src/threads.ts:16`): `idle`, `queued`, `running`,
`waiting`, `error`. Active means `queued`, `running` or `waiting`
(`packages/contracts/src/turns.ts:159` `ACTIVE_THREAD_STATUSES`).

The status is derived, not free: it follows from the thread's turns and cards
(`packages/core/src/threads/lifecycle.ts:6`). Invariants:

- `queued` while a turn waits in the scheduler, `running` while one runs,
  `waiting` while that turn waits on a blocking card or a secret.
- Once the last turn closes: `error` when it failed, `idle` otherwise. A
  failed keepalive leaves `idle`, because it only waited
  (`packages/core/src/threads/lifecycle.ts:28` `restingStatus`).
- A finished turn makes the thread rest only when no newer queued or running
  turn owns the status (`packages/core/src/threads/turn-settlement.ts:40`).
- Other `saveThread` writers (title, context meter, session, move) spread the
  current row and never set `status`; the audit checked every call site of
  `saveThread` in `packages/core/src/threads/`.

| From | Event | Guard | To | Side effects | Writer |
| --- | --- | --- | --- | --- | --- |
| any | turn admitted | none | `queued` | none beyond the row | `packages/core/src/threads/lifecycle.ts:33` `markQueued` |
| `queued` | turn starts, or a card comes or goes | a turn of the thread is `running` in the journal | `waiting` if a blocking card or secret holds it, else `running` | none | `packages/core/src/threads/lifecycle.ts:42` `markRunning` |
| active | last turn closes | no newer active turn | `idle` or `error` by that turn | `thread.updated` after commit | `packages/core/src/threads/turn-settlement.ts:45` |
| active on disk, no active turn | startup settle | journal holds no queued or running turn | where its last turn left it | repairs a status a dead core froze mid-write | `packages/core/src/threads/lifecycle.ts:56` `settleStatus` |
| none | thread created | none | `idle` | row inserted | `packages/core/src/threads/creation.ts:97` |

Archive, restore and deletion are a second, orthogonal machine on the same
row (`archived` flag plus the deletion staging tables):

| From | Event | Guard | To | Side effects | Writer |
| --- | --- | --- | --- | --- | --- |
| present | archive (Mark done is the same write) | none | archived | turns stopped and waited for, cards cleared, subagent teams paused, PR watches ended, warm session released | `packages/core/src/threads.ts:420` `archive`, `packages/core/src/threads.ts:476` `#endArchivedWork` |
| archived | restore | project still exists | present | `thread.created` re-emitted per family member | `packages/core/src/threads.ts:529` `restoreDeleted` (deletions), archive flag cleared by update |
| present | `threads.remove` | top-level conversation, not already being deleted | staged deletion (undoable) | family archived in one commit, workflows stopped, turns and processes waited for, rows staged not erased | `packages/core/src/threads.ts:498` `remove` |
| staged deletion | retention expires | `threadDeletionRetentionDays` passed since deletion | purged | native transcripts removed | `packages/core/src/threads.ts:545` `purgeDeleted` |
| present, incognito | `threads.remove` | work stopped | erased (not undoable) | folder and transcripts deleted with the rows | `packages/core/src/threads/incognito.ts:27` `eraseIncognito` |
| archived with a worktree | checkout cleanup | exact tip merged, or checkout clean | worktree removed (`ThreadWorktreeRemoval`) | thread stays readable, cannot continue in the gone folder | `packages/contracts/src/threads.ts:112` (type), `docs/internals/architecture.md` worktree cleanup |

A pending move to another project (asked while a turn runs) is memory-only
(`packages/core/src/threads/move.ts:77` `#waiting`): a restart drops it
silently. See finding S5.

## 3. Resume plans and scheduled wakes

Two machines open turns by themselves later. Both journal their plan in one
settings row per machine and re-check everything when the plan fires.

Resume plans (`packages/core/src/threads/resume.ts`, planners in
`packages/core/src/threads/limit-resume.ts` and
`packages/core/src/threads/auto-continue.ts`). One entry per thread: an
optional `plan`, the carry-on `streak`, the last `handled` turn, the last
resume turn sent, and the usage window already resumed after
(`packages/core/src/threads/resume.ts:49` `Entry`).

Invariants:

- One plan per thread. A turn is resumed at most once (`handled`), a usage
  window at most once (`resumedWindow`), and at most two carry-on resumes in
  a row (`packages/core/src/threads/resume.ts:15` `RESUME_TIMING`, enforced in
  `packages/core/src/threads/auto-continue.ts:199` `#plan`).
- A plan caught `dispatching` by the next core is dropped, because its turn
  may have gone out (`packages/core/src/threads/resume.ts:109`). The resume
  turn carries a request id, so even a repeated dispatch admits one turn
  (`packages/core/src/threads/resume.ts:258`).
- Any real turn starting on the thread cancels the plan; a user prompt also
  ends the streak (`packages/core/src/threads/resume.ts:294` `#turnStarted`).
  A cache ping does neither.

| From | Event | Guard | To | Side effects | Writer |
| --- | --- | --- | --- | --- | --- |
| none | turn failed on a usage limit | auto-resume setting on, window not already resumed | planned at reset plus margin | thread row shows the retry | `packages/core/src/threads/limit-resume.ts:40` `turnFailed`, `packages/core/src/threads/resume.ts:148` `schedule` |
| none | turn stopped before its answer (error, crash, compaction end, background work lost) | conversation turn, not a refusal with its own retry, streak below limit | planned at 60 s, then 300 s | as above | `packages/core/src/threads/auto-continue.ts:145` `turnFinished` |
| planned | timer fires | thread idle, plan's turn still the last, selection unchanged for limits, no blocking card, team not user-paused | dispatching, then settled with no plan | resume turn admitted under a fixed request id | `packages/core/src/threads/resume.ts:241` `#fire`, guards at `packages/core/src/threads/resume.ts:273` `#refusal` |
| planned | timer fires | a cache ping holds the thread | planned, re-armed in 1 s | ping is stopped to give way | `packages/core/src/threads/resume.ts:249` |
| planned | user stop, archive, or any other turn starts | plan not dispatching | cancelled, turn marked handled | timer disarmed | `packages/core/src/threads/resume.ts:168` `cancel` |
| planned | dispatch throws before admission | none | settled with no plan | logged; the failure stays on the thread | `packages/core/src/threads/resume.ts:262` |
| dispatching on disk | core starts | none | settled with no plan | logged as uncertain, never resent | `packages/core/src/threads/resume.ts:109` |

Scheduled wakes (`packages/core/src/threads/scheduled-wakes.ts`): one pending
wake per thread, from the agent's own `ScheduleWakeup` tool call. The agent's
CLI may fire it first (`cliFired`, matched within 90 s); otherwise the core
opens the turn once the time passed and the thread stayed free for a 30 s
grace. The wake leaves the record inside the commit that queues its turn
(`packages/core/src/threads/scheduled-wakes.ts:225` `#consume`), and the turn
carries request id `wake_<toolId>`, so a crash under the start neither loses
it nor sends it twice. Stop, a user pause or an archive cancels it. One hole
remains by design, finding S1: a fire that fails for another reason keeps the
wake with no timer armed until the thread's next turn end or the next core
(`packages/core/src/threads/scheduled-wakes.ts:216`).

## 4. Cards: permissions, questions and secrets

Owner: `packages/core/src/threads/cards.ts` (permissions and questions),
`packages/core/src/secrets/store.ts` (secret cards). A card is a pending
request the driver is parked on (blocking), or an asynchronous question the
agent asked without stopping. Card state is memory plus a message part; the
part is what a reconnecting client redraws.

Invariants:

- A blocking card or an open secret card is exactly what makes a running
  thread read `waiting` (`packages/core/src/threads/cards.ts:112`
  `waitingOn`, `packages/core/src/secrets/store.ts:114` `waiting`, read by
  `markRunning`).
- Cards never outlive their turn. Settlement clears them, a stop clears them
  before stopping the driver (an unanswered card would park it forever,
  `packages/core/src/threads/turn-attempts.ts:615`), and an archive clears
  them. A card left over by a closed turn moves nothing
  (`packages/core/src/threads/lifecycle.ts:42`).
- A secret request settles exactly once: the pending map entry is the claim,
  checked by identity (`packages/core/src/secrets/store.ts:218` `#settle`).
  Its states are `pending`, then one of `saved`, `declined`, `cancelled`,
  `timed_out` (`packages/contracts/src/secrets.ts:41`). A retried `ask` with
  the same request id gets the same outcome, including after settlement
  (`packages/core/src/secrets/store.ts:168` `known`).
- A secret value in transit is claimed synchronously before the first await
  of its use, so two concurrent uses cannot share it
  (`packages/core/src/secrets/store.ts:311`). It dies with its turn, its
  thread's archive or removal, or after ten minutes
  (`packages/core/src/secrets/store.ts:345` `#onEvent`,
  `packages/core/src/secrets/store.ts:364` `sweep`).

| From | Event | Guard | To | Side effects | Writer |
| --- | --- | --- | --- | --- | --- |
| none | driver asks (permission, question) or agent runs `secrets.ask` | a turn runs on the thread (secrets) | pending; thread `waiting` if blocking | card part written, clients told | `packages/core/src/threads/cards.ts`, `packages/core/src/secrets/store.ts:151` `ask` |
| pending | user answers | card still open; secret values only over an encrypted link and before expiry | settled (`saved` for secrets) | driver unparked; a secret ref exists until its turn ends | `packages/core/src/secrets/store.ts:247` `answer` |
| pending | timer (secrets), last waiting connection closes, turn ends, stop, archive, removal | none | `timed_out` or `cancelled` | part rewritten with the outcome, thread back to `running` while its turn lives | `packages/core/src/secrets/store.ts:194`, `packages/core/src/secrets/store.ts:205` `#wait`, `packages/core/src/secrets/store.ts:287` `#closeCards` |
| pending at core death | next core starts | card part still `pending` on disk | `cancelled` on the part | no waiter survives to answer | `packages/core/src/secrets/store.ts:370` startup sweep |

## 5. Activity: goals, loops, reviews and the task list

Owner: `packages/core/src/activity.ts`, checklist in
`packages/core/src/goal-tracker.ts`. Per thread: a goal and a loop, each
`active`, `paused` or `complete` (`packages/contracts/src/threads.ts:480`),
plus the agent's task list. State is one settings row per thread; timers and
the turns it owns are memory.

Invariants:

- One active goal turn or loop iteration at a time: a run starts only on an
  idle thread (`packages/core/src/activity.ts:430` `#run`), and a loop wins
  over a goal when both are due.
- Replacing, removing or completing a goal or loop bumps its generation; a
  late finish from an older generation changes nothing
  (`packages/core/src/activity.ts:378`).
- A reviewed goal (`/goal2`) completes only on a reviewer pass. At most 5
  review rounds, then it pauses as blocked
  (`packages/core/src/activity.ts:567` `#reviewFinished`). A completion claim
  with checklist items still open goes back to the agent at most twice per
  item before the review judges alone
  (`packages/core/src/activity.ts:602` `#checklistChecked`).
- A restart pauses persisted active work instead of resuming paid work by
  itself (`packages/core/src/activity.ts:71`), except an automatic goal's
  first turn still in line, which stays the goal's
  (`packages/core/src/activity.ts:661` `firstInLine`).

| From | Event | Guard | To | Side effects | Writer |
| --- | --- | --- | --- | --- | --- |
| none | `threads.activity.set`, or an automatic goal from a long user prompt | thread exists, not archived; a reviewed goal needs a top-level thread | `active`, iteration 0 | first turn scheduled at once; an automatic goal also puts a card on the project board | `packages/core/src/activity.ts:223` `set`, `packages/core/src/activity.ts:168` `autoGoal` |
| `active` | own turn done, no completion signal | generation current | `active`, next iteration scheduled (loop: at `nextRunAt`) | loop history records the run | `packages/core/src/activity.ts:369` `#finished` |
| `active` goal | own turn ends with the complete marker | marker is the last standalone line outside code | `complete`, or review phase `reviewing` for a reviewed goal | goal listeners told | `packages/core/src/activity.ts:392`, marker at `packages/core/src/activity.ts:684` `goalSignal` |
| `active` goal | own turn ends with the blocked marker | as above | `paused` with `blocked` | resumes after the user's reply turn | `packages/core/src/activity.ts:396`, reply at `packages/core/src/activity.ts:336` |
| `active` | own turn failed or stopped, or a user turn failed | generation current | `paused` with the error | both goal and loop pause together | `packages/core/src/activity.ts:134` `#stop`, `packages/core/src/activity.ts:515` `pauseAll` |
| `active` | a housekeeping turn (compact, keepalive, coordination) failed or stopped | none | unchanged | the next goal or loop turn is scheduled as usual | `packages/core/src/activity.ts:390` (finding F1) |
| any | `threads.activity.control` pause, resume, remove, complete | a complete item cannot pause; a finished loop cannot resume | per action | pause, remove and complete stop a running review | `packages/core/src/activity.ts:271` `control` |
| review `reviewing` | reviewer turn done | reviewer still the recorded one, generation current | `complete` on pass; back to `working` with feedback; `paused` blocked after the last round | verdict recorded with its conversation | `packages/core/src/activity.ts:567` |
| persisted `active` | core starts | not an automatic goal's first turn in line | `paused`, "Core restarted" | a loop run left `running` in history becomes `error` | `packages/core/src/activity.ts:65` |

## 6. Restart: recovery and handoff

Owner: `packages/core/src/threads/recovery.ts`,
`packages/core/src/threads/handoff.ts`,
`packages/core/src/threads/auto-continue.ts`. Two different deaths:

- A planned restart (update) hands over: the stopping core records its
  running and queued turns before stopping anything
  (`packages/core/src/threads/handoff.ts:24` record, written in `begin` (handoff.ts:124)), lets
  each running turn finish its current tool call for up to 30 s, then stops
  it. The record is honoured for one hour.
- Any other death leaves `queued` and `running` rows with an empty scheduler.
  Recovery closes or holds every one before the server accepts a connection.

| Leftover | Condition | Result | Writer |
| --- | --- | --- | --- |
| `queued` or `running`, in the handoff record | record younger than an hour | queued goes back in line as it was; a cut running turn closes as `stopped` and the thread gets a `resume` continuation turn | `packages/core/src/threads/recovery.ts:46`, `packages/core/src/threads/recovery.ts:66`, continuation in `packages/core/src/threads/handoff.ts:206` |
| `queued`, never started, ordinary conversation prompt | thread present, not archived, no parent | stays `queued` with `queueHold` reason `core-restarted`; the user resumes or discards it | `packages/core/src/threads/recovery.ts:53` |
| `running`, previous core died within the hour and was not stopped on purpose | resume streak not spent | closed as `error` saying Boite resumes it; a carry-on resume is planned at startup | `packages/core/src/threads/recovery.ts:73`, `packages/core/src/threads/auto-continue.ts:87` `resumesCrashed` |
| anything else unfinished | none | closed as `error` ("send the prompt again"), streaming messages closed as error so no caret blinks forever | `packages/core/src/threads/recovery.ts:145` `#failStuckTurn` |
| thread status active, no unfinished turn | none | settled to where its last turn left it | `packages/core/src/threads/recovery.ts:91` |

The same restart also: pauses workflow runs and subagent teams a dead core
left (sections 9 and 10), ends council rounds (section 10), re-arms resume
plans and wakes (section 3), and drops plans of threads that are gone
(`packages/core/src/threads/resume.ts:89` `start`).

## 7. Background work

Owner: `packages/core/src/threads/agent-state.ts`,
`packages/core/src/threads/background-history.ts`; the derived wait state is
a pure function in `packages/contracts/src/questions.ts:136`
(`BackgroundWait`) computed in `packages/core/src/threads/records.ts:124`.

A background task (a shell or subagent the agent started) is `running`, then
`completed`, `error` or `cancelled`
(`packages/core/src/threads/background-history.ts:97` `finish`), or `ended`
when the session that reported it is gone. The thread-level wait derived from
live tasks plus history is: `waiting` while work runs or ended within the
wake grace, `interrupted` when it ended without waking the agent (failed,
cancelled, session ended, core restarted, no longer reported), else none.
An `interrupted` wait on a top-level thread plans a carry-on resume, except
when the session ended on purpose (Stop, archive)
(`packages/core/src/threads/auto-continue.ts:231` `#watchBackground`).
A checkpoint turn (the agent ended its turn to wait) is recognised by
`childEnd` in `packages/core/src/delegation/completion.ts`; workflow steps
and council members ride on the same distinction.

## 8. Composer outbox

Owner: `packages/core/src/composer.ts`,
`packages/core/src/composer-storage.ts`. What the user typed, including
prompts queued behind a running turn, is a durable record per thread or
draft. Each queued item gets a delivery row:
`creating` (a draft starting its conversation), `submitting`, `delivered`,
`uncertain` (`packages/core/src/composer-storage.ts:10` `Delivery`).

Invariants:

- One pump per record at a time; a schedule during a pump only marks it dirty
  (`packages/core/src/composer.ts:145` `#schedule`).
- A submission is reserved (`submitting`) in the same commit that admits its
  turn, under a request id the turn ledger dedups. A crash therefore cannot
  send the same prompt twice: at startup a `submitting` row is reconciled
  against the turn receipt, becoming `delivered`, `uncertain`, or released
  when no receipt exists (`packages/core/src/composer.ts:62` `start`).
- `uncertain` holds the queue (`paused`) for the user to review; a reconnect
  cannot clear that hold (`packages/core/src/composer.ts:128`).
- A draft launch is reserved as `creating` before any thread is made, and the
  thread publication, the queue transfer into it and the `delivered` write
  commit together (`packages/core/src/composer.ts:306`,
  `packages/core/src/composer.ts:318`). A second launch of the same draft is
  refused from the receipt, never repeated.

| From | Event | Guard | To | Writer |
| --- | --- | --- | --- | --- |
| queued item | thread idle, or a tool boundary while running, or "send now" | no blocking card; steering needs the same selection the item was queued with | `submitting`, then `delivered` in the turn's commit | `packages/core/src/composer.ts:171` `#pump`, `packages/core/src/composer.ts:264` `#reserve`, `packages/core/src/composer.ts:268` `#complete` |
| `submitting` | steering refused, nothing admitted | none | released (row deleted), item stays queued | `packages/core/src/composer.ts:223` |
| `submitting` | error after reserve | none | `uncertain`, record paused with the reason on the item | `packages/core/src/composer.ts:245`, `packages/core/src/composer.ts:279` `#hold` |
| `submitting` at startup | core starts | turn receipt exists and is not pending, pending, or absent | `delivered`, `uncertain`, or released | `packages/core/src/composer.ts:69` |
| draft item | launch | no earlier launch receipt for this draft item | `creating`, then `delivered` with the new thread id | `packages/core/src/composer.ts:288` `#launch` |

## 9. Workflows

Owner: `packages/core/src/workflows.ts` (graph), steps on other machines in
`packages/core/src/workflows/machine-steps.ts` and shared compute in
`packages/core/src/workflows/shared-compute.ts`. One run is one JSON record.
Run states: `running`, `paused`, `done`, `failed`, `stopped`
(`packages/contracts/src/workflows.ts:86`). Node and instance states:
`waiting`, `running`, `done`, `failed`, `skipped`, `stopped`
(`packages/contracts/src/workflows.ts:87`).

Invariants:

- Every change reloads the run from SQLite first, because a step's turn can
  end inside the `startTurn` that launched it
  (`packages/core/src/workflows.ts:44`). One advance at a time per run; a
  reentrant advance only asks for one more pass
  (`packages/core/src/workflows.ts:295` `#advance`).
- A step opens only when every dependency is `done` or `skipped`; at most
  `maxConcurrent` instances run (`packages/core/src/workflows.ts:312`
  `#step`). At most 3 unfinished runs per thread
  (`packages/core/src/workflows.ts:240`).
- A failed or stopped instance halts new launches; instances that never
  launched read `stopped` with "not started" so a retry can tell them from a
  real stop (`packages/core/src/workflows.ts:475` `#settleNodes`).
- Node and run states are derived from instances in one place
  (`packages/core/src/workflows.ts:454` `#settle`). A paused run with a
  failure stays paused; it fails only once resumed, where retry is offered.
- Start, extend and each output correction are idempotent under their request
  ids (`packages/core/src/workflows.ts:199` `#request`); a structured output
  that misses its shape gets a bounded number of correction turns
  (`packages/core/src/workflows.ts:536`).
- A stop is recorded on the run before its turns are stopped, so their
  finishes land in a run that is no longer running
  (`packages/core/src/workflows.ts:815` `#stop`).

| From | Event | Guard | To | Side effects | Writer |
| --- | --- | --- | --- | --- | --- |
| none | `workflows.start` | root thread, plan valid, routes exist, fewer than 3 unfinished runs | run `running`, nodes `waiting` | first steps launch as child threads | `packages/core/src/workflows.ts:229` `start` |
| node `waiting` | dependencies done or skipped | `when` condition holds; fan-out list resolves; step budget left | node `running` with `waiting` instances, or `skipped`, or `failed` | none yet | `packages/core/src/workflows.ts:358` `#open` |
| instance `waiting` | capacity free | run `running`, not halted | `running` | child thread created or reused, its turn started | `packages/core/src/workflows.ts:392` `#launch` |
| instance `running` | its turn finishes | instance still `running` on that thread | `done`, `failed`, `stopped`, or back to `waiting` for an output correction or a restart handoff | worktree settles, then the run advances | `packages/core/src/workflows.ts:498` `#turnFinished`, `packages/core/src/workflows.ts:561` `#ended` |
| instance `running` at core death | next core constructs the store | none | `waiting` with "interrupted by a core restart"; run `paused` unless handed over | nothing paid resumes by itself after a crash | `packages/core/src/workflows.ts:84` |
| run `running` | team paused, or `workflows.control` pause | none | `paused` | running steps still finish theirs; nothing new launches | `packages/core/src/workflows.ts:320`, `packages/core/src/workflows.ts:736` |
| run `paused` | resume | caller may lift the pause that holds it | `running` | team resumed with it when the caller owns that pause | `packages/core/src/workflows.ts:740`, `packages/core/src/workflows/resume.ts` |
| run `running` or `paused` | stop, root archived or stopped | none | `stopped`, marked delivered (nothing is told) | running step turns stopped after the record lands | `packages/core/src/workflows.ts:747`, `packages/core/src/workflows.ts:851` `stopRoot` |
| run not `done` | retry (whole run or one step) | every still-broken step is named or none is | broken instances `waiting`, run `running`, undelivered again | a step whose conversation was archived gets a new one | `packages/core/src/workflows.ts:751` |
| instance `failed` or `stopped` | a turn starts in its conversation by hand | run `running`, `paused` or `failed` | instance and node `running` again; a `failed` run reopens | steps stopped only because of it wait again | `packages/core/src/workflows.ts:628` `#adopt` |
| run `running` or `paused` | last instance settles | no instance `running` | `done` when every node is done or skipped; `failed` when one failed and the run was running | summary delivered to the root as one turn once it is idle | `packages/core/src/workflows.ts:454` `#settle`, `packages/core/src/workflows.ts:675` `#deliver` |

Delivery is at-least-once: the summary turn starts first and `delivered` is
written after, in a separate write, so a crash between the two repeats the
summary after the restart. See finding S6.

## 10. Council

Owner: `packages/core/src/council/store.ts`. States: `running` (a round is
under way), `waiting` (between rounds), `done`, `stopped`, `failed`
(`packages/contracts/src/council.ts:63`), plus a legacy `summarizing` read
from rows written by the debates it replaced. Each member is `pending` or
not for the current round, with `absent` rounds and one score per round.

Invariants:

- One round at a time. A new round (`again`) requires the last round's
  answers delivered to the parent first
  (`packages/core/src/council/store.ts:389`), and a request id makes a retry
  start no second round (`packages/core/src/council/store.ts:383`).
- A member's answer is recorded once per round: the finish handler checks the
  member is still pending and that the turn is the one asked this round
  (`packages/core/src/council/store.ts:613`). A checkpoint turn (waiting on
  its own background work) is not an answer unless a score line closes it.
- Every mutation reloads the council from SQLite, for the same reason as
  workflows (`packages/core/src/council/store.ts:183` `#mutate`).
- A core that died ends its rounds as `stopped` rather than resuming paid
  work; a handoff re-arms deadlines and re-asks cut members
  (`packages/core/src/council/store.ts:113`,
  `packages/core/src/council/store.ts:817` `resumeAfterRestart`).

| From | Event | Guard | To | Side effects | Writer |
| --- | --- | --- | --- | --- | --- |
| none | `council.start` | experiment on, parent may delegate, every named route runnable | `running`, round 1 | salon and member threads created before the first question; a failure leaves no half-made council running | `packages/core/src/council/store.ts:280` `start`, `packages/core/src/council/store.ts:455` `#beginRound` |
| member pending | its turn finishes with an answer | turn is this round's | member settled, score read from its last line | answer posted in the salon | `packages/core/src/council/store.ts:597` `#turnFinished`, `packages/core/src/council/store.ts:662` `#record` |
| member pending | turn failed, stopped, empty, or background work lost | as above | settled with what it wrote, or absent with no score | system post says why | `packages/core/src/council/store.ts:655` `#settle`, `packages/core/src/council/store.ts:513` `#absent` |
| `running` | nobody pending, or deadline, or `council.closeRound` | round above 0 | `waiting`, answers undelivered | answers and table go to the parent once it is idle | `packages/core/src/council/store.ts:576` `#closeRound`, `packages/core/src/council/store.ts:765` `#deliver` |
| `waiting` | `council.again` | answers delivered, parent not archived, team not paused | `running`, next round | the parent's changes posted for the members | `packages/core/src/council/store.ts:376` `again` |
| `waiting` | `council.stop` | none | `done` | an undelivered last round still goes to the parent | `packages/core/src/council/store.ts:441` |
| `running` | `council.stop`, parent stop or archive | none | `stopped` | member turns stopped, nothing delivered | `packages/core/src/council/store.ts:442`, `packages/core/src/council/store.ts:447` `stopParent` |
| any | parent removed for good | removal not undoable | rows and salon deleted | members' mapping forgotten | `packages/core/src/council/store.ts:796` `#forget` |

`#save` bumps a `version` clients reload on, but the UPDATE carries no
version guard (`packages/core/src/council/store.ts:174`); every writer is
synchronous today, so this is a latent fence, finding S7. Delivery has the
same at-least-once window as workflows (`packages/core/src/council/store.ts:777`).

## 11. Pull request watches

Owner: `packages/core/src/pull-request-watch.ts`; the pure change evaluation
is `packages/core/src/pull-request-watch-read.ts`. Per watch: a durable
record (memory of what was seen, fingerprint, pending changes, `ended`) and
a runtime entry (next read time, failures, paused reason)
(`packages/core/src/pull-request-watch.ts:30`,
`packages/core/src/pull-request-watch.ts:52`).

| From | Event | Guard | To | Side effects | Writer |
| --- | --- | --- | --- | --- | --- |
| none | `boite pr watch` | open pull request on the configured host, fewer than 10 watches | watching, baseline read | the first read is the answer to the caller and wakes nothing | `packages/core/src/pull-request-watch.ts:126` `watch` |
| watching | fingerprint moved | read due, not rate limited | watching, changes pending since now | next read at the burst's end (20 s coalesce) | `packages/core/src/pull-request-watch.ts:223` `#read` |
| changes pending | burst settled and thread at rest | thread not busy, not archived | delivered as one `pull-request` turn; `ended` watches removed after telling | a failed start retries after an interval, never in a tight loop | `packages/core/src/pull-request-watch.ts:362` `#deliver` |
| watching | pull request merged or closed by someone else | closer known and not the agent's own account | `ended`, told once, then removed | own merges and closes end the watch silently at once | `packages/core/src/pull-request-watch.ts:301` `#end` |
| watching | GitHub unreachable or rate limited | none | paused with exponential backoff up to 15 min; a rate limit pauses every watch | the pause and its reason show on the thread row | `packages/core/src/pull-request-watch.ts:274` |
| watching | thread archived, stopped or removed; `pr unwatch` | none | removed, including its delegated agents' watches | durable row deleted | `packages/core/src/pull-request-watch.ts:172` `endThread` |

A stop or unwatch that lands during the network reads wins: the read checks
record identity after each await and writes nothing for a replaced record
(`packages/core/src/pull-request-watch.ts:253`).

## 12. Providers, accounts and plugins

Provider install (`packages/contracts/src/providers.ts:97`): `absent`,
`downloading`, `verifying`, `extracting`, `installed`, `failed`. The three
middle states exist only while `providers.install` runs; `failed` keeps its
reason until the next attempt. A self-updating agent's standing is a second
machine, `idle`, `checking`, `updating`, `failed`
(`packages/contracts/src/providers.ts:140`); while `updating`, the scheduler
holds new turns of that provider and running ones pause at a tool boundary
(section 1). Account status is a read model, not a stored machine:
`unknown`, `ok`, `unauthenticated`, `error`
(`packages/contracts/src/accounts.ts:10`), refreshed by probes and logins; a
turn admission refuses an unauthenticated account
(`packages/core/src/threads/admission.ts:9`).

Plugins have an install machine (`not-installed`, `installed`, `installing`,
`error`, `rejected` with the refusing file and field,
`packages/contracts/src/plugins.ts:289`) and, for plugins that run a process,
a process machine (`stopped`, `starting`, `running`, `updating`, `crashed`,
`packages/contracts/src/plugins.ts:170`). One-shot plugin commands are not
stateful: each run spawns under its own trace id, is killed at its timeout,
and core shutdown kills and waits for those still running
(`packages/core/src/plugins/runs.ts:86`, `packages/core/src/plugins/runs.ts:172`).

## 13. Client side

Connection (`packages/ui/src/lib/ws-client.ts`): `idle`, `connecting`,
`ready`, `closed` (`packages/ui/src/lib/client.ts:10`). One opening attempt
at a time; concurrent `connect` and `wake` calls join it
(`packages/ui/src/lib/ws-client.ts:153`,
`packages/ui/src/lib/ws-client.ts:191`). A socket that stays silent under a
probe is replaced and its pending calls rejected; a revoked session closes
the client for good. Calls made while not `ready` fail at once instead of
queueing (`packages/ui/src/lib/ws-client.ts:229`), so the UI never holds a
second, divergent queue of user intent: the composer's durable outbox
(section 8) is that queue.

The thread row state is derived on the client from the stored status plus
background work, open questions, delegated agents and watches; it writes
nothing back (`packages/ui/src/lib/thread-state.ts:13` `ThreadState`,
`packages/ui/src/lib/thread-state.ts:42` `threadState`). Its one invariant
worth naming: `waiting` (the user's turn) outranks everything except the
thread's own `error` next to a subagent's question.

Settings autosave (`packages/ui/src/lib/autosave.svelte.ts:10`): `idle`,
`waiting`, `saving`, `saved`, `invalid`, `error`. One write in flight; a
change during a save goes after it with the latest value, so two writes
never race one revision (`packages/ui/src/lib/autosave.svelte.ts:63`
`drain`). A failed write reads `error` with a retry, never `saved`.

The in-memory fake client (`packages/ui/src/lib/fake-client.ts` and its
folder) implements the same contract for tests and the design preview; it is
a second implementation of sections 1, 2, 5, 9 and 10 at demo fidelity, held
to the contract by `packages/ui/src/lib/fake-client.contract.test.ts`.

## 14. Smaller machines

| Machine | States | Owner | Notes |
| --- | --- | --- | --- |
| Project todos | `open`, `claimed`, `done` | `packages/contracts/src/todos.ts:13`, `packages/core/src/todos.ts:169` | a claim is by thread; an agent adds cards only under a cap |
| Shared compute jobs | `queued`, `running`, `waiting`, `uncertain`, `done`, `failed`, `cancelled`, `revoked` | `packages/contracts/src/shared-projects.ts:186`, `packages/core/src/contacts/compute.ts:499` | `uncertain` is the cross-machine twin of the composer's: the host may have started it |
| Team post delivery | `waiting`, `delivered`, `held`, `expired`, `rejected`, `unreachable` | `packages/contracts/src/teams.ts:97` | per member of a post |
| Coordination letters | `queued`, `received`, `delivered`, `uncertain`, `expired`, `rejected` | `packages/contracts/src/coordination.ts:111` | a wake that cannot cross returns its letters to the inbox (section 1) |
| Cache keepalive | idle or pinging per thread | `packages/core/src/threads/cache-keepalive.ts:41` | a ping is a `keepalive` turn; real work preempts it through `yieldTo` |
| Tool parts | `running`, `done`, `error`, `denied` | `packages/contracts/src/messages.ts:18` | a part left `running` by a closed turn is closed as `error` at settlement |
| Message stream | `streaming`, `complete`, `error` | `packages/contracts/src/messages.ts:271` | recovery closes leftovers as `error` (section 6) |
| Pairing preconditions | Tailscale and firewall enums | `packages/contracts/src/pairing.ts:44`, `packages/contracts/src/pairing.ts:80` | read models of the host, recomputed per ask |
| Mobile devices | `stopped`, `booting`, `running`; stream `off`, `starting`, `live`, `failed` | `packages/contracts/src/mobile-devices.ts:34` | owned by the shell side; the core mirrors |
| App update (UI) | phases in `packages/ui/src/lib/app-update.svelte.ts:7` | shell plus UI | one update attempt at a time; a failed check keeps the last known state |

## 15. Findings

Confirmed means reproduced by a test that failed before the fix (RED) and
passes after it (GREEN). Suspected means the path is traced in code but no
reproduction was built; those stay documented, unfixed, and say why.

### Confirmed and fixed with this audit

**F1. A failed housekeeping turn paused the thread's goal and loop.**
Impact: a goal or loop silently stopped, showing another turn's error, until
the user noticed and resumed it. Interleaving: a loop waits out its interval
with the thread idle; an automatic compaction, a cache ping or a coordination
wake runs in that window and fails or is stopped;
`packages/core/src/activity.ts` `#finished` treated every non-`done` turn the
activity did not own as a reason to pause both modes. Fix: turns whose
operation is `compact`, `keepalive` or `coordination` never pause activity
(`packages/core/src/activity.ts:390`), the same exclusion automatic resumes
already used. Regression test: "a failed compaction between loop iterations
pauses nothing" in `packages/core/test/activity.test.ts`. RED before the fix:
`Expected: "active", Received: "paused"`.

**F2. Output written after a forced stop landed in messages of a settled
turn.** Impact: a driver that ignores its stop (the exact case the stop
deadline exists for) could keep writing into a conversation whose turn the
core had already closed: new message rows under a finished turn, messages
left `streaming` for good, progress events for a turn that no longer runs.
Interleaving: user stops; the driver never settles; the deadline kills its
processes and forces a `stopped` result
(`packages/core/src/threads/turn-attempts.ts:631`); settlement closes the
turn; the still-live driver later calls its emit, which wrote straight to
the journal and the bus with no turn-state check
(`packages/core/src/threads/turn-context.ts:161` `publishPart`). Two holes
in the first version of this fix were caught in review and are fixed with
it: a message the driver had opened before the forced stop was left
`streaming` for good (its late completion is dropped, and settlement closed
tools, not messages), and a `done` that rejected, or a `startTurn` that
threw, skipped the gate's close, so writes still landed after the turn
settled as `error`. Fix: the attempt's emit wrapper closes in a `finally`
around the driver start and the race against the forced result
(`packages/core/src/threads/turn-attempts.ts:217`,
`packages/core/src/threads/turn-attempts.ts:301`); late parts, deltas,
patches, completions and step decisions are dropped. Every message the
attempt opened is tracked (`packages/core/src/threads/turn-attempts.ts:221`)
and closed with the attempt, after the held-error flush
(`packages/core/src/threads/turn-attempts.ts:323`), or as `error` when the
attempt itself failed (`packages/core/src/threads/turn-attempts.ts:299`);
closing one already closed changes nothing at the sink. The held-error
flush still uses the sink directly, so nothing a well-behaved driver wrote
in time is lost. Regression tests: "output a wedged driver writes after its
forced stop reaches no message" (with partial output written before the
stop) and "output written after a driver failure reaches no message"
(rejected `done` and throwing `startTurn`) in
`packages/core/test/stop-deadline.test.ts`. RED before the fixes: a second
message appeared in the thread; the partial message stayed `streaming`;
after a rejection or a throwing start, a late write created a third
message.

**F3. The queued-stop writer rewrote terminal turns.** Impact: any caller
that reached it with a turn no longer `queued` transitioned a closed turn
(`done` became `stopped`), re-stamped `finishedAt`, rested the thread again
and emitted a second `turn.finished`, which every finish listener
(workflows, council, activity, auto-continue) would process a second time.
Today's callers all guard by construction (scheduler queue membership,
recovery's explicit check), so no production interleaving was traced; the
writer itself is the defect, since it is the one place the "a closed turn
never transitions" invariant of section 1 can be enforced for this path.
Fix: `markQueuedStopped` returns unless the turn is still `queued`
(`packages/core/src/threads/turn-settlement.ts:57`). Regression test: "a
queued stop never rewrites a turn that already finished" in
`packages/core/test/turn-settlement.test.ts`. RED before the fix:
`Expected: "done", Received: "stopped"`.

### Suspected, not fixed

**S1. A scheduled wake whose fire fails has no timer until the thread's next
turn end or the next core.** `packages/core/src/threads/scheduled-wakes.ts:216`
keeps the wake and arms nothing, by the stated design in that branch. Trace:
the thread is idle, the wake comes due, `startTurn` throws (for example the
account was signed out, so admission refuses); the user signs back in, which
ends no turn, so nothing re-arms the wake and the agent's loop stops without
a word on the thread. Not fixed here: re-arming with a delay would retry and
log forever for permanent refusals, and cancelling instead would lose wakes
on transient refusals the current design deliberately saves. It needs a
product choice (bounded retries with a visible end), not a local patch.

**S2. A resume dispatched can overwrite a plan scheduled reentrantly during
its own start.** `packages/core/src/threads/resume.ts:264` reloads the record
after `startTurn` and settles the entry unconditionally. If anything during
that synchronous start scheduled a new plan for the same thread, `settled`
strips it while its timer stays armed; the timer later fires on an entry
with no plan and the resume never happens. No current caller was traced
scheduling from inside `startTurn` (auto-continue schedules from turn
settlement, which is after an await), so this is latent. A fix settles only
when the entry still holds the dispatching plan.

**S3. A stop asked during a turn's synchronous start can be lost.** The
scheduler registers its running entry after calling `runTurn`
(`packages/core/src/scheduler.ts:145` `#start`), and committed listeners of
`turn.started` run inside that first synchronous stretch. A `stop` from such
a listener finds neither a queue entry (deleted just before) nor a running
entry, returns false, and the turn runs on. No current listener stops from
`turn.started`; `stopRunning` also covers the preparing window once attempts
open (`packages/core/src/threads/turn-attempts.ts:606`). Registering the
running entry before the call closes it.

**S4. Held async answers can be delivered twice if `startTurn` throws after
admission.** `packages/core/src/threads/deferred.ts:160` removes the answers,
starts their turn, and puts them back on any throw; a throw after the turn
was admitted (from the calls after the admission commit in
`packages/core/src/threads.ts:754`) leaves both the admitted turn carrying
the answers and the restored copy for the next prompt. The window is the two
lines after the commit; neither is known to throw today.

**S5. A pending thread move is lost on restart.** The wait is a memory map
(`packages/core/src/threads/move.ts:77`); the user was told "moves after this
turn", and a restart in between forgets it with no notice. Fixing it means
journaling the request like the move note already is; left as a documented
gap rather than widened here.

**S6. Workflow and council summaries are at-least-once across a crash.** Both
start the delivery turn first and write `delivered` after, in a separate
write (`packages/core/src/workflows.ts:686`,
`packages/core/src/council/store.ts:777`). A crash in between repeats the
summary turn after the restart. The composer outbox and scheduled wakes
already show the exactly-once shape (reserve in the admission commit, fixed
request id); applying it here is a small follow-up per machine.

**S7. Council saves carry a version with no write guard.**
`packages/core/src/council/store.ts:174` updates by id only. Every mutation
is a synchronous load-change-save today, so no lost update is reachable; the
first await introduced inside a `#mutate` change would open one. Workflows
have the same shape and the same discipline
(`packages/core/src/workflows.ts:141` `#save`).

### What was checked and held

The turn machine's fences (ownership check at settlement, request-id
admission, one writer of thread status), secret claim-once and transit
claim-before-await, workflow and council reload-before-change with
stop-recorded-first, composer startup reconciliation, PR-watch
identity-check-after-await, and the resume planner's dispatching drop were
each traced against their interleavings and hold as documented above.



