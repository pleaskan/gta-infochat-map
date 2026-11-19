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

/* ------------------------------------------------------------------ grille de repères */
const dixieme = Array.from({ length: 11 }, (_, i) => i / 10);
/** Grille par défaut : 10×10, colonnes A..J, lignes 1..10, case « A1 ». */
export const GRILLE_DEFAUT = Object.freeze({
  col: dixieme, lig: dixieme, nomsCol: [...'ABCDEFGHIJ'], nomsLig: dixieme.slice(1).map((_, i) => String(i + 1)), ligneDabord: false,
});

/**
 * Grille propre à une carte (maps.json → "grille") : celle imprimée sur la carte, par ex.
 * { "colonnes": [0.034, …], "lignes": [0.025, …], "noms_colonnes": "123456789", "noms_lignes": "ABCDEFGHIJKLM", "ligne_d_abord": true }
 * colonnes/lignes = bornes croissantes en coordonnées normalisées (n+1 bornes pour n cases). Sinon : grille par défaut.
 */
export function grilleDe(cfg) {
  const g = cfg && cfg.grille;
  const croissant = a => Array.isArray(a) && a.length >= 2 && a.every((v, i) => Number.isFinite(v) && (i === 0 || v > a[i - 1]));
  if (!g || !croissant(g.colonnes) || !croissant(g.lignes)) return GRILLE_DEFAUT;
  const noms = (n, k) => (Array.isArray(n) ? n.map(String) : [...String(n || '')]).slice(0, k);
  const nc = noms(g.noms_colonnes, g.colonnes.length - 1), nl = noms(g.noms_lignes, g.lignes.length - 1);
  if (nc.length !== g.colonnes.length - 1 || nl.length !== g.lignes.length - 1) return GRILLE_DEFAUT;
  return { col: g.colonnes, lig: g.lignes, nomsCol: nc, nomsLig: nl, ligneDabord: !!g.ligne_d_abord };
}

const indice = (b, v) => { for (let i = 0; i < b.length - 1; i++) if (v >= b[i] && (v < b[i + 1] || (i === b.length - 2 && v === b[i + 1]))) return i; return -1; };

/** Nom de la case contenant (x, y) : « A1 » (grille par défaut) ou « F4 » (poster : ligne puis colonne). « — » hors grille. */
export function caseGrille(x, y, gr = GRILLE_DEFAUT) {
  const c = indice(gr.col, x), l = indice(gr.lig, y);
  if (c < 0 || l < 0) return '—';
  return gr.ligneDabord ? gr.nomsLig[l] + gr.nomsCol[c] : gr.nomsCol[c] + gr.nomsLig[l];
}

/* ------------------------------------------------------------------ repère X/Y du jeu */
/**
 * Repère « jeu » d'une carte (maps.json → "repere": { "x": [X à gauche, X à droite], "y": [Y en haut, Y en bas] }) :
 * conversion linéaire normalisé ⇄ X/Y. null si la carte n'en a pas.
 */
export function repereXY(cfg) {
  const r = cfg && cfg.repere;
  const ok = a => Array.isArray(a) && a.length === 2 && a.every(Number.isFinite) && a[0] !== a[1];
  if (!r || !ok(r.x) || !ok(r.y)) return null;
  const [x0, x1] = r.x, [y0, y1] = r.y;
  return {
    source: r.source || '',
    versXY: (x, y) => [x0 + (x1 - x0) * x, y0 + (y1 - y0) * y],
    depuisXY: (X, Y) => [(X - x0) / (x1 - x0), (Y - y0) / (y1 - y0)],
  };
}

/* ------------------------------------------------------------------ zones (comtés) */
/**
 * Zone contenant (x, y) : graine la plus proche (distance en fraction de la largeur ; `ratio` = hauteur/largeur de l'image).
 * def = regions.json { coupure, regions: [{ id, nom, couleur, graines: [[x, y], …] }] }. null si trop loin de toute graine.
 */
export function regionDe(def, x, y, ratio = 1) {
  if (!def || !Array.isArray(def.regions)) return null;
  let best = null, dmin = Infinity;
  for (const r of def.regions) for (const [gx, gy] of r.graines || []) {
    const d = Math.hypot(x - gx, (y - gy) * ratio);
    if (d < dmin) { dmin = d; best = r; }
  }
  return dmin <= (Number.isFinite(def.coupure) ? def.coupure : Infinity) ? best : null;
}

export const arrondi = (v, n = 6) => Math.round(v * 10 ** n) / 10 ** n;
