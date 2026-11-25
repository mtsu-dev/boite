export const strings = {
  mobile: {
    clearSearch: 'Clear search',
    /** Recent's filter: the conversations whose agent or sub-agents are still at work. */
    atWork: '{count} at work', atWorkFilter: 'Show only the conversations at work',
    draftTitle: 'What would you like to do?', draftHint: 'Start a task, ask a question, or pick up your work.',
    pairTitle: 'Your Boite, on your phone',
    pairBody: 'On any of your machines, open Settings, Machines, Add a device, then scan its QR code here.',
    pairInstalled: 'Just installed Boite? Add it here too: the iPhone app keeps its connection separately from the browser.',
    pairPrivacy: 'The QR code works once and expires within minutes. This phone then reaches every machine of the group.',
    scanInApp: 'Use the Scan button here rather than the Camera app: the camera opens the link in Safari, which keeps a connection of its own.',
    pairingRequired: 'Add this app to your group',
    offlineTitle: 'Waiting for your computer',
    offlineBody: 'Keep Boite running on your computer and check your connection. If you use Tailscale, keep it connected on both devices.',
    troubleshoot: 'Troubleshoot', troubleshootSteps: 'Connection checks',
    checkNearby: 'Nearby devices',
    checkNearbyHint: 'In Android settings: Apps, the browser that runs the app, Permissions, Nearby devices, Allow.',
    checkReach: 'Reach {host}', checkOpen: 'Open',
    checkReachHint: 'Open it in a browser tab. If the page does not load, this phone cannot reach the machine: check Tailscale, the VPN or the Wi-Fi.',
    emptyTitle: 'Start a conversation',
    emptyBody: 'Send a task to an agent. Your conversations will appear here.',
    emptyActivity: 'All caught up',
    /** Activity's head when only updates are left: nothing waits on the user. */
    nothingNeedsYou: 'Nothing needs you',
    computer: 'Connected computer',
    pairAgain: 'Add again',
    settingsPhone: 'Notifications',
    /** Settings' arrow on a phone: back to the place it was opened from. */
    settingsLeave: 'Back',
    settingsBack: 'Back to settings',
    /** Activity's second line: why the thread is listed. `updates` heads what the user reads, under what needs them. */
    feed: { run: 'Wants to run:', helperAsks: '{title} needs you', updates: 'Updates', markAllRead: 'Mark all as read', markAllReadHint: 'Clears failures, stops and finished work. Questions and permissions stay.', verb: { answer: 'Answer', review: 'Review', deny: 'Deny', skip: 'Skip' } },
    navigation: 'Navigation', activity: 'Activity',
    waitingElsewhere: '{count} waiting for you',
    search: 'Find a conversation', noThreads: 'No matching conversations.'
  }
} as const;
