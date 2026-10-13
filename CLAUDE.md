# Nettoyeur PC

App web locale pour scanner le dossier personnel, détecter fichiers et projets, les noter (étoiles) et envoyer les moins bien notés à la Corbeille après confirmation.

## Lancer le projet
```bash
npm run dev
```
URL : http://localhost:5173

## Structure
```
src/
  server.js        serveur HTTP, routes /api/*, contrôle d'origine
  scanner.js       scan récursif, arbre en mémoire, retrait d'un nœud
  projets.js       détection des projets et de leurs infos
  notes.js         notes 1-5 dans notes.json (écriture atomique)
  suppression.js   candidats « à supprimer » et envoi à la Corbeille
  public/          interface (index.html, style.css, app.js)
assets/            images, sons, polices
notes.json         notes de l'utilisateur (ignoré par git, ne jamais committer)
README.md
```

## API
- `GET/POST /api/scan` état / lancement du scan
- `GET /api/dossier?chemin=` contenu d'un dossier scanné
- `GET /api/projets` projets détectés (`parent` = projet imbriqué)
- `GET/PUT /api/notes` notes (`{chemin, note}`, 0 = retirer)
- `GET /api/a-supprimer?seuil=` éléments notés ≤ seuil
- `POST /api/corbeille` `{chemins}` envoi à la Corbeille
Les chemins sont toujours relatifs au dossier personnel. Les requêtes non-GET exigent l'en-tête `X-Nettoyeur: 1` et l'origine de la page.

## Conventions
- kebab-case pour les fichiers, commentaires en français.
- Garder cette même organisation sur tous mes projets.
- Aucune dépendance externe tant que ce n'est pas nécessaire.
- Pas d'`innerHTML` avec des noms de fichiers : construire le DOM avec `el()` (`textContent`).
- Suppression : toujours vers la Corbeille, jamais définitive, jamais sans confirmation. Ne pas assouplir les garde-fous de `suppression.js` (dossiers protégés, élément noté, présent dans le scan, pas de lien symbolique).
- `~/Library` exclu du scan par défaut.
- Tester la suppression uniquement sur un dossier jetable créé pour l'occasion, jamais sur les données de l'utilisateur ; supprimer ses notes de test de `notes.json` après.
