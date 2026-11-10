import type { ThreadId, ThreadSummary } from '@boite/contracts';
import type { Core } from '../core.ts';
import { refused } from '../errors.ts';
import { withLoad } from './records.ts';

/**
 * `threads.archive` called by a plugin granted `threads.write`
 * (docs/plugins.md, Permissions). Always a Done checked as an automatic
 * pass would be, never on a pinned thread, recorded in the row's
 * `archiveReason` and the core's log. An already archived thread is answered
 * as it is, so a plugin never claims what the owner put away. `archived:
 * false` never gets here: contracts/access.ts refuses it.
 */
export function archiveForPlugin(core: Core, threadId: ThreadId, pluginId: string): ThreadSummary {
  const thread = core.threads.require(threadId);
  if (thread.archived) return withLoad(core, thread);
  if (thread.pinned) {
    throw refused(`pinned: thread ${threadId} is pinned, and a plugin archives only unpinned conversations`, { threadId, field: 'pinned', expected: false });
  }
  // The name as it is now, so the row still reads after an uninstall.
  const archived = core.threads.archive(threadId, true, true, { pluginId, pluginName: core.plugins.state(pluginId).name });
  core.logs.info(`Thread archived by plugin ${pluginId}`, { source: 'plugins', event: 'thread.archived.plugin', threadId, data: { pluginId } });
  return archived;
}
