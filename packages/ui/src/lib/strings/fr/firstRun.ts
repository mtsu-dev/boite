import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {
  firstRun: {
    welcome: 'Boite fait travailler vos agents IA sur vos propres machines.',
    heading: 'Ouvrir un projet',
    deviceOlderCore: "Cette machine a une version de Boite trop ancienne pour ajouter un projet depuis cet appareil. Mettez-la à jour dans Réglages, Version, Mises à jour, ou ajoutez le projet depuis l'application de cette machine.",
    pathPlaceholder: 'Chemin absolu du dossier',
    agents: 'Agents',
    steps: 'Pour commencer',
    stepConnect: 'Connectez une IA que vous utilisez déjà',
    stepProject: 'Ouvrez un dossier de projet',
    stepTask: 'Décrivez une tâche, l\'agent s\'en charge',
    installed: 'Installé',
    others: 'Autres agents',
    otherMachine: 'Connecter un autre ordinateur ou un téléphone',
    marks: 'Dans vos listes, chaque fil porte son état',
    /** What each mark of the legend asks of you, beside its word. */
    marksWaiting: 'Une réponse ou une permission vous attend',
    marksWorking: 'L\'agent y travaille',
    marksFailed: 'Il s\'est arrêté : ouvrez-le pour voir pourquoi',
  }
};
