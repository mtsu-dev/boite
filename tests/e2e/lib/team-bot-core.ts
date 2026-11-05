/**
 * A real core process whose echo bots answer a team letter with one line. The
 * stock echo sends the whole prompt back, whose `@tous` would wake the team
 * again and again. Anything else ends quiet.
 */
import { setDriver } from '../../../packages/core/src/drivers/index.ts';
import { main } from '../../../packages/core/src/main.ts';

setDriver('echo', { protocol: 'echo', startTurn(ctx) {
  const id = ctx.emit.startMessage('assistant');
  ctx.emit.part(id, 0, { type: 'text', text: ctx.prompt.includes('Team "') ? 'On it.' : '[quiet]' });
  ctx.emit.complete(id, 'complete');
  return { done: Promise.resolve({ status: 'done', sessionId: `team-bot:${ctx.thread.id}`, usage: null }), stop() {} };
} });

main(process.argv.slice(2));
