export const strings = {

  connection: {
    machine: 'Machine',
    local: 'This computer',
    current: 'Current machine',
    machines: 'machines connected',
    issues: 'need attention',
    manage: 'Manage machines',
    folder: 'Folder',
    browse: 'Browse folders',
    nativeBrowse: 'Choose in Windows Explorer',
    parent: 'Parent folder',
    emptyFolder: 'No subfolders',
    unavailable: 'Could not connect',
    idle: 'Not connected',
    connecting: 'Connecting',
    ready: 'Connected',
    closed: 'Disconnected',
    offline: 'Offline',
    /** The remedy beside an offline machine (MachinesPage.svelte): it tries now. */
    reconnect: 'Reconnect',
    nameOffline: '{name} offline',
    label: 'Connection'
  }
} as const;
