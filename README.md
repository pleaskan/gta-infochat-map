# Carte GTA 6 — annotations au stylet + tips

Appli web 100 % statique (HTML/CSS/JS, sans build, sans serveur), installable (PWA), utilisable hors ligne.
Pensée pour une tablette avec stylet : **le stylet dessine, le doigt déplace et zoome**.

```
index.html            page unique
manifest.webmanifest  installation (PWA)
sw.js                 service worker (cache hors ligne) — contient VERSION
maps.json             liste des cartes            ← tu édites
styles.json           icônes/couleurs des catégories ← tu édites
data/tips_gta6.geojson  tips (écrit par le pipeline) ← schéma : SCHEMA_GEOJSON.md
maps/                 images et tuiles des cartes
  test/tuiles/        carte de test (grille), en tuiles
  legacy/             les 4 cartes de l'ancienne version (sat, noms, routes, icônes)
js/  css/  lib/       code (Leaflet 1.9.4 + markercluster 1.5.3 inclus en local)
tools/                scripts Python (découpe en tuiles, génération de données de test)
tests/                tests (Node pour la logique, Playwright pour le navigateur)
```

## Tester en local

Il faut un petit serveur (les modules JS ne marchent pas en `file://`) :

```bash
python3 -m http.server 8080      # puis http://localhost:8080/
```

## Gestes et outils

- **Stylet** : dessine avec l'outil actif (stylo sensible à la pression, surligneur, flèche, gomme). Le **bout gomme** du stylet efface toujours.
- **Doigt** : déplacer, pincer pour zoomer. Pendant un trait, et juste après que le stylet a été détecté, les touches au doigt sont ignorées (paume).
- Bouton **🖊️ stylet / ☝️ doigt** : passer en mode « le doigt dessine aussi ».
- **📍 Marqueur** : touche la carte pour en poser un (catégorie, couleur, titre, note, fait). Avec cet outil actif, on peut **glisser** un marqueur pour le déplacer.
- Re-toucher l'outil stylo ouvre la palette (couleurs + épaisseur). ↩️ / ↪️ = annuler / rétablir.
- **🗂️ Panneau** : légende (afficher/masquer par catégorie), filtres, liste triable de la zone visible.
- **☰ Menu** : cartes, export PNG, sauvegarde/restauration, hors ligne, mode gaucher, thème clair, mise à jour.

## Remplacer la carte (la carte définitive)

Toutes les annotations et tous les tips sont en coordonnées **normalisées 0..1** : la résolution de l'image n'a pas d'importance, **seul le cadrage compte**.

**Option A — image unique** (jusqu'à environ 8 000 px de côté) :
1. Dépose l'image, par ex. `maps/finale-v1/carte.webp` (ou .jpg/.png).
2. Ajoute dans `maps.json` (liste `cartes`) :
   ```json
   { "id": "finale", "nom": "GTA 6 — carte complète", "version": "v1", "type": "image",
     "chemin": "maps/finale-v1/carte.webp", "largeur_px": 12000, "hauteur_px": 16000,
     "zoom_min": 0, "zoom_max": 8, "tips": true }
   ```
   `largeur_px` / `hauteur_px` = dimensions **exactes** de l'image.

**Option B — tuiles (recommandé pour une très grande image)** :
```bash
pip install pillow
python3 tools/decouper_tuiles.py ma_carte.png maps/finale-v1 --id finale --version v1 --nom "GTA 6 — carte complète"
```
Le script crée `maps/finale-v1/tuiles/{z}/{x}/{y}.webp` et affiche le bloc à coller dans `maps.json`.

Puis mets `"defaut": "finale"` en haut de `maps.json`. Tu peux supprimer les entrées `test` / `grille` quand tu n'en as plus besoin (garde les cartes `legacy` si tu as des annotations dessus).

**Versions** : `version` identifie le cadrage. Les tips ne s'affichent que si leur `carte_version` est égal à la `version` de la carte, et tes annotations sont rattachées à `id + version`. Si tu changes le cadrage, change la version **et le nom du dossier** (ex. `finale-v2`) : l'appli te signale que tes annotations ont été faites sur l'ancienne version au lieu de les décaler en silence. Si l'image change mais que le cadrage est identique (meilleure qualité), garde la même version mais change quand même le nom du dossier, car les tuiles sont mises en cache.

## Carte officielle (carte par défaut, `v1-officielle`)

Poster officiel « Leonida Map Poster Printable » (5775×7900, CMJN) → `tools/convertir_cmjn.py` (profil ICC → sRGB) → `tools/decouper_tuiles.py` → `maps/officielle-v1/tuiles/` (970 tuiles WebP, 7 Mo). Options propres à cette carte dans `maps.json` :

- **`repere`** — X/Y du jeu, même échelle que **map.stateofleonida.net** (carte du jeu : X −12000…5000, Y −10000…12000, Y vers le haut). Le poster a été recalé automatiquement sur leur image (masques terre/eau, échelle + translation par corrélation) : **X = −11328 + 15424·x**, **Y = 11328 − 21056·y** (x, y normalisés). Précision ≈ ±30 unités. Affiché dans *Grille / repères (X / Y)*, la fiche d'un lieu, d'un marqueur et le bouton Copier.
- **`grille`** — la grille imprimée sur le poster (colonnes 1–9, lignes A–M, case « G7 ») au lieu de la grille 10×10.
- **`regions`** — `maps/officielle-v1/regions.json` + `comtes.png` (générés par `tools/generer_comtes.py`) : les **5 comtés** (Lummox, Leonard, Kelly, Vice-Dale, Mariana) en aplats colorés **sans contours** (chaque zone de terre prend le comté de l'étiquette imprimée la plus proche). Sur la carte entière ils sont visibles ; en zoomant ils s'effacent en fondu, synchronisé avec l'animation de zoom, et une puce animée en bas indique le comté où tu es. Calque *🗺️ Comtés* et raccourcis vers chaque comté dans *Panneau ▸ Filtres*. Limites **approximatives** : le poster n'en dessine pas.

## Mettre à jour les tips

Le pipeline écrit `data/tips_gta6.geojson` (format : **SCHEMA_GEOJSON.md**) puis `git commit` + `git push`.
L'appli lit ce fichier sur le réseau d'abord (copie hors ligne sinon) ; bouton **Actualiser** dans le menu ou le panneau Filtres. La date des données s'affiche dans *Panneau ▸ Filtres*. GitHub Pages peut mettre jusqu'à environ 10 minutes à servir la nouvelle version.
Pour tester sans vraies données : `python3 tools/generer_tips_exemple.py` (30 lieux) ou `… 2000 data/tips_gta6.geojson` (test de charge).

## Publier sur GitHub Pages

1. Crée un dépôt (ex. `carte-gta6`), copie **tout ce dossier** à la racine et pousse sur `main`.
2. *Settings ▸ Pages ▸ Build and deployment* : *Deploy from a branch*, `main`, dossier `/ (root)`.
3. L'appli est sur `https://<utilisateur>.github.io/carte-gta6/` (tous les chemins sont relatifs).
4. Sur la tablette, dans Chrome : menu ⋮ ▸ **Installer l'application** (ou « Ajouter à l'écran d'accueil »).

**Après une modification du code** (js/css/html) : change `VERSION` en haut de `sw.js`. L'appli affichera « Nouvelle version disponible ▸ Mettre à jour ». Les données (`maps.json`, `styles.json`, tips) n'en ont pas besoin. En cas de souci : *Menu ▸ Avancé ▸ Forcer la mise à jour* (ne touche pas aux annotations).

## Sauvegarder mes annotations

- Tout est enregistré automatiquement sur la tablette (IndexedDB, base `carte-gta6`), séparé des données publiques.
- **Menu ▸ 💾 Sauvegarder tout (.json)** : un seul fichier horodaté avec toutes les cartes, les dessins, les marqueurs, l'état des tips (fait/utile/faux/masqué + notes), les réglages et les cartes importées. **À faire régulièrement** et à copier ailleurs (Drive, PC).
- **Menu ▸ 📂 Restaurer une sauvegarde** : accepte ce fichier, mais aussi les **exports de l'ancienne version** (convertis automatiquement).
- **Menu ▸ 🗃️ Sauvegardes automatiques** : une par jour, plus une avant chaque restauration ou suppression de carte (les 12 dernières), et la copie de l'ancien format.
- L'appli demande au navigateur de ne pas effacer ses données (`storage.persist`) ; le menu indique si c'est accordé et l'espace utilisé. Installer l'appli aide à l'obtenir.

## Données de l'ancienne version

Au premier lancement, l'appli lit l'ancienne base (`gta-map`) **sans la modifier**, convertit tes marqueurs, dessins et cartes importées au nouveau format, et garde une copie de l'ancien format (téléchargeable dans les sauvegardes automatiques).
⚠️ Les données d'un navigateur sont propres à **une adresse** : la migration automatique ne marche que si la nouvelle version est servie **à la même adresse** que l'ancienne (même domaine). Sinon, dans l'ancienne appli, fais *☰ ▸ Sauvegarde complète (.json)* pour chaque carte, puis dans la nouvelle *Menu ▸ Restaurer une sauvegarde*.
*Menu ▸ Avancé ▸ Récupérer les données de l'ancienne version* relance la lecture (fusion, sans écraser).

## Tests

```bash
node --test tests/unitaires.test.mjs      # logique : coordonnées, validation, filtres, tris, migration, config
# navigateur (optionnel, nécessite Playwright + Chrome et l'ancienne appli servie sur /ancienne/) :
python3 tests/navigateur_e2e.py
```
