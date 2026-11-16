/* Ajustes: límites de estudio, pasos de aprendizaje, tema y gestión de datos. */
(function (App) {
  'use strict';
  const U = App.util, S = App.store, UI = App.ui;
  const V = App.views;

  // ---------- Pasos: «1m 10m 1h 1d» ⇄ minutos ----------
  const UNIT = { '': 1, m: 1, min: 1, s: 1 / 60, h: 60, d: 1440 };
  const MAX_STEP = 30 * 1440;                          // 30 días
  /** Devuelve { ok: [minutos], capped } , { bad: 'token' } o { zero: 'token' }. */
  function parseSteps(text) {
    const out = [];
    let capped = false;
    for (const tok of text.trim().split(/[\s,;]+/).filter(Boolean)) {
      const m = /^([-−]?\d+(?:[.,]\d+)?)\s*(min|m|s|h|d)?$/i.exec(tok);
      if (!m) return { bad: tok };
      const n = parseFloat(m[1].replace('−', '-').replace(',', '.')) * UNIT[(m[2] || '').toLowerCase()];
      if (!(n > 0)) return { zero: tok };
      if (n > MAX_STEP) capped = true;
      out.push(Math.min(MAX_STEP, Math.round(n * 100) / 100));
    }
    return { ok: out, capped };
  }

  /** «al minuto», «a los 10 minutos», «a la hora», «a los 2 días»… */
  function stepPhrase(min) {
    const [n, one, many] = min < 1 ? [Math.round(min * 60), 'segundo', 'segundos']
      : min >= 1440 && min % 1440 === 0 ? [min / 1440, 'día', 'días']
      : min >= 60 && min % 60 === 0 ? [min / 60, 'hora', 'horas'] : [min, 'minuto', 'minutos'];
    if (n === 1) return one === 'hora' ? 'a la hora' : one === 'día' ? 'al día siguiente' : `al ${one}`;
    return `a ${one === 'hora' ? 'las' : 'los'} ${String(n).replace('.', ',')} ${many}`;
  }
  const joinEs = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);
  /** Lectura en lenguaje llano de una lista de pasos. */
  function stepsReading(k, list, grad) {
    const after = k === 'learningSteps'
      ? (grad === 1 ? 'un día más tarde' : `${grad} días más tarde`)
      : 'retoma su ritmo de repaso';
    if (!list.length) return k === 'learningSteps' ? `Sin pasos: pasa directamente al repaso, ${after}.` : 'Sin pasos: vuelve directamente a su ritmo de repaso.';
    return `Volverá ${joinEs(list.map(stepPhrase))}; después, ${after}.`;
  }
  const fmtStep = (min) =>
    min < 1 ? `${Math.round(min * 60)}s` : min >= 1440 && min % 1440 === 0 ? `${min / 1440}d` : min >= 60 && min % 60 === 0 ? `${min / 60}h` : `${min}m`;
  const fmtSteps = (list) => list.map(fmtStep).join(' ');

  function lastBackupText(ts) {
    if (!ts) return 'Aún no has descargado ninguna copia.';
    const days = Math.floor((U.dayStart(0) - U.dayStart(0, ts)) / 86400000 + 0.5);
    const when = days <= 0 ? 'hoy' : days === 1 ? 'ayer' : `hace ${days} días`;
    return `Última copia: ${when}.`;
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // Claves que «Restablecer valores» devuelve a su valor inicial (el tema y la fecha de copia se respetan).
  const STUDY_KEYS = ['newPerDay', 'reviewsPerDay', 'learningSteps', 'relearningSteps', 'graduatingInterval', 'easyInterval', 'burySiblings'];

  V.settings = (opts = {}) => {
    UI.setHeader({ title: 'Ajustes', back: '#/' });
    const s = S.settings();

    const help = {
      newPerDay: (n) => n ? `Con ${n} al día, cuenta con unos ${n * 10} repasos diarios al cabo de un mes.` : 'Con 0 no entra ninguna tarjeta nueva: solo repasas lo que ya conoces.',
      reviewsPerDay: (n) => n ? `Si un día te tocan más de ${n}, el resto espera a mañana.` : 'Con 0 no repasarás nada y las tarjetas pendientes se irán acumulando.'
    };
    const numRow = (k, label, min, max, helpText) => `
      <div class="setting" data-row="${k}">
        <div class="setting-text">
          <label for="s-${k}">${label}</label>
          <p class="setting-help${k === 'reviewsPerDay' && s[k] === 0 ? ' is-warn' : ''}" id="h-${k}">${helpText}</p>
        </div>
        <input id="s-${k}" type="number" inputmode="numeric" min="${min}" max="${max}" step="1" data-k="${k}" value="${s[k]}" aria-describedby="h-${k} m-${k}">
        <p class="setting-msg" id="m-${k}" aria-live="polite"></p>
      </div>`;
    const stepRow = (k, label, helpText) => `
      <div class="setting" data-row="${k}">
        <div class="setting-text">
          <label for="s-${k}">${label}</label>
          <p class="setting-help" id="h-${k}">${helpText}</p>
        </div>
        <input id="s-${k}" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" data-k="${k}" data-list value="${fmtSteps(s[k])}" aria-describedby="h-${k} r-${k} m-${k}">
        <p class="setting-reading" id="r-${k}">${stepsReading(k, s[k], s.graduatingInterval)}</p>
        <p class="setting-msg" id="m-${k}" aria-live="polite"></p>
      </div>`;

    const view = UI.render(`
      <div class="settings">
        <section class="panel" aria-labelledby="sec-pace">
          <h2 id="sec-pace">Ritmo diario</h2>
          ${numRow('newPerDay', 'Tarjetas nuevas por día', 0, 9999, help.newPerDay(s.newPerDay))}
          ${numRow('reviewsPerDay', 'Repasos máximos por día', 0, 99999, help.reviewsPerDay(s.reviewsPerDay))}
        </section>

        <section class="panel" aria-labelledby="sec-look">
          <h2 id="sec-look">Apariencia</h2>
          <div class="setting setting-inline">
            <div class="setting-text"><span class="setting-label" id="l-theme">Tema</span></div>
            <div class="segmented theme-pick" role="radiogroup" aria-labelledby="l-theme">
              ${[['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, l]) => `
                <label><input type="radio" name="theme" value="${v}" ${s.theme === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
            </div>
          </div>
        </section>

        <section class="panel" aria-labelledby="sec-adv">
          <h2 id="sec-adv">Avanzado</h2>
          <p class="setting-help adv-intro">Cómo vuelven las tarjetas mientras las aprendes.</p>
          <details class="advanced" id="s-advanced" ${opts.openAdvanced ? 'open' : ''}>
          <summary><span class="adv-show">Mostrar ajustes avanzados</span><span class="adv-hide">Ocultar ajustes avanzados</span></summary>
          ${stepRow('learningSteps', 'Pasos de aprendizaje', 'Cuándo vuelve a salir una tarjeta nueva hasta que la aprendes. Por ejemplo: 1m 10m.')}
          ${stepRow('relearningSteps', 'Pasos al olvidar una tarjeta', 'Cuándo vuelve una tarjeta que habías olvidado. Por ejemplo: 10m.')}
          ${numRow('graduatingInterval', 'Intervalo al aprender', 1, 365, 'Días hasta el primer repaso tras pulsar «Bien» en el último paso.')}
          ${numRow('easyInterval', 'Intervalo «Fácil»', 1, 365, 'Días hasta el primer repaso al pulsar «Fácil» en una tarjeta nueva.')}
          <div class="setting setting-inline setting-switch">
            <div class="setting-text">
              <label for="s-bury">Posponer tarjetas hermanas</label>
              <p class="setting-help" id="h-bury">Al responder una tarjeta, las demás de la misma nota (la inversa, otros huecos) esperan a mañana para no desvelar la respuesta.</p>
            </div>
            <input id="s-bury" type="checkbox" role="switch" data-flag="burySiblings" aria-describedby="h-bury" ${s.burySiblings !== false ? 'checked' : ''}>
          </div>
          <div class="setting setting-reset">
            <button type="button" class="btn" id="s-defaults">Restablecer valores</button>
          </div>
          </details>
        </section>

        <section class="panel" aria-labelledby="sec-data">
          <h2 id="sec-data">Tus datos</h2>
          <p class="setting-help data-note">Tus tarjetas se guardan solo en este dispositivo y navegador. Una copia de vez en cuando te protege si cambias de equipo o se borra el navegador.</p>
          <div class="data-backup">
            <button class="btn btn-primary btn-block" id="s-backup">${UI.icons.download}<span>Descargar copia de seguridad</span></button>
            <p class="setting-help" id="s-lastbackup">${lastBackupText(s.lastBackupAt)}</p>
          </div>
          <div class="data-secondary">
            <button class="btn" id="s-restore">${UI.icons.upload}<span>Restaurar una copia</span></button>
            <button class="btn" id="s-export">${UI.icons.cards}<span>Exportar a Anki (.apkg)</span></button>
          </div>
          <p class="setting-help data-count">${plural(S.decks().length, 'mazo', 'mazos')} · ${plural(S.noteCount(), 'nota', 'notas')} · ${plural(S.cardCount(), 'tarjeta', 'tarjetas')}</p>

          <div class="danger-zone">
            <h3>Zona de riesgo</h3>
            <p class="setting-help">Borra todos los mazos, tarjetas, imágenes y el progreso de este dispositivo.</p>
            <button class="btn btn-danger-ghost" id="s-reset">${UI.icons.trash}<span>Borrar todos los datos</span></button>
          </div>
        </section>

        <p class="about">${U.esc(App.config.appName)} · versión ${App.config.version}</p>
      </div>`);

    // ---------- Validación en línea ----------
    const last = {};                                   // último valor válido guardado por clave
    STUDY_KEYS.forEach((k) => (last[k] = s[k]));
    const msgEl = (k) => view.querySelector(`#m-${k}`);
    function setMsg(input, text, kind) {             // kind: 'error' | 'note' | ''
      const el = msgEl(input.dataset.k);
      el.textContent = text || '';
      el.dataset.kind = kind || '';
      if (kind === 'error') input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }

    async function commitNumber(input) {
      const k = input.dataset.k;
      const raw = input.value.trim();
      const min = +input.min, max = +input.max;
      if (raw === '' && input.validity.badInput) return setMsg(input, 'Escribe solo un número entero.', 'error');
      if (raw === '') {
        input.value = last[k];
        return setMsg(input, `El campo no puede quedar vacío: se mantiene ${last[k]}.`, 'note');
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) return setMsg(input, 'Escribe solo un número entero.', 'error');
      let v = Math.round(n);
      let note = '';
      if (v < min) { v = min; note = `Ajustado a ${min} (el mínimo).`; }
      else if (v > max) { v = max; note = `Ajustado a ${max} (el máximo).`; }
      else if (v !== n) note = `Redondeado a ${v}.`;
      // Regla cruzada: «Fácil» nunca antes que «Bien».
      const grad = k === 'graduatingInterval' ? v : last.graduatingInterval;
      const easy = k === 'easyInterval' ? v : last.easyInterval;
      if ((k === 'graduatingInterval' || k === 'easyInterval') && grad > easy) {
        return setMsg(input, k === 'easyInterval'
          ? `Debe ser al menos ${grad} día${grad === 1 ? '' : 's'}, el intervalo al aprender.`
          : `No puede superar el intervalo «Fácil» (${easy} día${easy === 1 ? '' : 's'}).`, 'error');
      }
      input.value = v;
      if (v === last[k]) return setMsg(input, note, note ? 'note' : '');
      await S.saveSettings({ [k]: v });
      last[k] = v;
      // Si esta corrección arregla el error del otro intervalo, límpialo.
      ['graduatingInterval', 'easyInterval'].forEach((o) => {
        const other = view.querySelector(`[data-k=${o}]`);
        if (o !== k && other.getAttribute('aria-invalid')) commitNumber(other);
      });
      const h = help[k];
      if (h) {
        const el = view.querySelector(`#h-${k}`);
        el.textContent = h(v);
        el.classList.toggle('is-warn', k === 'reviewsPerDay' && v === 0);
      }
      if (k === 'graduatingInterval') refreshReading('learningSteps');
      setMsg(input, note, note ? 'note' : '');
      if (!note) UI.toast('Guardado');
    }

    async function commitSteps(input) {
      const k = input.dataset.k;
      const raw = input.value.trim();
      if (raw === '') {
        input.value = fmtSteps(last[k]);
        return setMsg(input, `El campo no puede quedar vacío: se mantiene «${fmtSteps(last[k])}».`, 'note');
      }
      const r = parseSteps(raw);
      if (r.bad) return setMsg(input, `No entiendo «${r.bad}». Usa números con s, m, h o d, separados por espacios: 1m 10m 1d.`, 'error');
      if (r.zero) return setMsg(input, `Cada paso debe ser mayor que 0 («${r.zero}» no vale).`, 'error');
      const note = r.capped ? 'Ajustado a 30 días (el paso más largo posible).' : '';
      const pretty = fmtSteps(r.ok);
      input.value = pretty;
      refreshReading(k, r.ok);
      if (pretty === fmtSteps(last[k])) return setMsg(input, note, note ? 'note' : '');
      await S.saveSettings({ [k]: r.ok });
      last[k] = r.ok;
      setMsg(input, note, note ? 'note' : '');
      if (!note) UI.toast('Guardado');
    }

    /** Lectura en lenguaje llano bajo el campo de pasos (en vivo mientras se escribe). */
    function refreshReading(k, list) {
      const el = view.querySelector(`#r-${k}`);
      if (el) el.textContent = stepsReading(k, list || last[k], last.graduatingInterval);
    }
    view.querySelectorAll('[data-list]').forEach((input) => input.addEventListener('input', () => {
      const r = parseSteps(input.value);
      if (r.ok && r.ok.length) refreshReading(input.dataset.k, r.ok);
    }));

    view.querySelectorAll('[data-k]').forEach((input) => {
      input.addEventListener('change', () => ('list' in input.dataset ? commitSteps : commitNumber)(input));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.dispatchEvent(new Event('change')); });
    });

    view.querySelectorAll('[data-flag]').forEach((input) => input.addEventListener('change', async () => {
      await S.saveSettings({ [input.dataset.flag]: input.checked });
      UI.toast('Guardado');
    }));

    // Regla única de avisos: «Guardado» cada vez que un cambio se guarda tal cual;
    // si hubo que ajustarlo, lo explica la nota bajo el campo y no hay aviso flotante.
    view.querySelectorAll('[name=theme]').forEach((r) => r.addEventListener('change', async () => {
      await S.saveSettings({ theme: r.value });
      UI.applyTheme();
      UI.toast('Guardado');
    }));

    view.querySelector('#s-defaults').onclick = async () => {
      const ok = await UI.confirm('Restablecer valores',
        'El ritmo diario y los ajustes avanzados vuelven a sus valores iniciales. Tus tarjetas, el tema y tus copias no cambian.', 'Restablecer', true);
      if (!ok) return;
      const d = App.config.defaults;
      await S.saveSettings(Object.fromEntries(STUDY_KEYS.map((k) => [k, Array.isArray(d[k]) ? [...d[k]] : d[k]])));
      V.settings({ openAdvanced: true });
      UI.toast('Valores restablecidos');
    };

    // ---------- Datos ----------
    async function downloadBackup() {
      const busy = UI.busy('Preparando copia…');
      try {
        const data = await S.exportBackup();
        const stamp = new Date().toISOString().slice(0, 10);
        U.download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${App.config.appName}-copia-${stamp}.json`);
        await S.saveSettings({ lastBackupAt: Date.now() });
        const el = view.querySelector('#s-lastbackup');
        if (el) el.textContent = lastBackupText(Date.now());
        return true;
      } catch (e) {
        UI.alert('No se pudo preparar la copia', e.message);
        return false;
      } finally {
        busy.close();
      }
    }
    view.querySelector('#s-backup').onclick = downloadBackup;

    view.querySelector('#s-restore').onclick = async () => {
      const file = await UI.pickFile('.json,application/json');
      if (!file) return;
      let data;
      try {
        data = JSON.parse(await file.text());
        if (!data || data.format !== 1 || !Array.isArray(data.notes)) throw new Error('bad');
      } catch {
        return UI.alert('No es una copia válida', 'El archivo elegido no es una copia de seguridad de ' + App.config.appName + '. No se ha cambiado nada.');
      }
      const when = data.exportedAt ? ` del ${U.fmtDate(Date.parse(data.exportedAt))}` : '';
      const ok = await UI.confirm('Restaurar copia',
        `Tus ${plural(S.decks().length, 'mazo', 'mazos')} y ${plural(S.noteCount(), 'nota', 'notas')} actuales se sustituirán por los de la copia${when}: `
        + `${plural((data.decks || []).length, 'mazo', 'mazos')} y ${plural(data.notes.length, 'nota', 'notas')}. Lo actual no se podrá recuperar.`,
        'Restaurar', true);
      if (!ok) return;
      const busy = UI.busy('Restaurando…');
      try {
        await S.importBackup(data);
        location.hash = '#/';
        location.reload();
      } catch (e) {
        busy.close();
        UI.alert('No se pudo restaurar', e.message);
      }
    };

    view.querySelector('#s-export').onclick = () => App.views.exportFlow(null);

    view.querySelector('#s-reset').onclick = async () => {
      const WORD = 'BORRAR';
      const ok = await UI.modal({
        title: 'Borrar todos los datos',
        body: `<p>Se borrarán ${plural(S.decks().length, 'mazo', 'mazos')}, ${plural(S.noteCount(), 'nota', 'notas')}, ${plural(S.cardCount(), 'tarjeta', 'tarjetas')}${S.mediaCount && S.mediaCount() ? `, ${plural(S.mediaCount(), 'archivo multimedia', 'archivos multimedia')}` : ''} y todo tu progreso de este dispositivo. No se puede deshacer.</p>
          <p><button type="button" class="btn btn-sm" id="dz-backup">${UI.icons.download}<span>Descargar copia antes</span></button></p>
          <label class="field"><span>Escribe ${WORD} para confirmar</span>
            <input name="confirm" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="dz-hint">
          </label>
          <p class="setting-help dz-hint" id="dz-hint" aria-live="polite">El botón se activa al escribir la palabra.</p>`,
        actions: [
          { label: 'Borrar todo', primary: true, danger: true, collect: (d) => d.querySelector('[name=confirm]').value.trim().toUpperCase() === WORD },
          { label: 'Cancelar', value: false }
        ],
        onOpen: (d) => {
          const input = d.querySelector('[name=confirm]');
          const go = d.querySelector('.btn-danger');
          const hint = d.querySelector('#dz-hint');
          const valid = () => input.value.trim().toUpperCase() === WORD;
          const sync = () => {
            go.disabled = !valid();
            hint.textContent = valid() ? 'Listo: pulsa «Borrar todo» para confirmar.' : 'El botón se activa al escribir la palabra.';
            hint.classList.remove('is-error');
          };
          sync();
          input.addEventListener('input', sync);
          // Enter en el campo nunca cierra el diálogo: lleva al botón o explica qué falta.
          input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (valid()) go.focus();
            else { hint.textContent = `Escribe ${WORD} exactamente para activar el botón.`; hint.classList.add('is-error'); }
          });
          d.querySelector('#dz-backup').onclick = async (e) => {
            const b = e.currentTarget;
            if (await downloadBackup()) { b.querySelector('span').textContent = 'Copia descargada'; b.disabled = true; }
          };
          input.focus();
        }
      });
      if (ok !== true) return;
      await S.resetAll();
      location.hash = '#/';
      location.reload();
    };
  };
})(window.App);
