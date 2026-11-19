#!/usr/bin/env python3
# Usage : python3 tools/generer_comtes.py CARTE_RGB.png maps/officielle-v1   (Pillow + numpy)
"""Zones des 5 comtés sur la carte officielle, SANS contours :
- chaque pixel de terre prend le comté de la « graine » la plus proche (graines = étiquettes imprimées du poster) ;
- calque PNG transparent (eau transparente, bords adoucis) superposé par l'appli ;
- regions.json : graines + étiquettes (l'appli s'en sert pour dire « tu es dans Kelly County »).
Coordonnées des graines lues sur le poster au 1/3 (1925 x 2633)."""
import json, sys
import numpy as np
from PIL import Image, ImageFilter
Image.MAX_IMAGE_PIXELS = None
W3, H3 = 1925, 2633
COMTES = [
    ("lummox", "Lummox County", "#ffb703", (960, 530), [(925, 375), (730, 575), (740, 630), (1227, 467), (992, 437), (950, 597),
        (720, 413), (1017, 347), (1107, 303), (1238, 385), (840, 620), (1100, 500), (1214, 540), (845, 470)]),
    ("leonard", "Leonard County", "#8338ec", (1345, 945), [(1152, 665), (1268, 607), (1168, 1140), (1265, 1042), (1423, 850),
        (1164, 825), (1376, 698), (1490, 655), (1300, 780), (1250, 900), (1440, 1000)]),
    ("kelly", "Kelly County", "#fb5607", (815, 1040), [(945, 737), (760, 1335), (585, 940), (678, 1177), (555, 1388), (885, 1105),
        (475, 790), (275, 1065), (362, 1150), (338, 1445), (925, 1245), (750, 778), (855, 905), (650, 1050)]),
    ("vicedale", "Vice-Dale County", "#ff006e", (1390, 1510), [(877, 1410), (1189, 1783), (1290, 1370), (1638, 1287), (1088, 1503),
        (1296, 1566), (1550, 1464), (1490, 1100), (1397, 1140), (1664, 1566), (1533, 1646), (1279, 1683), (1200, 1708),
        (1127, 1315), (1600, 1200), (1000, 1450), (1350, 1250)]),
    ("mariana", "Mariana County", "#3a86ff", (793, 1922), [(867, 1745), (817, 1853), (1005, 1926), (632, 1688), (757, 1638),
        (1164, 1995), (1094, 2190), (866, 2300), (630, 2248), (533, 2290), (420, 2183), (701, 2220), (1300, 1945), (950, 2050)]),
]
COUPURE = 0.09            # au-delà de cette distance (fraction de la largeur) d'une graine : hors comté

src, sortie = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
W, H = im.size
w, h = W // 8, H // 8
a = np.asarray(im.resize((w, h), Image.BILINEAR)).astype(int)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
eau = ((b - r) > 50) & ((g - r) > 50)
terre = Image.fromarray((~eau * 255).astype(np.uint8))
terre = terre.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MedianFilter(5))
t = np.asarray(terre) > 127
# hors cadre, légende, sceau, titre : jamais un comté
fx, fy = w / W3, h / H3
def zone(x0, y0, x1, y1): t[int(y0 * fy):int(y1 * fy), int(x0 * fx):int(x1 * fx)] = False
zone(0, 0, W3, 100); zone(0, 2540, W3, H3); zone(0, 0, 100, H3); zone(1850, 0, W3, H3)
zone(150, 130, 450, 510)          # légende
zone(1380, 1760, 1880, 2520)      # sceau + « The Great State of Leonida »
ys, xs = np.mgrid[0:h, 0:w]
gx, gy, gi = [], [], []
for i, (_, _, _, lab, graines) in enumerate(COMTES):
    for (x, y) in [lab] + graines:
        gx.append(x / W3); gy.append(y / H3); gi.append(i)
gx, gy, gi = np.array(gx), np.array(gy), np.array(gi)
nx, ny = (xs + .5) / w, (ys + .5) / h
d2 = (nx[..., None] - gx) ** 2 + ((ny[..., None] - gy) * (H / W)) ** 2      # distance en fractions de largeur
k = np.argmin(d2, axis=2)
comte = gi[k]
ok = t & (np.sqrt(np.min(d2, axis=2)) < COUPURE)
rgba = np.zeros((h, w, 4), np.uint8)
for i, (_, _, coul, _, _) in enumerate(COMTES):
    c = tuple(int(coul[j:j + 2], 16) for j in (1, 3, 5))
    m = ok & (comte == i)
    rgba[m, :3] = c
    rgba[m, 3] = 255
# couleurs étalées sous l'eau voisine (pas de liseré sombre au flou), puis alpha adouci : pas de contour net
img = Image.fromarray(rgba, "RGBA")
coul = Image.fromarray(rgba[..., :3]).filter(ImageFilter.MaxFilter(7))
alpha = Image.fromarray(rgba[..., 3]).filter(ImageFilter.GaussianBlur(2.2))
out = Image.merge("RGBA", (*coul.split(), alpha))
out.save(sortie + "/comtes.png", optimize=True)
regions = {
    "_aide": "Zones des comtés (sans contours). Graines/étiquettes en coordonnées normalisées 0..1 sur l'image. Généré par tools/generer_comtes.py.",
    "calque": "comtes.png", "coupure": COUPURE,
    "regions": [{"id": i_, "nom": n, "couleur": c, "etiquette": [round(l[0] / W3, 4), round(l[1] / H3, 4)],
                 "graines": [[round(x / W3, 4), round(y / H3, 4)] for (x, y) in [l] + gr]} for (i_, n, c, l, gr) in COMTES],
}
json.dump(regions, open(sortie + "/regions.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(w, h, "pixels de terre :", int(t.sum()), "en comté :", int(ok.sum()))
