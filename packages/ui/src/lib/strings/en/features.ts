export const strings = {

  /** Finished features, each switched from the Settings page it belongs to. */
  features: {
    chatArtifacts: { title: 'Chat files and previews', hint: 'Open file links and preview files returned by an agent in the conversation' },
    openChatLinks: { title: 'Open chat links in their apps', hint: 'On this desktop, clicking a local file or folder opens its default app, including shortcuts and files outside the project. Only links from this computer are opened.' },
    previewComments: { title: 'Preview comments', hint: 'Select an element in the integrated browser and add feedback to the conversation draft' },
    edgeScrollbars: {
      title: 'Hide scrollbars until the pointer is near',
      hint: 'They take no room and can still be dragged. Mouse and pen only'
    },
  }
} as const;
