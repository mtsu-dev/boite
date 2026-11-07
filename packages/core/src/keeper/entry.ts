// `bun src/keeper/entry.ts --data-dir <dir> --socket <path>`: the keeper from the sources,
// without the core's own module graph (`keeper/launch.ts`).
import { runKeeper } from './server.ts';

runKeeper(process.argv.slice(2));
