# Accounts

Boite runs each agent with your own sign-in. You can use the login you already
have in a terminal, add a second account for the same agent, or send several
agents through a subscription gateway.

## Sign in to an agent

1. Open Settings, Providers.
2. On the agent's row, press Sign in.
3. Press Open the sign-in page and finish in your browser. The row turns
   ready on its own.
4. If the page gives you a code, paste it in the field under the row and
   press Send. Codex works the other way: Boite shows a code and you enter it
   on the sign-in page.

Some agents ask their sign-in questions in a terminal, with menus and arrow
keys: OpenCode and Grok. For those, a terminal opens under the row. Answer its
questions there, then press Close the terminal once you are signed in.

- pi signs in inside pi itself, not from Boite.
- Antigravity signs in with a Google account.
- On a phone you cannot sign in or manage accounts. Do it from the computer
  that runs Boite.

## Your command-line login

An agent already signed in on this computer shows up on its own as Your
command-line login. Boite uses that login where it is and moves nothing.

Removing it only tells Boite to stop using it: the agent stays signed in on
your computer, and Boite does not pick it up again by itself. Use my
command-line login brings it back.

## Add a second account for the same agent

1. Open Settings, Providers and find the agent's row.
2. Press Add another account.
3. Sign in as above, with the other account.
4. Press Rename to give it a name you will recognize.

A second account is a Boite account: it keeps its own configuration and
login files, in Boite's data folder, apart from your terminal login. Pick it
for a conversation from the account chips in the model picker. Antigravity
has no command-line login in Boite: each of its accounts is a Boite account.

Settings shows each account's name and its email. Emails stay blurred until
you hover them, tap them on a phone, or press Reveal email.

## What isolated accounts share

A Boite account still runs with your own settings, instructions and skills.
Before each start, Boite takes them from your usual agent folder:

- A folder, such as `skills` or `plugins`, is linked. The account sees your
  current files, and an edit through it changes your own folder.
- A file, such as `settings.json`, is copied. If the agent edits its copy,
  your file wins again at the next start.
- Login files are never shared. Each account keeps its own sign-in.
- Something Boite did not put there is set aside with `.own-<date>` added to
  its name, never deleted.

| Agent | What it shares from your own folder |
| --- | --- |
| Claude Code | `settings.json`, `CLAUDE.md`, `skills`, `plugins`, `agents`, `commands`, `hooks`, `output-styles`, and the MCP servers of `.claude.json` |
| Codex | `config.toml`, `hooks.json`, `AGENTS.md`, `skills`, `rules`, `prompts`, `plugins` |
| Grok | `config.toml`, `hooks`, `AGENTS.md`, `AGENT.md`, `skills`, `trusted_folders.toml`, `installed-plugins` |
| pi | `settings.json`, `AGENTS.md`, `extensions`, `skills`, `prompts`, `themes` |
| OpenCode | `opencode.json`, `opencode.jsonc`, `AGENTS.md`, `package.json`, its plugin, agent, command and skill folders, and `node_modules` |
| Antigravity | Your user skills from `~/.gemini`; its MCP servers and settings stay out |

An API key set inside a shared settings file applies to every account that
uses the file. A path Boite could not share is shown under the account in
Settings, Brain, Hooks; the agent starts without it.

## When an account is signed out or removed

- A conversation is not tied to one account. If its account is signed out or
  removed, its next message moves it to another signed-in account of the same
  agent, which reloads its whole context.
- With no other account available, the message box shows Sign in again, or
  Account removed. Press it to sign in or pick another model.
- Removing a Boite account signs it out of Boite and deletes its files. The
  confirmation says how many conversations still use it. You cannot remove
  an account while one of its turns runs or waits in the queue.
- Boite never rotates accounts by itself. [Plugins](plugins.md) can manage
  pools of accounts.

## The subscription proxy

As an option, Claude Code, Codex and both OpenCode versions can go through a
gateway you run, and Grok too when the gateway is Douane. Boite supports
Douane and CLIProxyAPI.

1. Open Settings, Providers, Subscription proxy.
2. Under Where the gateway runs, pick Remote gateway or Douane on this
   machine (the Douane plugin, from Settings, Plugins).
3. For a remote gateway, choose Douane or CLIProxyAPI and enter the API URL,
   the Limits dashboard URL and, if needed, the API key (optional).
4. Turn on Use a subscription proxy and press Save proxy.

While it is on:

- Each proxied agent shows one account named after the gateway, and this
  machine's own sign-ins are not used for it.
- Limits shows the gateway's limits, or opens its dashboard inside Boite.
  The Use Douane (or Use CLIProxyAPI) switch there turns the gateway on and
  off, from a phone too.
- Other agents keep their own configuration.

Turning the proxy off brings your local accounts back unchanged. Use HTTPS
when the key crosses a network you do not trust.

Move my connections to Douane, under the proxy settings, sends the sign-ins
and OpenCode API keys you tick to Douane, so nobody signs in again. Claude,
Codex and Grok tokens rotate: once Douane holds one, this machine's copy stops
working, so turning the gateway off later means signing in again here. API
keys are copied as they are.

## Going further

- [Supported agents](supported-agents.md): every agent and how to connect it.
- [Usage](usage.md): limits and quotas per account.
- [Models](models.md): picking an agent, model and account.
- [Plugins](plugins.md): the Douane plugin and account pools.
- Technical reference: [accounts](internals/accounts.md),
  [providers](internals/providers.md#subscription-proxy).
