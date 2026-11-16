/*
 * Importar / exportar mazos de Anki (.apkg y .colpkg).
 *
 * Un .apkg es un ZIP con:
 *   - collection.anki2 / collection.anki21  -> base de datos SQLite (esquema 11)
 *   - collection.anki21b                    -> SQLite comprimido con zstd (esquema 18, Anki 2.1.50+)
 *   - media                                 -> índice de archivos (JSON, o protobuf+zstd en el formato nuevo)
 *   - 0, 1, 2...                            -> los archivos multimedia
 *
 * Las librerías (JSZip, sql.js, fzstd) se cargan solo cuando hacen falta.
 * Exportamos en formato clásico (collection.anki2), que cualquier versión de Anki importa.
 */
(function (App) {
  'use strict';
  const U = App.util;
  const S = App.store;
  const C = App.cards;
  const A = (App.anki = {});

  const LIBS = {
    jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    sqljsBase: 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/',
    fzstd: 'https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js'
  };

  let SQL = null;
  async function ensureLibs({ zstd = false } = {}) {
    if (!window.JSZip) await U.loadScript(LIBS.jszip);
    if (!SQL) {
      if (!window.initSqlJs) await U.loadScript(LIBS.sqljsBase + 'sql-wasm.js');
      SQL = await window.initSqlJs({ locateFile: (f) => LIBS.sqljsBase + f });
    }
    if (zstd && !window.fzstd) await U.loadScript(LIBS.fzstd);
  }

  function rows(db, sql, params) {
    const stmt = db.prepare(sql);
    if (params) stmt.bind(params);
    const out = [];
    while (stmt.step()) out.push(stmt.getAsObject());
    stmt.free();
    return out;
  }

  // ---------- Mini lector de protobuf (para el formato nuevo de Anki) ----------
  function readVarint(buf, pos) {
    let result = 0, shift = 0, b;
    do {
      b = buf[pos++];
      result += (b & 0x7f) * Math.pow(2, shift);
      shift += 7;
    } while (b & 0x80 && pos < buf.length);
    return [result, pos];
  }

  /** Recorre los campos de un mensaje protobuf: cb(numCampo, tipo, valor) */
  function protoFields(buf, cb) {
    let pos = 0;
    while (pos < buf.length) {
      let key;
      [key, pos] = readVarint(buf, pos);
      const field = Math.floor(key / 8), wt = key % 8;
      if (wt === 0) { let v; [v, pos] = readVarint(buf, pos); cb(field, wt, v); }
      else if (wt === 2) { let len; [len, pos] = readVarint(buf, pos); cb(field, wt, buf.subarray(pos, pos + len)); pos += len; }
      else if (wt === 5) pos += 4;
      else if (wt === 1) pos += 8;
      else break;
    }
  }

  function parseMediaEntries(buf) {
    const names = [];
    const dec = new TextDecoder();
    protoFields(buf, (f, wt, v) => {
      if (f === 1 && wt === 2) {
        let name = '';
        protoFields(v, (f2, wt2, v2) => { if (f2 === 1 && wt2 === 2) name = dec.decode(v2); });
        names.push(name);
      }
    });
    return names;
  }

  function isClozeConfig(buf) {
    let kind = 0;
    if (buf && buf.length) protoFields(buf, (f, wt, v) => { if (f === 1 && wt === 0) kind = v; });
    return kind === 1;
  }

  // ================= IMPORTAR =================
  /**
   * @param {File} file  .apkg o .colpkg
   * @param {{keepProgress?: boolean}} opts
   * @returns resumen de la importación
   */
  A.importApkg = async (file, { keepProgress = true } = {}) => {
    await ensureLibs();
    const zip = await window.JSZip.loadAsync(file);
    let entry = zip.file('collection.anki21b');
    const zstd = !!entry;
    if (!entry) entry = zip.file('collection.anki21') || zip.file('collection.anki2');
    if (!entry) throw new Error('El archivo no parece un mazo de Anki (.apkg o .colpkg).');
    if (zstd) await ensureLibs({ zstd: true });

    let bytes = await entry.async('uint8array');
    if (zstd) bytes = window.fzstd.decompress(bytes);

    const db = new SQL.Database(bytes);
    let parsed;
    try {
      parsed = readCollection(db);
    } finally {
      db.close();
    }

    // Índice de multimedia
    const mediaMap = {};
    const mf = zip.file('media');
    if (mf) {
      try {
        if (zstd) parseMediaEntries(window.fzstd.decompress(await mf.async('uint8array'))).forEach((n, i) => { if (n) mediaMap[String(i)] = n; });
        else Object.assign(mediaMap, JSON.parse(await mf.async('string')));
      } catch (e) {
        console.warn('No se pudo leer el índice de multimedia', e);
      }
    }

    const fallbackDeckName = file.name.replace(/\.(apkg|colpkg)$/i, '') || 'Importado';
    return buildImport(parsed, { keepProgress, zip, zstd, mediaMap, fallbackDeckName });
  };

  function readCollection(db) {
    const hasNotetypes = rows(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='notetypes'").length > 0;
    const col = rows(db, 'SELECT * FROM col')[0] || {};
    const crt = col.crt || 0;
    const deckNames = {};
    const models = {};

    if (hasNotetypes) {
      for (const d of rows(db, 'SELECT id, name FROM decks')) deckNames[d.id] = String(d.name).split('\x1f').join('::');
      const tcount = {};
      for (const t of rows(db, 'SELECT ntid, COUNT(*) AS n FROM templates GROUP BY ntid')) tcount[t.ntid] = t.n;
      for (const m of rows(db, 'SELECT id, name, config FROM notetypes')) {
        models[m.id] = { name: m.name, cloze: isClozeConfig(m.config), tmplCount: tcount[m.id] || 1 };
      }
    } else {
      const ds = JSON.parse(col.decks || '{}');
      for (const k in ds) deckNames[k] = ds[k].name;
      const ms = JSON.parse(col.models || '{}');
      for (const k in ms) models[k] = { name: ms[k].name, cloze: ms[k].type === 1, tmplCount: (ms[k].tmpls || []).length || 1 };
    }

    const notes = rows(db, 'SELECT id, guid, mid, tags, flds FROM notes ORDER BY id');
    const cards = rows(db, 'SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses FROM cards ORDER BY due, id');
    return { crt, deckNames, models, notes, cards };
  }

  async function buildImport(parsed, { keepProgress, zip, zstd, mediaMap, fallbackDeckName }) {
    const { crt, deckNames, models } = parsed;
    const cardsByNote = new Map();
    for (const c of parsed.cards) {
      if (!cardsByNote.has(c.nid)) cardsByNote.set(c.nid, []);
      cardsByNote.get(c.nid).push(c);
    }

    const deckIdMap = {};
    const decksUsed = new Set();
    const getDeck = async (did) => {
      if (deckIdMap[did]) return deckIdMap[did];
      let name = deckNames[did] || fallbackDeckName;
      if (name === 'Default' || name === 'Predeterminado') name = fallbackDeckName;
      const d = await S.ensureDeck(name);
      decksUsed.add(d.id);
      return (deckIdMap[did] = d.id);
    };

    const newNotes = [], newCards = [];
    let skipped = 0;
    const now = Date.now();

    for (const n of parsed.notes) {
      if (S.hasGuid(n.guid)) { skipped++; continue; }
      const ankiCards = cardsByNote.get(n.id) || [];
      if (!ankiCards.length) continue;
      const m = models[n.mid] || { cloze: false, tmplCount: 1 };
      const flds = String(n.flds).split('\x1f');
      const rest = flds.slice(1).filter((x) => x.trim());
      const isCloze = m.cloze || /\{\{c\d+::/.test(flds[0] || '');

      let type, fields;
      if (isCloze) {
        type = 'cloze';
        fields = { text: flds[0] || '', extra: rest.join('<br>') };
      } else {
        type = m.tmplCount >= 2 && ankiCards.some((c) => c.ord === 1) ? 'reverse' : 'basic';
        fields = { front: flds[0] || '', back: rest.join('<br>') };
      }

      const deckId = await getDeck(ankiCards[0].did);
      const note = {
        id: U.newId(), guid: n.guid, deckId, type, fields,
        tags: String(n.tags || '').trim().split(/\s+/).filter(Boolean),
        created: n.id, mod: now
      };
      newNotes.push(note);

      for (const ord of C.ordsFor(note)) {
        const card = S.makeCard(note, ord);
        const ac = ankiCards.find((c) => c.ord === ord);
        if (ac) {
          card.deckId = await getDeck(ac.did);
          if (keepProgress) applyProgress(card, ac, crt);
        }
        newCards.push(card);
      }
    }

    // Multimedia
    const newMedia = [];
    for (const [zipName, realName] of Object.entries(mediaMap)) {
      if (!realName || S.hasMedia(realName)) continue;
      const f = zip.file(zipName);
      if (!f) continue;
      let data = await f.async('uint8array');
      if (zstd) {
        try { data = window.fzstd.decompress(data); } catch { /* archivo sin comprimir */ }
      }
      newMedia.push({ name: realName, blob: new Blob([data], { type: U.mimeFor(realName) }) });
    }

    await S.importBatch({ notes: newNotes, cards: newCards, media: newMedia });
    return { notes: newNotes.length, cards: newCards.length, decks: decksUsed.size, media: newMedia.length, skipped };
  }

  function applyProgress(card, ac, crt) {
    card.reps = ac.reps || 0;
    card.lapses = ac.lapses || 0;
    if (ac.queue === -1) card.suspended = true;
    if (ac.type === 2 || ac.type === 3) {
      // Repaso (o reaprendizaje): due son días desde la creación de la colección,
      // salvo en reaprendizaje intradía, donde es una marca de tiempo en segundos.
      const ivl = Math.max(1, ac.ivl || 1);
      const dueTs = ac.due > 1e9 ? ac.due * 1000 : crt * 1000 + ac.due * 86400000;
      card.state = 'review';
      card.interval = ivl;
      if (ac.factor) card.ease = ac.factor / 1000;
      card.due = U.dayStart(0, dueTs);
    } else if (ac.type === 1) {
      card.state = 'learning';
      card.step = 0;
      card.due = Date.now();
    }
  }

  // ================= EXPORTAR =================
  const SCHEMA = `
    CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
    CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
    CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
    CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
    CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
    CREATE INDEX ix_notes_usn on notes (usn);
    CREATE INDEX ix_cards_usn on cards (usn);
    CREATE INDEX ix_revlog_usn on revlog (usn);
    CREATE INDEX ix_cards_nid on cards (nid);
    CREATE INDEX ix_cards_sched on cards (did, queue, due);
    CREATE INDEX ix_revlog_cid on revlog (cid);
    CREATE INDEX ix_notes_csum on notes (csum);
  `;

  // Ids fijos para que Anki reconozca nuestros tipos de nota en importaciones sucesivas.
  const MODEL_IDS = { basic: 1731000000001, reverse: 1731000000002, cloze: 1731000000003 };
  const MODEL_CSS = '.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }\n.cloze { font-weight: bold; color: blue; }\n.nightMode .cloze { color: lightblue; }';
  const LATEX_PRE = '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n';

  function modelJson(id, name, type, fieldNames, tmpls, nowS) {
    return {
      id, name, type, mod: nowS, usn: -1, sortf: 0, did: 1,
      tmpls: tmpls.map(([tn, qfmt, afmt], ord) => ({ name: tn, ord, qfmt, afmt, did: null, bqfmt: '', bafmt: '' })),
      flds: fieldNames.map((f, ord) => ({ name: f, ord, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] })),
      css: MODEL_CSS, latexPre: LATEX_PRE, latexPost: '\\end{document}', latexsvg: false,
      req: tmpls.map((t, i) => [i, 'any', [type === 1 ? 0 : i]]),
      tags: [], vers: []
    };
  }

  function deckJson(id, name, nowS) {
    return {
      id, name, mod: nowS, usn: -1, desc: '', dyn: 0, conf: 1, collapsed: false, browserCollapsed: false,
      extendNew: 0, extendRev: 0, newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0]
    };
  }

  const DCONF = {
    1: {
      id: 1, name: 'Default', mod: 0, usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true, dyn: false,
      new: { delays: [1, 10], ints: [1, 4, 7], initialFactor: 2500, order: 1, perDay: 20, bury: false, separate: true },
      lapse: { delays: [10], mult: 0, minInt: 1, leechFails: 8, leechAction: 1 },
      rev: { perDay: 200, ease4: 1.3, fuzz: 0.05, minSpace: 1, ivlFct: 1, maxIvl: 36500, bury: false, hardFactor: 1.2 }
    }
  };

  /**
   * @param {number|null} deckId  mazo a exportar (con submazos) o null para todo
   */
  A.exportApkg = async (deckId, { includeProgress = true } = {}) => {
    await ensureLibs();
    const deckIds = deckId ? S.deckFamilyIds(deckId) : new Set(S.decks().map((d) => d.id));
    const cards = S.allCards().filter((c) => deckIds.has(c.deckId));
    const noteIds = new Set(cards.map((c) => c.noteId));
    const notes = S.allNotes().filter((n) => noteIds.has(n.id));
    if (!notes.length) throw new Error('No hay tarjetas que exportar en este mazo.');

    const now = Date.now();
    const nowS = Math.floor(now / 1000);
    const crtTs = U.dayStart(0, new Date(2020, 0, 1, 12).getTime());
    const crtDay = U.dayIndex(crtTs);

    const models = {
      [MODEL_IDS.basic]: modelJson(MODEL_IDS.basic, `${App.config.appName} Básica`, 0, ['Anverso', 'Reverso'],
        [['Tarjeta 1', '{{Anverso}}', '{{FrontSide}}\n\n<hr id=answer>\n\n{{Reverso}}']], nowS),
      [MODEL_IDS.reverse]: modelJson(MODEL_IDS.reverse, `${App.config.appName} Básica y reverso`, 0, ['Anverso', 'Reverso'], [
        ['Tarjeta 1', '{{Anverso}}', '{{FrontSide}}\n\n<hr id=answer>\n\n{{Reverso}}'],
        ['Tarjeta 2', '{{Reverso}}', '{{FrontSide}}\n\n<hr id=answer>\n\n{{Anverso}}']
      ], nowS),
      [MODEL_IDS.cloze]: modelJson(MODEL_IDS.cloze, `${App.config.appName} Rellenar huecos`, 1, ['Texto', 'Extra'],
        [['Cloze', '{{cloze:Texto}}', '{{cloze:Texto}}<br>\n{{Extra}}']], nowS)
    };

    const decksOut = { 1: deckJson(1, 'Default', nowS) };
    for (const id of deckIds) decksOut[id] = deckJson(id, S.deck(id).name, nowS);

    let maxPos = 0;
    cards.forEach((c) => { if (c.position > maxPos) maxPos = c.position; });
    const conf = {
      activeDecks: [1], curDeck: 1, newSpread: 0, collapseTime: 1200, timeLim: 0, estTimes: true, dueCounts: true,
      curModel: null, nextPos: maxPos + 1, sortType: 'noteFld', sortBackwards: false, addToCur: true
    };

    const db = new SQL.Database();
    try {
      db.run(SCHEMA);
      db.run('INSERT INTO col VALUES (1,?,?,?,11,0,0,0,?,?,?,?,?)', [
        Math.floor(crtTs / 1000), now, now, JSON.stringify(conf), JSON.stringify(models),
        JSON.stringify(decksOut), JSON.stringify(DCONF), '{}'
      ]);

      const mediaRefs = new Set();
      db.run('BEGIN');
      const insNote = db.prepare('INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      for (const n of notes) {
        const flds = n.type === 'cloze' ? [n.fields.text || '', n.fields.extra || ''] : [n.fields.front || '', n.fields.back || ''];
        flds.forEach((f) => C.mediaRefs(f).forEach((r) => mediaRefs.add(r)));
        const sfld = U.stripHtml(flds[0]);
        const tags = (n.tags || []).length ? ` ${n.tags.join(' ')} ` : '';
        insNote.run([n.id, n.guid, MODEL_IDS[n.type], Math.floor(n.mod / 1000), -1, tags, flds.join('\x1f'), sfld, await U.ankiChecksum(sfld), 0, '']);
      }
      insNote.free();

      const insCard = db.prepare('INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for (const c of cards) {
        let type = 0, queue = 0, due = c.position, ivl = 0, factor = 0;
        if (includeProgress && (c.state === 'review' || c.state === 'relearning') && c.interval > 0) {
          type = 2; queue = 2; ivl = c.interval; factor = Math.round((c.ease || 2.5) * 1000);
          due = c.state === 'review' ? U.dayIndex(c.due) - crtDay : U.dayIndex(now) - crtDay;
        }
        if (c.suspended) queue = -1;
        insCard.run([c.id, c.noteId, c.deckId, c.ord, Math.floor(c.mod / 1000), -1, type, queue, due, ivl, factor,
          includeProgress ? c.reps || 0 : 0, includeProgress ? c.lapses || 0 : 0, 0, 0, 0, 0, '']);
      }
      insCard.free();
      db.run('COMMIT');

      const zip = new window.JSZip();
      zip.file('collection.anki2', db.export());
      const mediaIndex = {};
      let i = 0;
      for (const name of mediaRefs) {
        const blob = S.mediaBlob(name);
        if (!blob) continue;
        zip.file(String(i), blob);
        mediaIndex[i] = name;
        i++;
      }
      zip.file('media', JSON.stringify(mediaIndex));
      const out = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const name = deckId ? S.deck(deckId).name.split('::').pop() : `${App.config.appName} - todo`;
      U.download(out, `${U.safeFilename(name)}.apkg`);
      return { notes: notes.length, cards: cards.length, media: i };
    } finally {
      db.close();
    }
  };
})(window.App);
