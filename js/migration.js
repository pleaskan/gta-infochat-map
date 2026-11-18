// Conversion des données de l'ancienne appli (v1, pixels image) vers le format v2 (normalisé 0..1).
// Pur (aucun DOM) : testable sous Node.

export const SCHEMA_VERSION = 2;

// Dimensions des 4 cartes intégrées à l'ancien maps.js (au cas où maps.json serait modifié depuis).
export const DIMS_ANCIENNES = {
  sat: [2567, 3600], noms: [1782, 2576], routes: [1280, 1763], icones: [1716, 2576],
};
export const VERSION_ANCIENNES = 'v0-fan';

const r6 = v => Math.round(v * 1e6) / 1e6;
const fini = v => typeof v === 'number' && Number.isFinite(v);
let compteurId = 0;
export const nouvelId = (p = '') => p + Date.now().toString(36) + (compteurId++).toString(36) + Math.random().toString(36).slice(2, 6);

/** Enregistrement vide pour une carte. */
export function enregistrementVide(mapId, mapVersion) {
  return { schema_version: SCHEMA_VERSION, map_id: mapId, map_version: mapVersion ?? null, markers: [], strokes: [], hidden_cats: [], updated: new Date().toISOString() };
}

/**
 * Convertit un état v1 {strokes, markers, hidden} (objet ou chaîne JSON) en enregistrement v2.
 * W,H = dimensions en pixels de l'image sur laquelle les annotations ont été faites.
 * Retourne {rec, stats:{marqueurs, traits, ignores}}.
 */
export function convertirEtatV1(etat, W, H, mapId, mapVersion) {
  if (typeof etat === 'string') etat = JSON.parse(etat);
  if (!etat || typeof etat !== 'object') throw new Error('État v1 illisible');
  if (!(W > 0 && H > 0)) throw new Error('Dimensions inconnues pour la carte ' + mapId);
  const rec = enregistrementVide(mapId, mapVersion);
  const stats = { marqueurs: 0, traits: 0, ignores: 0 };
  for (const m of Array.isArray(etat.markers) ? etat.markers : []) {
    if (!m || !fini(m.x) || !fini(m.y)) { stats.ignores++; continue; }
    rec.markers.push({
      id: typeof m.id === 'string' && m.id ? m.id : nouvelId('m'),
      x: r6(m.x / W), y: r6(m.y / H),
      cat: typeof m.cat === 'string' ? m.cat : 'note',
      label: typeof m.label === 'string' ? m.label : '',
      note: typeof m.note === 'string' ? m.note : '',
      done: !!m.done,
      color: null,
    });
    stats.marqueurs++;
  }
  for (const s of Array.isArray(etat.strokes) ? etat.strokes : []) {
    if (!s || !Array.isArray(s.pts)) { stats.ignores++; continue; }
    const pts = [];
    for (const p of s.pts) {
      if (!Array.isArray(p) || !fini(p[0]) || !fini(p[1])) continue;
      pts.push([r6(p[0] / W), r6(p[1] / H), fini(p[2]) ? Math.round(p[2] * 1000) / 1000 : 0.5]);
    }
    if (!pts.length) { stats.ignores++; continue; }
    rec.strokes.push({
      id: nouvelId('s'),
      t: ['pen', 'hl', 'line'].includes(s.t) ? s.t : 'pen',
      color: typeof s.color === 'string' ? s.color : '#ff3b3b',
      w: fini(s.w) && s.w > 0 ? s.w / W : 4 / W,   // épaisseur en fraction de la largeur
      pen: !!s.pen,
      pts,
    });
    stats.traits++;
  }
  if (etat.hidden && typeof etat.hidden === 'object') rec.hidden_cats = Object.keys(etat.hidden).filter(k => etat.hidden[k]);
  return { rec, stats };
}

/** Nettoie / met à niveau un enregistrement d'annotations vers SCHEMA_VERSION. */
export function migrerEnregistrement(rec) {
  if (!rec || typeof rec !== 'object') throw new Error('Enregistrement invalide');
  const v = rec.schema_version || 1;
  if (v > SCHEMA_VERSION) throw new Error(`Sauvegarde créée par une version plus récente de l'appli (schéma ${v})`);
  if (v < 2) throw new Error('Format v1 : utiliser convertirEtatV1 (dimensions requises)');
  // v2 -> v2 : nettoyage défensif. (Ajouter ici les étapes v2 -> v3, etc.)
  const out = enregistrementVide(String(rec.map_id), rec.map_version ?? null);
  out.updated = typeof rec.updated === 'string' ? rec.updated : out.updated;
  out.hidden_cats = Array.isArray(rec.hidden_cats) ? rec.hidden_cats.filter(s => typeof s === 'string') : [];
  for (const m of Array.isArray(rec.markers) ? rec.markers : []) {
    if (!m || !fini(m.x) || !fini(m.y)) continue;
    out.markers.push({ id: String(m.id || nouvelId('m')), x: m.x, y: m.y, cat: String(m.cat || 'note'), label: String(m.label || ''), note: String(m.note || ''), done: !!m.done, color: typeof m.color === 'string' ? m.color : null });
  }
  for (const s of Array.isArray(rec.strokes) ? rec.strokes : []) {
    if (!s || !Array.isArray(s.pts) || !s.pts.length) continue;
    const pts = s.pts.filter(p => Array.isArray(p) && fini(p[0]) && fini(p[1])).map(p => [p[0], p[1], fini(p[2]) ? p[2] : 0.5]);
    if (!pts.length) continue;
    out.strokes.push({ id: String(s.id || nouvelId('s')), t: ['pen', 'hl', 'line'].includes(s.t) ? s.t : 'pen', color: String(s.color || '#ff3b3b'), w: fini(s.w) && s.w > 0 ? s.w : 0.001, pen: !!s.pen, pts });
  }
  return out;
}

export const FORMAT_SAUVEGARDE = 'carte-gta6-sauvegarde';

/**
 * Reconnaît un fichier de sauvegarde.
 *  - nouveau format : {format, schema_version, annotations[], cartes_importees[], etats_tips[], reglages}
 *  - ancien export par carte (appli v1) : {v:2, mapId, name, builtin, state, image}
 */
export function analyserSauvegarde(json) {
  if (!json || typeof json !== 'object') throw new Error('Fichier non reconnu');
  if (json.format === FORMAT_SAUVEGARDE) {
    if ((json.schema_version || 0) > SCHEMA_VERSION) throw new Error('Sauvegarde créée par une version plus récente de l\'appli');
    return {
      type: 'v2',
      annotations: (Array.isArray(json.annotations) ? json.annotations : []).map(migrerEnregistrement),
      cartes_importees: Array.isArray(json.cartes_importees) ? json.cartes_importees.filter(c => c && c.config && c.config.id) : [],
      etats_tips: Array.isArray(json.etats_tips) ? json.etats_tips.filter(e => e && typeof e.tip_id === 'string') : [],
      reglages: json.reglages && typeof json.reglages === 'object' ? json.reglages : null,
    };
  }
  if (json.state && typeof json.state === 'object' && json.mapId) {
    return { type: 'ancien-export', mapId: String(json.mapId), name: json.name || 'Carte importée', builtin: !!json.builtin, state: json.state, image: typeof json.image === 'string' ? json.image : null };
  }
  throw new Error('Fichier non reconnu (ni sauvegarde v2, ni ancien export)');
}
