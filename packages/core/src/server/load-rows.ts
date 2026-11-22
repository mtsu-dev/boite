import type { RpcEvents } from '@boite/contracts';
import { mayReceiveEvent } from '../access.ts';
import type { Core } from '../core.ts';
import { withLoad } from '../threads/records.ts';
import type { EventFrames, ServerConnection } from './connection.ts';

/**
 * Load and progress samples reach clients that did not opt in to patches as
 * the whole `thread.updated` row. One broadcast reads and serializes that row
 * once for all of them, and only when such a client is among its sockets.
 */
export function summaryRowSender(core: Core, patch: RpcEvents['thread.load'] | RpcEvents['thread.progress']): (connection: ServerConnection) => void {
  let row: RpcEvents['thread.updated'] | null | undefined;
  const frames: EventFrames = new Map();
  return (connection) => {
    if (!mayReceiveEvent('thread.updated', connection)) return;
    if (row === undefined) {
      const thread = core.journal.getThread(patch.threadId);
      row = thread === null ? null : { ...withLoad(core, thread), ...('load' in patch ? { load: patch.load } : { progress: patch.progress }) };
    }
    if (row !== null) connection.sendEvent('thread.updated', row, frames);
  };
}
