import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE_PROJET = join(dirname(fileURLToPath(import.meta.url)), '..');

// Petit fichier JSON { "chemin/relatif": valeur } à la racine du projet, avec écriture atomique
export async function ouvrirStockage(nom) {
  const fichier = join(RACINE_PROJET, nom);

  let donnees = {};
  try {
    donnees = JSON.parse(await readFile(fichier, 'utf8'));
  } catch (erreur) {
    // Un fichier absent est normal ; un fichier illisible ne doit pas être écrasé en silence
    if (erreur.code !== 'ENOENT') throw new Error(`${nom} illisible, corrige-le ou supprime-le : ${erreur.message}`);
  }

  let ecriture = Promise.resolve(); // sérialise les écritures

  function sauvegarder() {
    ecriture = ecriture.catch(() => {}).then(async () => { // un échec précédent ne bloque pas la suite
      await writeFile(`${fichier}.tmp`, JSON.stringify(donnees, null, 2));
      await rename(`${fichier}.tmp`, fichier);
    });
    return ecriture;
  }

  // Retire un chemin et tout ce qu'il contenait (après suppression)
  function retirerPrefixe(chemin) {
    for (const cle of Object.keys(donnees)) {
      if (cle === chemin || cle.startsWith(`${chemin}/`)) delete donnees[cle];
    }
    return sauvegarder();
  }

  return { donnees, sauvegarder, retirerPrefixe };
}
