# Nettoyeur PC

App web locale pour trier son Mac : elle scanne le dossier personnel, détecte les projets, permet de noter fichiers et projets (étoiles), puis envoie les moins bien notés à la Corbeille après confirmation.

## Lancer
```bash
npm run dev
```
Puis ouvrir http://localhost:5173 (Node récent, aucune dépendance à installer).

## Utilisation
1. **Scanner** : le bouton lance le parcours du dossier personnel (`~/Library` exclu, autres disques ignorés).
2. **Parcourir** : onglet *Fichiers* (arborescence, double-clic pour entrer dans un dossier) ou onglet *Projets* (projets principaux, case pour inclure les sous-projets). Tri par taille, date, note, type ou nom. Le panneau de droite détaille l'élément sélectionné.
3. **Noter** : étoiles de 1 à 5 sur chaque ligne ou dans le panneau. Recliquer sur la note actuelle la retire.
4. **Nettoyer** : onglet *À supprimer*, avec les éléments notés au seuil choisi (1, ≤ 2 ou ≤ 3 étoiles), les moins bien notés d'abord. Tout est coché, décoche ce que tu gardes, puis « Mettre à la Corbeille » et confirme.

## Ce qui est détecté
- **Projets** : présence de `.git` ou d'un fichier marqueur (Node, Python, Rust, Go, Java/Kotlin, Swift, PHP, Ruby, Dart/Flutter, .NET, C/C++, Xcode…).
- **Infos projet** : technologies, nom et description (`package.json`), branche, dépôt distant, dernière activité (via l'historique git, sans lancer git) et espace récupérable (`node_modules`, `build`, `dist`, `.venv`…).
- Les dossiers cachés (`.vscode`, `.npm`…) ne sont pas traités comme des projets. `node_modules`, `.git`, `.venv`, `Pods`, `.gradle` sont comptés en taille mais leur contenu n'est pas listé.

## Sécurité
- Suppression toujours vers la vraie Corbeille (via le Finder, « Remettre » fonctionne), jamais définitive.
- Seuls les éléments que tu as notés et qui sont dans le scan peuvent partir.
- Refusés : dossiers protégés (Desktop, Documents, Downloads, Pictures, Music, Movies, Library, `.ssh`…), chemins avec `..`, liens symboliques.
- Le serveur écoute uniquement en local et vérifie l'origine des requêtes qui modifient quelque chose (protection contre les autres sites).
- Au premier envoi à la Corbeille, macOS peut demander l'autorisation d'Automatisation du Finder.

## Données
Les notes sont dans `notes.json` à la racine du projet (ignoré par git). Si ce fichier est illisible, l'app refuse de démarrer plutôt que de l'écraser.

## Limites connues
- Le scan est en mémoire : il faut relancer le scan après un redémarrage du serveur.
- Une note ne suit pas un fichier déplacé ou renommé.
- L'état « modifications non commitées » des projets n'est pas affiché.
- Testé sur macOS uniquement.
