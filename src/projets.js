import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

// Fichiers ou dossiers qui révèlent un projet : [nom exact, technologie]
const MARQUEURS = [
  ['package.json', 'Node.js'],
  ['pyproject.toml', 'Python'],
  ['requirements.txt', 'Python'],
  ['setup.py', 'Python'],
  ['Cargo.toml', 'Rust'],
  ['go.mod', 'Go'],
  ['pom.xml', 'Java'],
  ['build.gradle', 'Java/Kotlin'],
  ['build.gradle.kts', 'Java/Kotlin'],
  ['Package.swift', 'Swift'],
  ['composer.json', 'PHP'],
  ['Gemfile', 'Ruby'],
  ['pubspec.yaml', 'Dart/Flutter'],
  ['CMakeLists.txt', 'C/C++'],
  ['Makefile', 'Make'],
];

// Marqueurs reconnus par extension
const EXTENSIONS = [
  ['.xcodeproj', 'Xcode'],
  ['.csproj', '.NET'],
  ['.sln', '.NET'],
];

// Sous-dossiers qu'on peut régénérer (dépendances, builds)
const REGENERABLES = new Set([
  'node_modules', 'dist', 'build', 'target', '.next', '.nuxt', '.venv', 'venv',
  '__pycache__', 'Pods', '.gradle', 'DerivedData',
]);

async function lireJson(chemin) {
  try {
    return JSON.parse(await readFile(chemin, 'utf8'));
  } catch {
    return null;
  }
}

// Lit les infos git sans lancer git : branche, dépôt distant, dernière activité
async function infosGit(chemin) {
  const git = join(chemin, '.git');
  const infos = { branche: null, distant: null, activite: null };
  try {
    const tete = (await readFile(join(git, 'HEAD'), 'utf8')).trim();
    infos.branche = tete.startsWith('ref: ') ? tete.replace(/^ref: refs\/heads\//, '') : 'HEAD détachée';
  } catch {
    return infos; // .git est un fichier (worktree, sous-module) ou illisible
  }
  try {
    const config = await readFile(join(git, 'config'), 'utf8');
    infos.distant = config.match(/url\s*=\s*(.+)/)?.[1].trim() ?? null;
  } catch { /* pas de config lisible */ }
  try {
    infos.activite = (await stat(join(git, 'logs', 'HEAD'))).mtimeMs;
  } catch { /* dépôt sans historique */ }
  return infos;
}

// Renvoie les infos du projet si le dossier en est un, sinon null.
// `noms` = noms des entrées du dossier, `enfants` = nœuds déjà scannés.
export async function detecterProjet(chemin, noms, enfants, noeud) {
  const technos = new Set();
  for (const [fichier, techno] of MARQUEURS) if (noms.has(fichier)) technos.add(techno);
  for (const nom of noms) {
    for (const [ext, techno] of EXTENSIONS) if (nom.endsWith(ext)) technos.add(techno);
  }
  const estGit = noms.has('.git');
  if (!estGit && technos.size === 0) return null;

  const projet = { technos: [...technos], git: estGit, nom: null, description: null };

  if (noms.has('package.json')) {
    const pkg = await lireJson(join(chemin, 'package.json'));
    projet.nom = pkg?.name ?? null;
    projet.description = pkg?.description ?? null;
  }

  if (estGit) {
    const g = await infosGit(chemin);
    Object.assign(projet, { branche: g.branche, distant: g.distant });
    projet.activite = g.activite ?? noeud.modifie;
  } else {
    projet.activite = noeud.modifie;
  }

  // Place récupérable en supprimant dépendances et builds
  projet.regenerable = enfants
    .filter((e) => e.type === 'dossier' && REGENERABLES.has(e.nom))
    .reduce((somme, e) => somme + e.taille, 0);

  return projet;
}
