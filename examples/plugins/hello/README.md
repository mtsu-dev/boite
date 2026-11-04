# Hello, an example plugin

A schema 2 plugin on the `bun` runtime, built with `@boite/plugin-sdk`. It adds:

- the agent command `boite hello-threads [--json]`, which prints the five
  conversations that changed last (`src/main.ts`);
- the skill `hello-threads` (`skills/hello-threads.md`);
- one line in every agent's Boite guide (`provides.prompt`);
- the slash command `/recap <topic>` in the composer.

It declares one permission, `threads.read`, the least `threads.list` needs.

## Run it

From this folder, in a terminal of your own (not from an agent's thread):

```sh
bun install
bun run pack
boite plugin dev .
```

`bun install` links the SDK from this repository. `bun run pack` bundles
`src/main.ts` into `hello.js` and writes its SHA-256 into `boite-plugin.json`.
`boite plugin dev .` runs the plugin from this folder; ask an agent in a new
conversation to run `boite hello-threads`.

Edits to `boite-plugin.json` and `skills/` apply at once. After an edit to
`src/`, run `bun run pack` again. `boite plugin dev --remove hello` removes it.

To publish your own copy, upload `hello.js` where the `pack` script's `--url`
points, push the folder to a public git repository and add that URL in
Settings > Plugins. The URL in this manifest is a placeholder.

The plugin format and the SDK: [docs/plugins.md](../../../docs/plugins.md).
