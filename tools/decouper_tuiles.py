#!/usr/bin/env python3
"""
Découpe une grande image de carte en pyramide de tuiles {z}/{x}/{y}.webp
pour l'appli Carte GTA 6 (Leaflet, CRS.Simple, origine en haut à gauche).

Usage :
    python3 tools/decouper_tuiles.py MA_CARTE.png maps/finale
    python3 tools/decouper_tuiles.py MA_CARTE.png maps/finale --format png --qualite 90

Dépendance : Pillow  (pip install pillow)

Convention (la même que dans js/coords.js) :
  - zoom natif zn = ceil(log2(max(largeur, hauteur) / 256))
  - au zoom zn, 1 pixel de tuile = 1 pixel de l'image d'origine
  - au zoom z < zn, l'image est réduite d'un facteur 2^(zn - z)
  - les tuiles du bord sont complétées en transparent jusqu'à 256×256

À la fin, le script affiche le bloc à coller dans maps.json.
"""
import argparse
import json
import math
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow manquant : pip install pillow")

Image.MAX_IMAGE_PIXELS = None  # autorise les très grandes cartes
TAILLE = 256


def zoom_natif(w, h):
    return max(0, math.ceil(math.log2(max(w, h) / TAILLE)))


def main():
    ap = argparse.ArgumentParser(description="Découpe une image en tuiles pour la carte GTA 6")
    ap.add_argument("image", help="image source (png, jpg, webp…)")
    ap.add_argument("sortie", help="dossier de sortie, ex. maps/finale")
    ap.add_argument("--format", default="webp", choices=["webp", "png", "jpg"])
    ap.add_argument("--qualite", type=int, default=82, help="qualité webp/jpg (défaut 82)")
    ap.add_argument("--id", default=None, help="id de la carte dans maps.json")
    ap.add_argument("--nom", default=None, help="nom affiché")
    ap.add_argument("--version", default="v1", help="version de la carte (défaut v1)")
    a = ap.parse_args()

    src = Image.open(a.image)
    src = src.convert("RGBA")
    W, H = src.size
    zn = zoom_natif(W, H)
    tuiles_dir = os.path.join(a.sortie, "tuiles")
    total = 0
    for z in range(zn, -1, -1):
        f = 2 ** (zn - z)
        w, h = math.ceil(W / f), math.ceil(H / f)
        img = src if f == 1 else src.resize((w, h), Image.LANCZOS)
        nx, ny = math.ceil(w / TAILLE), math.ceil(h / TAILLE)
        for x in range(nx):
            os.makedirs(os.path.join(tuiles_dir, str(z), str(x)), exist_ok=True)
            for y in range(ny):
                box = (x * TAILLE, y * TAILLE, min((x + 1) * TAILLE, w), min((y + 1) * TAILLE, h))
                t = img.crop(box)
                if t.size != (TAILLE, TAILLE):
                    fond = Image.new("RGBA", (TAILLE, TAILLE), (0, 0, 0, 0))
                    fond.paste(t, (0, 0))
                    t = fond
                p = os.path.join(tuiles_dir, str(z), str(x), f"{y}.{a.format}")
                if a.format == "jpg":
                    t.convert("RGB").save(p, quality=a.qualite)
                elif a.format == "webp":
                    t.save(p, quality=a.qualite, method=4)
                else:
                    t.save(p, optimize=True)
                total += 1
        print(f"  zoom {z}: {nx}×{ny} tuiles", file=sys.stderr)

    ident = a.id or os.path.basename(os.path.normpath(a.sortie))
    rel = os.path.relpath(tuiles_dir, os.getcwd()).replace(os.sep, "/")
    entree = {
        "id": ident,
        "nom": a.nom or ident,
        "version": a.version,
        "type": "tuiles",
        "chemin": rel + "/",
        "tuiles": "{z}/{x}/{y}." + a.format,
        "largeur_px": W,
        "hauteur_px": H,
        "zoom_natif": zn,
        "zoom_min": max(0, zn - 6),
        "zoom_max": zn + 2,
        "tips": True,
    }
    print(f"{total} tuiles écrites dans {tuiles_dir}", file=sys.stderr)
    print("\nBloc à ajouter dans maps.json (liste \"cartes\") :\n", file=sys.stderr)
    print(json.dumps(entree, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
