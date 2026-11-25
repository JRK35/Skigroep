// Skigroep service worker
// - bewaart de app op de telefoon, zodat hij ook zonder bereik opstart
// - bewaart bekeken kaartstukjes, zodat de kaart offline blijft werken
// - Android: verstuurt wachtende berichten zodra er bereik is, ook als de app dicht is
importScripts('outbox.js');

const APP = 'skigroep-app-v1';
const TILES = 'skigroep-tiles';
const SHELL = ['./', './index.html', './outbox.js', './manifest.json', './icon-192.png', './icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for(const k of await caches.keys()) if(k !== APP && k !== TILES) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if(r.method !== 'GET') return;
  const u = new URL(r.url);
  if(u.hostname === 'ntfy.sh' || u.hostname.includes('overpass')) return;   // altijd live
  if(u.hostname.endsWith('tile.openstreetmap.org')){ e.respondWith(tile(r)); return }
  if(u.hostname.endsWith('opensnowmap.org')) return;                          // pistelaag: alleen online
  if(u.origin === self.location.origin){ e.respondWith(appFirstNet(r)); return }
  e.respondWith(cacheFirst(r));                                               // leaflet, lettertypes
});

// App-bestanden: liefst de nieuwste van internet, maar na 3 s (of zonder bereik) de bewaarde versie
async function appFirstNet(r){
  const c = await caches.open(APP);
  const net = fetch(r).then(res => { if(res.ok) c.put(r, res.clone()); return res });
  let cached = await c.match(r, {ignoreSearch:true});
  if(!cached && r.mode === 'navigate') cached = await c.match('./index.html') || await c.match('./');
  if(!cached) return net.catch(() => Response.error());
  return Promise.race([
    net.catch(() => cached),
    new Promise(res => setTimeout(() => res(cached), 3000))
  ]);
}

async function cacheFirst(r){
  const c = await caches.open(APP);
  const hit = await c.match(r);
  if(hit) return hit;
  try{ const res = await fetch(r); if(res.ok) c.put(r, res.clone()); return res }
  catch(e){ return Response.error() }
}

let trimming = false;
async function tile(r){
  const c = await caches.open(TILES);
  const hit = await c.match(r);
  if(hit) return hit;
  try{
    const res = await fetch(r);
    if(res.ok){ await c.put(r, res.clone()); trim(c) }
    return res;
  }catch(e){ return Response.error() }
}
async function trim(c){   // maximaal ±2500 kaartstukjes (ongeveer 50 MB)
  if(trimming) return; trimming = true;
  try{ const keys = await c.keys(); for(const k of keys.slice(0, Math.max(0, keys.length - 2500))) await c.delete(k) }catch(e){}
  trimming = false;
}

// Android/Chrome: Background Sync — de telefoon roept dit aan zodra er weer bereik is
self.addEventListener('sync', e => {
  if(e.tag === 'outbox') e.waitUntil(SG.flush().then(r => { if(r && r.left) throw new Error('nog niet alles verstuurd') }));
});
