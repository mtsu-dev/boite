/** Local append provenance, never serialized into the shared message contract. */
const revisions = new WeakMap<object, { text: string; epoch: object }>();

/** Replacements, including a longer snapshot, invalidate all incremental readers. */
export function textRevision(source: { text: string }): object {
  const current = revisions.get(source);
  if (current?.text === source.text) return current.epoch;
  const next = { text: source.text, epoch: {} };
  revisions.set(source, next);
  return next.epoch;
}

/** The message.delta writer uses this instead of += so readers can trust the append. */
export function appendText(source: { text: string }, delta: string): void {
  textRevision(source);
  source.text += delta;
  revisions.get(source)!.text = source.text;
}
