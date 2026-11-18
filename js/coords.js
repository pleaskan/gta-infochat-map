// Repère unique de l'appli : coordonnées NORMALISÉES 0..1 sur l'image de la carte
// x vers la droite, y vers le bas, origine en haut à gauche.
// C'est le SEUL fichier qui connaît le repère Leaflet (CRS.Simple).
//
// Convention Leaflet (identique à tools/decouper_tuiles.py) :
//   zoom natif zn = ceil(log2(max(L, H) / 256))
//   au zoom zn, 1 px écran = 1 px image ; latLng = [-py / 2^zn, px / 2^zn]

export const TAILLE_TUILE = 256;

export function zoomNatif(cfg) {
  if (Number.isFinite(cfg.zoom_natif)) return cfg.zoom_natif;
  const m = Math.max(cfg.largeur_px || 1, cfg.hauteur_px || 1);
  return Math.max(0, Math.ceil(Math.log2(m / TAILLE_TUILE)));
}

/** Crée le convertisseur pour une carte {largeur_px, hauteur_px, zoom_natif?}. */
export function projecteur(cfg) {
  const W = cfg.largeur_px, H = cfg.hauteur_px;
  if (!(W > 0 && H > 0)) throw new Error('Dimensions de carte invalides');
  const zn = zoomNatif(cfg), s = 2 ** zn;
  return {
    W, H, zn,
    /** normalisé -> [lat, lng] Leaflet */
    versLatLng(x, y) { return [-(y * H) / s, (x * W) / s]; },
    /** [lat, lng] ou {lat,lng} Leaflet -> [x, y] normalisé */
    depuisLatLng(ll) {
      const lat = Array.isArray(ll) ? ll[0] : ll.lat, lng = Array.isArray(ll) ? ll[1] : ll.lng;
      return [(lng * s) / W, (-lat * s) / H];
    },
    /** limites de l'image en latLng : [[sud, ouest], [nord, est]] */
    limites() { return [[-H / s, 0], [0, W / s]]; },
    /** rayon normalisé (fraction de la LARGEUR de la carte) -> unités Leaflet */
    rayonVersUnites(r) { return (r * W) / s; },
    /** distance en pixels image entre deux points normalisés */
    distancePx(a, b) { return Math.hypot((a[0] - b[0]) * W, (a[1] - b[1]) * H); },
    /** facteur px-image -> px-écran au zoom z */
    echelle(z) { return 2 ** (z - zn); },
  };
}

/** Nom de case de grille 10×10 : A..J (colonnes) / 1..10 (lignes). */
export function caseGrille(x, y) {
  if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return '—';
  const c = Math.min(9, Math.floor(x * 10)), l = Math.min(9, Math.floor(y * 10));
  return 'ABCDEFGHIJ'[c] + (l + 1);
}

export const arrondi = (v, n = 6) => Math.round(v * 10 ** n) / 10 ** n;
