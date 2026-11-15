/**
 * Preloaded into ADEMark's replay server: its clock reads `mach_absolute_time`
 * through FFI, which only macOS has. The server needs a monotonic nanosecond
 * counter and nothing else from it.
 */
import { plugin } from 'bun';

plugin({
  name: 'ademark-linux-clock',
  setup(build) {
    build.onLoad({ filter: /bench\/core\/clock\.ts$/ }, () => ({
      contents: 'export function nowNs(): bigint { return process.hrtime.bigint(); }',
      loader: 'ts',
    }));
  },
});
