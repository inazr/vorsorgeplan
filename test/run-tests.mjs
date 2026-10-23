// Rechenproben für die Engine. Aufruf: node test/run-tests.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = vm.createContext({ console, Math, JSON });
const ENGINE_FILES = ['law', 'depot', 'insurance', 'loans', 'sim', 'defaults', 'analysis'];
for (const f of ENGINE_FILES)
  vm.runInContext(readFileSync(join(root, 'src', f + '.js'), 'utf8'), ctx);
const g = code => vm.runInContext(code, ctx);
// Hilfsfunktion im vm-Kontext: tiefe Kopien von DEFAULTS/ASSUME, f(I, A) passt sie an
vm.runInContext(`function mk(f) { const I = JSON.parse(JSON.stringify(DEFAULTS)), A = JSON.parse(JSON.stringify(ASSUME)); if (f) f(I, A); return { I, A }; }`, ctx);
const mn = (patch, scen = 'B') => g(`(() => { const { I, A } = mk(${patch || 'null'}); return maxNet(I, A, '${scen}'); })()`);

let fail = 0, ok = 0;
const GOLD = { baseA: 9080, baseB: 9401, perpetual: 7716, pkv: 9041, freiwillig: 8480, noDraft: 9413, noIndex: 8541, kinderlos: 9364, avdNone: 9320, avdExtra: 9143,
  basisSame: 8293, basisEtf: 8624, basisNone: 8025, prvKapital: 9332, prvKapital61: 9318, selfRv: 9402, self: 8404, saveLast: 8935, bm7: 9330, loanTeil: 6512,
  baseB_startReal: 1299706, baseB_finalReal: 167, baseB_sumZulagen: 45465, baseB_sumRefunds: 14779 };
const check = (name, cond, info = '') => { if (cond) ok++; else { fail++; console.log('FEHLER', name, info); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
// Golden Master: pinnt die heutigen Ergebnisse (±1 €), damit Umbauten keine Werte verschieben
const gold = (name, v) => check(`Gold ${name}`, GOLD[name] !== undefined && near(v, GOLD[name], 1), `${Math.round(v)} statt ${GOLD[name]}`);

// 1. Einkommensteuertarif gegen Prüfwerte (Einzeltarif, Euro)
const vec = { 15000: [435, 397, 338], 30000: [4217, 4172, 4108], 50000: [10548, 10482, 10419], 70600: [18516, 18410, 18346], 100000: [30864, 30758, 30694], 250000: [93864, 93758, 93694], 300000: [115529, 116658, 116594] };
for (const [x, v] of Object.entries(vec)) [2026, 2027, 2028].forEach((y, i) => {
  const t = Math.floor(g(`estGrund(${x}, LAW.tariff[${y}])`));
  check(`Tarif ${y} bei ${x}`, near(t, v[i], 1), `${t} statt ${v[i]}`);
});

// 2. Besteuerungsanteil der Rente
check('Besteuerungsanteil 2026', near(g('LAW.besteuerungsanteil(2026)'), 0.84, 1e-9));
check('Besteuerungsanteil 2058', near(g('LAW.besteuerungsanteil(2058)'), 1, 1e-9));

// 3. Grundzulage Altersvorsorgedepot
check('Zulage 120 €', near(g('zulageGrund(120, AVD)'), 60, 1e-9));
check('Zulage 1.000 €', near(g('zulageGrund(1000, AVD)'), 340, 1e-9));
check('Zulage 1.800 €', near(g('zulageGrund(1800, AVD)'), 540, 1e-9));
check('Zulage unter Mindestbeitrag', g('zulageGrund(100, AVD)') === 0);

// 4. Annuitätendarlehen: 100.000 € zu 3 % effektiv über 10 Jahre ist danach getilgt
const rest = g(`(() => { const c = { amount: 100000, eff: 0.03, startY: 2030, startM: 1, monthly: annuityM(100000, loanRateM(0.03), 120), fixEndY: 2045, fixEndM: 1, sonder: 0, after: 'anschluss', zins: 0.03, years: 10 };
  const l = makeLoans([c], 2040 * 12)[0]; return l.bal; })()`);
check('Annuität getilgt', rest < 1, rest);

// 5. Simulation: Summen je Person ergeben den Haushalt, Szenario B schlägt A
const r = g(`(() => { const I = JSON.parse(JSON.stringify(DEFAULTS)); const nA = maxNet(I, ASSUME, 'A'), nB = maxNet(I, ASSUME, 'B');
  const s = simulate(I, ASSUME, { scenario: 'B', targetReal: nB, detail: true });
  let d = 0; for (const x of s.rows) { d = Math.max(d, Math.abs(x.pp.reduce((a, p) => a + p.total, 0) - x.total)); if (x.phase === 'Entnahme') d = Math.max(d, Math.abs(x.pp.reduce((a, p) => a + p.net, 0) - x.net)); }
  return { nA, nB, d, depleted: s.depleted }; })()`);
check('Personen-Summen', r.d < 0.01, r.d);
gold('baseA', r.nA); gold('baseB', r.nB);
check('Plan reicht bis Zielalter', !r.depleted);
const T = 'I.persons[0]', U = 'I.persons[1]', basis = m => `(I, A) => { ${T}.basis.on = true; ${T}.basis.beitrag = 6000; ${T}.basis.refundTo = '${m}'; }`, prvK = x => `(I, A) => { ${U}.prv.on = true; ${U}.prv.mode = 'kapital'; ${x} }`;
const VARIANTS = {
  perpetual: ["(I, A) => { I.withdraw.strategy = 'perpetual'; }"],
  pkv: ["(I, A) => I.persons.forEach(p => p.kvdr = 'pkv')"],
  freiwillig: ["(I, A) => I.persons.forEach(p => p.kvdr = 'nein')"],
  noDraft: ['(I, A) => { A.useDraft = false; }'],
  noIndex: ['(I, A) => { A.useDraft = false; A.indexTariff = false; }'],
  kinderlos: ['(I, A) => { I.children = []; }'],
  avdNone: ["(I, A) => I.persons.forEach(p => p.avd.refundTo = 'none')"],
  avdExtra: ['(I, A) => I.persons.forEach(p => p.avd.extra = 3000)'],
  basisSame: [basis('same')], basisEtf: [basis('etf')], basisNone: [basis('none')],
  prvKapital: [prvK('')], prvKapital61: [prvK(`${U}.prv.payStart = 61;`)],
  selfRv: [`(I, A) => { ${T}.job = 'self'; ${T}.rvPflicht = true; }`],
  self: [`(I, A) => { ${T}.job = 'self'; ${T}.rvPflicht = false; }`],
  saveLast: [`(I, A) => { I.saveUntil = 'last'; ${U}.retireAge = 64; }`],
  bm7: ['(I, A) => I.persons.forEach(p => p.bm = 7)'],
  loanTeil: ["(I, A) => { I.loans = [{ name: 'T', amount: 300000, eff: 0.035, startY: 2026, startM: 1, monthly: 1350, freeMonths: 0, fixBalBank: 0, fixEndY: 2036, fixEndM: 1, sonder: 0, sonderFrom: 2026, sonderTo: 2035, after: 'teil', zins: 0.04, years: 20, teil: 50000 }]; }"],
};
for (const [name, [patch, scen]] of Object.entries(VARIANTS)) { const v = mn(patch, scen); gold(name, v); }
const gb = g(`(() => { const { I, A } = mk(null); const s = simulate(I, A, { scenario: 'B', targetReal: maxNet(I, A, 'B') }); return { startReal: s.startReal, finalReal: s.finalReal, sumZulagen: s.sumZulagen, sumRefunds: s.sumRefunds }; })()`);
for (const [k2, v] of Object.entries(gb)) { gold('baseB_' + k2, v); }
console.log(`Beispielhaushalt: Netto A ${r.nA.toFixed(0)} €, B ${r.nB.toFixed(0)} € pro Monat (heutige Kaufkraft)`);

// 6. Kredit-Ablösung aus dem Depot verringert das Depot
const k = g(`(() => { const I = JSON.parse(JSON.stringify(DEFAULTS));
  I.loans = [{ name: 'T', amount: 200000, eff: 0.02, startY: 2025, startM: 1, monthly: 900, freeMonths: 0, fixBalBank: 0, fixEndY: 2035, fixEndM: 1, sonder: 0, sonderFrom: 2027, sonderTo: 2034, after: 'etf', zins: 0.04, years: 10, teil: 0 }];
  const s = simulate(I, ASSUME, { scenario: 'A', targetReal: 1000, detail: true });
  return { ...s.houseSale, debtAfter: s.rows.find(r => r.year === 2035).debt }; })()`);
check('Ablösung aus Depot', k && k.payoff > 0 && k.gross > 0, JSON.stringify(k));
// Reicht das Depot nicht, bleibt der ungedeckte Rest als Schuld bestehen
check('Ungedeckter Rest bleibt Schuld', k.covered >= k.payoff - 1 ? k.debtAfter < 1 : near(k.debtAfter, k.payoff - k.covered, (k.payoff - k.covered) * 0.12), JSON.stringify(k));

// 7. Ertragsanteil der Leibrente (§ 22 Nr. 1 S. 3 a bb EStG)
for (const [age, v] of [[60, 0.22], [62, 0.21], [65, 0.18], [67, 0.17], [70, 0.15], [75, 0.11]]) check(`Ertragsanteil ${age}`, near(g(`ertragsanteil(${age})`), v, 1e-9));

// 8. Basisrente und private RV: Personen-Summen, Erstattung, Steuer, nur-ETF bleibt unberührt
const v = g(`(() => { const I = JSON.parse(JSON.stringify(DEFAULTS));
  I.persons[0].basis.on = true; I.persons[0].basis.beitrag = 6000;
  I.persons[1].prv.on = true; I.persons[1].prv.mode = 'teil'; I.persons[1].prv.teil = 0.5;
  const nA0 = maxNet(DEFAULTS, ASSUME, 'A'), nA = maxNet(I, ASSUME, 'A'), nB = maxNet(I, ASSUME, 'B');
  const s = simulate(I, ASSUME, { scenario: 'B', targetReal: nB, detail: true });
  let d = 0; for (const x of s.rows) { d = Math.max(d, Math.abs(x.pp.reduce((a, p) => a + p.total, 0) - x.total)); if (x.phase === 'Entnahme') d = Math.max(d, Math.abs(x.pp.reduce((a, p) => a + p.net, 0) - x.net)); }
  const b = s.pol[0].basis, p = s.pol[1].prv;
  const rB = s.rows.find(r => r.basisPay[0] > 0 && r.year > Math.floor(b.s0 / 12)), rP = s.rows.find(r => r.lump[1] > 0);
  // Ohne Hälftelung (Auszahlung vor 62): Abgeltungsteuer auf 85 % des Ertrags
  const J = JSON.parse(JSON.stringify(I)); J.persons[1].prv.payStart = 61;
  const sJ = simulate(J, ASSUME, { scenario: 'B', targetReal: nB, detail: true }), pJ = sJ.pol[1].prv;
  return { nA0, nA, nB, d, depleted: s.depleted, refund: s.sumBasisRefund, rentM: b.rentM, rf: I.persons[0].basis.rf, payY: rB && rB.basisPay[0], rk: I.persons[0].basis.rk, dyn: I.persons[0].basis.rentDyn, yr: rB && rB.year - Math.floor(b.s0 / 12),
    lump: p.lump, gain: p.gain, half: p.half, lumpTax: rP && rP.lumpTax, halfJ: pJ.half, lumpTaxJ: sJ.rows.find(r => r.lump[1] > 0).lumpTax, gainJ: pJ.gain }; })()`);
check('Versicherungen: Personen-Summen', v.d < 0.01, v.d);
check('Nur ETF ignoriert Vorsorgeprodukte', near(v.nA, v.nA0, 0.01), `${v.nA} / ${v.nA0}`);
check('Basisrente: Steuererstattung', v.refund > 1000, v.refund);
check('Basisrente: Rente aus Rentenfaktor', near(v.payY, v.rentM * 12 * (1 - v.rk) * Math.pow(1 + v.dyn, v.yr), 0.01), `${v.payY}`);
check('Private RV: Teilkapital 50 %', v.lump > 0 && v.gain > 0 && v.half, JSON.stringify(v));
check('Private RV: Hälftelung günstiger als Abgeltung', v.lumpTax < v.gain * 0.85 * 0.26375, `${v.lumpTax} / ${v.gain}`);
check('Private RV: ohne Hälftelung Abgeltungsteuer', !v.halfJ && near(v.lumpTaxJ, v.gainJ * 0.85 * 0.25 * 1.055, 1), `${v.lumpTaxJ} / ${v.gainJ}`);

// 9. Beiträge über dem Budget werden gekürzt, das ETF-Depot bekommt dann nichts aus dem Budget
const c = g(`(() => { const I = JSON.parse(JSON.stringify(DEFAULTS)); I.budget.monthly = 200;
  I.persons[0].basis.on = true; I.persons[0].basis.beitrag = 6000;
  const r = simulate(I, ASSUME, { scenario: 'B', targetReal: 1000, detail: true }).rows[0];
  return { cut: r.budgetCut, prod: r.avdIn.reduce((a, b) => a + b, 0) + r.basisIn[0], budget: r.budget }; })()`);
check('Budgetgrenze', c.cut < 1 && near(c.prod, c.budget, 0.01), JSON.stringify(c));

// 10. Effektivkosten wie im Produktinformationsblatt: Provisionstarif teurer als Nettotarif, plausible Spanne
const e = g(`[policyEffCost({ ...DEFAULTS.persons[0].basis, beitrag: 1200 }, 40, 0.06).eff, policyEffCost({ ...DEFAULTS.persons[0].basis, ...INS_PRESETS.netto, beitrag: 1200 }, 40, 0.06).eff]`);
check('Effektivkosten', e[0] > e[1] && e[0] > 0.008 && e[0] < 0.02 && e[1] > 0.003, e);

// 11. Optimum-Patch überträgt nur Produkt-Einstellungen
const o = g(`(() => { const I = JSON.parse(JSON.stringify(DEFAULTS)); const J = optStart(I); J.persons[1].basis.beitrag = 4800;
  const K = applyPatch(I, optPatch(optFinish(J))); return { b: K.persons[1].basis.on && K.persons[1].basis.beitrag, p: K.persons[0].prv.on, inc: K.persons[0].income === I.persons[0].income }; })()`);
check('Optimum-Patch', o.b === 4800 && o.p === false && o.inc, JSON.stringify(o));

console.log(`${ok} Prüfungen bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
