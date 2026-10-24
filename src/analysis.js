// ═══════════════════════════════════════════════════════════════
// ANALYSEN: Maximales Netto, Optimierer, Monte Carlo, Haus-Break-even
// ═══════════════════════════════════════════════════════════════

// Ewige Rente: Das reale Nettovermögen zum Zielalter ist mindestens so hoch wie zu Entnahmebeginn
const keepsCapital = (I, s) => I.withdraw.strategy !== 'perpetual' || s.finalReal >= s.startReal;

// Höchstes Netto, für das ok(n) gilt: Bisektion, mit Schätzwert als Startintervall
function maxBy(ok, guess, tol = 0.5) {
  let lo, hi;
  if (guess > 0) {
    lo = guess * 0.9; hi = guess * 1.1;
    while (lo > 1 && !ok(lo)) { hi = lo; lo *= 0.7; }
    while (ok(hi)) { lo = hi; hi *= 1.4; if (hi > 1e6) break; }
  } else {
    lo = 0; hi = 4000;
    while (ok(hi)) { lo = hi; hi *= 2; if (hi > 1e6) break; }
  }
  for (let k = 0; k < 30 && hi - lo > tol; k++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
  return lo;
}

// Höchstes reales Netto (heutige Kaufkraft), bei dem das Vermögen bis zum Zielalter reicht
// (bei der ewigen Rente zusätzlich real erhalten bleibt)
function maxNet(I, A, scenario, path, guess) {
  return maxBy(n => { const s = simulate(I, A, { scenario, targetReal: n, path }); return !s.depleted && keepsCapital(I, s); }, guess);
}

// Netto, das in mindestens (1 − q) der Verläufe reicht (q-Perzentil des tragbaren Nettos)
function pctNet(I, A, scenario, paths, q, guess) {
  const need = Math.ceil(paths.length * (1 - q));
  return maxBy(n => {
    let good = 0, bad = 0;
    for (const path of paths) {
      const s = simulate(I, A, { scenario, targetReal: n, path });
      if (!s.depleted && keepsCapital(I, s)) { if (++good >= need) return true; }
      else if (++bad > paths.length - need) return false;
    }
    return good >= need;
  }, guess, 3);
}

// ─── Optimierer: Aufteilung des Budgets auf ETF-Depot, Altersvorsorgedepot, Basisrente und private RV ───
// Koordinatensuche über Beiträge und Auszahlungsoptionen beider Personen. Der Rest des Budgets fließt ins ETF-Depot.
const OPT_SPACE = {
  avd: { eigen: [0, AVD.g1Cap, AVD.fMax / 2, AVD.fMax], extra: [0, 1, 2, 3].map(k => k * (AVD.einMax - AVD.fMax) / 3), payStart: Array.from({ length: AVD.payMax - AVD.payMin + 1 }, (_, i) => AVD.payMin + i), payEnd: [AVD.planEndMin, 88, 91, 95, 100], teilkapital: [0, AVD.teilMax] },
  basis: { beitrag: [0, 1200, 2400, 4800, 9600, 19200], payStart: [INS.basisMinAge, 65, 67, 70] },
  prv: { beitrag: [0, 1200, 2400, 4800, 9600], payStart: [62, 65, 67, 70], mode: ['rente', 'teil', 'kapital'] },
};
const OPT_AMOUNT = { avd: ['eigen', 'extra'], basis: ['beitrag'], prv: ['beitrag'] };
const optUsed = (p, k) => OPT_AMOUNT[k].some(f => p[k][f] > 0);
// Ausgangspunkt: alle Produkte eingeschaltet, nicht genutzte mit Beitrag 0
function optStart(I) {
  const J = clone(I);
  for (const p of J.persons) for (const k of Object.keys(OPT_SPACE)) {
    if (!p[k].on) for (const f of OPT_AMOUNT[k]) p[k][f] = 0;
    p[k].on = true;
  }
  return J;
}
// Ergebnis: Produkte ohne Beitrag wieder ausschalten
function optFinish(J) {
  const K = clone(J);
  for (const p of K.persons) for (const k of Object.keys(OPT_SPACE)) if (!optUsed(p, k)) p[k].on = false;
  return K;
}
// Produkt-Einstellungen eines Optimums auf aktuelle Eingaben übertragen
function optPatch(J) { return J.persons.map(p => Object.fromEntries(Object.keys(OPT_SPACE).map(k => [k, clone(p[k])]))); }
function applyPatch(I, patch) {
  const J = clone(I);
  patch.forEach((pp, i) => { if (J.persons[i]) for (const k of Object.keys(pp)) J.persons[i][k] = clone(pp[k]); });
  return J;
}

const OPT_SEED = 11, MC_SEED = 7;   // feste Startwerte, damit Läufe reproduzierbar sind
const horizonYears = I => I.persons[I.withdraw.refPerson ?? 0].by + I.withdraw.targetAge - I.startYear + 1;

// Arbeit in ~60-ms-Häppchen: next() führt einen Schritt aus und liefert false, wenn alles erledigt ist.
// onStep nach jedem Häppchen, onDone am Ende. Rückgabe: { cancel() }
function chunked(next, onStep, onDone) {
  let cancelled = false;
  function tick() {
    if (cancelled) return;
    const t0 = Date.now();
    let more = true;
    while (more && Date.now() - t0 < 60) more = next() !== false;
    onStep && onStep();
    if (cancelled) return;
    if (more) setTimeout(tick, 0); else onDone && onDone();
  }
  setTimeout(tick, 0);
  return { cancel() { cancelled = true; } };
}

// opts.mode: 'fast' (feste Rendite) | 'mc' (q-Perzentil über opts.runs Verläufe, verfeinert das schnelle Optimum)
// onStep(fortschritt, bestes Netto, Phase), onDone(bestes I, Netto, Info). Rückgabe: { cancel() }
function optimize(I, A, opts, onStep, onDone) {
  opts = { mode: 'fast', q: 0.1, runs: 50, seed: OPT_SEED, ...opts };
  let best = optStart(I), paths = null;
  const phases = [{ obj: (J, g) => maxNet(J, A, 'B', null, g), passes: 2, w: opts.mode === 'mc' ? 0.25 : 1, name: 'Schnell' }];
  if (opts.mode === 'mc') {
    paths = makePaths(opts.runs, horizonYears(I), A, opts.seed);
    phases.push({ obj: (J, g) => pctNet(J, A, 'B', paths, opts.q, g), passes: 1, w: 0.75, name: 'Monte Carlo' });
  }
  let ph = 0, tasks = [], ti = 0, bestVal = 0, done0 = 0;
  function startPhase() {
    const P = phases[ph];
    tasks = [];
    for (let pass = 0; pass < P.passes; pass++)
      for (const k of Object.keys(OPT_SPACE)) for (let i = 0; i < best.persons.length; i++)
        for (const key of Object.keys(OPT_SPACE[k])) for (const v of OPT_SPACE[k][key]) tasks.push({ i, k, key, v });
    ti = 0; bestVal = P.obj(best, bestVal);
  }
  startPhase();
  function next() {
    while (ti >= tasks.length) {   // Phase fertig: nächste starten oder Ende
      if (ph + 1 >= phases.length) return false;
      done0 += phases[ph].w; ph++; startPhase();
    }
    const P = phases[ph], { i, k, key, v } = tasks[ti++];
    const p = best.persons[i];
    if (p[k][key] === v) return true;
    if (!OPT_AMOUNT[k].includes(key) && !optUsed(p, k)) return true;   // Auszahlungsoptionen nur bei genutztem Produkt
    const cand = clone(best);
    cand.persons[i][k][key] = v;
    const n = P.obj(cand, bestVal);
    if (n > bestVal + 0.5) { best = cand; bestVal = n; }
    return true;
  }
  return chunked(next, () => { const P = phases[ph]; onStep && onStep(done0 + P.w * ti / tasks.length, bestVal, P.name); }, () => {
    const J = optFinish(best);
    // Monte Carlo: dasselbe Perzentil auch für deine Aufteilung und nur ETF, auf denselben Verläufen
    const mc = paths ? { pct: bestVal, pctB: pctNet(I, A, 'B', paths, opts.q), pctA: pctNet(I, A, 'A', paths, opts.q) } : {};
    onDone && onDone(J, maxNet(J, A, 'B'), { mode: opts.mode, q: opts.q, runs: opts.runs, ...mc });
  });
}

// Zufallszahlen mit Startwert, damit Läufe reproduzierbar sind
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

function makePaths(n, years, A, seed) {
  const r = rng(seed);
  const mu = Math.log(1 + A.ret); // Median-Pfad = deterministische Rendite (geometrisch)
  const paths = [];
  for (let k = 0; k < n; k++) {
    const p = [];
    for (let t = 0; t < years; t++) p.push({ R: Math.exp(mu + A.vol * gauss(r)) - 1, infl: A.inflation + A.inflVol * gauss(r) });
    paths.push(p);
  }
  return paths;
}

// Monte Carlo: je Pfad das maximal tragbare Netto, plus Vermögensfächer beim deterministischen Plan.
// variants: [{ key, I, scenario }] (nur ETF, deine Aufteilung, Optimum) auf denselben Verläufen
function monteCarlo(I, A, opts, onStep, onDone) {
  const years = horizonYears(I);
  const paths = makePaths(opts.runs, years, A, opts.seed ?? MC_SEED);
  const vs = opts.variants || [{ key: 'A', I, scenario: 'A' }, { key: 'B', I, scenario: 'B' }];
  const det = {}, res = {}, fan = {}, fail = {};
  for (const v of vs) { res[v.key] = []; fan[v.key] = []; fail[v.key] = 0; }
  let k = 0, d = 0;   // d: Zähler der vorab nötigen deterministischen maxNet-Läufe (erste Schritte)
  function next() {
    if (d < vs.length) { const v = vs[d++]; det[v.key] = maxNet(v.I, A, v.scenario); return true; }
    if (k >= paths.length) return false;
    const path = paths[k++];
    for (const v of vs) {
      res[v.key].push(maxNet(v.I, A, v.scenario, path, det[v.key]));
      const r = simulate(v.I, A, { scenario: v.scenario, targetReal: det[v.key], path, detail: true });
      if (r.depleted || !keepsCapital(v.I, r)) fail[v.key]++;
      fan[v.key].push(r.rows.map(x => x.total / x.priceIdx));
    }
    return k < paths.length;
  }
  return chunked(next, () => onStep && onStep(k / paths.length),
    () => onDone && onDone({ det, res, fan, fail, keys: vs.map(v => v.key), runs: paths.length, years: Array.from({ length: years }, (_, i) => I.startYear + i) }));
}

function pct(arr, q) {
  const a = [...arr].sort((x, y) => x - y);
  const i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}

// Break-even-Zins: Bis zu welchem Anschlusszins ist die Anschlussfinanzierung besser als die Ablösung aus dem ETF-Depot?
function houseBreakEven(I, A, scenario) {
  const J = clone(I);
  J.loans.forEach(l => { l.after = 'etf'; });
  const netEtf = maxNet(J, A, scenario);
  const f = z => { const K = clone(I); K.loans.forEach(l => { l.after = 'anschluss'; l.zins = z; }); return maxNet(K, A, scenario, null, netEtf) - netEtf; };
  let lo = 0, hi = 0.15;
  if (f(lo) < 0) return { rate: null, netEtf };
  if (f(hi) > 0) return { rate: Infinity, netEtf };
  for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
  return { rate: (lo + hi) / 2, netEtf };
}

// ─── Rendite je Anlage: interner Zinsfuß (IRR) der Zahlungen aus Sicht des Haushalts ───
// flows: [{ t (Jahre ab Rechnungsbeginn), v (> 0 Zufluss, < 0 Einzahlung) }]. null, wenn es keinen Vorzeichenwechsel gibt.
function irr(flows) {
  const by = new Map();
  for (const { t, v } of flows) by.set(t, (by.get(t) || 0) + v);
  const F = [...by].filter(([, v]) => Math.abs(v) >= 0.01);   // Rundungsreste (z. B. leeres Restkapital) würden bei negativen Zinsen alles überwiegen
  if (!F.some(([, v]) => v > 0) || !F.some(([, v]) => v < 0)) return null;
  const npv = r => F.reduce((a, [t, v]) => a + v * Math.pow(1 + r, -t), 0);
  let lo = -0.9, hi = 1;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (npv(m) * npv(lo) > 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// Zahlungen je Anlage aus den Jahreszeilen (simulate mit detail), Zahlungen zur Jahresmitte, Restwerte am Ende des letzten Jahres.
// Vorsorgeprodukte je Person: eigene Beiträge (mit Zuzahlungen aus Erstattungen) raus; Auszahlungen abzüglich anteiliger
// Einkommensteuer und KV, Kapitalauszahlung nach Steuer, Erstattungen (§ 10a, Basisrente) im Folgejahr und Restkapital rein.
// Zulagen fließen ins Produkt und zählen daher nur über die Auszahlungen.
// ETF-Depot gemeinsam: Startwert und Einzahlungen (Sparrate, Reinvestitionen) raus; Verkäufe nach Kapitalertragsteuer und KV
// sowie der Restwert nach latenter Abgeltungsteuer rein. Je Person gilt dieselbe Rendite (Hälfte aller Zahlungen).
// real: Zahlungen in heutiger Kaufkraft. Rückgabe { etf, avd, basis, prv }: je { per: [IRR je Person oder null], hh }.
function productIRR(sim, I, real) {
  const rows = sim.rows, last = rows[rows.length - 1], Y0 = I.startYear, tEnd = last.year - Y0 + 1;
  const d = (r, v) => real ? v / r.priceIdx : v;
  const out = {};
  const etf = [{ t: 0, v: -I.depot.startValue }, { t: tEnd, v: d(last, last.etf - sim.etfTaxLatent) }];
  for (const r of rows) etf.push({ t: r.year - Y0 + 0.5, v: d(r, r.etfSale - r.kapTax - r.etfContrib - sum(r.pp.map(p => p.kvBy?.etf || 0))) });
  const e = irr(etf);
  out.etf = { per: I.persons.map(() => e), hh: e };
  for (const k of ['avd', ...POLICIES]) {
    const per = I.persons.map((_, i) => {
      const F = [];
      let used = false;
      for (const r of rows) {
        const p = r.pp[i], t = r.year - Y0 + 0.5;
        const paid = k === 'avd' ? p.avdIn : p[k + 'In'];
        const pay = (k === 'avd' ? p.avdPay : p[k + 'Pay']) + (POLICY_DEF[k]?.lump ? p.lump - p.lumpTax : 0);
        const refund = k === 'avd' ? p.refund : POLICY_DEF[k].deduct ? p.basisRefund : 0;   // basisRefund: Erstattung aller abzugsfähigen Verträge (nur Basisrente)
        if (paid > 0) used = true;
        F.push({ t, v: d(r, pay - (p.estBy?.[k] || 0) - (p.kvBy?.[k] || 0) - paid) });
        if (refund) F.push({ t: t + 1, v: d(r, refund) });
      }
      F.push({ t: tEnd, v: d(last, k === 'avd' ? last.pp[i].avd : last.pp[i][k]) });
      return used ? F : null;
    });
    out[k] = { per: per.map(F => F && irr(F)), hh: per.some(Boolean) ? irr(per.filter(Boolean).flat()) : null };
  }
  return out;
}
