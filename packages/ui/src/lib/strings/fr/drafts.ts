import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {

  drafts: {
    name: 'Brouillons',
    hint: 'Un dossier par fil, dans Documents/Boite',
    openFolder: 'Travailler dans un de mes dossiers',
    pickFolder: 'Ouvrir un dossier',
    incognito: 'Incognito',
    incognitoStart: "Démarrer ce fil en incognito : rien n'en reste une fois que vous le quittez",
    incognitoStop: 'Démarrer plutôt un fil normal',
    incognitoOn: 'Incognito : ce fil et son dossier sont effacés quand vous le quittez',
    launchQueued: 'Ce fil démarre. Attendez la réponse de la machine avant de modifier ce brouillon.',
    privacyQueued: 'Ce brouillon a déjà été envoyé. Ouvrez un nouveau brouillon pour changer de confidentialité.'
  }
};
