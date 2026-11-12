/**
 * The few choices a long list shows in front: the one in use and the first
 * others, `count` in all, in the list's own order. The rest wait behind an
 * "All" that opens them.
 */
export function curated<T extends { id: string }>(options: readonly T[], current: string | undefined, count: number): T[] {
  const using = options.some((option) => option.id === current);
  const others = options.filter((option) => option.id !== current).slice(0, using ? count - 1 : count);
  return options.filter((option) => option.id === current || others.includes(option));
}
