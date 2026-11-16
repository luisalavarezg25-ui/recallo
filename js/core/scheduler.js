/*
 * Algoritmo de repaso espaciado (variante de SM-2, como el planificador clásico de Anki).
 * Es lógica pura: recibe una tarjeta + ajustes y devuelve el nuevo estado.
 *
 * Estados: new -> learning -> review <-> relearning
 * Valoraciones: 1 = Otra vez, 2 = Difícil, 3 = Bien, 4 = Fácil
 */
(function (App) {
  'use strict';
  const U = App.util;
  const Sch = (App.scheduler = {});
  const MIN = 60000;

  Sch.RATINGS = [
    { value: 1, label: 'Otra vez', key: '1' },
    { value: 2, label: 'Difícil', key: '2' },
    { value: 3, label: 'Bien', key: '3' },
    { value: 4, label: 'Fácil', key: '4' }
  ];

  const capIvl = (x) => Math.min(36500, Math.max(1, Math.round(x)));

  function graduate(card, ivl, s, now) {
    return { state: 'review', step: 0, interval: ivl, ease: card.ease || s.startingEase, due: U.dayStart(ivl, now) };
  }

  /** Calcula el resultado de las 4 valoraciones posibles para una tarjeta. */
  function outcomes(card, s, now) {
    const r = {};

    if (card.state === 'new' || card.state === 'learning') {
      const steps = s.learningSteps;
      if (!steps.length) {
        r[1] = r[2] = r[3] = graduate(card, s.graduatingInterval, s, now);
        r[4] = graduate(card, s.easyInterval, s, now);
        return r;
      }
      const step = card.state === 'new' ? 0 : Math.min(card.step || 0, steps.length - 1);
      const hardDelay =
        step === 0 && steps.length > 1 ? (steps[0] + steps[1]) / 2 : steps.length === 1 ? steps[0] * 1.5 : steps[step];
      r[1] = { state: 'learning', step: 0, due: now + steps[0] * MIN };
      r[2] = { state: 'learning', step, due: now + hardDelay * MIN };
      r[3] = step + 1 < steps.length
        ? { state: 'learning', step: step + 1, due: now + steps[step + 1] * MIN }
        : graduate(card, s.graduatingInterval, s, now);
      r[4] = graduate(card, s.easyInterval, s, now);
      return r;
    }

    if (card.state === 'relearning') {
      const rs = s.relearningSteps;
      const base = Math.max(1, card.interval || 1);
      const back = (extra) => ({ state: 'review', step: 0, interval: base + extra, ease: card.ease, due: U.dayStart(base + extra, now) });
      if (!rs.length) {
        r[1] = r[2] = r[3] = back(0);
        r[4] = back(1);
        return r;
      }
      const step = Math.min(card.step || 0, rs.length - 1);
      r[1] = { state: 'relearning', step: 0, due: now + rs[0] * MIN };
      r[2] = { state: 'relearning', step, due: now + (rs.length === 1 ? rs[0] * 1.5 : rs[step]) * MIN };
      r[3] = step + 1 < rs.length ? { state: 'relearning', step: step + 1, due: now + rs[step + 1] * MIN } : back(0);
      r[4] = back(1);
      return r;
    }

    // Estado "review"
    const ivl = Math.max(1, card.interval || 1);
    const ease = card.ease || s.startingEase;
    const overdue = Math.max(0, U.dayIndex(now) - U.dayIndex(card.due));
    const hard = capIvl(Math.max(ivl + 1, ivl * 1.2));
    const good = capIvl(Math.max(hard + 1, (ivl + overdue / 2) * ease));
    const easy = capIvl(Math.max(good + 1, (ivl + overdue) * ease * 1.3));
    const lapseEase = Math.max(1.3, ease - 0.2);

    r[1] = s.relearningSteps.length
      ? { state: 'relearning', step: 0, interval: 1, ease: lapseEase, due: now + s.relearningSteps[0] * MIN, lapse: true }
      : { state: 'review', step: 0, interval: 1, ease: lapseEase, due: U.dayStart(1, now), lapse: true };
    r[2] = { state: 'review', interval: hard, ease: Math.max(1.3, ease - 0.15), due: U.dayStart(hard, now) };
    r[3] = { state: 'review', interval: good, ease, due: U.dayStart(good, now) };
    r[4] = { state: 'review', interval: easy, ease: ease + 0.15, due: U.dayStart(easy, now) };
    return r;
  }

  /** Texto corto para cada botón: "1 min", "10 min", "4 d", "1,2 mes"... */
  Sch.preview = (card, s, now = Date.now()) => {
    const o = outcomes(card, s, now);
    const labels = {};
    for (const k of [1, 2, 3, 4]) {
      labels[k] = o[k].state === 'review' ? U.fmtDays(o[k].interval) : U.fmtMinutes((o[k].due - now) / MIN);
    }
    return labels;
  };

  /** Devuelve los campos a actualizar en la tarjeta tras responder. */
  Sch.answer = (card, rating, s, now = Date.now()) => {
    const res = { ...outcomes(card, s, now)[rating] };
    // Pequeña aleatoriedad (±5 %) para que las tarjetas no se agrupen el mismo día.
    if (res.state === 'review' && res.interval >= 3) {
      const fuzz = Math.max(1, Math.round(res.interval * 0.05));
      res.interval = capIvl(res.interval + Math.floor(Math.random() * (2 * fuzz + 1)) - fuzz);
      res.due = U.dayStart(res.interval, now);
    }
    const lapses = (card.lapses || 0) + (res.lapse ? 1 : 0);
    delete res.lapse;
    return { ...res, lapses, reps: (card.reps || 0) + 1 };
  };
})(window.App);
