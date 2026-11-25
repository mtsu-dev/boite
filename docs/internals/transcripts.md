# Conversation storage

What a machine keeps of a conversation as it ages: the agents' own session
files are rewritten into one compact format, kept for audits, and erased when
the owner's mode says so. Settings > General > Conversation storage picks the
mode; the user's page is [Conversations](../conversations.md#conversation-storage).

Nothing runs until a mode is saved. With `transcriptStorage` unset the engine
plans and measures only, and the older delay (`threadDeletionRetentionDays`)
keeps purging deleted conversations as before.

## Modes

A mode is a `TranscriptPolicy` of four delays in days, `null` for never
(`packages/contracts/src/transcripts.ts`):

| | `idleCompactDays` | `deletedCompactDays` | `deletedEraseDays` | `imagesEraseDays` |
| --- | --- | --- | --- | --- |
| Delete | never | 0 | 7 | 7 |
| Classic | never | 7 | never | 30 |
| Storage | 30 | 30 | never | never |
| Custom | the owner's | the owner's | the owner's | the owner's |

- `idleCompactDays`: an open conversation nothing wrote to for that long has
  its provider sessions archived and their files removed. The conversation
  stays whole in the app, whose journal is untouched; a reply starts a fresh
  agent session from the journal ([lost sessions](model-switching.md)).
- `deletedCompactDays`, counted from the deletion: the conversation leaves the
  journal and the Deleted list, so it no longer restores. Its journal content
  and its provider sessions are archived first.
- `deletedEraseDays`: the archive of a deleted conversation is erased too.
- `imagesEraseDays`: the images of a deleted, compacted conversation go; the
  records keep each reference with its size and type. A PDF or another
  binary is no image and stays as long as the conversation does.

Usage survives every step: the journal keeps a removed turn's usage
(`removed_turn_usage`), and the archive's index keeps each turn's status,
times, usage and error after the records are erased.

## What compaction keeps

Every user message, every assistant text and reasoning, every tool call with
its whole input, every error and non-zero exit, in the provider's order with
its timestamps. It shrinks:

- a tool output past 16 KiB (64 KiB for a failed tool): head, tail and the
  error lines between them, with the original size and SHA-256;
- fields a session writes twice (a tool result's second copy, the request
  bodies a session logs beside its messages, repeated usage of one response);
- base64 payloads: each becomes `{ "$blob": <sha256>, "bytes", "mime" }` and
  is stored once for the machine, a PNG or JPEG as WebP (quality 80) when
  that is smaller.

Encrypted reasoning and signatures an agent cannot read back are dropped. A
file published as an artifact stays a reference: its bytes belong to the
artifact store.

## Files

Under `<data dir>/transcripts/`:

- `sessions/<conversation>/<session>.jsonl.zst`: one record a line, zstd level
  19 with long-distance matching. The session `journal` is the conversation
  as the app showed it, the others are the agent's own sessions (Claude Code,
  Codex), subagents included: Claude Code's `subagents/` files, and a Codex
  rollout whose `session_meta` names the session that spawned it.
- `blobs/<aa>/<sha256>.<ext>`: images and other binary payloads, once each.
- `index.db`: SQLite. `threads` (title, project, model, dates, `erased_at`),
  `sessions` (source, sizes, hash, first and last time), `turns` (status,
  times, usage, error), `failures` (session, line, kind, tool, text),
  `blobs` and `blob_refs`. It uses a rollback journal, and reads open it
  read-only until something is archived: a preview leaves no file beside it.

A record is `{ "k": <kind>, "t": <time>, ... }`: `user`, `assistant`,
`reasoning`, `call`, `result`, `usage`, `turn`, `system`, `context`, `other`.
A payload leaves a record for the blob store only when it is base64 from its
first character to its last and decodes back to the same text; in a tool's
input, only an image or document part or a data URL does.
Read them with `zstd -dc <file> | jq`, or through the core.

## Reading the archive

`transcripts.list`, `transcripts.failures` and `transcripts.read` answer the
owner and agents (`AGENT_METHODS`: the owner wants agents to audit past
conversations), never a paired device. An agent passes its own `threadId` and
the archived conversation as `conversation`. `boite transcripts` wraps them
([CLI](cli.md#transcripts)). A read answers at most 500 records or 256 KiB
and says where to resume.

## The pass

`Transcripts` (`packages/core/src/transcripts/engine.ts`) plans from three
reads: the provider sessions on disk in every account directory
(`locate.ts`: links never followed, and a `projects` or `sessions` folder
that is itself a link is not scanned), the sessions the journal names
(`namedSessions`), and the conversations with their deletion dates. It runs
120 seconds after start, every hour, and when the mode changes; so "at once"
is within the hour.

Each session is written by the reader worker (`artifact-retention-worker`,
one request per worker), read back and compared by hash before any source
file is removed, and a source file written to since the scan is left for the
next pass. A turn in progress, an import under way and an incognito
conversation are skipped.

Removal takes the files the scan read, one by one and each checked again
(the same inode, size, write and change times), then the session's folders
left empty: a file the archive does not read, or one put in its place, stays
where it is. A session id two accounts hold is left alone: the journal names
a session by its id only and cannot say whose it is. A
deleted family leaves the journal only once every one of its sessions is
archived; one that is being imported or was written since the scan puts the
whole family off to the next pass, since the journal is the only thing that
says whose session it is; a session archived before a late write keeps that
archive, and the next pass adds one of the whole file. A pass stops before
its next step, and removes no more files, when the setting it was planned
for changes.

`transcripts.preview` runs the same plan for any policy and writes nothing.
The bytes a step would erase are exact; the bytes compaction frees are the
planned bytes times a ratio measured on up to six of the machine's own
sessions (64 MiB read at most, cached for an hour).

Sessions no conversation names (left by conversations purged earlier, or by
agents working for agents) are counted in the preview. Only
`transcripts.compactUnlinked` archives them, under `session:<id>`, only in
account directories Boite made, and no mode erases them.

## Limits

- The journal file does not shrink when conversations leave it; SQLite reuses
  the pages.
- Only Claude Code and Codex sessions are read from disk. Another agent's
  conversation is archived from the journal alone.
- A filesystem that already compresses (btrfs, ZFS) frees less than the byte
  counts say.
