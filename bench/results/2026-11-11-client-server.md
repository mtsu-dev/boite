# Server and client hot paths, 2026-11-11

All fixtures use synthetic data, temporary journals and no live provider or
account. Bun 1.4.4 on Linux. Baseline source: `071246768ba8d490e91f91aba381dd39fb888731`.
Times below are operation costs, not whole-application latency.

## Journal reads

Command: `bun bench/journal-read-cost.ts`, 14:59 UTC. Warm in-memory SQLite,
one warm-up and nine measured samples per repeated operation, median. The
benchmark asserts equivalent results before timing the paths.

| Operation | Fixture | Before, ms | After, ms |
| --- | --- | ---: | ---: |
| Visible thread list | 2,000 rows, 100 visible | 2.668 | 0.203 |
| Page turns | 30,000 turns, 40 requested, one active | 3.767 | 0.036 |
| Final answer text | 17,825,792 tool-output characters, 11 text characters | 17.122 | 0.012 |
| Repeated context statistics | 400 messages, 13,118,000 bytes of parts | 10.730 | 0.166 |

The statistics cache's first read took 10.502 ms; reading after one changed
message took 0.160 ms. Its baseline times only the former compaction query;
the new path also includes the unchanged prompt count. Startup installs the
table and invalidation triggers without backfilling old message JSON.

For 100 paused roots with 1,000 received result letters, the pending-mail query
returns zero rows instead of materializing 1,000 results and reading 100 saved
settings. Median costs were 0.406 and 0.356 ms, too small a difference to claim
a meaningful CPU improvement. The results remain stored for resume.

## RPC queue

Command: `bun bench/frame-queue.ts`, 15:05 UTC. Five alternating pairs after
warm-up, 4,096 requests, immediate synthetic owner handlers. The baseline uses
the same queue with its former whole-Map-copy selection. Request order,
uniqueness and drained counters are asserted in every pair.

| Connections | CPU before, ms | CPU after, ms | Wall before, ms | Wall after, ms |
| ---: | ---: | ---: | ---: | ---: |
| 32 | 27.277 | 19.583 | 81.813 | 75.114 |
| 256 | 53.280 | 14.163 | 97.148 | 75.497 |
| 1,024 | 135.397 | 16.703 | 150.315 | 77.813 |

Parsing, sockets, provider work and production request mixes are excluded.
Admission limits, rotation and cancellation behavior are unchanged.

## Client scans and retained data

Command: `bun bench/rendering-stream.ts`, 15:09 UTC. Seven measured runs after
warm-up, a 1,048,582-character unfinished code block and 200 appended lines.
The calculation includes concatenation and answer-text filtering.

| Scan path | Median, ms |
| --- | ---: |
| Before | 202.208 |
| Incremental grammar, safe prefix fallback | 30.098 |
| Incremental grammar with recorded append provenance | 16.607 |

The following are deterministic counts, also covered by the UI regressions:

| Workload | Before | After |
| --- | ---: | ---: |
| Output characters retained after opening and closing 24 one-MiB tools | 25,165,958 | 0 |
| Output characters while all 24 tools remain open | 25,165,958 | 25,165,958 |
| Root rectangle reads for 100 lists and 120 separate scroll frames | 12,000 | 120 |
| Root height reads for that workload | 12,000 | 120 |
| List-position rectangle reads for that workload | 12,000 | 12,000 |
| Scroll listeners on that root | 100 | 1 |
| Template reads for one opening and 100 spaced workflow updates | 101 | 1 |
| Run reads for the same updates | 101 | 101 |

With 20 templates containing 5,000-character tasks, serialized synthetic JSON
responses total 10,404,313 characters before and 103,213 after. This is an RPC
payload count, not compressed bytes measured over a network.

Regression command:

```sh
bun run --cwd packages/ui test src/lib/store/deferred-parts.test.ts src/components/ToolCard.test.ts src/components/ToolGroup.test.ts src/components/TurnFiles.test.ts src/lib/turn-files.test.ts src/lib/rendering-stream.test.ts src/lib/scroll-coordinator.test.ts src/components/WindowList.test.ts src/components/Prose.streaming.svelte.test.ts src/lib/store/workflows.test.ts --maxWorkers=1
```

The tool retention probe counts referenced characters separately from raw heap
size. The heap did not shrink without a forced collection, so it proves no RAM
reduction. These isolated counts and string timings exclude browser layout,
native WebView2, GPU rendering, provider throughput and real network latency.

## Browser interaction

The base and branch UI fixtures ran in headless Chrome on 2026-11-11,
with the same synthetic thread, at 1,280 by 900 and 390 by 844 pixels.
After opening a deferred command, closing it and waiting for the actual fold
animation, the base retained 114,704 output characters and 114,776 characters
in tool `<pre>` bodies. The branch retained zero of either. Reopening fetched
the output again (two reads instead of one) and restored all 114,704 characters.
The edited-file diff and error output remained readable at both sizes, with
no horizontal page overflow. Captures were opened for inspection.

The final branch fixture also delayed a shared edit-output response until after
the tool card closed, while the end-of-turn diff stayed open. Both readers
shared one request; the diff received its 110,655 document characters and
114,811 input characters. Closing its last reader reduced retained documents
to zero and restored the 26-character input preview and deferred markers.
The diff cache retained zero line counters and bodies. Reopening issued a
second request. This scenario was captured and inspected at both sizes.

Template-cache regressions also cover bot children working in another entrusted
project: populated and empty parent libraries, writes from another conversation,
and local save/remove. An empty child library has no known owning project, so
template writes revalidate it; run-progress events do not.

This uses the fixture's in-memory client, not a native desktop shell or physical
phone. It measures retained content, not a process heap or total application RAM.

## Validation

`bun run check` passed after the review fixes, including architecture, all
TypeScript projects and Svelte diagnostics (zero errors and warnings).
The full UI suite passed 407 files and 3,106 tests before those fixes; subsequent
targeted runs passed 132 tool/rendering tests and 15 workflow tests. Independent
review passed another 41 tests across four files and approved round two.

`bun run --cwd packages/core test --workers 2` initially reported 4,259 passes,
145 skips and eight failures. Those eight passed on isolated reruns of their
four files (38 Git-related tests and 15 view tests). The Git fixtures needed
inherited fsmonitor and push-rewrite configuration removed; browser discovery
needed a task-local `chromium` link to the installed Chrome. These adjustments
were confined to the test environment. The entire core suite was not rerun
under that isolated environment. No live-provider or native-shell test ran.
