# Usage, cost and limits

Boite records the tokens every turn reports, prices them at public API rates,
and shows the subscription limits each agent reports for your accounts. Use
it to see where your quota goes and to get warned before you run out.

## The Usage page

Open Settings, Usage.

1. Pick the range, 7, 30 or 90 days, and the measure: Tokens, API estimate or
   Turns. Every card follows them.
2. The page opens on All machines. Pick one machine, one project or one
   provider from the menus to narrow it.
3. Read the overview for the total, each provider's share and the chart by
   day, Biggest threads for the ten threads that spent the most, Projects for
   what each project spent, and Breakdown for each model or each day.
4. Press a thread to open its own page. Its totals and subagents follow the
   provider and date filters. The chart and turn list show up to the latest
   2,000 turns in that selection. Open the conversation takes you to it.
   Press a project to narrow the page to it.

- Tokens include cache reads and writes. A turn that reported no usage counts
  as a turn only.
- The page counts only what Boite ran. The owner can still select a project
  tagged Removed and see its conversations in Usage. A paired device includes
  the same usage in the overall totals and lists the project and its
  conversations again when the owner adds the folder back. Purging deleted
  conversations keeps their totals. An incognito conversation keeps nothing.
- Each provider keeps its own colour on every chart.
- A machine that is not connected is named above the page and left out of
  the totals.
- On a phone, Usage and Limits sit under Settings, Machines.

## The API estimate

The cost is the tokens at each model's public API rates, from models.dev. On a
subscription it is what the same tokens would cost on the API, not an
invoice.

Boite reads the current rates from models.dev about once a day, so a new
model gets its price without an update. Offline, it uses the last table it
fetched, with the shipped table filling in models missing from it. The line
under Breakdown says whether Boite has fetched rates.

- The "i" beside a model gives the rates it was priced at.
- A model with no listed rate uses the cost its agent reported. A model with
  neither shows No price, and is not counted as free.
- Grok reports no tokens, so it has no price.
- Requests past a long-context threshold cost more on the API than the base
  rate Boite uses, so that usage is underestimated.

## Subscription limits

Settings, Limits shows the windows each provider last reported for your
signed-in accounts, such as 5 hours and Weekly, with their reset times.

- Tracked accounts sets which accounts Boite asks. An account whose provider
  reports no limit is not offered there.
- Refresh quotas asks the providers again. A failed read keeps the last
  reading, dimmed and labelled Last successful reading.
- With a banked Claude or Codex reset, Use reset consumes the one closest to
  expiring, after a confirmation. It cannot be undone.
- The tray icon and the gauge above Settings in the app rail open the same
  limits in a small popup. Look for the blue Meta logo to find a Muse Code
  subscription connected through Douane. Drag a row's handle to reorder
  accounts. The account the open thread runs on is highlighted and tagged
  This thread; behind Douane, only when one Douane account serves that provider.
- The gauge stays grey while every account has room. When the best account
  runs low, it becomes a ring of what is left. When every account is out, the
  ring turns red, fills as the first reset comes near and shows the time left
  under it. A red dot on the grey gauge means an account behind Douane was
  used outside it; hover the gauge to see which.
- A paired device reads the same bars, without the refresh button, the
  switches or the reset.

Limits come from Claude, Codex, Muse Code, Grok, OpenCode Go and Antigravity.
Muse Code shows limits only once a running session has reported them.

## Quota alerts

1. In Settings, Limits, press the bell on an account's card.
2. For 5 hours or Weekly, pick the share left that should notify you: 50%,
   25% or 10%, or Custom for any whole number from 0 to 99. Six at most per
   period.

Each threshold notifies once per window, as a toast on the desktop and a
notification on a paired phone. While an alert is set, Boite reads that
account every five minutes, even with no window open.

## Resume after a usage limit

When a usage limit stops a request, the conversation shows the reset time
when the provider supplies it. Choose Resume to continue the request, or
Resume with another model to pick one available on the same account for that
turn. The model selected for later messages stays as it was.

Resume threads after a usage limit, in Settings, Limits, is on by default.
A Claude or Codex thread stopped by a subscription limit resumes by itself a
minute after the limit resets, once per window. Stop, a new message or a
changed model cancels it, and the banner above the box has Do not resume.

When a model is at capacity, Claude and Codex turns try again by themselves
after 30 seconds, 2 minutes and 5 minutes. Stop retrying ends the wait.

## The prompt cache timer

A clock beside the context meter counts down how long the provider keeps the
conversation cached, while the thread is idle. A message sent while the
cache is warm can cost less input, depending on the provider and model.

| Agent | Timer |
| --- | --- |
| Claude Code | Five minutes or one hour, as the agent reports |
| Codex on OpenAI | 30 minutes for GPT-5.6 and later |
| pi | As Claude on Anthropic, as Codex on OpenAI |
| OpenCode | Five minutes on Anthropic models, as Codex on OpenAI |
| Grok, Antigravity, Muse Code | No timer |

The timer is an estimate from what the agent reports or the provider
documents. It does not check the cache, and changing the model or account
resets it.

Keep the prompt cache warm is in Settings, System, and is off by default.
Only the owner sees it.
While a conversation waits on its agents or workflows, Boite sends a one-word
turn shortly before the cache lapses, for at most 12 hours by default (1 to
24). Each ping counts as usage, and a ping that misses the cache ends the
pings.

## Going further

- [Accounts](accounts.md): sign in and add accounts.
- [Context](context.md): the context meter and compaction.
- [Models](models.md): changes that affect the cache.
- [Phone](phone.md): notifications on a paired phone.
- Technical reference: [usage](internals/usage.md),
  [prompt cache](internals/prompt-cache.md).
