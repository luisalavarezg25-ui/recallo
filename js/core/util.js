/* Utilidades generales: ids, fechas, formato, saneado de HTML. Sin dependencias de UI. */
(function (App) {
  'use strict';
  const U = (App.util = {});

  // ---------- Identificadores ----------
  // Ids numéricos basados en milisegundos (mismo criterio que Anki), siempre crecientes.
  let lastId = 0;
  U.bumpId = (id) => { if (typeof id === 'number' && id > lastId) lastId = id; };
  U.newId = () => {
    let t = Date.now();
    if (t <= lastId) t = lastId + 1;
    lastId = t;
    return t;
  };

  const GUID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';
  U.newGuid = () => {
    const a = new Uint8Array(10);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => GUID_CHARS[b % GUID_CHARS.length]).join('');
  };

  // ---------- Texto ----------
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  U.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

  U.stripHtml = (html) => {
    const t = document.createElement('template');
    t.innerHTML = String(html || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(div|p|li|tr|h\d)>/gi, ' ');
    return (t.content.textContent || '').replace(/\s+/g, ' ').trim();
  };

  U.truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  // ---------- Fechas (día de estudio con corte a las 4:00) ----------
  const cutoff = () => App.config.dayStartsAtHour;

  /** Marca de tiempo (ms) del inicio del día de estudio actual + offsetDays. */
  U.dayStart = (offsetDays = 0, now = Date.now()) => {
    const d = new Date(now);
    if (d.getHours() < cutoff()) d.setDate(d.getDate() - 1);
    d.setHours(cutoff(), 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    return d.getTime();
  };

  /** Número de día absoluto (útil para restar fechas sin problemas de horario de verano). */
  U.dayIndex = (ts) => {
    const d = new Date(ts);
    if (d.getHours() < cutoff()) d.setDate(d.getDate() - 1);
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  };

  const num = (x) => String(+x.toFixed(1)).replace('.', ',');
  U.fmtDays = (d) => {
    if (d < 30) return `${Math.round(d)} d`;
    const [n, one, many] = d < 360 ? [d / 30, 'mes', 'meses'] : [d / 365, 'año', 'años'];
    const s = num(n);
    return `${s} ${s === '1' ? one : many}`;
  };
  U.fmtMinutes = (m) =>
    m < 60 ? `${Math.max(1, Math.round(m))} min` : m < 1440 ? `${num(m / 60)} h` : U.fmtDays(m / 1440);
  U.fmtDate = (ts) => new Date(ts).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

  // ---------- Saneado de HTML (los mazos importados pueden traer cualquier cosa) ----------
  const ALLOWED_TAGS = new Set([
    'a', 'b', 'i', 'u', 's', 'em', 'strong', 'mark', 'small', 'sub', 'sup', 'br', 'hr', 'p', 'div', 'span',
    'ul', 'ol', 'li', 'img', 'audio', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'font', 'code', 'pre',
    'blockquote', 'h1', 'h2', 'h3', 'h4', 'strike', 'ruby', 'rt', 'rp', 'center', 'figure', 'figcaption'
  ]);
  const DROP_TAGS = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'template', 'svg', 'math', 'form',
    'input', 'button', 'textarea', 'select', 'video', 'frame', 'frameset', 'base', 'title', 'head'
  ]);
  const ALLOWED_ATTRS = new Set([
    'style', 'class', 'src', 'href', 'alt', 'title', 'colspan', 'rowspan', 'width', 'height',
    'color', 'face', 'size', 'controls', 'align', 'dir', 'lang'
  ]);

  U.sanitize = (html) => {
    const t = document.createElement('template');
    t.innerHTML = String(html || '');
    const walk = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 1) {
          const tag = child.tagName.toLowerCase();
          if (DROP_TAGS.has(tag)) { child.remove(); continue; }
          if (!ALLOWED_TAGS.has(tag)) { walk(child); child.replaceWith(...child.childNodes); continue; }
          for (const attr of [...child.attributes]) {
            const n = attr.name.toLowerCase();
            const v = attr.value.trim();
            if (!ALLOWED_ATTRS.has(n)) child.removeAttribute(attr.name);
            else if ((n === 'src' || n === 'href') && /^(javascript|vbscript|data:(?!image\/))/i.test(v)) child.removeAttribute(attr.name);
            else if (n === 'style' && /expression|url\s*\(|position\s*:\s*(fixed|absolute)/i.test(v)) child.removeAttribute(attr.name);
          }
          if (tag === 'a') { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener noreferrer'); }
          walk(child);
        } else if (child.nodeType !== 3) {
          child.remove();
        }
      }
    };
    walk(t.content);
    return t.innerHTML;
  };

  // ---------- Archivos ----------
  U.download = (blob, filename) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 15000);
  };

  U.safeFilename = (s) => String(s).replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').trim() || 'mazo';

  const MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', bmp: 'image/bmp', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
    m4a: 'audio/mp4', opus: 'audio/ogg', flac: 'audio/flac'
  };
  U.mimeFor = (name) => MIME[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';

  U.blobToDataUrl = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  U.dataUrlToBlob = async (url) => (await fetch(url)).blob();

  U.loadScript = (src) => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload = res;
    s.onerror = () => rej(new Error('No se pudo cargar una librería necesaria. ¿Tienes conexión a internet?'));
    document.head.appendChild(s);
  });

  /** Checksum de Anki: primeros 8 dígitos hex del SHA-1 del texto. */
  U.ankiChecksum = async (text) => {
    try {
      const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
      const hex = [...new Uint8Array(buf)].slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('');
      return parseInt(hex, 16);
    } catch {
      return 0;
    }
  };

  U.debounce = (fn, ms) => {
    let h;
    return (...args) => { clearTimeout(h); h = setTimeout(() => fn(...args), ms); };
  };

  /**
   * Texto «plegado» para buscar: sin tildes ni diéresis y en minúsculas («París» -> «paris»),
   * pero la ñ sigue siendo ñ («año» no coincide con «ano»).
   */
  U.fold = (s) => String(s ?? '').normalize('NFD')
    .replace(/([nN])̃/g, '$1')   // protege la virgulilla de la ñ
    .replace(/\p{M}+/gu, '')
    .replace(/n/g, 'ñ').replace(/N/g, 'Ñ')
    .toLowerCase();

  /** Texto plegado carácter a carácter + mapa de cada posición plegada a su posición original. */
  function foldMap(src) {
    let folded = '';
    const map = [];
    let i = 0;
    for (const ch of src) {
      const f = U.fold(ch);
      for (let k = 0; k < f.length; k++) map.push(i);
      folded += f;
      i += ch.length;
    }
    map.push(src.length);
    return { folded, map };
  }

  /**
   * Fragmento de una línea alrededor de la primera coincidencia de `terms` (ya plegados) en `text`,
   * con la coincidencia resaltada. Devuelve HTML escapado o '' si no hay coincidencia.
   */
  U.excerpt = (text, terms, before = 36, after = 64) => {
    const src = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!src || !terms || !terms.length) return '';
    const { folded, map } = foldMap(src);
    let p = -1;
    for (const t of terms) {
      const q = t ? folded.indexOf(t) : -1;
      if (q !== -1 && (p === -1 || q < p)) p = q;
    }
    if (p === -1) return '';
    let a = map[Math.max(0, p - before)];
    let b = map[Math.min(folded.length, p + after)];
    if (a > 0) { const sp = src.lastIndexOf(' ', a); a = sp > 0 && a - sp < 12 ? sp + 1 : a; }
    if (b < src.length) { const sp = src.indexOf(' ', b); b = sp !== -1 && sp - b < 12 ? sp : b; }
    return `${a > 0 ? '…' : ''}${U.highlight(src.slice(a, b), terms)}${b < src.length ? '…' : ''}`;
  };

  /**
   * Resalta (con <mark>) las apariciones de `terms` (ya plegados) en `text`, sin distinguir tildes
   * ni mayúsculas. Devuelve HTML escapado.
   */
  U.highlight = (text, terms) => {
    const src = String(text ?? '');
    if (!terms || !terms.length) return U.esc(src);
    const { folded, map } = foldMap(src);
    const marks = new Array(src.length).fill(false);
    for (const t of terms) {
      if (!t) continue;
      let p = folded.indexOf(t);
      while (p !== -1) {
        for (let k = map[p]; k < map[p + t.length]; k++) marks[k] = true;
        p = folded.indexOf(t, p + t.length);
      }
    }
    let out = '', open = false;
    for (let k = 0; k < src.length; k++) {
      if (marks[k] && !open) { out += '<mark>'; open = true; }
      if (!marks[k] && open) { out += '</mark>'; open = false; }
      out += U.esc(src[k]);
    }
    return out + (open ? '</mark>' : '');
  };
})(window.App);
