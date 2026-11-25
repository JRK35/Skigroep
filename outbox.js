// Skigroep — gedeeld door de app en de service worker.
// De wachtrij en foto's staan in IndexedDB, zodat ook de service worker ze kan versturen
// (Android: op de achtergrond zodra er bereik is, ook als de app dicht is).
const SG = (() => {
  const NTFY = 'https://ntfy.sh';
  let dbp = null;
  function db(){
    return dbp || (dbp = new Promise((res, rej) => {
      try{
        const q = indexedDB.open('skigroep', 2);
        q.onupgradeneeded = () => {
          const d = q.result;
          if(!d.objectStoreNames.contains('photos')) d.createObjectStore('photos');
          if(!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        };
        q.onsuccess = () => res(q.result);
        q.onerror = () => { dbp = null; rej(q.error) };
      }catch(e){ dbp = null; rej(e) }
    }));
  }
  async function get(store, key){
    try{ const d = await db(); return await new Promise(res => { const r = d.transaction(store).objectStore(store).get(key); r.onsuccess = () => res(r.result === undefined ? null : r.result); r.onerror = () => res(null) }) }
    catch(e){ return null }
  }
  async function put(store, key, val){
    try{ const d = await db(); await new Promise(res => { const tx = d.transaction(store, 'readwrite'); tx.objectStore(store).put(val, key); tx.oncomplete = tx.onerror = tx.onabort = res }); return true }
    catch(e){ return false }
  }
  async function del(store, key){
    try{ const d = await db(); await new Promise(res => { const tx = d.transaction(store, 'readwrite'); tx.objectStore(store).delete(key); tx.oncomplete = tx.onerror = tx.onabort = res }) }
    catch(e){}
  }
  // Eén tegelijk aan de wachtrij werken (app en service worker kunnen allebei bezig zijn)
  const withLock = fn => (self.navigator && navigator.locks) ? navigator.locks.request('skigroep-outbox', fn) : fn();
  const clock = t => new Date(t).toLocaleTimeString('nl-NL', {hour:'2-digit', minute:'2-digit'});
  function note(msg, t){
    if(Date.now() - t <= 90000) return msg;
    const i = msg.indexOf('\n'), n = ` (gedrukt om ${clock(t)})`;
    return i < 0 ? msg + n : msg.slice(0, i) + n + msg.slice(i);
  }
  const verdict = r => r.ok ? 'ok' : (r.status === 429 || r.status >= 500 ? 'retry' : 'drop');
  async function sendOne(item){   // 'ok' | 'retry' | 'drop'
    try{
      if(item.kind === 'photo'){
        const blob = await get('photos', 'out-' + item.uid);
        if(!blob || !item.topic) return 'drop';
        const q = new URLSearchParams({...item.q, message: note(item.q.message || '', item.t)});
        const r = await fetch(`${NTFY}/${item.topic}?${q}`, {method:'PUT', body:blob});
        const v = verdict(r);
        if(v === 'ok'){
          const j = await r.json().catch(() => null);
          if(j && j.id) await put('photos', j.id, blob);   // eigen foto blijft op de telefoon
          await del('photos', 'out-' + item.uid);
        }
        return v;
      }
      const r = await fetch(NTFY, {method:'POST', body: JSON.stringify({...item.body, message: note(item.body.message || '', item.t)})});
      return verdict(r);
    }catch(e){ return 'retry' }
  }
  async function list(){ const l = await get('kv', 'outbox'); return Array.isArray(l) ? l : [] }
  function add(item){
    return withLock(async () => {
      const l = await list(); l.push(item);
      return (await put('kv', 'outbox', l)) ? l.length : 0;
    });
  }
  function flush(){
    return withLock(async () => {
      const l = await list(); let sent = 0;
      while(l.length){
        const it = l[0];
        if(Date.now() - it.t > 12 * 3600e3){ l.shift(); continue }   // na 12 uur heeft het geen zin meer
        const v = await sendOne(it);
        if(v === 'retry') break;
        l.shift(); if(v === 'ok') sent++;
        await put('kv', 'outbox', l);
      }
      await put('kv', 'outbox', l);
      return {sent, left: l.length};
    });
  }
  return {db, get, put, del, list, add, flush, sendOne};
})();
