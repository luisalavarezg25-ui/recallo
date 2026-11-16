/* Explorador: lista, búsqueda, filtros y acciones masivas sobre las notas de un mazo (o de todos). */
(function (App) {
  'use strict';
  const U = App.util, S = App.store, UI = App.ui, C = App.cards;
  const V = App.views;
  const PAGE = 50;
  const DAY = 86400000;
  const CLOZE = /\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g;

  const FILTERS = [
    ['all', 'Todas'], ['new', 'Nuevas'], ['learn', 'Aprendiendo'], ['review', 'Repaso'], ['suspended', 'Suspendidas']
  ];
  const SORTS = [['recent', 'Más recientes'], ['alpha', 'Alfabético'], ['due', 'Próximo repaso']];

  // ---------- Estado guardado por mazo (sobrevive a la ida y vuelta al editor) ----------
  const keyFor = (deckId) => `recallo.browse.${deckId ?? 'all'}`;
  const ss = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch { /* sin almacenamiento */ } }
  };
  const RESTORE = 'recallo.browse.restore';

  /**
   * La posición solo se restaura en la ida y vuelta explorador -> editor -> explorador.
   * Al abrir una nota se instala este vigilante, que se retira solo: si desde el editor se va
   * a cualquier otra pantalla, olvida la marca de restauración.
   */
  function watchReturn() {
    const onHash = () => {
      if (/^#\/edit\//.test(location.hash)) return;
      if (!/^#\/browse\//.test(location.hash)) ss.del(RESTORE);
      window.removeEventListener('hashchange', onHash);
    };
    // Se instala después del cambio a #/edit (que ya está en curso) para no retirarse en él.
    setTimeout(() => window.addEventListener('hashchange', onHash), 0);
  }

  /** «en 8 min», «en 2 h», «ahora» para tarjetas en aprendizaje. */
  function fmtSoon(ts) {
    const m = (ts - Date.now()) / 60000;
    if (m <= 0) return 'ahora';
    if (m < 1440) return `en ${U.fmtMinutes(m)}`;
    return fmtDue(ts);
  }

  /** Fecha corta: «hoy», «mañana», «16 nov» (el año solo si no es el actual). */
  function fmtDue(ts) {
    const today = U.dayStart(0);
    if (ts < today + DAY) return 'hoy';
    if (ts < today + 2 * DAY) return 'mañana';
    const d = new Date(ts);
    const opts = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString('es', opts).replace('.', '');
  }

  /** Segmentos del título: texto normal y huecos (cloze) resueltos. */
  function titleSegments(note) {
    const raw = U.stripHtml(note.fields[C.primaryField(note.type)] || '');
    if (note.type !== 'cloze') return [{ t: raw, gap: false }];
    const out = [];
    let last = 0;
    for (const m of raw.matchAll(CLOZE)) {
      if (m.index > last) out.push({ t: raw.slice(last, m.index), gap: false });
      out.push({ t: m[1], gap: true });
      last = m.index + m[0].length;
    }
    if (last < raw.length) out.push({ t: raw.slice(last), gap: false });
    return out;
  }

  /** Estado resumido de una nota a partir de sus tarjetas. */
  function noteStatus(cs) {
    const active = cs.filter((c) => !c.suspended);
    const info = { key: 'new', due: Infinity, partial: active.length > 0 && active.length < cs.length, susp: cs.length - active.length, total: cs.length };
    if (!cs.length) return info;
    if (!active.length) return { ...info, key: 'suspended' };
    const learn = active.filter((c) => c.state === 'learning' || c.state === 'relearning');
    if (learn.length) return { ...info, key: 'learn', due: Math.min(...learn.map((c) => c.due)) };
    const rev = active.filter((c) => c.state === 'review');
    if (rev.length) return { ...info, key: 'review', due: Math.min(...rev.map((c) => c.due)) };
    return info;
  }

  V.browse = (deckId) => {
    const deck = deckId ? S.deck(deckId) : null;
    if (deckId && !deck) return void (location.hash = '#/');
    const key = keyFor(deckId);
    const addHref = deck ? `#/add/${deckId}` : '#/add';

    UI.setHeader({
      title: deck ? S.shortName(deck) : 'Todas las notas',
      back: deck ? `#/deck/${deckId}` : '#/',
      actions: [{ icon: 'plus', label: 'Añadir tarjeta', onClick: () => (location.hash = addHref) }]
    });

    // ---------- Datos ----------
    const ids = deck ? S.deckFamilyIds(deckId) : null;
    let all = [];
    function load() {
      const byNote = S.cardsByNote();
      all = S.allNotes()
        .filter((n) => !ids || ids.has(n.deckId))
        .map((n) => {
          const cs = byNote.get(n.id) || [];
          const segs = titleSegments(n);
          const title = segs.map((s) => s.t).join('').trim();
          const text = Object.values(n.fields).map((f) => U.stripHtml(f).replace(CLOZE, '$1')).join(' ');
          const pk = C.primaryField(n.type);
          const body = Object.entries(n.fields).filter(([k]) => k !== pk)
            .map(([, f]) => U.stripHtml(f).replace(CLOZE, '$1')).join(' · ');
          return {
            note: n, cards: cs, segs, title, body,
            titleFold: U.fold(`${title} ${(n.tags || []).join(' ')}`),
            st: noteStatus(cs),
            sortTitle: U.fold(title),
            search: U.fold(`${text} ${(n.tags || []).join(' ')}`)
          };
        });
    }
    load();

    // ---------- Estado de la vista ----------
    const saved = ss.get(key) || {};
    const restoring = ss.get(RESTORE) === key;
    const state = {
      q: restoring ? saved.q || '' : '',
      f: restoring ? saved.f || 'all' : 'all',
      sort: saved.sort || 'recent',
      shown: 0,
      selecting: false
    };
    const selected = new Set();
    let matched = [];   // tras la búsqueda (antes del filtro de estado)
    let filtered = [];  // tras búsqueda + filtro + orden

    const view = UI.render(`
      <div class="browse">
        <div class="browse-empty" id="b-empty" hidden></div>
        <div id="b-main">
          <div class="search-box">
            <input type="search" id="q" placeholder="Buscar en el texto o en las etiquetas" aria-label="Buscar notas"
              spellcheck="false" autocomplete="off" enterkeyhint="search">
          </div>
          <div class="browse-tools">
            <div class="filter-chips" role="group" aria-label="Filtrar por estado" id="b-filters"></div>
            <div class="browse-tools-row">
              <label class="sort-field"><span>Ordenar</span>
                <select id="b-sort">${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
              </label>
              <button type="button" class="btn btn-quiet" id="b-select" aria-pressed="false">Seleccionar</button>
            </div>
          </div>
          <p class="browse-count" id="b-count" aria-live="polite"></p>
          <h2 class="visually-hidden" id="b-heading">Notas</h2>
          <ul class="note-list" id="b-list" aria-labelledby="b-heading"></ul>
          <button type="button" class="btn btn-block btn-more" id="b-more" hidden></button>
        </div>
        <div class="bulk-bar" id="b-bulk" role="region" aria-label="Acciones de selección" hidden>
          <div class="bulk-inner">
            <p class="bulk-count"><span id="b-bulk-count" tabindex="-1" aria-live="polite"></span>
              <button type="button" class="link-btn" id="b-rest" hidden></button></p>
            <div class="bulk-actions">
              <button type="button" class="btn btn-quiet" id="b-all">Visibles</button>
              <button type="button" class="btn" id="b-susp" disabled>Suspender</button>
              <button type="button" class="btn" id="b-move" disabled>Mover…</button>
              <button type="button" class="btn btn-danger-ghost" id="b-del" disabled>Eliminar</button>
            </div>
          </div>
        </div>
        <div class="browse-undo" id="b-undo" role="status" hidden>
          <span id="b-undo-msg"></span>
          <button type="button" class="link-btn" id="b-undo-btn">Deshacer</button>
        </div>
        <button type="button" class="to-top" id="b-top" aria-label="Volver arriba" hidden>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>
        </button>
      </div>`);

    const $ = (s) => view.querySelector(s);
    const elQ = $('#q'), elList = $('#b-list'), elMore = $('#b-more'), elCount = $('#b-count');
    const elFilters = $('#b-filters'), elSort = $('#b-sort'), elSel = $('#b-select');
    const elBulk = $('#b-bulk'), elTop = $('#b-top');
    elQ.value = state.q;
    elSort.value = state.sort;

    function persist(extra = {}) {
      const prev = ss.get(key) || {};
      ss.set(key, { anchor: prev.anchor, offset: prev.offset, q: state.q, f: state.f, sort: state.sort, shown: state.shown, ...extra });
    }
    /** El usuario ha cambiado la vista: ya no hay posición que restaurar. */
    function forget() {
      ss.del(RESTORE);
      const p = ss.get(key) || {};
      delete p.anchor; delete p.offset;
      ss.set(key, p);
    }

    // ---------- Filtrado y orden ----------
    function compute() {
      const terms = U.fold(state.q).split(/\s+/).filter(Boolean);
      matched = terms.length ? all.filter((x) => terms.every((t) => x.search.includes(t))) : all;
      filtered = state.f === 'all' ? matched.slice() : matched.filter((x) => x.st.key === state.f);
      const byId = (a, b) => b.note.id - a.note.id;
      if (state.sort === 'alpha') {
        filtered.sort((a, b) => a.sortTitle.localeCompare(b.sortTitle, 'es', { numeric: true }) || a.note.id - b.note.id);
      } else if (state.sort === 'due') {
        const rank = (x) => (x.st.key === 'suspended' ? 2 : x.st.due === Infinity ? 1 : 0);
        filtered.sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? a.st.due - b.st.due : 0) || a.note.id - b.note.id);
      } else {
        filtered.sort((a, b) => (b.note.created || 0) - (a.note.created || 0) || byId(a, b));
      }
      return terms;
    }

    function renderFilters() {
      const counts = { all: matched.length, new: 0, learn: 0, review: 0, suspended: 0 };
      matched.forEach((x) => counts[x.st.key]++);
      elFilters.innerHTML = FILTERS.map(([v, l]) => `
        <button type="button" class="chip" data-f="${v}" aria-pressed="${state.f === v}">
          <span>${l}</span> <span class="chip-n">${counts[v]}</span>
        </button>`).join('');
      chipFade();
    }

    function pill(st) {
      if (st.key === 'suspended') return '<span class="tag tag-susp">Suspendida</span>';
      if (st.key === 'learn') return `<span class="tag tag-learn">Aprendiendo · ${fmtSoon(st.due)}</span>`;
      if (st.key === 'review') return `<span class="tag tag-due">Repaso ${fmtDue(st.due)}</span>`;
      return '<span class="tag tag-new">Nueva</span>';
    }

    let terms = [];
    function titleHtml(x) {
      if (!x.title) return '<span class="note-empty">(vacía)</span>';
      let budget = 160;
      let out = '';
      for (const s of x.segs) {
        if (budget <= 0) break;
        let t = s.t;
        if (t.length > budget) t = t.slice(0, budget - 1) + '…';
        budget -= t.length;
        const h = U.highlight(t, terms);
        out += s.gap ? `<span class="gap">${h}</span>` : h;
      }
      return out;
    }

    function rowHtml(x) {
      const n = x.note;
      const meta = [`<span class="meta-type">${C.TYPES[n.type].label}</span>`];
      if (!deck || n.deckId !== deckId) {
        const d = S.deck(n.deckId);
        if (d) meta.push(`<span class="meta-item">${U.esc(S.shortName(d))}</span>`);
      }
      if ((n.tags || []).length) meta.push(`<span class="meta-item">${U.highlight(n.tags.join(', '), terms)}</span>`);
      if (x.st.partial) {
        meta.push(`<span class="meta-item meta-partial">${x.st.susp} de ${x.st.total} tarjetas suspendida${x.st.susp === 1 ? '' : 's'}</span>`);
      }
      // Si la búsqueda coincide fuera del título (reverso, extra…), una línea de contexto.
      let hit = '';
      if (terms.length && x.body && !terms.every((t) => x.titleFold.includes(t))) {
        const ex = U.excerpt(x.body, terms);
        if (ex) hit = `<span class="note-hit">${ex}</span>`;
      }
      const body = `<span class="note-title">${titleHtml(x)}</span>${hit}
          <span class="note-meta">${pill(x.st)}${meta.join('')}</span>`;
      if (state.selecting) {
        const on = selected.has(n.id);
        return `<li data-id="${n.id}"><label class="note-row is-selectable${on ? ' is-selected' : ''}">
          <input type="checkbox" class="note-check" value="${n.id}"${on ? ' checked' : ''}>
          <span class="note-body">${body}</span></label></li>`;
      }
      return `<li data-id="${n.id}"><a href="#/edit/${n.id}" class="note-row">${body}</a></li>`;
    }

    function updateCount() {
      const total = filtered.length;
      if (!total) { elCount.textContent = ''; return; }
      if (state.shown < total) {
        elCount.textContent = `Mostrando ${state.shown} de ${total} nota${total === 1 ? '' : 's'}`;
      } else {
        const nc = filtered.reduce((s, x) => s + x.cards.length, 0);
        elCount.textContent = `${total} nota${total === 1 ? '' : 's'} · ${nc} tarjeta${nc === 1 ? '' : 's'}`;
      }
      const rem = total - state.shown;
      elMore.hidden = rem <= 0;
      if (rem > 0) elMore.textContent = rem <= PAGE ? `Mostrar ${rem === 1 ? "la última" : `las ${rem} restantes`}` : `Mostrar ${PAGE} más (quedan ${rem})`;
    }

    function appendRows(n) {
      const slice = filtered.slice(state.shown, state.shown + n);
      elList.insertAdjacentHTML('beforeend', slice.map(rowHtml).join(''));
      state.shown += slice.length;
      updateCount();
      return slice;
    }

    function noResultsHtml() {
      const label = (FILTERS.find(([v]) => v === state.f) || [])[1];
      if (state.q) {
        return `<li class="browse-none"><p>Ninguna nota coincide con «${U.esc(state.q)}»${state.f !== 'all' ? ` en ${U.esc(label.toLowerCase())}` : ''}.</p>
          <button type="button" class="btn" data-act="clear-q">Borrar búsqueda</button></li>`;
      }
      return `<li class="browse-none"><p>No hay notas en «${U.esc(label)}».</p>
        <button type="button" class="btn" data-act="clear-f">Ver todas</button></li>`;
    }

    /** Vuelve a pintar la lista. keep: cuántas filas mostrar como mínimo. */
    function apply({ keep = PAGE } = {}) {
      const empty = !all.length;
      $('#b-empty').hidden = !empty;
      $('#b-main').hidden = empty;
      if (empty) {
        $('#b-empty').innerHTML = `<div class="empty">
          ${UI.icons.cards || ''}
          <h2>Aún no hay notas aquí</h2>
          <p>Las tarjetas que crees aparecerán en esta lista.</p>
          <a class="btn btn-primary" href="${addHref}">${UI.icons.plus}<span>Añadir tarjeta</span></a></div>`;
        exitSelect(false);
        return;
      }
      terms = compute();
      renderFilters();
      state.shown = 0;
      elList.innerHTML = '';
      if (!filtered.length) {
        elList.innerHTML = noResultsHtml();
        elMore.hidden = true;
        elCount.textContent = state.q ? 'Sin resultados' : '';
      } else {
        appendRows(Math.max(PAGE, keep));
      }
      persist();
      updateBulk();
    }

    // ---------- Selección y acciones masivas ----------
    function updateBulk() {
      elBulk.hidden = !state.selecting;
      view.classList.toggle('is-selecting', state.selecting);
      if (!state.selecting) return;
      const n = selected.size;
      const visibleIds = filtered.slice(0, state.shown).map((x) => x.note.id);
      const visibleSet = new Set(visibleIds);
      const hidden = [...selected].filter((id) => !visibleSet.has(id)).length;
      $('#b-bulk-count').textContent = !n ? 'Ninguna nota seleccionada'
        : `${n} seleccionada${n === 1 ? '' : 's'}${hidden ? ` (${hidden} sin mostrar)` : ''}`;
      const byId = new Map(all.map((x) => [x.note.id, x]));
      const allSusp = n > 0 && [...selected].every((id) => byId.get(id)?.st.key === 'suspended');
      const bS = $('#b-susp');
      bS.textContent = allSusp ? 'Reactivar' : 'Suspender';
      bS.dataset.mode = allSusp ? 'on' : 'off';
      ['#b-susp', '#b-move', '#b-del'].forEach((s) => ($(s).disabled = !n));
      // «Visibles» solo marca las filas pintadas; las demás se ofrecen aparte, de forma explícita.
      const allVisibleOn = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
      const bAll = $('#b-all');
      bAll.textContent = n ? 'Ninguna' : `Visibles (${visibleIds.length})`;
      bAll.setAttribute('aria-label', n ? 'Quitar la selección' : `Seleccionar las ${visibleIds.length} notas visibles`);
      const rest = filtered.filter((x) => !selected.has(x.note.id)).length;
      const bRest = $('#b-rest');
      bRest.hidden = !(allVisibleOn && rest > 0);
      bRest.textContent = `Seleccionar también las ${rest} sin mostrar`;
    }

    // ---------- Deshacer (suspender, reactivar, mover) ----------
    let undoTimer = null;
    function offerUndo(msg, snap) {
      const box = $('#b-undo');
      $('#b-undo-msg').textContent = msg;
      box.hidden = false;
      clearTimeout(undoTimer);
      undoTimer = setTimeout(() => { box.hidden = true; }, 9000);
      $('#b-undo-btn').onclick = async () => {
        clearTimeout(undoTimer);
        box.hidden = true;
        await S.restoreNotes(snap);
        load();
        apply({ keep: state.shown });
        UI.toast('Cambio deshecho');
        focusBulk();
      };
    }

    /** Tras una acción o un diálogo cancelado, el foco vuelve a la barra (nunca al <body>). */
    function focusBulk(fallback) {
      const el = state.selecting ? (fallback && !fallback.disabled ? fallback : $('#b-bulk-count')) : elSel;
      // Tras cerrar un <dialog> el navegador devuelve el foco por su cuenta: se corrige en el siguiente cuadro.
      requestAnimationFrame(() => el?.focus({ preventScroll: true }));
    }

    function enterSelect() {
      state.selecting = true;
      elSel.setAttribute('aria-pressed', 'true');
      elSel.textContent = 'Listo';
      apply({ keep: state.shown });
      const first = elList.querySelector('.note-check');
      if (first) first.focus({ preventScroll: true });
    }

    function exitSelect(rerender = true) {
      if (!state.selecting) return;
      state.selecting = false;
      selected.clear();
      elSel.setAttribute('aria-pressed', 'false');
      elSel.textContent = 'Seleccionar';
      if (rerender) apply({ keep: state.shown });
      updateBulk();
    }

    function afterBulk() {
      load();
      selected.clear();
      apply({ keep: state.shown });
      focusBulk();
    }
    const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;

    async function bulkSuspend() {
      const on = $('#b-susp').dataset.mode !== 'on';
      const ids = [...selected];
      const snap = S.snapshotNotes(ids);
      await S.setSuspendedMany(ids, on);
      afterBulk();
      offerUndo(on ? `${pl(ids.length, 'nota suspendida', 'notas suspendidas')}` : `${pl(ids.length, 'nota reactivada', 'notas reactivadas')}`, snap);
    }

    async function bulkMove() {
      const ids = [...selected];
      const sel = all.filter((x) => selected.has(x.note.id));
      const from = new Set(sel.map((x) => x.note.deckId));
      const only = from.size === 1 ? [...from][0] : null;
      const options = S.decks().map((d) => {
        const cur = d.id === only;
        return `<option value="${d.id}"${cur ? ' disabled' : ''}>${U.esc(d.name.split('::').join(' › '))}${cur ? ' (mazo actual)' : ''}</option>`;
      }).join('');
      const dest = await UI.modal({
        title: `Mover ${pl(ids.length, 'nota', 'notas')}`,
        body: `<label class="field"><span>Mazo de destino</span>
          <select name="d" required><option value="" disabled selected>Elige un mazo</option>${options}</select></label>`,
        actions: [
          { label: 'Mover', primary: true, collect: (d) => +d.querySelector('[name=d]').value || null },
          { label: 'Cancelar', value: null }
        ],
        onOpen: (d) => d.querySelector('select').focus()
      });
      if (!dest) return focusBulk($('#b-move'));
      const already = sel.filter((x) => x.note.deckId === dest).length;
      const snap = S.snapshotNotes(ids);
      const moved = await S.moveNotes(ids, dest);
      const name = S.shortName(S.deck(dest));
      afterBulk();
      const msg = `${pl(moved, 'nota movida', 'notas movidas')} a «${name}»${already ? ` · ${already} ya estaba${already === 1 ? '' : 'n'} allí` : ''}`;
      if (moved) offerUndo(msg, snap); else UI.toast(msg);
    }

    async function bulkDelete() {
      const n = selected.size;
      const nc = all.filter((x) => selected.has(x.note.id)).reduce((s, x) => s + x.cards.length, 0);
      const ok = await UI.confirm(
        `¿Eliminar ${pl(n, 'nota', 'notas')}?`,
        `Se eliminarán ${pl(n, 'nota', 'notas')} y ${pl(nc, 'tarjeta', 'tarjetas')}, con su progreso. No se puede deshacer.`,
        'Eliminar', true);
      if (!ok) return focusBulk($('#b-del'));
      await S.deleteNotes([...selected]);
      afterBulk();
      UI.toast(`${pl(n, 'nota eliminada', 'notas eliminadas')}`);
    }

    // ---------- Eventos ----------
    elQ.addEventListener('input', U.debounce(() => { state.q = elQ.value.trim(); forget(); apply(); }, 150));
    elSort.onchange = () => { state.sort = elSort.value; forget(); apply({ keep: state.shown }); };
    elSel.onclick = () => (state.selecting ? exitSelect() : enterSelect());

    elFilters.addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]');
      if (!b || b.dataset.f === state.f) return;
      state.f = b.dataset.f;
      forget();
      apply();
      elFilters.querySelector(`[data-f="${state.f}"]`)?.focus();
    });

    elList.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (act) {
        forget();
        if (act.dataset.act === 'clear-q') { elQ.value = ''; state.q = ''; }
        else state.f = 'all';
        apply();
        elQ.focus();
        return;
      }
      const a = e.target.closest('a.note-row');
      if (a) {
        // Recordar dónde estábamos para volver aquí desde el editor.
        const li = a.closest('li');
        persist({ anchor: +li.dataset.id, offset: Math.round(li.getBoundingClientRect().top) });
        ss.set(RESTORE, key);
        watchReturn();
        try { sessionStorage.setItem('recallo.returnTo', location.hash); } catch { /* sin almacenamiento */ }
      }
    });

    elList.addEventListener('change', (e) => {
      const cb = e.target.closest('.note-check');
      if (!cb) return;
      const id = +cb.value;
      cb.checked ? selected.add(id) : selected.delete(id);
      cb.closest('.note-row').classList.toggle('is-selected', cb.checked);
      updateBulk();
    });

    elMore.onclick = () => {
      const slice = appendRows(PAGE);
      persist();
      const first = slice[0] && elList.querySelector(`li[data-id="${slice[0].note.id}"] a, li[data-id="${slice[0].note.id}"] input`);
      if (first) first.focus();
    };

    function syncChecks() {
      elList.querySelectorAll('.note-check').forEach((cb) => {
        cb.checked = selected.has(+cb.value);
        cb.closest('.note-row').classList.toggle('is-selected', cb.checked);
      });
      updateBulk();
    }
    $('#b-all').onclick = () => {
      if (selected.size) selected.clear();
      else filtered.slice(0, state.shown).forEach((x) => selected.add(x.note.id));
      syncChecks();
    };
    $('#b-rest').onclick = () => {
      filtered.forEach((x) => selected.add(x.note.id));
      syncChecks();
      $('#b-bulk-count').focus({ preventScroll: true });
    };
    $('#b-susp').onclick = bulkSuspend;
    $('#b-move').onclick = bulkMove;
    $('#b-del').onclick = bulkDelete;

    elTop.onclick = () => {
      window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      elQ.focus({ preventScroll: true });
    };
    const onScroll = () => { elTop.hidden = window.scrollY < 1200; };
    window.addEventListener('scroll', onScroll, { passive: true });

    const onKey = (e) => {
      if (document.querySelector('#modal[open]')) return;
      const typing = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]');
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); elQ.focus(); elQ.select(); }
      else if (e.key === 'Escape' && state.selecting) { e.preventDefault(); exitSelect(); elSel.focus(); }
    };
    document.addEventListener('keydown', onKey);

    // Fila de filtros desplazable: degradado en el borde que aún tiene contenido.
    const chipFade = () => {
      const el = elFilters;
      el.classList.toggle('fade-start', el.scrollLeft > 2);
      el.classList.toggle('fade-end', el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    elFilters.addEventListener('scroll', chipFade, { passive: true });
    window.addEventListener('resize', chipFade);

    UI.onLeave(() => {
      clearTimeout(undoTimer);
      window.removeEventListener('resize', chipFade);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', onKey);
      view.classList.remove('is-selecting');
    });

    // ---------- Primera pintura (restaurando posición si volvemos del editor) ----------
    if (restoring && saved.anchor) {
      const idx = (() => { compute(); return filtered.findIndex((x) => x.note.id === saved.anchor); })();
      apply({ keep: Math.max(saved.shown || PAGE, idx + 1) });
      const li = elList.querySelector(`li[data-id="${saved.anchor}"]`);
      if (li) {
        window.scrollTo(0, Math.max(0, li.getBoundingClientRect().top + window.scrollY - (saved.offset ?? 120)));
        li.querySelector('a')?.focus({ preventScroll: true });
      }
    } else {
      apply();
    }
    onScroll();
  };
})(window.App);
