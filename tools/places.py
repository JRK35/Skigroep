"""Haalt plaatsnamen (liften, pistes, restaurants, bars, toppen, dorpjes) van Tignes + Val d'Isère
uit OpenStreetMap en schrijft ze naar places.json, in hetzelfde formaat als de app gebruikt."""
import json, time, urllib.parse, urllib.request

BBOX = '45.40,6.84,45.53,7.07'
Q = (f'[out:json][timeout:120];('
     f'way["aerialway"]["name"]({BBOX});node["aerialway"="station"]["name"]({BBOX});'
     f'way["piste:type"="downhill"]({BBOX});'
     f'nwr["amenity"~"^(restaurant|bar|pub|cafe|fast_food)$"]["name"]({BBOX});'
     f'node["natural"="peak"]["name"]({BBOX});'
     f'node["place"~"^(village|hamlet|locality|neighbourhood)$"]["name"]({BBOX}););out tags geom;')
SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
LIFT = {'chair_lift': '🚡 Stoeltjeslift', 'gondola': '🚠 Gondel', 'cable_car': '🚠 Kabelbaan', 'mixed_lift': '🚠 Lift',
        'drag_lift': '⛷️ Sleeplift', 't-bar': '⛷️ Sleeplift', 'j_bar': '⛷️ Sleeplift', 'platter': '⛷️ Sleeplift',
        'rope_tow': '⛷️ Sleeplift', 'magic_carpet': '🟫 Loopband', 'funicular': '🚞 Funiculaire'}
PISTE = {'novice': '🟢 Piste', 'easy': '🔵 Piste', 'intermediate': '🔴 Piste', 'advanced': '⚫ Piste',
         'expert': '⚫ Piste', 'freeride': '🏔️ Freeride'}

def kind(t):
    if t.get('aerialway') == 'station': return '🚉 Liftstation'
    if t.get('aerialway'): return LIFT.get(t['aerialway'], '🚡 Lift')
    if t.get('piste:type'): return PISTE.get(t.get('piste:difficulty'), '⛷️ Piste')
    a = t.get('amenity')
    if a in ('restaurant', 'fast_food'): return '🍽️'
    if a in ('bar', 'pub'): return '🍺'
    if a == 'cafe': return '☕'
    if t.get('natural') == 'peak': return '⛰️'
    if t.get('place'): return '🏘️'
    return '📍'

def fetch():
    body = urllib.parse.urlencode({'data': Q}).encode()
    for url in SERVERS:
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, data=body, headers={'User-Agent': 'skigroep-app (github.com/JRK35/skigroep)'})
                with urllib.request.urlopen(req, timeout=180) as r:
                    return json.load(r)
            except Exception as e:
                print('mislukt:', url, e); time.sleep(10)
    raise SystemExit('Overpass niet bereikbaar')

def main():
    j, out, seen = fetch(), [], set()
    for el in j.get('elements', []):
        t = el.get('tags', {})
        nm = (t.get('piste:name') or t.get('name') or '').strip()
        if not nm: continue
        if el['type'] == 'node': pts = [[el['lat'], el['lon']]]
        elif el.get('geometry'): pts = [[g['lat'], g['lon']] for g in el['geometry']]
        elif el.get('center'): pts = [[el['center']['lat'], el['center']['lon']]]
        else: continue
        if len(pts) > 30:
            step = -(-len(pts) // 30)
            pts = [p for i, p in enumerate(pts) if i % step == 0 or i == len(pts) - 1]
        k = kind(t); key = (k, nm, round(pts[0][0], 5), round(pts[0][1], 5))
        if key in seen: continue
        seen.add(key)
        out.append({'k': k, 'n': nm[:60], 'p': [[round(a, 5), round(b, 5)] for a, b in pts]})
    if len(out) < 50: raise SystemExit(f'Te weinig plaatsen ({len(out)}), niet opgeslagen')
    with open('places.json', 'w', encoding='utf-8') as f:
        json.dump({'v': 1, 't': int(time.time() * 1000), 'f': out}, f, ensure_ascii=False, separators=(',', ':'))
    print(len(out), 'plaatsen opgeslagen')

main()
