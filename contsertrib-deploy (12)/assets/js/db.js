/* =====================================================================
   db.js — CONTSERTRIB IndexedDB + localStorage hybrid storage
   In-memory cache for fast reads, IndexedDB for large data,
   localStorage for small keys & backward compatibility
   ===================================================================== */
'use strict';

const IDB_NAME = 'contsertrib_db';
const IDB_VER = 2;
let _idb = null;
const _cache = {};       // in-memory cache
const _pending = [];     // write queue
let _syncTimer = null;

/* ---------- localStorage fallback (small keys) ---------- */
const LS_SMALL = {
  get(k){ try{ const v=localStorage.getItem(k); return v!==null?JSON.parse(v):undefined; }catch(e){ return undefined; } },
  set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} },
  keys(){ const r=[]; for(let i=0;i<localStorage.length;i++){ r.push(localStorage.key(i)); } return r; }
};

/* Small keys stay in localStorage for fast access */
const SMALL_KEYS = new Set(['ct_theme_v2','ct_empresa_v2','ct_config_v2','ct_nomina_config_v2','ct_dashboard_config_v2','ct_plan_overrides_v2','ct_cuenta_map_overrides_v2']);

/* ---------- IndexedDB ---------- */
function openIDB(){
  return new Promise((resolve, reject)=>{
    if(_idb) return resolve(_idb);
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = e=>{
      const db=e.target.result;
      if(!db.objectStoreNames.contains('data')){
        db.createObjectStore('data',{keyPath:'key'});
      }
    };
    req.onsuccess = e=>{ _idb=e.target.result; resolve(_idb); };
    req.onerror = e=>{ console.warn('IndexedDB no disponible, usando localStorage'); resolve(null); };
  });
}

async function idbGet(key){
  const db = await openIDB();
  if(!db) return undefined;
  return new Promise(resolve=>{
    try{
      const tx=db.transaction('data','readonly');
      const st=tx.objectStore('data');
      const req=st.get(key);
      req.onsuccess=()=>resolve(req.result?req.result.value:undefined);
      req.onerror=()=>resolve(undefined);
    }catch(e){ resolve(undefined); }
  });
}

async function idbSet(key, value){
  const db = await openIDB();
  if(!db) return;
  return new Promise(resolve=>{
    try{
      const tx=db.transaction('data','readwrite');
      const st=tx.objectStore('data');
      st.put({key, value});
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>resolve();
    }catch(e){ resolve(); }
  });
}

async function idbDel(key){
  const db = await openIDB();
  if(!db) return;
  return new Promise(resolve=>{
    try{
      const tx=db.transaction('data','readwrite');
      const st=tx.objectStore('data');
      st.delete(key);
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>resolve();
    }catch(e){ resolve(); }
  });
}

async function idbKeys(){
  const db = await openIDB();
  if(!db) return [];
  return new Promise(resolve=>{
    try{
      const tx=db.transaction('data','readonly');
      const st=tx.objectStore('data');
      const req=st.getAllKeys();
      req.onsuccess=()=>resolve(req.result||[]);
      req.onerror=()=>resolve([]);
    }catch(e){ resolve([]); }
  });
}

/* ---------- DB interface (sync-looking, cached) ---------- */
const DB = {
  get(k, fb){
    if(k in _cache) return _cache[k];
    /* Try localStorage first for small keys */
    if(SMALL_KEYS.has(k)){
      const v = LS_SMALL.get(k);
      if(v!==undefined){ _cache[k]=v; return v; }
      if(fb!==undefined){ _cache[k]=fb; return fb; }
      return undefined;
    }
    /* For large keys, read from localStorage (sync fallback) */
    const v = LS_SMALL.get(k);
    if(v!==undefined){ _cache[k]=v; return v; }
    if(fb!==undefined){ _cache[k]=fb; return fb; }
    return undefined;
  },

  set(k, v){
    _cache[k] = v;
    /* Write synchronously to localStorage */
    if(SMALL_KEYS.has(k)){
      LS_SMALL.set(k, v);
    } else {
      LS_SMALL.set(k, v);  /* also sync for now */
    }
    /* Async to IndexedDB for large data */
    if(!SMALL_KEYS.has(k)){
      idbSet(k, v).catch(()=>{});
    }
  },

  del(k){
    delete _cache[k];
    LS_SMALL.del(k);
    idbDel(k).catch(()=>{});
  },

  keys(){
    const all=new Set();
    LS_SMALL.keys().forEach(k=>all.add(k));
    return [...all];
  },

  /* Sync in-memory cache from IndexedDB (async, called on init) */
  async syncNow(){
    const db = await openIDB();
    if(!db) return;
    const allKeys = await idbKeys();
    for(const k of allKeys){
      const v = await idbGet(k);
      if(v!==undefined) _cache[k] = v;
    }
  },

  /* Load large key from IDB into cache (async) */
  async loadKey(k){
    const v = await idbGet(k);
    if(v!==undefined){ _cache[k] = v; LS_SMALL.set(k, v); }
    return v;
  },

  /* Flush all cache to storage */
  flush(){
    Object.entries(_cache).forEach(([k,v])=>{
      LS_SMALL.set(k, v);
      if(!SMALL_KEYS.has(k)) idbSet(k, v).catch(()=>{});
    });
  }
};

/* ---------- Init: load all IDB data into cache ---------- */
(async ()=>{
  try{
    await DB.syncNow();
  }catch(e){
    console.warn('Error sincronizando IndexedDB:', e);
  }
})();

window.DB = DB;