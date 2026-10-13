import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { etat, lancerScan, listerDossier } from './scanner.js';

const PORT = 5173;
const DOSSIER_PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function json(res, donnees, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(donnees));
}

// Routes de l'API ; renvoie true si la requête a été traitée
function api(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/scan' && req.method === 'POST') {
    lancerScan(); // lancé en arrière-plan
    json(res, etat, 202);
    return true;
  }
  if (url.pathname === '/api/scan' && req.method === 'GET') {
    json(res, etat);
    return true;
  }
  if (url.pathname === '/api/dossier' && req.method === 'GET') {
    const liste = listerDossier(url.searchParams.get('chemin') ?? '');
    json(res, liste ?? { erreur: 'Dossier introuvable ou scan non fait' }, liste ? 200 : 404);
    return true;
  }
  return false;
}

const serveur = createServer(async (req, res) => {
  if (api(req, res)) return;

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

// Écoute uniquement en local
serveur.listen(PORT, '127.0.0.1', () => {
  console.log(`Nettoyeur PC : http://localhost:${PORT}`);
});
