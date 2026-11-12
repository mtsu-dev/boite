# @boite/plugin-sdk

What a Boite plugin's executable needs on the `bun` runtime: `runCommands` to
answer `boite <name>` agent commands, `connect` to talk to the core with the
plugin's token, `definePlugin` to type a manifest, and `bin/pack.ts` to bundle
the plugin into one file and write its SHA-256 into `boite-plugin.json`.

The reference is [docs/internals/plugins.md](../../docs/internals/plugins.md#sdk); a complete
plugin is [examples/plugins/hello](../../examples/plugins/hello).

```sh
bun run check   # tsc
bun test
```
