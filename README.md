# Nettoyeur PC

App web locale pour trier son Mac : elle scanne le dossier personnel, en tire des **unités** (projets, dossiers, fichiers) à noter, affiche un résumé et des miniatures pour se souvenir de l'utilité de chacune, puis envoie les moins bien notées à la Corbeille après confirmation.

## Lancer
```bash
npm run dev
```
Puis ouvrir http://localhost:5173 (Node récent, aucune dépendance à installer).

Pour une 2e instance (test) : `PORT=5174 npm run dev`. Si le port est déjà pris, le serveur s'arrête avec un message au lieu de laisser une ancienne instance répondre.

## Utilisation
1. **Scanner** : le bouton lance le parcours du dossier personnel (`~/Library` exclu, autres disques ignorés). Il faut relancer le scan après chaque redémarrage du serveur.
2. **Unités** (onglet par défaut) : la liste à plat de tout ce qui peut être noté. Filtres par genre (projets, dossiers, fichiers), notes (toutes, non notées, notées) et dossier (« Dans »), tri par taille, date, note ou nom. 500 unités par page, « Afficher la suite » pour la suite.
3. **Noter** : étoiles de 1 à 5 sur chaque ligne ou dans le panneau de droite. Au clavier : `↑`/`↓` pour changer d'élément, `0` à `5` pour noter l'élément sélectionné.
4. **Se souvenir** : le panneau montre un résumé automatique, un aperçu pour les images, et une zone **mémo** pour écrire à quoi ça sert (enregistrée toute seule, visible en jaune dans les listes).
5. **Fichiers** : l'arborescence classique pour parcourir (double-clic pour entrer dans un dossier). Seules les unités se notent ; un simple conteneur affiche « — ».
6. **À supprimer** : les unités notées au seuil choisi (1, ≤ 2 ou ≤ 3 étoiles), les moins bien notées d'abord. Tout est coché, décoche ce que tu gardes, puis « Mettre à la Corbeille » et confirme.

## Les unités
Une unité est ce qu'on note et ce qu'on peut supprimer. On part du bas de l'arbre et on ne propose jamais un dossier qui n'est qu'un conteneur :
- **Projet** : sa racine (le projet le plus haut s'ils sont imbriqués). Détection via `.git` ou un fichier marqueur (Node, Python, Rust, Go, Java/Kotlin, Swift, PHP, Ruby, Dart/Flutter, .NET, C/C++, Xcode…).
- **Dossier** : le plus profond qui contient des fichiers. Les paquets macOS (`.app`, `.photoslibrary`…) et les dossiers de dépendances (`node_modules`…) sont un seul élément, jamais éclatés.
- **Fichier seul** : les fichiers en vrac à côté de sous-dossiers, et tous les fichiers d'un dossier majoritairement fait d'images ou de documents (jugement image par image).
- **Dossier « en vrac »** : un dossier hors projet avec au moins 10 fichiers qui ne sont ni des images ni des documents, sans dépôt git dedans (copie de site, archive décompressée), est pris en entier.
- **Jamais une unité** : dossiers protégés, dossiers système (Desktop, Documents, Downloads…), éléments cachés (`.gradle`, `.npm`…), liens symboliques, dossiers vides.

## Résumé et mémo
- **Résumé automatique**, calculé localement à la demande : pour un projet, la description (`package.json`, sinon début du `README`), la composition (« 56 % images, 24 % code »), les plus gros fichiers, le contenu non listé ; pour un dossier, sa composition et sa période ; pour un fichier, les métadonnées macOS (type, titre, pages, dimensions, durée et **site d'origine du téléchargement**, sans les paramètres d'URL).
- **Mémo** : ton texte libre, dans `memos.json`. Il est effacé avec l'élément quand il part à la Corbeille.
- **Miniatures** : les images (HEIC et RAW compris) sont converties par `sips`, gardées en mémoire (64 Mo max), jamais écrites sur le disque.
- Rien ne quitte ton Mac.

## Dossiers protégés
`protege.json` liste les dossiers (relatifs au dossier personnel) qui ne sont **jamais touchés** : `Documents/PRO`, `Documents/COUR MMI` et `BUT_MMI`. Ils sont comptés en taille et marqués 🔒, mais leur contenu n'est ni listé, ni lu, ni noté, ni supprimable, ni résumé. Un dossier qui en contient un est lui aussi intouchable. Modifie ce fichier pour ajouter les tiens. S'il manque ou est invalide, l'app refuse de démarrer.

## Sécurité
- Suppression toujours vers la vraie Corbeille (via le Finder, « Remettre » fonctionne), jamais définitive, jamais sans confirmation.
- Seules les unités **que tu as notées** et qui sont dans le scan peuvent partir. Refusés : dossiers protégés ou système, chemins avec `..`, liens symboliques.
- Le serveur écoute uniquement en local. Il vérifie l'hôte de chaque requête, exige l'origine et un en-tête sur celles qui modifient quelque chose, et refuse de servir les miniatures à un autre site.
- Au premier envoi à la Corbeille, macOS peut demander l'autorisation d'Automatisation du Finder.

## Données
Fichiers à la racine du projet, ignorés par git, jamais à committer :
- `notes.json` : les notes (`{chemin: 1..5}`).
- `memos.json` : les mémos (`{chemin: texte}`).

Si l'un d'eux est illisible, l'app refuse de démarrer plutôt que de l'écraser. Les chemins sont relatifs au dossier personnel.

## Limites connues
- Le scan est en mémoire : relancer le scan après un redémarrage du serveur.
- Une note ou un mémo ne suit pas un fichier déplacé ou renommé.
- Seules les images ont un aperçu (pas les PDF ni les vidéos).
- Le résumé d'un fichier non indexé par Spotlight est minimal.
- Les éléments cachés (`.gradle`, `.npm`…) et les dossiers vides ne sont pas proposés.
- L'état « modifications non commitées » des projets n'est pas affiché.
- Testé sur macOS uniquement.
