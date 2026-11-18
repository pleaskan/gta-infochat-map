// Petit wrapper IndexedDB (promesses).
const NOM = 'carte-gta6', VERSION = 1;
export const ANCIENNE_BASE = 'gta-map'; // base de l'ancienne appli : lue, jamais modifiée

function req(r) { return new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); }); }

export class Base {
  constructor(db) { this.db = db; }
  static ouvrir() {
    return new Promise((ok, ko) => {
      let r;
      try { r = indexedDB.open(NOM, VERSION); } catch (e) { ko(e); return; }
      r.onupgradeneeded = () => {
        const db = r.result;
        const mk = (n, o) => { if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, o); };
        mk('meta');                                   // réglages, cartes importées, drapeaux
        mk('annotations', { keyPath: 'map_id' });     // 1 enregistrement par carte
        mk('etats_tips', { keyPath: 'tip_id' });      // fait / utile / faux / masqué / note
        mk('blobs');                                  // images des cartes importées
        mk('sauvegardes', { keyPath: 'id' });         // sauvegardes automatiques
      };
      r.onblocked = () => ko(new Error('Base bloquée : ferme les autres onglets de l\'appli puis recharge.'));
      r.onsuccess = () => { const db = r.result; db.onversionchange = () => db.close(); ok(new Base(db)); };
      r.onerror = () => ko(r.error);
    });
  }
  _st(n, mode = 'readonly') { return this.db.transaction(n, mode).objectStore(n); }
  get(n, k) { return req(this._st(n).get(k)); }
  tout(n) { return req(this._st(n).getAll()); }
  cles(n) { return req(this._st(n).getAllKeys()); }
  put(n, v, k) {
    return new Promise((ok, ko) => {
      const t = this.db.transaction(n, 'readwrite');
      k === undefined ? t.objectStore(n).put(v) : t.objectStore(n).put(v, k);
      t.oncomplete = () => ok(); t.onerror = () => ko(t.error); t.onabort = () => ko(t.error || new Error('Écriture annulée (stockage plein ?)'));
    });
  }
  del(n, k) {
    return new Promise((ok, ko) => { const t = this.db.transaction(n, 'readwrite'); t.objectStore(n).delete(k); t.oncomplete = () => ok(); t.onerror = () => ko(t.error); });
  }
}

/** Lit tout le contenu de l'ancienne base (store kv) SANS la modifier. null si absente/vide. */
export async function lireAncienneBase() {
  if (indexedDB.databases) {
    try { const l = await indexedDB.databases(); if (!l.some(d => d.name === ANCIENNE_BASE)) return null; } catch (e) { /* on tente quand même */ }
  }
  return new Promise((ok) => {
    let r, creee = false;
    try { r = indexedDB.open(ANCIENNE_BASE); } catch (e) { ok(null); return; }
    r.onupgradeneeded = () => { creee = true; };         // n'existait pas : on ne crée rien
    r.onerror = () => ok(null);
    r.onblocked = () => ok(null);
    r.onsuccess = async () => {
      const db = r.result;
      if (creee || !db.objectStoreNames.contains('kv')) { db.close(); if (creee) indexedDB.deleteDatabase(ANCIENNE_BASE); ok(null); return; }
      try {
        const st = db.transaction('kv').objectStore('kv');
        const [cles, vals] = await Promise.all([req(st.getAllKeys()), req(st.getAll())]);
        const kv = {}; cles.forEach((k, i) => { kv[k] = vals[i]; });
        db.close(); ok(kv);
      } catch (e) { db.close(); ok(null); }
    };
  });
}
