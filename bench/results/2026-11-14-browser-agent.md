# Browser agent bench, replay, 2026-11-14

Commit `5975582c5`. CLI `bun packages/core/src/main.ts cli`. 3 repeats. linux x64, 16 logical cores, Bun 1.4.4, load average 49.7 at the start.

Command: `bun bench/browser-agent.ts`

Each task is a fixed script of real `boite browser` calls against a fresh core with an echo thread: `open`,
then for each action the action on a ref read by label from the previous output, followed by `snapshot -i`.
Calls, bytes and tokens are medians over the repeats of one run of the task; call times pool every call of
every repeat. Tokens are bytes / 4, an estimate, not a tokenizer count.

| task | success | calls | ref retries | bytes read | est. tokens | call median | call p95 | task wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| signin: Sign-in form, a validation error, then success | 3/3 | 14 | 0 | 1569 | ~392 | 162 ms | 518 ms | 3249 ms |
| search: Search, filter a result list, choose one | 3/3 | 12 | 0 | 2262 | ~566 | 150 ms | 444 ms | 2336 ms |
| pages: Read a value on page 3 of a paginated table | 3/3 | 9 | 0 | 3596 | ~899 | 148 ms | 508 ms | 1984 ms |
| modal: A modal that must be confirmed | 3/3 | 8 | 0 | 1001 | ~250 | 173 ms | 588 ms | 2263 ms |
| checkout: A 3-step checkout form | 3/3 | 20 | 0 | 2149 | ~537 | 132 ms | 487 ms | 4541 ms |
| tabs: A field behind a tab and an accordion | 3/3 | 10 | 0 | 1516 | ~379 | 153 ms | 549 ms | 2415 ms |
| todo: A list that changes in place: add 3, remove 1 | 3/3 | 16 | 0 | 1607 | ~402 | 122 ms | 466 ms | 4132 ms |
| long: Act on one row of a 320-row page | 3/3 | 4 | 0 | 24901 | ~6225 | 139 ms | 483 ms | 899 ms |
| all 8, per repeat | 24/24 | 93 | | 38601 | ~9650 | 148 ms | 508 ms | |

## Per command

| command | calls | median | p95 | median bytes |
| --- | --- | --- | --- | --- |
| open | 24 | 182 ms | 293 ms | 48 |
| snapshot -i | 138 | 97 ms | 153 ms | 207 |
| fill | 45 | 460 ms | 549 ms | 9 |
| click | 63 | 420 ms | 559 ms | 9 |
| select | 3 | 403 ms | 444 ms | 18 |
| snapshot | 3 | 122 ms | 148 ms | 2597 |
| check | 3 | 478 ms | 502 ms | 9 |

The first `open` of each core, which starts the browser, is not counted: 2552 ms, 1847 ms, 2490 ms.
