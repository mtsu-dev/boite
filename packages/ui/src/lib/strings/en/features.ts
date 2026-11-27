export const strings = {

  /** Finished features, each switched from the Settings page it belongs to. */
  features: {
    chatArtifacts: { title: 'Chat files and previews', hint: 'Show file paths in answers as chips that open the file, and preview files returned by an agent in the conversation' },
    openChatLinks: { title: 'Open chat links in their apps', hint: 'On this desktop, clicking a document or folder of a conversation on this computer opens it in its default app instead of the side panel. A program still asks first.' },
    previewComments: { title: 'Preview comments', hint: 'Select an element in the integrated browser and add feedback to the conversation draft' },
    edgeScrollbars: {
      title: 'Hide scrollbars until the pointer is near',
      hint: 'They take no room and can still be dragged. Mouse and pen only'
    },
    whip: {
      title: 'Whip',
      hint: 'A Whip button beside the other controls: an animated whip follows your pointer or finger. Flick to crack it, click or tap to drop it',
      action: 'Throw the whip',
      drop: 'Drop the whip',
      off: 'The whip needs animations, which are off in your system settings (Windows: Accessibility > Visual effects > Animation effects)'
    },
  }
} as const;
