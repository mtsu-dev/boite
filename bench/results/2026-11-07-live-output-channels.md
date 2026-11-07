# Live command output and stream channels, 2026-11-07

`bun run bench/live-output-channels.ts --seconds 20` on the Linux host (16
threads, Bun 1.4.2), commit f2fd0f25c, 2026-11-07 13:09 UTC.

A scratch core runs one echo turn per case: `[command:20000]` (a running
`Bash` card whose last 4,000 characters are redrawn every second, a new build
log line every 50 ms), then an 880-character answer. A second client, the
phone, opens the thread with `threads.get` and the compact options a remote
window sends, as a remote socket (non-loopback `Host`, so deflate and paced
deltas) through the counting relay of `bench/lib/wire.ts`. Bytes down are what
crossed the relay after deflate, from the moment the turn starts.

| 20 s command, phone over deflate | bytes down | message.part JSON bytes | part and delta frames | running cards with output |
|---|---:|---:|---:|---:|
| every channel (before; a phone with the card open) | 51,108 | 85,677 | 47 | 20 |
| text and tools, no liveOutput (folded cards) | 28,731 | 2,159 | 29 | 0 |

Without `liveOutput` the phone receives 44 % fewer bytes. Its `message.part`
frames shrink 97 %: the running card arrives once with its output deferred,
then the finished call whole. What remains is the turn's other events,
which no channel holds back. The first run of the day, before the review fixes,
gave 50,065 and 26,615 bytes.

The core regression test `packages/core/test/stream-channels.test.ts` counts
the same thing as frames: a socket with `['text', 'tools']` gets the running
card twice (opened, then marked deferred) and the finished call once, where a
socket with every channel gets every redraw.
