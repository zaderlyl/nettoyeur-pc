import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 5173;
const DOSSIER_PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const serveur = createServer(async (req, res) => {
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
