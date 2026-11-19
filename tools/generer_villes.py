#!/usr/bin/env python3
"""Étiquettes des villes et quartiers de la carte officielle -> maps/officielle-v1/villes.json.

Positions = centre de l'étiquette imprimée sur le poster, lue sur le poster réduit au 1/3 (1925 x 2633 px).
rang 1 = villes (visibles tôt), 2 = petites villes / lieux majeurs, 3 = quartiers de Vice City (zoom rapproché).
Usage : python3 tools/generer_villes.py maps/officielle-v1/villes.json
"""
import json
import sys

W3, H3 = 1925, 2633
VILLES = [
    # rang 1 : villes
    ("Vice City", 1290, 1370, 1), ("Port Gellhorn", 585, 940, 1), ("Ambrosia", 1069, 940, 1), ("Hamlet", 1080, 1806, 1),
    ("Capri", 555, 1388, 1), ("Millport", 1268, 607, 1), ("Grassrivers", 867, 1745, 1), ("Vice Beach", 1638, 1287, 1),
    ("Key Lento", 1094, 2190, 1), ("Bonanza", 925, 375, 1), ("Grayson", 730, 575, 1), ("Belville", 1265, 1042, 1),
    ("Waning Sands", 1423, 850, 1), ("Watson Bay", 817, 1853, 1), ("Southwind", 630, 2248, 1),
    # rang 2 : petites villes, aéroports
    ("Gellhorn", 678, 1177, 2), ("Moreau", 992, 437, 2), ("Tequesta", 1296, 1566, 2), ("Big Pine", 757, 1638, 2),
    ("Frogswater", 855, 905, 2), ("Emerald Springs", 885, 1105, 2), ("Pelican Valley", 1005, 1926, 2),
    ("Bluegrass", 1080, 1665, 2), ("Southside", 1200, 1708, 2), ("Port Vice City", 1550, 1464, 2),
    ("Washington Beach", 1665, 1170, 2), ("Ocean Beach", 1658, 1375, 2), ("Vinewood Beach", 1520, 882, 2),
    ("VCIA", 1088, 1503, 2), ("Mile Zero Air Station", 533, 2290, 2), ("Draper Island", 475, 790, 2),
    # rang 3 : quartiers de Vice City et alentours
    ("Little Cuba", 1270, 1402, 3), ("Downtown", 1350, 1407, 3), ("Salton", 1196, 1424, 3), ("Rockridge", 1257, 1310, 3),
    ("Crosstown", 1343, 1307, 3), ("Balsero", 1127, 1315, 3), ("La Perle", 1308, 1222, 3), ("Stockyard", 1392, 1183, 3),
    ("Decor District", 1397, 1140, 3), ("Bayside", 1383, 1243, 3), ("Peacock Bay", 1279, 1683, 3),
    ("Tequesta Retreat", 1402, 1560, 3),
]
out = {
    "_aide": "Villes et quartiers (étiquettes progressives au zoom). x, y normalisés 0..1 ; rang 1..3. Généré par tools/generer_villes.py.",
    "villes": [{"nom": n, "x": round(x / W3, 4), "y": round(y / H3, 4), "rang": r} for n, x, y, r in VILLES],
}
json.dump(out, open(sys.argv[1], "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)
print(len(VILLES), "villes")
