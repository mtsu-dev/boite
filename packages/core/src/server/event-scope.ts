import type { RpcEventName } from '@boite/contracts';

/** Events about an open thread rather than the machine's shared list. */
export function requiresThreadSubscription(name: RpcEventName): boolean {
  return name === 'threads.pullRequestsChanged' ||
    name.startsWith('message.') ||
    name.startsWith('permission.') ||
    name.startsWith('question.') ||
    name.startsWith('panel.') ||
    name === 'browser.remoteChanged' ||
    name === 'devices.changed' ||
    name === 'windows.changed' ||
    name.startsWith('process.');
}
