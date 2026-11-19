// Tests unitaires des modules purs.  Lancer :  node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projecteur, zoomNatif, caseGrille, grilleDe, repereXY, regionDe, GRILLE_DEFAUT } from '../js/coords.js';
import { validerTips, categorieDominante } from '../js/geojson.js';
import { filtresParDefaut, filtrerLieux, compteurs, trierLignes, etatTip, normaliserFiltres } from '../js/filtres.js';
import { convertirEtatV1, migrerEnregistrement, analyserSauvegarde, SCHEMA_VERSION, FORMAT_SAUVEGARDE } from '../js/migration.js';

const racine = new URL('../', import.meta.url);
const lire = p => JSON.parse(readFileSync(new URL(p, racine), 'utf8'));

test('coords : aller-retour normalisé <-> Leaflet', () => {
  for (const cfg of [{ largeur_px: 2567, hauteur_px: 3600 }, { largeur_px: 4096, hauteur_px: 4096 }, { largeur_px: 300, hauteur_px: 100 }]) {
    const P = projecteur(cfg);
    for (const [x, y] of [[0, 0], [1, 1], [0.25, 0.75], [0.123456, 0.987654]]) {
      const [a, b] = P.depuisLatLng(P.versLatLng(x, y));
      assert.ok(Math.abs(a - x) < 1e-12 && Math.abs(b - y) < 1e-12);
    }
    const [[s, o], [n, e]] = P.limites();
    assert.deepEqual(P.versLatLng(0, 0), [-0, 0]);
    assert.equal(n, 0); assert.equal(o, 0);
    assert.deepEqual(P.versLatLng(1, 1), [s, e]);
  }
  assert.equal(zoomNatif({ largeur_px: 4096, hauteur_px: 4096 }), 4);
  assert.equal(zoomNatif({ largeur_px: 2567, hauteur_px: 3600 }), 4);
  assert.equal(zoomNatif({ largeur_px: 200, hauteur_px: 100 }), 0);
  assert.equal(zoomNatif({ largeur_px: 9000, hauteur_px: 100, zoom_natif: 7 }), 7);
  // au zoom natif, 1 unité Leaflet = 2^zn px : (x=1) -> lng = W / 2^zn
  const P = projecteur({ largeur_px: 4096, hauteur_px: 2048 });
  assert.deepEqual(P.versLatLng(1, 1), [-128, 256]);
  assert.equal(P.distancePx([0, 0], [1, 0]), 4096);
  assert.equal(caseGrille(0.05, 0.05), 'A1');
  assert.equal(caseGrille(1, 1), 'J10');
  assert.equal(caseGrille(0.55, 0.31), 'F4');
});

test('carte officielle : grille du poster, repère X/Y, comtés', () => {
  const off = lire('maps.json').cartes.find(c => c.id === 'officielle');
  assert.ok(off, 'carte officielle absente de maps.json');
  // grille imprimée : colonnes 1..9, lignes A..M, case = ligne + colonne
  const G = grilleDe(off);
  assert.notEqual(G, GRILLE_DEFAUT);
  assert.equal(G.nomsCol.length, 9); assert.equal(G.nomsLig.length, 13);
  assert.equal(caseGrille(0.05, 0.05, G), 'A1');
  assert.equal(caseGrille(0.99, 0.5, G), '—');                    // marge blanche hors cadre
  assert.equal(caseGrille(1290 / 1925, 1370 / 2633, G), 'G7');   // Vice City sur le poster
  // grille invalide -> grille par défaut
  assert.equal(grilleDe({ grille: { colonnes: [0, 0.5, 0.4], lignes: [0, 1], noms_colonnes: 'AB', noms_lignes: '1' } }), GRILLE_DEFAUT);
  assert.equal(grilleDe({}), GRILLE_DEFAUT);
  // repère : linéaire, aller-retour, Y vers le haut
  const X = repereXY(off);
  assert.deepEqual(X.versXY(0, 0), [-11328, 11328]);
  assert.deepEqual(X.versXY(1, 1), [4096, -9728]);
  const [a, b] = X.depuisXY(...X.versXY(0.3, 0.7));
  assert.ok(Math.abs(a - 0.3) < 1e-12 && Math.abs(b - 0.7) < 1e-12);
  assert.equal(repereXY({ repere: { x: [1, 1], y: [0, 1] } }), null);
  // comtés : graine la plus proche, rien en pleine mer
  const R = lire(off.regions);
  const ratio = off.hauteur_px / off.largeur_px;
  const nom = (px, py) => (regionDe(R, px / 1925, py / 2633, ratio) || {}).nom;
  assert.equal(nom(1290, 1370), 'Vice-Dale County');     // Vice City
  assert.equal(nom(585, 940), 'Kelly County');           // Port Gellhorn
  assert.equal(nom(1268, 607), 'Leonard County');        // Millport
  assert.equal(nom(925, 375), 'Lummox County');          // Bonanza
  assert.equal(nom(533, 2290), 'Mariana County');        // Mile Zero Air Station
  assert.equal(nom(1800, 300), undefined);               // océan
  assert.equal(R.regions.length, 5);
});

test('geojson : exemple fourni valide (≈30 lieux)', () => {
  const r = validerTips(lire('tests/donnees/tips_exemple.geojson'));
  assert.ok(r.ok);
  assert.ok(r.stats.lieux >= 28 && r.stats.lieux <= 35, 'lieux=' + r.stats.lieux);
  assert.equal(r.stats.lieux_invalides, 0);
  assert.equal(r.stats.tips_invalides, 0);
  assert.ok(r.lieux.some(l => l.tips.length > 1));
  assert.ok(r.lieux.some(l => l.tips.some(t => t.verifie)));
  assert.ok(r.lieux.some(l => l.rayon));
  assert.ok(new Set(r.lieux.map(l => l.cat)).size >= 6);
});

test('geojson : fichiers invalides / vides', () => {
  assert.equal(validerTips(null).ok, false);
  assert.equal(validerTips([]).ok, false);
  assert.equal(validerTips({ type: 'Feature' }).ok, false);
  assert.equal(validerTips({ type: 'FeatureCollection' }).ok, false);
  const vide = validerTips({ type: 'FeatureCollection', features: [] });
  assert.ok(vide.ok); assert.equal(vide.stats.lieux, 0);
  const r = validerTips(lire('tests/donnees/tips_mixte.geojson'));
  assert.ok(r.ok);
  assert.equal(r.stats.lieux, 2, JSON.stringify(r.stats.details));
  assert.equal(r.stats.lieux_invalides, 6, JSON.stringify(r.stats.details));
  assert.equal(r.stats.tips_invalides, 2, JSON.stringify(r.stats.details));
  const ok = r.lieux.find(l => l.lieu === 'Valide');
  assert.equal(ok.type, 'autre');            // type inconnu -> autre
  assert.equal(ok.rayon, null);              // rayon 5 refusé
  assert.deepEqual(ok.tips[0].urls, ['https://exemple.org/v']); // javascript: supprimée
  assert.ok(ok.tips.some(t => t.id.startsWith('auto-')));        // id généré
  assert.ok(r.stats.details.some(d => d.includes('lat/lon')));
});

test('geojson : catégorie dominante', () => {
  const t = (c, n) => ({ categorie: c, nb_sources: n });
  assert.equal(categorieDominante([t('a', 1), t('b', 1), t('b', 1)]), 'b');
  assert.equal(categorieDominante([t('a', 9), t('b', 1)]), 'a');
});

test('filtres : combinaisons', () => {
  const { lieux } = validerTips(lire('tests/donnees/tips_exemple.geojson'));
  const tous = lieux.reduce((n, l) => n + l.tips.length, 0);
  const f = filtresParDefaut();
  assert.equal(filtrerLieux(lieux, f, {}).nTips, tous);
  // vérifiés + min 5 sources
  const f2 = { ...f, verifies_seul: true, min_sources: 5 };
  const r2 = filtrerLieux(lieux, f2, {});
  assert.ok(r2.nTips > 0 && r2.nTips < tous);
  for (const v of r2.visibles) for (const t of v.tips) assert.ok(t.verifie && t.nb_sources >= 5);
  // catégorie masquée
  const cat = lieux[0].tips[0].categorie;
  const r3 = filtrerLieux(lieux, { ...f, cats_masquees: [cat] }, {});
  for (const v of r3.visibles) for (const t of v.tips) assert.notEqual(t.categorie, cat);
  // compteurs de légende : ignorent le filtre de catégorie lui-même
  const c = compteurs(lieux, { ...f, cats_masquees: [cat] }, {});
  assert.ok(c.cats.get(cat) > 0);
  // état perso
  const id = lieux[0].tips[0].id;
  const etats = { [id]: { masque: true } };
  assert.equal(etatTip(etats[id]), 'masque');
  assert.equal(filtrerLieux(lieux, f, etats).nTips, tous - 1);
  assert.equal(filtrerLieux(lieux, { ...f, etats: { a_faire: false, fait: false, masque: true } }, etats).nTips, 1);
  // texte sans accents, plusieurs mots, sur lieu ou énoncé
  const r4 = filtrerLieux(lieux, { ...f, texte: 'MARINA' }, {});
  assert.ok(r4.nLieux >= 1);
  const r5 = filtrerLieux(lieux, { ...f, texte: 'zzzz introuvable' }, {});
  assert.equal(r5.nLieux, 0);
  // type masqué
  const r6 = filtrerLieux(lieux, { ...f, types_masques: ['quartier'] }, {});
  assert.ok(r6.visibles.every(v => v.lieu.type !== 'quartier'));
  // normalisation de vieux réglages
  const n = normaliserFiltres({ verifies_seul: true, calques: { grille: true } });
  assert.equal(n.calques.tips, true); assert.equal(n.calques.grille, true); assert.equal(n.etats.masque, false);
});

test('filtres : tris', () => {
  const { lieux } = validerTips(lire('tests/donnees/tips_exemple.geojson'));
  const lignes = lieux.flatMap(l => l.tips.map(t => ({ tip: t, lieu: l })));
  const P = projecteur({ largeur_px: 4096, hauteur_px: 4096 });
  const s = trierLignes(lignes, 'sources', [0.5, 0.5], P.distancePx);
  for (let i = 1; i < s.length; i++) assert.ok(s[i - 1].tip.nb_sources >= s[i].tip.nb_sources);
  const v = trierLignes(lignes, 'verifies', [0.5, 0.5], P.distancePx);
  const premierNonVerifie = v.findIndex(l => !l.tip.verifie);
  assert.ok(v.slice(premierNonVerifie).every(l => !l.tip.verifie));
  const d = trierLignes(lignes, 'distance', [0.5, 0.5], P.distancePx);
  for (let i = 1; i < d.length; i++) assert.ok(P.distancePx([d[i - 1].lieu.x, d[i - 1].lieu.y], [.5, .5]) <= P.distancePx([d[i].lieu.x, d[i].lieu.y], [.5, .5]) + 1e-9);
  const n = trierLignes(lignes, 'lieu', [0.5, 0.5], P.distancePx);
  assert.ok(n[0].lieu.lieu.localeCompare(n[n.length - 1].lieu.lieu, 'fr') <= 0);
});

test('migration : état v1 réel -> v2 normalisé', () => {
  const v1 = {
    strokes: [
      { t: 'pen', color: '#ff3b3b', w: 2.5, pen: true, pts: [[100, 200, 0.4], [2567, 3600, 0.9]] },
      { t: 'line', color: '#ffd400', w: 4, pen: false, pts: [[0, 0, .5], [1283.5, 1800, .5]] },
      { t: 'hl', color: '#ffd400', w: 4, pts: [[10, 10]] },
      { t: 'pen', pts: [] },
    ],
    markers: [{ id: 'abc', x: 1283.5, y: 900, cat: 'wpn', label: 'Ammu', note: 'n', done: true }, { x: 'x' }],
    hidden: { shop: true, col: false },
  };
  const { rec, stats } = convertirEtatV1(JSON.stringify(v1), 2567, 3600, 'sat', 'v0-fan');
  assert.equal(rec.schema_version, SCHEMA_VERSION);
  assert.deepEqual(stats, { marqueurs: 1, traits: 3, ignores: 2 });
  assert.deepEqual([rec.markers[0].x, rec.markers[0].y], [0.5, 0.25]);
  assert.equal(rec.markers[0].id, 'abc'); assert.equal(rec.markers[0].done, true); assert.equal(rec.markers[0].cat, 'wpn');
  assert.deepEqual(rec.strokes[0].pts[1], [1, 1, 0.9]);
  assert.deepEqual(rec.strokes[1].pts[1].slice(0, 2), [0.5, 0.5]);
  assert.equal(rec.strokes[2].pts[0][2], 0.5); // pression par défaut
  assert.ok(Math.abs(rec.strokes[0].w * 2567 - 2.5) < 1e-9);
  assert.deepEqual(rec.hidden_cats, ['shop']);
  assert.throws(() => convertirEtatV1({}, 0, 0, 'x'));
  // idempotence du nettoyage
  const again = migrerEnregistrement(JSON.parse(JSON.stringify(rec)));
  assert.deepEqual(again.markers, rec.markers);
  assert.equal(again.strokes.length, 3);
});

test('migration : sauvegardes (nouveau format + ancien export)', () => {
  const v2 = { format: FORMAT_SAUVEGARDE, schema_version: 2, annotations: [{ schema_version: 2, map_id: 'test', map_version: 'x', markers: [{ id: 'a', x: .1, y: .2, cat: 'obj' }], strokes: [] }], etats_tips: [{ tip_id: 't1', fait: true }, { nope: 1 }] };
  const a = analyserSauvegarde(v2);
  assert.equal(a.type, 'v2'); assert.equal(a.annotations[0].markers[0].label, ''); assert.equal(a.etats_tips.length, 1);
  const old = analyserSauvegarde({ v: 2, mapId: 'sat', name: 'Satellite', builtin: true, state: { markers: [], strokes: [] }, image: null });
  assert.equal(old.type, 'ancien-export'); assert.equal(old.mapId, 'sat');
  assert.throws(() => analyserSauvegarde({ format: FORMAT_SAUVEGARDE, schema_version: 99 }));
  assert.throws(() => analyserSauvegarde({ hello: 1 }));
});

test('config : maps.json et styles.json cohérents', () => {
  const m = lire('maps.json');
  assert.ok(Array.isArray(m.cartes) && m.cartes.length >= 1);
  const ids = new Set();
  for (const c of m.cartes) {
    assert.ok(c.id && !ids.has(c.id)); ids.add(c.id);
    assert.ok(['image', 'tuiles', 'grille'].includes(c.type), c.id);
    assert.ok(c.largeur_px > 0 && c.hauteur_px > 0, c.id);
    assert.ok(!/^(\/|https?:)/.test(c.chemin || ''), 'chemin relatif obligatoire : ' + c.id);
  }
  const s = lire('styles.json');
  assert.ok(s.defaut && s.defaut.couleur && s.defaut.icone);
  assert.ok(Array.isArray(s.perso) && s.perso.length === 18);
});
