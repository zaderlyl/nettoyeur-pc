import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { etat, lancerScan, lireProjets, lireUnites, listerDossier } from './scanner.js';
import { definirNote, lireNotes } from './notes.js';
import { candidats, mettreALaCorbeille } from './suppression.js';

const PORT = Number(process.env.PORT) || 5173; // PORT=5174 npm run dev pour une 2e instance de test
const DOSSIER_PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), 'public');

// Seul notre propre site peut appeler l'API (protège contre les autres sites et le DNS rebinding)
const ORIGINES = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);

function requeteAutorisee(req) {
  if (!ORIGINES.has(`http://${req.headers.host}`)) return false;
  if (req.method === 'GET') return true;
  // Les requêtes qui modifient quelque chose exigent l'origine du site et un en-tête perso,
  // qu'un autre site ne peut pas envoyer sans notre accord
  return ORIGINES.has(req.headers.origin) && req.headers['x-nettoyeur'] === '1';
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function json(res, donnees, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(donnees));
}

// Lit le corps JSON d'une requête (limité à 1 Mo)
async function lireCorps(req) {
  let texte = '';
  for await (const morceau of req) {
    texte += morceau;
    if (texte.length > 1_000_000) throw new Error('Corps trop gros');
  }
  return JSON.parse(texte);
}

// Routes de l'API ; renvoie true si la requête a été traitée
async function api(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const route = `${req.method} ${url.pathname}`;

  try {
    switch (route) {
      case 'GET /api/notes':
        json(res, lireNotes());
        return true;
      case 'PUT /api/notes': {
        const { chemin, note } = await lireCorps(req);
        await definirNote(chemin, note);
        json(res, { ok: true });
        return true;
      }
      case 'POST /api/scan':
        lancerScan(); // lancé en arrière-plan
        json(res, etat, 202);
        return true;
      case 'GET /api/scan':
        json(res, etat);
        return true;
      case 'GET /api/projets':
        json(res, lireProjets());
        return true;
      case 'GET /api/unites': {
        // ?genre=projet|dossier|fichier  ?statut=notees|non-notees  ?dans=dossier/parent
        // ?tri=taille|modifie|note|nom  ?limite=N (défaut 500, max 5000)  ?debut=N
        const q = url.searchParams;
        const genre = q.get('genre');
        const statut = q.get('statut');
        const dans = (q.get('dans') ?? '').trim().replace(/^~?\/+|\/+$/g, '').toLowerCase();
        const tri = q.get('tri') ?? 'taille';
        const limite = Math.min(Math.max(Number(q.get('limite') ?? 500) || 500, 1), 5000);
        const debut = Math.max(Number(q.get('debut') ?? 0) || 0, 0);
        const notes = lireNotes();
        const toutes = lireUnites();

        const retenues = toutes.filter((u) => (!genre || u.unite === genre)
          && (statut !== 'notees' || notes[u.chemin])
          && (statut !== 'non-notees' || !notes[u.chemin])
          && (!dans || u.chemin.toLowerCase() === dans || u.chemin.toLowerCase().startsWith(`${dans}/`)));

        const ordres = {
          nom: (a, b) => a.chemin.localeCompare(b.chemin, 'fr'),
          note: (a, b) => (notes[b.chemin] ?? 0) - (notes[a.chemin] ?? 0) || b.taille - a.taille,
          modifie: (a, b) => (b.modifie ?? 0) - (a.modifie ?? 0),
        };
        const parGenre = { projet: 0, dossier: 0, fichier: 0 };
        for (const u of toutes) parGenre[u.unite]++;
        json(res, {
          total: retenues.length,
          taille: retenues.reduce((somme, u) => somme + u.taille, 0),
          parGenre,
          elements: [...retenues].sort(ordres[tri] ?? ((a, b) => b.taille - a.taille)).slice(debut, debut + limite),
        });
        return true;
      }
      case 'GET /api/dossier': {
        const liste = listerDossier(url.searchParams.get('chemin') ?? '');
        json(res, liste ?? { erreur: 'Dossier introuvable ou scan non fait' }, liste ? 200 : 404);
        return true;
      }
      case 'GET /api/a-supprimer': {
        const seuil = Number(url.searchParams.get('seuil') ?? 2);
        const elements = candidats(Number.isInteger(seuil) ? seuil : 2);
        json(res, { elements, total: elements.reduce((somme, e) => somme + e.taille, 0) });
        return true;
      }
      case 'POST /api/corbeille': {
        const { chemins } = await lireCorps(req);
        if (!Array.isArray(chemins)) throw new Error('Liste de chemins attendue');
        json(res, { resultats: await mettreALaCorbeille(chemins) });
        return true;
      }
      default:
        return false;
    }
  } catch (e) {
    json(res, { erreur: e.message }, 400);
    return true;
  }
}

const serveur = createServer(async (req, res) => {
  if (!requeteAutorisee(req)) {
    res.writeHead(403).end('Interdit');
    return;
  }
  if (await api(req, res)) return;

  const chemin = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const fichier = normalize(join(DOSSIER_PUBLIC, chemin));

  // Empêche de sortir du dossier public
  if (!fichier.startsWith(DOSSIER_PUBLIC)) {
    res.writeHead(403).end('Interdit');
    return;
  }

  try {
    const contenu = await readFile(fichier);
    res.writeHead(200, { 'Content-Type': TYPES[extname(fichier)] ?? 'application/octet-stream' });
    res.end(contenu);
  } catch {
    res.writeHead(404).end('Introuvable');
  }
});

// Port déjà pris (ex. ancienne instance encore lancée) : on s'arrête au lieu de laisser l'ancienne répondre
serveur.on('error', (erreur) => {
  console.error(erreur.code === 'EADDRINUSE'
    ? `Le port ${PORT} est déjà utilisé : une autre instance tourne. Arrête-la puis relance.`
    : erreur.message);
  process.exit(1);
});

// Écoute uniquement en local
serveur.listen(PORT, '127.0.0.1', () => {
  console.log(`Nettoyeur PC : http://localhost:${PORT}`);
});
