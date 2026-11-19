#!/usr/bin/env python3
# Usage : python3 tools/convertir_cmjn.py POSTER_CMJN.jpg sortie.png   (Pillow) — conversion CMJN -> sRGB avec le profil ICC du fichier
import io, sys
from PIL import Image, ImageCms
Image.MAX_IMAGE_PIXELS = None
src = Image.open(sys.argv[1]); icc = src.info.get("icc_profile")
rgb = ImageCms.profileToProfile(src, ImageCms.ImageCmsProfile(io.BytesIO(icc)), ImageCms.createProfile("sRGB"), renderingIntent=0, outputMode="RGB") if icc else src.convert("RGB")
rgb.save(sys.argv[2]); print(rgb.size)
