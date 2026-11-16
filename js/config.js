/*
 * Configuración global de la app.
 * El nombre de la app está solo aquí (y en manifest.webmanifest / index.html <title>).
 */
window.App = window.App || {};

App.config = {
  appName: 'Recallo',
  version: '0.1.0',
  // Como en Anki: el "día" de estudio empieza a las 4:00, no a medianoche.
  dayStartsAtHour: 4,
  defaults: {
    newPerDay: 20,            // tarjetas nuevas por día
    reviewsPerDay: 200,       // repasos máximos por día
    learningSteps: [1, 10],   // minutos (tarjetas nuevas)
    relearningSteps: [10],    // minutos (tarjetas olvidadas)
    graduatingInterval: 1,    // días al terminar los pasos con "Bien"
    easyInterval: 4,          // días al pulsar "Fácil" en una nueva
    startingEase: 2.5,        // factor de facilidad inicial
    learnAheadMinutes: 20,    // adelantar tarjetas en aprendizaje si no queda nada más
    burySiblings: true,       // posponer a mañana las tarjetas hermanas (misma nota) de una ya respondida hoy
    theme: 'system'           // system | light | dark
  }
};
