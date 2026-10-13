# Nettoyeur PC

App web locale pour scanner le dossier personnel, détecter fichiers et projets, les noter (étoiles) et lister les moins bien notés à supprimer (Corbeille, après confirmation).

## Lancer le projet
```bash
npm run dev
```
URL : http://localhost:5173

## Structure
```
src/        code source (server.js, public/ = interface)
assets/     images, sons, polices
README.md
```

## Conventions
- kebab-case pour les fichiers, commentaires en français.
- Garder cette même organisation sur tous mes projets.
- Aucune dépendance externe tant que ce n'est pas nécessaire.
- Suppression : toujours vers la Corbeille, jamais définitive, jamais sans confirmation.
- `~/Library` exclu du scan par défaut.
