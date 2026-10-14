import { execFile } from 'node:child_process';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { RACINE, trouverNoeud } from './scanner.js';
import { estProtege } from './protections.js';
import { estImage } from './unites.js';

const executer = promisify(execFile);

// Seules ces tailles (côté le plus long, en pixels) sont acceptées : liste et panneau de détails
const GRAND = 480;
export const COTES = new Set([120, GRAND]);

const TAILLE_MAX_SOURCE = 300 * 1024 * 1024; // au-delà, on ne décode pas
const CACHE_MAX = 64 * 1024 * 1024; // miniatures gardées en mémoire (jamais écrites ailleurs que le temps de la conversion)
const SIMULTANEES = 4; // conversions en parallèle

const cache = new Map(); // clé -> Buffer ; l'ordre d'insertion sert à évincer les plus anciennes
let octetsCache = 0;

let actives = 0;
const attente = [];

// Attend une place de conversion. Le grand aperçu du panneau (l'élément sélectionné) passe avant les
// petites miniatures de la liste, sinon il attendrait derrière tout ce que le navigateur a demandé.
async function emplacement(prioritaire) {
  if (actives >= SIMULTANEES) {
    await new Promise((suite) => (prioritaire ? attente.unshift(suite) : attente.push(suite)));
  }
  actives++;
}
function liberer() {
  actives--;
  attente.shift()?.();
}

// Miniature JPEG d'une image du scan, convertie par `sips` (gère aussi HEIC et les formats RAW)
export async function miniature(relatif, cote, signal) {
  if (!COTES.has(cote)) throw new Error('Taille de miniature non autorisée');
  const noeud = trouverNoeud(relatif);
  if (!noeud || noeud.type !== 'fichier') throw new Error('Image absente du scan');
  if (estProtege(relatif)) throw new Error('Dossier protégé : contenu jamais lu');
  if (!estImage(noeud.nom)) throw new Error('Ce n’est pas une image');

  const complet = join(RACINE, relatif);
  const st = await lstat(complet);
  if (!st.isFile()) throw new Error('Pas un fichier ordinaire (lien symbolique ?)');
  if (st.size > TAILLE_MAX_SOURCE) throw new Error('Image trop volumineuse');

  const cle = `${relatif}|${st.mtimeMs}|${cote}`;
  if (cache.has(cle)) {
    const tampon = cache.get(cle);
    cache.delete(cle); // le remet en dernier : « récemment utilisée »
    cache.set(cle, tampon);
    return tampon;
  }

  await emplacement(cote === GRAND);
  if (signal?.aborted) { // le navigateur a abandonné la requête (défilement, changement d'élément) : inutile de convertir
    liberer();
    throw new Error('Requête abandonnée');
  }
  const dossier = await mkdtemp(join(tmpdir(), 'nettoyeur-'));
  try {
    const sortie = join(dossier, 'miniature.jpg');
    await executer('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '70', '-Z', String(cote), complet, '--out', sortie], { timeout: 20_000 });
    const tampon = await readFile(sortie);
    cache.set(cle, tampon);
    octetsCache += tampon.length;
    for (const [ancienne, valeur] of cache) { // évince les plus anciennes au-delà de la limite
      if (octetsCache <= CACHE_MAX) break;
      cache.delete(ancienne);
      octetsCache -= valeur.length;
    }
    return tampon;
  } finally {
    await rm(dossier, { recursive: true, force: true }); // dossier temporaire créé ici, supprimé aussitôt
    liberer();
  }
}
