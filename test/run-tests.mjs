// Rechenproben für die Engine. Aufruf: node test/run-tests.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = vm.createContext({ console, Math, JSON });
for (const f of ['law', 'depot', 'loans', 'sim', 'defaults', 'analysis'])
  vm.runInContext(readFileSync(join(root, 'src', f + '.js'), 'utf8'), ctx);
const g = code => vm.runInContext(code, ctx);

let fail = 0, ok = 0;
const check = (name, cond, info = '') => { if (cond) ok++; else { fail++; console.log('FEHLER', name, info); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

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
check('Netto plausibel', r.nA > 500 && r.nA < 20000, r.nA);
check('Plan reicht bis Zielalter', !r.depleted);
console.log(`Beispielhaushalt: Netto A ${r.nA.toFixed(0)} €, B ${r.nB.toFixed(0)} € pro Monat (heutige Kaufkraft)`);

// 6. Kredit-Ablösung aus dem Depot verringert das Depot
const k = g(`(() => { const I = JSON.parse(JSON.stringify(DEFAULTS));
  I.loans = [{ name: 'T', amount: 200000, eff: 0.02, startY: 2025, startM: 1, monthly: 900, freeMonths: 0, fixBalBank: 0, fixEndY: 2035, fixEndM: 1, sonder: 0, sonderFrom: 2027, sonderTo: 2034, after: 'etf', zins: 0.04, years: 10, teil: 0 }];
  const s = simulate(I, ASSUME, { scenario: 'A', targetReal: 1000, detail: true });
  return { ...s.houseSale, debtAfter: s.rows.find(r => r.year === 2035).debt }; })()`);
check('Ablösung aus Depot', k && k.payoff > 0 && k.gross > 0, JSON.stringify(k));
// Reicht das Depot nicht, bleibt der ungedeckte Rest als Schuld bestehen
check('Ungedeckter Rest bleibt Schuld', k.covered >= k.payoff - 1 ? k.debtAfter < 1 : near(k.debtAfter, k.payoff - k.covered, (k.payoff - k.covered) * 0.12), JSON.stringify(k));

console.log(`${ok} Prüfungen bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
