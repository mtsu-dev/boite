export const strings = {
  /** What plugins draw in Boite's own window (`provides.ui`), and the safe mode that skips them. */
  pluginUi: {
    /** The chip a plugin card shows when it brings a script or a style. */
    adds: 'Interface',
    /** The line under the permission, in red: the danger of `ui`. */
    danger: 'Its code runs in the app: it can do anything you can.',
    running: 'Interface loaded',
    loading: 'Loading its interface',
    failed: 'Its interface stopped: {error}',
    skipped: 'Interface not loaded: safe mode',
    reload: 'Reload interface',
    /** The tab a plugin's panel tab falls back to before its script names it again. */
    tab: 'Plugin',
    /** A tab whose plugin is not loaded, or no longer offers it. */
    tabGone: '{name} is not loaded right now.',
    /** The safe mode notice: plugin scripts were skipped at this start. */
    safeTitle: 'Safe mode',
    safeFlag: 'Plugin interfaces are off for this window.',
    safeCrash: 'Boite closed while plugin interfaces were loading last time, so they were not loaded now.',
    safeLoad: 'Load them',
    safeDismiss: 'Keep them off',
    /** Who drew a button: on its tooltip after its own label. */
    from: 'From {name}',
    /** The menu under a message, when plugins add actions to it. */
    more: 'More actions',
  },
};
