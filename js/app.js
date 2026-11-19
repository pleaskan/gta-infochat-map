// Carte GTA 6 — appli principale.  Aucun build : modules ES natifs + Leaflet en global (lib/).
/* global L */
import { projecteur, caseGrille, arrondi, grilleDe, repereXY, regionDe, GRILLE_DEFAUT } from './coords.js';
import { validerTips, TYPES_LIEU } from './geojson.js';
import { filtresParDefaut, normaliserFiltres, filtrerLieux, compteurs, trierLignes, TRIS, etatTip, normTexte } from './filtres.js';
import { nouvelId, enregistrementVide } from './migration.js';
import { CoucheCanvas, tracer, boite, touche, dessinerGrille } from './encre.js';
import * as S from './stockage.js';

/* =================================================================== constantes & état */
const URL_TIPS = 'data/tips_gta6.geojson';
const CACHE_TUILES = 'carte-tuiles-v1';      // partagé avec sw.js
const COULEURS = ['#ff3b3b', '#ffd400', '#2ee66b', '#2fb3ff', '#ff8c00', '#c77dff', '#ffffff', '#111111'];
const OUTILS = [['hand', '✋', 'Main (déplacer)'], ['pen', '✏️', 'Stylo'], ['hl', '🖍️', 'Surligneur'], ['line', '↗️', 'Flèche'], ['erase', '🧽', 'Gomme'], ['mark', '📍', 'Marqueur']];
const OUTILS_DESSIN = ['pen', 'hl', 'line', 'erase'];
const STYLES_SECOURS = {
  defaut: { couleur: '#9aa5b1', icone: '📍' }, categories: {}, types_lieu: {},
  perso: [{ id: 'note', nom: 'Note', icone: '📌', couleur: '#e0e0e0' }],
};
const CARTE_SECOURS = { id: 'grille', nom: 'Grille vierge (maps.json introuvable)', version: 'test-v1', type: 'grille', largeur_px: 4096, hauteur_px: 4096, zoom_min: 0, zoom_max: 6, tips: true };

const E = {
  cartes: [], carte: null, P: null, styles: STYLES_SECOURS,
  rec: null, verrou: false, verrouVoir: false, fondManquant: false,
  tips: { lieux: [], stats: null, meta: {}, erreur: null, recu: null, cache: false, modifie: null, charge: false },
  etats: new Map(), visibles: [], nLieux: 0, nTips: 0, horsVersion: 0,
  r: null,            // réglages persistés
  live: null, annuler: [], refaire: [],
  map: null, fond: null, couche: null, cluster: null, anneaux: null, perso: null,
  urlBlob: null, swVersion: null,
  G: GRILLE_DEFAUT, X: null,          // grille de repères et repère X/Y du jeu de la carte ouverte
  regions: null, zones: null, zFit: 0, comte: null,   // comtés : définition, calque, zoom « carte entière », comté affiché
};

/* =================================================================== utilitaires */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const anti = (f, ms) => { let t; const g = (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; g.maintenant = (...a) => { clearTimeout(t); return f(...a); }; return g; };
const fmtDate = d => { try { return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(d); } };
const fmtMo = o => o == null ? '?' : (o / 1048576).toFixed(o > 1e8 ? 0 : 1) + ' Mo';
function toast(t, ms = 2400) { const e = $('#toast'); e.textContent = t; e.classList.add('vu'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('vu'), ms); }
function telecharger(blob, nom) { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = nom; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); }
const horodatage = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}`; };
async function lireJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} : HTTP ${r.status}`);
  return { json: JSON.parse(await r.text()), rep: r };
}
const styleCat = c => {
  const s = E.styles.categories[c];
  return { nom: (s && s.nom) || (c.charAt(0).toUpperCase() + c.slice(1)).replace(/_/g, ' '), couleur: (s && s.couleur) || E.styles.defaut.couleur, icone: (s && s.icone) || E.styles.defaut.icone };
};
const styleType = t => { const s = E.styles.types_lieu[t]; return { nom: (s && s.nom) || t, icone: (s && s.icone) || '❔' }; };
const catPerso = id => E.styles.perso.find(c => c.id === id) || E.styles.perso[E.styles.perso.length - 1];

/* =================================================================== bandeaux */
function bandeau(id, html, actions = [], type = 'info') {
  let b = document.getElementById('bd-' + id);
  if (!b) { b = document.createElement('div'); b.id = 'bd-' + id; $('#bandeaux').appendChild(b); }
  b.className = 'bandeau ' + type;
  b.innerHTML = `<div class="bd-txt">${html}</div><div class="bd-act"></div>`;
  const act = $('.bd-act', b);
  for (const a of actions.concat([{ t: '✕', f: () => {}, fermer: true }])) {
    const k = document.createElement('button'); k.className = a.t === '✕' ? 'ico' : 'btn petit'; k.textContent = a.t;
    k.onclick = async () => { const garder = await a.f(); if (garder !== true) fermerBandeau(id); };
    act.appendChild(k);
  }
}
const fermerBandeau = id => { const b = document.getElementById('bd-' + id); if (b) b.remove(); };

/* =================================================================== réglages */
function reglagesParDefaut() {
  return { carte: null, vues: {}, filtres: filtresParDefaut(), outil: 'hand', couleur: COULEURS[0], epaisseur: 4, styletSeul: true, gaucher: false, theme: 'sombre', panneau: { ouvert: false, onglet: 'legende' }, tri: 'sources', liste: 'tips', catPerso: 'obj' };
}
function normaliserReglages(r) {
  const d = reglagesParDefaut();
  if (!r || typeof r !== 'object') return d;
  const o = { ...d, ...r };
  o.filtres = normaliserFiltres(r.filtres);
  o.panneau = { ...d.panneau, ...(r.panneau || {}) };
  o.vues = r.vues && typeof r.vues === 'object' ? r.vues : {};
  if (!OUTILS.some(t => t[0] === o.outil)) o.outil = 'hand';
  if (!TRIS[o.tri]) o.tri = 'sources';
  return o;
}
const sauverReglages = anti(() => S.meta.set('reglages', E.r).catch(e => console.warn(e)), 500);

/* =================================================================== démarrage */
async function demarrer() {
  enregistrerSW();
  // 1) stockage
  try { await S.ouvrirStockage(); }
  catch (e) { bandeau('db', `⚠️ Stockage local indisponible : ${esc(e.message)}. Tes annotations ne seront pas enregistrées.`, [], 'erreur'); }
  // 2) configuration (maps.json, styles.json) — l'appli reste utilisable si absents
  await chargerConfig();
  // 3) migration depuis l'ancienne appli
  let rapportMigration = null;
  if (S.base) { try { rapportMigration = await S.migrerDepuisV1(E.cartes); } catch (e) { console.error(e); bandeau('mig', '⚠️ Migration des anciennes données impossible : ' + esc(e.message), [], 'erreur'); } }
  if (S.base) { const imp = await S.cartesImportees(); E.cartes = E.cartes.concat(imp.filter(c => !E.cartes.some(x => x.id === c.id))); }
  // 4) réglages + états des tips
  E.r = normaliserReglages(S.base ? await S.meta.get('reglages') : null);
  if (rapportMigration && rapportMigration.carte_active && !E.r.carte) E.r.carte = rapportMigration.carte_active;
  E.etats = S.base ? await S.lireEtatsTips() : new Map();
  appliquerTheme();
  // 5) interface + carte
  construireRail();
  creerCarte();
  installerSaisie();
  installerPanneau();
  // nouvelle carte par défaut publiée (ex. la carte officielle) : on l'ouvre une fois, même si une autre était mémorisée
  if (E.defaut && E.r.defautVu !== E.defaut && E.cartes.some(c => c.id === E.defaut)) {
    if (E.r.defautVu !== undefined || E.r.carte) E.r.carte = E.defaut;
    E.r.defautVu = E.defaut;
  }
  const id = E.cartes.some(c => c.id === E.r.carte) ? E.r.carte : (E.cartes.some(c => c.id === E.defaut) ? E.defaut : E.cartes[0].id);
  await ouvrirCarte(id);
  if (E.r.panneau.ouvert) basculerPanneau(true);
  // 6) tips
  chargerTips(false);
  // 7) stockage : persistance, quota, sauvegarde du jour
  if (S.base) verifierStockage();
  if (rapportMigration && (rapportMigration.cartes.length || rapportMigration.erreurs.length)) montrerRapportMigration(rapportMigration);
  addEventListener('keydown', clavier);
  addEventListener('pagehide', () => { sauverAnnot.maintenant(); sauverReglages.maintenant(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { sauverAnnot.maintenant(); sauverReglages.maintenant(); } });
  document.body.classList.add('pret');
}

async function chargerConfig() {
  try {
    const { json } = await lireJSON('maps.json');
    const liste = Array.isArray(json.cartes) ? json.cartes : [];
    let ko = 0;
    E.cartes = liste.filter(c => {
      const ok = c && typeof c.id === 'string' && ['image', 'tuiles', 'grille'].includes(c.type) && c.largeur_px > 0 && c.hauteur_px > 0 && (c.type === 'grille' || typeof c.chemin === 'string');
      if (!ok) ko++; return ok;
    }).map(c => ({ version: 'v1', nom: c.id, tips: true, ...c }));
    E.defaut = json.defaut;
    if (ko) bandeau('mapsko', `⚠️ ${ko} carte(s) invalide(s) ignorée(s) dans maps.json (il faut id, type, largeur_px, hauteur_px, chemin).`, [], 'alerte');
  } catch (e) {
    console.warn(e);
    bandeau('maps', `⚠️ maps.json introuvable ou invalide (${esc(e.message)}). Carte de remplacement affichée.`, [], 'alerte');
  }
  if (!E.cartes.length) E.cartes = [CARTE_SECOURS];
  try {
    const { json } = await lireJSON('styles.json');
    E.styles = {
      defaut: { ...STYLES_SECOURS.defaut, ...(json.defaut || {}) },
      categories: json.categories || {}, types_lieu: json.types_lieu || {},
      perso: Array.isArray(json.perso) && json.perso.length ? json.perso : STYLES_SECOURS.perso,
    };
  } catch (e) { console.warn(e); bandeau('styles', '⚠️ styles.json introuvable : styles par défaut.', [], 'alerte'); }
}

/* =================================================================== carte Leaflet */
function creerCarte() {
  const map = E.map = L.map('map', {
    crs: L.CRS.Simple, zoomControl: false, attributionControl: false,
    zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90, boxZoom: false,
    bounceAtZoomLimits: false, maxBoundsViscosity: 0.7, inertia: true, tapHold: false,
  });
  map.createPane('zones').style.zIndex = 380;      // comtés : au-dessus du fond, sous l'encre et les marqueurs
  map.getPane('zones').style.pointerEvents = 'none';
  map.createPane('encre').style.zIndex = 450;
  map.createPane('perso').style.zIndex = 650;
  E.couche = new CoucheCanvas(dessinerCouche).addTo(map);
  E.anneaux = L.layerGroup().addTo(map);
  E.rendu = L.canvas({ padding: 0.3 });
  E.cluster = L.markerClusterGroup({
    chunkedLoading: true, showCoverageOnHover: false, maxClusterRadius: 46, spiderfyOnMaxZoom: true,
    removeOutsideVisibleBounds: true, iconCreateFunction: iconeCluster,
  }).addTo(map);
  E.perso = L.layerGroup().addTo(map);
  map.on('click', surClicCarte);
  map.on('moveend', () => {
    if (!E.carte) return;
    const c = map.getCenter();
    E.r.vues[E.carte.id] = { c: [arrondi(c.lat, 4), arrondi(c.lng, 4)], z: map.getZoom() };
    sauverReglages();
    if (panneauOuvert() && E.r.panneau.onglet === 'liste') rendreListe();
    majCoords();
    majComte();
  });
  map.on('move', majCoords);
  // comtés : le fondu suit le zoom (zoomanim = zoom cible, lancé au début de l'animation ; zoom = pincement continu)
  map.on('zoomanim', e => majZones(e.zoom));
  map.on('zoom', () => majZones(map.getZoom()));
  addEventListener('resize', () => map.invalidateSize());
}

async function ouvrirCarte(id) {
  const cfg = E.cartes.find(c => c.id === id) || E.cartes[0];
  if (E.rec) { sauverAnnot.maintenant(); }
  fermerFeuille();
  const map = E.map;
  if (E.fond) { map.removeLayer(E.fond); E.fond = null; }
  if (E.urlBlob) { URL.revokeObjectURL(E.urlBlob); E.urlBlob = null; }
  fermerBandeau('fond'); fermerBandeau('version'); fermerBandeau('tipsversion');
  E.carte = cfg; E.P = projecteur(cfg); E.fondManquant = false;
  E.G = grilleDe(cfg); E.X = repereXY(cfg);
  if (E.zones) { map.removeLayer(E.zones); E.zones = null; }
  E.regions = null; E.comte = null; majComte();
  const bornes = L.latLngBounds(E.P.limites());
  // zoom : on autorise toujours à voir la carte entière
  map.setMaxBounds(null);
  map.setMinZoom(-20); map.setMaxZoom(30);
  const zFit = map.getBoundsZoom(bornes, false, L.point(20, 20));
  const zMin = Math.min(Number.isFinite(cfg.zoom_min) ? cfg.zoom_min : zFit - 1, zFit - 0.5);
  const zMax = Number.isFinite(cfg.zoom_max) ? Math.max(cfg.zoom_max, E.P.zn) : E.P.zn + 2;
  map.setMinZoom(zMin); map.setMaxZoom(zMax);
  map.setMaxBounds(bornes.pad(0.6));
  // fond
  if (cfg.type === 'tuiles') {
    let ok = 0, ko = 0;
    E.fond = L.tileLayer(cfg.chemin + (cfg.tuiles || '{z}/{x}/{y}.webp'), {
      tileSize: 256, noWrap: true, bounds: bornes, minZoom: zMin, maxZoom: zMax, minNativeZoom: 0, maxNativeZoom: E.P.zn, keepBuffer: 3,
    });
    E.fond.on('tileload', () => { ok++; });
    E.fond.on('tileerror', () => { ko++; });
    E.fond.on('load', () => { if (!ok && ko) fondIntrouvable(`tuiles introuvables dans « ${esc(cfg.chemin)} »`); });
  } else if (cfg.type === 'image') {
    let url = cfg.chemin;
    if (cfg.blob) {
      const b = S.base ? await S.base.get('blobs', cfg.blob) : null;
      if (b) url = E.urlBlob = URL.createObjectURL(b); else url = null;
    }
    if (url) {
      E.fond = L.imageOverlay(url, bornes, { interactive: false, className: 'fond-carte' });
      E.fond.on('error', () => fondIntrouvable(`image introuvable : « ${esc(cfg.chemin || cfg.nom)} »`));
    } else fondIntrouvable('image de la carte importée introuvable');
  }
  if (E.fond) E.fond.addTo(map);
  E.zFit = zFit;
  chargerRegions(cfg, bornes);   // sans attendre : la carte s'affiche, les comtés arrivent en fondu
  // annotations
  E.rec = S.base ? await S.lireAnnotations(cfg.id, cfg.version) : enregistrementVide(cfg.id, cfg.version);
  if (E.rec.map_version == null) E.rec.map_version = cfg.version;
  E.annuler = []; E.refaire = []; E.live = null;
  E.verrou = false; E.verrouVoir = false;
  const nb = E.rec.markers.length + E.rec.strokes.length;
  if (nb && E.rec.map_version !== cfg.version) {
    E.verrou = true;
    bandeau('version', `⚠️ Tes ${nb} annotation(s) sur « ${esc(cfg.nom)} » ont été faites sur la version <b>${esc(E.rec.map_version)}</b> ; la carte est maintenant en <b>${esc(cfg.version)}</b>. Elles peuvent être décalées : elles sont masquées et verrouillées.`, [
      { t: 'Voir (lecture seule)', f: () => { E.verrouVoir = true; rendrePerso(); E.couche._reset(); return true; } },
      { t: 'Valider pour ' + cfg.version, f: () => { E.rec.map_version = cfg.version; E.verrou = false; E.verrouVoir = false; sauverAnnot(); rendrePerso(); E.couche._reset(); majRail(); toast('Annotations rattachées à la version ' + cfg.version); } },
    ], 'alerte');
  }
  // vue
  const v = E.r.vues[cfg.id];
  if (v && Array.isArray(v.c) && Number.isFinite(v.z)) map.setView(v.c, Math.max(zMin, Math.min(zMax, v.z)), { animate: false });
  else map.fitBounds(bornes, { padding: [10, 10], animate: false });
  E.r.carte = cfg.id; sauverReglages();
  map.invalidateSize();
  majRail(); rendrePerso(); E.couche._reset();
  appliquerFiltres();
}

function fondIntrouvable(msg) {
  E.fondManquant = true; E.couche && E.couche._reset();
  bandeau('fond', `🗺️ Carte non chargée : ${msg}. La grille de repères est affichée à la place ; tes annotations restent utilisables.`, [], 'alerte');
}

/* =================================================================== couche canvas : grille + encre */
const echelle = () => E.P.echelle(E.map.getZoom());
function dessinerCouche(g, map, dpr) {
  if (!E.P || !E.carte) return;
  const o = map.latLngToContainerPoint([0, 0]), K = echelle(), sz = map.getSize();
  const fond = E.carte.type === 'grille' || E.fondManquant;
  if (fond || E.r.filtres.calques.grille) dessinerGrille(g, o, E.P.W * K, E.P.H * K, dpr, sz.x, sz.y, fond, E.G);
  if (!E.rec || !E.r.filtres.calques.dessins || (E.verrou && !E.verrouVoir)) return;
  const W = E.P.W, H = E.P.H;
  g.setTransform(dpr * K, 0, 0, dpr * K, dpr * o.x, dpr * o.y);
  const x0 = -o.x / (K * W), y0 = -o.y / (K * H), x1 = (sz.x - o.x) / (K * W), y1 = (sz.y - o.y) / (K * H);
  for (const s of E.rec.strokes) {
    const b = boite(s), m = s.w * 6;
    if (b.x1 + m < x0 || b.x0 - m > x1 || b.y1 + m * W / H < y0 || b.y0 - m * W / H > y1) continue;
    tracer(g, s, W, H);
  }
  if (E.live) tracer(g, E.live, W, H);
}

/* =================================================================== saisie stylet / doigt */
let trait = null, dernierStylet = 0;
function normEvt(e) { const cp = E.map.mouseEventToContainerPoint(e); return E.P.depuisLatLng(E.map.containerPointToLatLng(cp)); }
function suspendreCarte(oui) {
  const m = E.map;
  for (const h of [m.dragging, m.touchZoom, m.doubleClickZoom]) oui ? h.disable() : h.enable();
}
function installerSaisie() {
  const z = $('#zone-carte');
  z.addEventListener('pointerdown', surDown, true);
  z.addEventListener('pointermove', surMove, true);
  z.addEventListener('pointerup', surUp, true);
  z.addEventListener('pointercancel', surCancel, true);
  z.addEventListener('pointerleave', e => { if (e.pointerType === 'pen' && !trait) dernierStylet = performance.now() - 400; }, true);
  z.addEventListener('contextmenu', e => e.preventDefault());
}
function surDown(e) {
  if (e.pointerType === 'pen') dernierStylet = performance.now();
  if (trait) { // un autre doigt pendant un trait = paume ou 2e doigt : on bloque
    if (e.pointerId !== trait.pid) {
      e.stopPropagation(); e.preventDefault();
      if (trait.type === 'touch' && e.pointerType === 'touch') { E.live = null; finTrait(false); }
    }
    return;
  }
  if (!e.target.closest('#map') || e.target.closest('.leaflet-marker-icon, .leaflet-popup')) return;
  let t = E.r.outil;
  const pen = e.pointerType === 'pen', touch = e.pointerType === 'touch';
  if (pen && (e.buttons & 32)) t = 'erase';           // bout gomme du stylet
  const dessin = OUTILS_DESSIN.includes(t);
  // rejet de paume : stylet proche/actif récemment + outil de dessin -> on ignore le doigt
  if (touch && dessin && E.r.styletSeul && performance.now() - dernierStylet < 700) { e.stopPropagation(); e.preventDefault(); return; }
  if (!dessin) return;
  if (touch && E.r.styletSeul) return;               // le doigt déplace / zoome
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (!E.r.filtres.calques.dessins) { toast('Le calque « Mes dessins » est masqué'); return; }
  if (E.verrou) { toast('Annotations verrouillées : version de carte différente'); return; }
  e.stopPropagation(); e.preventDefault();
  try { $('#zone-carte').setPointerCapture(e.pointerId); } catch (er) { }
  suspendreCarte(true);
  const [x, y] = normEvt(e);
  trait = { pid: e.pointerId, type: e.pointerType, mode: t === 'erase' ? 'erase' : 'draw', efface: false, dernier: [e.clientX, e.clientY] };
  if (t === 'erase') { effacerA(x, y); return; }
  let col = E.r.couleur; if (t === 'hl' && col === '#111111') col = '#ffd400';
  E.live = { id: nouvelId('s'), t, color: col, w: (E.r.epaisseur / echelle()) / E.P.W, pen: pen && t === 'pen', pts: [[x, y, pression(e)]] };
  E.couche.planifier();
}
const pression = e => e.pointerType === 'pen' ? Math.round((e.pressure || 0.5) * 1000) / 1000 : 0.5;
function surMove(e) {
  if (e.pointerType === 'pen') dernierStylet = performance.now();
  if (!trait || e.pointerId !== trait.pid) { if (trait) { e.stopPropagation(); } return; }
  e.stopPropagation(); e.preventDefault();
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  for (const ev of (evs.length ? evs : [e])) {
    if (Math.hypot(ev.clientX - trait.dernier[0], ev.clientY - trait.dernier[1]) < 0.75) continue;
    trait.dernier = [ev.clientX, ev.clientY];
    const [x, y] = normEvt(ev);
    if (trait.mode === 'erase') { effacerA(x, y); continue; }
    if (!E.live) continue;
    const p = [arrondi(x, 6), arrondi(y, 6), pression(ev)];
    if (E.live.t === 'line') E.live.pts = [E.live.pts[0], p]; else E.live.pts.push(p);
  }
  E.couche.planifier();
}
function surUp(e) { if (trait && e.pointerId === trait.pid) { e.stopPropagation(); finTrait(true); } }
function surCancel(e) { if (trait && e.pointerId === trait.pid) { E.live = null; finTrait(false); } }
function finTrait(garder) {
  if (trait && trait.mode === 'draw' && garder && E.live) {
    E.live.pts[0] = [arrondi(E.live.pts[0][0], 6), arrondi(E.live.pts[0][1], 6), E.live.pts[0][2]];
    instantane(); E.rec.strokes.push(E.live); sauverAnnot();
  }
  if (trait && trait.mode === 'erase' && trait.efface) sauverAnnot();
  E.live = null; trait = null; suspendreCarte(false); E.couche.planifier(); majRail();
}
function effacerA(x, y) {
  const r = 18 / echelle(), W = E.P.W, H = E.P.H, px = x * W, py = y * H;
  const garde = E.rec.strokes.filter(s => !touche(s, px, py, r, W, H));
  if (garde.length !== E.rec.strokes.length) { if (!trait.efface) { instantane(); trait.efface = true; } E.rec.strokes = garde; E.couche.planifier(); }
}

/* =================================================================== annuler / rétablir / sauvegarde */
const etatAnnot = () => JSON.stringify({ m: E.rec.markers, s: E.rec.strokes });
function instantane() { E.annuler.push(etatAnnot()); if (E.annuler.length > 80) E.annuler.shift(); E.refaire = []; majRail(); }
function restaurer(j) { const o = JSON.parse(j); E.rec.markers = o.m; E.rec.strokes = o.s; sauverAnnot(); rendrePerso(); E.couche._reset(); majRail(); if (panneauOuvert()) rendrePanneau(); }
function annuler() { if (E.verrou || !E.annuler.length) return; E.refaire.push(etatAnnot()); restaurer(E.annuler.pop()); }
function refaire() { if (E.verrou || !E.refaire.length) return; E.annuler.push(etatAnnot()); restaurer(E.refaire.pop()); }
const sauverAnnot = anti(async () => {
  if (!E.rec || !S.base) return;
  try { await S.ecrireAnnotations(E.rec); }
  catch (e) { bandeau('ecriture', '⚠️ Impossible d\'enregistrer (stockage plein ?) : ' + esc(e.message) + '. Exporte une sauvegarde !', [{ t: 'Sauvegarder (.json)', f: exporterJSON }], 'erreur'); }
}, 400);

function clavier(e) {
  if (e.target.matches('input, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? refaire() : annuler(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); refaire(); }
  else if (e.key === 'Escape') { fermerFeuille(); fermerModal(); }
}

/* =================================================================== marqueurs perso */
function iconePerso(m) {
  const c = catPerso(m.cat), col = m.color || c.couleur;
  return L.divIcon({
    className: 'mk-perso' + (m.done ? ' fait' : ''), iconSize: [40, 48], iconAnchor: [20, 46],
    html: `<div class="pin" style="--c:${esc(col)}"><span>${m.done ? '✓' : esc(c.icone)}</span></div>${m.label ? `<div class="pin-lab">${esc(m.label)}</div>` : ''}`,
  });
}
function rendrePerso() {
  E.perso.clearLayers();
  if (!E.rec || !E.r.filtres.calques.marqueurs || (E.verrou && !E.verrouVoir)) return;
  const deplacable = E.r.outil === 'mark' && !E.verrou;
  for (const m of E.rec.markers) {
    if (E.rec.hidden_cats.includes(m.cat)) continue;
    const mk = L.marker(E.P.versLatLng(m.x, m.y), { icon: iconePerso(m), draggable: deplacable, pane: 'perso', keyboard: false, autoPan: true });
    mk.on('click', ev => { L.DomEvent.stop(ev); ouvrirEditeur(m); });
    mk.on('dragstart', () => instantane());
    mk.on('dragend', ev => { const [x, y] = E.P.depuisLatLng(ev.target.getLatLng()); m.x = arrondi(x); m.y = arrondi(y); sauverAnnot(); });
    mk.addTo(E.perso);
  }
}
function surClicCarte(e) {
  if (E.r.outil !== 'mark') { fermerFeuille(); return; }
  if (E.verrou) { toast('Annotations verrouillées : version de carte différente'); return; }
  if (!E.r.filtres.calques.marqueurs) { toast('Le calque « Mes marqueurs » est masqué'); return; }
  const [x, y] = E.P.depuisLatLng(e.latlng);
  instantane();
  const m = { id: nouvelId('m'), x: arrondi(x), y: arrondi(y), cat: E.r.catPerso, label: '', note: '', done: false, color: null };
  if (E.rec.hidden_cats.includes(m.cat)) E.rec.hidden_cats = E.rec.hidden_cats.filter(c => c !== m.cat);
  E.rec.markers.push(m); sauverAnnot(); rendrePerso();
  ouvrirEditeur(m, true);
}
function ouvrirEditeur(m, nouveau = false) {
  const avant = JSON.stringify(m);
  const lectureSeule = E.verrou;
  const c = catPerso(m.cat);
  const f = ouvrirFeuille(`
    <div class="f-tete"><span class="pin mini" style="--c:${esc(m.color || c.couleur)}"><span>${esc(c.icone)}</span></span>
      <input id="ed-titre" placeholder="Titre du marqueur" value="${esc(m.label)}" ${lectureSeule ? 'disabled' : ''}>
      <button class="ico" data-a="fermer" aria-label="Fermer">✕</button></div>
    <textarea id="ed-note" placeholder="Notes (astuce, objet à récupérer…)" ${lectureSeule ? 'disabled' : ''}>${esc(m.note)}</textarea>
    <div class="f-lab">Catégorie</div>
    <div class="puces" id="ed-cats">${E.styles.perso.map(k => `<button class="puce${k.id === m.cat ? ' on' : ''}" data-cat="${esc(k.id)}">${esc(k.icone)} ${esc(k.nom)}</button>`).join('')}</div>
    <div class="f-lab">Couleur</div>
    <div class="puces" id="ed-coul"><button class="puce${!m.color ? ' on' : ''}" data-c="">Auto</button>${COULEURS.map(k => `<button class="pastille${m.color === k ? ' on' : ''}" data-c="${k}" style="background:${k}" aria-label="${k}"></button>`).join('')}</div>
    <label class="interr"><input type="checkbox" id="ed-fait" ${m.done ? 'checked' : ''} ${lectureSeule ? 'disabled' : ''}> Fait ✓</label>
    <div class="f-info">Position : ${esc(posTexte(m.x, m.y))} <button class="btn petit" data-a="copier">Copier</button></div>
    <div class="rangee"><button class="btn rouge" data-a="suppr" ${lectureSeule ? 'disabled' : ''}>Supprimer</button><button class="btn" data-a="centrer">Centrer</button><button class="btn bleu" data-a="ok">OK</button></div>`,
  () => { // à la fermeture
    if (!E.rec.markers.includes(m)) return;
    m.label = $('#ed-titre', f).value.trim(); m.note = $('#ed-note', f).value; m.done = $('#ed-fait', f).checked;
    if (JSON.stringify(m) !== avant) { const cur = JSON.stringify(m); Object.assign(m, JSON.parse(avant)); instantane(); Object.assign(m, JSON.parse(cur)); sauverAnnot(); rendrePerso(); if (panneauOuvert()) rendrePanneau(); }
  });
  if (!lectureSeule) {
    $$('#ed-cats .puce', f).forEach(b => b.onclick = () => { m.cat = b.dataset.cat; E.r.catPerso = m.cat; sauverReglages(); $$('#ed-cats .puce', f).forEach(x => x.classList.toggle('on', x === b)); const k = catPerso(m.cat); $('.f-tete .pin', f).style.setProperty('--c', m.color || k.couleur); $('.f-tete .pin span', f).textContent = k.icone; majRail(); });
    $$('#ed-coul button', f).forEach(b => b.onclick = () => { m.color = b.dataset.c || null; $$('#ed-coul button', f).forEach(x => x.classList.toggle('on', x === b)); $('.f-tete .pin', f).style.setProperty('--c', m.color || catPerso(m.cat).couleur); });
  }
  f.onclick = async ev => {
    const a = ev.target.closest('[data-a]'); if (!a) return;
    const act = a.dataset.a;
    if (act === 'fermer' || act === 'ok') fermerFeuille();
    else if (act === 'suppr') { instantane(); E.rec.markers = E.rec.markers.filter(x => x !== m); sauverAnnot(); fermerFeuille(); rendrePerso(); if (panneauOuvert()) rendrePanneau(); toast('Marqueur supprimé (↩️ pour annuler)'); }
    else if (act === 'centrer') E.map.panTo(E.P.versLatLng(m.x, m.y));
    else if (act === 'copier') copier(posCopie(m.x, m.y));
  };
  if (nouveau) setTimeout(() => $('#ed-titre', f).focus(), 60);
}
async function copier(t) { try { await navigator.clipboard.writeText(t); toast('Copié : ' + t); } catch (e) { toast(t, 5000); } }

/* =================================================================== feuille (bas) / modal */
let surFermetureFeuille = null;
function ouvrirFeuille(html, quandFerme) {
  fermerFeuille();
  const f = $('#feuille'); f.innerHTML = `<div class="poignee"></div>${html}`; f.hidden = false; f.scrollTop = 0;
  surFermetureFeuille = quandFerme || null;
  return f;
}
function fermerFeuille() {
  const f = $('#feuille'); if (f.hidden) return;
  const cb = surFermetureFeuille; surFermetureFeuille = null;
  if (cb) try { cb(); } catch (e) { console.error(e); }
  f.hidden = true; f.innerHTML = ''; f.onclick = null; E.ficheLieu = null;
}
function ouvrirModal(html, classe = '') {
  const m = $('#modal'); m.className = classe; m.innerHTML = `<div class="boite">${html}</div>`; m.hidden = false;
  m.onclick = e => { if (e.target === m) fermerModal(); };
  return $('.boite', m);
}
function fermerModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }

/* =================================================================== tips : chargement */
async function chargerTips(manuel) {
  const T = E.tips; T.erreur = null;
  if (manuel) toast('Actualisation des tips…');
  try {
    let rep;
    try { rep = await fetch(URL_TIPS, { cache: 'no-store' }); }
    catch (e) { throw new Error('hors ligne et aucune copie en cache'); }
    if (rep.status === 404) throw new Error(`fichier « ${URL_TIPS} » introuvable`);
    if (!rep.ok) throw new Error('HTTP ' + rep.status);
    const txt = await rep.text();
    let json;
    try { json = JSON.parse(txt); } catch (e) { throw new Error('JSON invalide (' + e.message + ')'); }
    const v = validerTips(json);
    if (!v.ok) throw new Error(v.erreur);
    T.lieux = v.lieux; T.stats = v.stats; T.meta = v.meta; T.recu = new Date();
    T.cache = rep.headers.get('X-Carte-Cache') === '1'; T.modifie = rep.headers.get('Last-Modified');
    T.charge = true;
    fermerBandeau('tips');
    if (manuel) toast(`${v.stats.lieux} lieux / ${v.stats.tips} tips chargés` + (T.cache ? ' (copie hors ligne)' : ''));
    if (v.stats.lieux_invalides || v.stats.tips_invalides) console.warn('Tips ignorés :', v.stats.details);
  } catch (e) {
    T.erreur = e.message;
    bandeau('tips', `⚠️ Tips indisponibles : ${esc(e.message)}.` + (T.charge ? ' Les tips précédents restent affichés.' : ' L\'appli reste utilisable.'), [{ t: 'Réessayer', f: () => chargerTips(true) }], 'alerte');
  }
  appliquerFiltres();
}

/* =================================================================== tips : filtres + affichage */
function lieuxCarte() {
  if (!E.carte || !E.carte.tips) { E.horsVersion = 0; return []; }
  const forcer = E.forcerVersion === E.carte.id;
  let hors = 0;
  const l = E.tips.lieux.filter(x => { if (x.carte_version && x.carte_version !== E.carte.version) { hors++; return forcer; } return true; });
  E.horsVersion = hors;
  return l;
}
function appliquerFiltres() {
  const f = E.r.filtres;
  const base = lieuxCarte();
  const res = filtrerLieux(base, f, E.etats);
  E.visibles = res.visibles; E.nLieux = res.nLieux; E.nTips = res.nTips; E.baseLieux = base;
  // bandeau version des tips
  if (E.horsVersion && E.forcerVersion !== E.carte.id) {
    const vs = [...new Set(E.tips.lieux.filter(x => x.carte_version && x.carte_version !== E.carte.version).map(x => x.carte_version))].slice(0, 3).join(', ');
    bandeau('tipsversion', `ℹ️ ${E.horsVersion} lieu(x) de tips sont calés sur la carte <b>${esc(vs)}</b> (carte active : ${esc(E.carte.version)}) : non affichés pour éviter des positions fausses.`, [{ t: 'Afficher quand même', f: () => { E.forcerVersion = E.carte.id; appliquerFiltres(); } }], 'info');
  } else fermerBandeau('tipsversion');
  // marqueurs
  const vus = f.calques.tips ? res.visibles : [];
  E.cluster.clearLayers(); E.anneaux.clearLayers();
  E.cacheMk = E.cacheMk || new Map();
  const mks = [];
  for (const { lieu, tips } of vus) {
    let o = E.cacheMk.get(lieu.id);
    const verifie = tips.some(t => t.verifie), tousFaits = tips.every(t => etatTip(E.etats.get(t.id)) === 'fait');
    const cle = `${E.carte.id}|${tips.length}|${verifie}|${tousFaits}|${lieu.cat}|${E.styles === o?.styles}`;
    if (!o || o.lieu !== lieu || o.carte !== E.carte.id) {
      const mk = L.marker(E.P.versLatLng(lieu.x, lieu.y), { keyboard: false, title: lieu.lieu });
      mk.on('click', () => ouvrirFiche(lieu));
      o = { mk, lieu, carte: E.carte.id, cle: null, anneau: null };
      E.cacheMk.set(lieu.id, o);
    }
    if (o.cle !== cle) {
      const s = styleCat(lieu.cat);
      o.mk.setIcon(L.divIcon({ className: 'mk-tip', iconSize: [42, 42], iconAnchor: [21, 21], html: `<div class="tp${verifie ? ' v' : ''}${tousFaits ? ' f' : ''}" style="--c:${esc(s.couleur)}"><span>${esc(s.icone)}</span><b>${tips.length}</b></div>` }));
      o.mk.options.nTips = tips.length;
      o.cle = cle;
    }
    o.mk.options.nTips = tips.length;
    mks.push(o.mk);
    if (lieu.rayon) {
      if (!o.anneau) o.anneau = L.circle(E.P.versLatLng(lieu.x, lieu.y), { radius: E.P.rayonVersUnites(lieu.rayon), renderer: E.rendu, color: styleCat(lieu.cat).couleur, weight: 2, opacity: 0.8, fillOpacity: 0.07, interactive: false });
      E.anneaux.addLayer(o.anneau);
    }
  }
  E.cluster.addLayers(mks);
  majCompteur();
  if (panneauOuvert()) rendrePanneau();
  if (E.ficheLieu) rafraichirFiche();
}
const appliquerFiltresDiff = anti(appliquerFiltres, 180);

function iconeCluster(cl) {
  const ch = cl.getAllChildMarkers(); let n = 0;
  for (const m of ch) n += m.options.nTips || 1;
  const t = ch.length < 10 ? 'p' : ch.length < 50 ? 'm' : 'g';
  return L.divIcon({ className: 'mk-clu ' + t, iconSize: [54, 54], html: `<div><b>${ch.length}</b><small>${n} tips</small></div>` });
}

function majCompteur() {
  const c = $('#compteur');
  if (!E.carte.tips) c.innerHTML = '<span class="gris">Pas de tips sur cette carte</span>';
  else if (!E.tips.charge && E.tips.erreur) c.innerHTML = '⚠️ Tips indisponibles';
  else if (!E.tips.charge) c.innerHTML = 'Chargement des tips…';
  else c.innerHTML = `<b>${E.nLieux}</b> lieux / <b>${E.nTips}</b> tips affichés` + (filtresActifs() ? ' <span class="filtre-on">filtré</span>' : '') + (E.r.filtres.calques.tips ? '' : ' <span class="gris">(calque masqué)</span>');
}
function filtresActifs() {
  const f = E.r.filtres, d = filtresParDefaut();
  return f.cats_masquees.length || f.types_masques.length || f.verifies_seul || f.min_sources > 0 || f.texte.trim() || JSON.stringify(f.etats) !== JSON.stringify(d.etats);
}

/* =================================================================== tips : fiche d'un lieu */
function ouvrirFiche(lieu, tipId = null) {
  E.ficheLieu = lieu;
  const f = ouvrirFeuille('<div id="fiche"></div>', () => { E.ficheLieu = null; });
  rafraichirFiche(tipId);
  f.addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.a === 'fermer') { fermerFeuille(); return; }
    if (b.dataset.a === 'centrer') { E.map.setView(E.P.versLatLng(lieu.x, lieu.y), Math.max(E.map.getZoom(), E.P.zn - 1)); return; }
    if (b.dataset.a === 'copier') { copier(posCopie(lieu.x, lieu.y)); return; }
    const art = b.closest('[data-tip]'); if (!art) return;
    const id = art.dataset.tip, cle = b.dataset.e;
    if (cle === 'note') { const t = $('textarea', art); t.hidden = !t.hidden; if (!t.hidden) t.focus(); return; }
    const st = { tip_id: id, fait: false, utile: false, faux: false, masque: false, note: '', ...(E.etats.get(id) || {}) };
    st[cle] = !st[cle];
    majEtatTip(st);
    art.className = classeTip(id) + (art.classList.contains('cible') ? ' cible' : '');
    b.classList.toggle('on', !!st[cle]);
  });
  f.addEventListener('input', ev => {
    const t = ev.target; if (!t.matches('textarea.note')) return;
    const id = t.closest('[data-tip]').dataset.tip;
    const st = { tip_id: id, fait: false, utile: false, faux: false, masque: false, note: '', ...(E.etats.get(id) || {}) };
    st.note = t.value; majEtatTipDiff(st);
  });
}
function majEtatTip(st, filtrer = true) {
  const vide = !st.fait && !st.utile && !st.faux && !st.masque && !(st.note || '').trim();
  if (vide) E.etats.delete(st.tip_id); else E.etats.set(st.tip_id, st);
  if (S.base) S.ecrireEtatTip({ ...st }).catch(e => toast('Erreur d\'enregistrement : ' + e.message));
  if (filtrer) appliquerFiltresDiff();
}
const majEtatTipDiff = anti(st => majEtatTip(st, false), 400);
function classeTip(id) {
  const st = E.etats.get(id) || {};
  return 'tip' + (st.fait ? ' fait' : '') + (st.masque ? ' masque' : '') + (st.faux ? ' faux' : '') + (st.utile ? ' utile' : '');
}
function rafraichirFiche(tipId = null) {
  const lieu = E.ficheLieu, box = $('#fiche'); if (!lieu || !box) return;
  const vis = new Set((E.visibles.find(v => v.lieu === lieu)?.tips || []).map(t => t.id));
  const s = styleCat(lieu.cat), ty = styleType(lieu.type);
  const st = id => E.etats.get(id) || {};
  const carteTip = t => {
    const c = styleCat(t.categorie), e = st(t.id);
    return `<article class="${classeTip(t.id)}" data-tip="${esc(t.id)}">
      <div class="tip-l1"><span class="cat" style="--c:${esc(c.couleur)}">${esc(c.icone)} ${esc(c.nom)}</span>
        <span class="src" title="nombre de sources">👥 ${t.nb_sources} source${t.nb_sources > 1 ? 's' : ''}</span>
        ${t.verifie ? '<span class="badge ok">✅ vérifié en jeu</span>' : '<span class="badge">non vérifié</span>'}</div>
      <p class="en">${esc(t.enonce)}</p>${t.precision ? `<p class="pr">${esc(t.precision)}</p>` : ''}
      ${t.urls.length ? `<div class="liens">${t.urls.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">▶ Vidéo ${i + 1}</a>`).join('')}</div>` : ''}
      <div class="actions">
        <button class="${e.fait ? 'on' : ''}" data-e="fait">✓ Fait</button><button class="${e.utile ? 'on' : ''}" data-e="utile">👍 Utile</button>
        <button class="${e.faux ? 'on' : ''}" data-e="faux">✗ Faux</button><button class="${e.masque ? 'on' : ''}" data-e="masque">🙈 Masquer</button>
        <button class="${e.note ? 'on' : ''}" data-e="note">✎ Note</button></div>
      <textarea class="note" placeholder="Ma note perso…" ${e.note ? '' : 'hidden'}>${esc(e.note || '')}</textarea>
    </article>`;
  };
  const tri = (a, b) => (b.verifie - a.verifie) || (b.nb_sources - a.nb_sources);
  const visibles = lieu.tips.filter(t => vis.has(t.id)).sort(tri), autres = lieu.tips.filter(t => !vis.has(t.id)).sort(tri);
  // ne pas tout redessiner si rien n'a changé (garde le défilement, la note en cours…)
  const sig = lieu.id + '|' + visibles.map(t => t.id).join(',');
  if (!tipId && box.dataset.sig === sig) return;
  const feuille = $('#feuille'), defil = feuille.scrollTop;
  const cible = tipId || box.querySelector('.cible')?.dataset.tip, autresOuvert = box.querySelector('details.autres')?.open;
  const notesOuvertes = new Set($$('textarea.note:not([hidden])', box).map(t => t.closest('[data-tip]').dataset.tip));
  box.dataset.sig = sig;
  box.innerHTML = `
    <div class="f-tete"><span class="tp mini" style="--c:${esc(s.couleur)}"><span>${esc(s.icone)}</span></span>
      <div class="f-titre"><h3>${esc(lieu.lieu)}</h3><small>${esc(ty.icone)} ${esc(ty.nom)} · ${esc(posTexte(lieu.x, lieu.y).replace(/^.*? · case /, 'case '))} · ${lieu.tips.length} tip${lieu.tips.length > 1 ? 's' : ''}${lieu.rayon ? ' · rayon ' + lieu.rayon : ''}</small></div>
      <button class="ico" data-a="fermer" aria-label="Fermer">✕</button></div>
    <div class="f-outils"><button class="btn petit" data-a="centrer">🎯 Centrer</button><button class="btn petit" data-a="copier">📋 ${esc(posCopie(lieu.x, lieu.y).replace(', ', ' · '))}</button></div>
    ${visibles.map(carteTip).join('')}
    ${autres.length ? `<details class="autres"><summary>${autres.length} autre(s) tip(s) masqué(s) par les filtres</summary>${autres.map(carteTip).join('')}</details>` : ''}`;
  if (autresOuvert) { const d = box.querySelector('details.autres'); if (d) d.open = true; }
  for (const id of notesOuvertes) { const t = box.querySelector(`[data-tip="${CSS.escape(id)}"] textarea.note`); if (t) t.hidden = false; }
  if (cible) {
    const a = box.querySelector(`[data-tip="${CSS.escape(cible)}"]`);
    if (a) { a.classList.add('cible'); if (tipId) { const d = a.closest('details'); if (d) d.open = true; setTimeout(() => a.scrollIntoView({ block: 'center' }), 50); } }
  }
  if (!tipId) feuille.scrollTop = defil;
}

/* =================================================================== panneau latéral */
const panneauOuvert = () => !$('#panneau').hidden;
function basculerPanneau(ouvrir = !panneauOuvert()) {
  $('#panneau').hidden = !ouvrir; document.body.classList.toggle('pan-ouvert', ouvrir); E.r.panneau.ouvert = ouvrir; sauverReglages();
  E.map.invalidateSize({ pan: false }); majRail();
  if (ouvrir) rendrePanneau();
}
function installerPanneau() {
  $('#pan-fermer').onclick = () => basculerPanneau(false);
  $$('#onglets button').forEach(b => b.onclick = () => { E.r.panneau.onglet = b.dataset.o; sauverReglages(); rendrePanneau(); });
  const q = $('#recherche'); q.value = E.r.filtres.texte;
  q.oninput = () => { E.r.filtres.texte = q.value; sauverReglages(); appliquerFiltresDiff(); };
  $('#reset-filtres').onclick = () => {
    const c = E.r.filtres.calques; E.r.filtres = { ...filtresParDefaut(), calques: c }; q.value = '';
    sauverReglages(); appliquerFiltres(); toast('Filtres réinitialisés');
  };
  $('#compteur').onclick = () => { E.r.panneau.onglet = 'filtres'; basculerPanneau(true); };
}
function rendrePanneau() {
  if (!panneauOuvert()) return;
  const o = E.r.panneau.onglet;
  $$('#onglets button').forEach(b => b.classList.toggle('on', b.dataset.o === o));
  $('#resume').innerHTML = E.carte.tips && E.tips.charge ? `<b>${E.nLieux}</b> lieux / <b>${E.nTips}</b> tips affichés` : (E.carte.tips ? 'Tips non chargés' : 'Pas de tips sur cette carte');
  $('#reset-filtres').disabled = !filtresActifs();
  if (o === 'filtres') rendreFiltres(); else if (o === 'liste') rendreListe(); else rendreLegende();
}

function rendreLegende() {
  const corps = $('#pan-corps'), f = E.r.filtres;
  let h = '';
  if (E.carte.tips && E.tips.charge) {
    const { cats, types } = compteurs(E.baseLieux || [], f, E.etats);
    const lc = [...cats.keys()].sort((a, b) => styleCat(a).nom.localeCompare(styleCat(b).nom, 'fr'));
    h += `<details open><summary>Tips — catégories <span class="gris">(${lc.length})</span></summary>
      <div class="rangee petite"><button class="btn petit" data-tout="cat">Tout</button><button class="btn petit" data-aucun="cat">Aucun</button></div>
      ${lc.map(c => { const s = styleCat(c), on = !f.cats_masquees.includes(c); return `<label class="leg${on ? '' : ' off'}"><input type="checkbox" data-cat="${esc(c)}" ${on ? 'checked' : ''}><span class="sw" style="--c:${esc(s.couleur)}">${esc(s.icone)}</span><span class="nom">${esc(s.nom)}</span><span class="n">${cats.get(c)}</span></label>`; }).join('') || '<p class="gris">Aucune catégorie dans les données.</p>'}
    </details>
    <details ${f.types_masques.length ? 'open' : ''}><summary>Types de lieu</summary>
      ${TYPES_LIEU.filter(t => types.has(t)).map(t => { const s = styleType(t), on = !f.types_masques.includes(t); return `<label class="leg${on ? '' : ' off'}"><input type="checkbox" data-type="${t}" ${on ? 'checked' : ''}><span class="sw neutre">${esc(s.icone)}</span><span class="nom">${esc(s.nom)}</span><span class="n">${types.get(t)}</span></label>`; }).join('')}
    </details>
    <details><summary>Repères des marqueurs de tips</summary><div class="aide">
      <p><span class="tp mini demo" style="--c:#4cc9f0"><span>🚗</span><b>3</b></span> icône = catégorie dominante, pastille = nombre de tips visibles</p>
      <p><span class="tp mini demo v" style="--c:#4cc9f0"><span>🚗</span></span> bord vert = au moins un tip vérifié en jeu</p>
      <p><span class="tp mini demo f" style="--c:#4cc9f0"><span>🚗</span></span> estompé = tous les tips faits</p>
      <p>⭕ anneau = zone (rayon) du lieu · gros cercle = regroupement, touche pour zoomer</p></div></details>`;
  } else {
    h += `<p class="gris pad">${E.carte.tips ? (E.tips.erreur ? '⚠️ ' + esc(E.tips.erreur) : 'Chargement des tips…') : 'Cette carte n\'affiche pas les tips (« tips »: false dans maps.json).'}</p>`;
  }
  const n = new Map(); for (const m of E.rec.markers) n.set(m.cat, (n.get(m.cat) || 0) + 1);
  h += `<details open><summary>Mes marqueurs <span class="gris">(${E.rec.markers.length})</span></summary>
    <p class="aide">Case = afficher/masquer · ＋ = poser ce type de marqueur</p>
    ${E.styles.perso.map(c => { const on = !E.rec.hidden_cats.includes(c.id); return `<div class="leg${on ? '' : ' off'}${E.r.catPerso === c.id && E.r.outil === 'mark' ? ' actif' : ''}"><input type="checkbox" data-perso="${esc(c.id)}" ${on ? 'checked' : ''}><span class="sw" style="--c:${esc(c.couleur)}">${esc(c.icone)}</span><span class="nom">${esc(c.nom)}</span><span class="n">${n.get(c.id) || 0}</span><button class="ico petit" data-poser="${esc(c.id)}" aria-label="Poser">＋</button></div>`; }).join('')}
  </details>`;
  corps.innerHTML = h;
  corps.onchange = ev => {
    const i = ev.target;
    if (i.dataset.cat != null) { tog(f.cats_masquees, i.dataset.cat, !i.checked); }
    else if (i.dataset.type != null) { tog(f.types_masques, i.dataset.type, !i.checked); }
    else if (i.dataset.perso != null) { tog(E.rec.hidden_cats, i.dataset.perso, !i.checked); sauverAnnot(); rendrePerso(); rendreLegende(); return; }
    sauverReglages(); appliquerFiltres();
  };
  corps.onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.poser) { E.r.catPerso = b.dataset.poser; choisirOutil('mark'); toast('Touche la carte pour poser « ' + catPerso(b.dataset.poser).nom + ' »'); rendreLegende(); }
    else if (b.dataset.tout === 'cat') { f.cats_masquees = []; sauverReglages(); appliquerFiltres(); }
    else if (b.dataset.aucun === 'cat') { f.cats_masquees = [...new Set(E.tips.lieux.flatMap(l => l.tips.map(t => t.categorie)))]; sauverReglages(); appliquerFiltres(); }
  };
}
const tog = (arr, v, mettre) => { const i = arr.indexOf(v); if (mettre && i < 0) arr.push(v); if (!mettre && i >= 0) arr.splice(i, 1); };

function rendreFiltres() {
  const corps = $('#pan-corps'), f = E.r.filtres, T = E.tips;
  const maxS = Math.max(10, ...E.tips.lieux.flatMap(l => l.tips.map(t => t.nb_sources)));
  const calque = (k, nom) => `<label class="inter"><span>${nom}</span><input type="checkbox" class="bascule" data-calque="${k}" ${f.calques[k] ? 'checked' : ''}></label>`;
  let etatDonnees;
  if (T.charge) {
    const s = T.stats;
    etatDonnees = `<p><b>${s.lieux}</b> lieux · <b>${s.tips}</b> tips dans le fichier.</p>
      <p>Données ${T.meta.genere_le ? 'générées le <b>' + fmtDate(T.meta.genere_le) + '</b>' : (T.modifie ? 'modifiées le <b>' + fmtDate(T.modifie) + '</b>' : '')}<br>Récupérées le ${fmtDate(T.recu)} ${T.cache ? '<span class="badge alerte">copie hors ligne</span>' : '<span class="badge ok">réseau</span>'}</p>
      ${s.lieux_invalides || s.tips_invalides || s.avertissements ? `<details><summary>${s.lieux_invalides} lieu(x) et ${s.tips_invalides} tip(s) ignorés, ${s.avertissements} avertissement(s)</summary><ul class="petit">${s.details.map(d => `<li>${esc(d)}</li>`).join('')}</ul></details>` : '<p class="gris">Aucune entrée invalide.</p>'}`;
  } else etatDonnees = `<p>${T.erreur ? '⚠️ ' + esc(T.erreur) : 'Chargement…'}</p>`;
  if (T.erreur && T.charge) etatDonnees += `<p class="alerte-txt">Dernière actualisation échouée : ${esc(T.erreur)}</p>`;
  corps.innerHTML = `
    <section><h4>Calques</h4>${calque('tips', '💡 Tips')}${E.regions ? calque('comtes', '🗺️ Comtés') : ''}${calque('marqueurs', '📍 Mes marqueurs')}${calque('dessins', '✏️ Mes dessins')}${calque('grille', '#️⃣ Grille / repères' + (E.X ? ' (X / Y)' : ''))}</section>
    ${E.regions ? `<section><h4>Comtés</h4><p class="petit gris">Visibles sur la carte entière, ils s'effacent quand tu zoomes ; le comté où tu es s'affiche alors en bas.</p><div class="puces">${E.regions.regions.map(r => `<button class="puce comte" data-comte="${esc(r.id)}" style="--c:${esc(r.couleur)}"><span class="pastille"></span>${esc(r.nom)}</button>`).join('')}</div></section>` : ''}
    <section><h4>Tips</h4>
      <label class="inter"><span>✅ Vérifiés en jeu uniquement</span><input type="checkbox" class="bascule" id="f-verif" ${f.verifies_seul ? 'checked' : ''}></label>
      <label class="curseur"><span>Sources minimum : <b id="f-min-v">${f.min_sources}</b></span><input type="range" id="f-min" min="0" max="${maxS}" step="1" value="${Math.min(f.min_sources, maxS)}"></label>
      <div class="f-lab">État perso</div>
      <div class="puces">${[['a_faire', '⬜ À faire'], ['fait', '✓ Fait'], ['masque', '🙈 Masqué']].map(([k, n]) => `<button class="puce${f.etats[k] ? ' on' : ''}" data-etat="${k}">${n}</button>`).join('')}</div>
    </section>
    <section><h4>Données des tips</h4>${etatDonnees}<button class="btn" id="f-actu">🔄 Actualiser les tips</button></section>`;
  corps.onchange = ev => {
    const i = ev.target;
    if (i.dataset.calque) { f.calques[i.dataset.calque] = i.checked; sauverReglages(); if (i.dataset.calque === 'marqueurs') rendrePerso(); if (i.dataset.calque === 'dessins' || i.dataset.calque === 'grille') { E.couche._reset(); majCoords(); } if (i.dataset.calque === 'comtes') majZones(E.map.getZoom()); appliquerFiltres(); }
    else if (i.id === 'f-verif') { f.verifies_seul = i.checked; sauverReglages(); appliquerFiltres(); }
  };
  $('#f-min', corps).oninput = ev => { f.min_sources = +ev.target.value; $('#f-min-v').textContent = f.min_sources; sauverReglages(); appliquerFiltresDiff(); };
  corps.onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.etat) { f.etats[b.dataset.etat] = !f.etats[b.dataset.etat]; sauverReglages(); appliquerFiltres(); }
    else if (b.id === 'f-actu') chargerTips(true);
    else if (b.dataset.comte) allerComte(b.dataset.comte);
  };
}

function rendreListe() {
  const corps = $('#pan-corps'), mode = E.r.liste;
  const b = E.map.getBounds();
  let h = `<div class="seg"><button data-l="tips" class="${mode === 'tips' ? 'on' : ''}">Tips</button><button data-l="perso" class="${mode === 'perso' ? 'on' : ''}">Mes marqueurs</button></div>`;
  if (mode === 'tips') {
    const lignes = [];
    for (const { lieu, tips } of (E.r.filtres.calques.tips ? E.visibles : [])) {
      if (!b.contains(E.P.versLatLng(lieu.x, lieu.y))) continue;
      for (const t of tips) lignes.push({ tip: t, lieu });
    }
    const c = E.map.getCenter(), centre = E.P.depuisLatLng(c);
    const tri = trierLignes(lignes, E.r.tri, centre, E.P.distancePx);
    h += `<div class="rangee petite"><label class="tri">Trier : <select id="l-tri">${Object.entries(TRIS).map(([k, n]) => `<option value="${k}" ${k === E.r.tri ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
      <p class="gris petit">${tri.length} tip(s) dans la zone visible${tri.length > 250 ? ' (250 premiers affichés)' : ''}</p>
      ${tri.slice(0, 250).map(({ tip, lieu }) => { const s = styleCat(tip.categorie), e = E.etats.get(tip.id) || {}; return `<div class="ligne${e.fait ? ' fait' : ''}${e.masque ? ' masque' : ''}" data-l="${esc(lieu.id)}" data-t="${esc(tip.id)}"><span class="sw" style="--c:${esc(s.couleur)}">${esc(s.icone)}</span><div><b>${esc(tip.enonce)}</b><small>${esc(lieu.lieu)} · 👥 ${tip.nb_sources}${tip.verifie ? ' · ✅' : ''}${e.fait ? ' · fait' : ''}</small></div></div>`; }).join('') || '<p class="gris pad">Aucun tip visible ici. Dézoome ou change les filtres.</p>'}`;
  } else {
    const q = normTexte(E.r.filtres.texte.trim());
    const ms = E.rec.markers.filter(m => !q || normTexte(m.label + ' ' + m.note).includes(q)).sort((a, b) => (a.label || '~').localeCompare(b.label || '~', 'fr'));
    h += `<p class="gris petit">${ms.length} marqueur(s) sur cette carte${q ? ' (recherche)' : ''}</p>
      ${ms.map(m => { const c = catPerso(m.cat); return `<div class="ligne${m.done ? ' fait' : ''}" data-m="${esc(m.id)}"><span class="sw" style="--c:${esc(m.color || c.couleur)}">${esc(c.icone)}</span><div><b>${esc(m.label || '(sans titre)')}</b><small>${esc(c.nom)}${m.note ? ' · ' + esc(m.note.slice(0, 60)) : ''}</small></div></div>`; }).join('') || '<p class="gris pad">Aucun marqueur. Outil 📍 puis touche la carte.</p>'}`;
  }
  corps.innerHTML = h;
  corps.onclick = ev => {
    const s = ev.target.closest('.seg button'); if (s) { E.r.liste = s.dataset.l; sauverReglages(); rendreListe(); return; }
    const l = ev.target.closest('.ligne'); if (!l) return;
    if (l.dataset.m) { const m = E.rec.markers.find(x => x.id === l.dataset.m); if (m) { E.map.setView(E.P.versLatLng(m.x, m.y), Math.max(E.map.getZoom(), E.P.zn - 1)); ouvrirEditeur(m); } return; }
    const v = E.visibles.find(x => x.lieu.id === l.dataset.l); if (!v) return;
    E.map.setView(E.P.versLatLng(v.lieu.x, v.lieu.y), Math.max(E.map.getZoom(), E.P.zn - 1));
    ouvrirFiche(v.lieu, l.dataset.t);
  };
  const sel = $('#l-tri', corps); if (sel) sel.onchange = () => { E.r.tri = sel.value; sauverReglages(); rendreListe(); };
}

/* =================================================================== rail d'outils */
function construireRail() {
  const r = $('#rail');
  r.innerHTML = `
    <button class="rb" id="rb-cartes" title="Cartes">🗺️<small id="rb-carte-nom"></small></button>
    <div class="sep"></div>
    ${OUTILS.map(([id, ic, t]) => `<button class="rb" data-outil="${id}" title="${t}" aria-label="${t}">${ic}</button>`).join('')}
    <button class="rb" id="rb-couleur" title="Couleur et épaisseur"><span class="rond"></span></button>
    <div class="sep"></div>
    <button class="rb" id="rb-annuler" title="Annuler">↩️</button>
    <button class="rb" id="rb-refaire" title="Rétablir">↪️</button>
    <button class="rb" id="rb-stylet" title="Stylet seul / doigt aussi"></button>
    <div class="sep"></div>
    <button class="rb" id="rb-panneau" title="Légende, filtres, liste">🗂️</button>
    <button class="rb" id="rb-menu" title="Menu">☰</button>`;
  r.onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.outil) { if (b.dataset.outil === E.r.outil && ['pen', 'hl', 'line'].includes(b.dataset.outil)) ouvrirPalette(); else choisirOutil(b.dataset.outil); }
    else if (b.id === 'rb-couleur') ouvrirPalette();
    else if (b.id === 'rb-annuler') annuler();
    else if (b.id === 'rb-refaire') refaire();
    else if (b.id === 'rb-stylet') { E.r.styletSeul = !E.r.styletSeul; sauverReglages(); majRail(); toast(E.r.styletSeul ? 'Stylet seul : le doigt déplace / zoome, le stylet dessine' : 'Doigt aussi : un doigt dessine (2 doigts = zoom après avoir levé)'); }
    else if (b.id === 'rb-panneau') basculerPanneau();
    else if (b.id === 'rb-menu') ouvrirMenu();
    else if (b.id === 'rb-cartes') ouvrirCartes();
  };
}
function choisirOutil(o) {
  E.r.outil = o; sauverReglages(); majRail(); rendrePerso();
  if (o === 'mark') toast('Touche la carte pour poser « ' + catPerso(E.r.catPerso).nom + ' » (glisser un marqueur pour le déplacer)');
  if (panneauOuvert() && E.r.panneau.onglet === 'legende') rendreLegende();
}
function majRail() {
  if (!E.r) return;
  $$('#rail [data-outil]').forEach(b => b.classList.toggle('on', b.dataset.outil === E.r.outil));
  const mk = $('#rail [data-outil="mark"]'); if (mk) mk.textContent = E.r.outil === 'mark' ? catPerso(E.r.catPerso).icone : '📍';
  const rc = $('#rb-couleur .rond'); if (rc) { rc.style.background = E.r.couleur; rc.style.width = rc.style.height = (10 + E.r.epaisseur) + 'px'; }
  $('#rb-annuler').disabled = !E.annuler.length || E.verrou; $('#rb-refaire').disabled = !E.refaire.length || E.verrou;
  $('#rb-stylet').innerHTML = E.r.styletSeul ? '🖊️<small>stylet</small>' : '☝️<small>doigt</small>';
  $('#rb-stylet').classList.toggle('on', E.r.styletSeul);
  $('#rb-panneau').classList.toggle('on', panneauOuvert());
  if (E.carte) $('#rb-carte-nom').textContent = E.carte.nom.slice(0, 9);
  document.body.dataset.outil = E.r.outil;
}
function ouvrirPalette() {
  const b = ouvrirModal(`<h3>Couleur et épaisseur</h3>
    <div class="puces grandes">${COULEURS.map(c => `<button class="pastille grande${c === E.r.couleur ? ' on' : ''}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>
    <label class="curseur"><span>Épaisseur : <b id="ep-v">${E.r.epaisseur}</b> px</span><input type="range" id="ep" min="1" max="24" value="${E.r.epaisseur}"></label>
    <div class="apercu"><span id="ep-ap"></span></div>
    <button class="btn bleu" data-a="ok">OK</button>`, 'petit');
  const ap = () => { const s = $('#ep-ap', b); s.style.background = E.r.couleur; s.style.height = E.r.epaisseur + 'px'; };
  ap();
  b.onclick = e => {
    const c = e.target.closest('[data-c]');
    if (c) { E.r.couleur = c.dataset.c; $$('[data-c]', b).forEach(x => x.classList.toggle('on', x === c)); if (!['pen', 'hl', 'line'].includes(E.r.outil)) E.r.outil = 'pen'; sauverReglages(); majRail(); ap(); }
    if (e.target.closest('[data-a="ok"]')) fermerModal();
  };
  $('#ep', b).oninput = e => { E.r.epaisseur = +e.target.value; $('#ep-v', b).textContent = E.r.epaisseur; sauverReglages(); majRail(); ap(); };
}

/* =================================================================== cartes */
function ouvrirCartes() {
  const b = ouvrirModal(`<h3>Cartes</h3><div id="liste-cartes">${E.cartes.map(c => `
    <div class="ligne-carte${c.id === E.carte.id ? ' on' : ''}" data-id="${esc(c.id)}">
      <span class="ic">${c.type === 'tuiles' ? '🧩' : c.type === 'grille' ? '#️⃣' : c.importee ? '🖼️' : '🗺️'}</span>
      <div><b>${esc(c.nom)}</b><small>${esc(c.type)} · ${c.largeur_px}×${c.hauteur_px} · version ${esc(c.version)}${c.tips ? ' · tips' : ''}</small></div>
      ${c.importee ? `<button class="ico" data-suppr="${esc(c.id)}" aria-label="Supprimer">🗑️</button>` : ''}</div>`).join('')}</div>
    <label class="btn" for="fichier-carte">＋ Importer une image de carte</label>
    <p class="aide">Pour la carte définitive, utilise plutôt <b>maps.json</b> (voir README).</p>
    <button class="btn" data-a="fermer">Fermer</button>`);
  b.onclick = async e => {
    const s = e.target.closest('[data-suppr]');
    if (s) { e.stopPropagation(); if (confirm('Supprimer cette carte importée et ses annotations ? (une sauvegarde automatique est faite avant)')) { await S.supprimerCarteImportee(s.dataset.suppr); E.cartes = E.cartes.filter(c => c.id !== s.dataset.suppr); if (E.carte.id === s.dataset.suppr) { E.rec = null; await ouvrirCarte(E.cartes[0].id); } ouvrirCartes(); } return; }
    const l = e.target.closest('.ligne-carte'); if (l) { fermerModal(); if (l.dataset.id !== E.carte.id) await ouvrirCarte(l.dataset.id); return; }
    if (e.target.closest('[data-a="fermer"]')) fermerModal();
  };
}
$('#fichier-carte').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (!S.base) { toast('Stockage indisponible'); return; }
  try {
    const cfg = await S.ajouterCarteImportee(f, f.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Ma carte');
    E.cartes.push(cfg); fermerModal(); await ouvrirCarte(cfg.id); toast('Carte ajoutée');
  } catch (er) { toast('Import impossible : ' + er.message, 4000); }
};

/* =================================================================== menu */
async function ouvrirMenu() {
  const st = S.base ? await S.etatStockage() : {};
  const derniere = S.base ? await S.meta.get('derniere_export') : null;
  const b = ouvrirModal(`<h3>Menu</h3>
    <button class="btn" data-a="cartes">🗺️ Cartes…</button>
    <button class="btn" data-a="actu">🔄 Actualiser les tips</button>
    <button class="btn" data-a="recentrer">🎯 Recentrer la carte</button>
    <button class="btn" data-a="png">📷 Exporter en image (PNG)</button>
    <button class="btn bleu" data-a="json">💾 Sauvegarder tout (.json)</button>
    <label class="btn" for="fichier-json">📂 Restaurer une sauvegarde…</label>
    <button class="btn" data-a="auto">🗃️ Sauvegardes automatiques…</button>
    <button class="btn" data-a="horsligne">📥 Rendre cette carte dispo hors ligne</button>
    <button class="btn" data-a="effacer">🧹 Effacer tous les dessins de cette carte</button>
    <div class="rangee"><button class="btn" data-a="main">${E.r.gaucher ? '✋ Mode droitier' : '🤚 Mode gaucher'}</button><button class="btn" data-a="theme">${E.r.theme === 'sombre' ? '☀️ Thème clair' : '🌙 Thème sombre'}</button></div>
    <div class="info-stock">💽 Stockage : ${fmtMo(st.utilise)} / ${fmtMo(st.quota)} · ${st.persistant ? '<span class="badge ok">persistant</span>' : '<span class="badge alerte">non persistant</span>'}<br>Dernier export : ${derniere ? fmtDate(derniere) : '<b>jamais</b>'}</div>
    <details><summary>Avancé</summary>
      <button class="btn" data-a="recup">♻️ Récupérer les données de l'ancienne version</button>
      <button class="btn" data-a="maj">⬆️ Forcer la mise à jour de l'appli</button>
      <p class="aide">Version du cache : ${esc(E.swVersion || 'service worker inactif')}</p>
    </details>
    <button class="btn" data-a="fermer">Fermer</button>`);
  b.onclick = async e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'fermer') fermerModal();
    else if (a === 'cartes') ouvrirCartes();
    else if (a === 'actu') { fermerModal(); chargerTips(true); }
    else if (a === 'recentrer') { fermerModal(); E.map.fitBounds(L.latLngBounds(E.P.limites()), { padding: [10, 10] }); }
    else if (a === 'png') { fermerModal(); exporterPNG(); }
    else if (a === 'json') { fermerModal(); exporterJSON(); }
    else if (a === 'auto') ouvrirSauvegardes();
    else if (a === 'horsligne') { fermerModal(); horsLigne(); }
    else if (a === 'effacer') { fermerModal(); if (E.verrou) return toast('Annotations verrouillées'); if (E.rec.strokes.length && confirm(`Effacer les ${E.rec.strokes.length} dessins de cette carte ? (annulable avec ↩️)`)) { instantane(); E.rec.strokes = []; sauverAnnot(); E.couche._reset(); } }
    else if (a === 'main') { E.r.gaucher = !E.r.gaucher; sauverReglages(); appliquerTheme(); fermerModal(); setTimeout(() => E.map.invalidateSize(), 50); }
    else if (a === 'theme') { E.r.theme = E.r.theme === 'sombre' ? 'clair' : 'sombre'; sauverReglages(); appliquerTheme(); fermerModal(); }
    else if (a === 'recup') { fermerModal(); recupererV1(); }
    else if (a === 'maj') forcerMiseAJour();
  };
}
function appliquerTheme() {
  document.body.classList.toggle('gaucher', !!E.r.gaucher);
  document.body.classList.toggle('clair', E.r.theme === 'clair');
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = E.r.theme === 'clair' ? '#eef1f5' : '#111418';
}

/* =================================================================== export / import */
async function exporterJSON() {
  if (!S.base) return toast('Stockage indisponible');
  sauverAnnot.maintenant(); await new Promise(r => setTimeout(r, 50));
  await S.meta.set('reglages', E.r);
  const d = await S.exportComplet(true);
  telecharger(new Blob([JSON.stringify(d)], { type: 'application/json' }), `carte-gta6-sauvegarde-${horodatage()}.json`);
  await S.meta.set('derniere_export', new Date().toISOString());
  fermerBandeau('persist');
  toast('Sauvegarde exportée (toutes les cartes)');
}
$('#fichier-json').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; fermerModal(); if (!f) return;
  if (!S.base) return toast('Stockage indisponible');
  try {
    const json = JSON.parse(await f.text());
    if (!confirm('Restaurer ce fichier ? Les annotations des cartes qu\'il contient remplaceront les actuelles (une sauvegarde automatique est faite avant).')) return;
    sauverAnnot.maintenant();
    const r = await S.importerSauvegarde(json, id => {
      const c = E.cartes.find(x => x.id === id);
      return c ? { W: c.largeur_px, H: c.hauteur_px, version: c.version } : null;
    });
    E.cartes = E.cartes.filter(c => !c.importee).concat(await S.cartesImportees());
    E.etats = await S.lireEtatsTips();
    const rg = await S.meta.get('reglages'); if (rg) { E.r = normaliserReglages(rg); appliquerTheme(); $('#recherche').value = E.r.filtres.texte; }
    E.rec = null;
    await ouvrirCarte(E.cartes.some(c => c.id === r.carte) ? r.carte : E.carte.id);
    toast(r.texte, 4500);
  } catch (er) { console.error(er); toast('Fichier invalide : ' + er.message, 5000); }
};
async function ouvrirSauvegardes() {
  const l = await S.listeSauvegardes();
  const noms = { 'migration-v1-ancien-format': '🧳 Ancien format (avant migration)', quotidienne: '📅 Quotidienne', 'avant-import': '📂 Avant restauration', 'avant-suppression-carte': '🗑️ Avant suppression de carte', 'avant-recuperation-v1': '♻️ Avant récupération v1' };
  const b = ouvrirModal(`<h3>Sauvegardes automatiques</h3><p class="aide">Conservées sur cet appareil (les ${12} dernières + l'ancien format). Télécharge-les pour les garder ailleurs.</p>
    ${l.map(s => `<div class="ligne-carte"><div><b>${esc(noms[s.type] || s.type)}</b><small>${fmtDate(s.cree)}</small></div><button class="btn petit" data-dl="${esc(s.id)}">Télécharger</button></div>`).join('') || '<p class="gris">Aucune pour l\'instant.</p>'}
    <button class="btn" data-a="fermer">Fermer</button>`);
  b.onclick = async e => {
    if (e.target.closest('[data-a="fermer"]')) return fermerModal();
    const d = e.target.closest('[data-dl]'); if (!d) return;
    const s = l.find(x => x.id === d.dataset.dl); if (!s) return;
    let donnees = s.donnees;
    if (donnees && donnees.format === 'gta-map-v1-brut') { // les Blobs (images) -> data URL
      const kv = {};
      for (const [k, v] of Object.entries(donnees.kv)) kv[k] = v instanceof Blob ? await S.blobVersDataURL(v) : v;
      donnees = { ...donnees, kv };
    }
    telecharger(new Blob([JSON.stringify(donnees)], { type: 'application/json' }), `carte-gta6-${s.type}-${s.cree.slice(0, 16).replace(/[:T]/g, '-')}.json`);
  };
}
async function recupererV1() {
  if (!S.base) return;
  if (!confirm('Relire la base de l\'ancienne version de l\'appli (sur ce même site) et ajouter ce qui manque ? Une sauvegarde automatique est faite avant.')) return;
  sauverAnnot.maintenant();
  const r = await S.migrerDepuisV1(E.cartes.filter(c => !c.importee), true);
  if (!r) return toast('Aucune donnée de l\'ancienne version sur ce site', 4000);
  E.cartes = E.cartes.filter(c => !c.importee).concat(await S.cartesImportees());
  E.rec = null; await ouvrirCarte(E.carte.id);
  montrerRapportMigration(r);
}
function montrerRapportMigration(r) {
  const tot = r.cartes.reduce((a, c) => [a[0] + c.marqueurs, a[1] + c.traits], [0, 0]);
  const b = ouvrirModal(`<h3>✅ Anciennes annotations migrées</h3>
    <p>${tot[0]} marqueur(s) et ${tot[1]} dessin(s) convertis au nouveau format :</p>
    <ul>${r.cartes.map(c => `<li><b>${esc((E.cartes.find(x => x.id === c.id) || { nom: c.id }).nom)}</b> : ${c.marqueurs} marqueur(s), ${c.traits} trait(s)${c.ignores ? `, ${c.ignores} entrée(s) illisible(s)` : ''}</li>`).join('')}</ul>
    ${r.erreurs.length ? `<p class="alerte-txt">${r.erreurs.map(esc).join('<br>')}</p>` : ''}
    <p class="aide">L'ancien format est conservé intact (base « gta-map » + copie dans les sauvegardes automatiques).</p>
    <button class="btn" data-a="dl">🧳 Télécharger la copie de l'ancien format</button>
    <button class="btn bleu" data-a="ok">OK</button>`);
  b.onclick = async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'ok') fermerModal();
    if (a === 'dl') { await ouvrirSauvegardes(); }
  };
}

/* =================================================================== export PNG */
function chargerImg(u) { return new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = u; }); }
async function exporterPNG() {
  const cfg = E.carte, P = E.P, MAX = 4096;
  toast('Préparation de l\'image…', 8000);
  const sc = Math.min(1, MAX / Math.max(P.W, P.H));
  const Wc = Math.round(P.W * sc), Hc = Math.round(P.H * sc);
  const c = document.createElement('canvas'); c.width = Wc; c.height = Hc;
  const g = c.getContext('2d'); g.fillStyle = '#16202b'; g.fillRect(0, 0, Wc, Hc);
  if (cfg.type === 'image' && !E.fondManquant) {
    const i = await chargerImg(E.urlBlob || cfg.chemin); if (i) g.drawImage(i, 0, 0, Wc, Hc);
  } else if (cfg.type === 'tuiles' && !E.fondManquant) {
    const z = Math.max(0, Math.min(P.zn, P.zn - Math.ceil(Math.log2(Math.max(P.W, P.H) / MAX))));
    const f = 2 ** (P.zn - z), w = Math.ceil(P.W / f), h = Math.ceil(P.H / f), k = Wc / w;
    const jobs = [];
    for (let x = 0; x < Math.ceil(w / 256); x++) for (let y = 0; y < Math.ceil(h / 256); y++) {
      const u = cfg.chemin + (cfg.tuiles || '{z}/{x}/{y}.webp').replace('{z}', z).replace('{x}', x).replace('{y}', y);
      jobs.push(chargerImg(u).then(i => { if (i) g.drawImage(i, x * 256 * k, y * 256 * k, 256 * k, 256 * k); }));
    }
    await Promise.all(jobs);
  }
  if (cfg.type === 'grille' || E.fondManquant || E.r.filtres.calques.grille) dessinerGrille(g, { x: 0, y: 0 }, Wc, Hc, 1, Wc, Hc, cfg.type === 'grille' || E.fondManquant, E.G);
  const voir = !E.verrou || E.verrouVoir;
  if (voir && E.r.filtres.calques.dessins) { g.setTransform(sc, 0, 0, sc, 0, 0); for (const s of E.rec.strokes) tracer(g, s, P.W, P.H); g.setTransform(1, 0, 0, 1, 0, 0); }
  if (voir && E.r.filtres.calques.marqueurs) {
    const k = Math.max(1, Wc / 1600);
    for (const m of E.rec.markers) {
      if (E.rec.hidden_cats.includes(m.cat)) continue;
      const cp = catPerso(m.cat), x = m.x * Wc, y = m.y * Hc, R = 15 * k;
      g.globalAlpha = m.done ? 0.5 : 1; g.fillStyle = m.color || cp.couleur; g.strokeStyle = '#000'; g.lineWidth = 2 * k;
      g.beginPath(); g.arc(x, y - R * 1.2, R, 0, 7); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(x - R * 0.55, y - R * 0.45); g.lineTo(x, y); g.lineTo(x + R * 0.55, y - R * 0.45); g.fill();
      g.font = Math.round(R * 1.1) + 'px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#000'; g.fillText(m.done ? '✓' : cp.icone, x, y - R * 1.2);
      if (m.label) { g.font = '600 ' + Math.round(13 * k) + 'px system-ui'; g.textBaseline = 'top'; g.lineWidth = 4 * k; g.strokeText(m.label, x, y + 3 * k); g.fillStyle = '#fff'; g.fillText(m.label, x, y + 3 * k); }
      g.globalAlpha = 1;
    }
  }
  c.toBlob(b => { if (b) { telecharger(b, `carte-${cfg.id}-annotee-${horodatage()}.png`); toast('Image exportée'); } else toast('Export impossible (image trop grande ?)'); }, 'image/png');
}

/* =================================================================== hors ligne */
async function horsLigne() {
  const cfg = E.carte, P = E.P;
  if (!('caches' in window)) return toast('Cache indisponible sur ce navigateur');
  const urls = ['maps.json', 'styles.json', URL_TIPS];
  if (cfg.type === 'image' && cfg.chemin && !cfg.blob) urls.push(cfg.chemin);
  if (cfg.type === 'tuiles') {
    for (let z = 0; z <= P.zn; z++) {
      const f = 2 ** (P.zn - z), nx = Math.ceil(Math.ceil(P.W / f) / 256), ny = Math.ceil(Math.ceil(P.H / f) / 256);
      for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) urls.push(cfg.chemin + (cfg.tuiles || '{z}/{x}/{y}.webp').replace('{z}', z).replace('{x}', x).replace('{y}', y));
    }
  }
  const cache = await caches.open(CACHE_TUILES); let fait = 0, ko = 0, i = 0;
  const travail = async () => {
    while (i < urls.length) {
      const u = urls[i++];
      try {
        if (u.startsWith('maps/')) { if (!(await cache.match(u))) { const r = await fetch(u); if (r.ok) await cache.put(u, r); else ko++; } }
        else await fetch(u, { cache: 'no-store' }); // le service worker garde une copie
      } catch (e) { ko++; }
      fait++; if (fait % 25 === 0 || fait === urls.length) toast(`Téléchargement hors ligne : ${fait} / ${urls.length}`, 3000);
    }
  };
  await Promise.all(Array.from({ length: 6 }, travail));
  toast(ko ? `Terminé avec ${ko} erreur(s)` : `« ${cfg.nom} » disponible hors ligne (${urls.length} fichiers)`, 4500);
}

/* =================================================================== stockage : avertissements */
async function verifierStockage() {
  let st = await S.etatStockage();
  if (!st.persistant) { await S.demanderPersistance(); st = await S.etatStockage(); }
  if (st.quota && st.utilise / st.quota > 0.8) bandeau('quota', `⚠️ Stockage presque plein (${fmtMo(st.utilise)} / ${fmtMo(st.quota)}). Exporte une sauvegarde et supprime les cartes importées inutiles.`, [{ t: 'Sauvegarder', f: exporterJSON }], 'erreur');
  if (st.persistant === false) {
    const vu = await S.meta.get('avert_persist');
    if (!vu || Date.now() - new Date(vu).getTime() > 7 * 864e5) {
      bandeau('persist', '💾 Le navigateur peut effacer les données de l\'appli s\'il manque de place. Installe-la sur l\'écran d\'accueil et exporte régulièrement une sauvegarde.', [{ t: 'Sauvegarder maintenant', f: exporterJSON }], 'info');
      S.meta.set('avert_persist', new Date().toISOString());
    }
  }
  try { await S.sauvegardeQuotidienne(); } catch (e) { console.warn(e); }
}

/* =================================================================== coordonnées (calque grille) */
/** Position lisible : repère X/Y du jeu si la carte en a un (sinon x/y normalisés), case de grille, comté. */
function posTexte(x, y, { comte = true } = {}) {
  const r = comte && E.regions ? regionDe(E.regions, x, y, E.P.H / E.P.W) : null;
  const xy = E.X ? (([X, Y]) => `X ${Math.round(X)} · Y ${Math.round(Y)}`)(E.X.versXY(x, y)) : `x ${x.toFixed(4)} · y ${y.toFixed(4)}`;
  return `${xy} · case ${caseGrille(x, y, E.G)}${r ? ' · ' + r.nom : ''}`;
}
/** Texte copié : X, Y si repère jeu, sinon x, y normalisés. */
function posCopie(x, y) {
  if (!E.X) return `${x.toFixed(4)}, ${y.toFixed(4)}`;
  const [X, Y] = E.X.versXY(x, y); return `${Math.round(X)}, ${Math.round(Y)}`;
}
function majCoords() {
  const on = E.r && E.r.filtres.calques.grille;
  $('#reticule').hidden = !on; $('#coords').hidden = !on;
  if (!on || !E.P) return;
  const [x, y] = E.P.depuisLatLng(E.map.getCenter());
  $('#coords').textContent = 'centre : ' + posTexte(x, y);
}

/* =================================================================== comtés (zones sans contours) */
async function chargerRegions(cfg, bornes) {
  if (!cfg.regions) { rendreFiltresSiOuvert(); return; }
  try {
    const { json } = await lireJSON(cfg.regions);
    if (E.carte !== cfg || !Array.isArray(json.regions)) return;        // carte changée entre-temps
    E.regions = json;
    const dossier = cfg.regions.replace(/[^/]*$/, '');
    if (json.calque) {
      E.zones = L.imageOverlay(dossier + json.calque, bornes, { pane: 'zones', interactive: false, className: 'zones-comtes' });
      E.zones.on('load', () => majZones(E.map.getZoom()));
      E.zones.addTo(E.map);
      const el = E.zones.getElement(); if (el) el.style.opacity = 0;   // apparaît en fondu
    }
    majZones(E.map.getZoom()); majComte(); majCoords(); rendreFiltresSiOuvert();
  } catch (e) { console.warn('régions', e); }
}
function rendreFiltresSiOuvert() { if (panneauOuvert() && E.r.panneau.onglet === 'filtres') rendrePanneau(); }

/** Opacité des comtés selon le zoom : pleine sur la carte entière, fondu jusqu'à disparaître quand on s'approche. */
const OPA_ZONES = 0.42;
function opaciteZones(z) {
  const t = z - E.zFit;                       // 0 = carte entière
  return Math.max(0, Math.min(1, (2.1 - t) / 1.5)) * OPA_ZONES;
}
function majZones(z) {
  if (!E.zones) return;
  const el = E.zones.getElement(); if (!el) return;
  const on = E.r && E.r.filtres.calques.comtes !== false;
  const o = on ? opaciteZones(z) : 0;
  el.style.opacity = o.toFixed(3);
  el.classList.toggle('loin', o < 0.02);    // plus rien à peindre : on évite le coût du calque
  majComte(z);
}

/** Puce « comté courant » : prend le relais quand les aplats ont disparu (zoom rapproché). */
function majComte(z) {
  const el = $('#comte'); if (!el) return;
  const on = E.regions && E.map && E.r && E.r.filtres.calques.comtes !== false;
  const zoom = Number.isFinite(z) ? z : (E.map ? E.map.getZoom() : 0);
  let r = null;
  if (on && opaciteZones(zoom) < OPA_ZONES * 0.35) {
    const [x, y] = E.P.depuisLatLng(E.map.getCenter());
    r = regionDe(E.regions, x, y, E.P.H / E.P.W);
  }
  if (!r) { el.classList.remove('vu'); E.comte = null; return; }
  if (E.comte === r.id && el.classList.contains('vu')) return;
  const change = E.comte && E.comte !== r.id;
  E.comte = r.id;
  el.style.setProperty('--c', r.couleur || '#fff');
  el.innerHTML = `<span class="pastille"></span>${esc(r.nom)}`;
  el.classList.add('vu');
  if (change) { el.classList.remove('bascule'); void el.offsetWidth; el.classList.add('bascule'); }
}
function allerComte(id) {
  const r = E.regions && E.regions.regions.find(x => x.id === id); if (!r) return;
  E.map.flyTo(E.P.versLatLng(...r.etiquette), E.zFit + 1.6, { duration: 0.9 });
}

/* =================================================================== service worker */
function enregistrerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    const demanderVersion = () => {
      const sw = navigator.serviceWorker.controller; if (!sw) return;
      const ch = new MessageChannel(); ch.port1.onmessage = e => { E.swVersion = e.data; }; sw.postMessage('VERSION', [ch.port2]);
    };
    demanderVersion();
    const proposer = w => bandeau('maj', '⬆️ Nouvelle version de l\'appli disponible.', [{ t: 'Mettre à jour', f: () => { w.postMessage('SKIP_WAITING'); } }], 'info');
    if (reg.waiting && navigator.serviceWorker.controller) proposer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing; if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) proposer(w); });
    });
    let recharge = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (E.majDemandee && !recharge) { recharge = true; location.reload(); } demanderVersion(); });
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
  }).catch(e => console.warn('SW', e));
  // un clic sur « Mettre à jour » => rechargement quand le nouveau SW prend la main
  document.addEventListener('click', e => { if (e.target.closest('#bd-maj .btn')) E.majDemandee = true; }, true);
}
async function forcerMiseAJour() {
  if (!confirm('Forcer la mise à jour ? Le code et les données publiques en cache seront re-téléchargés (tes annotations ne sont PAS touchées).')) return;
  const garderTuiles = confirm('Garder les cartes déjà téléchargées pour le hors ligne ?\nOK = garder · Annuler = les re-télécharger aussi');
  sauverAnnot.maintenant(); sauverReglages.maintenant();
  try {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) if (!(garderTuiles && k === CACHE_TUILES)) await caches.delete(k);
  } catch (e) { console.warn(e); }
  setTimeout(() => location.reload(), 300);
}

/* =================================================================== go */
window.__carte = E; // debug / tests
E.api = { appliquerFiltres, ouvrirCarte, chargerTips, exporterJSON, choisirOutil };
demarrer().catch(e => { console.error(e); bandeau('fatal', '❌ Erreur au démarrage : ' + esc(e.message), [{ t: 'Recharger', f: () => location.reload() }], 'erreur'); });
