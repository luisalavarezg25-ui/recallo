/*
 * Tipos de nota y generación/renderizado de tarjetas.
 *
 * Modelo (igual que Anki): una NOTA guarda la información; de cada nota salen una o varias TARJETAS.
 *  - basic:   1 tarjeta (anverso -> reverso)
 *  - reverse: 2 tarjetas (anverso -> reverso y reverso -> anverso)
 *  - cloze:   1 tarjeta por cada hueco {{c1::...}}, {{c2::...}}...
 */
(function (App) {
  'use strict';
  const U = App.util;
  const C = (App.cards = {});

  C.TYPES = {
    basic: { label: 'Básica', fields: [['front', 'Anverso'], ['back', 'Reverso']] },
    reverse: { label: 'Básica y reverso', fields: [['front', 'Anverso'], ['back', 'Reverso']] },
    cloze: { label: 'Rellenar huecos', fields: [['text', 'Texto'], ['extra', 'Extra']] }
  };

  C.primaryField = (type) => C.TYPES[type].fields[0][0];

  const clozeRe = () => /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

  C.clozeNumbers = (text) => {
    const set = new Set();
    for (const m of String(text || '').matchAll(clozeRe())) set.add(+m[1]);
    return [...set].sort((a, b) => a - b);
  };

  /** Qué tarjetas (ord) debe tener una nota. */
  C.ordsFor = (note) => {
    if (note.type === 'reverse') return [0, 1];
    if (note.type === 'cloze') {
      const nums = C.clozeNumbers(note.fields.text).filter((n) => n > 0);
      return nums.length ? nums.map((n) => n - 1) : [0];
    }
    return [0];
  };

  function renderCloze(text, ord, reveal) {
    return String(text || '').replace(clozeRe(), (m, n, content, hint) => {
      if (+n !== ord + 1) return content;
      if (reveal) return `<span class="cloze">${content}</span>`;
      return `<span class="cloze">[${hint ? hint : '…'}]</span>`;
    });
  }

  /** HTML (sin sanear) de la pregunta y de la respuesta completa. */
  C.render = (card, note) => {
    const f = note.fields;
    if (note.type === 'cloze') {
      const extra = f.extra && U.stripHtml(f.extra) !== '' || /<img/i.test(f.extra || '') ? `<hr class="extra-sep"><div class="extra">${f.extra}</div>` : '';
      return { q: renderCloze(f.text, card.ord, false), a: renderCloze(f.text, card.ord, true) + extra };
    }
    const flipped = note.type === 'reverse' && card.ord === 1;
    const [q, a] = flipped ? [f.back, f.front] : [f.front, f.back];
    // Señal discreta de dirección solo en la tarjeta invertida (las básicas quedan limpias).
    const dir = flipped ? '<div class="card-dir">Reverso → Anverso</div>' : '';
    // Al revelar, la pregunta se repite en un tono secundario para que la respuesta mande.
    return { q: dir + q, a: `${dir}<div class="echo-q">${q}</div><hr class="answer-sep"><div class="answer-body">${a}</div>` };
  };

  C.sortText = (note) => U.stripHtml(note.fields[C.primaryField(note.type)] || '').replace(/\{\{c\d+::(.*?)(::.*?)?\}\}/g, '$1');

  // ---------- HTML de tarjetas: saneado + archivos multimedia locales ----------
  const isExternal = (src) => /^(https?:|blob:|data:)/i.test(src);

  /** Para mostrar una tarjeta: sanea, convierte [sound:x] y resuelve imágenes/audio guardados. */
  C.toDisplayHtml = (html) => {
    const withAudio = String(html || '').replace(/\[sound:([^\]]+)\]/g, (m, name) => `<audio controls src="${U.esc(name)}"></audio>`);
    const t = document.createElement('template');
    t.innerHTML = U.sanitize(withAudio);
    t.content.querySelectorAll('img[src], audio[src]').forEach((el) => {
      const src = el.getAttribute('src');
      if (isExternal(src)) return;
      const url = App.store.mediaUrl(safeDecode(src));
      if (url) el.setAttribute('src', url);
    });
    return t.innerHTML;
  };

  /** Para el editor: igual, pero recordando el nombre original de cada imagen. */
  C.toEditHtml = (html) => {
    const t = document.createElement('template');
    t.innerHTML = U.sanitize(html);
    t.content.querySelectorAll('img[src]').forEach((el) => {
      const name = safeDecode(el.getAttribute('src'));
      const url = App.store.mediaUrl(name);
      if (url) { el.setAttribute('data-media', name); el.setAttribute('src', url); }
    });
    return t.innerHTML;
  };

  /** Del editor al formato guardado. */
  C.fromEditHtml = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html;
    t.content.querySelectorAll('img[data-media]').forEach((el) => {
      el.setAttribute('src', el.getAttribute('data-media'));
      el.removeAttribute('data-media');
    });
    let out = U.sanitize(t.innerHTML).trim();
    out = out.replace(/(<br\s*\/?>|<div><br\s*\/?><\/div>|\s|&nbsp;)+$/gi, '');
    // También al principio: líneas vacías y espacios duros que deja el campo editable.
    out = out.replace(/^(<br\s*\/?>|<div>(?:\s|&nbsp;)*(?:<br\s*\/?>)?<\/div>|\s|&nbsp;)+/gi, '');
    out = out.replace(/^(<(?:div|p)>)(?:\s|&nbsp;)+/i, '$1');
    if (!U.stripHtml(out) && !/<(img|audio)/i.test(out)) return '';
    return out;
  };

  /** Nombres de archivos multimedia que usa un HTML. */
  C.mediaRefs = (html) => {
    const refs = new Set();
    const s = String(html || '');
    for (const m of s.matchAll(/<(?:img|audio)[^>]*?\ssrc=["']([^"']+)["']/gi)) if (!isExternal(m[1])) refs.add(safeDecode(m[1]));
    for (const m of s.matchAll(/\[sound:([^\]]+)\]/g)) refs.add(m[1]);
    return refs;
  };

  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch { return s; }
  }
})(window.App);
