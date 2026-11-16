/* Componentes de interfaz reutilizables: cabecera, diálogos, avisos, iconos. */
(function (App) {
  'use strict';
  const U = App.util;
  const UI = (App.ui = {});
  App.views = App.views || {};
  const $ = (sel, el = document) => el.querySelector(sel);
  UI.$ = $;

  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  UI.icons = {
    back: svg('<path d="M15 18l-6-6 6-6"/>'),
    settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    more: svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
    upload: svg('<path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>'),
    download: svg('<path d="M12 3v12M7 10l5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>'),
    edit: svg('<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    trash: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
    undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
    check: svg('<path d="M20 6L9 17l-5-5"/>'),
    play: svg('<path d="M7 4l13 8-13 8z"/>'),
    list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
    folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    image: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>'),
    cards: svg('<rect x="3" y="6" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/>')
  };

  // ---------- Cabecera ----------
  UI.setHeader = ({ title = App.config.appName, back = null, actions = [] } = {}) => {
    const backBtn = $('#hdr-back');
    backBtn.innerHTML = UI.icons.back;
    backBtn.hidden = !back;
    backBtn.onclick = () => {
      if (back === 'history') history.length > 1 ? history.back() : (location.hash = '#/');
      else location.hash = back;
    };
    $('#hdr-title').textContent = title;
    document.title = title === App.config.appName ? title : `${title} · ${App.config.appName}`;
    const box = $('#hdr-actions');
    box.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = 'icon-btn';
      b.title = a.label;
      b.setAttribute('aria-label', a.label);
      b.innerHTML = UI.icons[a.icon] || '';
      if (a.id) b.id = a.id;
      b.onclick = a.onClick;
      box.appendChild(b);
    }
  };

  UI.render = (html) => {
    const v = $('#view');
    v.innerHTML = html;
    window.scrollTo(0, 0);
    return v;
  };

  // Funciones a ejecutar al salir de la vista actual (p. ej. quitar atajos de teclado).
  let cleanups = [];
  UI.onLeave = (fn) => cleanups.push(fn);
  UI.runCleanups = () => {
    cleanups.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
    cleanups = [];
  };

  // ---------- Avisos ----------
  /** Aviso breve. action: { label, onClick } añade un botón (p. ej. «Deshacer»). */
  UI.toast = (msg, ms = 2600, action = null) => {
    const t = $('#toast');
    // Vaciar y reescribir en el siguiente ciclo: así el lector anuncia también un mensaje repetido.
    t.textContent = '';
    t.classList.toggle('has-action', !!action);
    clearTimeout(t._a);
    t._a = setTimeout(() => {
      t.textContent = msg;
      if (action) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'toast-action';
        b.textContent = action.label;
        b.onclick = () => {
          clearTimeout(t._h);
          t.classList.remove('show', 'has-action');
          t.textContent = '';
          action.onClick();
        };
        t.append(' ', b);
      }
    }, 60);
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show', 'has-action'), ms);
  };

  /** Plural en español: UI.plural(1, 'tarjeta') → «1 tarjeta»; UI.plural(2, 'mazo') → «2 mazos». */
  UI.plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  /** Minutos legibles: «<1 min» por debajo del minuto. */
  UI.fmtMin = (ms) => (ms < 60000 ? '<1 min' : `${Math.round(ms / 60000)} min`);

  /** Capa «trabajando…»: se anuncia (role=status), marca la vista como ocupada,
   *  deja inerte lo de detrás y devuelve el foco al cerrarse. */
  UI.busy = (msg = 'Cargando…') => {
    const box = $('#busy');
    const behind = ['.topbar', '#view'].map((s) => $(s)).filter(Boolean);
    const prev = document.activeElement;
    // El texto se escribe tras mostrar la capa: así la región viva lo anuncia.
    $('#busy-msg').textContent = '';
    box.hidden = false;
    let current = msg;
    setTimeout(() => { if (!box.hidden) $('#busy-msg').textContent = current; }, 50);
    behind.forEach((el) => { el.inert = true; });
    $('#view').setAttribute('aria-busy', 'true');
    const panel = box.querySelector('.busy-box');
    if (panel) panel.focus({ preventScroll: true });
    return {
      close: () => {
        box.hidden = true;
        behind.forEach((el) => { el.inert = false; });
        $('#view').removeAttribute('aria-busy');
        // Devolver el foco a donde estaba (o a la vista, si era el cuerpo o ya no existe).
        const back = prev && prev !== document.body && prev.isConnected && typeof prev.focus === 'function' ? prev : $('#view');
        back.focus({ preventScroll: true });
      },
      update: (m) => { current = m; $('#busy-msg').textContent = m; }
    };
  };

  // ---------- Diálogos ----------
  // Un único <dialog id="modal"> compartido. Cada apertura es una «sesión» que se cierra
  // siempre por session.close(): cierra el diálogo, lo vacía y resuelve en el acto (sin
  // esperar al evento «close», que llega tarde o no llega si la página no se está pintando).
  // Así la acción elegida corre exactamente una vez, justo al cerrar, aunque otro diálogo
  // se abra a continuación. Si se abre otro antes de terminar, el anterior se resuelve como
  // cancelado; un «close» rezagado de una sesión previa se ignora.
  let activeDialog = null;
  function openDialog(html, onFinish) {
    const dlg = $('#modal');
    if (activeDialog) activeDialog.close();
    else if (dlg.open) dlg.close();
    dlg.innerHTML = html;
    let done = false;
    const session = {
      close: () => {
        if (done) return;
        done = true;
        if (activeDialog === session) activeDialog = null;
        if (dlg.open) dlg.close();
        dlg.innerHTML = '';
        onFinish();
      }
    };
    activeDialog = session;
    dlg.onclick = (e) => { if (e.target === dlg) session.close(); };
    dlg.oncancel = (e) => { e.preventDefault(); session.close(); }; // Escape
    dlg.onclose = () => { if (!dlg.open && activeDialog === session) session.close(); }; // cierre externo
    dlg.setAttribute('aria-labelledby', 'modal-title');
    dlg.showModal();
    return { dlg, session };
  }
  /** Cierra el diálogo abierto (como «Cancelar»). */
  UI.closeDialog = () => { if (activeDialog) activeDialog.close(); };

  /**
   * actions: [{ label, value, primary, danger, collect(dlg), validate(dlg) → mensaje|'' }]
   * El primer botón primario es el que se activa con Enter (y queda a la derecha).
   * Si una acción es destructiva (danger) o se pide focusSafe, el foco inicial va al botón
   * seguro. Enter dentro de un campo nunca dispara una acción destructiva: el diálogo sigue
   * abierto, el foco pasa al botón (si ya está activo) y una línea explica qué falta.
   * validate: si devuelve un mensaje, el diálogo no se cierra (el mensaje lo muestra quien valida).
   */
  UI.modal = ({ title, body = '', actions = [{ label: 'Cerrar', value: null }], onOpen, focusSafe = false } = {}) =>
    new Promise((resolve) => {
      const ordered = [...actions].sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
      const danger = actions.find((a) => a.danger);
      let result = null;
      const { dlg, session } = openDialog(`
        <form method="dialog" class="modal">
          <h2 id="modal-title">${U.esc(title)}</h2>
          <div class="modal-body">${body}</div>
          ${danger ? '<p class="modal-enter-hint" id="modal-enter-hint" role="status" aria-live="polite"></p>' : ''}
          <div class="modal-actions">
            ${ordered.map((a) => `<button value="${actions.indexOf(a)}" class="btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}" ${a.primary ? '' : 'formnovalidate'}>${U.esc(a.label)}</button>`).join('')}
          </div>
        </form>`, () => resolve(result));
      const form = dlg.querySelector('form');
      const dangerBtn = danger ? form.querySelector(`.modal-actions [value="${actions.indexOf(danger)}"]`) : null;
      const hint = form.querySelector('#modal-enter-hint');
      if (danger) {
        // Enter en un campo de un diálogo destructivo: no se envía ni se cierra.
        form.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
          e.preventDefault();
          if (dangerBtn && !dangerBtn.disabled) {
            hint.textContent = `Pulsa «${danger.label}» para confirmar.`;
            dangerBtn.focus();
          } else {
            hint.textContent = `Completa el campo para activar «${danger.label}».`;
          }
        });
      }
      form.onsubmit = (e) => {
        const idx = e.submitter ? +e.submitter.value : actions.findIndex((a) => a.primary);
        const a = actions[idx];
        // Envío implícito: nunca ejecuta una acción destructiva (y no cierra el diálogo).
        e.preventDefault(); // el cierre lo hace la sesión, no el formulario
        if (!e.submitter && a && a.danger) return;
        const msg = a && a.validate ? a.validate(dlg) : '';
        if (msg) return;
        result = a ? (a.collect ? a.collect(dlg) : a.value) : null;
        session.close();
      };
      if (danger || focusSafe) {
        const btns = [...dlg.querySelectorAll('.modal-actions .btn')];
        const safe = btns.find((b) => !actions[+b.value].danger && !actions[+b.value].primary)
          || btns.find((b) => !actions[+b.value].danger);
        if (safe) safe.focus();
      }
      if (onOpen) onOpen(dlg);
    });

  UI.alert = (title, message) => UI.modal({ title, body: `<p>${U.esc(message)}</p>`, actions: [{ label: 'Entendido', value: true, primary: true }] });

  /** opts: { focusSafe } — empezar en «Cancelar» aunque la acción no sea destructiva. */
  UI.confirm = async (title, message, okLabel = 'Aceptar', danger = false, opts = {}) =>
    (await UI.modal({
      title,
      body: `<p>${U.esc(message)}</p>`,
      focusSafe: !!opts.focusSafe,
      actions: [{ label: okLabel, value: true, primary: true, danger }, { label: 'Cancelar', value: false }]
    })) === true;

  /** opts: { okLabel, hint, validate(valor) → mensaje|'', caretEnd }
   *  validate: si devuelve un mensaje, el diálogo sigue abierto, el campo queda marcado
   *  (aria-invalid) y el mensaje se lee junto a él. caretEnd: cursor al final en vez de
   *  seleccionar el texto (p. ej. «Padre::» ya escrito). */
  UI.prompt = (title, label, value = '', placeholder = '', opts = {}) => {
    const described = [opts.hint ? 'prompt-hint' : '', 'prompt-err'].filter(Boolean).join(' ');
    return UI.modal({
      title,
      body: `<label class="field"><span>${U.esc(label)}</span><input name="v" value="${U.esc(value)}" placeholder="${U.esc(placeholder)}" required autocomplete="off" aria-describedby="${described}">`
        + (opts.hint ? `<small class="field-hint" id="prompt-hint">${U.esc(opts.hint)}</small>` : '')
        + '<small class="field-error" id="prompt-err" aria-live="polite"></small></label>',
      actions: [
        {
          label: opts.okLabel || 'Aceptar', primary: true,
          validate: (d) => {
            const input = d.querySelector('[name=v]');
            const msg = opts.validate ? opts.validate(input.value.trim()) || '' : '';
            d.querySelector('#prompt-err').textContent = msg;
            if (msg) { input.setAttribute('aria-invalid', 'true'); input.focus(); } else input.removeAttribute('aria-invalid');
            return msg;
          },
          collect: (d) => d.querySelector('[name=v]').value.trim()
        },
        { label: 'Cancelar', value: null }
      ],
      onOpen: (d) => {
        const i = d.querySelector('input');
        i.focus();
        if (opts.caretEnd) i.setSelectionRange(i.value.length, i.value.length); else i.select();
        i.addEventListener('input', () => {
          if (!i.hasAttribute('aria-invalid')) return;
          i.removeAttribute('aria-invalid');
          d.querySelector('#prompt-err').textContent = '';
        });
      }
    });
  };

  /** Menú de opciones (hoja de acciones). items: [{label, icon, danger, onClick} | { divider: true }] */
  UI.sheet = (title, items) => {
    let chosen = null;
    const { dlg, session } = openDialog(`
      <div class="modal sheet">
        <h2 id="modal-title">${U.esc(title)}</h2>
        <div class="sheet-list">
          ${items.map((it, i) => it.divider ? '<hr class="sheet-sep">'
            : `<button type="button" class="sheet-item ${it.danger ? 'danger' : ''}" data-i="${i}">${UI.icons[it.icon] || ''}<span>${U.esc(it.label)}</span></button>`).join('')}
        </div>
        <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button></div>
      </div>`, () => { if (chosen) chosen.onClick(); });
    dlg.querySelectorAll('.sheet-item').forEach((b) => (b.onclick = () => { chosen = items[+b.dataset.i]; session.close(); }));
    dlg.querySelector('[data-close]').onclick = () => session.close();
  };

  /** Abre el selector de archivos; resuelve null si se cancela (evento «cancel» o,
   *  en navegadores sin él, al volver el foco a la ventana sin archivo elegido). */
  UI.pickFile = (accept) => new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    let done = false;
    const finish = (file) => {
      if (done) return;
      done = true;
      window.removeEventListener('focus', onFocus);
      resolve(file);
    };
    const onFocus = () => setTimeout(() => finish(input.files[0] || null), 500);
    input.onchange = () => finish(input.files[0] || null);
    input.addEventListener('cancel', () => finish(null));
    window.addEventListener('focus', onFocus);
    input.click();
  });

  // Cada contador lleva su nombre accesible ("6 nuevas") y la cola actual se marca con aria-current.
  // Opción { labels: true }: etiqueta visible y discreta junto a cada cifra (pantalla de estudio).
  // Lo visible va con aria-hidden; el lector de pantalla solo lee el texto oculto ("6 nuevas").
  UI.countsHtml = (c, active, opts = {}) => {
    const item = (cls, n, key, label, title, short) => {
      const on = active === key;
      return `<span role="listitem" class="${cls} ${n ? '' : 'zero'} ${on ? 'active' : ''}" title="${title}"${on ? ' aria-current="true"' : ''}>`
        + `<span class="count-n" aria-hidden="true">${n}</span>`
        + (opts.labels ? `<span class="count-label" aria-hidden="true">${short}</span>` : '')
        + `<span class="visually-hidden">${n} ${label}${on ? ' (actual)' : ''}</span></span>`;
    };
    return `
    <span class="counts${opts.labels ? ' counts-labeled' : ''}" role="list" aria-label="Tarjetas pendientes">
      ${item('c-new', c.new, 'new', 'nuevas', 'Nuevas', 'nuevas')}
      ${item('c-learn', c.learn, 'learn', 'en aprendizaje', 'Aprendiendo', 'aprendiendo')}
      ${item('c-due', c.review, 'review', 'por repasar', 'Por repasar', 'repaso')}
    </span>`;
  };

  UI.applyTheme = () => {
    const t = App.store.settings().theme;
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  };
})(window.App);
