// Données perso : annotations, états des tips, réglages, cartes importées, sauvegardes, migration v1.
import { Base, lireAncienneBase } from './db.js';
import { convertirEtatV1, migrerEnregistrement, enregistrementVide, analyserSauvegarde, DIMS_ANCIENNES, VERSION_ANCIENNES, SCHEMA_VERSION, FORMAT_SAUVEGARDE, nouvelId } from './migration.js';

export let base = null;
const MAX_AUTO = 12;

export async function ouvrirStockage() { base = await Base.ouvrir(); return base; }

/* ---------- utilitaires blobs ---------- */
export const blobVersDataURL = b => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => ko(r.error); r.readAsDataURL(b); });
export async function dataURLVersBlob(u) { return (await fetch(u)).blob(); }
export async function dimensionsImage(blob) {
  try { const bm = await createImageBitmap(blob); const d = [bm.width, bm.height]; bm.close && bm.close(); return d; }
  catch (e) {
    return new Promise((ok) => { const i = new Image(), u = URL.createObjectURL(blob); i.onload = () => { ok([i.naturalWidth, i.naturalHeight]); URL.revokeObjectURL(u); }; i.onerror = () => ok(null); i.src = u; });
  }
}

/* ---------- méta / réglages ---------- */
export const meta = { get: k => base.get('meta', k), set: (k, v) => base.put('meta', v, k) };

/* ---------- annotations ---------- */
export async function lireAnnotations(mapId, version) {
  const r = await base.get('annotations', mapId);
  if (!r) return enregistrementVide(mapId, version);
  try { return migrerEnregistrement(r); } catch (e) { console.error(e); return r; }
}
export async function ecrireAnnotations(rec) { rec.updated = new Date().toISOString(); rec.schema_version = SCHEMA_VERSION; await base.put('annotations', rec); }

/* ---------- états des tips ---------- */
export async function lireEtatsTips() { const m = new Map(); for (const e of await base.tout('etats_tips')) m.set(e.tip_id, e); return m; }
export async function ecrireEtatTip(e) {
  const vide = !e.fait && !e.utile && !e.faux && !e.masque && !(e.note || '').trim();
  if (vide) await base.del('etats_tips', e.tip_id); else { e.updated = new Date().toISOString(); await base.put('etats_tips', e); }
}

/* ---------- cartes importées ---------- */
export async function cartesImportees() { return (await meta.get('cartes_importees')) || []; }
export async function ajouterCarteImportee(blob, nom, id = null) {
  const dims = await dimensionsImage(blob);
  if (!dims) throw new Error('Image illisible');
  id = id || 'imp-' + nouvelId();
  await base.put('blobs', blob, id);
  const l = await cartesImportees();
  const cfg = { id, nom: nom || 'Ma carte', version: 'import', type: 'image', blob: id, largeur_px: dims[0], hauteur_px: dims[1], tips: false, importee: true };
  const i = l.findIndex(c => c.id === id); if (i >= 0) l[i] = cfg; else l.push(cfg);
  await meta.set('cartes_importees', l);
  return cfg;
}
export async function supprimerCarteImportee(id) {
  await sauvegardeAuto('avant-suppression-carte');
  await meta.set('cartes_importees', (await cartesImportees()).filter(c => c.id !== id));
  await base.del('blobs', id); await base.del('annotations', id);
}

/* ---------- sauvegardes automatiques ---------- */
export async function sauvegardeAuto(type, donnees = null) {
  const d = donnees || await exportComplet(false);
  const s = { id: new Date().toISOString() + '-' + type, type, cree: new Date().toISOString(), donnees: d };
  try {
    await base.put('sauvegardes', s);
    const toutes = (await base.tout('sauvegardes')).filter(x => !x.type.startsWith('migration')).sort((a, b) => a.id < b.id ? 1 : -1);
    for (const x of toutes.slice(MAX_AUTO)) await base.del('sauvegardes', x.id);
  } catch (e) { console.warn('sauvegarde auto impossible', e); }
  return s;
}
export async function listeSauvegardes() { return (await base.tout('sauvegardes')).sort((a, b) => a.id < b.id ? 1 : -1); }
/** Sauvegarde quotidienne (1 par jour max) au démarrage. */
export async function sauvegardeQuotidienne() {
  const j = new Date().toISOString().slice(0, 10);
  if ((await meta.get('derniere_quotidienne')) === j) return;
  const n = (await base.cles('annotations')).length + (await base.cles('etats_tips')).length;
  if (n) await sauvegardeAuto('quotidienne');
  await meta.set('derniere_quotidienne', j);
}

/* ---------- export / import ---------- */
export async function exportComplet(avecImages = true) {
  const imp = await cartesImportees();
  const cartes = [];
  for (const c of imp) {
    let image = null;
    if (avecImages) { const b = await base.get('blobs', c.blob || c.id); if (b) image = await blobVersDataURL(b); }
    cartes.push({ config: c, image });
  }
  return {
    format: FORMAT_SAUVEGARDE, schema_version: SCHEMA_VERSION, exporte_le: new Date().toISOString(),
    annotations: await base.tout('annotations'),
    cartes_importees: cartes,
    etats_tips: await base.tout('etats_tips'),
    reglages: (await meta.get('reglages')) || null,
  };
}

/**
 * Importe un fichier (nouveau format ou ancien export par carte).
 * infoCarte(mapId) -> {W, H, version} | null  (pour convertir un ancien export d'une carte intégrée).
 * @returns {carte, texte}
 */
export async function importerSauvegarde(json, infoCarte) {
  const a = analyserSauvegarde(json);
  await sauvegardeAuto('avant-import');
  if (a.type === 'v2') {
    for (const c of a.cartes_importees) {
      if (c.image) { const b = await dataURLVersBlob(c.image); await ajouterCarteImportee(b, c.config.nom, c.config.id); }
    }
    for (const r of a.annotations) await base.put('annotations', r);
    for (const e of a.etats_tips) await base.put('etats_tips', e);
    if (a.reglages) await meta.set('reglages', a.reglages);
    return { carte: a.reglages && a.reglages.carte, texte: `${a.annotations.length} carte(s) d'annotations, ${a.etats_tips.length} état(s) de tips restaurés.` };
  }
  // ancien export (appli v1) : pixels -> normalisé
  let id = a.mapId, info = infoCarte(id);
  if (!info && a.image) {
    const pris = (await cartesImportees()).some(c => c.id === id);
    const cfg = await ajouterCarteImportee(await dataURLVersBlob(a.image), a.name, pris ? null : id);
    id = cfg.id; info = { W: cfg.largeur_px, H: cfg.hauteur_px, version: cfg.version };
  }
  if (!info) throw new Error(`Carte « ${a.name} » inconnue et sans image dans le fichier.`);
  const { rec, stats } = convertirEtatV1(a.state, info.W, info.H, id, info.version);
  await base.put('annotations', rec);
  return { carte: id, texte: `Ancien export converti : ${stats.marqueurs} marqueur(s), ${stats.traits} trait(s).` };
}

/* ---------- migration depuis l'ancienne appli (base « gta-map ») ---------- */
/**
 * cartesConfig : configs de maps.json (pour retrouver les dimensions des cartes intégrées).
 * force : relancer même si déjà faite (récupération manuelle).
 * @returns null si rien à migrer, sinon un rapport.
 */
export async function migrerDepuisV1(cartesConfig, force = false) {
  const deja = await meta.get('migration_v1');
  if (deja && !force) return null;
  const kv = await lireAncienneBase();
  if (!kv) { if (!deja) await meta.set('migration_v1', { date: new Date().toISOString(), rien: true }); return null; }

  // 1) copie brute de l'ancien format (conservée + téléchargeable)
  const brut = { format: 'gta-map-v1-brut', copie_le: new Date().toISOString(), kv: {} };
  for (const [k, v] of Object.entries(kv)) if (v != null) brut.kv[k] = v; // Blobs conservés tels quels dans IndexedDB
  if (force) await sauvegardeAuto('avant-recuperation-v1');
  await base.put('sauvegardes', { id: new Date().toISOString() + '-migration-v1', type: 'migration-v1-ancien-format', cree: new Date().toISOString(), donnees: brut });

  const rapport = { date: new Date().toISOString(), cartes: [], erreurs: [] };
  // 2) cartes importées par l'utilisateur
  const dimsImportees = {};
  const custom = Array.isArray(kv.custommeta) ? kv.custommeta : [];
  for (const c of custom) {
    const b = kv['img:' + c.id];
    if (!(b instanceof Blob)) { rapport.erreurs.push(`Image de « ${c.name} » introuvable`); continue; }
    try { const cfg = await ajouterCarteImportee(b, c.name, c.id); dimsImportees[c.id] = [cfg.largeur_px, cfg.hauteur_px, cfg.version]; }
    catch (e) { rapport.erreurs.push(`« ${c.name} » : ${e.message}`); }
  }
  // 3) annotations de chaque carte
  for (const k of Object.keys(kv)) {
    if (!k.startsWith('state:') || kv[k] == null) continue;
    const id = k.slice(6);
    const cfg = cartesConfig.find(c => c.id === id);
    let W, H, version;
    if (dimsImportees[id]) [W, H, version] = dimsImportees[id];
    else if (DIMS_ANCIENNES[id]) { [W, H] = DIMS_ANCIENNES[id]; version = cfg && cfg.largeur_px === W && cfg.hauteur_px === H ? cfg.version : VERSION_ANCIENNES; }
    else if (cfg) { W = cfg.largeur_px; H = cfg.hauteur_px; version = cfg.version; }
    else { rapport.erreurs.push(`Carte « ${id} » : dimensions inconnues, non migrée (copie brute conservée)`); continue; }
    try {
      const { rec, stats } = convertirEtatV1(kv[k], W, H, id, version);
      if (!stats.marqueurs && !stats.traits && !rec.hidden_cats.length) continue;
      const exist = await base.get('annotations', id);
      if (exist && (exist.markers.length || exist.strokes.length) && !force) { rapport.erreurs.push(`Carte « ${id} » : déjà des annotations, non écrasées`); continue; }
      if (exist && force) { // fusion : ajoute ce qui manque
        const idsM = new Set(exist.markers.map(m => m.id));
        rec.markers = exist.markers.concat(rec.markers.filter(m => !idsM.has(m.id)));
        rec.strokes = exist.strokes.concat(rec.strokes.filter(s => !exist.strokes.some(e => JSON.stringify(e.pts) === JSON.stringify(s.pts))));
      }
      await base.put('annotations', rec);
      rapport.cartes.push({ id, ...stats });
    } catch (e) { rapport.erreurs.push(`Carte « ${id} » : ${e.message}`); }
  }
  rapport.carte_active = typeof kv.cur === 'string' ? kv.cur : null;
  await meta.set('migration_v1', rapport);
  return rapport;
}

/* ---------- persistance / quota ---------- */
export async function etatStockage() {
  const r = { persistant: null, utilise: null, quota: null };
  try { if (navigator.storage && navigator.storage.persisted) r.persistant = await navigator.storage.persisted(); } catch (e) { }
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); r.utilise = e.usage; r.quota = e.quota; } } catch (e) { }
  return r;
}
export async function demanderPersistance() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { }
  return false;
}
