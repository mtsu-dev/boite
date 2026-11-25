# Provider gateway

[Providers](providers.md) describes descriptors and supported agents.

## Subscription proxy

Settings, Providers offers an optional subscription proxy for Claude, Codex and
both OpenCode versions, and for Grok and Antigravity when the gateway is Douane.
Choose Douane or CLIProxyAPI, enter the gateway's API URL and its limits dashboard
URL, enable the switch and save. The API URL accepts an origin or a path ending
in `/v1`. Model discovery runs on the machine hosting the core. The agent's own
discovery runs through the gateway first, so each model keeps the effort scale,
speed tiers (Fast) and names a direct subscription shows. `GET /v1/models` then
adds the models only the gateway routes, and stands alone when the agent's
discovery fails. A route named after the vendor (`claude/claude-opus-5-5`) is
the agent's own model and is listed once, under its native id
(`nativeModelId` in contracts). A default model, draft or composer choice saved
under the route id opens on that native id with its effort. Paired phones use
that same catalog.

Claude Code is told the gateway is first-party, because the gateway relays Messages
unchanged to Anthropic on a subscription: tool search, first-party model aliases
and the one-hour prompt cache stay on (`_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL`,
`CLAUDE_CODE_PROMPT_CACHE_TTL=1h`), and fast mode skips the organization check
that needs a native login (`CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK`). Codex already
sends its service tier and prompt cache key to a custom provider. Every Codex
process starts under the gateway's provider, the setup process of a native fork
included: Codex writes the provider into a thread's rollout and refuses to
resume it under another ("This chat uses openai").

While the proxy is enabled, Claude, Codex and both OpenCode versions show one account named
after the gateway, Douane or CLIProxyAPI, with the API URL's origin, and so
do Grok and Antigravity behind Douane. It has no rename,
check, remove or add actions, and the provider row reads Ready · via Douane.
The composer, delegation profiles, the default model and Limits show the same
account. This account is a view in the UI, not a stored account. Threads,
profiles, routes and agent grants keep naming the local account they were
created with, and the proxy only replaces that account's environment, so every
reference keeps working in both states. The UI shows the first local account of
the provider under the gateway's name, and `accountOf` resolves any local id of
a proxied provider to that view. Settings and provider protocols reach every
client, so a phone computes the same view. Nothing is deleted. Turning the
proxy off brings the local accounts back unchanged. A proxied provider with no
local account at all has nothing to show and asks for a sign-in as before.

Douane's default dashboard path is `/admin/#quotas`; CLIProxyAPI uses
`/management.html#/quota`. A gateway may translate any model to any API, but a
proprietary model stays in its own harness: Claude lists Claude models and
Codex lists OpenAI models, whatever routing prefix the gateway gives them, while
Grok and Muse models are listed by neither. Grok's models are listed by Grok
alone, behind Douane. Antigravity's models run only in the Antigravity
harness, through Douane's Gemini API (`/v1beta`) or the native sign-in: Google
bans an account used anywhere else. No other harness (Claude Code, Codex, both
OpenCode versions, pi, Grok) is offered a Gemini model, under any routing
prefix, nor any model the gateway routes through Antigravity
(`antigravity/claude-opus-5-5-high`, `antigravity/gpt-oss-120b-medium`), even
when its row advertises that harness's API. Behind CLIProxyAPI, which does not
serve Antigravity, they are not reachable at all. Open
models (`gpt-oss`, Kimi, Qwen, Llama, DeepSeek, Mistral, GLM) are offered to
each harness whose API the gateway advertises for them, under any other routing
prefix. A name the rules do not recognize takes its vendor from the routing
prefix (`codex/`, `claude/`, ...). A catalog without endpoint metadata keeps
the older rule, which matches the whole id against the harness's native model
names. With Douane, the core reads `GET /v1/quotas` with the proxy key and
Limits shows native bars, described in [usage](usage.md#gateway-quotas). With
CLIProxyAPI, or a Douane that answers 404 on that route, Limits opens the
dashboard inside Boite instead of the account popup. Desktop uses the shell's
existing browser view, and browsers and phones use an iframe. The dashboard must permit embedding
and its configured URL must be reachable from the device displaying it.
HTTPS browser sessions require an HTTPS dashboard URL; Boite shows this before
creating a blocked HTTP frame. Open Douane (Open CLIProxyAPI) provides a separate sign-in page,
then Reload retries the embedded view. Some gateways refuse framing or restrict
cross-site cookies; those dashboards remain available through that button.
Show account limits opens the native limits and monitoring switches for agents
that keep their own configuration; Show proxy dashboard returns to the gateway.

### Switching the gateway from Limits

Once a gateway is saved, Limits starts with a switch, Use Douane or Use
CLIProxyAPI, beside its address (or Douane on this machine in local mode). It
saves as it flips, through `subscriptionProxy.setEnabled`, and changes only
`enabled`: the kind, the URLs and the key stay as the owner saved them. A
paired phone reaches it too, which is the one way a phone changes the gateway
([phone](phone.md)); configuring one stays owner-only. Before anything is
saved there is no switch, and the method refuses with `no subscription proxy
is configured`. Off restores native authentication as a saved Use a
subscription proxy does. `?fake=1&gateway=douane` (or `cliproxyapi`) starts
the in-memory client with a saved gateway that is off.

### Douane on this machine

The proxy card's first choice is where the gateway runs: Remote gateway (the
URLs above, typed by the user) or Douane on this machine, the Douane plugin
(Settings > Plugins, [gateways](plugins.md#gateways)). Settings store it as
`subscriptionProxy.mode`, `remote` or `local`; settings with no `mode` read as
remote, unchanged. In local mode the kind is Douane and the core writes both
URLs from the plugin's port: `baseUrl` `http://127.0.0.1:<port>/v1` and
`dashboardUrl` `http://127.0.0.1:<port>/admin/`, and follows the plugin when
it moves to another port. When no client key is saved, Boite creates a client
through the managed plugin's local admin API and stores its key privately,
before discovery, quotas or agents use it. The API key field is available in
both modes; a saved key is kept, and a rejected key reports how to replace it.
Older Douane versions without the clients API keep working. `subscriptionProxyOf`, model
discovery, the gateway account view and Limits then work as with a remote
Douane.

The card says whether the plugin runs (`Douane <version> answers on
127.0.0.1:<port>`), is stopped or starting, or is not installed, with Open
Plugins when it does not run. Choosing local mode starts nothing: the plugin
runs from its own row, whether or not the proxy uses it.

### Open Douane

Open Douane, or Open CLIProxyAPI, opens the gateway's dashboard URL in the
system browser (`openExternal`). It sits beside Save proxy in the settings, at
the top of Limits whenever the proxy is on, and in the embedded dashboard's
header. A dashboard at a loopback address (`localhost`, `127.0.0.1`, `::1`)
answers only on the core's machine, so the button shows there alone: in the
desktop app on its own core, or in a browser that reaches its core at a
loopback address. A phone or another computer gets no button for it rather
than a dead link (`gatewayDashboardReachable` in contracts,
`lib/gateway-dashboard.ts`).

### Moving connections to Douane

Move my connections to Douane, under the proxy settings, appears once a Douane
gateway is saved and the core advertises `features.gatewayMove`. The Douane
plugin's row in Settings > Plugins offers it too while the plugin runs; that
one sends `target: "plugin"` and moves into the plugin whatever the proxy
points at. It lists what
this machine's accounts hold that Douane can serve, default and isolated
accounts alike (`subscriptionProxy.movePlan`), and the user ticks what to move:

- Claude's `.credentials.json`, Codex's `auth.json` and Grok's `auth.json`,
  sent whole.
- OpenCode's `opencode/auth.json`: its `github-copilot` entry, alone, becomes a
  Copilot account. Each `type: "api"` key becomes a custom endpoint
  `{"type":"openai_compatible","route","base_url","api_key","dialect":"chat"}`.
  The route is OpenCode's provider id, lowercased, renamed when Douane keeps
  that name for a provider of its own: `opencode` (Zen) becomes `zen`, any
  other such name takes `-api`. The address is the provider's `api` field in
  OpenCode's catalog cache, `$XDG_CACHE_HOME/opencode/models.json` (else
  `~/.cache/opencode/models.json`, on every OS), which an isolated account
  shares. `opencode-go` goes to Douane's own `opencode_go` provider as its
  key instead.
- Not movable, with the reason on the line: a signed-out account, a file that
  is not JSON, a key whose provider has no `api` address in the catalog
  (`noAddress`), a provider whose package is not an OpenAI-compatible one
  (`otherApi`), an OpenCode OAuth sign-in other than Copilot's
  (`otherSignIn`). OpenCode 2 keeps its sign-ins in a database and is not
  listed.

`subscriptionProxy.move` makes the core read each ticked file again and post
it alone to `POST <gateway>/admin/api/accounts/import`. The client never
receives a value; a gateway's error that repeats a value of the payload has
it replaced by `[hidden]`, and the log line counts items only. Each line then
reads Moved, Already there or Refused with Douane's reason. Before posting,
the core reads `GET /admin/api/accounts` and skips what Douane already has
and could not tell apart by itself: an endpoint with the same route and
address, a Copilot or OpenCode Go account, a sign-in whose email matches the
Boite account's. An endpoint whose route Douane already serves at another
address is refused (`routeTaken`). Douane updates a sign-in it recognizes by
its account id instead of adding it twice; that line reads Already there.

A remote Douane can ask for a management token (`management_token_env`), or
sit behind a login page. The dialog takes an optional token, sent as
`x-management-key` and saved on the core like the proxy key (journal setting
`subscription-proxy-management-token`, never sent to a client; the plan only
says whether one is saved). A 401 or 403 asks for that token, and a redirect or
an HTML page says the API is behind a login, both with `field:
managementToken`. A local Douane answers on loopback without one. What moving
a sign-in means for Boite's own copy: [accounts](accounts.md#moving-a-login-to-douane).

Which agents the proxy serves is decided per provider, not per protocol
(`subscriptionProxyServes` in the contract): the Claude and Codex protocols
whole, and both OpenCode versions by their ids, because ACP is also what
other agents speak, and those keep their own configuration. Grok and
Antigravity are served by their ids too, and by Douane alone
(`SUBSCRIPTION_PROXY_KIND_PROVIDERS`): behind CLIProxyAPI they keep their own
sign-in.

Antigravity (agy 1.4.5 and 1.5.2) has a gateway mode of its own. The core points
`GEMINI_HOME` at `<dataDir>/subscription-proxy/antigravity/<id>`, where `<id>`
is the first 24 hex digits of the SHA-256 of the gateway's origin, and keeps
`{"auth":{"type":"gateway"}}` in its `antigravity-acp/settings.json`.
`AGY_LLM_GATEWAY_URL` carries the origin, without `/v1`, and
`AGY_LLM_GATEWAY_API_KEY` the proxy key, sent as a bearer token. The agent then
lists the gateway's models itself from `GET /v1beta/models?pageSize=1000` and
runs turns on `POST /v1beta/models/<model>:streamGenerateContent?alt=sse`,
which Douane serves from its pooled Google accounts; an image in a prompt
reaches it as an `inlineData` part with its MIME type (1.5.2, 2026-11-22). The
core reads no OpenAI catalog for it. The account's own directory, with its `oauth-personal`
settings and its sign-in, is not touched, so turning the proxy off gives the
native sign-in back. The profile's shared skills are mirrored into the gateway
home as into an account's. A conversation started under one home is not found
under the other. A sign-in started while the proxy is on runs without its
environment, so the token lands in the account's own directory, and the models
its session lists stay out of the catalog, which keeps the gateway's. Turning the
proxy on runs the startup account defaults again, so an installed agent it
starts serving gets its default account back when its last one was removed.

Grok moves to the gateway by its environment and stays the same agent. Its CLI
lists the gateway's Grok models itself, from
`GET /v1/models?provider=xai&ids=upstream`: xAI's ids, without the gateway's
prefix, in xAI's order, each row carrying the context window and the efforts
the CLI reads (`context_window`, `reasoning_efforts`). A thread therefore keeps
its model when the proxy is turned on or off, and a session opens on xAI's
default, since the CLI starts on the first model of an endpoint's list. The
core reads no catalog of its own for Grok and adds no model to that list. A
Douane older than these fields lists prefixed ids in alphabetical order, with
no effort and a 256,000 token window for every model. `XAI_API_KEY` carries
the proxy key, `GROK_MODELS_BASE_URL`, `GROK_XAI_API_BASE_URL` and
`GROK_CLI_CHAT_PROXY_BASE_URL` the gateway, so the key reaches no other host.
Turns carry `x-douane-provider: xai` (through `GROK_CONFIG`, the CLI's inline
configuration): the gateway spends the Grok subscription, never another one
that routes a model of the same name. The CLI prefers a stored sign-in to a
key and would send that token to the gateway, so `GROK_AUTH_PATH` points it at
`<dataDir>/subscription-proxy/grok-auth.json`, which nothing writes: the CLI
finds no sign-in, and the account's own stays for when the proxy is off. This
was measured on Grok CLI 1.0.46, where `GROK_AUTH_PATH` is not documented.

Muse Code uses Douane only after its quotas response announces a non-disabled
entry in the native `meta` pool and the core verifies both native routes without
inference: the catalog must contain Muse metadata, and an OPTIONS request to the
Responses route must advertise POST. Older gateways returning 404 or dashboard
HTML keep native authentication. A Muse model served by OpenCode Go does not
connect Muse Code. Without that pool, with CLIProxyAPI, or with the gateway
off, Muse keeps its native sign-in. Discovery updates the connection state
even when Meta has not reported a quota window yet.

Muse's MSP host reads an isolated gateway configuration under the core's data
directory, with `endpoint_transport.base_url` pinned to `/muse-code` and
`auth: "bearer"`. Its catalog uses `/muse-code/models` and its turns use
`/muse-code/responses`, both restricted to Meta by Douane. `META_API_KEY`
carries the proxy key only in the child environment; it overrides saved
authentication. Native settings and sign-ins remain intact. Models and
efforts still come from Muse's own MSP discovery, with their upstream ids.

Both OpenCode versions gain the gateway as an additional provider, named after
its kind (`douane` or `cliproxyapi`), calling its Chat Completions route.
OpenCode 1 uses the singular `provider` configuration with
`npm: @ai-sdk/openai-compatible` and `options.baseURL`; its `options.apiKey`
references `{env:BOITE_SUBSCRIPTION_PROXY_KEY}`. OpenCode 2 keeps its plural
`providers` configuration with `package: @opencode/ai/providers/openai-compatible`,
`settings.baseURL` and `env: [BOITE_SUBSCRIPTION_PROXY_KEY]`. Existing inline
permissions and other providers are preserved. The key is never embedded in
that configuration, and disabling the proxy restores the descriptor's original
environment and native account checks.

OpenCode 2 uses ACP for login and model discovery. Conversation execution uses
an owned `serve --stdio --port 0` process on loopback, with a random Basic-auth
password and the same isolated environment. Closing its stdin ends its lease.
The native event stream draws tools, reasoning, permissions and usage; plain
tool text stays output, while images and file diffs stay attached documents.
Follow-ups use the native prompt inbox with `delivery: "steer"`, so queued
messages join the running execution at tool boundaries. Send now interrupts
the active turn before starting its queued input. OpenCode 2's ACP endpoint
rejects concurrent prompts. Events received during a follow-up submission wait
until its acceptance is journalled, keeping the user message before its reply.
Accepted inbox IDs remain tracked until delivery or cancellation, so a previous
execution's terminal event cannot discard a late follow-up. Yolo mode approves
native permissions without opening a permission card, including child sessions.

The picker lists OpenCode's own models first, then the gateway's as
`douane/<gateway id>`: Muse and the open families whose catalog row includes
`openai` in `supported_endpoint_types`, or says nothing of its APIs. Claude,
GPT, Grok and Gemini models remain in their native harnesses, and nothing the
gateway routes through Antigravity is added. A catalog stored for the next
spawn before this rule is filtered the same way when it is read back. Gateway
model IDs retain their routing prefix in the provider configuration, so
selecting `douane/opencode_go/kimi-k3` calls the gateway with
`opencode_go/kimi-k3`.
The picker groups gateway models by their upstream provider, even in short
catalogs and search results. For example, `douane/opencode` and
`douane/openrouter` distinguish two MiniMax entries. Favorites show the same
source, and a model's tooltip gives its complete id.

The injected models preserve positive integer `context_length` (or
`context_window`) and `max_output_tokens` as their context and output limits.
OpenCode 1 requires both values to emit a valid limit object; an incomplete
pair is omitted. OpenCode 2 accepts either validated limit independently.
Advertised thinking budgets, dynamic thinking or effort levels enable
OpenCode 1's `reasoning` capability and its `reasoning_content` replay field;
OpenCode 2 receives `compatibility.reasoningField` instead. Missing or malformed
metadata adds no inferred limits or thinking capability. These values survive
the persisted catalog, so later spawns keep them. OpenCode still applies its
own output ceiling; the catalog does not override that runtime policy.

OpenCode 1.19 sends `x-opencode-session-id` on every model request and
`X-Session-Id` for custom providers, using its own conversation ID. A gateway
can use that ID for signed-thinking replay between tool turns without a
shared prompt hash or a process-wide session value.

A custom provider only knows the models its configuration names, so the core
keeps the last catalog it read (the journal setting
`subscription-proxy-opencode-models`) and writes it into that block at every
spawn; a restart starts a turn on a gateway model without probing first. While
the proxy is on, either OpenCode account reads `ok` with no native sign-in.
OpenCode 2 lists none of an injected provider's models in its ACP model option
and still takes them, and for about half a second after `session/new` it refuses
one it has not loaded yet: the driver sends a model under the injected prefix
(`BOITE_SUBSCRIPTION_PROXY_PREFIX`) though it is not listed, and asks again
after 250, 500, 1,000 and 1,500 ms before it warns. Both versions receive that
prefix; agents without it keep the normal model-option validation.

An optional API key stays on the core and is supplied through the agent's
environment, never a URL or process argument. Leave the key field empty to keep
a saved key, or select Remove saved key. Configuration and key changes are saved
in one transaction. Use HTTPS when sending a key over an untrusted network;
HTTP remains available for local and private-network gateways. Dashboard management credentials belong
to the dashboard's own sign-in and are not passed by Boite.

Claude calls the gateway's Messages API. Codex uses its Responses API with
WebSocket support enabled. Codex owns the conversation identifier and prompt
cache key, retaining them between turns and after a socket reconnect; Boite
does not override those headers. Cache-read token counts reported by the agent
remain visible in usage. Disabling the proxy restores the local accounts,
native login checks, model discovery and subscription quota monitoring. Other
agents use their existing configuration.

A provider descriptor configures an agent for an existing driver. Adding an ACP
provider can use JSON alone; adding a new protocol requires runtime code. Shipped
descriptors live in
`packages/core/src/providers/shipped/` and are read-only; a user drops their own
under `<dataDir>/providers/*.json`. The types are in the contract, the loader in
`packages/core/src/providers/loader.ts`, the field checks in `validate.ts`, the
load-time tokens in `expand.ts` and executable resolution in `resolve.ts`, all
beside it. Runtime behavior belongs to the corresponding modules under
`packages/core/src/drivers/`; this page describes their supported behavior.
Shipped descriptors and dependency manifests own version pins.

A descriptor loads or is refused with the file, the field and what was expected.
An unknown field is a refusal, a user file may not take a shipped id, and `roots`
is checked before anything else.
