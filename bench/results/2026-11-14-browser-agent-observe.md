# Browser agent bench, replay with the page printed after each action, 2026-11-14

Commit `a4e651969` with this branch's changes, before they were committed. CLI `bun packages/core/src/main.ts cli`. 3 repeats. linux x64, 16 logical cores, Bun 1.4.4, load average 24.3 at the start.

Command: `bun bench/browser-agent.ts --repeat 3 --out <dir>`

Each task is a fixed script of real `boite browser` calls against a fresh core with an echo thread: `open`,
then for each action the action on a ref read by label from the page last seen; each action prints the page it leaves, so `snapshot -i` runs only after an output without one or before a retry.
Calls, bytes and tokens are medians over the repeats of one run of the task; call times pool every call of
every repeat. Tokens are bytes / 4, an estimate, not a tokenizer count.

| task | success | calls | ref retries | bytes read | est. tokens | call median | call p95 | task wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| signin: Sign-in form, a validation error, then success | 3/3 | 7 | 0 | 1709 | ~427 | 250 ms | 325 ms | 1718 ms |
| search: Search, filter a result list, choose one | 3/3 | 6 | 0 | 2382 | ~596 | 239 ms | 349 ms | 1374 ms |
| pages: Read a value on page 3 of a paginated table | 3/3 | 5 | 0 | 3676 | ~919 | 211 ms | 284 ms | 875 ms |
| modal: A modal that must be confirmed | 3/3 | 4 | 0 | 1081 | ~270 | 301 ms | 1286 ms | 1991 ms |
| checkout: A 3-step checkout form | 3/3 | 10 | 0 | 2349 | ~587 | 320 ms | 416 ms | 3127 ms |
| tabs: A field behind a tab and an accordion | 3/3 | 5 | 0 | 1622 | ~406 | 347 ms | 1283 ms | 2423 ms |
| todo: A list that changes in place: add 3, remove 1 | 3/3 | 8 | 0 | 1770 | ~443 | 312 ms | 468 ms | 2271 ms |
| long: Act on one row of a 320-row page | 3/3 | 3 | 1 | 20777 | ~5194 | 246 ms | 1268 ms | 1581 ms |
| all 8, per repeat | 24/24 | 48 | | 35366 | ~8842 | 259 ms | 1222 ms | |

## Per command

| command | calls | median | p95 | median bytes |
| --- | --- | --- | --- | --- |
| open | 24 | 123 ms | 335 ms | 261 |
| fill | 45 | 250 ms | 394 ms | 248 |
| click | 63 | 336 ms | 1268 ms | 264 |
| select | 3 | 203 ms | 218 ms | 639 |
| snapshot | 3 | 57 ms | 106 ms | 2597 |
| check | 3 | 345 ms | 442 ms | 229 |
| snapshot -i | 3 | 99 ms | 107 ms | 12415 |

The first `open` of each core, which starts the browser, is not counted: 1504 ms, 1583 ms, 1823 ms.
