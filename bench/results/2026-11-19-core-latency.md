# Core turn latency, 2026-11-19

Linux x64, 16 logical CPUs, Bun 1.4.4, core from commit
`875c33e6d`. The run started at 18:11:26 UTC on a shared host.

```sh
cat /proc/loadavg
bun bench/core-latency.ts --runs 5 > /tmp/boite-core-latency.json
```

The bench starts a fresh temporary core and sends JSON-RPC over loopback.
Each of the 54 cases has five samples. The JSON output keeps the samples,
start and end load averages, and the separate creation, admission, stop
reply, process-exit and idle timestamps as elapsed milliseconds.
Each sample steers after the first text and stops after the steer output.

- First text runs from the send to receipt of the first nonempty assistant
  text `message.delta`. New conversations include `threads.create`.
  Existing ones start from a completed warm-up exchange. The scripted
  cold case closes the native process, keeping the session ID. The warm
  case checks that the same PID replies. Echo runs in the core and takes
  the same resumed path in both cases.
- Steer acceptance is the `turns.steer` reply. Steer output is the first
  text delta that contains the follow-up marker. The scripted process
  checks for input between 8 ms sleeps. The Echo fixture includes 24 ms
  sleeps between short pieces of text.
- Stop runs from `turns.stop` to the last of the stopped turn, the idle
  thread, and the scripted process exit. The scripted agent waits 24 ms
  after it notices the interrupt, 25 ms before its first output, and 75 ms
  to open or resume a native session.
- The active count includes the measured conversation. The background
  threads stream into the journal without a client subscription to their
  text. At 32 active threads, each sample saw 207–340 background deltas
  with Echo and 281–624 with the scripted agent. The client received zero
  of those deltas.
- Entry counts include the warm-up pair. Earlier entries are short synthetic
  messages paired into completed turns with usage. The workspace starts
  empty and all threads share it. Concurrent turns can make the final file
  checkpoint unavailable, so stop measurements across concurrency levels
  can include different checkpoint work. Session generation stays fixed and
  prompt suggestions are disabled.
  This measures the core wire event with local providers. Browser paint,
  remote transport, draft prewarming, real projects and real-provider
  latency are outside this run.

## Load averages

The three numbers are the 1, 5 and 15 minute averages at each group's
start and finish.

| Driver | Active | Start | Finish |
| --- | ---: | --- | --- |
| echo | 1 | 67.44 / 55.14 / 45.01 | 67.04 / 55.67 / 45.35 |
| echo | 8 | 67.04 / 55.67 / 45.35 | 66.20 / 56.06 / 45.64 |
| echo | 32 | 66.20 / 56.06 / 45.64 | 65.03 / 56.31 / 45.89 |
| scripted | 1 | 65.03 / 56.31 / 45.89 | 67.36 / 57.63 / 46.66 |
| scripted | 8 | 67.36 / 57.63 / 46.66 | 84.61 / 62.44 / 48.59 |
| scripted | 32 | 84.61 / 62.44 / 48.59 | 73.56 / 61.61 / 48.68 |

## Results

Each latency cell is p50 / p95 in milliseconds. With five samples the
reported p95 is the highest observed value.

| Driver | Active | Thread | Entries | First text | Steer accepted | Steer output | Stopped and idle |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| echo | 1 | new | 0 | 40.0 / 95.8 | 3.8 / 9.6 | 24.1 / 27.8 | 22.5 / 35.4 |
| echo | 1 | cold | 2 | 48.0 / 55.0 | 3.6 / 4.4 | 38.1 / 39.8 | 19.6 / 20.9 |
| echo | 1 | warm | 2 | 44.6 / 60.8 | 3.4 / 4.5 | 37.0 / 38.4 | 18.6 / 20.5 |
| echo | 1 | cold | 100 | 50.6 / 78.0 | 3.5 / 4.5 | 36.7 / 39.0 | 18.3 / 24.3 |
| echo | 1 | warm | 100 | 42.8 / 46.1 | 3.7 / 14.5 | 37.2 / 40.3 | 13.3 / 20.5 |
| echo | 1 | cold | 1000 | 45.8 / 48.2 | 3.6 / 4.0 | 36.9 / 108.1 | 20.4 / 47.5 |
| echo | 1 | warm | 1000 | 51.0 / 58.3 | 3.8 / 6.9 | 36.8 / 40.5 | 22.6 / 30.3 |
| echo | 1 | cold | 5000 | 64.9 / 170.9 | 3.4 / 48.3 | 40.1 / 67.6 | 19.2 / 21.0 |
| echo | 1 | warm | 5000 | 60.3 / 72.1 | 3.3 / 4.1 | 37.0 / 49.1 | 20.9 / 23.2 |
| echo | 8 | new | 0 | 24.5 / 35.5 | 2.9 / 4.3 | 22.7 / 23.9 | 10.3 / 12.2 |
| echo | 8 | cold | 2 | 48.9 / 220.1 | 2.8 / 3.1 | 39.0 / 43.0 | 12.8 / 15.7 |
| echo | 8 | warm | 2 | 40.8 / 99.2 | 3.7 / 9.6 | 35.9 / 39.3 | 9.7 / 12.5 |
| echo | 8 | cold | 100 | 41.1 / 46.3 | 3.4 / 11.4 | 36.8 / 38.6 | 11.6 / 12.5 |
| echo | 8 | warm | 100 | 38.9 / 49.3 | 4.2 / 6.1 | 36.8 / 194.6 | 9.2 / 23.5 |
| echo | 8 | cold | 1000 | 49.7 / 88.0 | 3.0 / 18.2 | 38.3 / 41.9 | 14.3 / 18.4 |
| echo | 8 | warm | 1000 | 44.5 / 63.0 | 3.1 / 4.2 | 37.0 / 37.3 | 10.7 / 13.7 |
| echo | 8 | cold | 5000 | 59.2 / 73.5 | 3.5 / 4.0 | 38.1 / 134.2 | 13.1 / 15.9 |
| echo | 8 | warm | 5000 | 54.7 / 68.4 | 3.0 / 3.8 | 37.4 / 38.7 | 9.9 / 79.2 |
| echo | 32 | new | 0 | 32.5 / 34.4 | 3.3 / 4.8 | 21.8 / 25.8 | 11.9 / 38.6 |
| echo | 32 | cold | 2 | 36.8 / 46.6 | 3.3 / 3.7 | 34.6 / 38.6 | 8.8 / 11.6 |
| echo | 32 | warm | 2 | 37.6 / 59.3 | 3.0 / 3.6 | 36.0 / 37.8 | 11.9 / 16.0 |
| echo | 32 | cold | 100 | 30.2 / 44.8 | 3.2 / 3.7 | 23.5 / 36.4 | 11.2 / 31.9 |
| echo | 32 | warm | 100 | 42.2 / 50.9 | 3.5 / 3.8 | 22.7 / 38.5 | 15.0 / 17.3 |
| echo | 32 | cold | 1000 | 48.0 / 51.9 | 3.4 / 3.9 | 36.5 / 38.8 | 11.5 / 20.0 |
| echo | 32 | warm | 1000 | 38.9 / 46.1 | 3.0 / 4.2 | 37.5 / 96.3 | 13.4 / 102.9 |
| echo | 32 | cold | 5000 | 66.8 / 79.5 | 4.8 / 21.5 | 39.3 / 39.8 | 13.9 / 27.7 |
| echo | 32 | warm | 5000 | 61.5 / 72.4 | 3.8 / 4.7 | 37.4 / 38.4 | 12.6 / 16.1 |
| scripted | 1 | new | 0 | 190.5 / 213.2 | 4.2 / 5.5 | 26.0 / 29.4 | 47.7 / 65.9 |
| scripted | 1 | cold | 2 | 176.4 / 214.5 | 4.7 / 19.0 | 26.8 / 35.2 | 45.2 / 48.6 |
| scripted | 1 | warm | 2 | 69.5 / 78.3 | 3.7 / 5.4 | 27.6 / 27.8 | 49.7 / 54.8 |
| scripted | 1 | cold | 100 | 185.8 / 206.2 | 5.0 / 5.5 | 26.3 / 26.7 | 50.9 / 55.6 |
| scripted | 1 | warm | 100 | 73.4 / 88.9 | 4.2 / 10.1 | 26.5 / 28.0 | 49.0 / 50.2 |
| scripted | 1 | cold | 1000 | 183.5 / 194.4 | 5.3 / 8.3 | 27.2 / 28.0 | 50.0 / 60.0 |
| scripted | 1 | warm | 1000 | 74.9 / 83.3 | 4.0 / 8.6 | 26.7 / 27.0 | 50.0 / 53.7 |
| scripted | 1 | cold | 5000 | 206.4 / 246.2 | 5.8 / 7.6 | 28.0 / 30.1 | 54.6 / 63.1 |
| scripted | 1 | warm | 5000 | 124.1 / 135.5 | 4.6 / 12.2 | 27.9 / 28.3 | 57.0 / 66.4 |
| scripted | 8 | new | 0 | 220.3 / 228.2 | 5.0 / 6.1 | 31.1 / 31.9 | 52.6 / 58.3 |
| scripted | 8 | cold | 2 | 212.2 / 233.4 | 4.3 / 5.3 | 25.8 / 28.1 | 47.6 / 49.7 |
| scripted | 8 | warm | 2 | 77.9 / 97.2 | 5.3 / 7.3 | 27.9 / 30.5 | 46.3 / 48.9 |
| scripted | 8 | cold | 100 | 188.4 / 230.7 | 6.0 / 10.6 | 26.0 / 31.0 | 44.4 / 47.6 |
| scripted | 8 | warm | 100 | 80.2 / 90.6 | 4.8 / 7.6 | 26.5 / 27.5 | 43.6 / 54.2 |
| scripted | 8 | cold | 1000 | 195.8 / 226.0 | 4.2 / 5.3 | 25.2 / 27.4 | 46.9 / 52.6 |
| scripted | 8 | warm | 1000 | 98.1 / 136.3 | 5.5 / 7.1 | 27.9 / 32.2 | 45.9 / 56.0 |
| scripted | 8 | cold | 5000 | 258.6 / 322.1 | 7.5 / 7.8 | 28.8 / 30.6 | 56.7 / 59.4 |
| scripted | 8 | warm | 5000 | 124.5 / 147.6 | 4.1 / 9.0 | 28.4 / 33.1 | 47.5 / 49.2 |
| scripted | 32 | new | 0 | 171.6 / 183.5 | 3.4 / 4.2 | 25.0 / 26.4 | 40.2 / 44.9 |
| scripted | 32 | cold | 2 | 163.6 / 190.9 | 4.5 / 5.0 | 25.8 / 27.2 | 40.6 / 43.9 |
| scripted | 32 | warm | 2 | 64.8 / 72.4 | 3.8 / 4.6 | 24.5 / 27.1 | 39.7 / 44.2 |
| scripted | 32 | cold | 100 | 168.4 / 186.9 | 3.3 / 5.3 | 24.6 / 28.0 | 38.4 / 39.7 |
| scripted | 32 | warm | 100 | 68.5 / 72.5 | 3.3 / 9.7 | 27.1 / 28.1 | 41.2 / 134.1 |
| scripted | 32 | cold | 1000 | 185.1 / 214.9 | 3.8 / 4.8 | 26.2 / 28.6 | 45.4 / 56.2 |
| scripted | 32 | warm | 1000 | 76.1 / 93.0 | 3.5 / 5.4 | 25.8 / 29.0 | 40.9 / 45.5 |
| scripted | 32 | cold | 5000 | 191.7 / 249.7 | 4.6 / 8.6 | 25.3 / 27.6 | 44.2 / 49.6 |
| scripted | 32 | warm | 5000 | 104.8 / 127.9 | 3.1 / 5.1 | 27.2 / 27.6 | 40.7 / 56.3 |

The highest first-text median was 258.6 ms (322.1 ms p95) on a scripted
cold thread with 5,000 entries and eight active threads. The warm thread
with the same history size and active thread count took 124.5 ms. The
highest median stop latency was 57.0 ms on a scripted warm thread with
5,000 entries and one active thread. Variation in host load limits
comparisons across groups.
