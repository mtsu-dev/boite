import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {

  trace: {
    exact: 'Tous les processus enfants suivis',
    limited: 'Suivi des processus limité',
    finished: 'Terminé',
    parent: 'PID parent',
    cpuTime: 'Temps CPU',
    currentMemory: 'Mémoire actuelle',
    exe: 'Exécutable',
    pid: 'PID',
    duration: 'Durée',
    cpu: 'CPU',
    memory: 'Mémoire maximale',
    io: 'E/S',
    exit: 'Sortie',
    live: 'en cours',
    empty: "Cette conversation n'a lancé aucun processus.",
    processes: '{count} processus',
    running: '{count} en cours',
    inMemory: '{size} en mémoire',
    showDetails: 'Afficher les détails',
    hideDetails: 'Masquer les détails',
  }
};
