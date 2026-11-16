/* Editor de notas: crear y editar tarjetas con texto enriquecido, imágenes y huecos (cloze). */
(function (App) {
  'use strict';
  const U = App.util, S = App.store, UI = App.ui, C = App.cards;
  const V = App.views;

  // Última pantalla que no era el editor: a ella se vuelve al guardar, eliminar o salir.
  // (Este script se carga antes que app.js, así que este oyente corre antes del enrutador.)
  let prevRoute = null;
  window.addEventListener('hashchange', (e) => {
    const old = new URL(e.oldURL).hash || '#/';
    if (!/^#\/(add|edit)\b/.test(old)) prevRoute = old;
  });

  // Borradores por nota en la pestaña (si se sale sin guardar por un enlace o el botón Atrás).
  const DRAFT = (key) => `recallo:draft:${key}`;
  const draftGet = (key) => { try { return JSON.parse(sessionStorage.getItem(DRAFT(key)) || 'null'); } catch (e) { return null; } };
  const draftSet = (key, d) => { try { sessionStorage.setItem(DRAFT(key), JSON.stringify(d)); } catch (e) { /* sin almacenamiento */ } };
  const draftDel = (key) => { try { sessionStorage.removeItem(DRAFT(key)); } catch (e) { /* sin almacenamiento */ } };

  // Quita la sintaxis de huecos dejando la respuesta: {{c1::París::capital}} → París
  const unCloze = (html) => String(html || '').replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, '$1');
  const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

  V.editor = async ({ deckId = null, noteId = null }) => {
    const editing = noteId != null;
    const note = editing ? S.note(noteId) : null;
    if (editing && !note) return void (location.hash = '#/');

    const st = S.settings();
    let type = note ? note.type : C.TYPES[st.lastType] ? st.lastType : 'basic';
    let did = note ? note.deckId : deckId || st.lastDeckId;
    if (!S.deck(did)) did = S.decks()[0]?.id;
    if (!did) did = (await S.ensureDeck('Mi mazo')).id;

    // Valores actuales de los campos (se conservan al cambiar de tipo).
    const values = note ? { ...note.fields } : {};

    const cards = editing ? S.cardsOfNote(note.id) : [];
    let suspended = !!(cards.length && cards.every((c) => c.suspended));
    const draftKey = editing ? note.id : `new-${deckId || 'any'}`;
    // Adónde volver: la pantalla anterior (estudio, explorador, mazo…) o el mazo.
    const backTarget = prevRoute || (editing ? `#/deck/${note.deckId}` : deckId ? `#/deck/${deckId}` : '#/');

    UI.setHeader({
      title: editing ? 'Editar nota' : 'Nueva nota',
      back: backTarget,
      actions: editing ? [{ icon: 'more', label: 'Más acciones de la nota', id: 'ed-more', onClick: () => moreActions() }] : []
    });
    // El botón Atrás pregunta antes de descartar cambios sin guardar.
    UI.$('#hdr-back').onclick = () => leave(backTarget);

    const deckOptions = S.decks().map((d) => `<option value="${d.id}" ${d.id === did ? 'selected' : ''}>${U.esc(d.name.replace(/::/g, ' › '))}</option>`).join('');
    const typeOptions = Object.entries(C.TYPES).map(([k, t]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${t.label}</option>`).join('');

    const view = UI.render(`
      <form class="editor" id="ed-form" autocomplete="off" novalidate>
        ${editing ? `<div class="ed-suspended" id="ed-suspended" hidden>
          <span class="ed-pill">Suspendida</span>
          <p>Sus tarjetas no aparecen al estudiar.</p>
          <button type="button" class="btn btn-sm" id="ed-reactivate">Reactivar</button>
        </div>` : ''}
        <div class="ed-draft" id="ed-draft" role="status" hidden>
          <span class="ed-draft-label">Borrador</span>
          <p>Tienes cambios sin guardar de la última vez.</p>
          <div class="ed-draft-actions">
            <button type="button" class="btn btn-sm" id="ed-draft-discard">Descartar</button>
            <button type="button" class="btn btn-sm btn-primary" id="ed-draft-restore">Recuperar</button>
          </div>
        </div>
        <div class="row2">
          <label class="field"><span>Mazo</span><select id="ed-deck">${deckOptions}</select></label>
          <label class="field"><span>Tipo</span><select id="ed-type" aria-describedby="ed-type-hint">${typeOptions}</select></label>
        </div>
        <div class="hint" id="ed-type-hint"></div>
        <div id="ed-fields"></div>
        <label class="field"><span>Etiquetas</span><input id="ed-tags" placeholder="Separadas por espacios o comas" autocapitalize="off" spellcheck="false" value="${U.esc((note?.tags || st.lastTags || []).join(' '))}"></label>
        ${editing ? `<p class="ed-meta muted small" id="ed-meta"></p>` : ''}
        <div class="ed-bar">
          <p class="muted small kbd-hint">Ctrl + Enter para guardar</p>
          <button type="submit" class="btn btn-primary btn-lg" id="ed-save">${editing ? 'Guardar cambios' : 'Añadir nota'}</button>
        </div>
      </form>`);

    const elFields = view.querySelector('#ed-fields');
    const hints = {
      basic: '<p>Una tarjeta: ves el anverso y recuerdas el reverso.</p>',
      reverse: '<p>Dos tarjetas: anverso → reverso y reverso → anverso.</p>',
      cloze: `<p>Selecciona palabras y pulsa <b>[ … ]</b> (Ctrl + Alt + C) para ocultarlas: cada hueco nuevo crea una tarjeta.</p>
        <p>Con <b>Mismo nº</b> (Ctrl + Alt + Mayús + C) el hueco se oculta junto al anterior, en la misma tarjeta. Para dar una pista, escríbela dentro del hueco tras dos pares de dos puntos: <i>París::capital</i>.</p>`
    };
    const fieldHelp = { extra: 'Opcional · se muestra al revelar la respuesta' };

    // Icono de pausa para «Suspender» (la hoja de acciones busca los iconos por nombre).
    if (!UI.icons.pause) UI.icons.pause = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>';
    // Fechas sin el año cuando es el actual.
    const fmtDay = (ts) => {
      const d = new Date(ts);
      const sameYear = d.getFullYear() === new Date().getFullYear();
      return d.toLocaleDateString('es-ES', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
    };

    function collect() {
      elFields.querySelectorAll('.rich').forEach((r) => (values[r.dataset.key] = C.fromEditHtml(r.innerHTML)));
    }

    // ---------- Estado «sin guardar» ----------
    const tagsOf = () => view.querySelector('#ed-tags').value.trim().split(/[\s,]+/).filter(Boolean);
    function snapshot() {
      collect();
      const f = {};
      C.TYPES[type].fields.forEach(([k]) => (f[k] = values[k] || ''));
      // Un formulario nuevo sin texto no queda «sin guardar» solo por cambiar tipo o mazo.
      if (!editing && !Object.values(f).some(Boolean)) return JSON.stringify({ tags: tagsOf() });
      return JSON.stringify({ type, deck: +view.querySelector('#ed-deck').value, f, tags: tagsOf() });
    }
    let clean = '';
    let discarding = false;
    const markClean = () => { clean = snapshot(); };
    const isDirty = () => snapshot() !== clean;

    async function leave(target) {
      if (isDirty() && !(await UI.confirm('¿Descartar los cambios?', 'Has hecho cambios que no se han guardado. Si sales ahora, se perderán.', 'Descartar cambios', true))) return;
      discarding = true;
      draftDel(draftKey);
      location.hash = target;
    }

    const onBeforeUnload = (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onBeforeUnload);
    UI.onLeave(() => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Salida por un enlace o por el Atrás del navegador: se guarda un borrador para recuperarlo.
      if (!discarding && view.querySelector('#ed-form') && isDirty()) {
        draftSet(draftKey, { type, deck: +view.querySelector('#ed-deck').value, values: { ...values }, tags: tagsOf(), at: Date.now() });
      }
    });

    function updateMeta() {
      const m = view.querySelector('#ed-meta');
      if (!m) return;
      m.textContent = `${cards.length} tarjeta${cards.length === 1 ? '' : 's'} · creada el ${fmtDay(note.created)}`;
      const sb = view.querySelector('#ed-suspended');
      if (sb) sb.hidden = !suspended;
    }

    function renderFields() {
      view.querySelector('#ed-type-hint').innerHTML = hints[type];
      // Orden del DOM: título, campo, barra de formato (el foco llega antes al texto que a la barra);
      // la barra se coloca visualmente junto al título con CSS.
      elFields.innerHTML = C.TYPES[type].fields.map(([key, label]) => {
        const isClozeText = type === 'cloze' && key === 'text';
        const describedBy = fieldHelp[key] ? `help-${key}` : '';
        return `
        <div class="field ed-field" data-field="${key}">
          <div class="field-title">
            <span class="field-label" id="lbl-${key}">${label}</span>
            ${fieldHelp[key] ? `<small class="field-help" id="help-${key}">${fieldHelp[key]}</small>` : ''}
          </div>
          <div class="rich" contenteditable="true" data-key="${key}" role="textbox" aria-multiline="true" aria-labelledby="lbl-${key}"${describedBy ? ` aria-describedby="${describedBy}"` : ''} data-describedby="${describedBy}" spellcheck="true"></div>
          <div class="toolbar" role="toolbar" aria-label="Formato de ${label}">
            <button type="button" data-cmd="bold" aria-label="Negrita" aria-pressed="false" title="Negrita (Ctrl+B)" tabindex="0"><span class="tb-b" aria-hidden="true">B</span></button>
            <button type="button" data-cmd="italic" aria-label="Cursiva" aria-pressed="false" title="Cursiva (Ctrl+I)" tabindex="-1"><span class="tb-i" aria-hidden="true">I</span></button>
            <button type="button" data-cmd="underline" aria-label="Subrayado" aria-pressed="false" title="Subrayado (Ctrl+U)" tabindex="-1"><span class="tb-u" aria-hidden="true">U</span></button>
            <button type="button" data-cmd="image" aria-label="Insertar imagen" title="Insertar imagen" tabindex="-1">${UI.icons.image}</button>
            ${isClozeText ? `
            <button type="button" data-cmd="cloze" class="cloze-btn" aria-label="Ocultar selección como hueco nuevo" title="Hueco nuevo (Ctrl+Alt+C)" tabindex="-1"><span aria-hidden="true">[ … ]</span></button>
            <button type="button" data-cmd="cloze-same" class="cloze-btn cloze-same" aria-label="Ocultar selección con el mismo número que el último hueco" title="Mismo número que el último hueco (Ctrl+Alt+Mayús+C)" tabindex="-1"><span aria-hidden="true">Mismo nº</span></button>` : ''}
          </div>
          <p class="field-error" id="err-${key}" hidden></p>
          ${isClozeText ? '<div class="cloze-list" id="cloze-list" aria-label="Huecos de la nota"></div>' : ''}
        </div>`;
      }).join('');
      elFields.querySelectorAll('.rich').forEach((r) => {
        r.innerHTML = C.toEditHtml(values[r.dataset.key] || '');
        r.addEventListener('paste', onPaste);
        r.addEventListener('input', () => { clearError(r.dataset.key); highlightClozes(); });
        r.addEventListener('keyup', syncPressed);
        r.addEventListener('mouseup', syncPressed);
        r.addEventListener('focus', syncPressed);
      });
      elFields.querySelectorAll('.toolbar').forEach((tb) => {
        const btns = [...tb.querySelectorAll('button')];
        // Una sola parada de tabulación por barra; las flechas recorren los botones.
        tb.addEventListener('keydown', (e) => {
          const i = btns.indexOf(document.activeElement);
          if (i < 0) return;
          let j = null;
          if (e.key === 'ArrowRight') j = (i + 1) % btns.length;
          else if (e.key === 'ArrowLeft') j = (i - 1 + btns.length) % btns.length;
          else if (e.key === 'Home') j = 0;
          else if (e.key === 'End') j = btns.length - 1;
          if (j == null) return;
          e.preventDefault();
          btns.forEach((b, k) => (b.tabIndex = k === j ? 0 : -1));
          btns[j].focus();
        });
        btns.forEach((b) => {
          b.addEventListener('mousedown', (e) => e.preventDefault()); // conserva la selección
          b.addEventListener('click', (e) => runCmd(b.dataset.cmd, b.closest('.field').querySelector('.rich'), { same: b.dataset.cmd === 'cloze-same' || e.shiftKey || e.altKey }));
        });
      });
      highlightClozes();
    }

    // Estado pulsado de B/I/U según la selección.
    function syncPressed() {
      const rich = document.activeElement && document.activeElement.closest && document.activeElement.closest('.rich');
      if (!rich) return;
      rich.closest('.field').querySelectorAll('[data-cmd=bold],[data-cmd=italic],[data-cmd=underline]').forEach((b) => {
        let on = false;
        try { on = document.queryCommandState(b.dataset.cmd); } catch (e) { /* no disponible */ }
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    // Texto plano de un campo con un mapa posición → (nodo, desplazamiento).
    function textMap(rich) {
      const nodes = [];
      let text = '';
      const w = document.createTreeWalker(rich, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) { nodes.push([n, text.length]); text += n.data; }
      const at = (pos) => {
        for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i][1] <= pos) return [nodes[i][0], Math.min(pos - nodes[i][1], nodes[i][0].data.length)];
        return null;
      };
      const range = (from, to) => {
        const a = at(from), b = at(to);
        if (!a || !b) return null;
        const r = new Range();
        try { r.setStart(a[0], a[1]); r.setEnd(b[0], b[1]); return r; } catch (e) { return null; }
      };
      return { text, at, range };
    }

    // Huecos como fichas de tinta, sin tocar el HTML guardado (CSS Custom Highlight API):
    // fondo en todo el hueco, la sintaxis «{{ :: }}» casi invisible y el número como sello.
    const HL = ['recallo-cloze', 'recallo-cloze-syntax', 'recallo-cloze-num'];
    function highlightClozes() {
      const hasApi = window.CSS && CSS.highlights && window.Highlight;
      const whole = [], syntax = [], nums = [];
      const rich = elFields.querySelector('.rich[data-key="text"]');
      const gaps = [];
      if (rich && type === 'cloze') {
        const tm = textMap(rich);
        for (const m of tm.text.matchAll(CLOZE_RE)) {
          const start = m.index, end = m.index + m[0].length;
          const openLen = `{{c${m[1]}::`.length;
          const ansEnd = start + openLen + m[2].length;
          gaps.push({ n: +m[1], answer: m[2], hint: m[3] || '', ansStart: start + openLen });
          if (!hasApi) continue;
          [tm.range(start, end)].forEach((r) => r && whole.push(r));
          [tm.range(start, start + 2), tm.range(start + 2 + 1 + m[1].length, start + openLen), tm.range(ansEnd, end)].forEach((r) => r && syntax.push(r));
          const rn = tm.range(start + 2, start + 3 + m[1].length);
          if (rn) nums.push(rn);
        }
      }
      if (hasApi) {
        const h0 = new Highlight(...whole), h1 = new Highlight(...syntax), h2 = new Highlight(...nums);
        h1.priority = 1; h2.priority = 2;
        CSS.highlights.set(HL[0], h0); CSS.highlights.set(HL[1], h1); CSS.highlights.set(HL[2], h2);
      }
      renderClozeList(gaps);
    }
    UI.onLeave(() => { if (window.CSS && CSS.highlights) HL.forEach((k) => CSS.highlights.delete(k)); });

    // Lista de huecos bajo el texto: número, respuesta y × para quitar el hueco (deja el texto).
    function renderClozeList(gaps) {
      const box = view.querySelector('#cloze-list');
      if (!box) return;
      box.hidden = !gaps.length;
      box.innerHTML = gaps.map((g, i) => {
        const ans = g.answer.trim() || 'vacío';
        return `<span class="cloze-chip${g.answer.trim() ? '' : ' is-empty'}">
          <span class="cloze-chip-n" aria-hidden="true">${g.n}</span>
          <span class="cloze-chip-t">${U.esc(ans)}${g.hint ? ` <i>· ${U.esc(g.hint)}</i>` : ''}</span>
          <button type="button" class="cloze-chip-x" data-i="${i}" aria-label="Quitar el hueco ${g.n} (${U.esc(ans)}) y dejar el texto">×</button>
        </span>`;
      }).join('');
      box.querySelectorAll('.cloze-chip-x').forEach((b) => (b.onclick = () => removeCloze(+b.dataset.i)));
    }
    function removeCloze(index) {
      const rich = elFields.querySelector('.rich[data-key="text"]');
      if (!rich) return;
      const html = C.fromEditHtml(rich.innerHTML);
      let i = -1;
      const next = html.replace(CLOZE_RE, (all, n, ans) => (++i === index ? ans : all));
      values.text = next;
      rich.innerHTML = C.toEditHtml(next);
      clearError('text');
      highlightClozes();
      rich.focus();
    }

    // ---------- Errores en línea ----------
    // caretAt: posición (en el texto plano del campo) donde dejar el cursor.
    function setError(key, msg, caretAt = null) {
      const rich = elFields.querySelector(`.rich[data-key="${key}"]`);
      const err = view.querySelector(`#err-${key}`);
      if (!rich || !err) return UI.toast(msg);
      err.textContent = msg;
      err.hidden = false;
      rich.setAttribute('aria-invalid', 'true');
      rich.setAttribute('aria-describedby', [`err-${key}`, rich.dataset.describedby].filter(Boolean).join(' '));
      rich.focus();
      if (caretAt != null) {
        const pos = textMap(rich).at(caretAt);
        if (pos) { const sel = window.getSelection(); sel.removeAllRanges(); const r = new Range(); r.setStart(pos[0], pos[1]); sel.addRange(r); }
      }
    }
    function clearError(key) {
      const rich = elFields.querySelector(`.rich[data-key="${key}"]`);
      const err = view.querySelector(`#err-${key}`);
      if (err && !err.hidden) { err.hidden = true; err.textContent = ''; }
      if (rich) {
        rich.removeAttribute('aria-invalid');
        if (rich.dataset.describedby) rich.setAttribute('aria-describedby', rich.dataset.describedby);
        else rich.removeAttribute('aria-describedby');
      }
    }

    // Campos equivalentes al cambiar de tipo (sin arrastrar la sintaxis de huecos a una básica).
    view.querySelector('#ed-type').onchange = (e) => {
      collect();
      const nt = e.target.value;
      // Lo que se ve ahora manda: se copia siempre desde los campos del tipo actual.
      if (nt === 'cloze' && type !== 'cloze') { values.text = values.front || ''; values.extra = values.back || ''; }
      if (nt !== 'cloze' && type === 'cloze') { values.front = unCloze(values.text); values.back = values.extra || ''; }
      type = nt;
      renderFields();
    };

    let savedRange = null;
    function saveRange(rich) {
      const sel = window.getSelection();
      savedRange = sel.rangeCount && rich.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    }
    function restoreRange(rich) {
      rich.focus();
      if (savedRange) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
    }

    async function insertImage(file, rich) {
      const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const base = file.name && file.name !== 'image.png' ? file.name : `imagen-${Date.now()}.${ext}`;
      const name = await S.addMedia(file, base);
      restoreRange(rich);
      document.execCommand('insertHTML', false, `<img src="${S.mediaUrl(name)}" data-media="${U.esc(name)}" alt="">`);
    }

    function insertCloze(rich, same) {
      rich.focus();
      const nums = C.clozeNumbers(C.fromEditHtml(rich.innerHTML));
      const last = nums.length ? Math.max(...nums) : 0;
      const n = same ? Math.max(1, last) : last + 1;
      const sel = window.getSelection();
      const range = sel.rangeCount && rich.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
      if (range && !range.collapsed) {
        // Conserva el formato de la selección (negrita, etc.) dentro del hueco.
        const box = document.createElement('div');
        box.appendChild(range.cloneContents());
        const html = box.innerHTML;
        if (html === U.esc(sel.toString())) document.execCommand('insertText', false, `{{c${n}::${sel.toString()}}}`);
        else document.execCommand('insertHTML', false, `{{c${n}::${html}}}`);
      } else {
        // Sin selección: hueco vacío con el cursor dentro, listo para escribir la respuesta.
        document.execCommand('insertText', false, `{{c${n}::}}`);
        const s = window.getSelection();
        if (s.modify) { s.modify('move', 'backward', 'character'); s.modify('move', 'backward', 'character'); }
      }
      highlightClozes();
    }

    async function runCmd(cmd, rich, opts = {}) {
      if (cmd === 'image') {
        saveRange(rich);
        const file = await UI.pickFile('image/*');
        if (file) await insertImage(file, rich);
        return;
      }
      if (cmd === 'cloze' || cmd === 'cloze-same') return insertCloze(rich, opts.same);
      rich.focus();
      document.execCommand(cmd);
      syncPressed();
    }

    async function onPaste(e) {
      const items = [...(e.clipboardData?.items || [])];
      const img = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      e.preventDefault();
      if (img) {
        saveRange(e.currentTarget);
        await insertImage(img.getAsFile(), e.currentTarget);
      } else {
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      }
    }

    let saving = false;
    async function save() {
      if (saving) return;
      collect();
      const deckSel = +view.querySelector('#ed-deck').value;
      const fields = {};
      C.TYPES[type].fields.forEach(([k]) => (fields[k] = values[k] || ''));
      const pk = C.primaryField(type);
      const primary = fields[pk];
      if (!primary) return setError(pk, type === 'cloze' ? 'Escribe el texto y oculta al menos una palabra con [ … ].' : 'Escribe el anverso: es lo que verás al estudiar.');
      if (type === 'cloze') {
        const all = [...primary.matchAll(CLOZE_RE)];
        if (!all.length) return setError(pk, 'Marca al menos un hueco: selecciona una palabra y pulsa [ … ].');
        const empty = all.find((m) => !U.stripHtml(m[2]).trim() && !/<img/i.test(m[2]));
        if (empty) {
          // El cursor queda dentro del hueco vacío, listo para escribir la respuesta.
          const rich = elFields.querySelector('.rich[data-key="text"]');
          const hit = rich && [...textMap(rich).text.matchAll(CLOZE_RE)].find((m) => !m[2].trim());
          return setError(pk, `El hueco ${empty[1]} está vacío: escribe la respuesta o quítalo.`, hit ? hit.index + `{{c${hit[1]}::`.length : null);
        }
      }
      const tags = tagsOf();

      // Cambiar el tipo (o quitar huecos) de una nota guardada puede borrar tarjetas: se avisa antes.
      if (editing) {
        const wanted = new Set(C.ordsFor({ ...note, type, fields }));
        const lost = S.cardsOfNote(note.id).filter((c) => !wanted.has(c.ord));
        if (lost.length) {
          const ok = await UI.confirm('¿Eliminar tarjetas?', `Con este cambio se eliminará${lost.length === 1 ? '' : 'n'} ${lost.length} tarjeta${lost.length === 1 ? '' : 's'} con su progreso. No se puede deshacer.`, `Eliminar ${lost.length} y guardar`, true);
          if (!ok) return;
        }
      }

      saving = true;
      let saved;
      try {
        saved = await S.saveNote({ id: note?.id, deckId: deckSel, type, fields, tags });
      } catch (err) {
        console.error(err);
        return UI.toast('No se pudo guardar. Inténtalo de nuevo.');
      } finally {
        saving = false;
      }
      draftDel(draftKey);
      if (editing) {
        discarding = true;
        UI.toast('Cambios guardados');
        location.hash = backTarget;
      } else {
        await S.saveSettings({ lastType: type, lastDeckId: deckSel, lastTags: tags });
        // Se vacían TODOS los campos (también los de otros tipos), para que no reaparezcan.
        Object.keys(values).forEach((k) => (values[k] = ''));
        renderFields();
        markClean();
        elFields.querySelector('.rich').focus();
        const n = saved ? S.cardsOfNote(saved.id).length : 1;
        UI.toast(`${n === 1 ? 'Añadida 1 tarjeta' : `Añadidas ${n} tarjetas`} a «${S.shortName(S.deck(deckSel))}»`);
      }
    }

    view.querySelector('#ed-form').onsubmit = (e) => { e.preventDefault(); save(); };

    // Eliminar y suspender viven en «Más» (no junto a Guardar).
    function moreActions() {
      UI.sheet('Nota', [
        { label: suspended ? 'Reactivar: volver a estudiarla' : 'Suspender: no estudiarla por ahora', icon: suspended ? 'play' : 'pause', onClick: toggleSuspend },
        { label: 'Eliminar nota', icon: 'trash', danger: true, onClick: removeNote }
      ]);
    }
    async function toggleSuspend() {
      await S.setSuspended(note.id, !suspended);
      suspended = !suspended;
      const hadFocus = document.activeElement && document.activeElement.id === 'ed-reactivate';
      updateMeta(); // en el sitio: no se vuelve a pintar el formulario ni se pierden cambios
      if (hadFocus) elFields.querySelector('.rich').focus();
      UI.toast(suspended ? 'Nota suspendida: sus tarjetas no aparecerán al estudiar' : 'Nota reactivada');
    }
    async function removeNote() {
      const ok = await UI.confirm('Eliminar nota', `Se eliminará esta nota y su${cards.length === 1 ? '' : 's'} ${cards.length} tarjeta${cards.length === 1 ? '' : 's'}, con su progreso. No se puede deshacer.`, 'Eliminar', true);
      if (!ok) return;
      await S.deleteNotes([note.id]);
      discarding = true;
      draftDel(draftKey);
      UI.toast('Nota eliminada');
      location.hash = /^#\/(study|edit)\//.test(backTarget) ? `#/deck/${note.deckId}` : backTarget;
    }

    function onKey(e) {
      if (document.querySelector('#modal[open]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(); }
      // Ctrl+Alt+C: hueco nuevo; Ctrl+Alt+Mayús+C: mismo número (Ctrl+Mayús+C lo reservan las herramientas del navegador).
      if (e.ctrlKey && e.altKey && e.code === 'KeyC' && type === 'cloze') {
        const rich = elFields.querySelector('.rich[data-key="text"]');
        if (rich && rich.contains(document.activeElement)) { e.preventDefault(); insertCloze(rich, e.shiftKey); }
      }
    }
    document.addEventListener('keydown', onKey);
    UI.onLeave(() => document.removeEventListener('keydown', onKey));

    renderFields();
    updateMeta();
    markClean();
    const reBtn = view.querySelector('#ed-reactivate');
    if (reBtn) reBtn.onclick = toggleSuspend;

    // ¿Borrador pendiente de una salida anterior sin guardar?
    const draft = draftGet(draftKey);
    if (draft && draft.values) {
      const box = view.querySelector('#ed-draft');
      box.hidden = false;
      view.querySelector('#ed-draft-restore').onclick = () => {
        type = C.TYPES[draft.type] ? draft.type : type;
        view.querySelector('#ed-type').value = type;
        if (S.deck(draft.deck)) view.querySelector('#ed-deck').value = draft.deck;
        Object.assign(values, draft.values);
        view.querySelector('#ed-tags').value = (draft.tags || []).join(' ');
        renderFields();
        box.hidden = true;
        draftDel(draftKey);
        elFields.querySelector('.rich').focus();
      };
      view.querySelector('#ed-draft-discard').onclick = () => { box.hidden = true; draftDel(draftKey); };
    }
    if (!editing) elFields.querySelector('.rich').focus();
  };
})(window.App);
