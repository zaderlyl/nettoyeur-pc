import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { RACINE, resumeNoeud, retirerDuArbre, trouverNoeud } from './scanner.js';
import { lireNotes, retirerNotes } from './notes.js';

const executer = promisify(execFile);

// Dossiers qu'on ne propose et n'envoie jamais à la Corbeille
const PROTEGES = new Set([
  'Desktop', 'Documents', 'Downloads', 'Library', 'Movies', 'Music', 'Pictures',
  'Public', 'Applications', '.Trash', '.ssh', '.gnupg',
]);

// Envoie un élément à la vraie Corbeille via le Finder (« Remettre » reste possible).
// Le chemin est passé en argument, jamais collé dans le script.
const SCRIPT = `on run argv
  tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)
end run`;

// Éléments notés ≤ seuil, les moins bien notés d'abord.
// Un élément déjà contenu dans un autre candidat n'est pas listé (il partira avec lui).
export function candidats(seuil) {
  const notes = lireNotes();
  const retenus = Object.entries(notes)
    .filter(([chemin, note]) => note <= seuil && !PROTEGES.has(chemin))
    .map(([chemin, note]) => ({ chemin, note, noeud: trouverNoeud(chemin) }))
    .filter((c) => c.noeud && c.noeud.type !== 'lien'); // absents du scan ou liens : ignorés

  const chemins = new Set(retenus.map((c) => c.chemin));
  const contenu = (chemin) => {
    for (let c = chemin; c.includes('/');) {
      c = c.slice(0, c.lastIndexOf('/'));
      if (chemins.has(c)) return true;
    }
    return false;
  };

  return retenus
    .filter((c) => !contenu(c.chemin))
    .map(({ chemin, note, noeud }) => ({ ...resumeNoeud(noeud), chemin, note }))
    .sort((a, b) => a.note - b.note || b.taille - a.taille);
}

function message(erreur) {
  if (erreur.message?.includes('-1743')) {
    return 'Accès au Finder refusé : autorise-le dans Réglages Système > Confidentialité et sécurité > Automatisation.';
  }
  return erreur.stderr?.trim() || erreur.message;
}

async function mettreUn(relatif) {
  const segments = typeof relatif === 'string' ? relatif.split('/') : [];
  if (segments.length === 0 || segments.some((s) => s === '' || s === '.' || s === '..')) throw new Error('Chemin invalide');
  if (PROTEGES.has(relatif)) throw new Error('Dossier protégé');
  if (!lireNotes()[relatif]) throw new Error('Élément non noté'); // on ne supprime que ce que tu as noté

  const noeud = trouverNoeud(relatif);
  if (!noeud) throw new Error('Élément absent du scan');
  if (noeud.type === 'lien') throw new Error('Lien symbolique : ignoré');

  const complet = join(RACINE, relatif);
  if ((await lstat(complet)).isSymbolicLink()) throw new Error('Lien symbolique : ignoré');

  await executer('osascript', ['-e', SCRIPT, complet], { timeout: 300_000 });
  retirerDuArbre(relatif);
  await retirerNotes(relatif);
}

// Traite les éléments un par un ; renvoie le résultat de chacun
export async function mettreALaCorbeille(chemins) {
  const resultats = [];
  for (const chemin of chemins) {
    try {
      await mettreUn(chemin);
      resultats.push({ chemin, ok: true });
    } catch (erreur) {
      resultats.push({ chemin, ok: false, erreur: message(erreur) });
    }
  }
  return resultats;
}
