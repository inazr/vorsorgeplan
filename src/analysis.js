// ═══════════════════════════════════════════════════════════════
// ANALYSEN: Maximales Netto, Optimierer, Monte Carlo, Haus-Break-even
// ═══════════════════════════════════════════════════════════════

// Höchstes reales Netto (heutige Kaufkraft), bei dem das Vermögen bis zum Zielalter reicht
function maxNet(I, A, scenario, path, guess) {
  const ok = n => !simulate(I, A, { scenario, targetReal: n, path }).depleted;
  let lo, hi;
  if (guess > 0) {
    lo = guess * 0.9; hi = guess * 1.1;
    while (lo > 1 && !ok(lo)) { hi = lo; lo *= 0.7; }
    while (ok(hi)) { lo = hi; hi *= 1.4; if (hi > 1e6) break; }
  } else {
    lo = 0; hi = 4000;
    while (ok(hi)) { lo = hi; hi *= 2; if (hi > 1e6) break; }
  }
  for (let k = 0; k < 30 && hi - lo > 0.5; k++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
  return lo;
}

// Kopie mit geänderten AVD-Einstellungen
function withAvd(I, i, patch) {
  const J = JSON.parse(JSON.stringify(I));
  Object.assign(J.persons[i].avd, patch);
  return J;
}

// Optimierer: Koordinatensuche über die AVD-Stellschrauben beider Personen.
// Läuft in Häppchen, damit die Oberfläche reagiert. onStep(fortschritt, bestes).
const OPT_SPACE = {
  eigen: [0, 360, 900, 1800],
  extra: [0, 1680, 3360, 5040],
  payStart: [65, 66, 67, 68, 69, 70],
  payEnd: [85, 88, 91, 95, 100],
  teilkapital: [0, 0.3],
};
function optimize(I, A, onStep, onDone) {
  let best = JSON.parse(JSON.stringify(I));
  for (const p of best.persons) p.avd.on = true;
  let bestNet = maxNet(best, A, 'B');
  const tasks = [];
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < best.persons.length; i++)
      for (const key of Object.keys(OPT_SPACE)) tasks.push({ i, key });
  let ti = 0;
  const total = tasks.length;
  function step() {
    const t0 = Date.now();
    while (ti < tasks.length && Date.now() - t0 < 60) {
      const { i, key } = tasks[ti++];
      for (const v of OPT_SPACE[key]) {
        if (best.persons[i].avd[key] === v) continue;
        const cand = withAvd(best, i, { [key]: v });
        const n = maxNet(cand, A, 'B', null, bestNet);
        if (n > bestNet + 0.5) { best = cand; bestNet = n; }
      }
    }
    onStep && onStep(ti / total, bestNet, best);
    if (ti < tasks.length) setTimeout(step, 0); else onDone && onDone(best, bestNet);
  }
  step();
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

// Monte Carlo: je Pfad das maximal tragbare Netto, plus Vermögensfächer beim deterministischen Plan
function monteCarlo(I, A, opts, onStep, onDone) {
  const years = I.persons[I.withdraw.refPerson ?? 0].by + I.withdraw.targetAge - I.startYear + 1;
  const paths = makePaths(opts.runs, years, A, opts.seed);
  const det = { A: maxNet(I, A, 'A'), B: maxNet(I, A, 'B') };
  const res = { A: [], B: [] }, fan = { A: [], B: [] }, fail = { A: 0, B: 0 };
  let k = 0;
  function step() {
    const t0 = Date.now();
    while (k < paths.length && Date.now() - t0 < 60) {
      const path = paths[k++];
      for (const sc of ['A', 'B']) {
        res[sc].push(maxNet(I, A, sc, path, det[sc]));
        const r = simulate(I, A, { scenario: sc, targetReal: det[sc], path, detail: true });
        if (r.depleted) fail[sc]++;
        fan[sc].push(r.rows.map(x => x.total / x.priceIdx));
      }
    }
    onStep && onStep(k / paths.length);
    if (k < paths.length) setTimeout(step, 0);
    else onDone && onDone({ det, res, fan, fail, runs: paths.length, years: Array.from({ length: years }, (_, i) => I.startYear + i) });
  }
  step();
}

function pct(arr, q) {
  const a = [...arr].sort((x, y) => x - y);
  const i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}

// Break-even-Zins: Bis zu welchem Anschlusszins ist die Anschlussfinanzierung besser als die Ablösung aus dem ETF-Depot?
function houseBreakEven(I, A, scenario) {
  const J = JSON.parse(JSON.stringify(I));
  J.loans.forEach(l => { l.after = 'etf'; });
  const netEtf = maxNet(J, A, scenario);
  const f = z => { const K = JSON.parse(JSON.stringify(I)); K.loans.forEach(l => { l.after = 'anschluss'; l.zins = z; }); return maxNet(K, A, scenario, null, netEtf) - netEtf; };
  let lo = 0, hi = 0.15;
  if (f(lo) < 0) return { rate: null, netEtf };
  if (f(hi) > 0) return { rate: Infinity, netEtf };
  for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
  return { rate: (lo + hi) / 2, netEtf };
}
