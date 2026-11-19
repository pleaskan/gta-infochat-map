// Filtres, comptages et tris des tips. Pur (aucun DOM) : testable sous Node.

export function filtresParDefaut() {
  return {
    cats_masquees: [],        // catégories de tips masquées
    types_masques: [],        // types de lieu masqués
    verifies_seul: false,
    min_sources: 0,
    etats: { a_faire: true, fait: true, masque: false },
    texte: '',
    calques: { tips: true, comtes: true, marqueurs: true, dessins: true, grille: false },
  };
}

/** Complète un objet de filtres sauvegardé (anciennes versions, champs manquants). */
export function normaliserFiltres(f) {
  const d = filtresParDefaut();
  if (!f || typeof f !== 'object') return d;
  return {
    cats_masquees: Array.isArray(f.cats_masquees) ? f.cats_masquees.filter(s => typeof s === 'string') : d.cats_masquees,
    types_masques: Array.isArray(f.types_masques) ? f.types_masques.filter(s => typeof s === 'string') : d.types_masques,
    verifies_seul: f.verifies_seul === true,
    min_sources: Number.isFinite(f.min_sources) && f.min_sources >= 0 ? f.min_sources : 0,
    etats: { ...d.etats, ...(f.etats || {}) },
    texte: typeof f.texte === 'string' ? f.texte : '',
    calques: { ...d.calques, ...(f.calques || {}) },
  };
}

export const normTexte = s => (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** État perso d'un tip : 'masque' > 'fait' > 'a_faire'. */
export function etatTip(st) {
  if (st && st.masque) return 'masque';
  if (st && st.fait) return 'fait';
  return 'a_faire';
}

/**
 * Le tip passe-t-il les filtres ? `sauf` permet d'ignorer un critère (pour les compteurs de légende).
 * etats : Map ou objet {tip_id: {fait, utile, faux, masque, note}}
 */
export function tipPasse(tip, lieu, f, etats, sauf = null, texteNorm = null) {
  if (sauf !== 'cat' && f.cats_masquees.includes(tip.categorie)) return false;
  if (sauf !== 'type' && f.types_masques.includes(lieu.type)) return false;
  if (f.verifies_seul && !tip.verifie) return false;
  if (tip.nb_sources < f.min_sources) return false;
  const st = etats instanceof Map ? etats.get(tip.id) : etats[tip.id];
  if (!f.etats[etatTip(st)]) return false;
  const q = texteNorm ?? normTexte(f.texte.trim());
  if (q) {
    const h = tip._txt || (tip._txt = normTexte(tip.enonce + ' ' + tip.precision));
    const hl = lieu._txt || (lieu._txt = normTexte(lieu.lieu));
    // tous les mots doivent apparaître (dans l'énoncé, la précision ou le lieu)
    for (const mot of q.split(/\s+/)) if (!h.includes(mot) && !hl.includes(mot)) return false;
  }
  return true;
}

/** -> [{lieu, tips:[tips visibles]}] (lieux sans tip visible exclus) + totaux */
export function filtrerLieux(lieux, f, etats) {
  const q = normTexte(f.texte.trim());
  const out = []; let nTips = 0;
  for (const lieu of lieux) {
    const tips = lieu.tips.filter(t => tipPasse(t, lieu, f, etats, null, q));
    if (tips.length) { out.push({ lieu, tips }); nTips += tips.length; }
  }
  return { visibles: out, nLieux: out.length, nTips };
}

/** Compteurs de légende : pour chaque catégorie / type, nb de tips qui passeraient tous les AUTRES filtres. */
export function compteurs(lieux, f, etats) {
  const q = normTexte(f.texte.trim());
  const cats = new Map(), types = new Map();
  for (const lieu of lieux) {
    if (!types.has(lieu.type)) types.set(lieu.type, 0);
    for (const t of lieu.tips) {
      if (!cats.has(t.categorie)) cats.set(t.categorie, 0);
      if (tipPasse(t, lieu, f, etats, 'cat', q)) cats.set(t.categorie, cats.get(t.categorie) + 1);
      if (tipPasse(t, lieu, f, etats, 'type', q)) types.set(lieu.type, types.get(lieu.type) + 1);
    }
  }
  return { cats, types };
}

export const TRIS = {
  sources: 'Nombre de sources',
  verifies: 'Vérifiés d\'abord',
  categorie: 'Catégorie',
  lieu: 'Nom du lieu',
  distance: 'Distance au centre',
};

/**
 * Trie des lignes {tip, lieu}. centre = [x,y] normalisé ; dist(a,b) = distance en px image.
 */
export function trierLignes(lignes, mode, centre, dist) {
  const coll = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
  const parSources = (a, b) => b.tip.nb_sources - a.tip.nb_sources;
  const parLieu = (a, b) => coll.compare(a.lieu.lieu, b.lieu.lieu);
  const d = l => l._d ?? (l._d = dist([l.lieu.x, l.lieu.y], centre));
  const cmp = {
    sources: (a, b) => parSources(a, b) || (b.tip.verifie - a.tip.verifie) || parLieu(a, b),
    verifies: (a, b) => (b.tip.verifie - a.tip.verifie) || parSources(a, b) || parLieu(a, b),
    categorie: (a, b) => coll.compare(a.tip.categorie, b.tip.categorie) || parSources(a, b),
    lieu: (a, b) => parLieu(a, b) || parSources(a, b),
    distance: (a, b) => d(a) - d(b) || parSources(a, b),
  }[mode] || ((a, b) => parSources(a, b));
  return lignes.slice().sort(cmp);
}
