# MCP servers

Open **Settings > MCP Servers** on the machine that runs your agents. Add a
server once and Boite makes it available to supported agents on that machine.

## Add a server

1. Choose **Add** next to a server in **Server catalog**.
2. Enter any directory or credentials the form requests. Use **Documentation**
   for the server's setup instructions.
3. Choose **All projects** or **Selected projects**, then **Save**.
4. Click **Test** on the installed server. Expand the tool count to see the
   available tools, or use the error to diagnose the connection.

Choose **Add custom server** to supply your own command and arguments
(`stdio`) or an HTTP endpoint (`HTTP`). Enter one command argument per line.
Turn on **Secret** for each credential. Boite keeps saved credentials out of
your conversations in a local owner-only file in its data folder on that
machine (protected by your operating system account permissions, not a separate
passphrase). When you edit a saved secret, leave the field blank to keep it.
Remove its row to delete it. Use an encrypted connection to Boite to save
credentials. HTTP servers with secret headers use HTTPS unless they run on this
machine's loopback. If you change the server's scheme, host, or port, re-enter
the credentials for the new address. Environment variable names are
case-sensitive on Linux and macOS, and case-insensitive on Windows.

## Use a server

Installed servers are enabled by default. Start a conversation or send the
next message to load changes. Use the switch to disable a server, **Edit** to
change its scope or connection, or **Remove** to delete it and its credentials.
Saving edits preserves the switch setting.

Boite passes these servers to Claude, Codex, OpenCode 2, compatible Muse
versions and ACP agents that support HTTP MCP. A conversation with MCP turned
off or protected execution active skips these servers.
