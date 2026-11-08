export const strings = {

  /** The buttons a device shows or puts away, on the Appearance page and in a button's right click. */
  controls: {
    heading: 'Buttons',
    headingHint: 'Essentials keeps the buttons most people use, Every button shows them all. A hidden button stays reachable from the command palette and the keyboard shortcuts.',
    preset: 'Show',
    everyday: 'Essentials',
    developer: 'Every button',
    /** One plain line under the preset row: what the chosen preset shows. */
    presetResult: { everyday: 'The buttons most people use; the others wait in menus and the palette.', developer: 'Every optional button in the header, the message bar and the sidebar.' },
    header: 'Conversation header',
    composer: 'Message bar',
    sidebar: 'Sidebar',
    panel: 'Side panel menu',
    branch: 'Branch',
    context: 'Context gauge',
    hide: 'Hide this button',
    customize: 'Customize',
    allHidden: 'Every card is hidden on this device.'
  }
} as const;
