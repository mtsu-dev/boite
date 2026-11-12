import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {

  connection: {
    machine: 'Machine',
    local: 'Cet ordinateur',
    current: 'Machine actuelle',
    machines: 'machines connectées',
    issues: 'à vérifier',
    manage: 'Gérer les machines',
    folder: 'Dossier',
    browse: 'Parcourir les dossiers',
    nativeBrowse: "Choisir dans l'explorateur Windows",
    parent: 'Dossier parent',
    emptyFolder: 'Aucun sous-dossier',
    unavailable: 'Connexion impossible',
    idle: 'Non connecté',
    connecting: 'Connexion',
    ready: 'Connecté',
    closed: 'Déconnecté',
    offline: 'Hors ligne',
    /** The remedy beside an offline machine (MachinesPage.svelte): it tries now. */
    reconnect: 'Reconnecter',
    /** A machine named as a place, after a project or a thread (MachinePlace.svelte). */
    onMachine: 'sur {name}',
    nameOffline: '{name} hors ligne',
    label: 'Connexion'
  }
};
