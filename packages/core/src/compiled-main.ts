// Bun's compiled ESM entry must await the lazy graph before calling main.
// The keeper (`keeper/server.ts`) loads none of the core.
if (process.argv[2] === '--keeper') (await import('./keeper/server.ts')).runKeeper(process.argv.slice(3));
// The echo driver's `[process]` child (`drivers/echo-agent.ts`), the same way.
else if (process.argv[2] === '--echo-agent') await (await import('./drivers/echo-agent.ts')).runEchoAgent();
else (await import('./main.ts')).main(process.argv.slice(2));
export {};
