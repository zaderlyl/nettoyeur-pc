import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estIntouchable } from './protections.js';

// notes.json à la racine du projet (ignoré par git) : { "chemin/relatif": 1..5 }
const FICHIER = join(dirname(fileURLToPath(import.meta.url)), '..', 'notes.json');

let notes = {};
try {
  notes = JSON.parse(await readFile(FICHIER, 'utf8'));
} catch (erreur) {
  // Un fichier absent est normal ; un fichier illisible ne doit pas être écrasé en silence
  if (erreur.code !== 'ENOENT') throw new Error(`notes.json illisible, corrige-le ou supprime-le : ${erreur.message}`);
}

let ecriture = Promise.resolve(); // sérialise les écritures

export const lireNotes = () => notes;

function sauvegarder() {
  // Écriture atomique : fichier temporaire puis renommage
  ecriture = ecriture.catch(() => {}).then(async () => { // un échec précédent ne bloque pas la suite
    await writeFile(`${FICHIER}.tmp`, JSON.stringify(notes, null, 2));
    await rename(`${FICHIER}.tmp`, FICHIER);
  });
  return ecriture;
}

// note = 1..5, ou 0 pour retirer la note
export function definirNote(chemin, note) {
  if (typeof chemin !== 'string' || chemin.length === 0 || chemin.length > 4096) throw new Error('Chemin invalide');
  if (!Number.isInteger(note) || note < 0 || note > 5) throw new Error('Note invalide (0 à 5)');
  if (note > 0 && estIntouchable(chemin)) throw new Error('Dossier protégé : il ne peut pas être noté');

  if (note === 0) delete notes[chemin];
  else notes[chemin] = note;
  return sauvegarder();
}

// Retire la note d'un chemin et de tout ce qu'il contenait (après suppression)
export function retirerNotes(chemin) {
  for (const cle of Object.keys(notes)) {
    if (cle === chemin || cle.startsWith(`${chemin}/`)) delete notes[cle];
  }
  return sauvegarder();
}
