// Validation et normalisation du fichier de tips (voir SCHEMA_GEOJSON.md).
// Pur (aucun DOM) : testable sous Node.

export const TYPES_LIEU = ['quartier', 'ville', 'region', 'batiment', 'point_interet', 'mission', 'route', 'autre'];
const TOL = 1e-3; // tolérance sur les bords 0..1

function hash(str) { // FNV-1a 32 bits -> base36
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
const estTexte = v => typeof v === 'string' && v.trim() !== '';
const urlSure = u => typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u.trim());

/**
 * @returns {{ok:boolean, erreur?:string, lieux:Array, stats:object, meta:object}}
 *  - ok=false + erreur : fichier inutilisable (pas une FeatureCollection…)
 *  - sinon lieux valides + stats.{lieux, tips, lieux_invalides, tips_invalides, avertissements, details[]}
 */
export function validerTips(json) {
  const stats = { lieux: 0, tips: 0, lieux_invalides: 0, tips_invalides: 0, avertissements: 0, details: [] };
  const note = (m) => { if (stats.details.length < 30) stats.details.push(m); };
  const res = { ok: false, lieux: [], stats, meta: {} };
  if (!json || typeof json !== 'object' || Array.isArray(json)) { res.erreur = 'Le fichier n\'est pas un objet JSON.'; return res; }
  if (json.type !== 'FeatureCollection') { res.erreur = '« type » doit valoir "FeatureCollection".'; return res; }
  if (!Array.isArray(json.features)) { res.erreur = '« features » doit être une liste.'; return res; }
  const md = json.metadata && typeof json.metadata === 'object' ? json.metadata : {};
  res.meta = { genere_le: estTexte(md.genere_le) ? md.genere_le : null, source: estTexte(md.source) ? md.source : null };
  res.ok = true;

  const idsTips = new Set(), idsLieux = new Set();
  json.features.forEach((f, i) => {
    const ref = `feature #${i + 1}`;
    if (!f || f.type !== 'Feature' || !f.geometry || f.geometry.type !== 'Point') { stats.lieux_invalides++; note(`${ref} : pas un Feature de type Point`); return; }
    const c = f.geometry.coordinates;
    if (!Array.isArray(c) || c.length < 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) { stats.lieux_invalides++; note(`${ref} : coordonnées absentes ou non numériques`); return; }
    const [x, y] = c;
    if (x < -TOL || x > 1 + TOL || y < -TOL || y > 1 + TOL) {
      stats.lieux_invalides++;
      note(`${ref} : coordonnées [${x}, ${y}] hors du repère 0..1` + (Math.abs(x) > 1.5 || Math.abs(y) > 1.5 ? ' (lat/lon ? pixels ?)' : ''));
      return;
    }
    const p = f.properties && typeof f.properties === 'object' ? f.properties : null;
    if (!p || !estTexte(p.lieu)) { stats.lieux_invalides++; note(`${ref} : « lieu » manquant`); return; }
    const lieuNom = p.lieu.trim();
    let type = p.type;
    if (!TYPES_LIEU.includes(type)) { if (type != null) { stats.avertissements++; note(`${lieuNom} : type « ${type} » inconnu → autre`); } type = 'autre'; }
    let rayon = null;
    if (p.rayon != null) {
      if (Number.isFinite(p.rayon) && p.rayon > 0 && p.rayon <= 1) rayon = p.rayon;
      else { stats.avertissements++; note(`${lieuNom} : rayon ${p.rayon} ignoré (attendu 0 < r ≤ 1)`); }
    }
    const tipsSrc = Array.isArray(p.tips) ? p.tips : [];
    const tips = [];
    tipsSrc.forEach((t, j) => {
      if (!t || typeof t !== 'object' || !estTexte(t.enonce)) { stats.tips_invalides++; note(`${lieuNom} / tip #${j + 1} : « enonce » manquant`); return; }
      let id = estTexte(t.id) ? t.id.trim() : null;
      if (!id) { id = 'auto-' + hash(lieuNom + '|' + t.enonce.trim()); stats.avertissements++; note(`${lieuNom} / tip #${j + 1} : « id » manquant (id généré ${id})`); }
      if (idsTips.has(id)) { stats.tips_invalides++; note(`tip « ${id} » en double : ignoré`); return; }
      idsTips.add(id);
      const nb = Number.isFinite(t.nb_sources) && t.nb_sources >= 0 ? Math.floor(t.nb_sources) : 0;
      const urls = Array.isArray(t.urls) ? t.urls.filter(urlSure).map(u => u.trim()) : [];
      if (Array.isArray(t.urls) && urls.length !== t.urls.length) { stats.avertissements++; note(`tip « ${id} » : URL non http(s) ignorée`); }
      tips.push({
        id,
        categorie: estTexte(t.categorie) ? t.categorie.trim() : 'autre',
        enonce: t.enonce.trim(),
        precision: estTexte(t.precision) ? t.precision.trim() : '',
        nb_sources: nb,
        verifie: t.verifie_en_jeu === true,
        urls,
      });
    });
    if (!tips.length) { stats.lieux_invalides++; note(`${lieuNom} : aucun tip valide`); return; }
    let id = 'L' + hash(lieuNom + '|' + x.toFixed(4) + '|' + y.toFixed(4));
    while (idsLieux.has(id)) id += '_';
    idsLieux.add(id);
    const lieu = {
      id, lieu: lieuNom, type, x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)), rayon,
      carte_version: estTexte(p.carte_version) ? p.carte_version.trim() : null,
      tips,
    };
    lieu.cat = categorieDominante(tips);
    res.lieux.push(lieu);
    stats.lieux++; stats.tips += tips.length;
  });
  return res;
}

/** Catégorie la plus fréquente ; à égalité, celle qui cumule le plus de sources. */
export function categorieDominante(tips) {
  const m = new Map();
  for (const t of tips) { const e = m.get(t.categorie) || [0, 0]; e[0]++; e[1] += t.nb_sources; m.set(t.categorie, e); }
  let best = null, be = [-1, -1];
  for (const [k, e] of m) if (e[0] > be[0] || (e[0] === be[0] && e[1] > be[1])) { best = k; be = e; }
  return best || 'autre';
}
