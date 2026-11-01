import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {
  teamRequest: {
    headings: { create: 'Équipe proposée : {team}', invite: 'Nouveau membre pour {team}', leave: 'Quitter {team}' },
    apply: { create: "Créer l'équipe", invite: "Ajouter à l'équipe", leave: "Retirer de l'équipe" },
    refuse: 'Refuser',
    guestHint: "Seul l'ordinateur qui fait tourner Boite peut modifier les équipes.",
    applied: { create: 'Équipe créée', invite: 'Membre ajouté', leave: 'Membre retiré' },
    refused: 'Refusé',
    closed: 'Fermé sans réponse',
  }
};
