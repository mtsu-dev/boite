import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {

  threadMove: {
    moveTo: 'Déplacer vers un projet',
    archivedProject: '{project} (archivé)',
    noOtherProject: 'Aucun autre projet',
    stopFirst: 'Un fil enfant travaille ; arrêtez-le avant de déplacer ce fil',
    runningTitle: 'Déplacer à la fin de ce tour',
    runningBody: "L'agent travaille dans {folder}. Le fil passe dans {project} quand le tour en cours se termine.",
    runningConfirm: 'Déplacer après ce tour',
    runningBackgroundBody: "L'agent travaille dans {folder}. Le fil passe dans {project} quand le tour en cours se termine. Quelque chose qu'il a lancé tourne encore en arrière-plan : arrêtez-le à ce moment-là, ou laissez-le tourner là-bas jusqu'à ce que l'agent commence son prochain tour dans {project}.",
    pending: 'Passe dans {project} après ce tour',
    cancelMove: 'Annuler le déplacement',
    monitorsTitle: 'Des moniteurs tournent encore',
    backgroundTitle: 'Du travail tourne encore en arrière-plan',
    backgroundBody: "L'agent fait encore tourner quelque chose dans {folder}. Arrêtez-le maintenant, ou laissez-le tourner là-bas jusqu'à ce que l'agent commence son prochain tour dans {project}.",
    stopMonitors: 'Arrêter les moniteurs',
    stopWork: "L'arrêter",
    keep: 'Les garder',
    dropHere: 'Déplacer le fil vers {project}',
    dragHint: 'Déposer sur un autre projet'
  }
};
