/**
 * The shortest tail of each path that no other path in the list shares: the
 * file name alone, or with as many parent folders as it takes. Two
 * `+page.svelte` read `a/+page.svelte` and `b/+page.svelte`.
 */
export function shortPaths(paths: readonly string[]): Map<string, string> {
  const parts = new Map(paths.map((path) => [path, path.split('/')]));
  const depth = new Map(paths.map((path) => [path, 1]));
  const tail = (path: string) => parts.get(path)!.slice(-depth.get(path)!).join('/');
  for (;;) {
    const owners = new Map<string, string[]>();
    for (const path of paths) owners.set(tail(path), [...(owners.get(tail(path)) ?? []), path]);
    let grew = false;
    for (const group of owners.values()) {
      if (group.length < 2) continue;
      for (const path of group) {
        if (depth.get(path)! < parts.get(path)!.length) { depth.set(path, depth.get(path)! + 1); grew = true; }
      }
    }
    if (!grew) break;
  }
  return new Map(paths.map((path) => [path, tail(path)]));
}
