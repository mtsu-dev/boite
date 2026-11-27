import type { Translation } from '../../i18n.svelte';

export const fr: Translation = {
  artifacts: { viewReplay: 'Rejouer', viewExpand: 'Afficher en grand', viewCollapse: 'Fermer la vue agrandie', loadImage: 'Charger', mediaFailed: 'Impossible d’afficher ce média. Réessayez ou téléchargez le fichier pour l’ouvrir.', videoFailed: 'Cet appareil ne lit pas cette vidéo. Téléchargez-la pour la regarder dans une autre app.', saving: 'Enregistrement', zoomIn: 'Agrandir', zoomOut: 'Réduire', fitImage: 'Ajuster l’image', preview: 'Aperçu', download: 'Télécharger', closeImage: 'Fermer l’image', enlarge: 'Voir en grand', saved: 'Enregistré dans Téléchargements', loading: 'Chargement du fichier', unavailable: 'Ce fichier ne peut pas être affiché ici. Téléchargez-le pour l’ouvrir.', failed: 'Impossible d’ouvrir ce fichier', ambiguous: (name: string, paths: string) => `${name} désigne plusieurs fichiers : ${paths}` }
};
