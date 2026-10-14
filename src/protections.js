import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// protege.json à la racine du projet : chemins relatifs au dossier personnel, jamais touchés
const FICHIER = join(dirname(fileURLToPath(import.meta.url)), '..', 'protege.json');

// macOS ne distingue pas les majuscules et peut décomposer les accents : on compare en minuscules NFC
const normaliser = (chemin) => chemin.normalize('NFC').toLowerCase().replace(/\/+$/, '');

let protegees;
try {
  const liste = JSON.parse(await readFile(FICHIER, 'utf8'));
  const valide = Array.isArray(liste) && liste.every(
    (c) => typeof c === 'string' && c.trim() !== '' && !c.startsWith('/') && !c.split('/').includes('..'),
  );
  if (!valide) throw new Error('doit être une liste de chemins relatifs au dossier personnel');
  protegees = liste.map(normaliser);
} catch (erreur) {
  // Sans la liste, rien ne serait protégé : on refuse de démarrer plutôt que de continuer sans garde-fou
  throw new Error(`protege.json absent ou invalide, l'app ne démarre pas sans lui : ${erreur.message}`);
}

// Dossiers système du dossier personnel : jamais supprimés ni traités comme une unité
export const DOSSIERS_SYSTEME = new Set([
  'Desktop', 'Documents', 'Downloads', 'Library', 'Movies', 'Music', 'Pictures',
  'Public', 'Applications', '.Trash', '.ssh', '.gnupg',
]);

// Le chemin est un dossier protégé ou se trouve dedans
export function estProtege(relatif) {
  const n = normaliser(relatif);
  return protegees.some((p) => n === p || n.startsWith(`${p}/`));
}

// Le chemin est protégé, OU contient un dossier protégé (le supprimer emporterait ce dossier)
export function estIntouchable(relatif) {
  const n = normaliser(relatif);
  return estProtege(relatif) || protegees.some((p) => p.startsWith(`${n}/`));
}
