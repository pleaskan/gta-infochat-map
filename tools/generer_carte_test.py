#!/usr/bin/env python3
"""Génère la carte de remplacement (île factice + grille A–J / 1–10) : maps/test/carte_test.png
Usage : python3 tools/generer_carte_test.py [taille]   (défaut 4096)
Puis :  python3 tools/decouper_tuiles.py maps/test/carte_test.png maps/test --id test --version test-v1
"""
import math
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

N = int(sys.argv[1]) if len(sys.argv) > 1 else 4096
OUT = sys.argv[2] if len(sys.argv) > 2 else "maps/test/carte_test.png"
random.seed(6)


def font(sz, bold=True):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
              "DejaVuSans-Bold.ttf", "arial.ttf"]:
        try:
            return ImageFont.truetype(p, sz)
        except OSError:
            pass
    return ImageFont.load_default()


img = Image.new("RGB", (N, N), (22, 58, 92))
d = ImageDraw.Draw(img)
# île : rayon bruité
cx, cy = N * 0.5, N * 0.52
pts = []
harm = [(random.uniform(0.04, 0.09), k, random.uniform(0, 6.28)) for k in (2, 3, 5, 7, 11)]
for i in range(720):
    a = i / 720 * 2 * math.pi
    r = 0.36 + sum(amp * math.sin(k * a + ph) for amp, k, ph in harm)
    pts.append((cx + math.cos(a) * r * N * 0.85, cy + math.sin(a) * r * N))
mask = Image.new("L", (N, N), 0)
ImageDraw.Draw(mask).polygon(pts, fill=255)
shore = mask.filter(ImageFilter.GaussianBlur(N / 120))
img.paste((70, 140, 170), (0, 0), shore.point(lambda v: 255 if v > 20 else 0))
img.paste((96, 128, 74), (0, 0), mask)
# lac
d.ellipse([N * .44, N * .3, N * .6, N * .45], fill=(40, 100, 140))
# quartiers
for _ in range(9):
    x, y = random.uniform(.3, .7) * N, random.uniform(.25, .8) * N
    s = random.uniform(.04, .08) * N
    d.rectangle([x - s, y - s * .7, x + s, y + s * .7], fill=(120, 120, 120))
# routes
for _ in range(6):
    p = [(random.uniform(.2, .8) * N, random.uniform(.2, .85) * N) for _ in range(4)]
    d.line(p, fill=(230, 210, 120), width=max(3, N // 500), joint="curve")
# grille 10×10
f1, f2 = font(N // 60), font(N // 22)
for i in range(11):
    v = round(i * N / 10)
    d.line([(v, 0), (v, N)], fill=(255, 255, 255), width=max(2, N // 1500))
    d.line([(0, v), (N, v)], fill=(255, 255, 255), width=max(2, N // 1500))
for i in range(10):
    for j in range(10):
        lab = "ABCDEFGHIJ"[i] + str(j + 1)
        d.text((i * N / 10 + N / 200, j * N / 10 + N / 250), lab, font=f1, fill=(255, 255, 255))
# repères d'orientation
d.text((N * .5, N * .015), "NORD ↑", font=f2, fill=(255, 230, 120), anchor="mt")
d.text((N * .02, N * .97), "CARTE DE TEST — à remplacer", font=f2, fill=(255, 230, 120), anchor="ls")
for (x, y, t) in [(0, 0, "0,0"), (1, 0, "1,0"), (0, 1, "0,1"), (1, 1, "1,1"), (.5, .5, "0.5,0.5")]:
    px, py = x * N, y * N
    d.ellipse([px - N / 120, py - N / 120, px + N / 120, py + N / 120], fill=(255, 60, 60))
    d.text((min(max(px, N * .04), N * .96), min(max(py + N / 60, N * .03), N * .93)), t, font=f1, fill=(255, 120, 120), anchor="mt")
img.save(OUT, optimize=True)
print("écrit", OUT, img.size)
