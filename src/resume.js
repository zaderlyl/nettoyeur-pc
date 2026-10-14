import { execFile } from 'node:child_process';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { RACINE, trouverNoeud, uniteDe } from './scanner.js';
import { estProtege } from './protections.js';

const executer = promisify(execFile);

// Catégories de fichiers pour décrire la composition d'un dossier
const CATEGORIES = {
  images: ['.jpg', '.jpeg', '.png', '.gif', '.heic', '.heif', '.webp', '.tif', '.tiff', '.bmp', '.svg', '.cr2', '.nef', '.arw', '.dng', '.raw', '.psd', '.ai'],
  vidéos: ['.mov', '.mp4', '.m4v', '.mkv', '.avi', '.webm'],
  audio: ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.aiff'],
  documents: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.odt', '.ods', '.odp', '.pages', '.numbers', '.key', '.md', '.csv'],
  code: ['.js', '.mjs', '.ts', '.jsx', '.tsx', '.vue', '.svelte', '.py', '.rs', '.go', '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.php', '.rb', '.dart', '.html', '.css', '.scss', '.json', '.sh', '.yml', '.yaml', '.xml'],
  archives: ['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.dmg', '.pkg', '.iso'],
};
const CATEGORIE_PAR_EXTENSION = new Map(
  Object.entries(CATEGORIES).flatMap(([nom, exts]) => exts.map((e) => [e, nom])),
);

const extension = (nom) => (nom.includes('.') ? nom.slice(nom.lastIndexOf('.')).toLowerCase() : '');

const formatTaille = (o) => {
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  while (o >= 1024 && i < u.length - 1) { o /= 1024; i++; }
  return `${o.toFixed(i && o < 100 ? 1 : 0)} ${u[i]}`;
};
const formatMois = (ms) => new Date(ms).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
const couper = (texte, max) => (texte.length > max ? `${texte.slice(0, max - 1).trimEnd()}…` : texte);

// ---------- README ----------
// Premier titre + premier paragraphe, sans les badges, images ni balises
function extraitReadme(texte) {
  let dansCode = false;
  const utiles = [];
  for (const brute of texte.split('\n')) {
    const l = brute.trim();
    if (l.startsWith('```')) { dansCode = !dansCode; continue; } // on saute les blocs de code
    if (dansCode || !l || /^(!\[|\[!\[|<|---|===|\|)/.test(l)) continue;
    utiles.push(l);
  }
  const titre = utiles.find((l) => l.startsWith('#'))?.replace(/^#+\s*/, '');
  const paragraphe = utiles.filter((l) => !l.startsWith('#') && !l.endsWith(':')).slice(0, 2).join(' '); // « : » = annonce un bloc de code
  return couper([titre, paragraphe].filter(Boolean).join(' — '), 280) || null;
}

async function lireReadme(noeud, relatif) {
  const fichier = (noeud.enfants ?? []).find((e) => e.type === 'fichier' && /^readme(\.|$)/i.test(e.nom));
  if (!fichier) return null;
  let poignee;
  try {
    poignee = await open(join(RACINE, relatif, fichier.nom), 'r');
    const { buffer, bytesRead } = await poignee.read(Buffer.alloc(4096), 0, 4096, 0); // 4 Ko suffisent
    return extraitReadme(buffer.toString('utf8', 0, bytesRead));
  } catch {
    return null;
  } finally {
    await poignee?.close();
  }
}

// ---------- Composition d'un dossier ----------
function composition(noeud) {
  const stats = { fichiers: 0, parCategorie: {}, min: Infinity, max: 0, gros: [], opaques: [] };
  (function parcourir(n, prefixe) {
    for (const e of n.enfants ?? []) {
      if (e.type === 'fichier') {
        const cat = CATEGORIE_PAR_EXTENSION.get(extension(e.nom)) ?? 'autres';
        stats.fichiers++;
        stats.parCategorie[cat] = (stats.parCategorie[cat] ?? 0) + 1;
        if (e.modifie) { stats.min = Math.min(stats.min, e.modifie); stats.max = Math.max(stats.max, e.modifie); }
        stats.gros.push({ nom: `${prefixe}${e.nom}`, taille: e.taille });
        if (stats.gros.length > 3) { stats.gros.sort((a, b) => b.taille - a.taille); stats.gros.pop(); }
      } else if (e.type === 'dossier') {
        if (e.enfants) parcourir(e, `${prefixe}${e.nom}/`);
        else stats.opaques.push({ nom: `${prefixe}${e.nom}`, taille: e.taille }); // node_modules, .git…
      }
    }
  })(noeud, '');
  stats.gros.sort((a, b) => b.taille - a.taille);
  return stats;
}

const decrireCategories = (stats) => Object.entries(stats.parCategorie)
  .sort((a, b) => b[1] - a[1]).slice(0, 3)
  .map(([cat, n]) => `${Math.round((n / stats.fichiers) * 100)} % ${cat}`).join(', ');

const decrirePlage = (stats) => (stats.max ? (formatMois(stats.min) === formatMois(stats.max)
  ? formatMois(stats.max) : `de ${formatMois(stats.min)} à ${formatMois(stats.max)}`) : null);

// ---------- Métadonnées d'un fichier (Spotlight, local) ----------
const ATTRIBUTS = ['kMDItemKind', 'kMDItemTitle', 'kMDItemNumberOfPages', 'kMDItemPixelWidth',
  'kMDItemPixelHeight', 'kMDItemDurationSeconds', 'kMDItemWhereFroms'];

async function metadonnees(complet) {
  try {
    const { stdout } = await executer('mdls', [...ATTRIBUTS.flatMap((a) => ['-name', a]), complet], { timeout: 5000 });
    const valeurs = {};
    let cle = null;
    for (const ligne of stdout.split('\n')) {
      const m = ligne.match(/^(kMDItem\w+)\s*=\s*(.*)$/);
      if (m) {
        cle = m[1];
        valeurs[cle] = m[2] === '(' ? [] : m[2].replace(/^"|"$/g, '');
        if (valeurs[cle] === '(null)') delete valeurs[cle];
      } else if (cle && Array.isArray(valeurs[cle]) && ligne.trim() && ligne.trim() !== ')') {
        valeurs[cle].push(ligne.trim().replace(/,$/, '').replace(/^"|"$/g, ''));
      }
    }
    return valeurs;
  } catch {
    return {}; // fichier non indexé ou mdls indisponible : on s'en passe
  }
}

// Origine d'un téléchargement : on garde le site et le chemin, jamais les paramètres (jetons)
function origine(liste) {
  const brut = Array.isArray(liste) ? liste.find((u) => /^https?:\/\//.test(u)) : null;
  if (!brut) return null;
  try {
    const u = new URL(brut);
    return `${u.host}${u.pathname}`;
  } catch {
    return null;
  }
}

// ---------- Résumé d'une unité ----------
// Renvoie { phrase, lignes: [[libellé, valeur], …] } ; tout est calculé localement
export async function resumer(relatif) {
  const noeud = trouverNoeud(relatif);
  if (!noeud) throw new Error('Élément absent du scan');
  if (estProtege(relatif)) throw new Error('Dossier protégé : son contenu n’est jamais lu');
  const genre = uniteDe(relatif);
  if (!genre) throw new Error('Pas une unité : le résumé ne concerne que les unités');

  const lignes = [];
  const ajouter = (k, v) => { if (v) lignes.push([k, v]); };

  if (genre === 'fichier') {
    const m = await metadonnees(join(RACINE, relatif));
    const dims = m.kMDItemPixelWidth && m.kMDItemPixelHeight ? `${m.kMDItemPixelWidth} × ${m.kMDItemPixelHeight} px` : null;
    const pages = m.kMDItemNumberOfPages ? `${m.kMDItemNumberOfPages} page(s)` : null;
    const duree = m.kMDItemDurationSeconds ? `${Math.round(Number(m.kMDItemDurationSeconds))} s` : null;
    const source = origine(m.kMDItemWhereFroms);
    ajouter('Titre', m.kMDItemTitle);
    ajouter('Dimensions', dims);
    ajouter('Pages', pages);
    ajouter('Durée', duree);
    ajouter('Téléchargé depuis', source);
    const nature = m.kMDItemKind || (extension(noeud.nom) ? `Fichier ${extension(noeud.nom)}` : 'Fichier');
    const details = [m.kMDItemTitle && `« ${m.kMDItemTitle} »`, pages, dims, duree].filter(Boolean).join(', ');
    return {
      phrase: couper(`${nature}${details ? ` : ${details}` : ''}${source ? `, téléchargé depuis ${source.split('/')[0]}` : ''}.`, 240),
      lignes,
    };
  }

  const stats = composition(noeud);
  const ouvert = noeud.enfants !== undefined;

  ajouter('Fichiers', ouvert && stats.fichiers ? `${stats.fichiers.toLocaleString('fr')}` : null);
  ajouter('Composition', ouvert ? decrireCategories(stats) : null);
  ajouter('Modifiés', ouvert ? decrirePlage(stats) : null);
  ajouter('Plus gros fichiers', stats.gros.map((g) => `${g.nom} (${formatTaille(g.taille)})`).join(' ; '));
  ajouter('Contenu non listé', stats.opaques.sort((a, b) => b.taille - a.taille).slice(0, 4)
    .map((o) => `${o.nom} (${formatTaille(o.taille)})`).join(' ; '));

  if (genre === 'projet') {
    const p = noeud.projet;
    const readme = await lireReadme(noeud, relatif);
    ajouter('README', p.description ? readme : null); // sans description, le README est déjà dans la phrase
    const base = `Projet ${p.technos.join(', ') || 'git'}${p.nom ? ` « ${p.nom} »` : ''}`;
    const but = p.description || readme || 'aucune description trouvée (ni package.json ni README)';
    return { phrase: couper(`${base} : ${but}`, 240), lignes };
  }

  if (!ouvert) {
    const nature = noeud.nom.includes('.') ? 'Paquet ou dossier à contenu non listé' : 'Dossier à contenu non listé (dépendances, environnement)';
    return { phrase: `${nature}, ${formatTaille(noeud.taille)}.`, lignes };
  }
  if (/\.(app|bundle|framework|plugin|photoslibrary|pkg)$/i.test(noeud.nom)) {
    return { phrase: `Paquet macOS (${extension(noeud.nom)}), ${formatTaille(noeud.taille)}.`, lignes };
  }
  const plage = decrirePlage(stats);
  return {
    phrase: couper(`Dossier de ${stats.fichiers.toLocaleString('fr')} fichier(s) (${decrireCategories(stats)})${plage ? `, modifiés ${plage}` : ''}.`, 240),
    lignes,
  };
}
