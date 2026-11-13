/*
 * The timeline's way back to its end, drawn in the strip above the composer
 * rather than over the messages: the open timeline says whether the reader is
 * scrolled up and how many messages arrived since, and lends its jump.
 */
export const latest = $state<{ behind: boolean; unseen: number; jump: (() => void) | null }>({ behind: false, unseen: 0, jump: null });
