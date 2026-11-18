/* Service worker — cache hors ligne.
 * ⚠️ Change VERSION à chaque mise en ligne d'une nouvelle version du CODE (js/css/html) :
 *    l'appli proposera alors « Nouvelle version disponible ».
 * Les données (maps.json, styles.json, data/*.geojson) sont toujours lues sur le réseau d'abord.
 * Les cartes (maps/…) sont gardées en cache : change le NOM DU DOSSIER quand tu remplaces une carte.
 */
const VERSION = '2026-11-19.1';
const CACHE_APP = 'carte-app-' + VERSION;
const CACHE_DONNEES = 'carte-donnees-v1';
const CACHE_TUILES = 'carte-tuiles-v1';

const APP = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app.js', 'js/coords.js', 'js/geojson.js', 'js/filtres.js', 'js/migration.js', 'js/encre.js', 'js/db.js', 'js/stockage.js',
  'lib/leaflet/leaflet.js', 'lib/leaflet/leaflet.css', 'lib/markercluster/leaflet.markercluster.js', 'lib/markercluster/MarkerCluster.css',
  'icons/icon-192.png', 'icons/icon-512.png',
];
const DONNEES = ['maps.json', 'styles.json', 'data/tips_gta6.geojson'];

const portee = () => new URL(self.registration.scope);
const abs = p => new URL(p, self.registration.scope).href;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE_APP);
    await c.addAll(APP.map(p => new Request(abs(p), { cache: 'reload' })));
    const d = await caches.open(CACHE_DONNEES);
    await Promise.all(DONNEES.map(async p => { try { const r = await fetch(abs(p), { cache: 'reload' }); if (r.ok) await d.put(abs(p), r); } catch (er) { /* hors ligne : tant pis */ } }));
    // premier lancement : on s'active tout de suite (pas d'ancienne version à remplacer)
    if (!(await self.clients.matchAll()).length) self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('carte-app-') && k !== CACHE_APP) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data === 'VERSION' && e.ports[0]) e.ports[0].postMessage(VERSION);
});

function marquerCache(rep) {
  const h = new Headers(rep.headers); h.set('X-Carte-Cache', '1');
  return rep.blob().then(b => new Response(b, { status: rep.status, statusText: rep.statusText, headers: h }));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url), sc = portee();
  if (url.origin !== sc.origin || !url.pathname.startsWith(sc.pathname)) return;
  const rel = url.pathname.slice(sc.pathname.length);
  const cle = url.origin + url.pathname; // sans paramètres

  // 1) données publiques : réseau d'abord, copie de secours
  if (rel.startsWith('data/') || rel === 'maps.json' || rel === 'styles.json') {
    e.respondWith((async () => {
      const c = await caches.open(CACHE_DONNEES);
      try {
        const r = await fetch(req);
        if (r.ok) await c.put(cle, r.clone());
        if (r.status !== 404 || !(await c.match(cle))) return r;
      } catch (er) { /* hors ligne */ }
      const m = await c.match(cle);
      if (m) return marquerCache(m);
      return Response.error();
    })());
    return;
  }
  // 2) cartes / tuiles : cache d'abord
  if (rel.startsWith('maps/')) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE_TUILES);
      const m = await c.match(cle);
      if (m) return m;
      const r = await fetch(req);
      if (r.ok) c.put(cle, r.clone());
      return r;
    })());
    return;
  }
  // 3) code de l'appli : cache d'abord (versionné), réseau en secours
  e.respondWith((async () => {
    const c = await caches.open(CACHE_APP);
    const m = await c.match(req.mode === 'navigate' ? abs('index.html') : cle, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match(abs('./')) : null);
    if (m) return m;
    try {
      const r = await fetch(req);
      if (r.ok && (rel.startsWith('js/') || rel.startsWith('css/') || rel.startsWith('lib/') || rel.startsWith('icons/'))) c.put(cle, r.clone());
      return r;
    } catch (er) {
      return new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
