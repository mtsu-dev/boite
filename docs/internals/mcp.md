# MCP servers

The [MCP Servers settings](../mcp.md) use the owner-only `mcp.list`, `mcp.save`,
`mcp.toggle`, `mcp.remove` and `mcp.test` RPCs. `mcp.changed` tells open owner
clients to refresh the list. Configuring a server can start programs and
send credentials, so agents, plugins and paired sessions cannot call these
methods. The fake client shares the validation and simulates tests.

## Registry and credentials

The core stores definitions in the journal setting `mcp:servers`. RPC
results include non-secret values and credential names. The core keeps
credential values in a local owner-only JSON file in its data directory
(`mcp-secrets.json`, not in the conversation journal and not encrypted with a
separate passphrase), written with an atomic file replacement and protected by
Unix mode `0600` (or the user profile ACL on Windows). A missing credential key
in an edit preserves it. A string replaces it and `null` deletes it. Removal
also clears the cached manifest and drops the server's active masking scope. A
journal marker commits a staged credential file together with its definition so
a core restart can finish the replacement. Saving non-null credential updates
requires an encrypted RPC connection; deleting a saved credential (`null`) is
allowed over any owner link. HTTP secret headers travel over HTTPS or loopback
and stay bound to the saved URL origin. Changing scheme, host or port discards
the previous headers unless the save supplies replacement values.

The registry resolves enabled global definitions and definitions for the
thread's project. If `mcp-secrets.json` is unreadable or malformed, errors name
the file path, a sanitized reason (omitting JSON parser token excerpts so
credentials cannot leak into logs), and the expected JSON shape so the owner
can fix or remove it to reset stored credentials; server removal still succeeds
without touching the unreadable file, and session startup logs a warning and
skips managed servers instead of blocking threads or dropping user stdio
servers. Only `secretEnv` and `secretHeaders` are stored in `mcp-secrets.json`
and masked (stripping any leading HTTP authorization scheme so bare tokens are
masked alongside full header values); tokens placed in `url` or `args` stay in
`mcp:servers` unmasked. In the Settings UI form, HTTP `Authorization` fields
prefix bare tokens on add and edit (`Sentry-Bearer ` for Sentry, `Bearer `
otherwise) while preserving any explicit scheme; raw `mcp.save` RPC callers
supply the exact header value. Provider session keys include the revision for
that project. Edits, disabling and removal revoke the affected server in warm
sessions. New provider sessions load the current registry. A protected turn or
a context mode with MCP disabled skips registration.

## Proxy and tests

The loopback route `/mcp/lazy/<registration>/<name>` accepts the owning
thread's agent token and disables the HTTP server idle timeout only after
authenticating the token and resolving the server. For stdio, it starts a
traced child in the agent's working directory and gives the child the
configured environment plus platform paths, locale, certificate paths, and
proxy/package-index variables (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`,
`ALL_PROXY`, `NPM_CONFIG_REGISTRY`, `UV_INDEX_URL`, `PIP_INDEX_URL`) from the
core. Cached handshakes and lists for managed stdio servers key on the command,
arguments, and environment key names so they can answer across working
directories without spawning a new child. For Streamable HTTP, the proxy adds
the configured headers, maps upstream MCP session IDs to local IDs, forwards
JSON and event streams, and refuses redirects. The proxy masks reflected
credential values (4 characters or longer) before returning results or caching
manifests while keeping JSON-RPC protocol keys intact. POST requests allow a
5-minute (`300 s`) upstream idle timeout (returning `504` on timeout) and keep
event streams open while receiving data. An upstream 404 expires the session
locally. Release stops stdio children and closes upstream HTTP sessions with
the negotiated protocol version.

Tests perform `initialize`, `notifications/initialized` and `tools/list`
against the actual server with a 12 second deadline. A stdio test uses the
first available scoped project folder, or a fresh temporary directory for
global servers, masks stderr before taking its tail if the server exits early,
and waits for its child to stop. An HTTP test attempts to close its remote
session. The PostgreSQL preset uses the restricted `postgres-mcp` command
because it accepts the connection URI from its environment. HTTP presets
(GitHub, Linear, Notion, Sentry) use credentials supplied by the owner
(`Bearer ` tokens for GitHub, Linear and Notion Business/Enterprise MCP tokens;
`Sentry-Bearer ` for Sentry).

The `mcp: false` [machine policy](enterprise.md) blocks tests and new managed
registrations, revokes active ones and aborts in-flight tests (core shutdown
also aborts in-flight tests). See [network flows](network.md) for
the traffic it controls.

## Provider support

| Provider | Configuration |
| --- | --- |
| Claude | Streamable HTTP entries alongside user stdio entries proxied by the core. |
| Codex | Streamable HTTP overrides on thread start and resume. Codex reads the thread token from its environment. |
| ACP | HTTP entries in session new and load, when the agent advertises HTTP MCP. OpenCode 2 native receives remote MCP entries in its launch environment. |
| Muse | Native `mcp_servers` overrides with `transport: streamable_http`, the loopback URL and an authorization header expanded from the environment. Requires Muse 1.4.13+ (verified with Muse 1.4.14). If `.muse-version` is absent and `--version` (bounded to 2 s) fails transiently, the host is not reused across turns so the next turn retries the check. |
| pi and echo | No Boite-managed MCP transport. |
