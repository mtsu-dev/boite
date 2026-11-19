import { TimelineRows } from './timeline-rows';

/** Track each message separately so a live delta dirties only its own row shape. */
export function reactiveTimelineRows(): TimelineRows {
  return new TimelineRows(read => {
    const value = $derived.by(read);
    return () => value;
  });
}
