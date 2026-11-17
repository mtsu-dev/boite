export const strings = {
  app: {
    name: 'Boite',
    /** What a nightly build calls itself: window title and tray, never the title bar. The settings name its track Boite Nightly. */
    nightlyName: 'boite (de nuit)',
    /** The tag the title bar shows when the core is the dev install. */
    channelDev: 'Dev',
    channelDevTitle: 'The dev channel, on its own data directory',
    loading: 'Starting',
    /** While the core compacts its journal before serving, once after an update. */
    compacting: 'Freeing disk space in the history. This happens once and can take a few minutes.',
    noEndpointTitle: 'No core to connect to',
    noEndpointBody:
      'On one of your machines, open Settings, Machines, Add a device, and scan or type its code here.',
    openSettings: 'Open settings',
    /** The column of buttons down the window's left edge (AppRail.svelte). */
    rail: {
      label: 'Boite',
      waitingOne: '1 needs you',
      waitingMany: '{count} need you',
      /** The threads at work on every machine: the Threads button's count, in words. */
      workingOne: '1 at work',
      workingMany: '{count} at work',
      bots: 'Mochis',
      add: 'New mochi or team',
      botWaiting: '{name} needs you',
      botFailed: '{name} failed',
      botWorking: '{name} is at work',
      botPaused: '{name} is paused',
      /** The same states as the two words beside a mochi's name when the pointer is on its picture. */
      state: { waiting: 'needs you', failed: 'failed', working: 'at work', paused: 'paused' },
      /** A mochi or team with replies not read yet: its picture's badge, in words. */
      unread: 'new replies',
      /** The same with how many: the count on a mochi's picture. */
      unreadOne: '1 new reply',
      unreadMany: '{count} new replies',
      /** The rail's limits button, in its name card under the sentence (LimitsButton.svelte): how long until the first account serves again. */
      limitsBack: 'back in {time}',
    }
  }
} as const;
