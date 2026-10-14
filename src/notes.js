import { estIntouchable } from './protections.js';
import { ouvrirStockage } from './stockage.js';

// notes.json (ignoré par git) : { "chemin/relatif": 1..5 }
const stock = await ouvrirStockage('notes.json');
const notes = stock.donnees;

export const lireNotes = () => notes;

// note = 1..5, ou 0 pour retirer la note
export function definirNote(chemin, note) {
  if (typeof chemin !== 'string' || chemin.length === 0 || chemin.length > 4096) throw new Error('Chemin invalide');
  if (!Number.isInteger(note) || note < 0 || note > 5) throw new Error('Note invalide (0 à 5)');
  if (note > 0 && estIntouchable(chemin)) throw new Error('Dossier protégé : il ne peut pas être noté');

  if (note === 0) delete notes[chemin];
  else notes[chemin] = note;
  return stock.sauvegarder();
}

// Retire la note d'un chemin et de tout ce qu'il contenait (après suppression)
export const retirerNotes = stock.retirerPrefixe;
