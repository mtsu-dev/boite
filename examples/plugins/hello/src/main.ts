import { runCommands } from '@boite/plugin-sdk';

/*
 * `boite hello-threads [--json]`: the titles of the five conversations that
 * changed last. It needs the `threads.read` permission, which its manifest
 * declares.
 */

await runCommands({
  'hello-threads': async (args, ctx) => {
    const unknown = args.filter(arg => arg !== '--json');
    if (unknown.length > 0) {
      console.error(`unknown argument: ${unknown[0]}; usage: boite hello-threads [--json]`);
      return 2;
    }
    const client = await ctx.connect();
    const threads = await client.call('threads.list', {});
    const latest = threads
      .toSorted((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 5)
      .map(thread => ({ id: thread.id, title: thread.title, updatedAt: thread.updatedAt }));
    if (args.includes('--json')) console.log(JSON.stringify(latest, null, 2));
    else for (const thread of latest) console.log(`${thread.title || '(untitled)'}  ${thread.id}`);
  },
});
