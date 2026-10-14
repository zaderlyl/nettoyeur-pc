import { DOSSIERS_SYSTEME } from './protections.js';

// Un « unité » est ce qu'on note et ce qu'on peut supprimer :
//  - un projet entier (sa racine, le projet le plus haut s'ils sont imbriqués) ;
//  - le dossier le plus profond qui contient des fichiers ;
//  - un fichier seul (fichiers en vrac, dossiers d'images ou de documents).
// On part du bas de l'arbre : on ne propose jamais un dossier qui n'est qu'un conteneur.

// Dossier de photos ou de documents : on juge fichier par fichier
const IMAGES = new Set(['.jpg', '.jpeg', '.png', '.gif', '.heic', '.heif', '.webp', '.tif', '.tiff', '.bmp', '.cr2', '.nef', '.arw', '.dng', '.raw']);
const DOCUMENTS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.odt', '.ods', '.odp', '.pages', '.numbers', '.key', '.md']);
const SEUIL_INDIVIDUEL = 0.5; // au-delà de cette part d'images/documents, chaque fichier est une unité

// Dossiers que macOS traite comme un seul fichier : jamais éclatés (en supprimer un morceau casse l'ensemble)
const PAQUETS = new Set([
  '.app', '.bundle', '.framework', '.plugin', '.kext', '.prefpane', '.photoslibrary', '.imovielibrary',
  '.fcpbundle', '.logicx', '.band', '.rtfd', '.sparsebundle', '.xcarchive', '.playground', '.pkg',
]);

// Dossier (hors projet) avec au moins ce nombre de fichiers « en vrac » qui ne sont ni des images ni des
// documents (copie de site, archive décompressée), et sans dépôt git dedans : c'est un tout, jamais éclaté
const SEUIL_VRAC = 10;

// Fichiers d'intendance qui ne comptent pas comme du contenu
const IGNORES = new Set(['Thumbs.db', 'desktop.ini', 'Icon\r']);

const extension = (nom) => (nom.includes('.') ? nom.slice(nom.lastIndexOf('.')).toLowerCase() : '');

export const estImage = (nom) => IMAGES.has(extension(nom));

function estIndividuel(fichiers) {
  const concernes = fichiers.filter((f) => IMAGES.has(extension(f.nom)) || DOCUMENTS.has(extension(f.nom)));
  return concernes.length / fichiers.length > SEUIL_INDIVIDUEL;
}

// Un dépôt git quelque part dans ce dossier = du travail à soi, qu'on ne doit pas avaler dans un « tout »
function contientDepotGit(noeud) {
  return (noeud.enfants ?? []).some((e) => e.type === 'dossier' && (e.projet?.git || contientDepotGit(e)));
}

function unite(noeud, chemin, genre, dossier) {
  const { enfants, ...resume } = noeud;
  return { ...resume, chemin, unite: genre, dossier, contenu: enfants ? enfants.length : null, image: genre === 'fichier' && estImage(noeud.nom) };
}

// Parcourt l'arbre du scan et renvoie la liste à plat des unités
export function calculerUnites(arbre) {
  const unites = [];
  if (!arbre) return unites;

  function traiter(d, chemin, dossier) {
    if (d.protege) return; // dossier protégé : jamais proposé
    const conteneur = chemin === '' || DOSSIERS_SYSTEME.has(chemin); // Documents, Desktop… ne sont jamais une unité

    if (!conteneur && d.projet) {
      unites.push(unite(d, chemin, 'projet', dossier));
      return;
    }
    if (!conteneur && PAQUETS.has(extension(d.nom))) { // application, photothèque… : un seul élément
      unites.push(unite(d, chemin, 'dossier', dossier));
      return;
    }
    if (!d.enfants) { // contenu non listé (node_modules, venv…) : on le garde tel quel
      if (!conteneur) unites.push(unite(d, chemin, 'dossier', dossier));
      return;
    }

    // Les éléments cachés, liens et fichiers d'intendance sont ignorés
    const visibles = d.enfants.filter((e) => !e.nom.startsWith('.') && e.type !== 'lien' && !IGNORES.has(e.nom));
    const sousDossiers = visibles.filter((e) => e.type === 'dossier');
    const fichiers = visibles.filter((e) => e.type === 'fichier');

    // Dossier « en vrac » : on le prend entier sans descendre dedans
    if (!conteneur && sousDossiers.length > 0 && fichiers.length >= SEUIL_VRAC && !estIndividuel(fichiers) && !contientDepotGit(d)) {
      unites.push(unite(d, chemin, 'dossier', dossier));
      return;
    }

    for (const s of sousDossiers) traiter(s, chemin ? `${chemin}/${s.nom}` : s.nom, chemin);

    if (fichiers.length === 0) return;
    if (sousDossiers.length === 0 && !conteneur && !estIndividuel(fichiers)) {
      unites.push(unite(d, chemin, 'dossier', dossier)); // dossier le plus profond avec des fichiers
      return;
    }
    // Fichiers en vrac à côté de sous-dossiers, ou dossier de photos/documents : un par un
    for (const f of fichiers) unites.push(unite(f, chemin ? `${chemin}/${f.nom}` : f.nom, 'fichier', chemin));
  }

  traiter(arbre, '', '');
  return unites;
}
