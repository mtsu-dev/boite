import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {
  pluginUi: {
    adds: 'Interface',
    danger: "Son code tourne dans l'app : il peut faire tout ce que vous faites.",
    running: 'Interface chargée',
    loading: 'Chargement de son interface',
    failed: "Son interface s'est arrêtée : {error}",
    skipped: 'Interface non chargée : mode sans échec',
    reload: "Recharger l'interface",
    tab: 'Extension',
    tabGone: "{name} n'est pas chargée pour l'instant.",
    safeTitle: 'Mode sans échec',
    safeFlag: 'Les interfaces des extensions sont coupées pour cette fenêtre.',
    safeCrash: "Boite s'est fermée pendant le chargement des interfaces d'extensions la dernière fois : elles n'ont pas été chargées cette fois.",
    safeLoad: 'Les charger',
    safeDismiss: 'Les laisser coupées',
    from: 'De {name}',
    more: "Plus d'actions",
  },
};
