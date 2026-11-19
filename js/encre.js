// Couche canvas (encre + grille) synchronisée avec Leaflet, et rendu des traits.
/* global L */
import { GRILLE_DEFAUT } from './coords.js';

export const CoucheCanvas = L.Layer.extend({
  initialize(dessiner) { this._dessiner = dessiner; },
  onAdd(map) {
    this._map = map;
    const pane = map.getPane('encre') || map.createPane('encre');
    this._c = L.DomUtil.create('canvas', 'couche-encre leaflet-zoom-animated', pane);
    this._g = this._c.getContext('2d');
    map.on('zoom viewreset resize zoomend moveend', this._reset, this);
    map.on('move', this.planifier, this);
    map.on('zoomanim', this._anim, this);
    this._reset();
  },
  onRemove(map) {
    map.off('zoom viewreset resize zoomend moveend', this._reset, this);
    map.off('move', this.planifier, this);
    map.off('zoomanim', this._anim, this);
    L.DomUtil.remove(this._c);
  },
  planifier() { if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this._reset(); }); },
  _reset() {
    const m = this._map; if (!m) return;
    const sz = m.getSize(), r = window.devicePixelRatio || 1, c = this._c;
    const w = Math.round(sz.x * r), h = Math.round(sz.y * r);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; c.style.width = sz.x + 'px'; c.style.height = sz.y + 'px'; }
    L.DomUtil.setPosition(c, m.containerPointToLayerPoint([0, 0]));
    this._bornes = L.latLngBounds(m.containerPointToLatLng([0, 0]), m.containerPointToLatLng(sz));
    const g = this._g;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
    this._dessiner(g, m, r);
  },
  _anim(e) {
    if (!this._bornes) return;
    const scale = this._map.getZoomScale(e.zoom), offset = this._map._latLngBoundsToNewLayerBounds(this._bornes, e.zoom, e.center).min;
    L.DomUtil.setTransform(this._c, offset, scale);
  },
});

/** Boîte englobante normalisée d'un trait (mise en cache sur l'objet, non sauvegardée). */
export function boite(s) {
  if (s._bb && s._bb.n === s.pts.length) return s._bb;
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of s.pts) { if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; }
  Object.defineProperty(s, '_bb', { value: { x0: a, y0: b, x1: c, y1: d, n: s.pts.length }, writable: true, configurable: true, enumerable: false });
  return s._bb;
}

/**
 * Trace un trait. Le contexte doit être en pixels-image (transform déjà appliquée).
 * s = {t:'pen'|'hl'|'line', color, w (fraction de W), pen, pts:[[x,y,p]] normalisés}
 */
export function tracer(g, s, W, H) {
  const p = s.pts; if (!p.length) return;
  const w = s.w * W;
  g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = s.color; g.fillStyle = s.color;
  if (s.t === 'hl') {
    g.globalAlpha = 0.35; g.lineCap = 'butt'; g.lineWidth = w * 4; g.beginPath(); g.moveTo(p[0][0] * W, p[0][1] * H);
    for (let i = 1; i < p.length; i++) g.lineTo(p[i][0] * W, p[i][1] * H);
    if (p.length === 1) g.lineTo(p[0][0] * W + 0.01, p[0][1] * H);
    g.stroke(); g.globalAlpha = 1; return;
  }
  if (s.t === 'line') {
    const a = p[0], b = p[p.length - 1], ax = a[0] * W, ay = a[1] * H, bx = b[0] * W, by = b[1] * H;
    g.lineWidth = w; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    const ang = Math.atan2(by - ay, bx - ax), h = w * 5;
    g.beginPath(); g.moveTo(bx, by); g.lineTo(bx - h * Math.cos(ang - 0.45), by - h * Math.sin(ang - 0.45)); g.lineTo(bx - h * Math.cos(ang + 0.45), by - h * Math.sin(ang + 0.45)); g.closePath(); g.fill();
    return;
  }
  if (p.length === 1) { g.beginPath(); g.arc(p[0][0] * W, p[0][1] * H, w / 2, 0, 7); g.fill(); return; }
  if (!s.pen) {
    g.lineWidth = w; g.beginPath(); g.moveTo(p[0][0] * W, p[0][1] * H);
    for (let i = 1; i < p.length; i++) g.lineTo(p[i][0] * W, p[i][1] * H);
    g.stroke(); return;
  }
  for (let i = 1; i < p.length; i++) { // stylo sensible à la pression (même formule que l'ancienne appli)
    g.lineWidth = w * (0.35 + p[i][2] * 1.3);
    g.beginPath(); g.moveTo(p[i - 1][0] * W, p[i - 1][1] * H); g.lineTo(p[i][0] * W, p[i][1] * H); g.stroke();
  }
}

/** Distance point-segment (px). */
export function dseg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Le trait passe-t-il à moins de r pixels-image du point (px,py) en pixels-image ? */
export function touche(s, px, py, r, W, H) {
  const p = s.pts;
  if (p.length === 1) return Math.hypot(p[0][0] * W - px, p[0][1] * H - py) <= r;
  if (s.t === 'line') { const a = p[0], b = p[p.length - 1]; return dseg(px, py, a[0] * W, a[1] * H, b[0] * W, b[1] * H) <= r; }
  for (let i = 1; i < p.length; i++) if (dseg(px, py, p[i - 1][0] * W, p[i - 1][1] * H, p[i][0] * W, p[i][1] * H) <= r) return true;
  return false;
}

/**
 * Grille 10×10 (A–J / 1–10) + sous-grille quand on zoome. Contexte en pixels écran (×dpr).
 * o = point écran de (0,0), sx/sy = taille écran de la carte entière.
 */
export function dessinerGrille(g, o, sx, sy, dpr, larg, haut, fond, gr = GRILLE_DEFAUT) {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (fond) { g.fillStyle = '#16202b'; g.fillRect(o.x, o.y, sx, sy); }
  const X = v => o.x + sx * v, Y = v => o.y + sy * v;
  const nc = gr.col.length - 1, nl = gr.lig.length - 1;
  const gx0 = X(gr.col[0]), gx1 = X(gr.col[nc]), gy0 = Y(gr.lig[0]), gy1 = Y(gr.lig[nl]);
  const cell = sx * (gr.col[nc] - gr.col[0]) / nc;
  // sous-grille (10 par case) si les cases sont grandes
  if (cell > 350) {
    g.strokeStyle = 'rgba(255,255,255,.10)'; g.lineWidth = 1; g.beginPath();
    for (let i = 0; i < nc; i++) for (let k = 1; k < 10; k++) {
      const x = Math.round(X(gr.col[i] + (gr.col[i + 1] - gr.col[i]) * k / 10)) + 0.5;
      if (x > -2 && x < larg + 2) { g.moveTo(x, Math.max(0, gy0)); g.lineTo(x, Math.min(haut, gy1)); }
    }
    for (let j = 0; j < nl; j++) for (let k = 1; k < 10; k++) {
      const y = Math.round(Y(gr.lig[j] + (gr.lig[j + 1] - gr.lig[j]) * k / 10)) + 0.5;
      if (y > -2 && y < haut + 2) { g.moveTo(Math.max(0, gx0), y); g.lineTo(Math.min(larg, gx1), y); }
    }
    g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 1.5; g.beginPath();
  for (const v of gr.col) { const x = Math.round(X(v)) + 0.5; g.moveTo(x, gy0); g.lineTo(x, gy1); }
  for (const v of gr.lig) { const y = Math.round(Y(v)) + 0.5; g.moveTo(gx0, y); g.lineTo(gx1, y); }
  g.stroke();
  // libellés : colonnes en haut de l'écran, lignes à gauche (toujours visibles)
  g.font = '600 13px system-ui, sans-serif'; g.textBaseline = 'top'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.8)'; g.fillStyle = '#fff';
  const txt = (t, x, y, al) => { g.textAlign = al; g.strokeText(t, x, y); g.fillText(t, x, y); };
  const yTop = Math.max(gy0 + 4, 4), xLeft = Math.max(gx0 + 4, 4);
  for (let i = 0; i < nc; i++) { const cx = (X(gr.col[i]) + X(gr.col[i + 1])) / 2; if (cx > 0 && cx < larg) txt(gr.nomsCol[i], cx, yTop, 'center'); }
  for (let j = 0; j < nl; j++) { const cy = (Y(gr.lig[j]) + Y(gr.lig[j + 1])) / 2; if (cy > 0 && cy < haut) txt(gr.nomsLig[j], xLeft, cy - 7, 'left'); }
  if (cell > 140) { // nom de chaque case visible
    g.font = '12px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,.75)';
    for (let i = 0; i < nc; i++) for (let j = 0; j < nl; j++) {
      const x = X(gr.col[i]) + 5, y = Y(gr.lig[j]) + 22;
      const nom = gr.ligneDabord ? gr.nomsLig[j] + gr.nomsCol[i] : gr.nomsCol[i] + gr.nomsLig[j];
      if (x > -cell && x < larg && y > -cell && y < haut) txt(nom, x, y, 'left');
    }
  }
}
