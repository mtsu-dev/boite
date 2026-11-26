import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {

  presence: {
    idle: 'Inactif',
    workingOn: 'Travaille sur {project}',
    workingOnMore: 'Travaille sur {project} +{more}',
    oneAgent: 'Code avec un agent',
    agents: 'Dirige {count} agents',
    agent: '1 agent',
    agentCount: '{count} agents',
    waiting: '{count} en attente',
    button: 'Découvrir Boite',
    showProjects: 'Afficher le nom des projets',
    showProjectsHint: 'Vos amis voient sur quel projet travaillent les agents. Désactivé : seulement combien d’agents travaillent, et sur quels modèles',
    preview: 'Ce que voient vos amis',
    playing: 'Joue à',
    elapsed: '{time} écoulées',
    none: 'Aucune application de discussion n’écoute sur cet ordinateur. Ouvrez Discord, Vesktop ou un autre client qui affiche ce statut : il apparaît en moins de 15 secondes',
    shownIn: 'Affiché dans {apps}',
    unnamed: 'un client sans nom de compte',
    elsewhere: 'S’affiche seulement depuis l’application de bureau, connectée au Boite de cet ordinateur'
  }
};
