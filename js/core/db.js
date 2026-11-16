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
          db.onversionchange = () => { db.close(); if (dbp === p) dbp = null; };
          // El navegador puede cerrar la conexión por su cuenta (Safari/iOS lo hace al pasar
          // la app a segundo plano o al liberar memoria): la próxima operación abre otra.
          db.onclose = () => { if (dbp === p) dbp = null; };
          resolve(db);
        };
        req.onerror = () => { if (dbp === p) dbp = null; reject(req.error); };
      });
      const p = dbp;
    }
    return dbp;
  }

  /**
   * Ejecuta una transacción. Si falla porque la conexión estaba cerrada o se perdió
   * (habitual en Safari/iOS tras volver de segundo plano), reabre la base de datos y
   * lo intenta una vez más. Las operaciones son idempotentes (put/delete/get), así que
   * repetirlas es seguro.
   */
  async function run(stores, mode, fill) {
    for (let attempt = 0; ; attempt++) {
      try {
        const db = await open();
        return await new Promise((res, rej) => {
          const t = db.transaction(stores, mode);
          let result;
          fill(t, (v) => { result = v; });
          t.oncomplete = () => res(result);
          t.onerror = () => rej(t.error);
          t.onabort = () => rej(t.error || new DOMException('Transacción abortada', 'AbortError'));
        });
      } catch (e) {
        if (attempt >= 1 || (e && e.name === 'QuotaExceededError')) throw e;
        // Conexión inservible: se descarta para que open() cree una nueva.
        const old = dbp;
        dbp = null;
        try { (await old)?.close(); } catch (_) {}
      }
    }
  }

  DB.getAll = (store) => run(store, 'readonly', (t, set) => {
    const r = t.objectStore(store).getAll();
    r.onsuccess = () => set(r.result);
  });

  DB.put = async (store, items) => {
    items = [].concat(items);
    if (!items.length) return;
    return run(store, 'readwrite', (t) => {
      const os = t.objectStore(store);
      for (const it of items) os.put(it);
    });
  };

  DB.del = async (store, keys) => {
    keys = [].concat(keys);
    if (!keys.length) return;
    return run(store, 'readwrite', (t) => {
      const os = t.objectStore(store);
      for (const k of keys) os.delete(k);
    });
  };

  DB.clear = (stores = DB.STORES) => run(stores, 'readwrite', (t) => {
    for (const s of stores) t.objectStore(s).clear();
  });
})(window.App);
