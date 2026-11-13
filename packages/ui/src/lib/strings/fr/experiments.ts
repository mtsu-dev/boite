import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {

  experiments: {
    whip: {
      title: 'Fouet',
      hint: 'Un fouet animé suit le pointeur ou le doigt. Un geste vif le fait claquer, un clic ou un appui le lâche',
      action: 'Sortir le fouet',
      drop: 'Lâcher le fouet',
      off: "Le fouet a besoin des animations, désactivées dans les réglages du système (Windows : Accessibilité > Effets visuels > Effets d'animation)"
    },
    contacts: {
      title: 'Contacts',
      hint: 'Une page Accueil à côté des fils, où vous reliez votre Boite à celle d\'un autre propriétaire via Tailscale. Un bot intégré, la Standardiste, porte chaque demande entre vos agents et les siens. Pas encore prêt pour un usage quotidien'
    },
    autoGoal: {
      title: 'Objectifs automatiques',
      hint: "Un long message lance un objectif relu sur lui-même, avec sa checklist et une carte sur le tableau du projet, et l'agent peut en lancer un quand un message liste plusieurs demandes. Retirez l'objectif depuis la barre d'objectif pour l'abandonner",
      minChars: 'Longueur du message',
      minCharsHint: 'Un message qui lance un tour avec au moins ce nombre de caractères lance un objectif automatique',
      unit: 'caractères'
    },
    teams: {
      title: 'Équipes',
      hint: "Des bots qui travaillent ensemble dans un salon commun, affiché au-dessus d'eux sur la page Bots : un message réveille les bots qu'il nomme, et chacun répond au groupe ou en privé. Vos bots y écrivent avec boite team. Pas encore prêt pour un usage quotidien"
    },
    debates: {
      title: 'Council',
      hint: 'Vos agents peuvent demander à plusieurs IA de relire un travail ou un plan avec boite delegate council, chacune seule et en lecture seule. Vous les suivez dans un salon et pouvez y écrire ; le fil qui a lancé le council reçoit leurs réponses et leurs notes. Pas encore prêt pour un usage quotidien'
    }
  }
};
