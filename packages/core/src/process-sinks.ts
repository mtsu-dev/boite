import type { Bus } from './bus.ts';
import type { MemoryGuard } from './memory-guard.ts';
import type { GuardEventSink, ProcessEventSink } from './platform/types.ts';
import type { ProcRegistryOptions } from './process-spawn-types.ts';

type Diagnostic = ProcRegistryOptions['diagnostic'];

/** The platform's warnings and memory limits, as the registry reports them; `started` and `exited` stay with it. */
export function platformNotes(bus: Bus, memory: MemoryGuard, diagnostic: Diagnostic): Pick<ProcessEventSink, 'note' | 'memoryLimit'> {
  return {
    note: (threadId, message) => {
      bus.emit('core.log', { level: 'warn', message: 'the process platform reported a warning', source: 'process', event: 'platform.warning', threadId, at: Date.now() });
      try { diagnostic?.(`Process platform: ${message}`, { event: 'platform.warning.detail', threadId }); } catch { /* Observability must not break the platform's callback. */ }
    },
    memoryLimit: (threadId, kind) => {
      memory.memoryLimit(threadId, kind);
      const message = kind === 'thread-cap'
        ? `thread ${threadId}: the thread reached its memory cap`
        : 'the agents reached their memory budget';
      bus.emit('core.log', { level: 'warn', message, source: 'process', event: 'memory.limit', ...(threadId === null ? {} : { threadId }), at: Date.now() });
    },
  };
}

/** What the focus and audio guard reports, as bus events and log lines. */
export function guardEvents(bus: Bus, diagnostic: Diagnostic): GuardEventSink {
  return {
    pushed: (threadId, pid, title, restored) => {
      bus.emit('process.focusPushed', { threadId, pid, title, restored, at: Date.now() });
      bus.emit('core.log', {
        level: 'info',
        message: `a window of pid ${pid} was pushed back; restored=${restored}`,
        source: 'process', event: 'process.focus-pushed', threadId,
        at: Date.now(),
      });
    },
    muted: (threadId, pid) => {
      bus.emit('process.muted', { threadId, pid, at: Date.now() });
      bus.emit('core.log', {
        level: 'info',
        message: `the audio of pid ${pid} is muted`,
        source: 'process', event: 'process.muted', threadId,
        at: Date.now(),
      });
    },
    note: (message) => {
      bus.emit('core.log', { level: 'warn', message: 'the process guard reported a warning', source: 'process', event: 'guard.warning', at: Date.now() });
      try { diagnostic?.(`Focus and audio guard: ${message}`, { event: 'guard.warning.detail' }); } catch { /* Observability must not break the guard's callback. */ }
    },
  };
}
