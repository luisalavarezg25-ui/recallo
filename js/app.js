/* Arranque y navegación (rutas con #). */
(function (App) {
  'use strict';
  const UI = App.ui;
  const V = App.views;

  const routes = [
    [/^$/, () => V.home()],
    [/^deck\/(\d+)$/, (m) => V.deck(+m[1])],
    [/^study\/(\d+)$/, (m) => V.study(+m[1])],
    [/^add(?:\/(\d+))?$/, (m) => V.editor({ deckId: m[1] ? +m[1] : null })],
    [/^edit\/(\d+)$/, (m) => V.editor({ noteId: +m[1] })],
    [/^browse\/(\d+|all)$/, (m) => V.browse(m[1] === 'all' ? null : +m[1])],
    [/^settings$/, () => V.settings()]
  ];

  async function route() {
    UI.runCleanups();
    const dlg = document.getElementById('modal');
    if (dlg.open) dlg.close();
    const path = location.hash.replace(/^#\/?/, '');
    // El deshacer del estudio solo se conserva en la ida y vuelta al editor.
    if (App.session && !/^(edit|study)\//.test(path)) App.session.undoKeep = null;
    for (const [re, fn] of routes) {
      const m = path.match(re);
      if (m) {
        try {
          await fn(m);
        } catch (e) {
          console.error(e);
          UI.render(`<div class="empty"><h2>Algo ha fallado</h2><p>${App.util.esc(e.message)}</p><a class="btn" href="#/">Volver al inicio</a></div>`);
        }
        return;
      }
    }
    location.hash = '#/';
  }

  App.refresh = route;

  // Mensajes de arranque (carga, pestaña que bloquea, tiempo agotado, error).
  function bootMessage(title, text, retry) {
    const v = UI.render(`<div class="empty boot-state" role="alert">
      <h2>${App.util.esc(title)}</h2><p>${App.util.esc(text)}</p>
      ${retry ? '<button type="button" class="btn btn-primary" id="boot-retry">Reintentar</button>' : ''}
    </div>`);
    const b = v.querySelector('#boot-retry');
    if (b) { b.onclick = () => location.reload(); b.focus(); }
  }

  async function boot() {
    let ready = false;
    UI.render(`<div class="empty boot-state" aria-busy="true"><div class="spinner" aria-hidden="true"></div><p>Abriendo tus mazos…</p></div>`);
    App.db.onblocked = () => {
      if (!ready) bootMessage('Recallo está abierta en otra pestaña',
        'Otra pestaña con una versión anterior de Recallo está usando tus datos. Ciérrala y pulsa «Reintentar».', true);
    };
    const slow = setTimeout(() => {
      if (!ready) bootMessage('Tus datos están tardando en abrirse',
        'Puede que Recallo esté abierta en otra pestaña o que el navegador esté ocupado. Cierra otras pestañas de Recallo y pulsa «Reintentar».', true);
    }, 8000);
    try {
      await App.store.init();
    } catch (e) {
      console.error(e);
      clearTimeout(slow);
      bootMessage('No se pudo abrir el almacenamiento',
        `Tu navegador no permite guardar datos (¿modo privado?). ${e.message || ''}`, true);
      return;
    }
    ready = true;
    clearTimeout(slow);
    UI.applyTheme();
    window.addEventListener('hashchange', route);
    route();

    // Instalable como app (PWA) cuando se sirve por http(s).
    if (location.protocol.startsWith('http')) {
      const link = document.createElement('link');
      link.rel = 'manifest';
      link.href = 'manifest.webmanifest';
      document.head.appendChild(link);
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  boot();
})(window.App);
