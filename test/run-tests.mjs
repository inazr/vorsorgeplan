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
// Task 13: Rentenwert gilt ab 1.7. (Jan-Jun Vorjahreswert), Netto sinkt leicht, baseA 9080 → 9041, baseB 9416 → 9378, perpetual 7730 → 7693, pkv 9054 → 9007, freiwillig 8493 → 8455, noDraft 9426 → 9389, noIndex 8572 → 8542, kinderlos 9386 → 9349, avdNone 9320 → 9283, avdExtra 9541 → 9505, basisSame 8305 → 8270, basisEtf 8637 → 8601, basisNone 8039 → 8002, prvKapital 9346 → 9309, prvKapital61 9332 → 9295, selfRv 9417 → 9379, self 8417 → 8392, saveLast 8948 → 8914, bm7 9344 → 9308, loanTeil 6520 → 6481, baseB_finalReal 155 → 164
// Task 14: KV-Basis freiwillig ohne 51-€-Abzug, freiwillig 8455 → 8454 (genauer 8454,59 → 8454,10); prvKapital61 unverändert, weil das Depot im Auszahlungsjahr den Sparerpauschbetrag schon verbraucht (pbRest = 0)
// Task 15: RV-Satz jahresweise (2028: 19,9 % laut DRV), Höchstbetrag aus knappschaftlicher BBG, RV-pflichtige Selbständige mit vollem Beitrag im Vorsorgeabzug.
//   Höherer Vorsorgeabzug senkt den Grenzsteuersatz und damit die § 10a-Erstattung (die Lohnsteuer selbst wirkt nicht aufs Sparbudget), daher sinkt selfRv: 9379 → 9358 (9379,39 → 9358,40, davon 18,55 aus dem Selbständigen-Abzug).
//   19,9 % ab 2028: baseA 9041 (9040,53 → 9041,02), baseB 9378 → 9377 (9378,42 → 9377,44), perpetual 7693 → 7692 (7692,87 → 7692,38), noIndex 8542 → 8541 (8542,48 → 8541,50), pkv 9007 → 9006, freiwillig 8454 → 8453 (8454,10 → 8453,13), noDraft 9389 → 9388, kinderlos 9349 → 9348, avdExtra 9505 → 9504, basisSame 8270 → 8267, basisEtf 8601 → 8597,
//   basisNone 8002 → 8000, prvKapital 9309 → 9308 (9309,08 → 9308,11), prvKapital61 9295 → 9293, self 8392 → 8391, saveLast 8914 → 8913, bm7 9308 → 9307, baseB_startReal 1299706 → 1299438, baseB_finalReal 164 → 68, baseB_sumRefunds 14779 → 14606
// Task A2: Kapitalsteuer genau einmal; die Steuer im Übergangsjahr 2064, die das Restbudget nicht deckt, wird jetzt über einen Depotverkauf bezahlt (vorher verfallen),
//   baseA 9041 → 9035, baseB 9377 → 9375, perpetual 7692 → 7689, pkv 9006 → 9002, freiwillig 8453 → 8450, noDraft 9388 → 9385, noIndex 8541 → 8539, kinderlos 9348 → 9345, avdNone 9283 → 9280, prvKapital 9308 → 9306, prvKapital61 9293 → 9291, selfRv 9358 → 9355, self 8391 → 8388, saveLast 8913 → 8911, baseB_finalReal 68 → 45; loanTeil unverändert (Depot reicht nicht, Sparbudget im Ablösungsjahr 0, daher vorher keine Doppelsteuer)
// Task B2: ein ETF-Depot je Person; Netto unverändert (baseA 9035,16, baseB 9374,51), nur der Rest am Zielalter verschiebt sich: Person 1 bekommt ihre AVD-Auszahlung
//   vor dem Entnahmestart (April bis September 2064) allein ins eigene Depot, Verkäufe laufen nach Depotwert und FIFO je Depot, baseB_finalReal 45 → 48 (45,32 → 47,79)
// Task B6: Kindererziehungszeiten (Standardkind: 29 Monate ab Renteninfo 01/2026 bringen Person 1 rund 2,4 EP), baseA 9035 → 9124, baseB 9375 → 9458, perpetual 7689 → 7773, pkv 9002 → 9110, freiwillig 8450 → 8538, noDraft 9385 → 9469, noIndex 8539 → 8604, avdNone 9280 → 9364, avdExtra 9504 → 9585, basisSame 8267 → 8347, basisEtf 8597 → 8679, basisNone 8000 → 8082, prvKapital 9306 → 9389, prvKapital61 9291 → 9375, selfRv 9355 → 9439, self 8388 → 8475, saveLast 8911 → 8996, bm7 9307 → 9391, loanTeil 6481 → 6568, baseB_finalReal 48 → 263, baseB_sumRefunds 14606 → 14608
// Task C1: Kaufkraft 2026 und Fortschreibung ab 2026 (Preisindex, Einkommen, Budget ab 2026; Startjahr 2027 = 1 Jahr Inflation und Wachstum vorab), Presets mit Rentendynamik 1,5 %, baseA 9124 → 9118, baseB 9458 → 9446, perpetual 7773 → 7766, pkv 9110 → 9125, freiwillig 8538 → 8532, noDraft 9469 → 9458, noIndex 8604 → 8594, kinderlos 9345 → 9337, avdNone 9364 → 9349, avdExtra 9585 → 9570, basisSame 8347 → 8453, basisEtf 8679 → 8751, basisNone 8082 → 8161, prvKapital 9389 → 9378, prvKapital61 9375 → 9364, selfRv 9439 → 9429, self 8475 → 8456, saveLast 8996 → 8983, bm7 9391 → 9378, loanTeil 6568 → 6573, baseB_startReal 1299438 → 1296323, baseB_finalReal 263 → 253, baseB_sumRefunds 14608 → 15242
//   Zerlegung: basisSame +106 = +91 aus rentDyn 1,5 % + Rest Zeiteffekt, basisEtf/basisNone +72/+79 = je +63 aus rentDyn + Rest Zeiteffekt;
//   pkv +15 reiner Zeiteffekt (PKV-Beitrag und Policen nominal fix gegenüber wachsendem Einkommen und Budget)
// Task C3: Entnahme zur Jahresmitte (ETF-Verkäufe zur Mitte der Entnahmemonate, Ablösung im Monat der Ablösung, AVD-Auszahlung mit Rendite bis zur Mitte der Auszahlungsmonate; Sparphase unverändert),
//   baseA 9118 → 9302 (+2,0 %), baseB 9446 → 9636, perpetual 7766 → 7903, pkv 9125 → 9315, freiwillig 8532 → 8699, noDraft 9458 → 9648, noIndex 8594 → 8779, kinderlos 9337 → 9527, avdNone 9349 → 9537, avdExtra 9570 → 9756,
//   basisSame 8453 → 8575, basisEtf 8751 → 8894, basisNone 8161 → 8284, prvKapital 9378 → 9566, prvKapital61 9364 → 9552, selfRv 9429 → 9619, self 8456 → 8648, saveLast 8983 → 9167, bm7 9378 → 9564, loanTeil 6573 → 6667, baseB_finalReal 253 → 455
// Task C4: Reinvestition von Auszahlungen vor dem Entnahmestart mit Grenzsteuer (gestapelt über Erwerbseinkommen und GRV) und KV der Quellen statt pauschal 30 %, baseA/baseB unverändert,
//   freiwillig 8699 → 8693 (KV auf AVD jetzt abgezogen), noIndex 8779 → 8775, avdNone 9537 → 9536, avdExtra 9756 → 9760 (ungeförderter Teil nur mit Ertrag steuerpflichtig, Grenzsteuer auf die Auszahlung unter 30 %),
//   basisSame 8575 → 8572, basisEtf 8894 → 8892, basisNone 8284 → 8282, baseB_finalReal 455 → 405 (Person 1: AVD-Auszahlung April bis September 2064 neben dem Erwerbseinkommen von Person 2, Abzug rund 32 % statt 30 %)
// Final I1: Beitrags-EP zwischen Stand der Renteninfo (Januar 2026) und Rechnungsbeginn 2027 gutgeschrieben (Person 1 +0,77 EP, Person 2 +1,15 EP),
//   baseA 9302 → 9371, baseB 9636 → 9701, perpetual 7903 → 7968, pkv 9315 → 9398, freiwillig 8693 → 8761, noDraft 9648 → 9713, noIndex 8775 → 8826, kinderlos 9527 → 9592, avdNone 9536 → 9601, avdExtra 9760 → 9823, basisSame 8572 → 8634, basisEtf 8892 → 8955, basisNone 8282 → 8345, prvKapital 9566 → 9630, prvKapital61 9552 → 9616, selfRv 9619 → 9684, self 8648 → 8688, saveLast 9167 → 9229, bm7 9564 → 9629, loanTeil 6667 → 6733, baseB_finalReal 405 → 306, baseB_sumRefunds 15242 → 15243
const GOLD = { baseA: 9371, baseB: 9701, perpetual: 7968, pkv: 9398, freiwillig: 8761, noDraft: 9713, noIndex: 8826, kinderlos: 9592, avdNone: 9601, avdExtra: 9823,
  basisSame: 8634, basisEtf: 8955, basisNone: 8345, prvKapital: 9630, prvKapital61: 9616, selfRv: 9684, self: 8688, saveLast: 9229, bm7: 9629, loanTeil: 6733,
  baseB_startReal: 1296323, baseB_finalReal: 306, baseB_sumZulagen: 45465, baseB_sumRefunds: 15243 };
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
console.log(`Beispielhaushalt: Netto A ${r.nA.toFixed(0)} €, B ${r.nB.toFixed(0)} € pro Monat (Kaufkraft 2026)`);

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
  // Gleicher Fall ohne Freistellungsauftrag: der Sparerpauschbetrag ist vom Depot unberührt und steht der Auszahlung ganz zu
  const J0 = JSON.parse(JSON.stringify(J)); J0.persons.forEach(p => { p.etf.freistellung = 0; });
  const sJ0 = simulate(J0, ASSUME, { scenario: 'B', targetReal: nB, detail: true }), pJ0 = sJ0.pol[1].prv;
  const sJ = simulate(J, ASSUME, { scenario: 'B', targetReal: nB, detail: true }), pJ = sJ.pol[1].prv;
  return { nA0, nA, nB, d, depleted: s.depleted, refund: s.sumBasisRefund, rentM: b.rentM, rf: I.persons[0].basis.rf, payY: rB && rB.basisPay[0], rk: I.persons[0].basis.rk, dyn: I.persons[0].basis.rentDyn, yr: rB && rB.year - Math.floor(b.s0 / 12),
    lump: p.lump, gain: p.gain, half: p.half, lumpTax: rP && rP.lumpTax, halfJ: pJ.half, lumpTaxJ: sJ.rows.find(r => r.lump[1] > 0).lumpTax, gainJ: pJ.gain, lumpTaxJ0: sJ0.rows.find(r => r.lump[1] > 0).lumpTax, gainJ0: pJ0.gain, halfJ0: pJ0.half }; })()`);
check('Versicherungen: Personen-Summen', v.d < 0.01, v.d);
check('Nur ETF ignoriert Vorsorgeprodukte', near(v.nA, v.nA0, 0.01), `${v.nA} / ${v.nA0}`);
check('Basisrente: Steuererstattung', v.refund > 1000, v.refund);
check('Basisrente: Rente aus Rentenfaktor', near(v.payY, v.rentM * 12 * (1 - v.rk) * Math.pow(1 + v.dyn, v.yr), 0.01), `${v.payY}`);
check('Private RV: Teilkapital 50 %', v.lump > 0 && v.gain > 0 && v.half, JSON.stringify(v));
check('Private RV: Hälftelung günstiger als Abgeltung', v.lumpTax < v.gain * 0.85 * 0.26375, `${v.lumpTax} / ${v.gain}`);
// Im Standardfall verbraucht das Depot in diesem Jahr den ganzen Sparerpauschbetrag (pbRest = 0), sonst steht der Rest der Auszahlung zu
check('Private RV: ohne Hälftelung Abgeltungsteuer (pbRest 0)', !v.halfJ && near(v.lumpTaxJ, Math.max(0, v.gainJ * 0.85) * 0.25 * 1.055, 1), `${v.lumpTaxJ} / ${v.gainJ}`);
check('Private RV: ohne Hälftelung Sparerpauschbetrag (prvKapital61)', !v.halfJ0 && near(v.lumpTaxJ0, Math.max(0, v.gainJ0 * 0.85 - g('LAW.sparerPB')) * 0.25 * 1.055, 1), `${v.lumpTaxJ0} / ${v.gainJ0}`);

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
const E = g('({ simulate, maxNet, monthsIn, retireStartAbs, monthsRetired, avdPayStartAbs, depotYear, depotSell, makeDepot, kapTax, lawYear, makeLoans, loanMonth, loanPreview, annuityM, loanRateM, absM, tariffFor, lawPick, idxVal, rwJul, grvYear, SV, AVD, LAW, mk })');
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
  // Verkauf in depotYear zum Zeitpunkt t: Kurs 100·1,21^0,5 = 110, FIFO wie depotSell: Tranche 1 ganz (110), von Tranche 2 noch 40/110
  d = mkLots(); o = E.depotYear(d, 2027, 0.21, 0, 0, { ...OPT, sell: { gross: 150, mode: 'newestFirst', t: 0.5 } });
  const l2 = d.funds[0].lots[0], s2 = 1 - 40 / 110;
  check('depotYear sell: FIFO zum Kurs bei t', near(o.sold, 150, 1e-9) && d.funds[0].lots.length === 1 && near(l2.units, s2, 1e-9) && near(l2.cost, 90 * s2, 1e-9) && near(l2.vp, 10 * s2, 1e-9) && near(d.funds[0].price, 121, 1e-9), JSON.stringify([o.sold, l2]));
}

// 16. kapTax: Verlustvortrag, Sparerpauschbetrag, Günstigerprüfung
{
  const A0 = g('ASSUME'), L = E.lawYear(2030, A0), tp = { split: true, nKids: 0, kfbF: 1, kgF: 1, kist: 0, eb24b: 0 };
  const lv = E.kapTax(500, 2000, L, 50000, tp, A0);
  check('kapTax: Verlustvortrag größer als Ertrag', near(lv.newLoss, 1500, 1e-9) && lv.tax === 0, JSON.stringify(lv));
  const ng = { ...A0, guenstiger: false };
  const pb1 = E.kapTax(5000, 0, L, 1e6, tp, ng, 1000), pb2 = E.kapTax(5000, 0, L, 1e6, tp, ng, 99999);
  check('kapTax: pb 1.000 zieht nur 1.000 ab', near(pb1.afterSPB, 4000, 1e-9) && near(pb1.tax, 4000 * 0.25 * 1.055, 1e-9), JSON.stringify(pb1));
  check('kapTax: pb nie über Sparerpauschbetrag', near(pb2.afterSPB, 5000 - E.LAW.sparerPB, 1e-9), pb2.afterSPB);
  const lo = E.kapTax(5000, 0, L, 10000, tp, A0), hi = E.kapTax(5000, 0, L, 200000, tp, A0);
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
  check('idxVal liest { v, st } als Zahl', E.idxVal({ 2026: 100, 2027: { v: 110, st: 'E' } }, 2027, 0) === 110 && near(E.idxVal({ 2026: 100, 2027: { v: 110, st: 'E' } }, 2028, 0.1), 121, 1e-9));
  check('idxVal bbgRV 2030', near(E.idxVal(E.SV.bbgRV, 2030, 0.03), 106200 * Math.pow(1.03, 3), 1e-6));
  const lt = { 2026: 1, 2027: { v: 2, st: 'E' } };
  check('lawPick ohne Entwurf: 2026', E.lawPick(lt, 2030, false).v === 1 && E.lawPick(lt, 2030, false).y === 2026);
  check('lawPick mit Entwurf: 2027', E.lawPick(lt, 2030, true).v === 2 && E.lawPick(lt, 2030, true).y === 2027);
  check('lawPick vor erstem Jahr: erster Eintrag', E.lawPick(E.LAW.tariff, 2025).y === 2026);
  check('lawPick anPausch', E.lawPick(E.LAW.pausch.anPausch, 2030, true).v === 1430 && E.lawPick(E.LAW.pausch.anPausch, 2030, false).v === 1230);
  const A0 = g('ASSUME'), r = y => E.rwJul(y, A0) / E.rwJul(y - 1, A0);
  check('rwJul: ab 2032 gedämpftes Wachstum', near(r(2031), 1 + A0.wageGrowth, 1e-12) && near(r(2032), 1 + A0.wageGrowth - A0.rentenDaempfung, 1e-12) && r(2032) < r(2031));
  check('rwJul: Tabellenwerte 2025/2026', E.rwJul(2026, A0) === 42.52 && E.rwJul(2025, A0) === 40.79);
  check('grvYear 2026 ab Jahresbeginn: 6 Monate alter, 6 Monate neuer Rentenwert', near(E.grvYear(1, 1, 2026, 0, A0), 6 * 40.79 + 6 * 42.52, 1e-9));
  check('grvYear Rentenbeginn Oktober: nur neuer Rentenwert', near(E.grvYear(2, 0.9, 2030, 2030 * 12 + 9, A0), 2 * 0.9 * 3 * E.rwJul(2030, A0), 1e-9));
  check('grvYear Rentenbeginn April: 3 Monate alt, 6 neu', near(E.grvYear(1, 1, 2030, 2030 * 12 + 3, A0), 3 * E.rwJul(2029, A0) + 6 * E.rwJul(2030, A0), 1e-9));
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
  const q0 = E2.makePaths(3, 10, { ...E2.ASSUME, inflPhi: 0 }, 7), Rs = p => JSON.stringify(p.map(x => x.map(y => y.R)));
  check('makePaths: Renditen unabhängig von φ, Inflation bei φ = 0 ohne Gedächtnis', Rs(q0) === Rs(p1) && JSON.stringify(q0) !== JSON.stringify(p1));
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
  // Rechnung mit der Summe aus Depotkosten und TER, Depotkosten höchstens 1 %
  const avdK = (c, t) => g(`(() => { const { I, A } = mk(I => I.persons.forEach(p => { p.avd.cost = ${c}; p.avd.ter = ${t}; })); return simulate(I, A, { scenario: 'B', targetReal: 9000 }).finalReal; })()`);
  check('AVD-Kosten: Depot + TER zählen zusammen', near(avdK(0.001, 0.003), avdK(0.004, 0), 1e-6) && avdK(0.004, 0) < avdK(0, 0), '');
  check('AVD-Kosten: Depotkosten auf 1 % begrenzt', near(avdK(0.02, 0), avdK(0.01, 0), 1e-6), '');
}

// 22. OPT_SPACE aus AVD/INS abgeleitet, gleiche Werte wie das frühere Literal
{
  const alt = { avd: { eigen: [0, 360, 900, 1800], extra: [0, 1680, 3360, 5040], payStart: [65, 66, 67, 68, 69, 70], payEnd: [85, 88, 91, 95, 100], teilkapital: [0, 0.3] },
    basis: { beitrag: [0, 1200, 2400, 4800, 9600, 19200], payStart: [62, 65, 67, 70] },
    prv: { beitrag: [0, 1200, 2400, 4800, 9600], payStart: [62, 65, 67, 70], mode: ['rente', 'teil', 'kapital'] } };
  check('OPT_SPACE entspricht dem alten Literal', g('JSON.stringify(OPT_SPACE)') === JSON.stringify(alt), g('JSON.stringify(OPT_SPACE)'));
}

// 23. RV-Satz jahresweise, Höchstbetrag aus knappschaftlicher BBG (§ 10 Abs. 3 S. 1 EStG), RV-pflichtige Selbständige
{
  const hb = y => g(`hbFor(lawYear(${y}, ASSUME))`), hy = y => g(`hbYear(${y})`);
  check('hbFor 2026', hb(2026) === 30826, hb(2026));
  check('hbFor 2027', hb(2027) === 32308, hb(2027));
  check('hbYear wie hbFor', hy(2026) === 30826 && hy(2027) === 32308, `${hy(2026)} / ${hy(2027)}`);
  // Person 1 selbständig (40.000 €), Person 2 angestellt (60.000 €), je 30.000 € Basisrente: der Höchstbetrag bindet
  const rv = g(`(() => { const f = x => { const { I, A } = mk((I, A) => { I.budget.monthly = 6000; I.persons.forEach(p => { p.basis.on = true; p.basis.beitrag = 30000; p.incomeGrowth = 0; }); ${T}.job = 'self'; ${T}.rvPflicht = x; });
      return simulate(I, A, { scenario: 'B', targetReal: 1000, detail: true }).rows[0]; };
    const a = f(true), b = f(false), L = lawYear(a.year, ASSUME), hb = hbFor(L), rs = L.rvSatz;
    return { estA: a.est, estB: b.est, dedA: a.basisDed, dedB: b.basisDed, hb, rs, bbg: L.bbgRV }; })()`);
  check('selfRv: höherer Vorsorgeabzug, weniger Einkommensteuer', rv.estA < rv.estB - 1000, `${rv.estA} / ${rv.estB}`);
  check('self: Höchstbetrag minus AN- und AG-Beitrag von Person 2', near(rv.dedB, 2 * rv.hb - rv.rs * Math.min(60000, rv.bbg), 0.01), `${rv.dedB}`);
  check('selfRv: Höchstbetrag zusätzlich um den vollen RV-Beitrag gekürzt', near(rv.dedB - rv.dedA, rv.rs * 40000, 0.01), `${rv.dedB - rv.dedA}`);
}

// 24. Rendite je Anlage (IRR): Zinsfuß, Aufteilung von Steuer und KV, plausible Größenordnung
{
  check('irr: 100 → 110 nach einem Jahr = 10 %', near(g(`irr([{ t: 0, v: -100 }, { t: 1, v: 110 }])`), 0.1, 1e-9));
  check('irr: ohne Zufluss null', g(`irr([{ t: 0, v: -100 }, { t: 1, v: 0 }])`) === null);
  check('irr: Rundungsrest am Ende stört nicht', near(g(`irr([{ t: 0, v: -100 }, { t: 1, v: 110 }, { t: 30, v: -1e-12 }])`), 0.1, 1e-9));
  const r = g(`(() => { const run = (f, sc) => { const { I, A } = mk(f); const s = simulate(I, A, { scenario: sc, targetReal: 8000, detail: true }); return { s, I, A, nom: productIRR(s, I, false), real: productIRR(s, I, true) }; };
    const pol = I => I.persons.forEach(p => { p.basis.on = true; p.basis.beitrag = 3000; p.prv.on = true; p.prv.beitrag = 1800; });
    const b = run(pol, 'B'), a = run(null, 'A'), fw = run(I => { pol(I); I.persons.forEach(p => p.kvdr = 'nein'); }, 'B');
    const row = b.s.rows.find(x => x.year === b.s.wFullYear), p0 = row.pp[0];
    const estSum = p0.estBy.avd + p0.estBy.basis + p0.estBy.prv;
    const kvOk = b.s.rows.every(x => x.pp.every(p => !p.kvBy || (p.kvBy.avd === 0 && p.kvBy.prv === 0)));
    const kvFw = fw.s.rows.some(x => x.pp.some(p => p.kvBy && p.kvBy.prv > 0 && p.kvBy.avd > 0));
    return { b: b.nom, br: b.real, a: a.nom, estSum, est: p0.est, kvOk, kvFw, ret: b.A.ret, infl: b.A.inflation }; })()`);
  check('IRR: nur ETF ohne Vorsorgeprodukte', r.a.avd.hh === null && r.a.basis.hh === null && r.a.etf.hh > 0, JSON.stringify(r.a));
  check('IRR: ETF-Depot unter der Marktrendite (TER, Steuern)', r.b.etf.hh > 0.04 && r.b.etf.hh < r.ret, r.b.etf.hh);
  check('IRR: alle Produkte mit Ergebnis', ['avd', 'basis', 'prv'].every(k => r.b[k].per.every(x => x > 0 && x < 0.15) && r.b[k].hh > 0), JSON.stringify(r.b));
  check('IRR: Haushalt zwischen den Personen', ['avd', 'basis', 'prv'].every(k => r.b[k].hh >= Math.min(...r.b[k].per) - 1e-9 && r.b[k].hh <= Math.max(...r.b[k].per) + 1e-9));
  check('IRR real ≈ nominal abzüglich Inflation', near((1 + r.b.etf.hh) / (1 + r.infl) - 1, r.br.etf.hh, 0.002), `${r.b.etf.hh} / ${r.br.etf.hh}`);
  check('Einkommensteuer je Produkt höchstens der Personenanteil', r.estSum > 0 && r.estSum <= r.est + 1e-6, `${r.estSum} / ${r.est}`);
  check('KVdR: keine KV auf AVD und private RV', r.kvOk);
  check('freiwillig: KV auf AVD und private RV zugeordnet', r.kvFw);
}

// 25. KV-Basis aus Kapitalerträgen: Bruttogewinn je Fonds statt pauschal /0,7
{
  check('KV-Basis tf 0', near(g('kvKapBase(1000, 1000, 0, 0, { kvTeilfreistellung: false })'), 1000, 1e-9));
  check('KV-Basis tf 0,15', near(g('kvKapBase(1000, 850, 200, 170, { kvTeilfreistellung: false })'), 1200, 1e-9));
  check('KV-Basis mit Teilfreistellung', near(g('kvKapBase(1000, 700, 200, 140, { kvTeilfreistellung: true })'), 840, 1e-9));
  check('KV-Basis nie negativ', g('kvKapBase(-500, -350, 0, 0, { kvTeilfreistellung: false })') === 0);
}

// 26. Kapitalsteuer genau einmal: Übergangsphase, Ablösung aus dem Depot, Ablösung im Entnahmejahr
{
  // Aufteilung der Kapitalsteuer und Nachweis der Zahlung: taxSale wird über den Verkauf saleX oder aus dem Ablösungserlös (taxFromHouse) bezahlt
  g(`var kapInv = rows => rows.every(r => Math.abs(r.kapTax - (r.kapTaxW + r.taxFromBudget + r.taxSale + r.houseTax)) <= 1 && r.saleX + r.taxFromHouse >= r.taxSale - 1);
  var simLoan = (fy, fm, f, amount = 120000, monthly = 700) => { const { I, A } = mk(f); I.loans = [{ ...loanTpl(fy - 10), amount, monthly, fixEndY: fy, fixEndM: fm, after: 'etf', sonderFrom: fy, sonderTo: fy }];
    return simulate(I, A, { scenario: 'A', targetReal: 3000, detail: true }); };`);
  // a) Übergangsphase: Person 2 erst mit 72 in Rente, Sparen bis zur ersten Rente (vorher blieben > 50 T€ Steuer unbezahlt)
  check('Kapitalsteuer: Invariante Übergangsphase', g(`(() => { const { I, A } = mk(I => { I.persons[1].retireAge = 72; I.saveUntil = 'first'; });
    return kapInv(simulate(I, A, { scenario: 'A', targetReal: 6000, detail: true }).rows); })()`));
  check('Kapitalsteuer: Invariante Beispielhaushalt', g(`(() => { const { I, A } = mk(null); return kapInv(simulate(I, A, { scenario: 'B', targetReal: 9000, detail: true }).rows); })()`));
  // b) Ablösung 2040 außerhalb der Entnahme: Steuer nur im Verkaufserlös, nicht noch einmal im Budget
  const b = g(`(() => { const s = simLoan(2040, 6); const r = s.rows.find(r => r.year === 2040); return { hs: s.houseSale, sale: r.houseSale, ht: r.houseTax, tb: r.taxFromBudget, kt: r.kapTax, inv: kapInv(s.rows) }; })()`);
  check('Ablösung: Steuer einmal', b.ht > 0 && near(b.sale - b.ht, b.hs.payoff, 1) && b.tb <= b.kt - b.ht + 1 && b.inv && near(b.hs.tax, b.ht, 1e-6), JSON.stringify(b));
  // b2) Ablösung 300.000 € 2040 wie im Brief (Kredit ab 2030): das Depot reicht nicht, Steuer genau einmal, der Rest läuft als Anschlussfinanzierung weiter
  const hsChk = `const hs = s.houseSale, r = s.rows.find(r => r.year === hs.year), n = s.rows.find(r => r.year === hs.year + 1);
    return { hs, sale: r.houseSale, ht: r.houseTax, th: r.taxFromHouse, ts: r.taxSale, x: r.saleX, tb: r.taxFromBudget, kt: r.kapTax, debt: r.debt, loanN: n.loanPay, inv: kapInv(s.rows) };`;
  const b2 = g(`(() => { const s = simLoan(2040, 6, null, 300000, 1350); ${hsChk} })()`);
  check('Ablösung 300.000 €: Steuer einmal, Rest Anschluss', b2.hs.covered < b2.hs.payoff - 1 && b2.inv && near(b2.hs.covered, b2.sale - b2.ht - b2.th, 1) && b2.tb <= b2.kt - b2.ht + 1
    && near(b2.debt, b2.hs.payoff - b2.hs.covered, (b2.hs.payoff - b2.hs.covered) * 0.05) && b2.loanN > 0, JSON.stringify(b2));
  // b3) Ablösung in der Übergangsphase (Sparbudget 0), Depot reicht nicht, ohne Freistellungsauftrag: die Steuer auf die Vorabpauschale kann nur
  //     aus dem Ablösungserlös bezahlt werden und erhöht die Anschlussfinanzierung (vorher blieb sie in taxSale unbezahlt)
  const b3 = g(`(() => { const s = simLoan(2065, 6, I => { I.persons[1].retireAge = 72; I.saveUntil = 'first'; I.budget = { monthly: 0, dyn: 0 };
    I.persons.forEach(p => { p.etf = { startValue: 7500, startCost: 3750, freistellung: 0 }; }); }, 300000, 1350); ${hsChk} })()`);
  check('Ablösung über Depot ohne Budget: Steuer aus dem Erlös, Rest Anschluss', b3.hs.covered < b3.hs.payoff - 1 && b3.ts > 0 && b3.tb === 0 && near(b3.th, b3.ts, 1) && b3.inv
    && near(b3.hs.covered, b3.sale - b3.ht - b3.th, 1) && near(b3.debt, b3.hs.payoff - b3.hs.covered, (b3.hs.payoff - b3.hs.covered) * 0.05), JSON.stringify(b3));
  // c) Ablösung im Jahr des Entnahmestarts, Monat vor wStartAbs (Oktober 2064)
  const c = g(`(() => { const s = simLoan(2064, 9); const r = s.rows.find(r => r.year === 2064); return { hs: s.houseSale, sale: r.houseSale, ht: r.houseTax, inv: kapInv([r]), ph: r.phase }; })()`);
  check('Ablösung im Entnahmejahr: Steuer auf G + houseG', c.ph === 'Entnahme' && c.ht > 0 && c.inv && near(c.sale - c.ht, c.hs.payoff, 1), JSON.stringify(c));
  // Review-Schwerpunkt 4: Ablösung in der Übergangsphase mit Budget 0 (Person 2 mit 72, Ablösung im ersten vollen Übergangsjahr 2065)
  const d = g(`(() => { const s = simLoan(2065, 6, I => { I.persons[1].retireAge = 72; I.saveUntil = 'first'; }); const r = s.rows.find(r => r.year === 2065);
    return { hs: s.houseSale, sale: r.houseSale, ht: r.houseTax, ts: r.taxSale, bud: r.budget, ph: r.phase, inv: kapInv(s.rows) }; })()`);
  check('Ablösung in der Übergangsphase: Invariante', d.ph === 'Übergang' && d.bud === 0 && d.inv && d.sale - d.ht >= d.hs.payoff - 1 && d.ts > 0, JSON.stringify(d));
}

// 27. Rentenfaktor nach Alter bei Rentenbeginn (Gompertz-Näherung, Rechnungszins 1 %)
{
  const rfr = a => g(`rfAt({ rf: 27, rfAge: 67 }, ${a}, 1997) / 27`);
  check('rf gilt im Bezugsalter', near(rfr(67), 1, 1e-12));
  check('rf mit 62 niedriger', rfr(62) > 0.82 && rfr(62) < 0.88, rfr(62));
  check('rf mit 70 höher', rfr(70) > 1.09 && rfr(70) < 1.15, rfr(70));
  // Lebenserwartung mit 65 (Jahrgang 1965) aus der Überlebensfunktion S(x,t) = exp(−e^((x−M)/b)·(e^(t/b)−1))
  const e65 = g(`(() => { const M = INS.mort.M, b = INS.mort.b; let e = 0; for (let t = 0; t < 60; t += 0.01) e += Math.exp(-Math.exp((65 - M) / b) * (Math.exp((t + 0.005) / b) - 1)) * 0.01; return e; })()`);
  check('Gompertz: Lebenserwartung 65 plausibel', e65 > 22 && e65 < 25, e65);
  // ohne rfAge (alter Stand) gilt 67
  check('rfAt ohne rfAge: Bezug 67', near(g('rfAt({ rf: 27 }, 67, 1997)'), 27, 1e-9));
}

// 28. Ewige Rente: verrentete Basisrente zählt weder am Anfang noch am Ende
{
  const per = ps => mn(`(I) => { I.withdraw.strategy = 'perpetual'; I.persons.forEach(p => { p.avd.on = false; p.basis.on = true; p.basis.beitrag = 4800; p.basis.payStart = ${ps}; }); }`);
  const p62 = per(62), p67 = per(67), p70 = per(70);
  check('Ewige Rente: kein Sprung 62 → 67', Math.abs(p62 - p67) / p67 < 0.05, `${p62} / ${p67}`);
  check('Ewige Rente: kein Sprung 67 → 70', Math.abs(p70 - p67) / p67 < 0.05, `${p70} / ${p67}`);
}

// 29. KV freiwillig: nur Monate ab Rentenbeginn, AVD-Teilkapital auf 1/120
{
  const kvAvd = (patch) => g(`(() => { const { I, A } = mk((I, A) => { I.persons.forEach(p => { p.kvdr = 'nein'; p.avd.on = true; }); (${patch})(I, A); });
    const rows = simulate(I, A, { scenario: 'B', targetReal: 5000, detail: true }).rows; const P = I.persons[0];
    const y0 = P.by + P.retireAge, y1 = P.by + P.avd.payStart;
    const at = y => { const r = rows.find(r => r.year === y); return { ...r.pp[0], pay: r.avdPay[0] }; }; return { a: at(y1), b: at(y1 + 1), c: at(y0), d: at(y0 + 1), y0, y1 }; })()`);
  // a) AVD ab 65, Rente ab 67 (bm 3 → Rentenbeginn April): im Rentenjahr nur 9 von 12 Monaten, davor beitragsfrei
  const a = kvAvd('(I) => { I.persons[0].avd.payStart = 65; }');
  check('KV: AVD vor Rentenbeginn beitragsfrei', a.a.kvBy.avd === 0 && a.b.kvBy.avd === 0 && near((a.c.kvBy.avd / a.c.pay) / (a.d.kvBy.avd / a.d.pay), 9 / 12, 0.03 * 0.75), JSON.stringify([a.a.kvBy, a.c.kvBy, a.d.kvBy]));
  // b) Teilkapital 30 %, Auszahlung ab Rentenbeginn: KV im ersten Jahr nicht ein Vielfaches des Folgejahrs
  const b = kvAvd('(I) => { I.persons[0].avd.teilkapital = 0.3; I.persons[0].avd.payStart = I.persons[0].retireAge; }');
  check('KV: AVD-Teilkapital 1/120', b.a.kvBy.avd > 0 && b.a.kvBy.avd / b.b.kvBy.avd < 1.3, JSON.stringify([b.a.kvBy, b.b.kvBy]));
}

// 30. Steuereinheiten: Zusammenveranlagung unverändert, Einzeltarif = Grundtarif
{
  const tp = (split, n = 0) => `{ split: ${split}, nKids: ${n}, kfbF: 1, kgF: 1, kist: 0, eb24b: 0 }`;
  check('incomeTax Splitting wie bisher', near(g(`incomeTax(60000, lawYear(2026, ASSUME), ${tp(true)}).est`), 8434.27, 1));
  check('incomeTax Einzeltarif = estGrund', near(g(`incomeTax(30000, lawYear(2026, ASSUME), ${tp(false)}).est`), 4217, 1));
  check('Soli-Freigrenze einzeln halbiert', g(`incomeTax(80000, lawYear(2026, ASSUME), ${tp(false)}).soli`) > 0);
  check('Soli: Splitting bei 80.000 frei', g(`incomeTax(80000, lawYear(2026, ASSUME), ${tp(true)}).soli`) === 0);
  const u = g(`(() => { const s = n => simCtx(mk(n).I, ASSUME, { scenario: 'B' }).units; return { two: s(null), sep: s(I => { I.married = false; }), one: s(I => { I.persons.length = 1; }) }; })()`);
  check('Steuereinheiten: verheiratet eine, sonst je Person', JSON.stringify(u) === JSON.stringify({ two: [{ idx: [0, 1], split: true }], sep: [{ idx: [0], split: false }, { idx: [1], split: false }], one: [{ idx: [0], split: false }] }), JSON.stringify(u));
  const tpY = g(`(() => { const { I, A } = mk(); const c = simCtx(I, A, { scenario: 'B' }); return yearBase(c, 2028).tp; })()`);
  const tpS = g(`(() => { const f = n => yearBase(simCtx(mk(n).I, ASSUME, { scenario: 'B' }), 2028).tp; return { sep: f(I => { I.married = false; }), one: f(I => { I.persons.length = 1; }) }; })()`);
  check('Steuerprofil einzeln: je die Hälfte, Einzelperson voll', tpS.sep.length === 2 && tpS.sep.every(t => !t.split && t.kfbF === 0.5 && t.kgF === 0.5) && tpS.one.length === 1 && tpS.one[0].kfbF === 1 && !tpS.one[0].split, JSON.stringify(tpS));
  check('Steuerprofil Ehepaar', tpY.length === 1 && tpY[0].split && tpY[0].kfbF === 1 && tpY[0].kgF === 1 && tpY[0].kist === 0 && tpY[0].eb24b === 0 && near(tpY[0].nKids, 1, 1e-9), JSON.stringify(tpY));
}

// 31. Zwei Depots: ein ETF-Depot je Person
{
  const ds = `const fd = [{ name: 'F', type: 'acc', tf: 0.3, ter: 0, divY: 0, from: 2027, to: 2099 }], ds = v => v.map(x => makeDepot({ funds: fd, startValue: x, startCost: x / 2, startYear: 2027 }));`;
  const s1 = g(`(() => { ${ds} return depotsSell(ds([6000, 4000]), 1000, 'newestFirst', true); })()`);
  check('depotsSell verteilt anteilig', near(s1.per[0].sold, 600, 1e-9) && near(s1.per[1].sold, 400, 1e-9) && near(s1.sold, 1000, 1e-9) && near(s1.gain, 500, 1e-9), JSON.stringify(s1));
  const s2 = g(`(() => { ${ds} const d = ds([0, 4000]); const r = depotsSell(d, 1000, 'newestFirst', false); return { r, v: d.map(depotValue) }; })()`);
  check('depotsSell: leeres Depot übernimmt das andere', s2.r.per[0].sold === 0 && near(s2.r.per[1].sold, 1000, 1e-9) && near(s2.v[1], 3000, 1e-9), JSON.stringify(s2));
  // Zeilen: etf = Summe der Personendepots, funds = Summe je Fonds über beide Depots
  const rw = g(`(() => { const { I, A } = mk(); return simulate(I, A, { scenario: 'B', targetReal: 9000, detail: true }).rows.map(r => [r.etf, r.pp[0].etf + r.pp[1].etf, sum(r.funds)]); })()`);
  check('Zeilen: etf = Σ pp.etf = Σ funds', rw.every(([a, b, c]) => near(a, b, 1e-6) && near(a, c, 1e-6)), '');
  // Einzelveranlagung: je Person höchstens der halbe Sparerpauschbetrag; Einzelperson ebenso
  const kp = g(`(() => { const f = n => { const { I, A } = mk(n); I.persons.forEach(p => { p.etf.startValue = 200000; p.etf.startCost = 100000; p.etf.freistellung = 2000; });
      return simulate(I, A, { scenario: 'A', targetReal: 1000, detail: true }).rows[1]; };
    return { sep: f(I => { I.married = false; }).kapTax, mar: f(null).kapTax }; })()`);
  check('kapTax: einzeln je Person halber Pauschbetrag (zusammen gleich)', kp.sep > 0 && near(kp.sep, kp.mar, 1), JSON.stringify(kp));
  // Sparrate nach share: alles an Person 1
  const sh = g(`(() => { const { I, A } = mk(I => { I.depot.share = 1; I.persons[1].etf.startValue = 0; I.persons[1].etf.startCost = 0; }); const r = simulate(I, A, { scenario: 'A', targetReal: 1000, detail: true }).rows[3]; return [r.pp[0].etf, r.pp[1].etf]; })()`);
  check('share 1: Person 2 bekommt keine Sparrate', sh[0] > 0 && sh[1] === 0, JSON.stringify(sh));
}

// 32. Unverheiratet: Einzelveranlagung je Person, Kindergeld an kgTo, Depots je Person
{
  // Splitting: Steuer in der Entnahme (Einkommen- und Kapitalsteuer, real je Monat) bei festem Zielnetto. Am maxNet zeigt sich der Vorteil kaum
  // (+5 € bei 20.000/80.000), weil die Lohnsteuer der Sparphase das feste Sparbudget nicht berührt und die § 10a-Erstattung einzeln höher ausfällt
  const um = (i1, i2, married) => g(`(() => { const { I, A } = mk(I => { I.married = ${married}; I.persons[0].income = ${i1}; I.persons[1].income = ${i2}; });
    const w = simulate(I, A, { scenario: 'B', targetReal: 9000, detail: true }).rows.filter(r => r.phase === 'Entnahme');
    return sum(w.map(r => (r.estW + r.kapTaxW) / r.priceIdx)) / sum(w.map(r => r.wMonths)); })()`);
  const s28 = um(20000, 80000, true), s28u = um(20000, 80000, false), s55 = um(50000, 50000, true), s55u = um(50000, 50000, false);
  check('Splittingvorteil bei ungleichem Einkommen', s28u > s28 + 50, `${s28} / ${s28u}`);
  check('Gleiche Einkommen: Splitting ≈ Einzeln', Math.abs(s55 - s55u) < 40, `${s55} / ${s55u}`);
  // Kinder: einzeln je Elternteil halber Kinderfreibetrag und halbes Kindergeld (§ 31 S. 4), unabhängig vom Kindergeldempfänger
  const tk = g(`(() => { const f = to => yearBase(simCtx(mk(I => { I.married = false; I.children[0].kgTo = to; }).I, ASSUME, { scenario: 'B' }), 2028).tp; return [f(0), f(1)]; })()`);
  check('Kinder einzeln: je Elternteil die Hälfte, kgTo ohne Einfluss', JSON.stringify(tk[0]) === JSON.stringify(tk[1]) && tk[0].every(t => t.kfbF === 0.5 && t.kgF === 0.5 && near(t.nKids, 1, 1e-9)), JSON.stringify(tk));
  check('kgTo: Standardwert und Prüfung beim Laden', g(`DEFAULTS.children[0].kgTo === 0 && loadState({ I: { children: [{ name: 'K', by: 2020, kgTo: 'x' }] } }).I.children[0].kgTo === 0`));
  // Kinderzulage (§ 85 EStG): unverheiratet beim Kindergeldempfänger kgTo, zulageTo gilt nur für Ehegatten
  const kz = g(`(() => { const f = m => { const { I, A } = mk(I => { I.married = m; I.children[0].kgTo = 1; I.children[0].zulageTo = 0; });
      return simulate(I, A, { scenario: 'B', targetReal: 5000, detail: true }).rows.find(r => r.year === 2028).pp.map(p => p.zul); };
    return { sep: f(false), mar: f(true) }; })()`);
  check('Kinderzulage unverheiratet an kgTo, verheiratet an zulageTo', near(kz.sep[1] - kz.sep[0], 300, 1e-6) && near(kz.mar[0] - kz.mar[1], 300, 1e-6), JSON.stringify(kz));
  // Verlustverrechnung zwischen Ehegatten: Verlustvortrag von Person 1 mindert die Erträge von Person 2 nur bei Zusammenveranlagung
  const lv = g(`(() => { const f = married => { const { I, A } = mk(I => { I.married = married; }); A.guenstiger = false; const c = simCtx(I, A, { scenario: 'A' }), y = yearBase(c, 2028);
      c.depots[0].lossCarry = 1000; const k = kapTaxUnits(c, y, [0, 3000], c.units.map(() => 0), c.units.map(() => ({ total: 0 }))); return { tax: k.tax, nl: k.newLossP }; };
    return { mar: f(true), sep: f(false) }; })()`);
  check('Verlustvortrag gepoolt (Ehepaar), getrennt (einzeln)', near(lv.mar.tax, 0, 1e-9) && lv.mar.nl.every(x => x === 0) && near(lv.sep.tax, 2000 * 0.26375, 1e-6) && lv.sep.nl[0] === 1000 && lv.sep.nl[1] === 0, JSON.stringify(lv));
  // Kapitalsteuer genau einmal, auch je Person: unverheiratet bzw. verheiratet, asymmetrische Depots, Übergangsphase und Ablösung aus dem Depot
  g(`var kapInvP = rows => rows.every(r => r.pp.every(p => Math.abs(p.kapTax - (p.kapTaxW + p.taxFromBudget + p.taxSale + p.houseTax)) <= 1));
  var asym = married => I => { I.married = married; I.persons[0].income = 20000; I.persons[1].income = 80000; I.depot.share = 0.2; I.persons[1].retireAge = 72; I.saveUntil = 'first';
    I.persons[0].etf = { startValue: 0, startCost: 0, freistellung: 500 }; I.persons[1].etf = { startValue: 40000, startCost: 20000, freistellung: 500 }; };`);
  for (const m of [false, true]) {
    const r = g(`(() => { const { I, A } = mk(asym(${m})); const rows = simulate(I, A, { scenario: 'B', targetReal: 6000, detail: true }).rows, l = simLoan(2040, 6, asym(${m})).rows;
      return { hh: kapInv(rows) && kapInv(l), pp: kapInvP(rows) && kapInvP(l), ts: sum(rows.map(r => r.taxSale)) + sum(l.map(r => r.houseTax)) }; })()`);
    check(`Kapitalsteuer einmal je Person (${m ? 'verheiratet' : 'unverheiratet'}, asymmetrisch)`, r.hh && r.pp && r.ts > 0, JSON.stringify(r));
  }
  // Review-Schwerpunkt 3: Depot von Person 1 leer und ohne Sparrate, unverheiratet: Entnahme aus Depot 2, kein vorzeitiger Fehlbetrag
  const ed = g(`(() => { const f = I => { I.depot.share = 0; I.persons[0].etf = { startValue: 0, startCost: 0, freistellung: 500 }; };
    const nm = maxNet(mk(f).I, ASSUME, 'A'), { I, A } = mk(I => { f(I); I.married = false; });
    const s = simulate(I, A, { scenario: 'A', targetReal: nm * 0.95, detail: true }), w = s.rows.filter(r => r.phase === 'Entnahme');
    return { nm, dep: s.depleted, e1: Math.max(...s.rows.map(r => r.pp[0].etf)), s2: sum(w.map(r => r.pp[1].etfSale)), last: w[w.length - 1].pp[1].etf }; })()`);
  check('Leeres Depot: Entnahme aus dem anderen', !ed.dep && ed.e1 === 0 && ed.s2 > 0, JSON.stringify(ed));
  // Review-Schwerpunkt 5: Laufzeit maxNet ≤ 200 ms (Mittel über 5 Läufe, verheiratet und unverheiratet)
  const ms = married => { mn(`(I) => { I.married = ${married}; }`); const t0 = Date.now(); for (let k = 0; k < 5; k++) mn(`(I) => { I.married = ${married}; }`); return (Date.now() - t0) / 5; };
  const msM = ms(true), msU = ms(false);
  const lim = process.env.CI ? 400 : 200;   // CI-Runner sind langsamer
  check(`maxNet ≤ ${lim} ms`, msM <= lim && msU <= lim, `verheiratet ${msM} ms, unverheiratet ${msU} ms`);
}

// 33. Person 2 optional, Alleinerziehende (§ 24b EStG)
{
  check('effI: Person 2 aus, Verweise auf Person 1', g(`(() => { const I = clone(DEFAULTS); I.person2On = false; I.children[0].zulageTo = 1; I.children[0].kgTo = 1; I.children[0].kezTo = 1; I.withdraw.refPerson = 1; const J = effI(I);
    return J.persons.length === 1 && !J.married && J.children[0].zulageTo === 0 && J.children[0].kgTo === 0 && J.children[0].kezTo === 0 && J.withdraw.refPerson === 0 && I.persons.length === 2 && I.married && I.children[0].kgTo === 1; })()`));
  check('effI: Person 2 an = Kopie', g(`(() => { const I = clone(DEFAULTS); const J = effI(I); return JSON.stringify(J) === JSON.stringify(I) && J !== I && DEFAULTS.person2On === true; })()`));
  const e1 = g(`(() => { const { I, A } = mk(I => { I.person2On = false; I.children[0].kgTo = 1; I.withdraw.refPerson = 1; }); const J = effI(I), c = simCtx(J, A, { scenario: 'B' }), y = yearBase(c, 2030);
    const s = simulate(J, A, { scenario: 'B', targetReal: 3000, detail: true }), L = y.L;
    return { n: c.units.length, split: c.units[0].split, tp: y.tp[0], rows: s.rows.length > 0, nan: s.rows.some(r => !isFinite(r.netWorth)), grund: incomeTax(50000, L, { split: false, nKids: 0, kfbF: 1, kgF: 1, kist: 0, eb24b: 0 }).est === estSingle(50000, L) }; })()`);
  check('Einzelperson: eine Einheit, Grundtarif, voller Kinderfreibetrag', e1.n === 1 && !e1.split && e1.tp.kfbF === 1 && e1.tp.kgF === 1 && e1.rows && !e1.nan && e1.grund, JSON.stringify(e1));
  // § 24b: 4.260 € für das erste Kind, 240 € je weiteres, je Monat mit Kindergeld ein Zwölftel; nur bei einer Person im Haushalt
  const eb = g(`(() => { const f = (mod, y, two) => { const { I, A } = mk(I => { I.person2On = two; mod(I); }); return yearBase(simCtx(effI(I), A, { scenario: 'B' }), y).tp[0].eb24b; };
    const one = I => { I.children = [{ name: 'K', by: 2025, bm: 5, kgUntil: 18, zulageTo: 0, kgTo: 0 }]; };
    const two = I => { I.children = [{ name: 'K', by: 2025, bm: 5, kgUntil: 18, zulageTo: 0, kgTo: 0 }, { name: 'L', by: 2030, bm: 7, kgUntil: 18, zulageTo: 0, kgTo: 0 }]; };
    const none = I => { I.children = []; };
    return { a: f(one, 2030, false), b: f(two, 2030, false), c: f(none, 2030, false), d: f(one, 2030, true), e: f(one, 2026, false) }; })()`);
  check('§ 24b: ein Kind', near(eb.a, 4260, 1e-9) && near(eb.e, 4260, 1e-9), JSON.stringify(eb));
  check('§ 24b: zweites Kind ab Juli', near(eb.b, 4260 + 240 * 6 / 12, 1e-9), JSON.stringify(eb));
  check('§ 24b: ohne Kind und mit Person 2 kein Abzug', eb.c === 0 && eb.d === 0, JSON.stringify(eb));
  const ta = g(`(() => { const L = lawYear(2030, ASSUME), t0 = { split: false, nKids: 1, kfbF: 1, kgF: 1, kist: 0, eb24b: 0 }, t1 = { ...t0, eb24b: 4260 };
    return [incomeTax(50000, L, t0).total, incomeTax(50000, L, t1).total, incomeTax(50000 - 4260, L, t0).total]; })()`);
  check('Alleinerziehend: § 24b senkt das zvE um 4.260 €', ta[1] < ta[0] && near(ta[1], ta[2], 1e-6), JSON.stringify(ta));
  check('Ausschalten und Einschalten stellt Person 2 wieder her', g(`(() => { const s = loadState({ I: { person2On: false, persons: [{ name: 'A' }, { name: 'X' }] } }).I; const J = effI(s); s.person2On = true; return J.persons.length === 1 && s.persons[1].name === 'X' && effI(s).persons[1].name === 'X'; })()`));
  check('person2On: alter Stand lädt mit Standard an', g(`loadState({ I: {} }).I.person2On === true`));
}

// 34. Kirchensteuer je Person (§ 51a EStG), Abgeltungsteuer mit Kirchensteuer (§ 32d Abs. 1 S. 3 EStG)
{
  check('kapRate ohne KiSt', near(g('kapRate(0)'), 0.26375, 1e-9));
  check('kapRate 9 %', near(g('kapRate(0.09)'), 0.279951, 1e-5));
  check('kapRate 8 %', near(g('kapRate(0.08)'), 0.278186, 1e-5));
  const kt = g(`(() => { const L = lawYear(2026, ASSUME), tp = { split: true, nKids: 1, kfbF: 1, kgF: 1, kist: 0.09, eb24b: 0 };
    let z = 60000, k = 0; for (let n = 0; n < 30; n++) { z = 60000 - k; k = 0.09 * estSplit(z - L.kfb, L); }
    const r = incomeTax(60000, L, tp), r0 = incomeTax(60000, L, { ...tp, kist: 0 });
    return { eng: r.kist, man: k, tot: r.total, tot0: r0.total, k0: r0.kist }; })()`);
  check('KiSt 9 % auf ESt nach Kinderfreibetrag', near(kt.eng, kt.man, 1) && kt.k0 === 0 && kt.tot > kt.tot0, JSON.stringify(kt));
  const nk = mn('(I) => { I.persons.forEach(p => p.kist = 0.09); }');
  // Ruling B5: Planschätzung 30–90, gemessen 93,26
  check('KiSt senkt das Netto um 30–120 €/Monat', GOLD.baseB - nk >= 30 && GOLD.baseB - nk <= 120, `baseB ${GOLD.baseB}, mit KiSt ${nk}`);
  // Abgeltungsteuer: Günstigerprüfung vergleicht mit ESt + Soli + KiSt; gepoolt mit verschiedener Konfession nach Anteil
  const kg = g(`(() => { const L = lawYear(2030, ASSUME), tp = { split: false, nKids: 0, kfbF: 1, kgF: 1, kist: 0.09, eb24b: 0 }, A = { guenstiger: true };
    const a = kapTax(10000, 0, L, 0, tp, A, 0, undefined, kapRate(0.09)), b = kapTax(10000, 0, L, 0, tp, { guenstiger: false }, 0, undefined, kapRate(0.09));
    return [a.tax, b.tax, a.guenstiger]; })()`);
  check('Günstigerprüfung mit KiSt: Steuer nie über Abgeltung inkl. KiSt', kg[0] <= kg[1] + 1e-9 && near(kg[1], 10000 * 0.279951, 0.1) && kg[2], JSON.stringify(kg));
  const mix = g(`(() => { const { I, A } = mk(I => { I.persons[0].kist = 0.09; I.persons[1].kist = 0; });
    const s = simulate(I, A, { scenario: 'B', targetReal: 6000, detail: true }), r = s.rows.find(x => x.phase === 'Entnahme');
    return { kist: r.kist, p0: r.pp[0].kist, p1: r.pp[1].kist, nan: s.rows.some(x => !isFinite(x.netWorth) || !isFinite(x.kist)) }; })()`);
  check('Zeilen: Kirchensteuer gemischt (Haushalt = Summe der Personen, nur eine zahlt)', mix.kist > 0 && mix.p1 === 0 && near(mix.p0, mix.kist, 1e-6) && !mix.nan, JSON.stringify(mix));
  check('kist: nur 0 / 0.08 / 0.09 gültig, sonst 0', g(`(() => { const f = v => loadState({ I: { persons: [{ kist: v }] } }).I.persons[0].kist; return f(0.5) === 0 && f(-0.09) === 0 && f('x') === 0 && f(0.08) === 0.08 && f('0.09') === 0.09 && f(0.09) === 0.09; })()`));
  check('Alter Stand ohne kist lädt mit 0', g(`loadState({ I: { persons: [{ name: 'A' }] } }).I.persons[0].kist === 0`));
}

// 35. Kindererziehungszeiten: Kind 05/2025, Renteninfo 01/2026 → 29 Monate offen (01/2026–05/2028)
{
  const kez = (inc) => g(`(() => { const { I, A } = mk(I => { I.children[0].kezTo = 0; I.persons[0].income = ${inc}; });
    const a = simulate(I, A, { scenario: 'A', targetReal: 5000 }).ep[0];
    const { I: J } = mk(I => { I.children = []; I.persons[0].income = ${inc}; }); return a - simulate(J, A, { scenario: 'A', targetReal: 5000 }).ep[0]; })()`);
  check('KEZ: rund 2,4 EP bei kleinem Einkommen', kez(20000) > 2.3 && kez(20000) < 2.45, kez(20000));
  check('KEZ: Kappung an der BBG', kez(150000) < 0.05, kez(150000));
  const pr = g(`(() => { const f = kids => { const { I, A } = mk(I => { I.persons[0].grvMode = 'prognose'; I.persons[0].grvPrognose = 1500; if (!kids) I.children = []; });
      const s = simulate(I, A, { scenario: 'A', targetReal: 5000, detail: true }), P = I.persons[0], y = Math.floor(retireStartAbs(P) / 12) + 1;
      return { grv: s.rows.find(r => r.year === y).grv[0], y, ref: grvYear(1, zugangsfaktor(P), y, retireStartAbs(P), A) }; };
    const a = f(true), b = f(false); return { d: a.grv - b.grv, ref: a.ref }; })()`);
  check('KEZ: Prognose-Modus addiert ohne Kappung (29/12 EP)', near(pr.d / pr.ref, 29 / 12, 29 / 12 * 0.03), JSON.stringify(pr));
  const nop = (inc) => g(`(() => { const f = kids => { const { I, A } = mk(I => { I.persons[0].rvPflicht = false; I.persons[0].income = ${inc}; if (!kids) I.children = []; });
    return simulate(I, A, { scenario: 'A', targetReal: 5000 }).ep[0]; }; return f(true) - f(false); })()`);
  check('KEZ: ohne Pflichtbeiträge genau 29/12 EP', near(nop(20000), 29 / 12, 1e-9), nop(20000));
  check('KEZ: ohne Pflichtbeiträge über der BBG ebenfalls 29/12 EP', near(nop(150000), 29 / 12, 1e-9), nop(150000));
  check('KEZ: Person 2 bekommt die Zeiten bei kezTo = 1, Person 1 nichts', g(`(() => { const { I, A } = mk(I => { I.children[0].kezTo = 1; I.persons[0].income = 20000; I.persons[1].income = 20000; });
    const e = simulate(I, A, { scenario: 'A', targetReal: 5000 }).ep, { I: J } = mk(I => { I.children = []; I.persons[0].income = 20000; I.persons[1].income = 20000; });
    const e0 = simulate(J, A, { scenario: 'A', targetReal: 5000 }).ep; return Math.abs(e[0] - e0[0]) < 1e-9 && Math.abs(e[1] - e0[1] - 29 / 12) < 0.05; })()`));
}

// 36. Regelaltersgrenze und Altersentlastungsbetrag
{
  check('RAG 1960: 66 J. 4 M.', g('ragMonths(1960)') === 66 * 12 + 4);
  check('RAG 1958: 65 J. 12 M. = 66 J.', g('ragMonths(1958)') === 66 * 12);
  check('RAG ab 1964: 67 J.', g('ragMonths(1970)') === 67 * 12);
  check('Zugangsfaktor 1960 mit 66', near(g('zugangsfaktor({ by: 1960, retireAge: 66 })'), 1 - 0.012, 1e-12));
  check('§ 24a 2026: 12,8 % / 608 €', (() => { const a = g('LAW.altEntl(2026)'); return near(a.pct, 0.128, 1e-12) && a.max === 608; })());
  check('§ 24a 2058: 0', g('LAW.altEntl(2058)').max === 0 && g('LAW.altEntl(2058)').pct === 0);
  check('§ 24a 2005: 40 % / 1.900 €', (() => { const a = g('LAW.altEntl(2005)'); return near(a.pct, 0.4, 1e-12) && a.max === 1900; })());
  const ae = g(`(() => { const L = lawYear(2026, ASSUME), w = { g: 10000, m: 12 }, f = by => earnedTaxable({ by, job: 'self' }, w, L);
    return { a: f(1961), b: f(1962), c: f(1960) }; })()`);
  check('§ 24a: ab dem Jahr nach dem 64. Geburtstag (1961 → 2026), 1962 noch nicht, 1960 mit 627 €', near(ae.a, 10000 - 608, 1e-9) && ae.b === 10000 && near(ae.c, 10000 - 627, 1e-9), JSON.stringify(ae));
}

// 37. Kaufkraft 2026, Presets
{
  check('BASE_YEAR 2026', g('BASE_YEAR') === 2026);
  check('priceIdx 2027 = 1,02 (erste Zeile, Start 2027)', near(g(`(() => { const { I, A } = mk(); return simulate(I, A, { scenario: 'B', targetReal: 5000, detail: true }).rows[0].priceIdx; })()`), 1.02, 1e-9));
  check('priceIdx 2028 = 1,02² bei Start 2028', near(g(`(() => { const { I, A } = mk(I => { I.startYear = 2028; }); return simulate(I, A, { scenario: 'B', targetReal: 5000, detail: true }).rows[0].priceIdx; })()`), 1.02 * 1.02, 1e-9));
  check('Preset-Dynamik 1,5 %', g('INS_PRESETS.provision.rentDyn') === 0.015 && g('INS_PRESETS.netto.rentDyn') === 0.015);
  const n0 = mn(null), n1 = mn('I => { I.startYear = 2028; }');
  check('startYear 2028 statt 2027: Netto ähnlich', Math.abs(n1 - n0) / n0 < 0.05, `${n0} / ${n1}`);
}

// 38. Inflation im Pfad wirkt auf alle nominalen Größen (Tarif, Kinder, SV-Grenzen, Rentenwert, Einkommen, Budget, PKV), Inflation als AR(1)
{
  const P = infl => `Array.from({ length: horizonYears(I) + 1 }, () => ({ R: A.ret, infl: ${infl} }))`;
  const nDet = mn(null), nKon = g(`(() => { const { I, A } = mk(); return maxNet(I, A, 'B', ${P('A.inflation')}); })()`);
  check('Konstanter Pfad = deterministisch', near(nKon, nDet, 0.5), `${nKon} / ${nDet}`);
  // reale GRV im ersten vollen Entnahmejahr: Basis gegen Pfad mit 4 % Inflation (Lohnabstand bleibt 1 Pp.)
  const grvR = path => g(`(() => { const { I, A } = mk(); const rows = simulate(I, A, { scenario: 'B', targetReal: 5000, detail: true, path: ${path} }).rows;
    const r = rows.find(x => x.wMonths === 12); return r.grv.reduce((a, b) => a + b, 0) / r.priceIdx; })()`);
  const g0 = grvR('undefined'), g4 = grvR(P(0.04));
  check('Hohe Inflation senkt die reale GRV nicht künstlich', Math.abs(g4 / g0 - 1) < 0.03, `${g4.toFixed(0)} / ${g0.toFixed(0)}`);
  // Einkommen (über die Entgeltpunkte) und Budget wachsen mit der Pfad-Inflation, der Steuertarif ab 2029 mit dem Pfad-Preisindex
  const rw = path => g(`(() => { const { I, A } = mk(), path = ${path}, rows = simulate(I, A, { scenario: 'B', targetReal: 5000, detail: true, path }).rows, r = rows[10], r0 = rows[3];
    const ix = path ? simCtx(I, A, { scenario: 'B', path }).ix : null, gfb = y => { const L = lawYear(y, A, ix); return L.p.gfb * L.idx; };
    return { ep: r.ep[0], b: r.budget / r.priceIdx, gfb: gfb(r.year) / gfb(r0.year), pi: r.priceIdx / r0.priceIdx }; })()`);
  const w0 = rw('undefined'), w4 = rw(P(0.04));
  check('Pfad-Inflation: gleiche Entgeltpunkte, reales Budget gleich, Tarif wächst mit dem Preisindex', near(w4.ep / w0.ep, 1, 1e-9) && near(w4.b / w0.b, 1, 1e-9) && near(w4.gfb, w4.pi, 1e-9) && near(w0.gfb, w0.pi, 1e-9) && w4.pi > w0.pi * 1.1, JSON.stringify([w0, w4]));
  const ac = g(`(() => { const A = { ...ASSUME }, ps = makePaths(200, 60, A, 1); let sxy = 0, sxx = 0;
    for (const p of ps) for (let t = 1; t < p.length; t++) { const x = p[t - 1].infl - A.inflation, y = p[t].infl - A.inflation; sxy += x * y; sxx += x * x; }
    return sxy / sxx; })()`);
  check('AR(1): Autokorrelation der Pfad-Inflation ≈ 0,6', ac > 0.5 && ac < 0.7, ac.toFixed(3));
  check('inflPhi 0,6 in ASSUME', g('ASSUME.inflPhi') === 0.6);
}

// 39. Entnahme zur Jahresmitte: Verkäufe zum Zeitpunkt t (Entnahme Mitte der Entnahmemonate), AVD-Auszahlung mit Rendite bis zur Mitte der Auszahlungsmonate
{
  const fund = { name: 'F', type: 'acc', tf: 0.3, ter: 0, divY: 0, from: 2027, to: 2099 };
  const d = E.makeDepot({ funds: [fund], startValue: 100000, startCost: 100000, startYear: 2027 });
  const o = E.depotYear(d, 2027, 0.07, 0, 0, { buyT: 0.5, vpFracNew: 0.5, sell: { gross: 10000, mode: 'newestFirst', t: 0.5 } });
  const soll = (100000 - 10000 / Math.pow(1.07, 0.5)) * 1.07, ist = g('depotValue')(d);
  check('depotYear: Verkauf zur Jahresmitte', near(ist, soll, 1) && near(o.sold, 10000, 1e-6), `${ist.toFixed(2)} statt ${soll.toFixed(2)}`);
  // Zwei Depots je 100 zu Jahresbeginn, Kurs halbiert bis t = 1: Depot 1 soll 80 abgeben, hat aber nur 50, den Rest übernimmt Depot 2
  const pl = g(`(() => { const f = [{ name: 'F', type: 'acc', tf: 0, ter: 0, divY: 0, from: 2027, to: 2099 }], ds = [0, 1].map(() => makeDepot({ funds: f, startValue: 100, startCost: 100, startYear: 2027 }));
    return depotsSellPlan(ds, -0.5, [{ gross: 80, t: 1 }], [1, 0]).map(x => x.map(s => s.gross)); })()`);
  check('Verkaufsplan: Rest aus dem anderen Depot, wenn eins zum Zeitpunkt t nicht reicht', near(pl[0][0], 50, 1e-9) && near(pl[1][0], 30, 1e-9), JSON.stringify(pl));
  const av = g(`(() => { const a = makeAVD(); a.fv = 60000; a.uv = 30000; a.uCost = 20000; avdGrowPaid(a, 0.07, 0, 10000, 0.5); return a; })()`);
  const x = 10000 * (Math.pow(1.07, 0.5) - 1);
  check('avdGrowPaid: Rest mit Jahresrendite plus Rendite des Ausgezahlten bis t', near(av.fv, 60000 * 1.07 + x * 2 / 3, 1e-6) && near(av.uv, 30000 * 1.07 + x / 3, 1e-6) && av.uCost === 20000, JSON.stringify(av));
  const nA = mn(null, 'A');
  check('Nur ETF: Netto steigt um 1–5 %', nA / 9118 - 1 >= 0.01 && nA / 9118 - 1 <= 0.05, `${nA.toFixed(0)} gegen 9118 (Stand nach C1)`);
}

// 40. Grenzsteuer: Einkommensteuer je Produkt gestapelt (GRV, AVD, Basisrente, private RV), Reinvestition vor dem Entnahmestart ohne Pauschalabzug
{
  const tp = `{ split: true, nKids: 1, kfbF: 1, kgF: 1, kist: 0.09, eb24b: 0 }`, L = `lawYear(2026, ASSUME)`;
  const mt = g(`marginalTax(60000, ${L}, ${tp}, [20000, 5000, 3000])`), dT = g(`incomeTax(60000, ${L}, ${tp}).total - incomeTax(32000, ${L}, ${tp}).total`);
  check('marginalTax summiert zur Differenz', mt.length === 3 && near(mt[0] + mt[1] + mt[2], dT, 1e-6) && mt[2] / 3000 >= mt[0] / 20000, `${JSON.stringify(mt)} / ${dT}`);
  const rv = g(`(() => { const { I, A } = mk(I => { I.persons.forEach(p => { p.income = 0; p.kvdr = 'ja'; }); I.persons[0].avd.payStart = 65; });
    const r = simulate(I, A, { scenario: 'B', targetReal: 3000, detail: true }).rows.find(r => r.year === I.persons[0].by + 66); return { re: r.pp[0].avdReinvest, pay: r.avdPay[0], w: r.avdPayW[0], est: r.est }; })()`);
  check('Ohne Steuer und KV: Reinvestition = Auszahlung', rv.pay > 1000 && rv.w === 0 && rv.est === 0 && near(rv.re, rv.pay, 1), JSON.stringify(rv));
  // Basisrente liegt über GRV und AVD: Grenz- statt Durchschnittssteuer senkt ihre Rendite (vorher 4,529 %, Setup wie Block 24)
  const bh = g(`(() => { const { I, A } = mk(I => I.persons.forEach(p => { p.basis.on = true; p.basis.beitrag = 3000; p.prv.on = true; p.prv.beitrag = 1800; }));
    return productIRR(simulate(I, A, { scenario: 'B', targetReal: 8000, detail: true }), I, false).basis.hh; })()`);
  check('Basisrente: IRR sinkt gegenüber Durchschnittszuordnung', bh < 0.045294 - 1e-4, bh);
  // Review-Schwerpunkt 5: Laufzeit maxNet ≤ 200 ms, auch mit AVD-Auszahlung vor dem Entnahmestart (Grenzsteuer in der Reinvestition)
  const ms = p => { mn(p); const t0 = Date.now(); for (let k = 0; k < 5; k++) mn(p); return (Date.now() - t0) / 5; };
  const msD = ms(null), msP = ms(`(I) => { I.persons[0].avd.payStart = 65; }`);
  const lim = process.env.CI ? 400 : 200;   // CI-Runner sind langsamer
  check(`maxNet ≤ ${lim} ms nach C4`, msD <= lim && msP <= lim, `Standard ${msD} ms, AVD ab 65 ${msP} ms`);
}

// 41. Gesamtreview: Beitrags-EP zwischen Stand der Renteninfo und Rechnungsbeginn (EP-Modus), auch ohne Kinder; Prognose-Modus unverändert
{
  const epAt = (sy, patch) => g(`(() => { const { I, A } = mk(I => { I.startYear = ${sy}; (${patch})(I); }); return simulate(I, A, { scenario: 'B', targetReal: 3000, detail: true }).rows.find(r => r.year === 2030).ep; })()`);
  for (const [nm, pt] of [['mit Kindern', 'I => {}'], ['ohne Kinder', 'I => { I.children = []; }']]) {
    const a = epAt(2026, pt), b = epAt(2027, pt);
    check(`EP-Modus ${nm}: Start 2027 statt 2026 ändert die EP 2030 nicht`, a.every((v, i) => near(v, b[i], 1e-6)), `${JSON.stringify(a)} / ${JSON.stringify(b)}`);
  }
  const nb = epAt(2028, 'I => { I.persons[1].rvPflicht = false; }'), na = epAt(2026, 'I => { I.persons[1].rvPflicht = false; }');
  check('Ohne Pflichtbeiträge: nur Erziehungszeiten nachgetragen', near(nb[1], na[1], 1e-6), `${JSON.stringify(na)} / ${JSON.stringify(nb)}`);
  // Rentenbeginn vor Rechnungsbeginn: Beitrags-EP nur bis Rentenbeginn
  const rr = g(`(() => { const { I, A } = mk(I => { I.children = []; I.persons[0].riY = 2026; I.startYear = 2027; I.persons[0].by = 2026 - I.persons[0].retireAge; I.persons[0].bm = 6; }); const c = simCtx(I, A, { scenario: 'B' }); return [c.ep[0], I.persons[0].epNow, retireStartAbs(I.persons[0]) - 2026 * 12]; })()`);
  check('Rentenbeginn vor Rechnungsbeginn: Beitrags-EP nur bis Rentenbeginn', rr[0] > rr[1] && rr[2] > 0 && rr[2] < 12, JSON.stringify(rr));
}

// 42. Stand der Renteninfo im oder nach dem Startjahr: Beitrags-EP nicht doppelt
{
  const ep = (y, m) => g(`(() => { const { I, A } = mk(I => { I.children = []; I.persons[0].riY = ${y}; I.persons[0].riM = ${m}; }); return simulate(I, A, { scenario: 'A', targetReal: 5000 }).ep[0]; })()`);
  const e26 = ep(2026, 1), e27 = ep(2027, 1), e27h = ep(2027, 7), e28 = ep(2028, 1);
  check('Renteninfo 2027: ein Jahr weniger als 2026', near(e26 - e27, 0.77, 0.02), `${e26} / ${e27}`);
  check('Renteninfo 07/2027: halbes Jahr weniger als 01/2027', near(e27 - e27h, (e26 - e27) * 1.03 / 2, 0.02), `${e27} / ${e27h}`);
  check('Renteninfo 2028: zwei Jahre weniger als 2026', e28 < e27h && near(e26 - e28, 0.77 + 0.77 * 1.03 * 51944 / 53452, 0.03), `${e26} / ${e28}`);
}

console.log(`${ok} Prüfungen bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
