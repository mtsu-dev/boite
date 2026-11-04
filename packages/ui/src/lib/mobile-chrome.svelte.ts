/**
 * What a phone's page tells the navigation around it. A page that opens a
 * conversation of its own, as Agents does, sets `detail` while it shows one:
 * the bottom bar steps aside for its composer, as it does for a thread.
 * A page that draws its own large title sets `largeTitle` while that title
 * is in view, so the bar's small one waits under it as on the lists.
 * A list sets `fabTucked` while it scrolls down, and the New thread button
 * over it slides away until the list moves back up.
 */
export const mobileChrome = $state({ detail: false, largeTitle: false, fabTucked: false });
