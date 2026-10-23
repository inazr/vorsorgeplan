// ═══════════════════════════════════════════════════════════════
// VERSICHERUNGEN je Person: Basisrente (Rürup) und private Rentenversicherung (fondsgebunden)
// Kosten wie im Produktinformationsblatt (§ 2a AltZertG, § 7 AltvPIBV):
//   akv        Abschluss- und Vertriebskosten, % der Beitragssumme (auf 5 Jahre verteilt) und % je Zuzahlung
//   vkBeitrag  Verwaltungskosten, % der Beiträge
//   vkFix      Verwaltungskosten, € pro Jahr (Ansparphase)
//   vkKapital  Verwaltungskosten, % des gebildeten Kapitals pro Jahr
//   ter        Fondskosten pro Jahr
//   rk         Kosten der Rentenphase, % der Rente
//   rf         Rentenfaktor: Monatsrente je 10.000 € Kapital bei Rentenbeginn
//   rentDyn    jährliche Rentensteigerung aus Überschüssen
// ═══════════════════════════════════════════════════════════════
const INS = {
  basisMinAge: 62,                 // Basisrente frühestens ab 62 (Verträge ab 2012, § 10 Abs. 1 Nr. 2 b EStG)
  halfAge: 62, halfYears: 12,      // Hälftelung bei Kapitalauszahlung (§ 20 Abs. 1 Nr. 6 S. 2, § 52 Abs. 28 S. 7 EStG)
  fondsFrei: 0.15,                 // fondsgebundene Versicherung: 15 % des Unterschiedsbetrags steuerfrei (§ 20 Abs. 1 Nr. 6 S. 9)
  akvMonths: 60,                   // Abschlusskosten verteilt auf die ersten 5 Jahre (§ 169 Abs. 3 VVG)
  kvLumpMonths: 120,               // Kapitalauszahlung: freiwillig Versicherte zahlen 10 Jahre lang auf 1/120 (Annahme analog § 229 SGB V)
};
// Versicherungsprodukte: Steuer der Rente (Besteuerungsanteil nach Kohorte § 22 Nr. 1 S. 3 a aa oder Ertragsanteil bb EStG),
// Kapitaloption, Sonderausgabenabzug (§ 10 Abs. 1 Nr. 2 b EStG). Reihenfolge bleibt fest (Summen in dieser Reihenfolge).
const POLICY_DEF = {
  basis: { rentTax: 'kohorte', lump: false, deduct: true },
  prv:   { rentTax: 'ertragsanteil', lump: true, deduct: false },
};
const POLICIES = Object.keys(POLICY_DEF);
// Ausgezahlter Kapitalanteil bei Rentenbeginn (nur Produkte mit Kapitaloption)
const teilOf = (cfg, k) => POLICY_DEF[k].lump ? (cfg.mode === 'kapital' ? 1 : cfg.mode === 'teil' ? cfg.teil : 0) : 0;

// Kostenvorlagen (typische Werte aus Muster-PIBs und Tarifvergleichen 2025/2026)
const INS_PRESETS = {
  provision: { akv: 0.025, vkBeitrag: 0.05, vkFix: 0, vkKapital: 0.005, ter: 0.002, rk: 0.015, rf: 27, rentDyn: 0.005 },
  netto: { akv: 0, vkBeitrag: 0.015, vkFix: 36, vkKapital: 0.003, ter: 0.002, rk: 0.015, rf: 29, rentDyn: 0.005 },
};

// Ertragsanteil der Leibrente nach Alter bei Rentenbeginn (§ 22 Nr. 1 S. 3 a bb EStG), ab 50 Jahren
const ERTRAGSANTEIL = [[50, 30], [51, 29], [53, 28], [54, 27], [55, 26], [57, 25], [58, 24], [59, 23], [60, 22], [62, 21], [63, 20], [64, 19], [65, 18],
  [67, 17], [68, 16], [69, 15], [71, 14], [72, 13], [74, 12], [75, 11], [76, 10], [78, 9], [80, 8], [81, 7], [83, 6], [85, 5], [88, 4], [92, 3], [94, 2], [97, 1]];
function ertragsanteil(age) {
  let v = 30;
  for (const [a, p] of ERTRAGSANTEIL) if (age >= a) v = p;
  return v / 100;
}

function makePolicy() { return { K: 0, paid: 0, cost: 0, paying: false, rentM: 0, startY: null, lump: 0, gain: 0 }; }

// Ein Jahr Ansparphase über mG Monate: Beitrag c (Monate 0 … cM), Zuzahlung z am Jahresanfang,
// Kosten aus dem Beitrag, Kapitalkosten aus der Rendite. alphaY = Abschlusskosten dieses Jahres in €.
function policySaveYear(pol, cfg, R, { c, cM, z, alphaY, feeM, mG }) {
  const g = R - cfg.ter - cfg.vkKapital;
  const f = t => Math.pow(Math.max(0.01, 1 + g), t);
  const fee = c * cfg.vkBeitrag + alphaY + z * (cfg.akv + cfg.vkBeitrag) + cfg.vkFix * feeM / 12;
  const k0 = pol.K;
  // Beiträge im Mittel zur Mitte der Beitragsmonate, Zuzahlung zu Jahresbeginn
  pol.K = Math.max(0, k0 * f(mG / 12) + (c - c * cfg.vkBeitrag - alphaY) * f((mG - cM / 2) / 12) + z * (1 - cfg.akv - cfg.vkBeitrag) * f(mG / 12) - cfg.vkFix * feeM / 12);
  pol.paid += c + z;
  pol.cost += fee + (k0 + (c + z) / 2) * (cfg.ter + cfg.vkKapital) * mG / 12;
}

// Rentenbeginn: Kapital in eine lebenslange Monatsrente umwandeln (teil = ausgezahlter Kapitalanteil)
function policyAnnuitize(pol, cfg, year, teil = 0) {
  const share = Math.min(1, Math.max(0, teil));
  pol.lump = pol.K * share;
  pol.gain = Math.max(0, pol.K - pol.paid) * share;   // Ertragsanteil der Kapitalauszahlung (Beiträge anteilig angerechnet)
  pol.rentM = pol.K * (1 - share) / 10000 * cfg.rf;
  pol.K = 0; pol.paying = true; pol.startY = year;
}
// Rentenzahlung im Jahr für m Monate (nach Kosten der Rentenphase)
function policyRent(pol, cfg, year, m) {
  if (!pol.paying || m <= 0 || pol.rentM <= 0) return 0;
  return pol.rentM * Math.pow(1 + (cfg.rentDyn || 0), year - pol.startY) * m * (1 - cfg.rk);
}

// Effektivkosten wie im Produktinformationsblatt: Renditeminderung bis Rentenbeginn in Prozentpunkten
function policyEffCost(cfg, years, R) {
  if (!(years > 0) || !(cfg.beitrag > 0)) return null;
  const pol = makePolicy(), n = Math.round(years), alphaTot = cfg.akv * cfg.beitrag * n;
  for (let t = 0; t < n; t++) policySaveYear(pol, cfg, R, { c: cfg.beitrag, cM: 12, z: 0, alphaY: t < 5 ? alphaTot / Math.min(5, n) : 0, feeM: 12, mG: 12 });
  const fv = r => { let s = 0; for (let t = 0; t < n; t++) s += cfg.beitrag * Math.pow(1 + r, n - t - 0.5); return s; };
  let lo = -0.5, hi = R + 0.05;
  for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (fv(m) < pol.K) lo = m; else hi = m; }
  return { eff: R - (lo + hi) / 2, K: pol.K, cost: pol.cost };
}
