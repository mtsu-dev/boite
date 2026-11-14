# Browser agent bench, live, 2026-11-14

Before is `aeab9bb92`, the bench alone on `5975582c5`; after is `112aa099c`, with stable refs and snapshot
diffs. One run per task, so a single extra tool call moves a row by about 30,000 cache-read tokens.

## Before

Commit `aeab9bb92`. Model `claude-opus-5-5`, effort `medium`, 1 run(s) per task, 300 s timeout. linux x64, 16 logical cores, Bun 1.4.4, load average 11.8 at the start.

Command: `bun bench/browser-agent.ts --live --runs 1 --effort medium`

Each task is its goal in words, sent as one turn to a fresh Claude thread on a fresh core, with the
Boite guide on. Success is the fixture server's own check. Tokens are the turn's usage as the core
stored it: input excludes cache reads and writes.

| task | run | success | tool calls | browser commands | input | cache read | cache write | output | wall | ran with | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| signin | 1 | yes | 4 | 13 | 10 | 133650 | 23572 | 468 | 13 s | claude-opus-5-5 medium | done |
| search | 1 | yes | 4 | 9 | 10 | 136054 | 21049 | 417 | 8 s | claude-opus-5-5 medium | done |
| pages | 1 | yes | 4 | 9 | 10 | 137553 | 21922 | 482 | 10 s | claude-opus-5-5 medium | done |
| modal | 1 | yes | 4 | 8 | 10 | 135346 | 20895 | 407 | 8 s | claude-opus-5-5 medium | done |
| checkout | 1 | yes | 5 | 16 | 12 | 168505 | 21394 | 633 | 12 s | claude-opus-5-5 medium | done |
| tabs | 1 | yes | 4 | 10 | 10 | 135897 | 21124 | 439 | 10 s | claude-opus-5-5 medium | done |
| todo | 1 | yes | 4 | 8 | 10 | 135331 | 20869 | 435 | 13 s | claude-opus-5-5 medium | done |
| long | 1 | yes | 4 | 6 | 10 | 149127 | 27462 | 445 | 11 s | claude-opus-5-5 medium | done |

### Checker

- signin, run 1: signedIn=ada@example.com failures=1
- search, run 1: chosen=brass-desk-lamp searches=1
- pages, run 1: answer=$221.93 expected=$221.93
- modal, run 1: deleted=["q3"]
- checkout, run 1: order={"name":"Ada Lovelace","city":"London","delivery":"express","card":"4242","terms":true}
- tabs, run 1: vat=FR12345678901
- todo, run 1: items=["Buy milk","Buy bread"]
- long, run 1: restocked=["SKU-0217"]

## After

Commit `112aa099c`. Model `claude-opus-5-5`, effort `medium`, 1 run(s) per task, 300 s timeout. linux x64, 16 logical cores, Bun 1.4.4, load average 45.1 at the start.

Command: `bun bench/browser-agent.ts --live --runs 1 --effort medium`

Each task is its goal in words, sent as one turn to a fresh Claude thread on a fresh core, with the
Boite guide on. Success is the fixture server's own check. Tokens are the turn's usage as the core
stored it: input excludes cache reads and writes.

| task | run | success | tool calls | browser commands | input | cache read | cache write | output | wall | ran with | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| signin | 1 | yes | 3 | 10 | 8 | 91034 | 30863 | 399 | 12 s | claude-opus-5-5 medium | done |
| search | 1 | yes | 3 | 9 | 8 | 104084 | 20749 | 345 | 10 s | claude-opus-5-5 medium | done |
| pages | 1 | yes | 5 | 10 | 12 | 170314 | 22019 | 557 | 15 s | claude-opus-5-5 medium | done |
| modal | 1 | yes | 3 | 8 | 8 | 104205 | 20920 | 379 | 8 s | claude-opus-5-5 medium | done |
| checkout | 1 | yes | 6 | 17 | 14 | 200925 | 21613 | 726 | 15 s | claude-opus-5-5 medium | done |
| tabs | 1 | yes | 5 | 10 | 12 | 167094 | 21157 | 554 | 12 s | claude-opus-5-5 medium | done |
| todo | 1 | yes | 4 | 8 | 10 | 135336 | 20870 | 434 | 15 s | claude-opus-5-5 medium | done |
| long | 1 | yes | 5 | 7 | 12 | 170703 | 22051 | 814 | 15 s | claude-opus-5-5 medium | done |

### Checker

- signin, run 1: signedIn=ada@example.com failures=1
- search, run 1: chosen=brass-desk-lamp searches=1
- pages, run 1: answer=$221.93 expected=$221.93
- modal, run 1: deleted=["q3"]
- checkout, run 1: order={"name":"Ada Lovelace","city":"London","delivery":"express","card":"4242","terms":true}
- tabs, run 1: vat=FR12345678901
- todo, run 1: items=["Buy milk","Buy bread"]
- long, run 1: restocked=["SKU-0217"]

## Reading

Every task succeeded on both sides. Over the eight tasks, cache reads went from 1,131,463 to 1,143,695
tokens and cache writes from 178,287 to 180,242, with 33 then 34 tool calls: each tool call rereads the
whole prompt, so the call count decides the total. The 320-row task, the one whose page changes in a large
tree, wrote 27,462 then 22,051 tokens to the cache.
