# Browser agent bench, replay with snapshot diffs, 2026-11-14

Commit `112aa099c`. CLI `bun packages/core/src/main.ts cli`. 3 repeats. linux x64, 16 logical cores, Bun 1.4.4, load average 42.2 at the start.

Command: `bun bench/browser-agent.ts --repeat 3`

Each task is a fixed script of real `boite browser` calls against a fresh core with an echo thread: `open`,
then for each action the action on a ref read by label from the previous output, followed by `snapshot -i`.
Calls, bytes and tokens are medians over the repeats of one run of the task; call times pool every call of
every repeat. Tokens are bytes / 4, an estimate, not a tokenizer count.

| task | success | calls | ref retries | bytes read | est. tokens | call median | call p95 | task wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| signin: Sign-in form, a validation error, then success | 3/3 | 14 | 0 | 1569 | ~392 | 135 ms | 480 ms | 2909 ms |
| search: Search, filter a result list, choose one | 3/3 | 12 | 0 | 2262 | ~566 | 113 ms | 441 ms | 2002 ms |
| pages: Read a value on page 3 of a paginated table | 3/3 | 9 | 0 | 3596 | ~899 | 101 ms | 428 ms | 1290 ms |
| modal: A modal that must be confirmed | 3/3 | 8 | 0 | 1001 | ~250 | 107 ms | 476 ms | 1780 ms |
| checkout: A 3-step checkout form | 3/3 | 20 | 0 | 2149 | ~537 | 148 ms | 513 ms | 4687 ms |
| tabs: A field behind a tab and an accordion | 3/3 | 10 | 0 | 1522 | ~381 | 145 ms | 521 ms | 2636 ms |
| todo: A list that changes in place: add 3, remove 1 | 3/3 | 16 | 0 | 1610 | ~403 | 155 ms | 485 ms | 4137 ms |
| long: Act on one row of a 320-row page | 3/3 | 4 | 0 | 12742 | ~3186 | 99 ms | 461 ms | 711 ms |
| all 8, per repeat | 24/24 | 93 | | 26451 | ~6613 | 125 ms | 488 ms | |

## Per command

| command | calls | median | p95 | median bytes |
| --- | --- | --- | --- | --- |
| open | 24 | 137 ms | 241 ms | 48 |
| snapshot -i | 138 | 84 ms | 136 ms | 208 |
| fill | 45 | 454 ms | 490 ms | 9 |
| click | 63 | 404 ms | 514 ms | 9 |
| select | 3 | 416 ms | 441 ms | 18 |
| snapshot | 3 | 92 ms | 94 ms | 2597 |
| check | 3 | 513 ms | 636 ms | 9 |

The first `open` of each core, which starts the browser, is not counted: 1684 ms, 1473 ms, 2433 ms.
