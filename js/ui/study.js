/* Pantalla de estudio: muestra la tarjeta, revela la respuesta y registra la valoración. */
(function (App) {
  'use strict';
  const U = App.util, S = App.store, UI = App.ui, C = App.cards, Sch = App.scheduler;
  const V = App.views;

  V.study = (deckId) => {
    const deck = S.deck(deckId);
    if (!deck) return void (location.hash = '#/');

    let current = null;
    let queue = null;
    let revealed = false;
    let shownAt = 0;
    let busy = false;
    let waitTimer = null;
    // Pila de deshacer por mazo: sobrevive SOLO a la ida y vuelta al editor (E → editar → volver).
    // Al entrar al estudio desde cualquier otro sitio empieza vacía: así Z nunca recupera
    // tarjetas de una visita anterior.
    App.session = App.session || {};
    App.session.undo = App.session.undo || {};
    for (const k of Object.keys(App.session.undo)) if (!S.deck(+k)) delete App.session.undo[k]; // mazos borrados
    if (App.session.undoKeep !== deckId) App.session.undo[deckId] = [];
    App.session.undoKeep = null;
    const undoStack = App.session.undo[deckId];
    let keyMsg = ''; // valoración hecha con teclado, pendiente de anunciar junto con la tarjeta siguiente
    // Pista «Toca la tarjeta»: contador local del dispositivo (no viaja en copias ni sincronización).
    const tapHints = () => { try { return +localStorage.getItem('recallo.tapHints') || 0; } catch { return 3; } };
    const bumpTapHints = () => { try { localStorage.setItem('recallo.tapHints', String(tapHints() + 1)); } catch { /* sin almacenamiento */ } };
    let sessionDone = 0; const sessionStart = Date.now(); const ratingsCount = { 1: 0, 2: 0, 3: 0, 4: 0 };
    let revealedAt = 0; // para ignorar una valoración de teclado justo después de revelar

    UI.setHeader({
      title: S.shortName(deck),
      back: `#/deck/${deckId}`,
      actions: [
        { icon: 'undo', label: 'Deshacer (Z)', id: 'btn-undo', onClick: () => undo() },
        { icon: 'more', label: 'Opciones de la tarjeta', id: 'btn-edit', onClick: () => cardMenu() }
      ]
    });

    const view = UI.render(`
      <div class="study">
        <div class="study-head">
          <div class="study-top" id="st-counts"></div>
          <div class="study-progress" id="st-progress" role="progressbar" aria-label="Progreso de la sesión" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0"><span></span></div>
        </div>
        <div class="card-stage"><article class="flashcard" id="st-card"></article></div>
        <div class="answer-bar"><div class="answer-bar-inner" id="st-bar"></div></div>
      </div>`);
    const elCard = view.querySelector('#st-card');
    const elBar = view.querySelector('#st-bar');
    const elCounts = view.querySelector('#st-counts');
    // Tocar la tarjeta revela la respuesta (sin interferir con enlaces, audio ni selección de texto).
    elCard.addEventListener('click', (e) => {
      if (revealed || !current) return;
      if (e.target.closest('a, audio, video, button, input, select, textarea, summary')) return;
      const sel = window.getSelection && window.getSelection();
      if (sel && !sel.isCollapsed && elCard.contains(sel.anchorNode)) return;
      if (tapHints() < 3) bumpTapHints(); // la pista táctil se retira tras 3 toques
      reveal();
    });

    function updateToolbar() {
      UI.$('#btn-undo').disabled = !undoStack.length;
      UI.$('#btn-edit').disabled = !current;
    }

    function next() {
      clearTimeout(waitTimer);
      const r = S.nextCard(deckId);
      current = r.card;
      queue = r.queue;
      elCounts.innerHTML = UI.countsHtml(r.state.counts, queue, { labels: true });
      updateProgress(r.state);
      if (!current) return showDone(r.state);
      revealed = false;
      shownAt = Date.now();
      renderCard();
    }

    /** Al revelar: deja la respuesta (separador, o el primer hueco cloze) visible
     *  justo bajo la cabecera fija y por encima de la barra de respuesta. */
    function scrollToAnswer() {
      // (La clase .face-long de respuestas largas la pone renderCard, igual antes y después de revelar.)
      const target = elCard.querySelector('.answer-sep') || elCard.querySelector('.cloze') || elCard;
      // Medición síncrona (getBoundingClientRect fuerza el layout): sin rAF, que se
      // congela en pestañas en segundo plano.
      const hdr = document.querySelector('.topbar');
      const bar = document.querySelector('.answer-bar');
      // --bar-h = altura real de la barra sin el área segura (app.css la suma aparte).
      if (bar) {
        const safe = Math.max(0, parseFloat(getComputedStyle(bar).paddingBottom) - 12);
        document.documentElement.style.setProperty('--bar-h', Math.ceil(bar.offsetHeight - safe) + 'px');
      }
      const top = (hdr ? hdr.getBoundingClientRect().bottom : 0) + 16;
      const bottom = (bar ? bar.getBoundingClientRect().top : window.innerHeight) - 16;
      const r = target.getBoundingClientRect();
      // Hueco cloze: que se vea entero; separador: que quepan ~3 líneas de respuesta.
      const isSep = target.classList.contains('answer-sep');
      const need = isSep ? r.top + 100 : r.bottom;
      if (r.top >= top && need <= bottom) return;
      // Al hueco cloze le dejamos ~2 líneas de contexto por encima.
      const context = target.classList.contains('cloze') ? 64 : 0;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: Math.max(0, window.scrollY + r.top - top - context), behavior: reduce ? 'auto' : 'smooth' });
    }

    /** Marca la tarjeta con .is-overflowing si su contenido sigue por debajo de la
     *  barra de respuesta: solo entonces adapt.css muestra el degradado inferior. */
    function updateOverflow() {
      if (!elCard.isConnected) return;
      const bar = document.querySelector('.answer-bar');
      const limit = bar ? bar.getBoundingClientRect().top : window.innerHeight;
      // Altura viva de la barra (con área segura) para anclar el degradado justo encima.
      if (bar) elCard.style.setProperty('--answer-bar-live', bar.offsetHeight + 'px');
      elCard.classList.toggle('is-overflowing', elCard.getBoundingClientRect().bottom > limit + 1);
      // Las imágenes cambian la altura al cargar: recalcular cuando lleguen.
      elCard.querySelectorAll('img').forEach((img) => {
        if (!img.complete) img.addEventListener('load', updateOverflow, { once: true });
      });
    }
    // Recalcular también si cambia el tamaño de la tarjeta, de la barra o de la ventana.
    const overflowRO = typeof ResizeObserver === 'function' ? new ResizeObserver(() => updateOverflow()) : null;
    if (overflowRO) { overflowRO.observe(elCard); overflowRO.observe(elBar); }
    window.addEventListener('resize', updateOverflow);
    window.addEventListener('orientationchange', updateOverflow);
    UI.onLeave(() => {
      if (overflowRO) overflowRO.disconnect();
      window.removeEventListener('resize', updateOverflow);
      window.removeEventListener('orientationchange', updateOverflow);
    });

    // ---- Accesibilidad: región viva propia, texto hablado y foco ----
    const UNITS = { d: ['día', 'días'], h: ['hora', 'horas'], min: ['minuto', 'minutos'] };
    const spokenIvl = (s) => String(s).replace(/^(\S+) (d|h|min)$/, (m, n, u) => `${n} ${UNITS[u][n === '1' ? 0 : 1]}`);
    function faceText(face) {
      if (!face) return '';
      const sep = face.querySelector('.answer-sep');
      let t;
      if (sep) {
        const rg = document.createRange();
        rg.setStartAfter(sep);
        rg.setEnd(face, face.childNodes.length);
        t = rg.toString();
      } else t = face.textContent;
      t = t.replace(/\s+/g, ' ').trim();
      return t.length > 200 ? t.slice(0, 199).trimEnd() + '…' : t;
    }
    function announce(text) {
      let live = document.getElementById('st-live');
      if (!live) {
        live = document.createElement('div');
        live.id = 'st-live';
        live.className = 'visually-hidden';
        live.setAttribute('aria-live', 'polite');
        live.setAttribute('aria-atomic', 'true');
        view.appendChild(live);
      }
      live.textContent = '';
      setTimeout(() => { live.textContent = text; }, 120);
    }
    function settle(el, text) {
      if (el && el.isConnected) el.focus({ preventScroll: true });
      if (text) announce(text);
    }

    function renderCard() {
      const note = S.note(current.noteId);
      if (!note) { S.deleteNotes([current.noteId]); return next(); }
      const r = C.render(current, note);
      elCard.className = 'flashcard' + (revealed ? ' revealed' : '');
      elCard.classList.toggle('show-tap-hint', tapHints() < 3);
      elCard.innerHTML = revealed
        ? `<div class="face" role="region" aria-label="Respuesta">${C.toDisplayHtml(r.a)}</div>`
        : `<div class="face" id="st-face" role="region" aria-label="Pregunta">${C.toDisplayHtml(r.q)}</div>`;
      // Misma alineación antes y después de revelar (las respuestas largas van a la izquierda).
      const faceEl = elCard.querySelector('.face');
      // La alineación se decide por partes: una pregunta breve sigue centrada aunque la
      // respuesta sea larga; solo el texto largo va a la izquierda (adapt.css).
      const LONG = 140;
      const qLen = U.stripHtml(r.q).length;
      const aLen = note.type === 'cloze' ? U.stripHtml(r.a).length : Math.max(0, U.stripHtml(r.a).length - qLen);
      const qLong = note.type === 'cloze' ? aLen > LONG : qLen > LONG;
      faceEl.classList.toggle('face-long', qLong || aLen > LONG); // medida de 60ch, igual antes y después
      faceEl.classList.toggle('q-long', qLong);
      faceEl.classList.toggle('a-long', revealed && aLen > LONG);
      if (revealed) {
        const p = Sch.preview(current, S.settings());
        elBar.innerHTML = `<div class="rate-grid">${Sch.RATINGS.map((x) => `
          <button class="rate rate-${x.value}" data-r="${x.value}" data-spoken="${x.label} · vuelve en ${spokenIvl(p[x.value])}" aria-label="${x.label}, vuelve en ${spokenIvl(p[x.value])}" aria-keyshortcuts="${x.value}">
            <span class="rate-ivl">${p[x.value]}</span>
            <span class="rate-label">${x.label}</span>
            <kbd class="rate-key" aria-hidden="true">${x.value}</kbd>
          </button>`).join('')}</div>`;
        elBar.querySelectorAll('.rate').forEach((b) => (b.onclick = () => answer(+b.dataset.r)));
        scrollToAnswer();
      } else {
        elBar.innerHTML = `<button class="btn btn-primary btn-lg btn-block" id="btn-show">Mostrar respuesta</button>`;
        elBar.querySelector('#btn-show').onclick = reveal;
      }
      updateToolbar();
      // Accesibilidad: foco al siguiente paso lógico y anuncio breve (solo el texto relevante).
      if (revealed) settle(elBar.querySelector('.rate-3'), `Respuesta: ${faceText(elCard.querySelector('.face'))}`);
      else {
        const b = elBar.querySelector('#btn-show');
        if (keyMsg) {
          // Tras valorar con teclado: un solo mensaje con la valoración y la pregunta siguiente
          // (sin descripción en el botón, para que el foco no corte ni duplique el anuncio).
          settle(b, `${keyMsg}. Siguiente: ${faceText(elCard.querySelector('.face'))}`);
          keyMsg = '';
        } else {
          if (b) b.setAttribute('aria-describedby', 'st-face'); // la pregunta se lee una vez, como descripción del botón
          settle(b);
        }
      }
      updateOverflow();
    }

    /** Línea de progreso: respuestas de esta sesión frente a lo que queda hoy (sobrevive a deshacer). */
    function sessionLog() {
      const log = S.reviewsSince(sessionStart, S.deckFamilyIds(deckId));
      sessionDone = log.length;
      [1, 2, 3, 4].forEach((k) => (ratingsCount[k] = 0));
      log.forEach((l) => ratingsCount[l.rating]++);
      return log;
    }
    function updateProgress(state) {
      sessionLog();
      const c = state.counts;
      const total = sessionDone + c.new + c.learn + c.review;
      const el = view.querySelector('#st-progress');
      if (!el) return;
      el.setAttribute('aria-valuemax', String(Math.max(1, total)));
      el.setAttribute('aria-valuenow', String(sessionDone));
      el.setAttribute('aria-valuetext', `${sessionDone} de ${total} respuestas`);
      el.firstElementChild.style.transform = `scaleX(${total ? sessionDone / total : 0})`;
    }

    function nextReviewText() {
      const ids = S.deckFamilyIds(deckId);
      let due = Infinity;
      for (const c of S.allCards()) if (ids.has(c.deckId) && !c.suspended && c.state === 'review' && c.due < due) due = c.due;
      if (due === Infinity) return null;
      if (due < U.dayStart(1)) return 'hoy';
      if (due < U.dayStart(2)) return 'mañana';
      return U.fmtDate(due);
    }

    function showDone(state) {
      elCard.className = 'flashcard done';
      const log = sessionLog();
      // «Recordadas» por tarjeta: cuenta solo la primera respuesta de cada una en esta sesión
      // (los pasos de aprendizaje repetidos no inflan el porcentaje).
      const first = new Map();
      log.forEach((l) => { if (!first.has(l.cardId)) first.set(l.cardId, l.rating); });
      const cardsSeen = first.size;
      const recalledN = [...first.values()].filter((r) => r >= 2).length;
      const recalled = cardsSeen ? Math.round((recalledN / cardsSeen) * 100) : 0;
      const buried = S.buriedSiblingsCount ? S.buriedSiblingsCount(deckId) : 0;
      const secs = Math.round(log.reduce((s, l) => s + (l.timeMs || 0), 0) / 1000);
      const pending = state.learnLater.length > 0;
      const nextRev = nextReviewText();

      const title = pending ? 'Pausa breve' : 'Sesión completada';
      let line;
      const tarjetas = (n) => `${n} ${n === 1 ? 'tarjeta' : 'tarjetas'}`;
      if (pending) line = 'Quedan tarjetas en aprendizaje. Seguimos donde lo dejaste en cuanto vuelvan.';
      else if (!log.length) line = 'No hay nada pendiente hoy en este mazo.';
      // Sesiones pequeñas: frase neutra basada en el recuento (un solo fallo no es «exigente»).
      else if (cardsSeen <= 5) {
        const missed = cardsSeen - recalledN;
        line = missed
          ? `Has repasado ${tarjetas(cardsSeen)}; ${missed === 1 ? '1 volverá' : `${missed} volverán`} antes que las demás.`
          : `Has repasado ${tarjetas(cardsSeen)} y ${cardsSeen === 1 ? 'la recordaste' : 'las recordaste todas'}.`;
      }
      else if (recalled >= 85) line = 'Memoria firme hoy. Has repasado todo lo previsto en este mazo.';
      else if (recalled >= 60) line = 'Buen repaso. Lo que costó más volverá pronto para asentarse.';
      else line = 'Sesión exigente. Las que fallaste volverán antes: así es como se aprenden.';

      // Tiempo en la unidad que se lea con naturalidad: segundos si no llega al minuto.
      const time = secs < 60 ? [Math.max(1, secs), 's'] : [Math.round(secs / 60), 'min'];
      const recalledHtml = cardsSeen <= 5
        ? `${recalledN}<small> de ${cardsSeen}</small>` : `${recalled}<small>%</small>`;
      const stats = log.length ? `
        <dl class="recap">
          <div><dt>Tarjetas</dt><dd>${cardsSeen}</dd></div>
          <div><dt>Recordadas</dt><dd>${recalledHtml}</dd></div>
          <div><dt>Tiempo</dt><dd>${time[0]}<small> ${time[1]}</small></dd></div>
        </dl>` : '';
      const notes = [];
      if (log.length > cardsSeen) notes.push(`${log.length} respuestas en total`);
      const buriedText = buried ? `${buried} ${buried === 1 ? 'tarjeta hermana pospuesta' : 'tarjetas hermanas pospuestas'} a mañana` : '';
      if (buried) notes.push(buriedText);
      const notesLine = notes.length ? `<p class="recap-note">${notes.join(' · ')}</p>` : '';
      // Explicación visible (también en táctil y lector de pantalla) sin salir del resumen.
      const whyLine = buried ? `
        <details class="recap-why">
          <summary>¿Por qué se posponen?</summary>
          <p>Las tarjetas de una misma nota se reparten en días distintos para que una no te chive la respuesta de la otra. <a href="#/settings">Cambiar en Ajustes</a></p>
        </details>` : '';
      const nextLine = nextRev && !pending
        ? `<p class="recap-next">Próximo repaso: <strong>${U.esc(nextRev)}</strong></p>` : '';
      const wait = pending
        ? `<p class="recap-wait" aria-live="off">Continuamos en <strong class="recap-countdown" id="st-countdown"></strong></p>` : '';

      elCard.innerHTML = `<div class="face recap-face">
          <h2 class="recap-title">${title}</h2>
          <p class="recap-line">${line}</p>
          ${stats}${notesLine}${whyLine}${nextLine}${wait}
        </div>`;
      elBar.innerHTML = `<div class="recap-actions">
          <a class="btn btn-lg" href="#/">Inicio</a>
          <a class="btn btn-primary btn-lg" href="#/deck/${deckId}">Volver al mazo</a>
        </div>`;

      if (pending) {
        const resumeAt = Math.max(Date.now() + 1000, state.learnLater[0].due - S.settings().learnAheadMinutes * 60000);
        waitTimer = setTimeout(next, resumeAt - Date.now());
        const cd = elCard.querySelector('#st-countdown');
        const tick = () => {
          if (!cd.isConnected) return;
          const s = Math.max(0, Math.ceil((resumeAt - Date.now()) / 1000));
          cd.textContent = s >= 3600 ? U.fmtMinutes(s / 60) : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
          setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
        };
        tick();
      }
      updateToolbar();
      // a11y: foco en «Volver al mazo» y anuncio del resumen (no el «N de N respuestas», siempre igual).
      const spokenRecap = log.length
        ? ` ${tarjetas(cardsSeen)}, ${recalledN} ${recalledN === 1 ? 'recordada' : 'recordadas'}, ${time[0]} ${time[1] === 's' ? 'segundos' : 'minutos'}.${buriedText ? ' ' + buriedText + '.' : ''}`
        : '';
      settle(elBar.querySelector(`a[href="#/deck/${deckId}"]`), `${keyMsg ? keyMsg + '. ' : ''}${title}. ${line}${spokenRecap}`);
      keyMsg = '';
    }

    function reveal() {
      if (!current || revealed) return;
      revealed = true;
      revealedAt = Date.now();
      renderCard();
    }

    async function answer(rating) {
      if (!current || !revealed || busy) return;
      busy = true;
      try {
        let saved;
        try {
          saved = await S.answer(current.id, rating, Date.now() - shownAt);
        } catch (err) {
          // No se guardó: la tarjeta sigue a la vista y revelada para reintentar.
          console.error(err);
          UI.toast('No se pudo guardar la respuesta. Inténtalo de nuevo.', 4000);
          return;
        }
        undoStack.push(saved);
        if (undoStack.length > 50) undoStack.shift();
        next();
      } finally {
        busy = false;
      }
    }

    async function undo() {
      if (busy) return;
      const u = undoStack.pop();
      if (!u) { updateToolbar(); return UI.toast('No hay nada que deshacer'); }
      if (!S.card(u.prev.id)) {
        // La tarjeta se borró (o la nota se editó y ya no la genera): se descarta esa entrada.
        updateToolbar();
        return UI.toast('No se puede deshacer: la tarjeta ya no existe');
      }
      busy = true;
      try {
        await S.undo(u);
      } catch (err) {
        console.error(err);
        undoStack.push(u);
        updateToolbar();
        return UI.toast('No se pudo deshacer. Inténtalo de nuevo.');
      } finally {
        busy = false;
      }
      clearTimeout(waitTimer);
      current = S.card(u.prev.id);
      queue = u.prev.state === 'new' ? 'new' : u.prev.state === 'review' ? 'review' : 'learn';
      const st = S.studyState(deckId);
      elCounts.innerHTML = UI.countsHtml(st.counts, queue, { labels: true });
      updateProgress(st);
      revealed = false;
      shownAt = Date.now();
      renderCard();
      const undone = App.scheduler.RATINGS.find((x) => x.value === (u.log && u.log.rating));
      const note = S.note(current.noteId);
      const which = note ? ` · «${U.truncate(C.sortText(note), 30)}»` : '';
      UI.toast(undone ? `Deshecho: ${undone.label}${which}` : `Respuesta deshecha${which}`);
    }

    function edit() {
      if (!current) return;
      App.session.undoKeep = deckId; // al volver del editor se conserva el deshacer
      location.hash = `#/edit/${current.noteId}`;
    }

    /** Atajo de teclado: la valoración («Bien · vuelve en 10 minutos») se anuncia junto con la
     *  tarjeta siguiente (renderCard) o con el resumen final (showDone), en un solo mensaje. */
    function keyAnswer(rating) {
      if (!current || !revealed || busy) return;
      if (Date.now() - revealedAt < 300) return; // un doble Espacio no valora antes de leer la respuesta
      keyMsg = elBar.querySelector(`.rate-${rating}`)?.dataset.spoken || ''; // vista previa capturada antes de responder
      answer(rating).finally(() => { keyMsg = ''; });
    }

    // ---- Opciones de la tarjeta actual (menú «⋯» y atajos P, S, R, ?) ----
    async function bury() {
      if (!current || busy) return;
      await S.buryCard(current.id);
      UI.toast('Pospuesta hasta mañana');
      next();
    }
    async function suspend() {
      if (!current || busy) return;
      await S.setSuspended(current.noteId, true);
      UI.toast('Suspendida: no volverá hasta que la reactives desde el editor', 3500);
      next();
    }
    function replay() {
      const a = elCard.querySelector('audio');
      if (!a) return UI.toast('Esta tarjeta no tiene audio');
      a.currentTime = 0;
      a.play().catch(() => UI.toast('No se pudo reproducir el audio'));
    }
    function shortcuts() {
      const rows = [
        ['Espacio', 'Mostrar respuesta · valorar «Bien»'], ['1 – 4', 'Otra vez · Difícil · Bien · Fácil'],
        ['Z', 'Deshacer'], ['E', 'Editar la tarjeta'], ['P', 'Posponer hasta mañana'],
        ['S', 'Suspender'], ['R', 'Repetir audio'], ['?', 'Ver estos atajos']
      ];
      UI.modal({
        title: 'Atajos de teclado',
        body: `<dl class="shortcut-list">${rows.map(([k, v]) => `<div><dt><kbd>${k}</kbd></dt><dd>${v}</dd></div>`).join('')}</dl>`,
        actions: [{ label: 'Entendido', value: true, primary: true }]
      });
    }
    function cardMenu() {
      if (!current) return;
      const items = [
        { label: 'Editar tarjeta · E', icon: 'edit', onClick: edit },
        { label: 'Posponer hasta mañana · P', icon: 'cards', onClick: bury },
        { label: 'Suspender · S', icon: 'trash', onClick: suspend }
      ];
      if (elCard.querySelector('audio')) items.push({ label: 'Repetir audio · R', icon: 'play', onClick: replay });
      items.push({ label: 'Atajos de teclado · ?', icon: 'list', onClick: shortcuts });
      UI.sheet('Esta tarjeta', items);
    }

    function onKey(e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target instanceof Element ? e.target : document.body;
      // Campos de texto, listas y diálogos: ningún atajo.
      if (t.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"]), dialog[open]')) return;
      if (e.key === ' ' || e.key === 'Enter') {
        // Enter/Espacio sobre un botón o enlace lo activan de forma nativa
        // (p. ej. Enter en «Otra vez» registra «Otra vez», no «Bien»).
        if (t.closest('button, a[href], [role="button"], [role="link"], summary')) return;
        e.preventDefault();
        if (e.repeat) return; // mantener pulsada la tecla no debe valorar varias tarjetas
        if (!revealed) reveal(); else keyAnswer(3);
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
        keyAnswer(+e.key);
      } else if (e.key === 'z' || e.key === 'Z') {
        undo();
      } else if (e.key === 'e' || e.key === 'E') {
        edit();
      } else if (e.key === 'p' || e.key === 'P') {
        bury();
      } else if (e.key === 's' || e.key === 'S') {
        suspend();
      } else if (e.key === 'r' || e.key === 'R') {
        replay();
      } else if (e.key === '?') {
        shortcuts();
      }
    }
    document.addEventListener('keydown', onKey);
    UI.onLeave(() => { document.removeEventListener('keydown', onKey); clearTimeout(waitTimer); });

    next();
  };
})(window.App);
