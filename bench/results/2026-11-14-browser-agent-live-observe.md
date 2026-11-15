# Browser agent bench, live, with the page printed after each action, 2026-11-14

Commit `a4e651969` with this branch's changes, before they were committed. Runs 2 and 3 of a task find the guide's prompt cached by run 1, so their cache writes are lower. Model `claude-opus-5-5`, effort `medium`, 3 run(s) per task, 300 s timeout. linux x64, 16 logical cores, Bun 1.4.4, load average 23.7 at the start.

Command: `bun bench/browser-agent.ts --live --runs 3 --effort medium --out <dir>`

Each task is its goal in words, sent as one turn to a fresh Claude thread on a fresh core, with the
Boite guide on. Success is the fixture server's own check. Tokens are the turn's usage as the core
stored it: input excludes cache reads and writes.

| task | run | success | tool calls | browser commands | input | cache read | cache write | output | wall | ran with | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| signin | 1 | yes | 3 | 8 | 8 | 93306 | 32364 | 402 | 12 s | claude-opus-5-5 medium | done |
| signin | 2 | yes | 3 | 8 | 8 | 118319 | 7395 | 403 | 9 s | claude-opus-5-5 medium | done |
| signin | 3 | yes | 3 | 8 | 8 | 118273 | 7389 | 445 | 10 s | claude-opus-5-5 medium | done |
| search | 1 | yes | 3 | 5 | 8 | 102187 | 19848 | 209 | 7 s | claude-opus-5-5 medium | done |
| search | 2 | yes | 3 | 6 | 8 | 118226 | 7074 | 308 | 8 s | claude-opus-5-5 medium | done |
| search | 3 | yes | 3 | 7 | 8 | 118226 | 7116 | 321 | 8 s | claude-opus-5-5 medium | done |
| pages | 1 | yes | 5 | 10 | 12 | 168149 | 21693 | 468 | 14 s | claude-opus-5-5 medium | done |
| pages | 2 | yes | 5 | 12 | 12 | 183747 | 8172 | 987 | 18 s | claude-opus-5-5 medium | done |
| pages | 3 | yes | 6 | 11 | 14 | 213946 | 7690 | 616 | 16 s | claude-opus-5-5 medium | done |
| modal | 1 | yes | 3 | 4 | 8 | 101878 | 19763 | 195 | 8 s | claude-opus-5-5 medium | done |
| modal | 2 | yes | 3 | 4 | 8 | 115766 | 5875 | 195 | 8 s | claude-opus-5-5 medium | done |
| modal | 3 | yes | 3 | 4 | 8 | 115766 | 5875 | 195 | 8 s | claude-opus-5-5 medium | done |
| checkout | 1 | yes | 4 | 11 | 10 | 137555 | 21855 | 343 | 11 s | claude-opus-5-5 medium | done |
| checkout | 2 | yes | 4 | 12 | 10 | 151715 | 8091 | 480 | 13 s | claude-opus-5-5 medium | done |
| checkout | 3 | yes | 4 | 12 | 10 | 150927 | 7812 | 472 | 14 s | claude-opus-5-5 medium | done |
| tabs | 1 | yes | 4 | 7 | 10 | 135692 | 21365 | 328 | 10 s | claude-opus-5-5 medium | done |
| tabs | 2 | yes | 4 | 7 | 10 | 149566 | 7491 | 328 | 11 s | claude-opus-5-5 medium | done |
| tabs | 3 | yes | 4 | 8 | 10 | 149722 | 7593 | 430 | 11 s | claude-opus-5-5 medium | done |
| todo | 1 | yes | 3 | 11 | 8 | 104699 | 21602 | 414 | 14 s | claude-opus-5-5 medium | done |
| todo | 2 | yes | 4 | 10 | 10 | 150646 | 7776 | 499 | 12 s | claude-opus-5-5 medium | done |
| todo | 3 | yes | 3 | 10 | 8 | 118576 | 7626 | 382 | 10 s | claude-opus-5-5 medium | done |
| long | 1 | yes | 4 | 6 | 10 | 141201 | 22785 | 483 | 13 s | claude-opus-5-5 medium | done |
| long | 2 | yes | 4 | 7 | 10 | 155605 | 9331 | 517 | 13 s | claude-opus-5-5 medium | done |
| long | 3 | yes | 5 | 6 | 12 | 212373 | 16318 | 618 | 15 s | claude-opus-5-5 medium | done |

## Checker

- signin, run 1: signedIn=ada@example.com failures=1
- signin, run 2: signedIn=ada@example.com failures=1
- signin, run 3: signedIn=ada@example.com failures=1
- search, run 1: chosen=brass-desk-lamp searches=1
- search, run 2: chosen=brass-desk-lamp searches=1
- search, run 3: chosen=brass-desk-lamp searches=1
- pages, run 1: answer=$221.93 expected=$221.93
- pages, run 2: answer=$221.93 expected=$221.93
- pages, run 3: answer=$221.93 expected=$221.93
- modal, run 1: deleted=["q3"]
- modal, run 2: deleted=["q3"]
- modal, run 3: deleted=["q3"]
- checkout, run 1: order={"name":"Ada Lovelace","city":"London","delivery":"express","card":"4242","terms":true}
- checkout, run 2: order={"name":"Ada Lovelace","city":"London","delivery":"express","card":"4242","terms":true}
- checkout, run 3: order={"name":"Ada Lovelace","city":"London","delivery":"express","card":"4242","terms":true}
- tabs, run 1: vat=FR12345678901
- tabs, run 2: vat=FR12345678901
- tabs, run 3: vat=FR12345678901
- todo, run 1: items=["Buy milk","Buy bread"]
- todo, run 2: items=["Buy milk","Buy bread"]
- todo, run 3: items=["Buy milk","Buy bread"]
- long, run 1: restocked=["SKU-0217"]
- long, run 2: restocked=["SKU-0217"]
- long, run 3: restocked=["SKU-0217"]
