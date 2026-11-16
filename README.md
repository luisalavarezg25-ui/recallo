# Recallo — prototipo web

App de tarjetas de estudio con repaso espaciado, compatible con Anki.
Esta es la **versión 1 en HTML/JavaScript** para validar diseño y funcionamiento antes de pasar a **Flutter** (iOS, Android, Windows).

> «Recallo» es un nombre provisional. Para cambiarlo: `js/config.js` (`appName`), `manifest.webmanifest` y `<title>` en `index.html`.

## Cómo abrirla

- **Windows:** doble clic en `Abrir Recallo.bat`. Arranca un servidor local (necesita Python, ya instalado) y abre `http://localhost:5173`.
  Desde Edge o Chrome puedes instalarla como app (icono «Instalar» en la barra de direcciones).
- Sin servidor no funciona bien: abrir `index.html` directamente (file://) guarda los datos en otro sitio y no permite instalarla.

Los datos se guardan **solo en ese navegador** (IndexedDB). Usa *Ajustes → Descargar copia de seguridad* de vez en cuando.

## Qué incluye

| Función | Detalle |
|---|---|
| Mazos | Crear, renombrar, eliminar, submazos con `Padre::Hijo` |
| Tipos de nota | Básica · Básica y reverso · Rellenar huecos (cloze `{{c1::...}}`) |
| Editor | Negrita/cursiva/subrayado, imágenes (botón o pegar), botón `[ … ]` para huecos, etiquetas |
| Estudio | Repaso espaciado tipo Anki (SM-2), botones Otra vez/Difícil/Bien/Fácil con intervalo previsto, deshacer |
| Atajos | `Espacio` mostrar/Bien · `1-4` valorar · `Z` deshacer · `E` editar · `Ctrl+Enter` guardar |
| Anki | Importar `.apkg`/`.colpkg` (formatos antiguo y nuevo, con multimedia y progreso) · Exportar `.apkg` |
| Datos | Copia de seguridad JSON completa, restaurar, borrar todo |
| Interfaz | Móvil y escritorio, modo claro/oscuro, funciona sin conexión (salvo importar/exportar Anki la primera vez) |

## Estructura

```
index.html              Página única
css/app.css             Estilos (tokens de color, modo oscuro)
js/config.js            Nombre de la app y ajustes por defecto
js/core/                LÓGICA (sin interfaz) -> se traduce a Dart
  util.js               ids, fechas con corte a las 4:00, saneado HTML
  db.js                 IndexedDB (en Flutter: SQLite con drift)
  scheduler.js          Algoritmo de repaso espaciado
  cards.js              Tipos de nota, generación y renderizado de tarjetas
  store.js              Colección: mazos, notas, tarjetas, historial, multimedia
  anki.js               Importar/exportar .apkg
js/ui/                  INTERFAZ -> se rehace con widgets de Flutter
  ui.js                 Cabecera, diálogos, avisos, iconos
  home.js study.js editor.js browse.js settings.js
sw.js, manifest.webmanifest   App instalable / sin conexión
```

## Modelo de datos (igual que irá en SQLite)

```
Deck   { id, name ("Padre::Hijo"), created, mod }
Note   { id, guid, deckId, type: basic|reverse|cloze, fields{}, tags[], created, mod }
Card   { id, noteId, deckId, ord, state: new|learning|review|relearning,
         due (ms), interval (días), ease, step, reps, lapses, position, suspended, mod }
Review { id (fecha ms), cardId, deckId, rating 1-4, prevState, state, interval, prevInterval, ease, timeMs }
Media  { name, blob }
```

Los ids son milisegundos (como Anki), lo que simplifica exportar.

## Plan de paso a Flutter

| Prototipo (JS) | Flutter (Dart) |
|---|---|
| `scheduler.js`, `cards.js` | Traducción casi literal a clases Dart + tests unitarios |
| `db.js` + `store.js` (IndexedDB) | `drift` (SQLite) con las mismas tablas; repositorio con la misma API |
| `anki.js` (JSZip + sql.js + fzstd) | `archive` (ZIP) + `sqlite3` + `zstandard`/FFI |
| Vistas HTML | Pantallas Flutter (`go_router` para la navegación) |
| Copia JSON | Mismo formato, para migrar los mazos del prototipo a la app |
| Editor `contenteditable` | `flutter_quill` o editor HTML simple |

Para publicar: cuenta Apple Developer (99 $/año), Google Play (25 $ pago único), y un Mac o un servicio como Codemagic para compilar iOS.

## Limitaciones conocidas del prototipo

- Sin sincronización entre dispositivos (solo local).
- Las plantillas y estilos propios de los mazos de Anki no se importan: los campos extra se juntan en el reverso.
- Importar/exportar Anki descarga las librerías de internet la primera vez.
- Al borrar notas, sus imágenes se quedan guardadas (no se limpian).
