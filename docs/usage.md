# Usage, cost and limits

Boite records the tokens every turn reports, prices them at public API rates,
and shows the subscription limits each agent reports for your accounts. Use
it to see where your quota goes and to get warned before you run out.

## The Usage page

Open Settings, Usage.

1. Pick the range, 7, 30 or 90 days, and the measure: Tokens, API estimate or
   Turns. Every card follows them.
2. Filter by provider, and with several machines connected, pick one machine
   or All machines.
3. Read Overview for the totals per provider, Per day for a chart by day,
   Breakdown for each model, and Top threads for the ten threads that spent
   the most.

- Tokens include cache reads and writes. A turn that reported no usage counts
  as a turn only.
- The page counts only what Boite ran. Removing a project or purging deleted
  conversations keeps their totals. An incognito conversation keeps nothing.
- A machine that is not connected is named above the page and left out of
  the totals.
- On a phone, Usage and Limits sit under Settings, Machines.

## The API estimate

The cost is the tokens at each model's public API rates, from models.dev. On a
subscription it is what the same tokens would cost on the API, not an
invoice.

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
- The tray icon and the sidebar open the same limits in a small popup. Drag a
  row's handle to reorder accounts.
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

Resume threads after a usage limit, in Settings, Limits, is off by default.
Turned on, a Claude or Codex thread stopped by a subscription limit resumes by
itself a minute after the limit resets, once per window. Stop, a new message
or a changed model cancels it, and the banner above the box has Do not
resume.

When a model is at capacity, Claude and Codex turns try again by themselves
after 30 seconds, 2 minutes and 5 minutes. Stop retrying ends the wait.

## The prompt cache timer

Experimental: turn it on in Settings, Experiments (Prompt cache timer).

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

Keep the prompt cache warm, in Settings, Experiments, is off by default.
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
