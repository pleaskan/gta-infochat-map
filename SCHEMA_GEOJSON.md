# Schéma du fichier de tips — `data/tips_gta6.geojson`

Fichier produit par le programme externe (pipeline de tips), lu en lecture seule par l'appli.
C'est un **GeoJSON FeatureCollection**, mais **sans latitude/longitude** : les coordonnées sont
**normalisées 0..1 sur l'image de la carte**.

## Repère des coordonnées

```
(0,0) ───────── x ─────────▶ (1,0)
  │
  y        image de la carte
  │
  ▼
(0,1)                        (1,1)
```

- `x` = position horizontale / largeur de l'image (0 = bord gauche, 1 = bord droit)
- `y` = position verticale / hauteur de l'image (0 = **haut**, 1 = **bas**)
- Depuis des pixels de l'image de référence : `x = px / largeur_px`, `y = py / hauteur_px`
  (`largeur_px` / `hauteur_px` = valeurs de la carte dans `maps.json`).
- Pour relever une position dans l'appli : active le calque **Grille / repères** (le réticule central
  affiche `x · y`), ou pose un marqueur perso : sa fiche affiche ses coordonnées avec un bouton **Copier**.

## Structure

```json
{
  "type": "FeatureCollection",
  "metadata": { "genere_le": "2026-11-19T21:30:00Z", "source": "pipeline-tiktok" },
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [0.4312, 0.5871] },
      "properties": {
        "lieu": "Marina Nord",
        "type": "quartier",
        "rayon": 0.03,
        "carte_version": "v1",
        "tips": [
          {
            "id": "tip-00042",
            "categorie": "argent",
            "enonce": "Coffre avec 5000 $ derrière le comptoir",
            "precision": "Uniquement de nuit, entrée côté est.",
            "nb_sources": 3,
            "verifie_en_jeu": true,
            "urls": ["https://www.tiktok.com/@x/video/123", "https://www.tiktok.com/@y/video/456"]
          }
        ]
      }
    }
  ]
}
```

**Un Feature = un lieu**, avec un ou plusieurs tips. Les tips dont le lieu n'a pas pu être placé
ne doivent **pas** apparaître dans le fichier.

## Champs

| Champ | Type | Obligatoire | Règle / effet |
|---|---|---|---|
| `metadata.genere_le` | texte ISO 8601 | non | Affiché comme « données générées le … ». À défaut : en-tête `Last-Modified` du serveur. |
| `metadata.source` | texte | non | Informatif. |
| `geometry.type` | `"Point"` | **oui** | Autre géométrie → lieu ignoré. |
| `geometry.coordinates` | `[x, y]` nombres | **oui** | Dans 0..1 (tolérance ±0,001). Hors limites → lieu ignoré (message « lat/lon ? » si valeurs > 1,5). |
| `properties.lieu` | texte non vide | **oui** | Nom affiché ; utilisé par la recherche et le tri. |
| `properties.type` | `quartier` · `ville` · `region` · `batiment` · `point_interet` · `mission` · `route` · `autre` | non | Valeur inconnue/absente → `autre` (avertissement). Filtrable dans la légende. |
| `properties.rayon` | nombre ou `null` | non | Zone autour du lieu, en **fraction de la largeur** de la carte (0,01 = 1 % de la largeur). Dessine un anneau. Doit être dans ]0, 1]. |
| `properties.carte_version` | texte | recommandé | Doit être **égal au champ `version`** de la carte dans `maps.json`. Sinon le lieu est masqué (avec un bandeau « Afficher quand même »). Absent = affiché sur toute carte qui a `"tips": true`. |
| `properties.tips` | liste | **oui** | Au moins un tip valide, sinon lieu ignoré. |
| `tips[].id` | texte | **oui** (fortement) | **Doit rester STABLE d'une génération à l'autre** : les états perso (fait / utile / faux / masqué / note) y sont rattachés. Absent → id généré à partir du lieu + énoncé (avertissement). Doublon → tip ignoré. |
| `tips[].categorie` | texte | non | Libre, découverte dynamiquement. Style (icône, couleur, nom) dans `styles.json`, sinon style par défaut. Absent → `autre`. |
| `tips[].enonce` | texte non vide | **oui** | Sinon tip ignoré. |
| `tips[].precision` | texte | non | Détail affiché sous l'énoncé. |
| `tips[].nb_sources` | entier ≥ 0 | non | Défaut 0. Filtre « sources minimum » et tri. |
| `tips[].verifie_en_jeu` | booléen | non | `true` → badge « ✅ vérifié en jeu » et bord vert sur la carte. |
| `tips[].urls` | liste de textes | non | Liens vidéo. Seules les URL `http(s)://` sont gardées (les autres sont ignorées). |

## Validation à la lecture

- Fichier absent, JSON cassé, ou pas une `FeatureCollection` → bandeau d'erreur ; l'appli reste
  utilisable (et garde les derniers tips chargés s'il y en avait).
- Entrées invalides → **ignorées une par une et comptées** : *Panneau ▸ Filtres ▸ Données des tips*
  affiche « N lieu(x) et M tip(s) ignorés » avec le détail des 30 premiers problèmes.
- Fichier vide (`"features": []`) → valide, 0 lieu.

## Conseils pour le pipeline

- Écris le fichier en entier puis remplace-le (pas d'écriture partielle) ; UTF-8.
- Garde les `id` de tips stables (par ex. hash du consensus, pas un compteur qui se décale).
- Mets à jour `metadata.genere_le` à chaque génération.
- Quand la carte change de cadrage (nouvelle version dans `maps.json`), recalcule les coordonnées et
  change `carte_version`.
- Test rapide sans l'appli : `node --test tests/` vérifie aussi le fichier d'exemple ; pour valider ton
  propre fichier, remplace `data/tips_gta6.geojson` et regarde le panneau Filtres.
