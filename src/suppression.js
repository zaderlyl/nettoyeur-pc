import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { RACINE, lireUnites, retirerDuArbre, trouverNoeud, uniteDe } from './scanner.js';
import { lireNotes, retirerNotes } from './notes.js';
import { retirerMemos } from './memos.js';
import { DOSSIERS_SYSTEME, estIntouchable } from './protections.js';

const executer = promisify(execFile);

// Envoie un élément à la vraie Corbeille via le Finder (« Remettre » reste possible).
// Le chemin est passé en argument, jamais collé dans le script.
const SCRIPT = `on run argv
  tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)
end run`;

// Unités notées ≤ seuil, les moins bien notées d'abord.
// Les unités ne sont jamais imbriquées, et les dossiers protégés ou système n'en sont jamais.
export function candidats(seuil) {
  const notes = lireNotes();
  return lireUnites()
    .filter((u) => notes[u.chemin] > 0 && notes[u.chemin] <= seuil)
    .map((u) => ({ ...u, note: notes[u.chemin] }))
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
  if (DOSSIERS_SYSTEME.has(relatif)) throw new Error('Dossier protégé');
  if (estIntouchable(relatif)) throw new Error('Dossier protégé (ou contenant un dossier protégé)');
  if (!lireNotes()[relatif]) throw new Error('Élément non noté'); // on ne supprime que ce que tu as noté
  if (!uniteDe(relatif)) throw new Error('Pas une unité du scan : seules les unités entières peuvent être supprimées');

  const noeud = trouverNoeud(relatif);
  if (!noeud) throw new Error('Élément absent du scan');
  if (noeud.type === 'lien') throw new Error('Lien symbolique : ignoré');

  const complet = join(RACINE, relatif);
  if ((await lstat(complet)).isSymbolicLink()) throw new Error('Lien symbolique : ignoré');

  await executer('osascript', ['-e', SCRIPT, complet], { timeout: 300_000 });
  retirerDuArbre(relatif);
  await retirerNotes(relatif);
  await retirerMemos(relatif);
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
