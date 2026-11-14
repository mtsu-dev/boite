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
      bots: 'Mochis',
      add: 'New mochi or team',
      botWaiting: '{name} needs you',
      botFailed: '{name} failed',
      botWorking: '{name} is at work',
      botPaused: '{name} is paused',
      /** A mochi or team with replies not read yet: its picture's badge, in words. */
      unread: 'new replies',
      /** The list foot's limits line, in its tooltip (QuotaLine.svelte): the least left, the window and the account it is on. */
      limitsLeft: '{percent}% left: {window}, {account}',
    }
  }
} as const;
