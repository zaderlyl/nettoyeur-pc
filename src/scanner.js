import { readdir, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const RACINE = homedir();

// Dossiers exclus à la racine du dossier personnel
const EXCLUS_RACINE = new Set(['Library']);

// Dossiers dont on compte la taille sans lister le contenu (trop volumineux)
const OPAQUES = new Set(['node_modules', '.git']);

export const etat = {
  etat: 'inactif', // inactif | en-cours | termine | erreur
  fichiers: 0,
  dossiers: 0,
  taille: 0,
  erreurs: 0,
  courant: '',
  debut: null,
  fin: null,
};

let arbre = null;

export function lireArbre() {
  return arbre;
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

  return noeud;
}

export async function lancerScan() {
  if (etat.etat === 'en-cours') return;
  Object.assign(etat, {
    etat: 'en-cours', fichiers: 0, dossiers: 0, taille: 0, erreurs: 0,
    courant: '', debut: Date.now(), fin: null,
  });
  try {
    const st = await lstat(RACINE);
    arbre = await parcourir(RACINE, '', st, st.dev, false);
    etat.etat = 'termine';
  } catch {
    etat.etat = 'erreur';
  }
  etat.fin = Date.now();
  etat.courant = '';
}

// Renvoie les enfants du dossier désigné par un chemin relatif ('' = racine)
export function listerDossier(relatif) {
  if (!arbre) return null;
  let noeud = arbre;
  for (const segment of relatif.split('/').filter(Boolean)) {
    noeud = noeud.enfants?.find((e) => e.nom === segment && e.type === 'dossier');
    if (!noeud) return null;
  }
  return {
    nom: noeud.nom,
    taille: noeud.taille,
    enfants: (noeud.enfants ?? []).map(({ enfants, ...resume }) => ({
      ...resume,
      contenu: enfants ? enfants.length : null,
    })),
  };
}
