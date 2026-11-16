/* Pantallas: inicio (lista de mazos) y detalle de mazo. Acciones de importar/exportar. */
(function (App) {
  'use strict';
  const U = App.util, S = App.store, UI = App.ui;
  const V = App.views;

  const pendingOf = (c) => c.new + c.learn + c.review;
  const SUBDECK_HINT = 'Para un submazo, usa «Padre::Hijo»';
  const UNDO_MS = 8000;

  // ---------- Borrado con «Deshacer» ----------
  // El mazo se oculta al instante y se borra de verdad pasados UNDO_MS, al salir del
  // inicio o al cerrar la página. «Deshacer» cancela el borrado: nada llega a escribirse.
  App.session = App.session || {};
  const pendingDel = (App.session.pendingDeckDeletes = App.session.pendingDeckDeletes || new Map()); // id → timer
  const deleting = new Set();                                                                         // ids en curso
  const isPendingDelete = (id) => pendingDel.has(id) || deleting.has(id);
  /** Ids ocultos: los mazos pendientes de borrar y todos sus submazos. */
  function hiddenIds() {
    const out = new Set();
    for (const id of [...pendingDel.keys(), ...deleting]) for (const x of S.deckFamilyIds(id)) out.add(x);
    return out;
  }
  async function commitDelete(id) {
    if (!pendingDel.has(id)) return;
    clearTimeout(pendingDel.get(id));
    pendingDel.delete(id);
    deleting.add(id);
    try { if (S.deck(id)) await S.deleteDeck(id); } finally { deleting.delete(id); }
  }
  const commitAllDeletes = () => Promise.all([...pendingDel.keys()].map(commitDelete));
  V.commitPendingDeletes = commitAllDeletes;
  const onHome = () => location.hash === '' || location.hash === '#/' || location.hash === '#';
  window.addEventListener('hashchange', () => { if (!onHome()) commitAllDeletes(); });
  window.addEventListener('pagehide', () => { commitAllDeletes(); });

  // ---------- Plegado de submazos (recordado en este dispositivo) ----------
  const FOLD_KEY = 'recallo.collapsedDecks';
  const readFolded = () => { try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || '[]')); } catch { return new Set(); } };
  const saveFolded = (set) => { try { localStorage.setItem(FOLD_KEY, JSON.stringify([...set])); } catch { /* sin almacenamiento */ } };

  // ---------- Nombres de mazo ----------
  /** Mensaje de error para un nombre, o '' si vale. except: el nombre actual (al renombrar). */
  const deckNameError = (v, except = null) => {
    if (!v) return 'Escribe un nombre.';
    if (v.split('::').some((p) => !p.trim())) return 'Cada parte del nombre necesita texto, por ejemplo «Padre::Hijo».';
    if (v !== except && S.deckByName(v)) return 'Ya existe un mazo con ese nombre.';
    return '';
  };

  // ---------- Filas de la lista ----------
  /** Cabecera de columnas: etiquetas una sola vez, alineadas sobre las cifras.
   *  En pantallas estrechas se muestra una sola columna, «pendientes». */
  const countHead = (withMore, withSlot) => `
    <div class="count-head${withMore ? ' with-more' : ''}${withSlot ? ' with-slot' : ''}" aria-hidden="true">
      <span class="count-cols"><span>nuevas</span><span>aprendiendo</span><span>repaso</span></span>
      <span class="count-cols-total"><span>pendientes</span></span>
    </div>`;

  /** Nombre accesible de una fila: el nombre corto y, si es submazo, de quién cuelga. */
  const rowName = (d) => {
    const parts = d.name.split('::');
    const parent = parts.length > 1 ? parts[parts.length - 2] : '';
    return `<span class="deck-name">${U.esc(S.shortName(d))}${parent ? `<span class="visually-hidden">, submazo de ${U.esc(parent)}</span>` : ''}</span>`;
  };

  /** Cifras de una fila: reparto en 3 columnas (pantallas anchas) o total pendiente
   *  (estrechas); un mazo sin tarjetas dice «vacío» en lugar de «0 0 0». */
  const rowCounts = (d, c) => {
    if (!S.deckCardCount(d.id)) return '<span class="count-empty">vacío</span>';
    const n = pendingOf(c);
    return `${UI.countsHtml(c, null)}<span class="count-total${n ? '' : ' zero'}"><span aria-hidden="true">${n}</span><span class="visually-hidden">${n} pendientes</span></span>`;
  };

  /** Error comprensible con un paso siguiente; el detalle técnico queda plegado. */
  const failDialog = (title, message, err) => UI.modal({
    title,
    body: `<p>${U.esc(message)}</p>
      <details class="tech-detail"><summary>Detalle técnico</summary><code>${U.esc((err && err.message) || String(err))}</code></details>`,
    actions: [{ label: 'Entendido', value: true, primary: true }]
  });

  // ---------- Inicio ----------
  V.home = () => {
    UI.setHeader({
      title: App.config.appName,
      actions: [
        { icon: 'list', label: 'Todas las notas', onClick: () => (location.hash = '#/browse/all') },
        { icon: 'settings', label: 'Ajustes', onClick: () => (location.hash = '#/settings') }
      ]
    });

    const hidden = hiddenIds();
    const decks = S.decks().filter((d) => !hidden.has(d.id));
    const roots = decks.filter((d) => !d.name.includes('::'));
    const total = { new: 0, learn: 0, review: 0 };
    const counts = new Map();
    for (const d of decks) counts.set(d.id, S.studyState(d.id).counts);
    for (const r of roots) { const c = counts.get(r.id); total.new += c.new; total.learn += c.learn; total.review += c.review; }
    const today = S.todayStats();
    const pending = pendingOf(total);

    // «Estudiar»: el mazo raíz con más tarjetas pendientes (si hay varios con pendientes, se nombra).
    const withPending = roots.map((r) => ({ deck: r, n: pendingOf(counts.get(r.id)) })).filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n);
    const target = withPending[0];
    const cta = target ? `
        <a class="btn btn-primary btn-lg btn-block today-cta" href="#/study/${target.deck.id}">${UI.icons.play}<span>Estudiar${withPending.length > 1
          ? ` <span class="cta-deck">${U.esc(S.shortName(target.deck))}</span>` : ''} · ${target.n}</span></a>` : '';

    // Plegado: un mazo con submazos lleva un botón; los descendientes de uno plegado se ocultan.
    const folded = readFolded();
    const hasKids = (d) => decks.some((o) => o.name.startsWith(d.name + '::'));

    const rows = decks.map((d) => {
      const depth = d.name.split('::').length - 1;
      const kids = hasKids(d);
      const isFolded = kids && folded.has(d.id);
      const short = U.esc(S.shortName(d));
      return `
        <li class="deck-row ${depth ? 'is-child' : 'is-root'}" style="--depth:${depth}" data-id="${d.id}"${underFoldedNow(d, folded, decks) ? ' hidden' : ''}>
          <span class="deck-slot">${kids ? `<button type="button" class="deck-toggle" data-id="${d.id}" aria-expanded="${!isFolded}" aria-label="${isFolded ? 'Mostrar' : 'Ocultar'} submazos de ${short}">${UI.icons.back}</button>` : ''}</span>
          <a href="#/deck/${d.id}" class="deck-link">
            ${rowName(d)}
            ${rowCounts(d, counts.get(d.id))}
          </a>
          <button class="icon-btn deck-more" data-id="${d.id}" aria-label="Opciones de ${short}">${UI.icons.more}</button>
        </li>`;
    }).join('');

    const summary = `
      <section class="summary today" aria-labelledby="today-h">
        <p class="eyebrow" id="today-h">Hoy</p>
        <p class="summary-main">${pending
          ? `<strong class="summary-num">${pending}</strong> ${pending === 1 ? 'tarjeta pendiente' : 'tarjetas pendientes'}`
          : 'Estás al día'}</p>
        <p class="muted summary-sub">${today.reviews
          ? `${UI.plural(today.reviews, 'repaso hecho', 'repasos hechos')} · ${UI.fmtMin(today.timeMs)}`
          : 'Aún no has estudiado hoy'}</p>
        ${pending ? UI.countsHtml(total, null, { labels: true }) : ''}
        ${cta}
      </section>`;

    UI.render(decks.length ? `
      ${summary}

      <div class="list-head deck-head">
        <h2 id="decks-h">Mazos</h2>
        <div class="list-actions">
          <button class="btn btn-quiet" id="btn-new-deck">${UI.icons.folder}<span>Nuevo mazo</span></button>
          <button class="btn btn-quiet" id="btn-import">${UI.icons.upload}<span>Importar</span></button>
        </div>
      </div>
      ${countHead(true, true)}
      <ul class="deck-list has-slot" aria-labelledby="decks-h">${rows}</ul>

      <div class="bottom-bar home-bar">
        <div class="bottom-bar-inner">
          <a class="btn btn-paper btn-block" id="btn-add" href="#/add">${UI.icons.plus}<span>Añadir tarjeta</span></a>
        </div>
      </div>` : `
      <div class="empty home-empty">
        ${UI.icons.cards}
        <h2>Aún no tienes mazos</h2>
        <p>Crea tu primer mazo o importa uno de Anki.</p>
        <div class="empty-actions">
          <button class="btn btn-primary" id="btn-new-deck">${UI.icons.folder}<span>Nuevo mazo</span></button>
          <button class="btn" id="btn-import">${UI.icons.upload}<span>Importar de Anki</span></button>
        </div>
      </div>`);

    document.querySelectorAll('.deck-more').forEach((b) => (b.onclick = () => V.deckMenu(S.deck(+b.dataset.id))));
    document.querySelectorAll('.deck-toggle').forEach((b) => (b.onclick = () => {
      const id = +b.dataset.id;
      const set = readFolded();
      const fold = !set.has(id);
      if (fold) set.add(id); else set.delete(id);
      saveFolded(set);
      const d = S.deck(id);
      b.setAttribute('aria-expanded', String(!fold));
      b.setAttribute('aria-label', `${fold ? 'Mostrar' : 'Ocultar'} submazos de ${S.shortName(d)}`);
      // Mostrar u ocultar descendientes sin repintar (el foco se queda en el botón).
      const byId = new Map(decks.map((x) => [x.id, x]));
      document.querySelectorAll('.deck-list .deck-row').forEach((li) => {
        const x = byId.get(+li.dataset.id);
        if (x && x.name.startsWith(d.name + '::')) li.hidden = underFoldedNow(x, set, decks);
      });
    }));
    UI.$('#btn-new-deck').onclick = () => V.newDeck();
    UI.$('#btn-import').onclick = V.importFlow;
  };
  function underFoldedNow(d, set, decks) {
    const parts = d.name.split('::');
    for (let i = 1; i < parts.length; i++) {
      const anc = decks.find((o) => o.name === parts.slice(0, i).join('::'));
      if (anc && set.has(anc.id)) return true;
    }
    return false;
  }

  /** Nuevo mazo; con parent, nuevo submazo con «Padre::» ya escrito. */
  V.newDeck = async (parent = null) => {
    const prefix = parent ? parent.name + '::' : '';
    const name = await UI.prompt(parent ? 'Nuevo submazo' : 'Nuevo mazo', 'Nombre', prefix, parent ? '' : 'Ej.: Biología', {
      okLabel: parent ? 'Crear submazo' : 'Crear mazo',
      hint: parent ? `Dentro de «${parent.name.replace(/::/g, ' › ')}»` : SUBDECK_HINT,
      caretEnd: !!parent,
      validate: (v) => (parent && v === parent.name + '::' ? 'Escribe el nombre del submazo después de «::».' : deckNameError(v))
    });
    if (!name) return;
    const d = await S.ensureDeck(name);
    location.hash = `#/deck/${d.id}`;
  };

  /** Menú de un mazo. compact: el del detalle de mazo (sin lo que ya está a la vista). */
  V.deckMenu = (deck, { compact = false } = {}) => {
    const n = pendingOf(S.studyState(deck.id).counts);
    const manage = [
      { label: 'Renombrar', icon: 'edit', onClick: () => V.renameDeck(deck) },
      { label: 'Nuevo submazo', icon: 'folder', onClick: () => V.newDeck(deck) },
      { label: 'Exportar a Anki (.apkg)', icon: 'download', onClick: () => V.exportFlow(deck.id) },
      { divider: true },
      { label: 'Eliminar mazo', icon: 'trash', danger: true, onClick: () => V.deleteDeck(deck) }
    ];
    UI.sheet(deck.name.replace(/::/g, ' › '), compact ? manage : [
      { label: n ? `Estudiar · ${n}` : 'Estudiar', icon: 'play', onClick: () => (location.hash = `#/study/${deck.id}`) },
      { label: 'Añadir tarjeta', icon: 'plus', onClick: () => (location.hash = `#/add/${deck.id}`) },
      { label: 'Ver tarjetas', icon: 'list', onClick: () => (location.hash = `#/browse/${deck.id}`) },
      ...manage
    ]);
  };

  V.renameDeck = async (deck) => {
    const name = await UI.prompt('Renombrar mazo', 'Nombre', deck.name, '', {
      okLabel: 'Renombrar', hint: SUBDECK_HINT, validate: (v) => deckNameError(v, deck.name)
    });
    if (!name || name === deck.name) return;
    try {
      await S.renameDeck(deck.id, name);
      App.refresh();
    } catch (e) {
      UI.toast(e.message);
    }
  };

  V.deleteDeck = async (deck) => {
    const n = S.deckCardCount(deck.id);
    const ok = await UI.confirm('Eliminar mazo',
      `Se eliminará «${deck.name}»${n ? `, sus submazos y ${UI.plural(n, 'tarjeta')}` : ''}. Podrás deshacerlo durante unos segundos.`,
      'Eliminar', true);
    if (!ok) return;
    // Borrado diferido: se oculta ya y se escribe pasados UNDO_MS (o al salir del inicio).
    if (pendingDel.has(deck.id)) clearTimeout(pendingDel.get(deck.id));
    pendingDel.set(deck.id, setTimeout(() => { commitDelete(deck.id); }, UNDO_MS));
    const short = S.shortName(deck);
    if (onHome()) App.refresh(); else location.hash = '#/';
    UI.toast(`«${short}» eliminado`, UNDO_MS, {
      label: 'Deshacer',
      onClick: () => {
        if (!pendingDel.has(deck.id)) return UI.toast('Ya no se puede deshacer');
        clearTimeout(pendingDel.get(deck.id));
        pendingDel.delete(deck.id);
        if (onHome()) App.refresh();
        UI.toast(`«${short}» recuperado`);
      }
    });
  };

  // ---------- Detalle de mazo ----------
  V.deck = (deckId) => {
    const deck = S.deck(deckId);
    if (!deck || isPendingDelete(deckId)) return void (location.hash = '#/');
    const parts = deck.name.split('::');
    const parent = parts.length > 1 ? S.deckByName(parts.slice(0, -1).join('::')) : null;
    UI.setHeader({
      title: S.shortName(deck),
      back: parent ? `#/deck/${parent.id}` : '#/',
      actions: [{ icon: 'more', label: 'Opciones del mazo', onClick: () => V.deckMenu(deck, { compact: true }) }]
    });

    const { card, state } = S.nextCard(deckId);
    const c = state.counts;
    const pending = pendingOf(c);
    const total = S.deckCardCount(deckId);
    const children = S.decks().filter((d) => d.name.startsWith(deck.name + '::') && d.name.split('::').length === parts.length + 1);

    // El título ya está en la cabecera: el bloque principal abre con el estado de hoy.
    let headline, body;
    if (card) {
      headline = `${UI.plural(pending, 'tarjeta')} para hoy`;
      body = `<a class="btn btn-primary btn-lg btn-block" href="#/study/${deckId}">${UI.icons.play}<span>Estudiar · ${pending}</span></a>`;
    } else if (!total) {
      headline = 'Mazo vacío';
      body = `<div class="done-msg"><p>Este mazo aún no tiene tarjetas.</p>
        <a class="btn btn-primary" href="#/add/${deckId}">${UI.icons.plus}<span>Añadir tarjeta</span></a></div>`;
    } else if (state.learnLater.length) {
      const k = state.learnLater.length;
      headline = 'Pausa breve';
      body = `<p class="done-msg">${k === 1 ? 'Queda 1 tarjeta en aprendizaje; vuelve' : `Quedan ${k} tarjetas en aprendizaje; la primera vuelve`} en ${U.esc(U.fmtMinutes((state.learnLater[0].due - Date.now()) / 60000))}.</p>`;
    } else {
      headline = 'Al día';
      body = '<p class="done-msg">No quedan tarjetas para hoy en este mazo.</p>';
    }

    // Ruta de submazos: cada tramo enlaza a su mazo.
    let path = '';
    if (parent) {
      const crumbs = parts.slice(0, -1).map((_, i) => {
        const d = S.deckByName(parts.slice(0, i + 1).join('::'));
        return d ? `<a href="#/deck/${d.id}">${U.esc(parts[i])}</a>` : U.esc(parts[i]);
      });
      path = `<nav class="eyebrow deck-path" aria-label="Ruta del mazo">En ${crumbs.join(' › ')}</nav>`;
    }

    const stat = (cls, n, label) => `<div class="stat${n ? '' : ' zero'}"><span class="stat-num ${cls}">${n}</span><span class="stat-label">${label}</span></div>`;

    UI.render(`
      <section class="deck-hero" aria-labelledby="deck-state">
        ${path}
        <p class="deck-state" id="deck-state">${headline}</p>
        ${total ? `<div class="stat-row">
          ${stat('c-new', c.new, 'nuevas')}
          ${stat('c-learn', c.learn, 'aprendiendo')}
          ${stat('c-due', c.review, 'repaso')}
        </div>` : ''}
        ${body}
      </section>

      ${total ? `<div class="action-grid">
        <a class="tile" href="#/add/${deckId}">${UI.icons.plus}<span>Añadir tarjeta</span></a>
        <a class="tile" href="#/browse/${deckId}">${UI.icons.list}<span>Ver tarjetas <small>${total}${children.length ? ' (con submazos)' : ''}</small></span></a>
      </div>` : ''}

      <div class="list-head deck-head">
        <h2 id="sub-h">Submazos</h2>
        <div class="list-actions">
          <button class="btn btn-quiet" id="btn-new-sub">${UI.icons.folder}<span>Nuevo submazo</span></button>
        </div>
      </div>
      ${children.length ? `
        ${countHead(false, false)}
        <ul class="deck-list" aria-labelledby="sub-h">${children.map((d) => `
          <li class="deck-row is-child-list"><a href="#/deck/${d.id}" class="deck-link">${rowName(d)}${rowCounts(d, S.studyState(d.id).counts)}</a></li>`).join('')}
        </ul>` : '<p class="sub-empty">Aún no tiene submazos. Úsalos para dividir un tema en partes.</p>'}
    `);
    UI.$('#btn-new-sub').onclick = () => V.newDeck(deck);
  };

  // ---------- Importar / exportar ----------
  V.importFlow = async () => {
    const file = await UI.pickFile('.apkg,.colpkg');
    if (!file) return;
    if (!/\.(apkg|colpkg)$/i.test(file.name)) return UI.alert('Formato no válido', 'Elige un archivo .apkg o .colpkg exportado desde Anki.');
    const opts = await UI.modal({
      title: 'Importar de Anki',
      body: `
        <p class="file-pill">${UI.icons.cards}<span>${U.esc(file.name)}</span><small>${(file.size / 1048576).toFixed(1)} MB</small></p>
        <label class="check"><input type="checkbox" name="keep" checked><span>Conservar el progreso de estudio<small>Si lo desmarcas, todas las tarjetas empiezan como nuevas.</small></span></label>`,
      actions: [
        { label: 'Importar', primary: true, collect: (d) => ({ keepProgress: d.querySelector('[name=keep]').checked }) },
        { label: 'Cancelar', value: null }
      ]
    });
    if (!opts) return;
    const busy = UI.busy('Importando mazo…');
    try {
      const r = await App.anki.importApkg(file, opts);
      busy.close();
      await UI.modal({
        title: 'Importación completada',
        body: `<ul class="summary-list">
          <li><strong>${r.notes}</strong> ${r.notes === 1 ? 'nota' : 'notas'} · <strong>${r.cards}</strong> ${r.cards === 1 ? 'tarjeta' : 'tarjetas'}</li>
          <li><strong>${r.decks}</strong> ${r.decks === 1 ? 'mazo' : 'mazos'}</li>
          ${r.media ? `<li><strong>${r.media}</strong> ${r.media === 1 ? 'archivo multimedia' : 'archivos multimedia'}</li>` : ''}
          ${r.skipped ? `<li class="muted">${r.skipped === 1 ? '1 nota omitida porque ya existía' : `${r.skipped} notas omitidas porque ya existían`}</li>` : ''}
        </ul>`,
        actions: [{ label: 'Listo', value: true, primary: true }]
      });
      App.refresh();
    } catch (e) {
      busy.close();
      console.error(e);
      failDialog('No se pudo importar',
        'No hemos podido leer este archivo. Comprueba que es un mazo exportado desde Anki (Archivo › Exportar › «Paquete de mazos de Anki (.apkg)») y vuelve a intentarlo.', e);
    }
  };

  V.exportFlow = async (deckId) => {
    const deck = deckId ? S.deck(deckId) : null;
    const opts = await UI.modal({
      title: 'Exportar a Anki',
      body: `
        <p>${deck ? `Se exportará «${U.esc(deck.name)}» con sus submazos` : 'Se exportarán todos los mazos'} en un archivo .apkg que puedes abrir con Anki.</p>
        <label class="check"><input type="checkbox" name="prog" checked><span>Incluir el progreso de estudio</span></label>`,
      actions: [
        { label: 'Exportar', primary: true, collect: (d) => ({ includeProgress: d.querySelector('[name=prog]').checked }) },
        { label: 'Cancelar', value: null }
      ]
    });
    if (!opts) return;
    const busy = UI.busy('Generando archivo…');
    try {
      const r = await App.anki.exportApkg(deckId, opts);
      busy.close();
      UI.toast(r.cards === 1 ? 'Exportada 1 tarjeta' : `Exportadas ${r.cards} tarjetas`);
    } catch (e) {
      busy.close();
      console.error(e);
      failDialog('No se pudo exportar',
        'No hemos podido generar el archivo. Comprueba que el dispositivo tiene espacio libre y vuelve a intentarlo; si el mazo tiene mucho contenido multimedia, prueba a exportar un submazo.', e);
    }
  };
})(window.App);
