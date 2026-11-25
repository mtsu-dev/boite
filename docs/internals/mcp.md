# MCP servers

The [MCP Servers settings](../mcp.md) use the owner-only `mcp.list`, `mcp.save`,
`mcp.toggle`, `mcp.remove` and `mcp.test` RPCs. `mcp.changed` tells open owner
clients to refresh the list. Configuring a server can start programs and
send credentials, so agents, plugins and paired sessions cannot call these
methods. The fake client shares the validation and simulates tests.

## Registry and credentials

The core stores definitions in the journal setting `mcp:servers`. RPC
results include non-secret values and credential names. The core keeps
credential values in the data directory's `mcp-secrets.json`, written with
an atomic file replacement and Unix mode `0600`. A missing credential key in
an edit preserves it. A string replaces it and `null` deletes it. Removal
also clears the cached manifest. A journal marker commits a staged credential
file together with its definition so a core restart can finish the replacement.

The registry resolves enabled global definitions and definitions for the
thread's project. Provider session keys include the revision for that
project. Edits, disabling and removal revoke the affected server in warm
sessions. New provider sessions load the current registry. A protected turn
or a context mode with MCP disabled skips registration.

## Proxy and tests

The loopback route `/mcp/lazy/<registration>/<name>` accepts the owning
thread's agent token. For stdio, it starts a traced child in the agent's
working directory and gives the child the configured environment. Cached
handshakes and lists can answer without a new child. For Streamable HTTP,
the proxy adds the configured headers, maps upstream MCP session IDs to
local IDs, forwards JSON and event streams, and refuses redirects. The
proxy masks reflected credential values before returning results or caching
manifests. Release stops stdio children and closes upstream HTTP sessions.

Tests perform `initialize`, `notifications/initialized` and `tools/list`
against the actual server with a 12 second deadline. A stdio test uses the
first available scoped project folder or the core data directory, and waits
for its child to stop. An HTTP test attempts to close its remote session.
The PostgreSQL preset uses the restricted `postgres-mcp` command because
it accepts the connection URI from its environment. HTTP presets use
credentials supplied by the owner, including a Notion OAuth access token.

The `mcp: false` [machine policy](enterprise.md) blocks tests and new managed
registrations and revokes active ones. See [network flows](network.md) for
the traffic it controls.

## Provider support

| Provider | Configuration |
| --- | --- |
| Claude | Streamable HTTP entries alongside user stdio entries proxied by the core. |
| Codex | Streamable HTTP overrides on thread start and resume. Codex reads the thread token from its environment. |
| ACP | HTTP entries in session new and load, when the agent advertises HTTP MCP. OpenCode 2 native receives remote MCP entries in its launch environment. |
| Muse | Streamable HTTP entries through the native host config overrides on supported versions. |
| pi and echo | No Boite-managed MCP transport. |
