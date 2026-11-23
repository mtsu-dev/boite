/** Percent of total CPU capacity over the interval, to one decimal place. */
export function cpuPercentForInterval(cpuMs: number, elapsedMs: number, logicalCpus: number): number {
  return Math.round((cpuMs / (elapsedMs * Math.max(1, logicalCpus))) * 1000) / 10;
}
