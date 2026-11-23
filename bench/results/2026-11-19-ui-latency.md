# Client latency baseline

UI revision `875c33e6d`, 2026-11-19, Linux amd64, HeadlessChrome/157.0.8103.50, viewport 1280 × 900 at DPR 1. Measured 18:34:28–18:39:12 UTC. `/proc/loadavg` before `19.16 29.59 39.66 14/3878 6579`, after `18.03 23.68 34.57 21/3771 7375`.

The scroll-only control ran at 18:41:07–18:41:41 UTC, load `22.00 23.94 33.42 11/3541 8076` to `22.48 23.94 33.07 14/3678 8398`. The special panel cases were repeated at 18:42:53–18:43:11 UTC, load `32.85 26.11 33.12 57/3955 8619` to `47.17 29.87 34.21 28/4288 8871`.

```sh
bun bench/ui-latency.ts --build /tmp/boite-ui-latency
bun bench/ui-latency.ts --bundle /tmp/boite-ui-latency --runs 3
```

The benchmark serves the real UI on loopback with the in-memory client and a fresh headless Chromium profile. It clears page state per case and keeps the HTTP cache cold. Chrome composites in software with SwiftShader disabled. View transitions run at their normal speed. Each cell shows the median across the successful repetitions unless specified otherwise. Browser command output includes each repeat, its load averages, raw input intervals and errors.

The paint timestamp comes from the task posted after the first animation frame with the target present. Stable includes three quiet frames after the view's DOM, geometry, finite animations and fonts settle. Click figures report paint / stable in milliseconds. They include client rendering and fake RPC work. The timings approximate rendering opportunities in headless Chrome.

The fake stores 100, 1,000 or 5,000 alternating prompts and Markdown answers. For reading cases the wheel leaves the live end before a fixture-only full snapshot prepares the transcript. All measured requests use standard paging. The stream and heap cases follow the live end during preparation. Production retention keeps 1,000 of the 5,000 messages there in this fixture.

## Composer input to paint

Each repetition delivers 48 trusted keystrokes roughly 40 ms apart. The 32 background rows stay constant in number. A running row receives progress and load events once per second. p50 and p95 below are medians of the per-run percentiles.

| Loaded messages | Running | p50 (ms) | p95 (ms) | Layouts | Main CPU (ms) | Runs |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 0 | 4.9 | 16.2 | 50 | 216.4 | 3 |
| 100 | 8 | 9.5 | 18.1 | 52 | 296.6 | 3 |
| 100 | 32 | 11.8 | 18.8 | 52 | 373.6 | 3 |
| 1000 | 0 | 4.9 | 17.3 | 50 | 209.9 | 3 |
| 1000 | 8 | 10.2 | 17.9 | 52 | 330.5 | 3 |
| 1000 | 32 | 13.0 | 20.8 | 52 | 404.4 | 3 |
| 5000 | 0 | 4.2 | 16.9 | 50 | 325.8 | 3 |
| 5000 | 8 | 10.7 | 17.9 | 52 | 497.3 | 3 |
| 5000 | 32 | 13.1 | 23.4 | 52 | 519.4 | 3 |

## Conversation and rail switches

| History | First open (ms) | First page | Leave (ms) | Reopen (ms) | Reopen page | Runs |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 57.7 / 107.1 | 40 | 34.5 / 76.9 | 51.4 / 273.3 | 100 | 3 |
| 1000 | 61.9 / 94.1 | 40 | 30.3 / 95.2 | 127.6 / 372.6 | 1,000 | 3 |
| 5000 | 78.3 / 126.4 | 40 | 109.5 / 145.0 | 52.6 / 277.3 | 40 | 3 |

Reopening uses the cache and reading anchor when available. The 5,000-message window exceeds the reading cache and reopens around its anchor from a new page. Settings is opened after reading 1,000 messages.

| Start view | Activity (ms) | Back to threads (ms) | Runs |
| --- | ---: | ---: | ---: |
| 100 | 38.1 / 78.9 | 13.5 / 293.5 | 3 |
| 1000 | 61.8 / 110.6 | 15.4 / 294.2 | 3 |
| 5000 | 146.4 / 194.8 | 21.8 / 319.0 | 3 |
| mochi-5000 | 230.5 / 273.5 | 13.8 / 295.6 | 3 |

| Mochi history | First open (ms) | First page | Reopen (ms) | Reopen page | Runs |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 130.2 / 358.5 | 40 | 97.6 / 323.3 | 100 | 3 |
| 5000 | 160.4 / 386.1 | 40 | 113.0 / 341.1 | 40 | 3 |

## Settings and panel tabs

Settings home took 49.7 / 577.4 ms across 3 runs. Open starts from the panel menu or the surface's entry point. Activate switches to an existing tab. File, Window, Desk and Browser are set up through fixture requests before timing activation.

| Tab | Open (ms) | Activate (ms) | Runs |
| --- | ---: | ---: | ---: |
| agents | 23.5 / 274.8 | 12.0 / 238.6 | 3 |
| messages | 15.9 / 262.1 | 10.5 / 242.5 | 3 |
| agent-browser | 18.8 / 267.0 | 10.7 / 243.3 | 3 |
| device | 17.0 / 263.8 | 9.9 / 242.5 | 3 |
| changes | 22.7 / 269.3 | 14.2 / 242.4 | 3 |
| files | 23.3 / 268.7 | 13.3 / 243.6 | 3 |
| tasks | 17.7 / 269.2 | 11.1 / 239.6 | 3 |
| trace | 28.5 / 273.0 | 12.5 / 239.8 | 3 |
| file | n/a | 19.7 / 248.9 | 3 |
| window | n/a | 11.7 / 241.3 | 3 |
| desk | n/a | 20.7 / 256.0 | 3 |
| browser | n/a | 29.9 / 274.4 | 3 |
| council | 151.6 / 343.7 | 44.9 / 246.7 | 3 |
| plugin | 20.6 / 252.6 | 18.1 / 265.4 | 3 |

## Frame delivery during a response

Each sample covers about 3.6 s in a thread with 5,000 stored messages and 1,000 loaded before the response. The two scroll cases apply a 5,600 px wheel gesture. Missed frames are estimated against 60 Hz from animation-frame timestamps. Long tasks are browser main-thread tasks of at least 50 ms. The scroll-only and scroll-with-response measurements had different machine loads. One of the three scroll-only runs reported two tasks of at least 50 ms.

| Scenario | Frame p95 (ms) | Worst gap (ms) | Missed frames | Deltas | Scroll events | Long tasks | Longest task (ms) | Main CPU (ms) | Runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| idle | 16.8 | 16.8 | 0 | 0 | 0 | 0 | 0.0 | 120.3 | 3 |
| only | 16.8 | 16.8 | 0 | 193 | 42 | 0 | 0.0 | 1,577.3 | 3 |
| scroll-idle | 33.4 | 66.7 | 51 | 0 | 92 | 0 | 0.0 | 1,231.7 | 3 |
| scroll | 33.3 | 50.0 | 17 | 185 | 125 | 0 | 0.0 | 1,549.4 | 3 |

## JS heap after 50 switches

The same two conversations are alternated, ending on the short one. Heap is measured after collecting garbage on both sides.

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| bytes | 14,153,764 | 15,470,272 | 1,304,152 |
| nodes | 3,568 | 3,570 | 2 |
| listeners | 354 | 354 | 0 |

There were three heap repetitions. The variation in the paired heap delta includes caches filled by revisiting the threads. A longer series or a retaining-path profile is needed to test for a leak.

## Trace reproduction

```sh
bun bench/ui-latency.ts --bundle /tmp/boite-ui-latency --runs 1 \
  --only typing/5000/32,switch/5000,tabs/5000,mochi/5000,settings,stream/scroll-idle,stream/scroll \
  --trace /tmp/boite-ui-latency-traces
bun bench/ui-latency.ts --bundle /tmp/boite-ui-latency --runs 1 \
  --only switch/1000,tabs/mochi-5000 --trace /tmp/boite-ui-latency-traces
```

Trace timings include profiler overhead and are separate from the medians. Early special panel runs missed clicks while the fixture was entering. The three samples above came from the repeat with pre-click animation settling.
