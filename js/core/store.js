/*
 * Colección en memoria + persistencia. Es la "capa de datos" de la app:
 * la interfaz solo habla con App.store, nunca con IndexedDB directamente.
 *
 * Entidades:
 *  Deck   { id, name ("Padre::Hijo"), created, mod }
 *  Note   { id, guid, deckId, type, fields{}, tags[], created, mod }
 *  Card   { id, noteId, deckId, ord, state, due, interval, ease, step, reps, lapses, position, suspended, mod }
 *  Review { id (= fecha ms), cardId, deckId, rating, prevState, state, interval, prevInterval, ease, timeMs }
 *  Media  { name, blob }
 */
(function (App) {
  'use strict';
  const U = App.util;
  const DB = App.db;
  const S = (App.store = {});

  const decks = new Map();
  const notes = new Map();
  const cards = new Map();
  const media = new Map(); // name -> { blob, url }
  let revlog = [];
  let settings = {};
  let nextPosition = 1;

  // ---------- Arranque ----------
  S.init = async () => {
    const [d, n, c, r, m, meta] = await Promise.all(DB.STORES.map((s) => DB.getAll(s)));
    for (const x of d) { decks.set(x.id, x); U.bumpId(x.id); }
    for (const x of n) { notes.set(x.id, x); U.bumpId(x.id); }
    for (const x of c) {
      cards.set(x.id, x);
      U.bumpId(x.id);
      if ((x.position || 0) >= nextPosition) nextPosition = x.position + 1;
    }
    revlog = r.sort((a, b) => a.id - b.id);
    for (const x of revlog) U.bumpId(x.id);
    for (const x of m) media.set(x.name, { blob: x.blob, url: null });
    const metaMap = Object.fromEntries(meta.map((x) => [x.key, x.value]));
    settings = { ...App.config.defaults, ...(metaMap.settings || {}) };
    if (!decks.size && !metaMap.seeded) await seed();
  };

  // ---------- Ajustes ----------
  S.settings = () => ({ ...settings });
  S.saveSettings = async (patch) => {
    settings = { ...settings, ...patch };
    await DB.put('meta', { key: 'settings', value: settings });
  };

  // ---------- Mazos ----------
  const nameParts = (name) => name.split('::').map((p) => p.trim());
  const cmpNames = (a, b) => {
    const pa = nameParts(a), pb = nameParts(b);
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
      const c = pa[i].localeCompare(pb[i], 'es', { sensitivity: 'base', numeric: true });
      if (c) return c;
    }
    return pa.length - pb.length;
  };
  const cleanName = (name) => nameParts(String(name)).filter(Boolean).join('::');

  S.decks = () => [...decks.values()].sort((a, b) => cmpNames(a.name, b.name));
  S.deck = (id) => decks.get(id);
  S.deckByName = (name) => {
    const n = cleanName(name).toLowerCase();
    for (const d of decks.values()) if (d.name.toLowerCase() === n) return d;
    return null;
  };
  S.shortName = (deck) => nameParts(deck.name).pop();

  /** Devuelve el mazo con ese nombre, creándolo (y a sus padres) si no existe. */
  S.ensureDeck = async (name) => {
    const clean = cleanName(name) || 'Sin nombre';
    const parts = nameParts(clean);
    const created = [];
    let deck = null;
    for (let i = 1; i <= parts.length; i++) {
      const partial = parts.slice(0, i).join('::');
      deck = S.deckByName(partial);
      if (!deck) {
        deck = { id: U.newId(), name: partial, created: Date.now(), mod: Date.now() };
        decks.set(deck.id, deck);
        created.push(deck);
      }
    }
    await DB.put('decks', created);
    return deck;
  };

  S.renameDeck = async (id, newName) => {
    const deck = decks.get(id);
    const clean = cleanName(newName);
    if (!deck || !clean) return;
    const other = S.deckByName(clean);
    if (other && other.id !== id) throw new Error('Ya existe un mazo con ese nombre.');
    const old = deck.name;
    const changed = [];
    for (const d of decks.values()) {
      if (d.id === id || d.name.startsWith(old + '::')) {
        d.name = clean + d.name.slice(old.length);
        d.mod = Date.now();
        changed.push(d);
      }
    }
    await DB.put('decks', changed);
    // Crea los padres si el nuevo nombre los necesita.
    if (clean.includes('::')) await S.ensureDeck(nameParts(clean).slice(0, -1).join('::'));
  };

  /** Ids del mazo y todos sus submazos. */
  S.deckFamilyIds = (id) => {
    const deck = decks.get(id);
    const ids = new Set();
    if (!deck) return ids;
    for (const d of decks.values()) if (d.id === id || d.name.startsWith(deck.name + '::')) ids.add(d.id);
    return ids;
  };

  S.deleteDeck = async (id) => {
    const ids = S.deckFamilyIds(id);
    const noteIds = [...notes.values()].filter((n) => ids.has(n.deckId)).map((n) => n.id);
    await S.deleteNotes(noteIds);
    // Tarjetas sueltas de otras notas que estuvieran en estos mazos -> se borran también.
    const orphan = [...cards.values()].filter((c) => ids.has(c.deckId)).map((c) => c.id);
    orphan.forEach((cid) => cards.delete(cid));
    await DB.del('cards', orphan);
    ids.forEach((d) => decks.delete(d));
    await DB.del('decks', [...ids]);
  };

  S.deckCardCount = (id) => {
    const ids = S.deckFamilyIds(id);
    let n = 0;
    for (const c of cards.values()) if (ids.has(c.deckId)) n++;
    return n;
  };

  // ---------- Notas y tarjetas ----------
  S.note = (id) => notes.get(id);
  S.card = (id) => cards.get(id);
  S.allNotes = () => [...notes.values()];
  S.allCards = () => [...cards.values()];
  S.noteCount = () => notes.size;
  S.cardCount = () => cards.size;
  S.cardsOfNote = (noteId) => [...cards.values()].filter((c) => c.noteId === noteId);
  S.cardsByNote = () => {
    const map = new Map();
    for (const c of cards.values()) {
      if (!map.has(c.noteId)) map.set(c.noteId, []);
      map.get(c.noteId).push(c);
    }
    return map;
  };

  /** Crea una tarjeta nueva (sin guardar). */
  S.makeCard = (note, ord) => ({
    id: U.newId(),
    noteId: note.id,
    deckId: note.deckId,
    ord,
    state: 'new',
    due: 0,
    interval: 0,
    ease: settings.startingEase,
    step: 0,
    reps: 0,
    lapses: 0,
    position: nextPosition++,
    suspended: false,
    mod: Date.now()
  });

  /** Crea o actualiza una nota y sincroniza sus tarjetas. */
  S.saveNote = async ({ id, deckId, type, fields, tags }) => {
    const now = Date.now();
    let note = id ? notes.get(id) : null;
    const deckChanged = note && note.deckId !== deckId;
    if (note) {
      Object.assign(note, { deckId, type, fields, tags, mod: now });
    } else {
      note = { id: U.newId(), guid: U.newGuid(), deckId, type, fields, tags, created: now, mod: now };
      notes.set(note.id, note);
    }
    const wanted = new Set(App.cards.ordsFor(note));
    const existing = S.cardsOfNote(note.id);
    const toDelete = existing.filter((c) => !wanted.has(c.ord));
    const have = new Set(existing.map((c) => c.ord));
    const toAdd = [...wanted].filter((o) => !have.has(o)).map((o) => S.makeCard(note, o));
    const toUpdate = deckChanged ? existing.filter((c) => wanted.has(c.ord)) : [];
    toUpdate.forEach((c) => { c.deckId = deckId; c.mod = now; });
    toDelete.forEach((c) => cards.delete(c.id));
    toAdd.forEach((c) => cards.set(c.id, c));
    await DB.put('notes', note);
    await DB.put('cards', [...toAdd, ...toUpdate]);
    await DB.del('cards', toDelete.map((c) => c.id));
    return note;
  };

  S.deleteNotes = async (ids) => {
    const set = new Set(ids);
    const cardIds = [...cards.values()].filter((c) => set.has(c.noteId)).map((c) => c.id);
    cardIds.forEach((c) => cards.delete(c));
    ids.forEach((n) => notes.delete(n));
    await DB.del('cards', cardIds);
    await DB.del('notes', ids);
  };

  /** Pospone una tarjeta hasta el próximo día de estudio (sin tocar su programación). */
  S.buryCard = async (cardId) => {
    const c = cards.get(cardId);
    if (!c) return;
    c.buriedUntil = U.dayStart(1);
    c.mod = Date.now();
    await DB.put('cards', c);
  };

  S.setSuspended = async (noteId, suspended) => {
    const cs = S.cardsOfNote(noteId);
    cs.forEach((c) => { c.suspended = suspended; c.mod = Date.now(); });
    await DB.put('cards', cs);
  };

  /** Inserción masiva (importaciones). */
  S.importBatch = async ({ notes: ns = [], cards: cs = [], media: ms = [] }) => {
    ns.forEach((n) => notes.set(n.id, n));
    cs.forEach((c) => {
      cards.set(c.id, c);
      if ((c.position || 0) >= nextPosition) nextPosition = c.position + 1;
    });
    ms.forEach((m) => media.set(m.name, { blob: m.blob, url: null }));
    await DB.put('notes', ns);
    await DB.put('cards', cs);
    await DB.put('media', ms);
  };

  S.hasGuid = (() => {
    let cache = null, size = -1;
    return (guid) => {
      if (!cache || size !== notes.size) {
        cache = new Set([...notes.values()].map((n) => n.guid));
        size = notes.size;
      }
      return cache.has(guid);
    };
  })();

  // ---------- Estudio ----------
  /** Colas de estudio de un mazo (incluye submazos) respetando los límites diarios. */
  S.studyState = (deckId, now = Date.now()) => {
    const ids = S.deckFamilyIds(deckId);
    const todayStart = U.dayStart(0, now);
    const tomorrow = U.dayStart(1, now);

    let newDone = 0, revDone = 0;
    // Hermanas: si hoy ya respondiste una tarjeta de una nota, las demás tarjetas
    // nuevas/de repaso de esa nota se posponen a mañana (como «enterrar» en Anki).
    const bury = settings.burySiblings !== false;
    const answeredNotes = new Set(), answeredCards = new Set();
    for (let i = revlog.length - 1; i >= 0; i--) {
      const l = revlog[i];
      if (l.id < todayStart) break;
      if (bury) {
        const ac = cards.get(l.cardId);
        if (ac) { answeredNotes.add(ac.noteId); answeredCards.add(ac.id); }
      }
      if (!ids.has(l.deckId)) continue;
      if (l.prevState === 'new') newDone++;
      else if (l.prevState === 'review') revDone++;
    }

    const learnDue = [], learnLater = [], reviews = [], news = [];
    for (const c of cards.values()) {
      if (!ids.has(c.deckId) || c.suspended) continue;
      if (c.buriedUntil && c.buriedUntil > now) continue; // pospuesta a mano hasta mañana
      const buried = bury && (c.state === 'new' || c.state === 'review') &&
        answeredNotes.has(c.noteId) && !answeredCards.has(c.id);
      if (buried) continue;
      if (c.state === 'new') news.push(c);
      else if (c.state === 'learning' || c.state === 'relearning') {
        if (c.due <= now) learnDue.push(c);
        else if (c.due < tomorrow) learnLater.push(c);
      } else if (c.state === 'review' && c.due < tomorrow) reviews.push(c);
    }
    learnDue.sort((a, b) => a.due - b.due);
    learnLater.sort((a, b) => a.due - b.due);
    reviews.sort((a, b) => a.due - b.due || a.id - b.id);
    news.sort((a, b) => a.position - b.position);

    const newLimited = news.slice(0, Math.max(0, settings.newPerDay - newDone));
    const revLimited = reviews.slice(0, Math.max(0, settings.reviewsPerDay - revDone));

    return {
      learnDue,
      learnLater,
      reviews: revLimited,
      news: newLimited,
      counts: { new: newLimited.length, learn: learnDue.length + learnLater.length, review: revLimited.length }
    };
  };

  /** Siguiente tarjeta a estudiar, o null. */
  S.nextCard = (deckId, now = Date.now()) => {
    const st = S.studyState(deckId, now);
    let card = null, queue = null;
    if (st.learnDue.length) { card = st.learnDue[0]; queue = 'learn'; }
    else if (st.reviews.length) { card = st.reviews[0]; queue = 'review'; }
    else if (st.news.length) { card = st.news[0]; queue = 'new'; }
    else if (st.learnLater.length && st.learnLater[0].due - now <= settings.learnAheadMinutes * 60000) {
      card = st.learnLater[0];
      queue = 'learn';
    }
    return { card, queue, state: st };
  };

  S.answer = async (cardId, rating, timeMs) => {
    const card = cards.get(cardId);
    const prev = { ...card };
    const now = Date.now();
    Object.assign(card, App.scheduler.answer(card, rating, settings, now), { mod: now });
    const log = {
      id: U.newId(), cardId, deckId: card.deckId, rating,
      prevState: prev.state, state: card.state,
      interval: card.interval, prevInterval: prev.interval, ease: card.ease,
      timeMs: Math.min(timeMs, 60000)
    };
    revlog.push(log);
    try {
      await DB.put('cards', card);
      await DB.put('revlog', log);
    } catch (e) {
      // No se guardó: deja la tarjeta y el historial como estaban para poder reintentar.
      Object.keys(card).forEach((k) => delete card[k]);
      Object.assign(card, prev);
      revlog = revlog.filter((l) => l !== log);
      DB.put('cards', prev).catch(() => {});
      throw e;
    }
    return { prev, log };
  };

  S.undo = async ({ prev, log }) => {
    const card = cards.get(prev.id);
    if (!card) return;
    Object.keys(card).forEach((k) => delete card[k]);
    Object.assign(card, prev);
    revlog = revlog.filter((l) => l.id !== log.id);
    await DB.put('cards', card);
    await DB.del('revlog', log.id);
  };

  S.todayStats = (now = Date.now()) => {
    const start = U.dayStart(0, now);
    let reviews = 0, timeMs = 0;
    for (let i = revlog.length - 1; i >= 0 && revlog[i].id >= start; i--) { reviews++; timeMs += revlog[i].timeMs || 0; }
    return { reviews, timeMs };
  };

  // ---------- Multimedia ----------
  S.mediaUrl = (name) => {
    const m = media.get(name);
    if (!m) return null;
    if (!m.url) m.url = URL.createObjectURL(m.blob);
    return m.url;
  };
  S.mediaBlob = (name) => media.get(name)?.blob || null;
  S.hasMedia = (name) => media.has(name);

  /** Guarda un archivo y devuelve el nombre definitivo (único). */
  S.addMedia = async (blob, preferredName) => {
    let name = U.safeFilename(preferredName || 'archivo').replace(/\s+/g, '_');
    if (media.has(name)) {
      const dot = name.lastIndexOf('.');
      const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
      name = `${base}-${U.newId().toString(36)}${ext}`;
    }
    media.set(name, { blob, url: null });
    await DB.put('media', { name, blob });
    return name;
  };

  // ---------- Copias de seguridad (JSON) ----------
  S.exportBackup = async () => {
    const mediaOut = [];
    for (const [name, m] of media) mediaOut.push({ name, dataUrl: await U.blobToDataUrl(m.blob) });
    return {
      app: App.config.appName,
      format: 1,
      exportedAt: new Date().toISOString(),
      settings,
      decks: [...decks.values()],
      notes: [...notes.values()],
      cards: [...cards.values()],
      revlog,
      media: mediaOut
    };
  };

  S.importBackup = async (data) => {
    if (!data || data.format !== 1 || !Array.isArray(data.notes)) throw new Error('El archivo no es una copia de seguridad válida.');
    const mediaIn = [];
    for (const m of data.media || []) mediaIn.push({ name: m.name, blob: await U.dataUrlToBlob(m.dataUrl) });
    await DB.clear();
    await DB.put('decks', data.decks || []);
    await DB.put('notes', data.notes);
    await DB.put('cards', data.cards || []);
    await DB.put('revlog', data.revlog || []);
    await DB.put('media', mediaIn);
    await DB.put('meta', [{ key: 'settings', value: data.settings || {} }, { key: 'seeded', value: true }]);
  };

  S.resetAll = async () => {
    await DB.clear();
    await DB.put('meta', { key: 'seeded', value: true });
  };

  // ---------- Mazo de ejemplo ----------
  async function seed() {
    const deck = await S.ensureDeck('Bienvenida');
    const samples = [
      { type: 'basic', fields: { front: '¿Qué es el <b>repaso espaciado</b>?', back: 'Una técnica que te muestra cada tarjeta justo antes de que la olvides: cuanto mejor la sabes, más tarda en volver.' } },
      { type: 'basic', fields: { front: '¿Qué significan los botones <i>Otra vez · Difícil · Bien · Fácil</i>?', back: 'Indican lo bien que recordabas la respuesta. Según lo que pulses, la tarjeta vuelve en minutos o en días.' } },
      { type: 'reverse', fields: { front: 'Capital de Japón', back: 'Tokio' } },
      { type: 'cloze', fields: { text: 'El {{c1::corazón}} bombea la sangre y los {{c2::pulmones}} la oxigenan.', extra: 'Las notas de tipo <i>Rellenar huecos</i> crean una tarjeta por cada hueco.' } }
    ];
    for (const s of samples) await S.saveNote({ deckId: deck.id, tags: ['ejemplo'], ...s });
    await DB.put('meta', { key: 'seeded', value: true });
  }

  /** Respuestas registradas desde `ts` en los mazos `deckIds` (Set). Las deshechas ya no están. */
  S.reviewsSince = (ts, deckIds) => {
    const out = [];
    for (let i = revlog.length - 1; i >= 0 && revlog[i].id >= ts; i--) {
      if (!deckIds || deckIds.has(revlog[i].deckId)) out.push(revlog[i]);
    }
    return out.reverse();
  };

  /** Tarjetas hermanas que studyState ha pospuesto hoy (misma regla de «enterrar»). */
  S.buriedSiblingsCount = (deckId, now = Date.now()) => {
    if (settings.burySiblings === false) return 0;
    const ids = S.deckFamilyIds(deckId);
    const todayStart = U.dayStart(0, now);
    const tomorrow = U.dayStart(1, now);
    const answeredNotes = new Set(), answeredCards = new Set();
    for (let i = revlog.length - 1; i >= 0 && revlog[i].id >= todayStart; i--) {
      const ac = cards.get(revlog[i].cardId);
      if (ac) { answeredNotes.add(ac.noteId); answeredCards.add(ac.id); }
    }
    let n = 0;
    for (const c of cards.values()) {
      if (!ids.has(c.deckId) || c.suspended || answeredCards.has(c.id) || !answeredNotes.has(c.noteId)) continue;
      if (c.state === 'new' || (c.state === 'review' && c.due < tomorrow)) n++;
    }
    return n;
  };

  // ---------- Acciones masivas (explorador) ----------
  /** Suspende o reactiva todas las tarjetas de varias notas. */
  S.setSuspendedMany = async (noteIds, suspended) => {
    const set = new Set(noteIds);
    const now = Date.now();
    const cs = [...cards.values()].filter((c) => set.has(c.noteId));
    cs.forEach((c) => { c.suspended = suspended; c.mod = now; });
    await DB.put('cards', cs);
    return cs.length;
  };

  /** Mueve varias notas (y sus tarjetas) a otro mazo. */
  S.moveNotes = async (noteIds, deckId) => {
    if (!decks.has(deckId)) throw new Error('El mazo de destino no existe.');
    const set = new Set(noteIds);
    const now = Date.now();
    const ns = [...notes.values()].filter((n) => set.has(n.id) && n.deckId !== deckId);
    ns.forEach((n) => { n.deckId = deckId; n.mod = now; });
    const moved = new Set(ns.map((n) => n.id));
    const cs = [...cards.values()].filter((c) => moved.has(c.noteId));
    cs.forEach((c) => { c.deckId = deckId; c.mod = now; });
    await DB.put('notes', ns);
    await DB.put('cards', cs);
    return ns.length;
  };

  /** Foto del mazo y la suspensión de varias notas y sus tarjetas (para «Deshacer»). */
  S.snapshotNotes = (noteIds) => {
    const set = new Set(noteIds);
    return {
      notes: [...notes.values()].filter((n) => set.has(n.id)).map((n) => [n.id, n.deckId]),
      cards: [...cards.values()].filter((c) => set.has(c.noteId)).map((c) => [c.id, c.deckId, !!c.suspended])
    };
  };

  /** Restaura una foto de S.snapshotNotes (las notas o mazos ya borrados se ignoran). */
  S.restoreNotes = async (snap) => {
    const now = Date.now();
    const ns = [], cs = [];
    for (const [id, deckId] of snap.notes) {
      const n = notes.get(id);
      if (n && decks.has(deckId) && n.deckId !== deckId) { n.deckId = deckId; n.mod = now; ns.push(n); }
    }
    for (const [id, deckId, susp] of snap.cards) {
      const c = cards.get(id);
      if (!c) continue;
      const d = decks.has(deckId) ? deckId : c.deckId;
      if (c.deckId !== d || !!c.suspended !== susp) { c.deckId = d; c.suspended = susp; c.mod = now; cs.push(c); }
    }
    await DB.put('notes', ns);
    await DB.put('cards', cs);
  };

  /** Número de archivos multimedia guardados (para avisos de borrado). */
  S.mediaCount = () => media.size;
})(window.App);
