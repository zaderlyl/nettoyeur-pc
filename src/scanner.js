import { readdir, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { detecterProjet } from './projets.js';
import { estProtege } from './protections.js';
import { calculerUnites } from './unites.js';

export const RACINE = homedir();

const relatif = (chemin) => chemin.slice(RACINE.length + 1);

// Dossiers exclus à la racine du dossier personnel
const EXCLUS_RACINE = new Set(['Library']);

// Dossiers dont on compte la taille sans lister le contenu (trop volumineux)
const OPAQUES = new Set(['node_modules', '.git', '.venv', 'venv', 'Pods', '.gradle', 'site-packages']);

export const etat = {
  etat: 'inactif', // inactif | en-cours | termine | erreur
  fichiers: 0,
  dossiers: 0,
  projets: 0,
  unites: 0,
  taille: 0,
  erreurs: 0,
  courant: '',
  debut: null,
  fin: null,
};

let arbre = null;
let projets = []; // tous les projets détectés : { chemin, ...infos }

let unites = []; // éléments à noter / supprimer, recalculés après le scan et chaque suppression

export function lireUnites() {
  return unites;
}

let genreParChemin = new Map();

function recalculerUnites() {
  unites = calculerUnites(arbre);
  genreParChemin = new Map(unites.map((u) => [u.chemin, u.unite]));
  etat.unites = unites.length;
}

// 'projet' | 'dossier' | 'fichier' si ce chemin est une unité, sinon null
export const uniteDe = (relatif) => genreParChemin.get(relatif) ?? null;

export function lireProjets() {
  return projets;
}

function nouveauNoeud(nom, type, st) {
  return {
    nom,
    type, // 'dossier' | 'fichier' | 'lien'
    taille: type === 'lien' ? 0 : st.blocks * 512, // taille réelle sur le disque
    modifie: st.mtimeMs,
    cree: st.birthtimeMs,
    acces: st.atimeMs,
  };
}

// Parcourt un dossier ; renvoie son nœud avec la taille cumulée
async function parcourir(chemin, nom, st, dev, opaque) {
  const noeud = nouveauNoeud(nom, 'dossier', st);
  // Un dossier protégé reste compté en taille mais son contenu n'est ni listé ni analysé
  if (estProtege(relatif(chemin))) {
    noeud.protege = true;
    opaque = true;
  }
  if (!opaque) noeud.enfants = [];
  etat.dossiers++;
  etat.courant = chemin;

  let entrees;
  try {
    entrees = await readdir(chemin, { withFileTypes: true });
  } catch {
    etat.erreurs++;
    return noeud;
  }

  for (const entree of entrees) {
    if (chemin === RACINE && EXCLUS_RACINE.has(entree.name)) continue;
    const complet = join(chemin, entree.name);

    let s;
    try {
      s = await lstat(complet);
    } catch {
      etat.erreurs++;
      continue;
    }

    let enfant;
    if (s.isSymbolicLink()) {
      enfant = nouveauNoeud(entree.name, 'lien', s);
    } else if (s.isDirectory()) {
      if (s.dev !== dev) continue; // ne traverse pas les autres disques
      enfant = await parcourir(complet, entree.name, s, dev, opaque || OPAQUES.has(entree.name));
    } else {
      enfant = nouveauNoeud(entree.name, 'fichier', s);
      etat.fichiers++;
    }

    noeud.taille += enfant.taille;
    if (enfant.type !== 'dossier') etat.taille += enfant.taille; // les dossiers sont déjà comptés via leur contenu
    if (!opaque) noeud.enfants.push(enfant);
  }

  // Pas de projets dans les dossiers cachés (.vscode, .npm… = caches d'outils)
  if (!opaque && !relatif(chemin).split('/').some((s) => s.startsWith('.'))) {
    const projet = await detecterProjet(
      chemin, new Set(entrees.map((e) => e.name)), noeud.enfants, noeud,
    );
    if (projet) {
      noeud.projet = projet;
      etat.projets++;
      projets.push({ chemin: relatif(chemin), taille: noeud.taille, ...projet });
    }
  }

  return noeud;
}

// Ajoute `parent` (chemin du projet le plus proche qui le contient) aux projets imbriqués
function marquerImbriques() {
  const chemins = new Set(projets.map((p) => p.chemin));
  for (const p of projets) {
    let c = p.chemin;
    while (c.includes('/')) {
      c = c.slice(0, c.lastIndexOf('/'));
      if (chemins.has(c)) { p.parent = c; break; }
    }
  }
}

export async function lancerScan() {
  if (etat.etat === 'en-cours') return;
  Object.assign(etat, {
    etat: 'en-cours', fichiers: 0, dossiers: 0, projets: 0, unites: 0, taille: 0, erreurs: 0,
    courant: '', debut: Date.now(), fin: null,
  });
  projets = [];
  try {
    const st = await lstat(RACINE);
    arbre = await parcourir(RACINE, '', st, st.dev, false);
    marquerImbriques();
    recalculerUnites();
    etat.etat = 'termine';
  } catch {
    etat.etat = 'erreur';
  }
  etat.fin = Date.now();
  etat.courant = '';
}

// Nœud sans ses enfants, avec leur nombre (null = contenu non listé)
export function resumeNoeud({ enfants, ...resume }) {
  return { ...resume, contenu: enfants ? enfants.length : null };
}

// Renvoie [racine, …, nœud] pour un chemin relatif, ou null s'il n'est pas dans le scan
function chaine(relatif) {
  if (!arbre) return null;
  const noeuds = [arbre];
  for (const segment of relatif.split('/').filter(Boolean)) {
    const suivant = noeuds.at(-1).enfants?.find((e) => e.nom === segment);
    if (!suivant) return null;
    noeuds.push(suivant);
  }
  return noeuds;
}

export function trouverNoeud(relatif) {
  return chaine(relatif)?.at(-1) ?? null;
}

// Renvoie les enfants du dossier désigné par un chemin relatif ('' = racine)
export function listerDossier(relatif) {
  const noeud = trouverNoeud(relatif);
  if (!noeud || noeud.type !== 'dossier') return null;
  return {
    nom: noeud.nom,
    taille: noeud.taille,
    enfants: (noeud.enfants ?? []).map((e) => ({
      ...resumeNoeud(e),
      unite: uniteDe(relatif ? `${relatif}/${e.nom}` : e.nom), // null = simple conteneur, non notable
    })),
  };
}

// Retire un élément du scan en mémoire (après envoi à la Corbeille)
export function retirerDuArbre(relatif) {
  const noeuds = chaine(relatif);
  if (!noeuds || noeuds.length < 2) return;
  const noeud = noeuds.at(-1);
  const parent = noeuds.at(-2);
  for (const ancetre of noeuds.slice(0, -1)) ancetre.taille -= noeud.taille;
  parent.enfants = parent.enfants.filter((e) => e !== noeud);
  etat.taille -= noeud.taille;
  projets = projets.filter((p) => p.chemin !== relatif && !p.chemin.startsWith(`${relatif}/`));
  etat.projets = projets.length;
  recalculerUnites(); // le dossier parent peut être devenu une unité
}
