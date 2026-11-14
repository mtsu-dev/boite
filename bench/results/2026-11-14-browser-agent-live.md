# Browser agent bench, live, 2026-11-14

Commit `5975582c5`. Model `claude-opus-5-5`, effort `low`, 1 run(s) per task, 300 s timeout. linux x64, 16 logical cores, Bun 1.4.4, load average 47.9 at the start.

Command: `bun bench/browser-agent.ts --live --tasks signin,todo --runs 1 --effort low --timeout 300`

Each task is its goal in words, sent as one turn to a fresh Claude thread on a fresh core, with the
Boite guide on. Success is the fixture server's own check. Tokens are the turn's usage as the core
stored it: input excludes cache reads and writes.

| task | run | success | tool calls | browser commands | input | cache read | cache write | output | wall | ran with | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| signin | 1 | yes | 4 | 13 | 10 | 130674 | 22771 | 467 | 17 s | claude-opus-5-5 low | done |
| todo | 1 | yes | 3 | 8 | 8 | 102207 | 20082 | 273 | 10 s | claude-opus-5-5 low | done |

## Checker

- signin, run 1: signedIn=ada@example.com failures=1
- todo, run 1: items=["Buy milk","Buy bread"]
