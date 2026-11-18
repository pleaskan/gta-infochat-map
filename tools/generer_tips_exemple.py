#!/usr/bin/env python3
"""Génère un fichier de tips FACTICE pour tester l'appli sur la carte de test.
Usage :
  python3 tools/generer_tips_exemple.py                 -> data/tips_gta6.geojson (30 lieux)
  python3 tools/generer_tips_exemple.py 2000 /tmp/x.geojson   (test de charge)
"""
import json
import math
import random
import sys

N = int(sys.argv[1]) if len(sys.argv) > 1 else 30
OUT = sys.argv[2] if len(sys.argv) > 2 else "data/tips_gta6.geojson"
random.seed(42 + N)

LIEUX = ["Marina Nord", "Quartier des Docks", "Phare de la Pointe", "Station-service Route 1", "Casse auto du Marais",
         "Plage des Palmiers", "Centre commercial Azur", "Aérodrome abandonné", "Ranch Cypress", "Pont du Lac",
         "Motel Flamingo", "Port de pêche", "Belvédère du Mont", "Zone industrielle Est", "Vieux fort espagnol",
         "Club de golf", "Commissariat central", "Garage Hector", "Marché couvert", "Gare routière",
         "Île aux pélicans", "Parc des expositions", "Hôpital Sainte-Claire", "Concession de luxe", "Bayou noir",
         "Cimetière marin", "Studio de tatouage", "Base militaire (clôture)", "Stade municipal", "Tour Horizon"]
TYPES = ["quartier", "ville", "region", "batiment", "point_interet", "mission", "route", "autre"]
CATS = ["argent", "armes", "vehicules", "collectibles", "secrets", "missions", "activites", "magasins",
        "police", "planques", "astuces", "easter_egg"]  # easter_egg : absente de styles.json -> style par défaut
ENONCES = {
    "argent": ["Coffre avec {n} $ derrière le comptoir", "Distributeur piratable la nuit", "Mallette cachée sous le ponton"],
    "armes": ["Fusil à pompe dans la remise", "Gilet pare-balles sur le toit", "Munitions gratuites près des conteneurs"],
    "vehicules": ["Voiture de sport qui apparaît le soir", "Moto tout-terrain garée derrière", "Hélico accessible sans étoile"],
    "collectibles": ["Figurine cachée sous l'escalier", "Carte postale sur le panneau", "Graffiti à photographier"],
    "secrets": ["Passage secret derrière l'étagère", "Porte qui s'ouvre à 3 h du matin", "Code inscrit sur le mur"],
    "missions": ["Raccourci pour la mission du port", "Point de départ d'une mission annexe", "Contact qui donne une prime"],
    "activites": ["Course de rue chaque vendredi", "Pêche rentable au coucher du soleil", "Salle d'arcade jouable"],
    "magasins": ["Réduction de 20 % le dimanche", "Vend des tenues rares", "Mods moteur moins chers ici"],
    "police": ["Bonne planque pour semer la police", "Barrage fréquent à éviter", "Tunnel pour perdre 2 étoiles"],
    "planques": ["Appartement achetable pas cher", "Lit pour sauvegarder", "Garage 2 places inclus"],
    "astuces": ["Rampe pour un saut cascade", "Point de vue pour repérer la zone", "Sauvegarde rapide à côté"],
    "easter_egg": ["Clin d'œil à un ancien GTA", "Ovni visible par temps clair", "Statue qui bouge si on klaxonne"],
}
PRECISIONS = ["Côté est, près de l'entrée.", "Uniquement de nuit.", "Monter par l'échelle à gauche.", "",
              "Après la mission 3.", "Visible depuis la route.", ""]


def point_ile():
    # sur l'île de la carte de test (centre ~0.5,0.52)
    while True:
        a = random.uniform(0, 2 * math.pi)
        r = math.sqrt(random.random()) * 0.30
        x, y = 0.5 + math.cos(a) * r * 0.85, 0.52 + math.sin(a) * r
        if 0.02 < x < 0.98 and 0.02 < y < 0.98:
            return round(x, 4), round(y, 4)


feats = []
tid = 0
for i in range(N):
    nom = LIEUX[i] if i < len(LIEUX) else f"Lieu factice {i + 1}"
    x, y = point_ile()
    typ = TYPES[i % len(TYPES)] if i < len(LIEUX) else random.choice(TYPES)
    k = random.choice([1, 1, 2, 2, 3, 4]) if N <= 100 else random.choice([1, 1, 1, 2, 3])
    base = random.choice(CATS)
    tips = []
    for j in range(k):
        cat = base if random.random() < .6 else random.choice(CATS)
        tid += 1
        nb = random.choice([1, 2, 2, 3, 3, 4, 5, 6, 8, 12])
        tips.append({
            "id": f"tip-{tid:05d}",
            "categorie": cat,
            "enonce": random.choice(ENONCES[cat]).format(n=random.choice([500, 1200, 5000])),
            "precision": random.choice(PRECISIONS),
            "nb_sources": nb,
            "verifie_en_jeu": random.random() < .35,
            "urls": [f"https://www.tiktok.com/@exemple/video/{7300000000000000000 + tid * 7 + s}" for s in range(min(nb, 3))],
        })
    feats.append({
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [x, y]},
        "properties": {
            "lieu": nom, "type": typ,
            "rayon": random.choice([None, None, None, 0.015, 0.03, 0.05]) if typ in ("quartier", "ville", "region") else None,
            "carte_version": "test-v1",
            "tips": tips,
        },
    })

doc = {
    "type": "FeatureCollection",
    "metadata": {"genere_le": "2026-11-18T12:00:00Z", "source": "exemple factice (tools/generer_tips_exemple.py)"},
    "features": feats,
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(doc, f, ensure_ascii=False, indent=1 if N <= 100 else None)
print(f"{OUT} : {N} lieux, {tid} tips")
