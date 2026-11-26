export const strings = {

  /** The title and hint of each experiment with a switch, by its id (`lib/experiment-copy.ts`). */
  experiments: {
    'draft-backdrop': {
      title: 'New thread background',
      hint: 'An animated scene in the manner of an early 2000s console behind the empty new thread screen. Pick it under Appearance. Respects reduced motion'
    },
    'discord-presence': {
      title: 'Discord rich presence',
      hint: 'Shows Playing Boite in your Discord profile, with what your agents are doing: their number, their models and how long they have been working. Works with Discord, Vesktop, Legcord and the other clients that read rich presence, and with any app that reads the same socket, such as the bridges to Fluxer. Desktop app only'
    }
  }
} as const;
