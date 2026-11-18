#!/usr/bin/env python3
"""Tests de bout en bout dans Chrome (Playwright). Optionnel : sert au développement.
Pré-requis : pip install playwright ; un Chrome/Chromium ; un serveur HTTP qui sert
  /repo/      -> ce dossier (la nouvelle appli)
  /ancienne/  -> l'ancienne appli (index.html + maps.js)   [test de migration]
Exemple :  mkdir -p /tmp/site && ln -s "$PWD" /tmp/site/repo && (cd /tmp/site && python3 -m http.server 8080)
           CHROME=/usr/bin/google-chrome python3 tests/navigateur_e2e.py
"""
import asyncio, json, os, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

BASE = os.environ.get('BASE', 'http://localhost:8080')
APP, OLD = BASE + '/repo/', BASE + '/ancienne/'
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
RAC = Path(__file__).resolve().parent.parent
SHOTS = Path(os.environ.get('SHOTS', '/tmp/shots')); SHOTS.mkdir(exist_ok=True)
R = []  # résultats


def ok(nom, cond, detail=''):
    R.append((nom, bool(cond), detail))
    print(('  ✅ ' if cond else '  ❌ ') + nom + (f'  [{detail}]' if detail else ''), flush=True)


async def page_app(ctx, url=APP, attente=2500):
    pg = await ctx.new_page()
    pg.erreurs = []
    pg.on('pageerror', lambda e: pg.erreurs.append(str(e)))
    pg.on('console', lambda m: pg.erreurs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
    await pg.goto(url)
    await pg.wait_for_timeout(attente)
    return pg

E = "window.__carte"
async def ev(pg, js): return await pg.evaluate(js)


def attendu(lieux, f, etats=None):
    """Recalcule en Python le nombre de lieux/tips attendus (même logique que js/filtres.js)."""
    import unicodedata
    norm = lambda s: ''.join(c for c in unicodedata.normalize('NFD', s or '') if unicodedata.category(c) != 'Mn').lower()
    etats = etats or {}
    nl = nt = 0
    for ft in lieux['features']:
        p = ft['properties']; c = 0
        for t in p['tips']:
            if t['categorie'] in f.get('cats', []): continue
            if p['type'] in f.get('types', []): continue
            if f.get('verif') and not t.get('verifie_en_jeu'): continue
            if t.get('nb_sources', 0) < f.get('min', 0): continue
            st = etats.get(t['id'], 'a_faire')
            if not f.get('etats', {'a_faire': 1, 'fait': 1, 'masque': 0})[st]: continue
            q = norm(f.get('texte', '')).split()
            h = norm(t['enonce'] + ' ' + t.get('precision', '')); hl = norm(p['lieu'])
            if any(m not in h and m not in hl for m in q): continue
            c += 1
        if c: nl += 1; nt += c
    return nl, nt


async def t_migration(b):
    print('\n▶ Migration depuis l\'ancienne appli (vraies données créées avec l\'ancienne version)')
    ctx = await b.new_context(viewport={'width': 1280, 'height': 800})
    pg = await ctx.new_page(); pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
    await pg.goto(OLD); await pg.wait_for_timeout(3000)
    # 1 trait au stylo (souris) + 1 marqueur sur « sat »
    await pg.mouse.move(400, 300); await pg.mouse.down(); await pg.mouse.move(560, 380, steps=12); await pg.mouse.up()
    await pg.click('#bar .b[title="Marqueur"]'); await pg.mouse.click(640, 420)
    await pg.fill('#pl', 'Ammu-Nation'); await pg.fill('#pn', 'note test'); await pg.click('#pok')
    await pg.mouse.click(820, 520); await pg.fill('#pl', 'Second'); await pg.check('#pd'); await pg.click('#pok')
    # surligneur + flèche
    await pg.click('#bar .b[title="Surligneur"]'); await pg.mouse.move(300, 600); await pg.mouse.down(); await pg.mouse.move(500, 620, steps=6); await pg.mouse.up()
    await pg.click('#bar .b[title="Flèche"]'); await pg.mouse.move(700, 200); await pg.mouse.down(); await pg.mouse.move(800, 260, steps=6); await pg.mouse.up()
    await pg.wait_for_timeout(600)
    old_sat = await ev(pg, 'JSON.parse(JSON.stringify(S))')
    await pg.screenshot(path=str(SHOTS / 'ancienne_sat.png'))
    # carte « routes » : 1 marqueur
    await ev(pg, "openMap('routes')"); await pg.wait_for_timeout(800)
    await ev(pg, "tool='mark';buildBar()"); await pg.mouse.click(600, 400); await pg.fill('#pl', 'Sur routes'); await pg.click('#pok')
    await pg.wait_for_timeout(500)
    old_routes = await ev(pg, 'JSON.parse(JSON.stringify(S))')
    # carte importée + 1 trait
    await pg.set_input_files('#fileMap', '/tmp/perso.png'); await pg.wait_for_timeout(1200)
    await ev(pg, "tool='pen';buildBar()")
    await pg.mouse.move(500, 300); await pg.mouse.down(); await pg.mouse.move(700, 500, steps=8); await pg.mouse.up(); await pg.wait_for_timeout(800)
    old_imp = await ev(pg, '({S:JSON.parse(JSON.stringify(S)), id:curMap, img:[img.width,img.height]})')
    brut_avant = await ev(pg, "DB.get('state:sat')")
    await pg.close()

    pg = await page_app(ctx, APP, 3500)
    await pg.screenshot(path=str(SHOTS / 'migration_rapport.png'))
    txt = await pg.inner_text('#modal') if await pg.is_visible('#modal') else ''
    ok('rapport de migration affiché', 'migrées' in txt, txt[:120].replace('\n', ' '))
    recs = await ev(pg, """new Promise(ok=>{const r=indexedDB.open('carte-gta6');r.onsuccess=()=>{const q=r.result.transaction('annotations').objectStore('annotations').getAll();q.onsuccess=()=>ok(q.result)}})""")
    by = {r['map_id']: r for r in recs}
    s = by.get('sat')
    ok('carte sat migrée', s is not None and len(s['markers']) == 2 and len(s['strokes']) == 3, s and f"{len(s['markers'])} marqueurs, {len(s['strokes'])} traits")
    if s:
        m0 = old_sat['markers'][0]; n0 = next(m for m in s['markers'] if m['id'] == m0['id'])
        ok('position normalisée exacte (x/2567, y/3600)', abs(n0['x'] - m0['x'] / 2567) < 1e-6 and abs(n0['y'] - m0['y'] / 3600) < 1e-6, f"{n0['x']:.6f},{n0['y']:.6f}")
        ok('titre / note / fait conservés', n0['label'] == 'Ammu-Nation' and n0['note'] == 'note test' and any(m['done'] for m in s['markers']))
        p_old = old_sat['strokes'][0]['pts'][3]; p_new = s['strokes'][0]['pts'][3]
        ok('points de trait convertis', abs(p_new[0] - p_old[0] / 2567) < 1e-6 and abs(p_new[1] - p_old[1] / 3600) < 1e-6)
        ok('types de traits conservés (stylo, surligneur, flèche)', [x['t'] for x in s['strokes']] == ['pen', 'hl', 'line'])
        ok('épaisseur convertie', abs(s['strokes'][0]['w'] * 2567 - old_sat['strokes'][0]['w']) < 1e-9)
        ok('version de carte = celle de maps.json (pas d\'alerte)', s['map_version'] == 'v0-fan')
    r = by.get('routes')
    ok('carte routes migrée', r and abs(r['markers'][0]['x'] - old_routes['markers'][0]['x'] / 1280) < 1e-6)
    imp = by.get(old_imp['id'])
    ok('carte importée migrée (image + dimensions)', imp and len(imp['strokes']) == 1 and abs(imp['strokes'][0]['pts'][0][0] - old_imp['S']['strokes'][0]['pts'][0][0] / 800) < 1e-6)
    cartes = await ev(pg, f"{E}.cartes.map(c=>c.id)")
    ok('carte importée listée', old_imp['id'] in cartes, ','.join(cartes))
    # alignement visuel : le marqueur migré tombe sur le même pixel de l'image
    await pg.click('#modal [data-a="ok"]')
    await ev(pg, f"{E}.api.ouvrirCarte('sat')"); await pg.wait_for_timeout(1200)
    d = await ev(pg, f"""(()=>{{const e={E},m=e.rec.markers[0],img=document.querySelector('.fond-carte').getBoundingClientRect(),
      mz=document.querySelector('#map').getBoundingClientRect(),
      p=e.map.latLngToContainerPoint(e.P.versLatLng(m.x,m.y));
      return [p.x+mz.left, p.y+mz.top, img.left+m.x*img.width, img.top+m.y*img.height]}})()""")
    ok('marqueur aligné sur l\'image (<1 px)', abs(d[0] - d[2]) < 1 and abs(d[1] - d[3]) < 1, f'{d}')
    await pg.screenshot(path=str(SHOTS / 'nouvelle_sat_migree.png'))
    # ancienne base intacte
    brut = await ev(pg, """new Promise(ok=>{const r=indexedDB.open('gta-map');r.onsuccess=()=>{const q=r.result.transaction('kv').objectStore('kv').get('state:sat');q.onsuccess=()=>ok(q.result)}})""")
    ok('ancienne base « gta-map » intacte', brut == brut_avant)
    sv = await ev(pg, """new Promise(ok=>{const r=indexedDB.open('carte-gta6');r.onsuccess=()=>{const q=r.result.transaction('sauvegardes').objectStore('sauvegardes').getAll();q.onsuccess=()=>ok(q.result.map(s=>s.type))}})""")
    ok('copie de l\'ancien format dans les sauvegardes', 'migration-v1-ancien-format' in sv, ','.join(sv))
    # 2e lancement : pas de re-migration
    await pg.reload(); await pg.wait_for_timeout(2500)
    ok('pas de re-migration au 2e lancement', not await pg.is_visible('#modal'))
    ok('aucune erreur JS', not pg.erreurs, '; '.join(pg.erreurs[:3]))
    await ctx.close()


async def t_tips_invalides(b):
    print('\n▶ Tips manquants / invalides / vides')
    cas = {
        '404': dict(status=404, body='not found'),
        'json cassé': dict(status=200, body='{"type":"FeatureCollection", oups', content_type='application/json'),
        'pas une FeatureCollection': dict(status=200, body='{"type":"Feature"}', content_type='application/json'),
        'vide': dict(status=200, body='{"type":"FeatureCollection","features":[]}', content_type='application/json'),
        'mixte': dict(status=200, body=(RAC / 'tests/donnees/tips_mixte.geojson').read_text(), content_type='application/json'),
    }
    for nom, rep in cas.items():
        ctx = await b.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block')
        await ctx.route('**/data/tips_gta6.geojson', (lambda rep: (lambda r: r.fulfill(**rep)))(rep))
        pg = await page_app(ctx)
        st = await ev(pg, f"({{err:{E}.tips.erreur, n:{E}.nLieux, t:{E}.nTips, stats:{E}.tips.stats, bd:!!document.querySelector('#bd-tips'), cpt:document.querySelector('#compteur').innerText}})")
        if nom in ('404', 'json cassé', 'pas une FeatureCollection'):
            ok(f'{nom} : message clair + appli utilisable', st['err'] and st['bd'] and not pg.erreurs, f"{st['err']} | {st['cpt']}")
        elif nom == 'vide':
            ok('vide : 0 lieu, pas d\'erreur', st['err'] is None and st['n'] == 0, st['cpt'])
        else:
            s = st['stats']
            ok('mixte : entrées invalides ignorées et comptées', s['lieux'] == 2 and s['lieux_invalides'] == 6 and s['tips_invalides'] == 2, f"{s['lieux']} ok / {s['lieux_invalides']} lieux ko / {s['tips_invalides']} tips ko")
            await pg.click('#rb-panneau'); await pg.click('#onglets [data-o="filtres"]'); await pg.wait_for_timeout(200)
            t = await pg.inner_text('#pan-corps')
            ok('mixte : compteur d\'ignorés visible dans le panneau', '6 lieu(x) et 2 tip(s) ignorés' in t)
            await pg.screenshot(path=str(SHOTS / 'tips_mixte_panneau.png'))
        if nom == '404':
            # l'appli reste utilisable : poser un marqueur
            await ev(pg, f"{E}.api.choisirOutil('mark')"); await pg.mouse.click(640, 400); await pg.wait_for_timeout(200)
            ok('404 : on peut quand même poser un marqueur', await pg.is_visible('#ed-titre'))
            await pg.screenshot(path=str(SHOTS / 'tips_404.png'))
        await ctx.close()


async def t_sans_carte(b):
    print('\n▶ Chargement sans carte (tuiles absentes, maps.json absent)')
    ctx = await b.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block')
    await ctx.route('**/maps/test/tuiles/**', lambda r: r.fulfill(status=404, body=''))
    pg = await page_app(ctx, attente=3000)
    st = await ev(pg, f"({{f:{E}.fondManquant, bd:!!document.querySelector('#bd-fond'), n:{E}.nLieux}})")
    ok('tuiles absentes : bandeau + grille de secours, tips toujours affichés', st['f'] and st['bd'] and st['n'] == 30, str(st))
    ok('aucune erreur JS', not [e for e in pg.erreurs if '404' not in e and 'Failed to load' not in e], '; '.join(pg.erreurs[:2]))
    await pg.screenshot(path=str(SHOTS / 'sans_tuiles.png'))
    await ctx.close()
    ctx = await b.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block')
    await ctx.route('**/maps.json', lambda r: r.fulfill(status=404, body=''))
    pg = await page_app(ctx)
    st = await ev(pg, f"({{id:{E}.carte.id, bd:!!document.querySelector('#bd-maps'), n:{E}.nLieux}})")
    ok('maps.json absent : carte grille de remplacement', st['id'] == 'grille' and st['bd'] and st['n'] == 30, str(st))
    await pg.screenshot(path=str(SHOTS / 'sans_maps_json.png'))
    await ctx.close()


async def t_filtres(b):
    print('\n▶ Filtres combinés, légende, liste, états perso, persistance')
    data = json.loads((RAC / 'data/tips_gta6.geojson').read_text())
    ctx = await b.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block')
    pg = await page_app(ctx)
    cpt = lambda: ev(pg, f"[{E}.nLieux,{E}.nTips]")
    ok('sans filtre', await cpt() == list(attendu(data, {})), str(await cpt()))
    await pg.click('#rb-panneau'); await pg.click('#onglets [data-o="filtres"]')
    await pg.click('#f-verif + *' if False else 'label:has(#f-verif)')
    await ev(pg, "(()=>{const s=document.querySelector('#f-min');s.value=4;s.dispatchEvent(new Event('input',{bubbles:true}))})()")
    await pg.wait_for_timeout(400)
    f = {'verif': True, 'min': 4}
    ok('vérifiés + ≥ 4 sources', await cpt() == list(attendu(data, f)), f"{await cpt()} attendu {attendu(data, f)}")
    await pg.click('#onglets [data-o="legende"]'); await pg.wait_for_timeout(150)
    cat = await pg.get_attribute('#pan-corps input[data-cat]', 'data-cat')
    await pg.click(f'#pan-corps input[data-cat="{cat}"]'); await pg.wait_for_timeout(300)
    f['cats'] = [cat]
    ok(f'+ catégorie « {cat} » masquée', await cpt() == list(attendu(data, f)), f"{await cpt()} attendu {attendu(data, f)}")
    await pg.click('#pan-corps summary:has-text("Types de lieu")'); await pg.click('#pan-corps input[data-type="quartier"]'); await pg.wait_for_timeout(300)
    f['types'] = ['quartier']
    ok('+ type « quartier » masqué', await cpt() == list(attendu(data, f)), f"{await cpt()} attendu {attendu(data, f)}")
    leg = await pg.inner_text('#pan-corps')
    await pg.screenshot(path=str(SHOTS / 'filtres_legende.png'))
    await pg.fill('#recherche', 'garage'); await pg.wait_for_timeout(500)
    f['texte'] = 'garage'
    ok('+ recherche texte', await cpt() == list(attendu(data, f)), f"{await cpt()} attendu {attendu(data, f)}")
    ok('compteur « X lieux / Y tips affichés »', 'lieux /' in await pg.inner_text('#compteur'))
    await pg.click('#reset-filtres'); await pg.wait_for_timeout(300)
    ok('réinitialiser les filtres', await cpt() == list(attendu(data, {})), str(await cpt()))
    # liste + tri + fiche
    await pg.click('#onglets [data-o="liste"]'); await pg.select_option('#l-tri', 'verifies'); await pg.wait_for_timeout(200)
    rows = await pg.eval_on_selector_all('#pan-corps .ligne small', 'e=>e.map(x=>x.innerText.includes("✅"))')
    ok('liste triée « vérifiés d\'abord »', rows and rows == sorted(rows, reverse=True), f'{len(rows)} lignes')
    await pg.select_option('#l-tri', 'sources'); await pg.wait_for_timeout(200)
    srcs = await pg.eval_on_selector_all('#pan-corps .ligne small', r'e=>e.map(x=>+x.innerText.match(/👥 (\d+)/)[1])')
    ok('liste triée par nombre de sources', srcs == sorted(srcs, reverse=True))
    await pg.click('#pan-corps .ligne'); await pg.wait_for_timeout(400)
    ok('clic liste -> fiche du lieu', await pg.is_visible('#fiche article.tip.cible'))
    tip_id = await pg.get_attribute('#fiche article.cible', 'data-tip')
    await pg.click('#fiche article.cible button[data-e="fait"]')
    await pg.click('#fiche article.cible button[data-e="note"]'); await pg.fill('#fiche article.cible textarea', 'ma note'); await pg.wait_for_timeout(600)
    await pg.screenshot(path=str(SHOTS / 'fiche.png'))
    await pg.click('#onglets [data-o="filtres"]'); await pg.click('#pan-corps [data-etat="fait"]'); await pg.wait_for_timeout(400)
    f2 = {'etats': {'a_faire': 1, 'fait': 0, 'masque': 0}}
    ok('état perso : masquer les « faits »', await cpt() == list(attendu(data, f2, {tip_id: 'fait'})), str(await cpt()))
    # persistance
    await ev(pg, f"{E}.map.setView([-100,140],3)"); await pg.wait_for_timeout(900)
    await pg.reload(); await pg.wait_for_timeout(2500)
    st = await ev(pg, f"({{c:{E}.map.getCenter(), z:{E}.map.getZoom(), et:{E}.r.filtres.etats.fait, tip:{E}.etats.get('{tip_id}'), pan:!document.querySelector('#panneau').hidden}})")
    ok('réglages restaurés (filtre, vue, panneau)', st['et'] is False and abs(st['c']['lat'] + 100) < .5 and st['z'] == 3 and st['pan'], str(st)[:140])
    ok('état du tip + note restaurés', st['tip'] and st['tip']['fait'] and st['tip']['note'] == 'ma note')
    ok('aucune erreur JS', not pg.erreurs, '; '.join(pg.erreurs[:3]))
    await ctx.close()


async def t_stylet(b):
    print('\n▶ Stylet (événements pen réels via CDP), rejet de paume, gomme, annuler, marqueur')
    ctx = await b.new_context(viewport={'width': 1280, 'height': 800}, has_touch=True, service_workers='block')
    pg = await page_app(ctx)
    cdp = await ctx.new_cdp_session(pg)
    centre = lambda: ev(pg, f"(c=>[c.lat,c.lng])({E}.map.getCenter())")
    async def pen(t, x, y, force=.6):
        await cdp.send('Input.dispatchMouseEvent', {'type': t, 'x': x, 'y': y, 'button': 'left' if t != 'mouseMoved' else 'left', 'buttons': 1 if t != 'mouseReleased' else 0, 'clickCount': 1, 'pointerType': 'pen', 'force': force})
    async def touch(t, pts):
        await cdp.send('Input.dispatchTouchEvent', {'type': t, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})
    await pg.click('[data-outil="pen"]')
    c0 = await centre()
    await pen('mousePressed', 400, 300, .3)
    for i in range(1, 15): await pen('mouseMoved', 400 + i * 15, 300 + i * 6, .3 + i * .04)
    # paume posée pendant le trait
    await touch('touchStart', [(900, 600)]); await touch('touchMove', [(800, 500)]); await touch('touchMove', [(700, 450)]); await touch('touchEnd', [])
    await pen('mouseReleased', 610, 384)
    await pg.wait_for_timeout(300)
    st = await ev(pg, f"({{n:{E}.rec.strokes.length, pen:{E}.rec.strokes[0]?.pen, p:{E}.rec.strokes[0]?.pts.map(p=>p[2])}})")
    ok('trait au stylet enregistré avec pression', st['n'] == 1 and st['pen'] and max(st['p']) > .7 and min(st['p']) < .5, f"{st['n']} trait, pressions {min(st['p'] or [0]):.2f}..{max(st['p'] or [0]):.2f}")
    ok('paume ignorée (carte immobile pendant le trait)', await centre() == c0)
    await pg.wait_for_timeout(900)
    await touch('touchStart', [(900, 600)])
    for i in range(1, 8): await touch('touchMove', [(900 - i * 30, 600 - i * 20)])
    await touch('touchEnd', [])
    await pg.wait_for_timeout(500)
    ok('doigt seul (outil stylo) = déplace la carte, ne dessine pas', await centre() != c0 and await ev(pg, f"{E}.rec.strokes.length") == 1)
    await ev(pg, f"{E}.map.setView([{c0[0]},{c0[1]}], {E}.map.getZoom(), {{animate:false}})"); await pg.wait_for_timeout(300)
    # pinch
    z0 = await ev(pg, f"{E}.map.getZoom()")
    await touch('touchStart', [(600, 400), (700, 400)])
    for i in range(1, 8): await touch('touchMove', [(600 - i * 20, 400), (700 + i * 20, 400)])
    await touch('touchEnd', []); await pg.wait_for_timeout(600)
    ok('pincer à 2 doigts = zoom', await ev(pg, f"{E}.map.getZoom()") > z0)
    await ev(pg, f"{E}.map.setView([{c0[0]},{c0[1]}], {z0}, {{animate:false}})"); await pg.wait_for_timeout(300)
    await pg.screenshot(path=str(SHOTS / 'stylet_trait.png'))
    # gomme (bouton gomme du stylet = buttons 32 -> testé via outil gomme à la souris)
    await pg.click('[data-outil="erase"]')
    await pg.mouse.move(480, 250); await pg.mouse.down(); await pg.mouse.move(480, 380, steps=10); await pg.mouse.up(); await pg.wait_for_timeout(200)
    ok('gomme efface le trait', await ev(pg, f"{E}.rec.strokes.length") == 0)
    await pg.click('#rb-annuler'); await pg.wait_for_timeout(200)
    ok('annuler restaure le trait', await ev(pg, f"{E}.rec.strokes.length") == 1)
    await pg.click('#rb-refaire'); await pg.click('#rb-annuler')
    # surligneur + flèche à la souris
    await pg.click('[data-outil="hl"]'); await pg.mouse.move(300, 600); await pg.mouse.down(); await pg.mouse.move(450, 640, steps=5); await pg.mouse.up()
    await pg.click('[data-outil="line"]'); await pg.mouse.move(800, 200); await pg.mouse.down(); await pg.mouse.move(900, 300, steps=5); await pg.mouse.up()
    await pg.wait_for_timeout(200)
    ok('surligneur + flèche', await ev(pg, f"{E}.rec.strokes.map(s=>s.t).join()") == 'pen,hl,line')
    # marqueur
    await pg.click('[data-outil="mark"]'); await pg.mouse.click(1015, 720); await pg.wait_for_timeout(300)
    await pg.fill('#ed-titre', 'Planque test'); await pg.click('#ed-cats [data-cat="safe"]'); await pg.click('#feuille [data-a="ok"]')
    await pg.wait_for_timeout(600)
    m = await ev(pg, f"{E}.rec.markers[0]")
    ok('marqueur posé + édité', m and m['label'] == 'Planque test' and m['cat'] == 'safe')
    await pg.reload(); await pg.wait_for_timeout(2500)
    ok('dessins + marqueurs persistés après rechargement', await ev(pg, f"[{E}.rec.strokes.length,{E}.rec.markers.length]") == [3, 1])
    await pg.screenshot(path=str(SHOTS / 'perso_apres_reload.png'))
    # export JSON
    async with pg.expect_download() as dl:
        await ev(pg, f"{E}.api.exporterJSON()")
    d = await dl.value; chemin = '/tmp/export_e2e.json'; await d.save_as(chemin); sauv = json.loads(Path(chemin).read_text())
    ok('export JSON (sauvegarde horodatée, un seul fichier)', sauv['format'] == 'carte-gta6-sauvegarde' and sauv['schema_version'] == 2 and d.suggested_filename.startswith('carte-gta6-sauvegarde-20'), d.suggested_filename)
    ok('aucune erreur JS', not pg.erreurs, '; '.join(pg.erreurs[:3]))
    await ctx.close()
    # import dans un navigateur vierge
    ctx = await b.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block')
    pg = await page_app(ctx)
    await pg.set_input_files('#fichier-json', chemin); await pg.wait_for_timeout(1500)
    ok('import dans un appareil vierge', await ev(pg, f"[{E}.rec.strokes.length,{E}.rec.markers.length]") == [3, 1])
    vieux = Path('/tmp/ancien_export.json'); vieux.write_text(json.dumps({'v': 2, 'mapId': 'sat', 'name': 'Satellite', 'builtin': True, 'state': {'markers': [{'id': 'z', 'x': 1283.5, 'y': 1800, 'cat': 'col', 'label': 'centre', 'note': '', 'done': False}], 'strokes': [], 'hidden': {}}, 'image': None}))
    await pg.set_input_files('#fichier-json', str(vieux)); await pg.wait_for_timeout(1500)
    m = await ev(pg, f"[{E}.carte.id, {E}.rec.markers[0]]")
    ok('import d\'un ANCIEN export (pixels -> normalisé)', m[0] == 'sat' and m[1]['x'] == .5 and m[1]['y'] == .5, str(m))
    await ctx.close()


async def t_version(b):
    print('\n▶ Changement de version de carte')
    ctx = await b.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block')
    pg = await page_app(ctx)
    await ev(pg, """new Promise(ok=>{const r=indexedDB.open('carte-gta6');r.onsuccess=()=>{const t=r.result.transaction('annotations','readwrite');t.objectStore('annotations').put({schema_version:2,map_id:'test',map_version:'ancienne-v0',markers:[{id:'a',x:.5,y:.5,cat:'obj',label:'X',note:'',done:false}],strokes:[],hidden_cats:[]});t.oncomplete=ok}})""")
    await pg.reload(); await pg.wait_for_timeout(2500)
    st = await ev(pg, f"({{v:{E}.verrou, bd:!!document.querySelector('#bd-version'), n:{E}.perso.getLayers().length}})")
    ok('annotations d\'une autre version : signalées, masquées, verrouillées', st['v'] and st['bd'] and st['n'] == 0, str(st))
    await pg.screenshot(path=str(SHOTS / 'version_differente.png'))
    await pg.click('#bd-version button:has-text("Valider")'); await pg.wait_for_timeout(300)
    ok('« Valider pour la nouvelle version » les réaffiche', await ev(pg, f"[{E}.verrou,{E}.perso.getLayers().length]") == [False, 1])
    await ctx.close()


async def t_charge(b):
    print('\n▶ Charge : 2000 lieux')
    ctx = await b.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block')
    await ctx.route('**/data/tips_gta6.geojson', lambda r: r.fulfill(status=200, body=Path('/tmp/tips2000.geojson').read_text(), content_type='application/json'))
    pg = await page_app(ctx, attente=4000)
    n = await ev(pg, f"{E}.nLieux")
    t = await ev(pg, f"(()=>{{const a=performance.now();for(let i=0;i<5;i++){E}.api.appliquerFiltres();return (performance.now()-a)/5}})()")
    ok('2000 lieux affichés', n == 2000, str(n))
    ok('recalcul complet filtres + marqueurs < 150 ms', t < 150, f'{t:.0f} ms')
    t2 = await ev(pg, f"""new Promise(ok=>{{const m={E}.map,a=performance.now();m.once('zoomend',()=>requestAnimationFrame(()=>ok(performance.now()-a)));m.setZoom(m.getZoom()+1)}})""")
    ok('zoom avec 2000 lieux', t2 < 800, f'{t2:.0f} ms')
    await pg.screenshot(path=str(SHOTS / 'charge_2000.png'))
    await ctx.close()


async def t_horsligne(b):
    print('\n▶ Hors ligne (service worker)')
    ctx = await b.new_context(viewport={'width': 1280, 'height': 800})
    pg = await page_app(ctx, attente=3000)
    await ev(pg, "navigator.serviceWorker.ready")
    await pg.reload(); await pg.wait_for_timeout(3000)   # désormais contrôlée par le SW -> tuiles en cache
    ok('service worker actif', await ev(pg, "!!navigator.serviceWorker.controller"))
    ok('version de cache lisible', bool(await ev(pg, f"{E}.swVersion")), str(await ev(pg, f"{E}.swVersion")))
    await ctx.set_offline(True)
    await pg.reload(); await pg.wait_for_timeout(3000)
    st = await ev(pg, f"({{n:{E}.nLieux, cache:{E}.tips.cache, err:{E}.tips.erreur, tuiles:[...document.querySelectorAll('.leaflet-tile-loaded')].length}})")
    ok('hors ligne : appli + tips (copie) + tuiles', st['n'] == 30 and st['cache'] and st['tuiles'] > 0, str(st))
    await pg.screenshot(path=str(SHOTS / 'hors_ligne.png'))
    await ctx.close()


async def t_tablette(b):
    print('\n▶ Captures format tablette (portrait, gaucher, clair)')
    ctx = await b.new_context(viewport={'width': 800, 'height': 1280}, device_scale_factor=2, has_touch=True, service_workers='block')
    pg = await page_app(ctx)
    await pg.click('#rb-panneau'); await pg.wait_for_timeout(300)
    await pg.screenshot(path=str(SHOTS / 'tablette_portrait_legende.png'))
    await ev(pg, f"{E}.r.gaucher=true;document.body.classList.add('gaucher');{E}.map.invalidateSize()")
    await pg.click('#onglets [data-o="liste"]'); await pg.click('#pan-corps .ligne'); await pg.wait_for_timeout(500)
    await pg.screenshot(path=str(SHOTS / 'tablette_gaucher_fiche.png'))
    await ctx.close()
    ctx = await b.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block')
    pg = await page_app(ctx)
    await pg.click('#rb-menu'); await pg.wait_for_timeout(300)
    await pg.screenshot(path=str(SHOTS / 'menu.png'))
    await pg.click('#modal [data-a="theme"]'); await pg.wait_for_timeout(200)
    await pg.click('#rb-panneau'); await pg.click('#onglets [data-o="filtres"]'); await pg.wait_for_timeout(300)
    ok('thème clair', await ev(pg, "document.body.classList.contains('clair')"))
    await pg.screenshot(path=str(SHOTS / 'clair_filtres.png'))
    await ctx.close()


def fixtures():
    """Fichiers temporaires utilisés par les tests (image de carte perso, 2000 lieux)."""
    import subprocess
    if not Path('/tmp/perso.png').exists():
        from PIL import Image, ImageDraw
        im = Image.new('RGB', (800, 600), (40, 90, 60)); ImageDraw.Draw(im).rectangle([100, 100, 700, 500], outline=(255, 255, 0), width=6); im.save('/tmp/perso.png')
    if not Path('/tmp/tips2000.geojson').exists():
        subprocess.run([sys.executable, str(RAC / 'tools/generer_tips_exemple.py'), '2000', '/tmp/tips2000.geojson'], check=True)


async def main():
    fixtures()
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
        quoi = sys.argv[1:] or ['migration', 'tips_invalides', 'sans_carte', 'filtres', 'stylet', 'version', 'charge', 'horsligne', 'tablette']
        for q in quoi: await globals()['t_' + q](b)
        await b.close()
    ko = [r for r in R if not r[1]]
    print(f'\n{len(R) - len(ko)}/{len(R)} vérifications OK')
    sys.exit(1 if ko else 0)

asyncio.run(main())
