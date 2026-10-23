// Rechenproben für die Engine. Aufruf: node test/run-tests.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = vm.createContext({ console, Math, JSON });
const ENGINE_FILES = ['law', 'depot', 'insurance', 'loans', 'sim', 'defaults', 'state', 'analysis'];
for (const f of ENGINE_FILES)
  vm.runInContext(readFileSync(join(root, 'src', f + '.js'), 'utf8'), ctx);
const g = code => vm.runInContext(code, ctx);
// Hilfsfunktion im vm-Kontext: tiefe Kopien von DEFAULTS/ASSUME, f(I, A) passt sie an
vm.runInContext(`function mk(f) { const I = JSON.parse(JSON.stringify(DEFAULTS)), A = JSON.parse(JSON.stringify(ASSUME)); if (f) f(I, A); return { I, A }; }`, ctx);
const mn = (patch, scen = 'B') => g(`(() => { const { I, A } = mk(${patch || 'null'}); return maxNet(I, A, '${scen}'); })()`);

let fail = 0, ok = 0;
// Task 12: Hälftelung AVD ungefördert (Erstattungen fließen in uv): baseB 9401 → 9416, perpetual 7716 → 7730, pkv 9041 → 9054, freiwillig 8480 → 8493, noDraft 9413 → 9426, noIndex 8541 → 8572, kinderlos 9364 → 9386, avdExtra 9143 → 9541,
// basisSame 8293 → 8305, basisEtf 8624 → 8637, basisNone 8025 → 8039, prvKapital 9332 → 9346, prvKapital61 9318 → 9332, selfRv 9402 → 9417, self 8404 → 8417, saveLast 8935 → 8948, bm7 9330 → 9344, loanTeil 6512 → 6520, baseB_finalReal 167 → 155
const GOLD = { baseA: 9080, baseB: 9416, perpetual: 7730, pkv: 9054, freiwillig: 8493, noDraft: 9426, noIndex: 8572, kinderlos: 9386, avdNone: 9320, avdExtra: 9541,
  basisSame: 8305, basisEtf: 8637, basisNone: 8039, prvKapital: 9346, prvKapital61: 9332, selfRv: 9417, self: 8417, saveLast: 8948, bm7: 9344, loanTeil: 6520,
  baseB_startReal: 1299706, baseB_finalReal: 155, baseB_sumZulagen: 45465, baseB_sumRefunds: 14779 };
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
// Hälftelung ungeförderter AVD-Topf (§ 22 Nr. 5 S. 2 c EStG)
const hw = half => g(`(() => { const a = makeAVD(); a.uv = 10000; a.uCost = 6000; return avdWithdraw(a, 1000, ${half}).taxable; })()`);
check('AVD ungefördert voll: Ertragsanteil 40 %', near(hw(false), 400, 1e-9), hw(false));
check('AVD ungefördert halbiert: 20 %', near(hw(true), 200, 1e-9), hw(true));
const hv = (by, ps, st) => g(`(() => { const a = makeAVD(); a.startAbs = ${st}; return avdHalf(a, (${by} + ${ps}) * 12 + 3, { by: ${by}, bm: 3 }); })()`);
check('avdHalf: 12 Jahre und Alter 62 erfüllt', hv(1990, 67, 2027 * 12) === true);
check('avdHalf: Laufzeit unter 12 Jahren (1965, Auszahlung 2030)', hv(1965, 65, 2027 * 12) === false);
check('avdHalf: Alter unter 62', hv(1990, 61, 2027 * 12) === false);
check('avdHalf: ohne Vertragsbeginn', g('avdHalf(makeAVD(), 2057 * 12, { by: 1990, bm: 3 })') === false);
const hs = force => g(`(() => { const o = avdHalf; ${force === null ? '' : 'avdHalf = () => ' + force + ';'} try { const { I, A } = mk(p => { p.by = 1965; }); I.persons.forEach(p => { p.by = 1965; p.avd.extra = 3000; p.avd.payStart = 65; }); const s = simulate(I, A, { scenario: 'B', targetReal: 3000, detail: true }); return JSON.stringify(s.rows.map(r => [r.avdPay, r.est])); } finally { avdHalf = o; } })()`);
check('AVD 1965/2027/65: keine Hälftelung (Laufzeit 3 J.)', hs(null) === hs('false'));

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

// ─── Tests für bisher ungetestete Pfade (halten das heutige Verhalten fest) ───
// Engine-Funktionen und Konstanten für Tests in Node (Funktionen/Konstanten des vm-Kontexts)
const E = g('({ simulate, maxNet, monthsIn, retireStartAbs, monthsRetired, avdPayStartAbs, depotYear, depotSell, makeDepot, kapTax, lawYear, makeLoans, loanMonth, loanPreview, annuityM, loanRateM, absM, tariffFor, lawPick, idxVal, rwFor, SV, AVD, LAW, mk })');
const sumA = a => a.reduce((x, y) => x + y, 0);

// 12. Entnahmestrategien: ewige Rente, festes Netto, Erschöpfung
{
  const { I, A } = E.mk((I, A) => { I.withdraw.strategy = 'perpetual'; });
  const nP = E.maxNet(I, A, 'B'), nR = mn(null);
  const s = E.simulate(I, A, { scenario: 'B', targetReal: nP });
  check('perpetual: Kapital bleibt erhalten', s.finalReal >= s.startReal - 1, `${s.finalReal} / ${s.startReal}`);
  check('perpetual: Netto unter realConst', nP < nR, `${nP} / ${nR}`);
  const f1 = E.mk((I, A) => { I.withdraw.strategy = 'fixedNet'; I.withdraw.fixedNet = 2500; });
  const s1 = E.simulate(f1.I, f1.A, { scenario: 'B', targetReal: 0, detail: true });
  const ent = s1.rows.filter(r => r.phase === 'Entnahme');
  check('fixedNet 2500: Netto = Wunsch · Monate · Preisindex', ent.length > 25 && ent.every(r => near(r.net, 2500 * r.wMonths * r.priceIdx, 1)), ent.length);
  check('fixedNet 2500: nicht erschöpft', !s1.depleted);
  const f2 = E.mk((I, A) => { I.withdraw.strategy = 'fixedNet'; I.withdraw.fixedNet = 20000; });
  const s2 = E.simulate(f2.I, f2.A, { scenario: 'B', targetReal: 0, detail: true });
  check('fixedNet 20000: erschöpft im Entnahmezeitraum', s2.depleted === true && s2.depletedYear >= s2.wStartYear && s2.depletedYear <= s2.endYear, `${s2.depletedYear} / ${s2.wStartYear}-${s2.endYear}`);
}

// 13. Erstattungen aus § 10a (AVD): refundTo same / etf / none bei gleichem Zielnetto
{
  const run = m => { const { I, A } = E.mk((I, A) => I.persons.forEach(p => { p.avd.refundTo = m; })); return { I, s: E.simulate(I, A, { scenario: 'B', targetReal: 6000, detail: true }) }; };
  const same = run('same'), etf = run('etf'), none = run('none');
  // Zuzahlung ungefördert höchstens bis zum Höchstbeitrag (einMax) anteilig der Beitragsmonate
  const P = same.I.persons, saveEnd = Math.min(...P.map(E.retireStartAbs));
  let maxOver = -Infinity, more = false;
  same.s.rows.forEach((r, k) => P.forEach((p, i) => {
    const m = E.monthsIn(r.year, 2027 * 12, Math.min(saveEnd, E.retireStartAbs(p), E.avdPayStartAbs(p)));
    maxOver = Math.max(maxOver, r.avdIn[i] - E.AVD.einMax * m / 12);
    if (r.avdIn[i] > etf.s.rows[k].avdIn[i] + 1) more = true;
  }));
  check('refundTo same: avdIn höchstens einMax', maxOver <= 0.01, maxOver);
  check('refundTo same: Zuzahlung erhöht avdIn gegenüber etf', more);
  check('refundTo etf: höhere ETF-Sparrate im Folgejahr', etf.s.rows[1].etfContrib > same.s.rows[1].etfContrib, `${etf.s.rows[1].etfContrib} / ${same.s.rows[1].etfContrib}`);
  check('refundTo none: Endvermögen unter same', none.s.finalReal < same.s.finalReal, `${none.s.finalReal} / ${same.s.finalReal}`);
  check('sumRefunds in allen Fällen ähnlich (±1 %)', [etf, none].every(x => near(x.s.sumRefunds, same.s.sumRefunds, same.s.sumRefunds * 0.01)), `${same.s.sumRefunds} / ${etf.s.sumRefunds} / ${none.s.sumRefunds}`);
}

// 14. Monatsgenauigkeit
{
  check('monthsIn: Rente ab April ⇒ 9 Monate', E.monthsIn(2030, 2030 * 12 + 3, Infinity) === 9);
  check('retireStartAbs: Monat nach dem Geburtstag', E.retireStartAbs({ by: 1997, retireAge: 67, bm: 3 }) === 2064 * 12 + 3);
  const { I, A } = E.mk((I, A) => { I.saveUntil = 'last'; I.persons[1].retireAge = 64; });
  const s = E.simulate(I, A, { scenario: 'B', targetReal: 5000, detail: true });
  check('saveUntil last: Jahr mit Spar- und Entnahmemonaten', s.rows.some(r => r.saveMonths > 0 && r.wMonths > 0));
  // grvW = grv · Anteil der Rentenmonate, die in die Entnahme fallen (Rentenbeginne Person 1: April, Person 2: Oktober)
  const d = E.mk(); const wS = Math.max(...d.I.persons.map(E.retireStartAbs)), endAbs = (d.I.persons[0].by + d.I.withdraw.targetAge) * 12 + d.I.persons[0].bm;
  const sd = E.simulate(d.I, d.A, { scenario: 'B', targetReal: 5000, detail: true });
  let dev = 0, frac = false;
  for (const r of sd.rows) d.I.persons.forEach((p, i) => {
    if (r.grv[i] <= 0) return;
    const sh = E.monthsIn(r.year, Math.max(E.retireStartAbs(p), wS), endAbs) / E.monthsRetired(p, r.year);
    dev = Math.max(dev, Math.abs(r.grvW[i] - r.grv[i] * sh)); if (sh > 0 && sh < 1) frac = true;
  });
  check('grvW = grv · Anteil der Entnahmemonate', dev < 1e-6 && frac, `${dev} / ${frac}`);
  const ns = []; for (let bm = 1; bm <= 12; bm++) ns.push(mn(`(I, A) => I.persons.forEach(p => { p.bm = ${bm}; })`));
  const jump = Math.max(...ns.slice(1).map((x, k) => Math.abs(x / ns[k] - 1)));
  check('Geburtsmonat 1…12: keine Sprünge über 3 %', jump <= 0.03, `${jump} / ${ns.map(Math.round)}`);
}

// 15. Depot: Vorabpauschale, Zwölftelung, FIFO-Verkauf
{
  const fund = o => ({ name: 'F', type: 'acc', tf: 0.3, ter: 0, divY: 0, from: 2027, to: 2099, ...o });
  const dep = (o, val = 1000) => E.makeDepot({ funds: [fund(o)], startValue: val, startCost: val, startYear: 2027 });
  const OPT = { buyT: 0.5, vpFracNew: 0.5 };
  let d = dep({}), o = E.depotYear(d, 2027, 0.10, 0, 0.03, OPT);   // Basisertrag 100·3 %·0,7 = 2,10 je Anteil, Wertzuwachs 10 ⇒ voll
  check('Vorabpauschale: Basisertrag', near(o.vp, 21, 1e-9) && near(d.funds[0].lots[0].vp, 21, 1e-9) && near(o.vpTaxable, 21 * 0.7, 1e-9), JSON.stringify(o));
  d = dep({}); o = E.depotYear(d, 2027, 0.01, 0, 0.03, OPT);   // Wertzuwachs 1 deckelt
  check('Vorabpauschale: durch Wertzuwachs gedeckelt', near(o.vp, 10, 1e-9), o.vp);
  d = dep({}); o = E.depotYear(d, 2027, -0.10, 0, 0.03, OPT);
  check('Vorabpauschale: bei Kursverlust null', o.vp === 0);
  d = dep({ type: 'dist', divY: 0.02 }); o = E.depotYear(d, 2027, 0.10, 0, 0.03, OPT);   // min(2,1; 10) − Ausschüttung 2 = 0,1 je Anteil
  check('Vorabpauschale: abzüglich Ausschüttung', near(o.vp, 1, 1e-9) && near(o.dist, 20, 1e-9), `${o.vp} / ${o.dist}`);
  d = dep({}); o = E.depotYear(d, 2027, 0.10, 1000, 0.03, OPT);   // neue Tranche zum mittleren Kurs, Vorabpauschale nur zu vpFracNew
  const nl = d.funds[0].lots[1], u = 1000 / (100 * Math.pow(1.1, 0.5));
  check('Zwölftelung der Vorabpauschale bei neuer Tranche', near(nl.units, u, 1e-9) && near(nl.vp, 2.1 * u * 0.5, 1e-9) && near(d.funds[0].lots[0].vp, 21, 1e-9), JSON.stringify(nl));
  // FIFO: älteste Tranche (Kosten 50) zuerst ganz, dann die Hälfte der zweiten (Kosten 90 + vp 10)
  const mkLots = (vp1 = 0) => { const x = dep({}, 0); x.funds[0].lots.push({ y: 2020, units: 1, cost: 50, vp: vp1 }, { y: 2021, units: 1, cost: 90, vp: 10 }); return x; };
  d = mkLots(); const dry = E.depotSell(d, 150, 'newestFirst', true);
  check('depotSell FIFO: Gewinn und Teilfreistellung (vp nur auf Tranche 2)', near(dry.gain, 50, 1e-9) && near(dry.taxable, 35, 1e-9) && near(dry.sold, 150, 1e-9), JSON.stringify(dry));
  // vp auf beiden Tranchen (je 10): Tranche 1 Gewinn 100 - 60 = 40, Tranche 2 zur Hälfte 50 - 50 = 0
  const dry2 = E.depotSell(mkLots(10), 150, 'newestFirst', true);
  check('depotSell FIFO: vp auf beiden Tranchen', near(dry2.gain, 40, 1e-9) && near(dry2.taxable, 28, 1e-9) && near(dry2.sold, 150, 1e-9), JSON.stringify(dry2));
  check('depotSell dry ändert den Bestand nicht', d.funds[0].lots.length === 2 && d.funds[0].lots[0].units === 1);
  E.depotSell(d, 150, 'newestFirst', false);
  check('depotSell: Bestand nach Verkauf', d.funds[0].lots.length === 1 && near(d.funds[0].lots[0].units, 0.5, 1e-9) && near(d.funds[0].lots[0].cost, 45, 1e-9) && near(d.funds[0].lots[0].vp, 5, 1e-9));
}

// 16. kapTax: Verlustvortrag, Sparerpauschbetrag, Günstigerprüfung
{
  const A0 = g('ASSUME'), L = E.lawYear(2030, A0, 1);
  const lv = E.kapTax(500, 2000, L, 50000, 0, A0);
  check('kapTax: Verlustvortrag größer als Ertrag', near(lv.newLoss, 1500, 1e-9) && lv.tax === 0, JSON.stringify(lv));
  const ng = { ...A0, guenstiger: false };
  const pb1 = E.kapTax(5000, 0, L, 1e6, 0, ng, 1000), pb2 = E.kapTax(5000, 0, L, 1e6, 0, ng, 99999);
  check('kapTax: pb 1.000 zieht nur 1.000 ab', near(pb1.afterSPB, 4000, 1e-9) && near(pb1.tax, 4000 * 0.25 * 1.055, 1e-9), JSON.stringify(pb1));
  check('kapTax: pb nie über Sparerpauschbetrag', near(pb2.afterSPB, 5000 - E.LAW.sparerPB, 1e-9), pb2.afterSPB);
  const lo = E.kapTax(5000, 0, L, 10000, 0, A0), hi = E.kapTax(5000, 0, L, 200000, 0, A0);
  check('kapTax: Günstigerprüfung bei kleinem zvE', lo.guenstiger === true && lo.tax < 3000 * 0.25 * 1.055, JSON.stringify(lo));
  check('kapTax: keine Günstigerprüfung bei hohem zvE', hi.guenstiger === false && near(hi.tax, 3000 * 0.25 * 1.055, 1e-9), JSON.stringify(hi));
}

// 17. Darlehen: tilgungsfreie Zeit, Bankrestschuld, Teilablösung, Vorschau
{
  const base = { name: 'T', amount: 300000, eff: 0.035, startY: 2026, startM: 1, monthly: 1350, freeMonths: 0, fixBalBank: 0, fixEndY: 2036, fixEndM: 1, sonder: 0, sonderFrom: 2026, sonderTo: 2035, after: 'anschluss', zins: 0.04, years: 20, teil: 0 };
  const free = { ...base, freeMonths: 12 }, l = E.makeLoans([free], 2026 * 12)[0];
  let pay = 0, ints = 0; for (let m = 0; m < 12; m++) { const o = E.loanMonth(l, 2026 * 12 + m, false); pay += o.pay; ints += o.interest; }
  check('Darlehen freeMonths: im ersten Jahr nur Zinsen', near(pay, ints, 1e-6) && near(l.bal, 300000, 1e-6), `${pay} / ${ints} / ${l.bal}`);
  E.loanMonth(l, 2027 * 12, false);
  check('Darlehen freeMonths: danach Tilgung', l.bal < 300000);
  const lb = E.makeLoans([{ ...base, fixBalBank: 200000 }], 2026 * 12)[0];
  for (let a = 2026 * 12; a <= 2036 * 12; a++) E.loanMonth(lb, a, true);
  check('Darlehen fixBalBank: Restschuld zum Ende der Zinsbindung', near(lb.fixBal, 200000, 1e-6), lb.fixBal);
  const pt = E.loanPreview({ ...base, after: 'teil', teil: 50000 }, 2026 * 12);
  check('Darlehen after teil: Ablösung = teil', pt.payoff === 50000, pt.payoff);
  const fixAbs = E.absM(2036, 1);
  check('loanPreview: Ende nach Zinsbindung (Anschluss)', pt.end > fixAbs && E.loanPreview(base, 2026 * 12).end > fixAbs);
  check('loanPreview: Ablösung bei after etf beendet das Darlehen zum Zinsbindungsende', E.loanPreview({ ...base, after: 'etf' }, 2026 * 12).end === fixAbs);
}

// 18. Fortschreibung von Tarif, Beitragsbemessungsgrenzen und Rentenwert
{
  const ix = { useDraft: true, indexTariff: true, inflation: 0.02 };
  check('tariffFor 2035: Index ab 2028', near(E.tariffFor(2035, ix).idx, Math.pow(1.02, 7), 1e-12) && E.tariffFor(2035, ix).p === E.LAW.tariff[2028]);
  check('tariffFor 2027 ohne Entwurf: Tarif 2026', E.tariffFor(2027, { ...ix, useDraft: false }).p === E.LAW.tariff[2026]);
  check('tariffFor ohne Indexierung: Faktor 1', E.tariffFor(2035, { ...ix, indexTariff: false }).idx === 1);
  check('idxVal bbgRV 2030', near(E.idxVal(E.SV.bbgRV, 2030, 0.03), 106200 * Math.pow(1.03, 3), 1e-6));
  const lt = { 2026: 1, 2027: { v: 2, st: 'E' } };
  check('lawPick ohne Entwurf: 2026', E.lawPick(lt, 2030, false).v === 1 && E.lawPick(lt, 2030, false).y === 2026);
  check('lawPick mit Entwurf: 2027', E.lawPick(lt, 2030, true).v === 2 && E.lawPick(lt, 2030, true).y === 2027);
  check('lawPick vor erstem Jahr: erster Eintrag', E.lawPick(E.LAW.tariff, 2025).y === 2026);
  check('lawPick anPausch', E.lawPick(E.LAW.pausch.anPausch, 2030, true).v === 1430 && E.lawPick(E.LAW.pausch.anPausch, 2030, false).v === 1230);
  const A0 = g('ASSUME'), r = y => E.rwFor(y, A0) / E.rwFor(y - 1, A0);
  check('rwFor: ab 2032 gedämpftes Wachstum', near(r(2031), 1 + A0.wageGrowth, 1e-12) && near(r(2032), 1 + A0.wageGrowth - A0.rentenDaempfung, 1e-12) && r(2032) < r(2031));
}

// 19. KV der Rentner: KVdR ohne Beiträge auf AVD-Auszahlungen, freiwillig mit
{
  const kvs = (kvdr, scen, patch) => { const { I, A } = E.mk((I, A) => { I.persons.forEach(p => { p.kvdr = kvdr; }); if (patch) patch(A); }); return E.simulate(I, A, { scenario: scen, targetReal: 5000, detail: true }).rows; };
  const ja = kvs('ja', 'B'), jaA = kvs('ja', 'A'), nein = kvs('nein', 'B');
  const ent = ja.map((r, k) => k).filter(k => ja[k].phase === 'Entnahme');
  check('KVdR: KV in A und B gleich (AVD ohne Beitrag)', ent.length > 25 && ent.every(k => ja[k].pp.every((p, i) => near(p.kv, jaA[k].pp[i].kv, 0.01))));
  const k0 = ja.findIndex(r => r.avdPay[0] > 0);
  check('Freiwillig: KV mit AVD-Auszahlung höher als KVdR', k0 >= 0 && nein[k0].pp[0].kv > ja[k0].pp[0].kv + 1, `${nein[k0]?.pp[0].kv} / ${ja[k0]?.pp[0].kv}`);
}

// 20. Zufallspfade und Monte Carlo (asynchron, eigener Kontext mit setTimeout und Date)
{
  const ctx2 = vm.createContext({ console, Math, JSON, setTimeout, Date });
  for (const f of ENGINE_FILES) vm.runInContext(readFileSync(join(root, 'src', f + '.js'), 'utf8'), ctx2);
  const g2 = code => vm.runInContext(code, ctx2);
  vm.runInContext(`function mk(f) { const I = JSON.parse(JSON.stringify(DEFAULTS)), A = JSON.parse(JSON.stringify(ASSUME)); if (f) f(I, A); return { I, A }; }`, ctx2);
  const E2 = g2('({ rng, pct, makePaths, monteCarlo, ASSUME, mk })');
  const seq = s => { const r = E2.rng(s); return [r(), r(), r(), r()]; };
  check('rng: gleicher Startwert, gleiche Folge', JSON.stringify(seq(1)) === JSON.stringify(seq(1)) && JSON.stringify(seq(1)) !== JSON.stringify(seq(2)));
  check('pct: Median von 1…4', E2.pct([1, 2, 3, 4], 0.5) === 2.5 && E2.pct([4, 1, 3, 2], 0) === 1 && E2.pct([1, 2, 3, 4], 1) === 4);
  const p1 = E2.makePaths(3, 10, E2.ASSUME, 7), p2 = E2.makePaths(3, 10, E2.ASSUME, 7);
  check('makePaths: deterministisch', p1.length === 3 && p1[0].length === 10 && JSON.stringify(p1) === JSON.stringify(p2) && JSON.stringify(p1) !== JSON.stringify(E2.makePaths(3, 10, E2.ASSUME, 8)));
  const { I, A } = E2.mk();
  const res = await new Promise(resolve => E2.monteCarlo(I, A, { runs: 3, seed: 1 }, null, resolve));
  check('monteCarlo: Ergebnis je Pfad und Variante', res.runs === 3 && res.res.A.length === 3 && res.res.B.length === 3 && res.fan.A.length === 3 && res.keys.join() === 'A,B', JSON.stringify(res.keys));
  check('monteCarlo: Jahre und Fehlerzähler', res.years[0] === I.startYear && res.fan.A[0].length === res.years.length && res.fail.A >= 0 && res.det.B > res.det.A);
}

// 21. Zustands-Helfer (state.js): esc, loadState, conform
{
  check('esc: Sonderzeichen', g(`esc('<a href="x">\\'&')`) === '&lt;a href=&quot;x&quot;&gt;&#39;&amp;', g(`esc('<a href="x">\\'&')`));
  const L = g(`loadState({ I: { persons: [{ avd: { kinderzulage: true } }], budget: { monthly: '1200' } }, A: { optMode: 'xyz' } })`);
  check('loadState: Zahl aus Text', L.I.budget.monthly === 1200, String(L.I.budget.monthly));
  check('loadState: ungültige Auswahl fällt auf Standard', L.A.optMode === 'fast', String(L.A.optMode));
  check('loadState: fehlende Felder aus Standardwerten', L.I.persons[0].avd.eigen === 1800, String(L.I.persons[0].avd.eigen));
  check('loadState: Kinder-Zulageempfänger ergänzt', L.I.children[0].zulageTo === 0, String(L.I.children[0]?.zulageTo));
  check('loadState({}) entspricht den Standardwerten', JSON.stringify(g('loadState({})')) === JSON.stringify({ I: g('DEFAULTS'), A: g('ASSUME') }));
}

// 22. OPT_SPACE aus AVD/INS abgeleitet, gleiche Werte wie das frühere Literal
{
  const alt = { avd: { eigen: [0, 360, 900, 1800], extra: [0, 1680, 3360, 5040], payStart: [65, 66, 67, 68, 69, 70], payEnd: [85, 88, 91, 95, 100], teilkapital: [0, 0.3] },
    basis: { beitrag: [0, 1200, 2400, 4800, 9600, 19200], payStart: [62, 65, 67, 70] },
    prv: { beitrag: [0, 1200, 2400, 4800, 9600], payStart: [62, 65, 67, 70], mode: ['rente', 'teil', 'kapital'] } };
  check('OPT_SPACE entspricht dem alten Literal', g('JSON.stringify(OPT_SPACE)') === JSON.stringify(alt), g('JSON.stringify(OPT_SPACE)'));
}

console.log(`${ok} Prüfungen bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
