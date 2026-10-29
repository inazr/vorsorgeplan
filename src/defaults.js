// ═══════════════════════════════════════════════════════════════
// STANDARDWERTE (Beispielhaushalt, alle Werte in der Oberfläche änderbar)
// Zwei Personen, beide 30 Jahre, ein Kind mit 2 Jahren
// ═══════════════════════════════════════════════════════════════
const DEFAULTS = {
  startYear: 2027,
  person2On: true,   // false: Alleinstehend bzw. alleinerziehend, Person 2 wird nicht gerechnet (ihre Eingaben bleiben erhalten)
  married: true,   // zusammen veranlagt (Splitting), sonst Einzelveranlagung je Person
  persons: [
    { name: 'Person 1', by: 1997, bm: 3, retireAge: 67, kist: 0, job: 'employee', income: 40000, incomeGrowth: 0.03,
      rvPflicht: true, grvMode: 'ep', grvPrognose: 0, grvRwInfo: SV.rw[2026], epNow: 6, riY: 2026, riM: 1,
      kvdr: 'auto', firstWork: 2019, pkvYearsSecondHalf: 0, krankengeld: true, pkvPremium: 600, pkvGrowth: 0.03, pkvRelief: 120, pkvBasis: 0.85,
      avd: { on: true, eigen: 1800, extra: 0, payStart: 67, payEnd: 85, teilkapital: 0, cost: 0, ter: 0.002, refundTo: 'same' },
      basis: { on: false, beitrag: 2400, payStart: 67, rfAge: 67, refundTo: 'same', ...INS_PRESETS.provision },
      prv: { on: false, beitrag: 1200, payStart: 67, rfAge: 67, mode: 'rente', teil: 0.3, ...INS_PRESETS.provision },
      etf: { startValue: 5000, startCost: 4500, freistellung: 1000 } },   // eigenes ETF-Depot: Bestand, Einstandswert, Freistellungsauftrag
    { name: 'Person 2', by: 1997, bm: 9, retireAge: 67, kist: 0, job: 'employee', income: 60000, incomeGrowth: 0.03,
      rvPflicht: true, grvMode: 'ep', grvPrognose: 0, grvRwInfo: SV.rw[2026], epNow: 8, riY: 2026, riM: 1,
      kvdr: 'auto', firstWork: 2019, pkvYearsSecondHalf: 0, krankengeld: true, pkvPremium: 600, pkvGrowth: 0.03, pkvRelief: 120, pkvBasis: 0.85,
      avd: { on: true, eigen: 1800, extra: 0, payStart: 67, payEnd: 85, teilkapital: 0, cost: 0, ter: 0.002, refundTo: 'same' },
      basis: { on: false, beitrag: 2400, payStart: 67, rfAge: 67, refundTo: 'same', ...INS_PRESETS.provision },
      prv: { on: false, beitrag: 1200, payStart: 67, rfAge: 67, mode: 'rente', teil: 0.3, ...INS_PRESETS.provision },
      etf: { startValue: 5000, startCost: 4500, freistellung: 1000 } },   // eigenes ETF-Depot: Bestand, Einstandswert, Freistellungsauftrag
  ],
  children: [{ name: 'Kind', by: 2025, bm: 5, kgUntil: 18, zulageTo: 0, kgTo: 0, kezTo: 0 }],   // kgTo: Kindergeldempfänger, kezTo: Elternteil mit Erziehungszeit
  budget: { monthly: 1000, dyn: 0.02 },
  loans: [],
  depot: {
    share: 0.5, nFunds: 3,   // share: Anteil von Person 1 an ETF-Sparrate und Überschüssen der Entnahme
    sellMode: 'newestFirst', divRedirect: true,
    funds: [
      { name: 'MSCI World (aussch.)', type: 'dist', tf: 0.3, ter: 0.002, divY: 0.018, from: 2027, to: 2039 },
      { name: 'FTSE All-World (thes.)', type: 'acc', tf: 0.3, ter: 0.0019, divY: 0, from: 2040, to: 2051 },
      { name: 'MSCI ACWI (thes.)', type: 'acc', tf: 0.3, ter: 0.002, divY: 0, from: 2052, to: 2064 },
    ],
  },
  saveUntil: 'first',
  withdraw: { strategy: 'realConst', targetAge: 95, refPerson: 0, fixedNet: 2500, fixedIndexed: true },
};

const ASSUME = {
  ret: 0.07, vol: 0.16, inflation: 0.02, inflVol: 0.01, inflPhi: 0.6,   // inflPhi: Autokorrelation der Inflation im Monte Carlo (AR(1))
  wageGrowth: 0.03, rentenDaempfung: 0.004,
  basiszins: 0.032, indexTariff: true, useDraft: true, guenstiger: true,
  zusatz: 0.029, zusatzDrift: 0.0003, pvDrift: 0.0002,
  kvTeilfreistellung: false,
  mcRuns: 200, optMode: 'fast', optQ: 0.1,   // Optimierer: schnell (feste Rendite) oder Monte Carlo (Perzentil)
};
