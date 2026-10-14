import { estIntouchable } from './protections.js';
import { ouvrirStockage } from './stockage.js';

// memos.json (ignoré par git) : { "chemin/relatif": "à quoi ça sert" }
const stock = await ouvrirStockage('memos.json');
const memos = stock.donnees;

const LONGUEUR_MAX = 2000;

export const lireMemos = () => memos;

// Un texte vide retire le mémo
export function definirMemo(chemin, texte) {
  if (typeof chemin !== 'string' || chemin.length === 0 || chemin.length > 4096) throw new Error('Chemin invalide');
  if (typeof texte !== 'string' || texte.length > LONGUEUR_MAX) throw new Error(`Mémo invalide (texte de ${LONGUEUR_MAX} caractères maximum)`);
  if (texte.trim() !== '' && estIntouchable(chemin)) throw new Error('Dossier protégé : pas de mémo');

  if (texte.trim() === '') delete memos[chemin];
  else memos[chemin] = texte.trim();
  return stock.sauvegarder();
}

// Retire le mémo d'un chemin et de tout ce qu'il contenait (après suppression)
export const retirerMemos = stock.retirerPrefixe;
