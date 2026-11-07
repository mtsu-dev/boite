import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {

  workflow: {
    activeOne: '1 workflow',
    activeMany: '{count} workflows',
    status: { running: 'En cours', paused: 'En pause', done: 'Terminé', failed: 'En échec', stopped: 'Arrêté' },
    stepStatus: { waiting: 'En attente', running: 'En cours', done: 'Terminée', failed: 'En échec', skipped: 'Sautée', stopped: 'Arrêtée' },
    steps: '{done}/{total} étapes',
    phase: 'Phase {n}',
    pause: 'Pause',
    resume: 'Reprendre',
    stop: 'Arrêter',
    retry: 'Relancer',
    stopTitle: 'Arrêter « {name} » ?',
    stopBody: "Les étapes en cours s'arrêtent et les suivantes ne démarrent pas. Les étapes finies gardent leurs résultats.",
    forEach: 'Une par élément de {path}',
    after: 'Après {steps}',
    condition: 'Seulement si {condition}',
    loop: "Reprend depuis {step} jusqu'à {condition}, {max} tours au plus",
    inLoop: 'Repasse dans la boucle de {step}',
    round: 'Tour {round} sur {max}',
    loopTitle: "Tour {round} sur {max} : retour à {from} jusqu'à {condition}",
    loopsBack: 'Repart vers {step}',
    task: 'Tâche',
    result: 'Résultat',
    output: 'Sortie',
    items: 'Exécutions',
    openThread: 'Ouvrir la conversation',
    back: 'Retour au graphe',
    close: 'Fermer le détail',
    notStarted: 'Pas encore démarrée.',
    skipped: "Sautée : sa condition n'était pas remplie.",
    card: 'Workflow',
    show: 'Voir le workflow',
    tokens: '{tokens} jetons',
    tokensHelp: 'Usage transmis par les tours terminés, lectures et écritures du cache et nouvelles tentatives comprises.'
  }
};
