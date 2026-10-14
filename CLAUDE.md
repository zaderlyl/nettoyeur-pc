# Nettoyeur PC

App web locale pour scanner le dossier personnel, en tirer des unités (projet, dossier le plus profond, fichier), les noter (étoiles), les résumer (résumé auto + mémo, miniatures) et envoyer les moins bien notées à la Corbeille après confirmation.

## Lancer le projet
```bash
npm run dev
```
URL : http://localhost:5173 — `PORT=5174 npm run dev` pour une 2e instance de test. Avant de tester, vérifier que le port est libre (`lsof -nP -iTCP:5173 -sTCP:LISTEN`) : une ancienne instance peut répondre à la place.

## Structure
```
src/
  server.js        serveur HTTP, routes /api/*, contrôle d'hôte et d'origine
  scanner.js       scan récursif, arbre en mémoire, retrait d'un nœud, unités
  projets.js       détection des projets et de leurs infos
  unites.js        calcul des unités (règles de découpage de l'arbre)
  protections.js   protege.json, dossiers système, estProtege / estIntouchable
  stockage.js      fichier JSON {chemin: valeur} à écriture atomique
  notes.js         notes 1-5 (notes.json)
  memos.js         mémos texte (memos.json)
  resume.js        résumé automatique d'une unité (README, composition, mdls)
  miniatures.js    miniatures JPEG via sips (cache mémoire, priorité, abandon)
  suppression.js   candidats « à supprimer » et envoi à la Corbeille
  public/          interface (index.html, style.css, app.js)
assets/            images, sons, polices
protege.json       dossiers jamais touchés (versionné)
notes.json         notes de l'utilisateur (ignoré par git, ne jamais committer)
memos.json         mémos de l'utilisateur (ignoré par git, ne jamais committer)
README.md
```

## API
Les chemins sont toujours relatifs au dossier personnel. Les requêtes non-GET exigent l'en-tête `X-Nettoyeur: 1` et l'origine de la page.
- `GET/POST /api/scan` état / lancement du scan
- `GET /api/unites` liste des unités : `genre`, `statut` (`notees`/`non-notees`), `dans`, `tri` (`taille`/`modifie`/`note`/`nom`), `limite` (500, max 5000), `debut`
- `GET /api/dossier?chemin=` contenu d'un dossier scanné (chaque enfant porte `unite` et `image`)
- `GET /api/projets` projets détectés (`parent` = projet imbriqué)
- `GET/PUT /api/notes` notes (`{chemin, note}`, 0 = retirer)
- `GET/PUT /api/memos` mémos (`{chemin, memo}`, texte vide = retirer)
- `GET /api/resume?chemin=` résumé d'une unité
- `GET /api/miniature?chemin=&cote=120|480` miniature JPEG d'une image
- `GET /api/a-supprimer?seuil=` unités notées ≤ seuil
- `POST /api/corbeille` `{chemins}` envoi à la Corbeille

## Règles des unités (`unites.js`)
- Projet = racine du projet le plus haut. Paquet macOS (`.app`…) et dossier à contenu non listé = un seul élément.
- Dossier le plus profond avec des fichiers = unité. Fichiers en vrac à côté de sous-dossiers, et dossiers majoritairement images/documents (> 50 %) = fichier par fichier.
- Dossier hors projet avec ≥ 10 fichiers en vrac non image/document et sans dépôt git dedans = un tout.
- Jamais une unité : protégé, dossier système (`DOSSIERS_SYSTEME`), caché, lien, vide.
- Les unités ne sont jamais imbriquées ; elles sont recalculées après chaque retrait.

## Conventions
- kebab-case pour les fichiers, commentaires en français.
- Garder cette même organisation sur tous mes projets.
- Aucune dépendance externe tant que ce n'est pas nécessaire.
- Pas d'`innerHTML` avec des noms de fichiers : construire le DOM avec `el()` (`textContent`).
- Suppression : toujours vers la Corbeille, jamais définitive, jamais sans confirmation. Ne pas assouplir les garde-fous de `suppression.js` (non protégé, noté, dans le scan, **unité**, pas de lien symbolique) ni de `protections.js`.
- Dossiers protégés (`protege.json` : `Documents/PRO`, `Documents/COUR MMI`, `BUT_MMI`) : leur contenu n'est jamais lu, listé, résumé ni servi, et eux-mêmes ne sont jamais notés ni supprimés (seul le dossier apparaît, marqué 🔒). Ne jamais les retirer sans accord explicite.
- `~/Library` exclu du scan par défaut. Rien ne doit quitter le Mac (pas d'appel réseau, pas d'API externe).

## Tests
- Les tests destructifs se font **uniquement dans une copie isolée** (copier `src/`, `package.json`, `protege.json` dans le scratchpad avec un `notes.json` vide), sur un port libre (`PORT=5174`), avec un fichier ou dossier **leurre créé pour l'occasion**. Jamais sur les données de l'utilisateur, jamais sur `PRO`, `BUT_MMI` ni `COUR MMI`, même pour « tester un refus » : faire ces tests en lecture seule ou sur un leurre protégé via un `protege.json` de test.
- Vérifier que le serveur qui répond est bien le sien (même PID que celui sur le port) avant tout appel destructif.
- Après les tests : arrêter le serveur de test, supprimer les leurres et leurs `.DS_Store`, vérifier que `notes.json` et `memos.json` de l'utilisateur sont inchangés.
- Le Finder met les leurres dans la Corbeille de l'utilisateur : le dire dans le compte rendu.
