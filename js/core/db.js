/*
 * Persistencia local con IndexedDB.
 * En Flutter esto se sustituye por SQLite (paquete drift o sqflite) con las mismas "tablas".
 */
(function (App) {
  'use strict';
  const DB = (App.db = {});
  const DB_NAME = 'recallo';
  const VERSION = 1;
  const STORES = { decks: 'id', notes: 'id', cards: 'id', revlog: 'id', media: 'name', meta: 'key' };
  DB.STORES = Object.keys(STORES);

  let dbp = null;
  function open() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const [name, keyPath] of Object.entries(STORES)) {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
          }
        };
        // Otra pestaña con una versión antigua abierta impide actualizar: se avisa a la app
        // (la petición sigue esperando y se resuelve sola si la otra pestaña se cierra).
        req.onblocked = () => { if (typeof DB.onblocked === 'function') DB.onblocked(); };
        req.onsuccess = () => {
          const db = req.result;
          // Si otra pestaña necesita actualizar la base de datos, cedemos la conexión.
          db.onversionchange = () => { db.close(); dbp = null; };
          resolve(db);
        };
        req.onerror = () => { dbp = null; reject(req.error); };
      });
    }
    return dbp;
  }

  const done = (t) => new Promise((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Transacción abortada'));
  });

  DB.getAll = async (store) => {
    const db = await open();
    return new Promise((res, rej) => {
      const r = db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  };

  DB.put = async (store, items) => {
    items = [].concat(items);
    if (!items.length) return;
    const db = await open();
    const t = db.transaction(store, 'readwrite');
    const os = t.objectStore(store);
    for (const it of items) os.put(it);
    return done(t);
  };

  DB.del = async (store, keys) => {
    keys = [].concat(keys);
    if (!keys.length) return;
    const db = await open();
    const t = db.transaction(store, 'readwrite');
    const os = t.objectStore(store);
    for (const k of keys) os.delete(k);
    return done(t);
  };

  DB.clear = async (stores = DB.STORES) => {
    const db = await open();
    const t = db.transaction(stores, 'readwrite');
    for (const s of stores) t.objectStore(s).clear();
    return done(t);
  };
})(window.App);
