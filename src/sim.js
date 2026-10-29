// ═══════════════════════════════════════════════════════════════
// JAHRESSIMULATION: eine Engine für Einzelrechnung, Optimierer und Monte Carlo
// ═══════════════════════════════════════════════════════════════
const SV = { // Sozialversicherung, Basisjahr 2026 (G), Fortschreibung mit Lohnentwicklung
  kgAbzug: 0.04,                             // Abschlag bei Anspruch auf Krankengeld, § 10 Abs. 1 Nr. 3 S. 4 EStG
  // 2027: Kabinett 7.10.2026, Bundesrat ausstehend (Status E)
  bbgRV: { 2026: 101400, 2027: { v: 106200, st: 'E' } },
  bbgKV: { 2026: 69750, 2027: { v: 76500, st: 'E' } },       // 2027 inkl. Sonderanhebung BStabG
  de: { 2026: 51944, 2027: { v: 53452, st: 'E' } },          // Durchschnittsentgelt (vorläufig)
  bez: { 2026: 47460, 2027: { v: 49560, st: 'E' } },         // Bezugsgröße p.a.
  rw: { 2025: 40.79, 2026: 42.52 },          // aktueller Rentenwert ab 1.7.
  // Beitragssatz allgemeine RV (§ 158 SGB VI); 2027 Kabinett 7.10.2026, 2028 Vorausschätzung DRV (Bundesvertreterversammlung 11.6.2026)
  rvSatz: { 2026: 0.186, 2027: { v: 0.186, st: 'E' }, 2028: { v: 0.199, st: 'A' } },
  bbgKn: { 2026: 124800, 2027: { v: 130800, st: 'E' } },     // BBG knappschaftliche RV
  knAufschlag: 0.061,                        // Annahme (A): Abstand Satz knappschaftliche RV zu allgemeinem Satz (24,7 % − 18,6 %), konstant fortgeschrieben
  kvGen: 0.146, kvErm: 0.140, pv: 0.036, pvKinderlos: 0.006,
  halteBis: 2031,                            // Ende der Haltelinie 48 %, danach Rentendämpfung
  rentenAlter: 67,                           // Regelaltersgrenze ab Jahrgang 1964 (Jahre); davor jahrgangsabhängig über ragMonths
};
// Regelaltersgrenze in Monaten nach Geburtsjahr (§ 235 Abs. 2 SGB VI, Status G): 1947–1958 65 J. + 1 M. je Jahrgang ab 1947, 1959–1963 66 J. + 2 M. je Jahrgang ab 1959, ab 1964 67 J.
const ragMonths = by => by >= 1964 ? 67 * 12 : by >= 1959 ? 66 * 12 + 2 * (by - 1958) : by >= 1947 ? 65 * 12 + (by - 1946) : 65 * 12;

// Hinweis: SV-Tabellen ignorieren den Entwurfsschalter A.useDraft; SV-Werte mit Status E gelten immer (der Schalter betrifft nur Steuertarif und Kinderwerte)
function idxVal(table, year, growth) { // Wert aus Tabelle, danach mit growth fortgeschrieben (Rate oder Funktion: Faktor vom Tabellenjahr bis year)
  const { y: base, v } = lawPick(table, year);
  return v * (typeof growth === 'function' ? growth(base) : Math.pow(1 + growth, Math.max(0, year - base)));
}
// Höchstbetrag Altersvorsorgeaufwendungen je Person = Höchstbeitrag zur knappschaftlichen RV (§ 10 Abs. 3 S. 1 EStG)
const hbFor = L => Math.ceil(L.bbgKn * (L.rvSatz + SV.knAufschlag));
const hbYear = y => hbFor({ bbgKn: idxVal(SV.bbgKn, y, 0), rvSatz: lawPick(SV.rvSatz, y).v }); // Anzeige: Tabellenwerte ohne Fortschreibung

// Rentenwert ab 1.7. des Jahres y: Tabelle, danach Anpassung = Lohnwachstum, nach der Haltelinie gedämpft (mit ix: vorab berechnete Reihe)
function rwJul(y, A, ix) {
  const ys = Object.keys(SV.rw).map(Number), last = Math.max(...ys);
  if (y <= last) return SV.rw[Math.max(...ys.filter(k => k <= y), Math.min(...ys))]; // in der Tabelle: letzter Eintrag ≤ y, davor der erste
  if (ix) return ix.rw[ixk(ix, y)];
  let rw = SV.rw[last];
  for (let k = last + 1; k <= y; k++) rw *= 1 + A.wageGrowth - (k > SV.halteBis ? A.rentenDaempfung : 0);
  return rw;
}
// Jahresrente aus e Entgeltpunkten: Monate Jan-Jun mit dem Wert ab 1.7. des Vorjahres, Jul-Dez mit dem neuen Wert; ab Monat fromAbs
function grvYear(e, zf, year, fromAbs, A, ix) {
  const h1 = monthsIn(year, fromAbs, year * 12 + 6), h2 = monthsIn(year, Math.max(fromAbs, year * 12 + 6), Infinity);
  return e * zf * (h1 * rwJul(year - 1, A, ix) + h2 * rwJul(year, A, ix));
}
// Indexreihen je Jahr ab BASE_YEAR (Wert 1 im Jahr 2026) bis Y1: Preise cpi, Löhne wage, Rentenwert rw (ab dem Jahr nach der Tabelle),
// d = Abweichung der Pfad-Inflation vom festen Wert (für Einkommen, Budget, PKV über ixDev). Ohne path feste Raten A.inflation und A.wageGrowth;
// mit path gilt ab Y0 die Pfad-Inflation (von yr−1 auf yr: path[yr−1−Y0]), Lohnwachstum = Pfad-Inflation + Lohnabstand (A.wageGrowth − A.inflation)
function makeIx(A, Y0, Y1, path) {
  const n = Math.max(0, Y1 - BASE_YEAR) + 1, gap = A.wageGrowth - A.inflation, ys = Object.keys(SV.rw).map(Number), last = Math.max(...ys);
  const cpi = [1], wage = [1], d = [0], rw = [SV.rw[BASE_YEAR] ?? null];
  for (let k = 1; k < n; k++) {
    const yr = BASE_YEAR + k, pt = path && yr - 1 - Y0 >= 0 ? path[yr - 1 - Y0] : null;
    const inf = pt ? pt.infl : A.inflation, wg = pt ? pt.infl + gap : A.wageGrowth;
    cpi[k] = cpi[k - 1] * (1 + inf); wage[k] = wage[k - 1] * (1 + wg); d[k] = pt ? pt.infl - A.inflation : 0;
    rw[k] = yr <= last ? null : (yr === last + 1 ? SV.rw[last] : rw[k - 1]) * (1 + wg - (yr > SV.halteBis ? A.rentenDaempfung : 0));
  }
  return { n, cpi, wage, d, rw, path: !!path, dg: new Map() };
}
const ixk = (ix, y) => Math.min(ix.n - 1, Math.max(0, y - BASE_YEAR));   // Index der Reihe für Jahr y (außerhalb: Randwert)
// Zusatzfaktor zu (1 + g)^Jahre für eine Größe mit Wachstum g: Wachstum je Jahr g + d, also ∏ (1 + g + d) / (1 + g); ohne Pfad genau 1
function ixDev(ix, g, year) {
  if (!ix.path) return 1;
  let a = ix.dg.get(g);
  if (!a) { a = [1]; for (let k = 1; k < ix.n; k++) a[k] = a[k - 1] * (1 + g + ix.d[k]) / (1 + g); ix.dg.set(g, a); }
  return a[ixk(ix, year)];
}
// Gesetzeswerte eines Jahres; ix (aus makeIx) schreibt Tarif, Kinderwerte und Soli mit den Preisen, SV-Grenzen mit den Löhnen fort, ohne ix feste Raten
function lawYear(year, A, ix) {
  const cp = ix ? b => ix.cpi[ixk(ix, year)] / ix.cpi[ixk(ix, b)] : b => Math.pow(1 + A.inflation, year - b);   // Preisfaktor von Jahr b auf year
  const w = ix ? b => (year > b ? ix.wage[ixk(ix, year)] / ix.wage[ixk(ix, b)] : 1) : A.wageGrowth;            // Lohnfaktor bzw. Lohnwachstum
  const { p, idx } = tariffFor(year, { useDraft: A.useDraft, indexTariff: A.indexTariff, inflation: A.inflation, cp });
  const { y: kY, v: kd } = lawPick(LAW.kinder, year, A.useDraft);
  const kIdx = year > kY && A.indexTariff ? cp(kY) : 1;
  return {
    year, p, idx,
    soliFG: LAW.soli.freigrenzeSplit * (A.indexTariff ? Math.max(1, cp(2026)) : 1),
    kfb: kd.kfb * kIdx, kg: kd.kg * kIdx * 12,
    anPausch: lawPick(LAW.pausch.anPausch, year, A.useDraft).v * kIdx,
    bbgRV: idxVal(SV.bbgRV, year, w), bbgKn: idxVal(SV.bbgKn, year, w), rvSatz: lawPick(SV.rvSatz, year).v, bbgKV: idxVal(SV.bbgKV, year, w), de: idxVal(SV.de, year, w),
    bez: idxVal(SV.bez, year, w),
    zus: A.zusatz + A.zusatzDrift * Math.max(0, year - 2026),
    pv: SV.pv + A.pvDrift * Math.max(0, year - 2026),
    basiszins: (LAW.basiszins[year] ?? A.basiszins * 100) / 100,
  };
}

// Einkommensteuer einer Steuereinheit (Splitting oder Grundtarif) + Soli, mit Kinder-Günstigerprüfung
function estSplit(zvE, L) {
  if (zvE <= 0) return 0;
  return 2 * L.idx * estGrund(zvE / 2 / L.idx, L.p);
}
function estSingle(zvE, L) { return zvE <= 0 ? 0 : L.idx * estGrund(zvE / L.idx, L.p); }
function soliOf(estBase, fg) {
  if (estBase <= fg) return 0;
  return Math.min(LAW.soli.satz * estBase, LAW.soli.milderung * (estBase - fg));
}
// tp = Steuerprofil der Einheit { split, nKids, kfbF, kgF, kist, eb24b }: kfbF/kgF = Anteil an Kinderfreibetrag und Kindergeld, kist = Kirchensteuersatz
function incomeTax(zvE, L, tp) {
  if (tp.eb24b) zvE = Math.max(0, zvE - tp.eb24b);   // Entlastungsbetrag für Alleinerziehende (§ 24b)
  const est0 = tp.split ? estSplit : estSingle, fg = tp.split ? L.soliFG : L.soliFG / 2;
  const calc = z => {
    const e0 = est0(z, L);
    let est = e0, base = e0;   // base: Bemessung für Soli und Kirchensteuer (immer mit Kinderfreibetrag, § 51a Abs. 2 EStG)
    if (tp.nKids > 0) {
      const eK = est0(z - tp.nKids * tp.kfbF * L.kfb, L);
      const kg = tp.nKids * tp.kgF * L.kg;
      if (eK + kg < e0) est = eK + kg; // Freibetrag günstiger: Kindergeld wird hinzugerechnet
      base = eK;
    }
    const soli = soliOf(base, fg), kist = (tp.kist || 0) * base;
    return { est, soli, kist, total: est + soli + kist };
  };
  let r = calc(zvE);
  // Kirchensteuer ist als Sonderausgabe abziehbar (§ 10 Abs. 1 Nr. 4 EStG), im selben Jahr: Fixpunkt in zwei Runden
  if (r.kist > 0) { r = calc(Math.max(0, zvE - r.kist)); r = calc(Math.max(0, zvE - r.kist)); }
  return r;
}
// Grenzsteuer je Einkunftsteil, gestapelt von unten: parts in Zuordnungsreihenfolge (GRV, AVD, Basisrente, private RV), der Rest von zvE
// (Erwerbseinkommen) liegt darunter und bleibt bei der Einheit. Teil k: T(zvE − Σ spätere) − T(zvE − Σ spätere − Teil), Summe = T(zvE) − T(zvE − Σ parts).
// noKist: T ohne Kirchensteuer (ESt + Soli, wie in buildRow aufgeteilt)
function marginalTax(zvE, L, tp, parts, noKist = false) {
  const T = z => { const r = incomeTax(Math.max(0, z), L, tp); return noKist ? r.total - r.kist : r.total; };
  const out = parts.map(() => 0);
  let z = zvE, hi = T(z);
  for (let k = parts.length - 1; k >= 0; k--) {
    if (!(parts[k] > 0)) continue;
    z -= parts[k]; const lo = z > 0 ? T(z) : 0;
    out[k] = hi - lo; hi = lo;
  }
  return out;
}

// Kapitalertragsteuer mit Pauschbetrag (Freistellungsauftrag), Verlustvortrag, optional Günstigerprüfung
// t0: Einkommensteuer auf zvEOther, falls schon berechnet; rate: Abgeltungssatz (kapRate), Günstigerprüfung vergleicht mit ESt + Soli + KiSt
function kapTax(kapTaxable, lossCarry, L, zvEOther, tp, A, pb = LAW.sparerPB, t0, rate = kapRate(0)) {
  let base = kapTaxable - lossCarry;
  let newLoss = 0;
  if (base < 0) { newLoss = -base; base = 0; }
  const pbUsed = Math.min(Math.min(pb, LAW.sparerPB), base), afterSPB = Math.max(0, base - Math.min(pb, LAW.sparerPB));   // pbUsed: vom Depot verbrauchter Teil des Pauschbetrags
  const abg = afterSPB * rate;   // Abgeltungsteuer inkl. Soli und Kirchensteuer (kapRate)
  let tax = abg, guenstiger = false;
  if (A.guenstiger && afterSPB > 0) {
    const e0 = t0 ?? incomeTax(zvEOther, L, tp).total, t1 = incomeTax(zvEOther + afterSPB, L, tp).total;
    if (t1 - e0 < abg) { tax = t1 - e0; guenstiger = true; }
  }
  return { tax, newLoss, afterSPB, guenstiger, pbUsed };
}

// Kapitalertragsteuer je Steuereinheit: zusammen veranlagt gepoolt (Verlustverrechnung zwischen Ehegatten, gemeinsamer Pauschbetrag),
// einzeln je Person. kapP: steuerpflichtige Kapitalerträge je Person. Steuer je Person nach positivem Beitrag, neuer Verlustvortrag nach negativem.
function kapTaxUnits(ctx, y, kapP, zvEU, itU, split = true) {
  const { A, units, depots, pbU, persons } = ctx, { L, tp } = y;
  const rates = persons.map(p => kapRate(p.kist || 0));
  const taxP = split ? kapP.map(() => 0) : null, newLossP = split ? kapP.map(() => 0) : null, pbUsedU = [];
  let tax = 0, afterSPB = 0, guenstiger = false;
  for (let j = 0; j < units.length; j++) {
    const ix = units[j].idx;
    let kT = 0, loss = 0, pos = 0, neg = 0, wr = 0;
    for (const i of ix) { const b = kapP[i] - depots[i].lossCarry; kT += kapP[i]; loss += depots[i].lossCarry; if (b > 0) { pos += b; wr += b * rates[i]; } else neg -= b; }
    const rate = pos > 0 ? wr / pos : rates[ix[0]];   // gepoolt: positiver Ertrag je Person mit ihrem Satz
    const kt = kapTax(kT, loss, L, zvEU[j], tp[j], A, pbU[j], itU[j].total, rate);
    tax += kt.tax; afterSPB += kt.afterSPB; guenstiger = guenstiger || kt.guenstiger; pbUsedU.push(kt.pbUsed);
    if (split) for (const i of ix) {
      const b = kapP[i] - depots[i].lossCarry;
      taxP[i] = pos > 0 ? kt.tax * Math.max(0, b) * rates[i] / wr : kt.tax / ix.length; newLossP[i] = neg > 0 ? kt.newLoss * Math.max(0, -b) / neg : 0;
    }
  }
  return { tax, afterSPB, guenstiger, pbUsedU, taxP, newLossP };
}

// ─── Personen-Helfer ───
function retireStartAbs(P) { return (P.by + P.retireAge) * 12 + (P.bm - 1) + 1; } // Monat nach Geburtstag
function monthsRetired(P, year) { return monthsIn(year, retireStartAbs(P), Infinity); }
// Anzahl der Monate des Jahres im Zeitraum [from, to) (absolute Monate: Jahr * 12 + Monat − 1)
function monthsIn(year, from, to) { return Math.max(0, Math.min(year * 12 + 12, to) - Math.max(year * 12, from)); }
function avdPayStartAbs(P) { return (P.by + P.avd.payStart) * 12 + P.bm; } // Monat nach Geburtstag
function policyPayStartAbs(P, k) { return (P.by + P[k].payStart) * 12 + P.bm; } // Rentenbeginn Basisrente / private RV
// Empfänger der AVD-Kinderzulage: dem Kindergeldempfänger (§ 85 Abs. 1 EStG), nur Ehegatten dürfen sie dem anderen zuordnen (§ 85 Abs. 2)
const zulageOf = (I, c) => I.married ? c.zulageTo : c.kgTo ?? 0;
// Monate mit Kind bis einschließlich Geburtstagsmonat zum Alter untilAge
function kidMonths(c, year, untilAge) { const b = c.by * 12 + (c.bm ?? 1) - 1; return monthsIn(year, b, b + untilAge * 12 + 1); }
// Kindererziehungszeit (§ 56 SGB VI): 36 Monate ab dem Monat nach der Geburt, im Jahr gezählt ab fromAbs (Stand der Renteninfo)
function kezMonths(c, year, fromAbs) { const b = c.by * 12 + (c.bm ?? 1) - 1; return monthsIn(year, Math.max(b + 1, fromAbs), b + 37); }
// Kinder, deren Erziehungszeit Person i zugeordnet ist (kezTo über den Personenbereich hinaus zählt als Person 1)
const kezKids = (I, i, n) => I.children.filter(c => Math.min(c.kezTo ?? 0, n - 1) === i);
// Mittlerer Kaufzeitpunkt (Jahresbruchteil) und Zwölftelung der Vorabpauschale für Zahlungen [Betrag, Monat von, Monat bis)
function buyTiming(parts) {
  let s = 0, t = 0, v = 0;
  for (const [amt, m0, m1] of parts) if (amt > 0) { s += amt; t += amt * (m0 + m1) / 24; v += amt * (25 - m0 - m1) / 24; }
  return s > 0 ? { buyT: t / s, vpFracNew: v / s } : { buyT: 0.5, vpFracNew: 6.5 / 12 };
}
function zugangsfaktor(P) {
  const m = P.retireAge * 12 - ragMonths(P.by);
  return m < 0 ? 1 + 0.003 * m : 1 + 0.005 * m;
}
function ageAt(P, year) { return year - P.by; } // Alter im Lauf des Jahres (Geburtstag erreicht)

// 9/10-Regel für KVdR (§5 Abs. 1 Nr. 11 SGB V), freiwillige GKV-Zeiten zählen mit
function kvdrCheck(P, nKidsAll = P.kidsForKvdr ?? 0) {
  if (P.kvdr === 'pkv') return { ok: false, pkv: true, auto: false };
  if (P.kvdr === 'ja') return { ok: true, auto: false };
  if (P.kvdr === 'nein') return { ok: false, auto: false };
  const end = P.by + P.retireAge + (P.bm - 1) / 12;
  const span = end - P.firstWork;
  const half = span / 2;
  const need = 0.9 * half;
  const have = half - P.pkvYearsSecondHalf + 3 * nKidsAll;   // § 5 Abs. 2 S. 3 SGB V: 3 Jahre je Kind
  return { ok: have >= need, auto: true, need, have: Math.min(half, have), half };
}

// Grenzsteuer je Person und Quelle (grv, avd, basis, prv) der Steuereinheit j aus ihrem zvE, gestapelt: GRV, AVD, Basisrente, private RV, je Quelle die Personen der Einheit
function unitMarginal(y, u, j, zvE, noKist) {
  const ix = u.idx, n = ix.length, { grvTaxable, avdPay, polPay } = y;
  const parts = [...ix.map(i => grvTaxable[i]), ...ix.map(i => avdPay[i].taxable), ...POLICIES.flatMap(k => ix.map(i => polPay[i][k].taxable))];
  const m = marginalTax(zvE, y.L, y.tp[j], parts, noKist);
  return ix.map((i, a) => ({ grv: m[a], avd: m[n + a], ...Object.fromEntries(POLICIES.map((k, b) => [k, m[(2 + b) * n + a]])) }));
}
// Steuerpflichtiger Rentenanteil: im Startjahr gross · Besteuerungsanteil, danach wird der Freibetrag (im ersten vollen Jahr) festgeschrieben; st = { fb: null }
function taxablePension(gross, startYear, year, st) {
  const ba = LAW.besteuerungsanteil(startYear);
  if (year === startYear) return gross * ba;
  if (st.fb == null) st.fb = gross * (1 - ba);
  return Math.max(0, gross - st.fb);
}
// Steuerpflichtiges Erwerbseinkommen einer Person (Arbeitnehmer: abzüglich Arbeitnehmerpauschbetrag); floor0: Arbeitnehmeranteil nicht unter 0
// (zvEBase ja; taxBase nein, dort wird erst die Summe mit den Renten bei 0 gekappt, sonst verschöbe sich die Aufteilung der ESt bei Einkommen unter dem Pauschbetrag)
// Altersentlastungsbetrag (§ 24a EStG): ab dem Jahr nach dem 64. Geburtstag, Satz und Höchstbetrag nach dem Jahr davor (by + 65), nur auf Arbeitslohn/Gewinn, nicht auf Renten
function altEntlP(p, w, L) { if (!(w.g > 0) || L.year < p.by + 65) return 0; const a = LAW.altEntl(p.by + 65); return Math.min(a.pct * w.g, a.max); }
function earnedTaxable(p, w, L, floor0) { const ae = altEntlP(p, w, L); if (p.job !== 'employee') return w.g - ae; const x = w.g - (w.m > 0 ? L.anPausch : 0) - ae; return floor0 ? Math.max(0, x) : x; }
// Summe eines Arrays (auch in ui.js genutzt)
const sum = a => a.reduce((x, y) => x + y, 0);
// Summe von f(o[k], k) über alle Versicherungsprodukte (Reihenfolge wie POLICIES)
const sumPol = (o, f) => POLICIES.reduce((s, k) => s + f(o[k], k), 0);
// Zeilenfelder je Produkt: Kapital k, Einzahlung kIn, Rente kPay, davon in Entnahmemonaten kPayW (je Person oder als Arrays)
function polFields(o, k, v, io, pay) {
  const m = (x, f) => Array.isArray(x) ? x.map(f) : f(x);
  o[k] = v; o[k + 'In'] = m(io, x => x.c + x.z); o[k + 'Pay'] = m(pay, x => x.gross); o[k + 'PayW'] = m(pay, x => x.W);
}

// KV/PV der Rentner je Person (eigener Anteil). kapP: KV-Basis aus Kapitalerträgen des eigenen Depots je Person.
function kvRetire(ctx, y, kapP) {
  const { persons, kv } = ctx, { year, L, pvZu, grv, avdPay, polPay, polGross, lumpKV, lumpKVAvd } = y;
  let tot = 0, deductible = 0;
  const per = persons.map(() => 0), deductibleP = persons.map(() => 0);
  // Beiträge freiwillig Versicherter je Quelle (Reinvestition vor dem Entnahmestart, Rendite je Produkt); null = keine
  const by = persons.map(() => null);
  persons.forEach((p, i) => {
    const m = y.mRet[i];
    if (m <= 0) return;
    const f = m / 12, bbg = L.bbgKV * f;
    const pvRate = L.pv + pvZu;
    if (kv[i].pkv) {   // Private KV: Beitrag unabhängig vom Einkommen, Zuschuss der DRV (§ 106 SGB VI) max. halber Beitrag
      const g = Math.pow(1 + (p.pkvGrowth ?? 0.03), year - 2026) * ixDev(ctx.ix, p.pkvGrowth ?? 0.03, year);   // ixDev: Pfad-Inflation über dem festen Wert
      const prem = Math.max(0, (p.pkvPremium - (p.pkvRelief || 0)) * g) * 12 * f;
      const zus = Math.min(grv[i] * (SV.kvGen + L.zus) / 2, prem / 2);
      const c = prem - zus;
      deductibleP[i] = Math.max(0, prem * (p.pkvBasis ?? 0.85) - zus);
      tot += c; deductible += deductibleP[i]; per[i] = c;
      return;
    }
    const bR = Math.min(grv[i], bbg);
    let c = bR * ((SV.kvGen + L.zus) / 2 + pvRate);   // KVdR und freiwillig: DRV trägt die Hälfte der KV
    // KVdR-Pflichtversicherte: nach § 237 SGB V zählen nur Rente, Versorgungsbezüge (§ 229) und Arbeitseinkommen.
    // Das AVD gehört zur privaten Vorsorge und steht nicht im Katalog des § 229 (betrieblich nimmt § 229 Abs. 1 Nr. 5 Altersvorsorgevermögen nach § 92 EStG sogar aus).
    if (!kv[i].ok) {
      const rest = Math.max(0, bbg - bR);
      // Freiwillig: Beiträge auch auf Versicherungsrenten (voller Zahlbetrag) und Kapitalauszahlungen
      // Nur Monate ab dem eigenen Rentenbeginn zählen (davor pflichtversichert, private Zahlungen beitragsfrei); das AVD-Teilkapital zählt über lumpKV auf 1/120
      const ap = avdPay[i], avdKV = ap.m > 0 ? (ap.gross - ap.lump) * ap.mR / ap.m : 0;
      const polKV = POLICIES.map(k => { const q = polPay[i][k]; return q.m > 0 ? q.gross * q.mR / q.m : 0; });
      const sonst = Math.max(0, avdKV + sum(polKV) + lumpKV[i] + kapP[i] * f);
      const bS = Math.min(sonst, rest);
      const fehl = Math.max(0, L.bez / 3 * f - bR - bS);   // Mindestbemessung
      c += (bS + fehl) * (SV.kvErm + L.zus + pvRate);
      if (sonst > 0) {
        const q = bS * (SV.kvErm + L.zus + pvRate) / sonst;
        by[i] = { avd: (avdKV + lumpKVAvd[i]) * q, basis: polKV[POLICIES.indexOf('basis')] * q, prv: (polKV[POLICIES.indexOf('prv')] + lumpKV[i] - lumpKVAvd[i]) * q, etf: kapP[i] * f * q };
      }
    }
    tot += c; deductible += c; deductibleP[i] = c; per[i] = c;
  });
  return { tot, deductible, deductibleP, per, by };
}

// KV-Basis freiwillig Versicherter aus Kapitalerträgen: Bruttogewinn plus Vorabpauschale/Ausschüttung (vor Teilfreistellung),
// mit Schalter kvTeilfreistellung stattdessen die Werte nach Teilfreistellung; nie negativ
function kvKapBase(saleGain, saleTaxable, pendGross, pendTaxable, A) {
  return Math.max(0, A.kvTeilfreistellung ? saleTaxable + pendTaxable : saleGain + pendGross);
}

// Steuer + SV für gegebenen ETF-Verkauf G (Probeverkauf über beide Depots nach Depotwert, die Depots bleiben unverändert)
function evalYear(ctx, y, G) {
  const { I, A, depots, units, wStartAbs, pendingKap, pendingKapGross } = ctx, { L, tp, otherIncomeP, vorsorgeP, inWithdraw, yearAbs0, dvS, cvS } = y;
  const sale = depotsSell(depots, G, I.depot.sellMode, true, dvS, cvS);
  const kapP = sale.per.map((s, i) => pendingKap[i] + s.taxable);
  // KV-Basis freiwillig je Person aus dem eigenen Depot: Gewinn inkl. Ausschüttung/VP, ohne Sparerpauschbetrag; Teilfreistellung per Schalter
  const kvR = kvRetire(ctx, y, sale.per.map((s, i) => kvKapBase(s.gain, s.taxable, pendingKapGross[i], pendingKap[i], A)));
  // zvE und Einkommensteuer je Steuereinheit (Sonderausgaben-Pauschbetrag 36 € je Person), it = Summe über die Einheiten.
  // Hängen nur über die abziehbaren KV-Beiträge vom Verkauf ab: bei gleichen Beiträgen (KVdR, PKV) aus dem Zwischenspeicher des Jahres
  const dP = kvR.deductibleP, c = y.itCache;
  let zvEU, itU, it;
  if (c && c.dP.every((d, i) => d === dP[i])) ({ zvEU, itU, it } = c);
  else {
    zvEU = []; itU = [];
    for (let j = 0; j < units.length; j++) {
      const ix = units[j].idx;
      let s = -LAW.pausch.sonderausg / 2 * ix.length;
      for (let k = 0; k < ix.length; k++) s += otherIncomeP[ix[k]] - vorsorgeP[ix[k]] - dP[ix[k]];
      zvEU.push(Math.max(0, s)); itU.push(incomeTax(zvEU[j], L, tp[j]));
    }
    it = itU.length === 1 ? itU[0] : itU.reduce((a, b) => ({ est: a.est + b.est, soli: a.soli + b.soli, kist: a.kist + b.kist, total: a.total + b.total }));
    y.itCache = { dP, zvEU, itU, it };
  }
  // Kapitalertragsteuer je Steuereinheit mit deren Günstigerprüfung
  const kt = kapTaxUnits(ctx, y, kapP, zvEU, itU);
  // Steuer auf Vorabpauschale/Ausschüttungen des Vorjahres ist im Januar fällig, Steuer auf Verkäufe in der Entnahme
  kt.taxW = !inWithdraw ? 0 : wStartAbs <= yearAbs0 ? kt.tax : Math.max(0, kt.tax - kapTaxUnits(ctx, y, pendingKap, zvEU, itU, false).tax);
  return { sale, it, itU, kt, kvR, zvEU };
}

const BASE_YEAR = 2026;   // Kaufkraft 2026: Preisindex 1 im Jahr 2026, Geldeingaben gelten in Preisen/Werten 2026

// Laufender Zustand über alle Jahre: Zeitpunkte, Depots, Verträge, Entgeltpunkte, Vormerkungen und Summen
function simCtx(I, A, opt) {
  const Y0 = I.startYear;
  const persons = I.persons;
  const useAVD = opt.scenario !== 'A';   // in Szenario A bleiben alle Vorsorgeprodukte aus
  const firstRet = Math.min(...persons.map(retireStartAbs));
  const lastRet = Math.max(...persons.map(retireStartAbs));
  const saveEndAbs = I.saveUntil === 'last' ? lastRet : firstRet;   // Sparen bis (exkl.)
  const wStartAbs = lastRet;                                          // Entnahme ab dem Monat, in dem beide in Rente sind
  const wStartYear = Math.floor(wStartAbs / 12);
  const wFullYear = wStartYear + (wStartAbs % 12 === 0 ? 0 : 1);      // erstes volles Entnahmejahr
  const refP = persons[I.withdraw.refPerson ?? 0];
  const endAbs = (refP.by + I.withdraw.targetAge) * 12 + refP.bm;     // bis einschließlich Geburtstagsmonat zum Zielalter
  const endYear = Math.floor((endAbs - 1) / 12);
  // Steuereinheiten: Ehepaar zusammen veranlagt (Splitting), sonst je Person eine Einheit
  const units = persons.length === 2 && I.married ? [{ idx: [0, 1], split: true }] : persons.map((p, i) => ({ idx: [i], split: false }));

  const unitOf = persons.map((p, i) => units.findIndex(u => u.idx.includes(i)));   // Steuereinheit je Person
  // ETF-Depot je Person; Sparrate und Überschüsse der Entnahme nach share (Person 1), Freistellungsauftrag je Einheit:
  // zusammen min(Summe, Sparerpauschbetrag), einzeln je Person höchstens die Hälfte (pbMaxU: gesetzlicher Pauschbetrag der Einheit)
  const depots = persons.map(p => makeDepot({ funds: I.depot.funds, startValue: p.etf.startValue, startCost: p.etf.startCost, startYear: Y0 }));
  const share = persons.length === 2 ? [Math.min(1, Math.max(0, I.depot.share)), 1 - Math.min(1, Math.max(0, I.depot.share))] : [1];
  const pbMaxU = units.map(u => u.split ? LAW.sparerPB : LAW.sparerPB / 2);
  const pbU = units.map((u, j) => Math.min(pbMaxU[j], sum(u.idx.map(i => persons[i].etf.freistellung))));
  const avd = persons.map(() => makeAVD());
  const kv = persons.map(p => kvdrCheck(p, I.children.length));
  const ep = persons.map(p => p.epNow), epKez = persons.map(() => 0);   // epKez: Erziehungszeiten zusätzlich zur Renteninfo-Prognose (ohne Kappung)
  // Zwischen Stand der Renteninfo und Rechnungsbeginn einmalig gutschreiben (Werte des jeweiligen Jahres): im EP-Modus Beitrags-EP (Pflichtversicherte, Einkommen ab 2026 fortgeschrieben,
  // bis Rentenbeginn) und Erziehungszeiten, zusammen gekappt auf die BBG-Grenze (§ 70 Abs. 2 S. 2 SGB VI); im Prognose-Modus nur Erziehungszeiten ohne Kappung
  persons.forEach((p, i) => {
    const from = (p.riY ?? 2026) * 12 + (p.riM ?? 1) - 1, kids = kezKids(I, i, persons.length), wEnd = Math.min(Y0 * 12, retireStartAbs(p));
    for (let yr = Math.floor(from / 12); yr < Y0; yr++) {
      const kez = sum(kids.map(c => kezMonths(c, yr, from))) / 12;
      if (p.grvMode === 'prognose') { epKez[i] += kez; continue; }
      const L0 = lawYear(yr, A), n = monthsIn(yr, from, Y0 * 12), nW = monthsIn(yr, from, wEnd);
      const beitrag = p.rvPflicht && nW > 0 ? Math.min(p.income * Math.pow(1 + p.incomeGrowth, yr - BASE_YEAR), L0.bbgRV) * nW / 12 / L0.de : 0;
      ep[i] += beitrag + Math.max(0, Math.min(kez, L0.bbgRV / L0.de * n / 12 - beitrag));
    }
  });
  const renteFB = persons.map(() => ({ fb: null }));   // Rentenfreibetrag (fix ab Folgejahr)
  const renteStartY = persons.map(p => Math.floor(retireStartAbs(p) / 12));
  // Versicherungen (Basisrente, private RV): Vertrag ab Rechnungsbeginn, Beiträge bis Sparende, eigenem Rentenbeginn oder Rentenbeginn des Vertrags
  const pol = persons.map(p => Object.fromEntries(POLICIES.map(k => {
    const cfg = p[k];
    if (!useAVD || !cfg?.on) return [k, null];
    const s0 = policyPayStartAbs(p, k), cEnd = Math.min(saveEndAbs, retireStartAbs(p), s0);
    const plannedM = Math.max(0, cEnd - Y0 * 12);
    return [k, { cfg, s: makePolicy(), s0, cEnd, alphaTot: cfg.akv * cfg.beitrag * plannedM / 12, fb: null, half: cfg.payStart >= INS.halfAge && s0 - Y0 * 12 >= INS.halfYears * 12 }];
  })));
  const kvLump = persons.map(() => []);   // Kapitalauszahlungen für KV freiwillig Versicherter (1/120 über 10 Jahre)
  // Erstattungen des Vorjahres: ins ETF-Depot oder als Zuzahlung ins jeweilige Produkt
  const pendAvd = persons.map(() => 0), pendPol = persons.map(() => Object.fromEntries(POLICIES.map(k => [k, 0])));
  const loans = makeLoans(I.loans || [], Y0 * 12), pi0 = Math.pow(1 + A.inflation, Math.max(0, Y0 - BASE_YEAR));
  return {
    I, A, opt, Y0, persons, units, useAVD, saveEndAbs, wStartAbs, wStartYear, wFullYear, endAbs, endYear,
    unitOf, depots, share, pbU, pbMaxU, avd, kv, ep, epKez, renteFB, renteStartY, pol, kvLump, pendAvd, pendPol, loans,
    priceIdx: pi0, pi0,   // pi0: Preisindex zu Rechnungsbeginn (deterministisch mit A.inflation von 2026 bis startYear)
    ix: makeIx(A, Y0, endYear + 1, opt.path),
     pendingKap: persons.map(() => 0), pendingKapGross: persons.map(() => 0), pendingRefund: 0, depleted: false, depletedYear: null,
    sumZulagen: 0, sumRefunds: 0, houseSale: null, sumBasisRefund: 0,
    startReal: sum(persons.map(p => p.etf.startValue)),   // reales Nettovermögen zu Entnahmebeginn (Ende des Vorjahres)
  };
}

// Jahresgrundlagen: Markt, Preisindex, Gesetzeswerte, Kinder (Kindergeld, Kinderfreibetrag, PV-Abschlag), Spar- und Entnahmemonate
function yearBase(ctx, year) {
  const { I, A, opt, Y0, persons, units, saveEndAbs, wStartAbs, endAbs } = ctx;
  const t = year - Y0;
  const mk = opt.path ? opt.path[t] : { R: A.ret, infl: A.inflation };
  if (t > 0) ctx.priceIdx *= 1 + (opt.path ? opt.path[t - 1].infl : A.inflation);
  const L = lawYear(year, A, opt.path ? ctx.ix : null);   // ohne Pfad feste Raten (bitgleich zur Rechnung ohne Reihen)
  // Kindergeld und Kinderfreibetrag monatsweise (§ 32 Abs. 6 EStG: je Monat ein Zwölftel)
  const kgM = I.children.map(c => kidMonths(c, year, c.kgUntil));
  const kgKids = I.children.filter((c, k) => kgM[k] > 0);
  const nKids = kgM.reduce((a, b) => a + b, 0) / 12;
  // PV: Abschlag 0,25 Pp. je Kind unter 25 ab dem 2. Kind (max. 4), Monatsdurchschnitt; Kinderlosenzuschlag ohne Kinder
  let pvAb = 0;
  for (let m = 0; m < 12; m++) {
    const k25 = I.children.filter(c => { const b = c.by * 12 + (c.bm ?? 1) - 1, a = year * 12 + m; return a >= b && a <= b + 25 * 12; }).length;
    pvAb += 0.0025 * Math.min(4, Math.max(0, k25 - 1)) / 12;
  }
  const childless = I.children.length === 0;
  const pvZu = -pvAb + (childless ? SV.pvKinderlos : 0);   // Abschlag/Zuschlag auf den PV-Satz
  // Spar- oder Entnahmephase
  const saveMonths = monthsIn(year, 0, saveEndAbs);
  const wMonths = monthsIn(year, wStartAbs, endAbs);   // Entnahmemonate im Jahr
  // Steuerprofil je Einheit: zusammen bzw. Einzelperson voller Kinderfreibetrag und volles Kindergeld, einzeln mit zwei Personen je die Hälfte
  // Entlastungsbetrag § 24b: nur Alleinstehende ohne Person 2; je Monat mit Kindergeld ein Zwölftel, 4.260 € plus 240 € je weiteres Kind
  let eb24b = 0;
  if (persons.length === 1) {
    const e = LAW.eb24b[lawPick(LAW.eb24b, year).y];
    for (let m = 0; m < 12; m++) { const k = I.children.filter(c => { const b = c.by * 12 + (c.bm ?? 1) - 1, a = year * 12 + m; return a >= b && a <= b + c.kgUntil * 12; }).length; if (k > 0) eb24b += (e.v + e.plus * (k - 1)) / 12; }
  }
  // kist: Satz der Person, bei Zusammenveranlagung der Mittelwert (in payoutsYear nach Anteil am steuerpflichtigen Einkommen gewichtet)
  const tp = units.map(u => { const f = u.split || persons.length === 1 ? 1 : 0.5; return { split: u.split, nKids, kfbF: f, kgF: f, kist: sum(u.idx.map(i => persons[i].kist || 0)) / u.idx.length, eb24b }; });
  return { year, t, mk, L, priceIdx: ctx.priceIdx, kgKids, tp, pvZu, yearAbs0: year * 12, saveMonths, wMonths, inWithdraw: wMonths > 0 };
}

// Erwerbseinkommen (anteilig bis Rentenbeginn), Entgeltpunkte, gesetzliche Rente, Vorsorgeaufwendungen der Erwerbsphase
function workAndPension(ctx, y) {
  const { I, A, persons, ep, epKez, renteFB, renteStartY, ix } = ctx, { year, t, L, pvZu } = y;
  const work = persons.map((p, i) => {
    const m = 12 - monthsRetired(p, year);
    const g = p.income * Math.pow(1 + p.incomeGrowth, year - BASE_YEAR) * ixDev(ix, p.incomeGrowth, year) * m / 12;
    return { m, g };
  });
  // Entgeltpunkte (nur Pflichtversicherte), erst für Monate nach dem Stand der Renteninfo (davor sind sie in epNow enthalten)
  const riAbs = persons.map(p => (p.riY ?? 2026) * 12 + (p.riM ?? 1) - 1);
  const beitragEP = persons.map((p, i) => {
    const mE = monthsIn(year, riAbs[i], retireStartAbs(p));
    return p.grvMode !== 'prognose' && p.rvPflicht && mE > 0 ? Math.min(work[i].g * mE / work[i].m, L.bbgRV * mE / 12) / L.de : 0;
  });
  persons.forEach((p, i) => {
    ep[i] += beitragEP[i];
    // Erziehungszeiten ab Stand der Renteninfo: im EP-Modus mit Kappung (Beitrags-EP + KEZ-EP höchstens bis zur BBG-Grenze), im Prognose-Modus ohne
    if (work[i].m <= 0) return;
    const from = riAbs[i], kez = sum(kezKids(I, i, persons.length).map(c => kezMonths(c, year, from))) / 12;
    if (p.grvMode === 'prognose') epKez[i] += kez;
    else ep[i] += Math.max(0, Math.min(kez, L.bbgRV / L.de - beitragEP[i]));
  });

  // ── Gesetzliche Rente ── (mRet: Rentenmonate im Jahr je Person, auch für kvRetire)
  const mRet = persons.map(p => monthsRetired(p, year));
  const grv = persons.map((p, i) => {
    const m = mRet[i];
    if (m <= 0) return 0;
    const e = p.grvMode === 'prognose' ? p.grvPrognose / p.grvRwInfo + epKez[i] : ep[i];
    return grvYear(e, zugangsfaktor(p), year, retireStartAbs(p), A, ctx.opt.path ? ix : null);
  });
  const grvTaxable = grv.map((g, i) => {
    if (g <= 0) return 0;
    return taxablePension(g, renteStartY[i], year, renteFB[i]);
  });

  // ── Vorsorgeaufwendungen Erwerbsphase ──
  const vorsorgeP = persons.map(() => 0);
  persons.forEach((p, i) => {
    const w = work[i]; if (w.m <= 0) return;
    let vorsorge = 0;
    const bbgKV = L.bbgKV * w.m / 12, bbgRV = L.bbgRV * w.m / 12;
    if (p.job === 'employee') {
      if (p.rvPflicht) vorsorge += L.rvSatz / 2 * Math.min(w.g, bbgRV);
      vorsorge += ((SV.kvGen + L.zus) / 2 * (p.krankengeld ? 1 - SV.kgAbzug : 1) + L.pv / 2 + pvZu) * Math.min(w.g, bbgKV);
    } else {
      const rate = p.krankengeld ? SV.kvGen : SV.kvErm;
      if (p.rvPflicht) vorsorge += L.rvSatz * Math.min(w.g, bbgRV);   // Pflichtversicherte Selbständige tragen den vollen Beitrag
      vorsorge += ((rate + L.zus) * (p.krankengeld ? 1 - SV.kgAbzug : 1) + L.pv + pvZu) * Math.min(w.g, bbgKV);
    }
    vorsorgeP[i] = vorsorge;
  });
  // Grundlage zvE ohne Kapital je Person
  const zvEBaseP = persons.map((p, i) => earnedTaxable(p, work[i], L, true));
  Object.assign(y, { work, mRet, grv, grvTaxable, vorsorgeP, zvEBaseP });
}

// Kreditraten des Jahres, Ablösungen außerhalb der Entnahme, Spar-Budget nach Kreditraten
function loansYear(ctx, y) {
  const { I, loans, saveEndAbs, wStartAbs, endAbs, ix } = ctx, { year, yearAbs0, saveMonths } = y, B = I.budget;
  let loanPay = 0, loanSonder = 0, loanPayoff = 0, loanInSave = 0, loanInW = 0, payoffInW = 0;
  const payoffs = [];
  for (const l of loans) for (let m = 0; m < 12; m++) {
    const a = yearAbs0 + m, o = loanMonth(l, a, false);
    loanPay += o.pay + o.sonder; loanSonder += o.sonder; loanPayoff += o.payoff;
    if (a < saveEndAbs) loanInSave += o.pay + o.sonder;
    if (a >= wStartAbs && a < endAbs) { loanInW += o.pay + o.sonder; payoffInW += o.payoff; }
    else if (o.payoff > 0) payoffs.push({ l, amt: o.payoff, m });
  }
  const payoffOut = loanPayoff - payoffInW;   // Ablösung außerhalb der Entnahme: Verkauf aus dem Depot
  const budget = B.monthly * Math.pow(1 + B.dyn, year - BASE_YEAR) * ixDev(ix, B.dyn, year) * saveMonths;
  // In der Entnahme werden Kreditraten aus der Rente bezahlt (zählen als Ausgabe der Entnahme)
  Object.assign(y, { loanPay, loanSonder, loanInW, payoffInW, payoffs, payoffOut, budget, sparBudget: Math.max(0, budget - loanInSave) });
}

// AVD- und Versicherungsbeiträge, Kürzung aufs Sparbudget, Zulagen, Zuzahlungen aus Erstattungen, Ansparen und Verrentung, Basisrenten-Abzug
function contribYear(ctx, y) {
  const { I, Y0, persons, units, useAVD, saveEndAbs, avd, pol, kvLump, pendAvd, pendPol } = ctx, { year, mk, L, kgKids, work, yearAbs0, sparBudget } = y;
  // ── Altersvorsorgedepot: Beiträge und Zulagen ──
  // Beiträge monatsweise bis Sparende, eigenem Rentenbeginn oder Auszahlungsbeginn
  const avdIn = persons.map(() => ({ cF: 0, cU: 0, zul: 0, m: 0 }));
  if (useAVD && year >= 2027) {
    persons.forEach((p, i) => {
      const cfg = p.avd; if (!cfg.on) return;
      const m = monthsIn(year, 2027 * 12, Math.min(saveEndAbs, retireStartAbs(p), avdPayStartAbs(p)));
      if (m <= 0) return;
      const f = m / 12;
      const cF = Math.min(cfg.eigen, AVD.fMax) * f;
      const cU = Math.min(cfg.extra, AVD.einMax - Math.min(cfg.eigen, AVD.fMax)) * f;
      avdIn[i] = { cF, cU, zul: 0, m };
      if (avd[i].startAbs == null && m > 0) avd[i].startAbs = Math.max(2027 * 12, Y0 * 12);   // Vertragsbeginn für die Hälftelung
    });
  }
  // Versicherungsbeiträge (laufend bis Beitragsende)
  const polIn = persons.map((p, i) => Object.fromEntries(POLICIES.map(k => {
    const q = pol[i][k]; if (!q) return [k, { c: 0, cM: 0, z: 0 }];
    const cM = monthsIn(year, Y0 * 12, q.cEnd);
    return [k, { c: q.cfg.beitrag * cM / 12, cM, z: 0 }];
  })));
  // Die Beiträge aller Produkte dürfen das Sparbudget nicht übersteigen, sonst werden sie anteilig gekürzt
  const prodOut = sum(avdIn.map(a => a.cF + a.cU)) + sum(polIn.map(o => sumPol(o, x => x.c)));
  const budgetCut = prodOut > sparBudget + 0.01 ? sparBudget / prodOut : 1;
  persons.forEach((p, i) => {
    const a = avdIn[i];
    a.cF *= budgetCut; a.cU *= budgetCut;
    for (const k of POLICIES) polIn[i][k].c *= budgetCut;
    if (a.m <= 0) return;
    a.zul = zulageGrund(a.cF, AVD);
    // Kinderzulage: 100 % der Beiträge, max. 300 € je zugeordnetem Kind mit Kindergeld
    const zk = kgKids.filter(c => zulageOf(I, c) === i).length;
    if (zk > 0 && a.cF >= AVD.minEigen) a.zul += Math.min(a.cF, AVD.kindMax * zk);
  });
  // Erstattungen des Vorjahres als Zuzahlung: AVD ungefördert bis zum Höchstbeitrag, Versicherung (Basisrente) bis zum Rentenbeginn. Rest ins ETF-Depot.
  let refundEtf = ctx.pendingRefund;
  persons.forEach((p, i) => {
    const a = avdIn[i];
    const zA = a.m > 0 ? Math.min(pendAvd[i], Math.max(0, AVD.einMax * a.m / 12 - a.cF - a.cU)) : 0;
    a.cU += zA; a.zuz = zA; refundEtf += pendAvd[i] - zA;
    pendAvd[i] = 0;
    for (const k of POLICIES) {
      const q = pol[i][k], z = q && !q.s.paying && q.s0 > yearAbs0 ? pendPol[i][k] : 0;
      polIn[i][k].z = z; refundEtf += pendPol[i][k] - z; pendPol[i][k] = 0;
    }
  });

  // Versicherungen: Ansparjahr bzw. Ansparen bis zum Rentenbeginn und Verrentung
  const lumps = [];
  persons.forEach((p, i) => POLICIES.forEach(k => {
    const q = pol[i][k]; if (!q || q.s.paying) return;
    const mG = Math.min(12, Math.max(0, q.s0 - yearAbs0));
    const io = polIn[i][k];
    const alphaY = q.alphaTot * monthsIn(year, Y0 * 12, Y0 * 12 + INS.akvMonths) / INS.akvMonths;
    policySaveYear(q.s, q.cfg, mk.R, { c: io.c, cM: io.cM, z: io.z, alphaY, feeM: mG, mG });
    if (mG < 12) {
      policyAnnuitize(q.s, q.cfg, year, teilOf(q.cfg, k), rfAt(q.cfg, q.cfg.payStart, p.by));
      if (q.s.lump > 0) { lumps.push({ i, k, amt: q.s.lump, gain: q.s.gain, half: q.half, m: mG }); kvLump[i].push({ amt: q.s.lump, from: q.s0 }); }
    }
  }));
  // Höchstbetrag für abzugsfähige Versicherungen (Basisrente) je Steuereinheit: Höchstbetrag je Person minus Beiträge zur gesetzlichen RV (Angestellte AN- plus AG-Anteil, Selbständige ihr voller Beitrag)
  const grvBeitrP = persons.map((p, i) => p.rvPflicht && work[i].m > 0 ? L.rvSatz * Math.min(work[i].g, L.bbgRV * work[i].m / 12) : 0);
  const basisPaidP = polIn.map(o => sumPol(o, (x, k) => POLICY_DEF[k].deduct ? x.c + x.z : 0));
  const uSum = (u, a) => u.idx.reduce((s, i) => s + a[i], 0);
  const basisPaidU = units.map(u => uSum(u, basisPaidP));
  const basisDedU = units.map((u, j) => Math.min(basisPaidU[j], Math.max(0, u.idx.length * hbFor(L) - uSum(u, grvBeitrP))));

  // §10a Günstigerprüfung je Einheit: Zulagen und Sonderausgabenabzug
  const zulU = units.map(u => uSum(u, avdIn.map(a => a.zul)));
  const dedU = units.map(u => uSum(u, avdIn.map(a => a.cF + a.zul)));
  const basisDed = sum(basisDedU), zulSum = sum(zulU);
  // Beiträge aus dem Budget (ohne Zuzahlungen aus Erstattungen)
  const avdOut = avdIn.reduce((s, a) => s + a.cF + a.cU - (a.zuz || 0), 0) + sum(polIn.map(o => sumPol(o, x => x.c)));
  Object.assign(y, { avdIn, polIn, budgetCut, refundEtf, avdOut, lumps, basisDed, zulSum, basisPaidU, basisDedU, zulU, dedU });
}

// AVD-Auszahlung, Versicherungsrenten, Anteile der Entnahmemonate, KV-Bemessung aus Kapitalauszahlungen, steuerpflichtiges Einkommen ohne Kapital
function payoutsYear(ctx, y) {
  const { persons, useAVD, wStartAbs, endAbs, avd, pol, kvLump } = ctx, { year, grv, grvTaxable, zvEBaseP, yearAbs0 } = y;
  // ── Entnahme / laufende Rechnung ──
  // AVD-Auszahlungen ab dem Monat nach dem Geburtstag zum Auszahlungsbeginn, Restkapital / Restmonate
  const avdPay = persons.map((p, i) => {
    const none = { gross: 0, taxable: 0, m: 0, mW: 0, lump: 0, mR: 0, t: 0 };
    if (!useAVD || !p.avd.on) return none;
    const a = avd[i];
    const s0 = avdPayStartAbs(p), s1 = s0 + (p.avd.payEnd - p.avd.payStart + 1) * 12;
    const m = monthsIn(year, s0, s1);
    if (m <= 0 || avdValue(a) <= 0) return none;
    let res = { gross: 0, taxable: 0 };
    const half = avdHalf(a, s0, p);
    if (!a.paying) {
      a.paying = true;
      if (p.avd.teilkapital > 0) { res = avdWithdraw(a, avdValue(a) * p.avd.teilkapital, half); if (res.gross > 0) kvLump[i].push({ amt: res.gross, from: s0, avd: true }); }
    }
    const left = s1 - Math.max(s0, yearAbs0);
    const r2 = avdWithdraw(a, left <= m ? avdValue(a) : avdValue(a) * m / left, half);
    // Zeitpunkt der Auszahlung (Jahresbruchteil): Teilkapital im ersten Auszahlungsmonat, Raten zur Mitte der Auszahlungsmonate (Rendite bis dahin in marketYear)
    const m0 = Math.max(s0, yearAbs0) - yearAbs0, tR = (2 * m0 + m) / 24, tL = (s0 - yearAbs0) / 12, gs = res.gross + r2.gross;
    return { gross: gs, taxable: res.taxable + r2.taxable, m, lump: res.gross, t: gs > 0 ? (res.gross * tL + r2.gross * tR) / gs : 0, mR: monthsIn(year, Math.max(s0, retireStartAbs(p)), s1), mW: monthsIn(year, Math.max(s0, wStartAbs), Math.min(s1, endAbs)) };
  });
  // Anteile, die in die Entnahmemonate fallen (Renten und KV je Person, Einkommensteuer nach Einkommensanteil)
  const kvShare = persons.map(p => { const mR = monthsRetired(p, year); return mR > 0 ? monthsIn(year, Math.max(retireStartAbs(p), wStartAbs), endAbs) / mR : 0; });
  const grvW = grv.map((g, i) => g * kvShare[i]);
  const avdW = avdPay.map(a => a.m > 0 ? a.gross * a.mW / a.m : 0);
  // Versicherungsrenten: Basisrente mit Besteuerungsanteil wie die gesetzliche Rente, private RV mit Ertragsanteil
  const polPay = persons.map((p, i) => Object.fromEntries(POLICIES.map(k => {
    const q = pol[i][k]; if (!q || !q.s.paying) return [k, { gross: 0, taxable: 0, W: 0, m: 0, mR: 0 }];
    const m = monthsIn(year, q.s0, Infinity);
    const gross = policyRent(q.s, q.cfg, year, m);
    let taxable = 0;
    if (gross > 0 && POLICY_DEF[k].rentTax === 'kohorte') {
      taxable = taxablePension(gross, Math.floor(q.s0 / 12), year, q);
    } else if (gross > 0) taxable = gross * ertragsanteil(q.cfg.payStart);
    const W = m > 0 ? gross * monthsIn(year, Math.max(q.s0, wStartAbs), endAbs) / m : 0;
    return [k, { gross, taxable, W, m, mR: monthsIn(year, Math.max(q.s0, retireStartAbs(p)), Infinity) }];
  })));
  const polGross = polPay.map(o => sumPol(o, x => x.gross)), polW = polPay.map(o => sumPol(o, x => x.W));
  const polTaxable = polPay.map(o => sumPol(o, x => x.taxable));
  // KV-Bemessung freiwillig Versicherter: 1/120 der Kapitalauszahlung je Monat über 10 Jahre
  // (nur Monate ab dem eigenen Rentenbeginn; AVD-Teilkapital und Kapitalauszahlung der privaten RV gleich behandelt)
  const lumpOf = (ls, i) => sum(ls.map(l => l.amt / INS.kvLumpMonths * monthsIn(year, Math.max(l.from, retireStartAbs(persons[i])), l.from + INS.kvLumpMonths)));
  const lumpKV = kvLump.map((ls, i) => lumpOf(ls, i)), lumpKVAvd = kvLump.map((ls, i) => lumpOf(ls.filter(l => l.avd), i));

  // Einkommen ohne Kapital je Person (Werbungskostenpauschale bei Renteneinkünften)
  const otherIncomeP = persons.map((p, i) => zvEBaseP[i] + grvTaxable[i] + avdPay[i].taxable + polTaxable[i] - (grv[i] > 0 || avdPay[i].gross > 0 || polGross[i] > 0 ? LAW.pausch.rentnerWK : 0));

  // Kirchensteuersatz zusammen veranlagter Ehegatten mit verschiedener Konfession: nach Anteil am steuerpflichtigen Einkommen (wie die Aufteilung der ESt in buildRow)
  const tpK = y.tp;
  ctx.units.forEach((u, j) => {
    if (u.idx.length < 2 || u.idx.every(i => (persons[i].kist || 0) === (persons[u.idx[0]].kist || 0))) return;
    const tb = u.idx.map(i => Math.max(0, earnedTaxable(persons[i], y.work[i], y.L) + grvTaxable[i] + avdPay[i].taxable + polTaxable[i])), ts = sum(tb);
    tpK[j].kist = ts > 0 ? sum(u.idx.map((i, k) => tb[k] * (persons[i].kist || 0))) / ts : tpK[j].kist;
  });
  Object.assign(y, { avdPay, kvShare, grvW, avdW, polPay, polGross, polW, polTaxable, lumpKV, lumpKVAvd, otherIncomeP });
}

// Entnahme und Verkäufe außerhalb der Entnahme in einer Bewertung des Gesamtverkaufs S = G + H + X:
// G = ETF-Verkauf bis zum Zielnetto (Bisektion), H = Hausablösung außerhalb der Entnahme (Erlös nach Steuer deckt die Restschuld),
// X = Verkauf für Kapitalsteuer, die das freie Sparbudget nicht deckt. Fixpunkt höchstens 4 Runden, danach ein Verkauf.
function withdrawYear(ctx, y) {
  const { I, opt, depots, loans } = ctx, { year, priceIdx, work, grv, wMonths, inWithdraw, loanInW, payoffInW, payoffs, payoffOut, kvShare, grvW, avdW, avdPay, polGross, polW, sparBudget, avdOut, refundEtf } = y;
  const cash = Math.max(0, sparBudget - avdOut + refundEtf);   // freies Sparbudget für Kapitalsteuern außerhalb der Entnahme
  // Verkaufskurven und Depotwerte vor dem Verkauf (Probeverkäufe, Aufteilung der Verkäufe nach Depotwert)
  const cvS = y.cvS = depots.map(d => sellCurve(d, I.depot.sellMode)), dvS = y.dvS = cvS.map(c => c.V[c.V.length - 1]), dv = sum(dvS);
  let G = 0, H = 0, X = 0, ev, extraInvest = 0, netIncome = 0, target = 0, shortfall = false;
  const grossW = sum(grvW) + sum(avdW) + sum(polW);
  const incAll = sum(work.map(w => w.g)) + sum(grv) + sum(avdPay.map(a => a.gross)) + sum(polGross);
  const wT = !inWithdraw ? 0 : incAll > 0 ? grossW / incAll : 1;   // Anteil der Einkommensteuer, der auf die Entnahmemonate fällt
  // Bewertung des Gesamtverkaufs; die Steuer auf die Ablösung houseTax = T(G + H + X) − T(G + X) steckt im Verkaufserlös, nicht in der Steuer der Entnahmemonate
  const evalS = (g, h, x) => {
    const e = evalYear(ctx, y, g + h + x);
    e.houseTax = h > 0 ? Math.max(0, e.kt.tax - evalYear(ctx, y, g + x).kt.tax) : 0;
    e.kt.taxW = Math.max(0, e.kt.taxW - e.houseTax);
    return e;
  };
  if (inWithdraw) {
    if (I.withdraw.strategy !== 'fixedNet') target = opt.targetReal * wMonths * priceIdx;
    else target = I.withdraw.fixedNet * wMonths * (I.withdraw.fixedIndexed ? priceIdx : ctx.pi0);
    target += loanInW + payoffInW;   // Kreditraten und Ablösung in den Entnahmemonaten zusätzlich
  }
  const netOf = g => { const e = evalS(g, H, X); return { net: grossW + g - e.it.total * wT - e.kt.taxW - sum(e.kvR.per.map((c, i) => c * kvShare[i])), e }; };

  let conv = false;
  for (let round = 0; round < 4 && !conv; round++) {
    const H0 = H, X0 = X;   // G hängt nur von H und X ab
    if (inWithdraw) {
      const n0 = netOf(0);
      if (n0.net >= target) { G = 0; ev = n0.e; extraInvest = n0.net - target; netIncome = target; shortfall = false; }
      else {
        const maxG = Math.max(0, dv - H - X);
        const nMax = netOf(maxG);
        extraInvest = 0;
        if (nMax.net < target) { G = maxG; ev = nMax.e; netIncome = nMax.net; shortfall = true; }
        else {
          let lo = 0, hi = maxG;
          for (let k = 0; k < 36; k++) { const mid = (lo + hi) / 2; if (netOf(mid).net < target) lo = mid; else hi = mid; }
          G = hi; ev = netOf(G).e; netIncome = target; shortfall = false;
        }
      }
    }
    // Hausablösung: H so, dass H − Steuer auf H die Restschuld deckt
    if (payoffOut > 0) {
      const t0 = evalYear(ctx, y, G + X).kt.tax;
      let lo = 0, hi = Math.max(0, dv - G - X);
      for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (mid - (evalYear(ctx, y, G + mid + X).kt.tax - t0) < payoffOut) lo = mid; else hi = mid; }
      H = hi;
    }
    if (payoffOut > 0 || !inWithdraw) ev = evalS(G, H, X);
    // Kapitalsteuer außerhalb der Entnahme, die weder Ablösungserlös noch Sparbudget decken: zusätzlicher Verkauf
    X = Math.min(Math.max(0, dv - G - H), Math.max(0, ev.kt.tax - ev.kt.taxW - ev.houseTax - cash));
    conv = Math.abs(H - H0) < 1 && Math.abs(X - X0) < 1;
  }
  if (!conv) ev = evalS(G, H, X);   // ohne Konvergenz mit dem endgültigen X bewerten

  // Verkäufe vormerken, ausgeführt in marketYear zu ihrem Zeitpunkt (Jahresbruchteil): Steuerverkauf X zu Jahresbeginn, Ablösung H im Monat der Ablösung,
  // Entnahme G zur Mitte der Entnahmemonate. Steuer, Verlustvortrag und Aufteilung auf die Depots (ev.sale.per) aus der Bewertung zum Kurs zu Jahresbeginn.
  const houseTax = ev.houseTax, sellG = G + H + X;
  const yearAbs0 = y.yearAbs0, tG = (Math.max(0, ctx.wStartAbs - yearAbs0) + Math.min(12, ctx.endAbs - yearAbs0)) / 24;
  const tH = payoffOut > 0 ? sum(payoffs.map(p => p.amt * p.m)) / sum(payoffs.map(p => p.amt)) / 12 : 0;
  y.sells = [{ gross: X, t: 0 }, { gross: H, t: tH }, { gross: G, t: tG }].sort((a, b) => a.t - b.t);
  y.sellW = ev.sale.per.map(s => s.sold);
  // Kapitalsteuer, die weder Sparbudget noch Verkauf X decken (Depot aufgebraucht), geht vom Ablösungserlös ab und erhöht die Anschlussfinanzierung
  const taxFromHouse = Math.min(Math.max(0, ev.kt.tax - ev.kt.taxW - houseTax - cash - X), Math.max(0, H - houseTax));
  depots.forEach((d, i) => { d.lossCarry = ev.kt.newLossP[i]; });
  if (payoffOut > 0) {
    // Reicht das Depot nicht, läuft der ungedeckte Rest als Anschlussfinanzierung weiter
    const covered = Math.max(0, H - houseTax - taxFromHouse);
    const gap = payoffOut - covered;
    if (gap > 1) for (const { l, amt } of payoffs) {
      const rem = gap * amt / payoffOut;
      l.bal = rem; l.phase = 'post'; l.rM = loanRateM(l.c.zins); l.pay = annuityM(rem, l.rM, l.c.years * 12); l.postRate = l.pay;
    }
    ctx.houseSale = { year, gross: H, tax: houseTax, payoff: payoffOut, covered: Math.min(covered, payoffOut) };
  }
  Object.assign(y, { G, ev, extraInvest, netIncome, shortfall, wT, houseG: H, saleX: X, houseTax, taxFromHouse, cash, sellG, debt: loans.reduce((a, l) => a + l.bal, 0) });
}

// Erstattungen (Basisrente, § 10a), Steuer auf Kapitalauszahlungen, ETF-Sparrate und Reinvestition, Erstattungen fürs Folgejahr vormerken
function refundsAndInvest(ctx, y) {
  const { persons, units, unitOf, share, pbMaxU, pendAvd, pendPol } = ctx, { L, tp, avdIn, polIn, lumps, basisPaidU, basisDedU, zulU, dedU, zulSum, avdPay, avdW, polPay, polGross, polW, kvShare, ev, extraInvest, cash, saleX, houseTax, taxFromHouse } = y;
  // Sonderausgabenabzug Basisrente (§ 10 Abs. 1 Nr. 2 b EStG), danach § 10a-Günstigerprüfung (Steuerersparnis über der Zulage).
  // Beide Erstattungen kommen im Folgejahr und fließen je nach Einstellung ins Produkt, ins ETF-Depot oder in den Konsum.
  // Je Steuereinheit gerechnet, dann summiert
  const basisRefundU = units.map(() => 0), refundU = units.map(() => 0);
  units.forEach((u, j) => {
    const z = ev.zvEU[j], t0 = ev.itU[j].total;
    const tBasis = basisDedU[j] > 0 ? incomeTax(Math.max(0, z - basisDedU[j]), L, tp[j]).total : t0;
    basisRefundU[j] = t0 - tBasis;
    refundU[j] = dedU[j] > 0 ? Math.max(0, tBasis - incomeTax(Math.max(0, z - basisDedU[j] - dedU[j]), L, tp[j]).total - zulU[j]) : 0;
  });
  const basisRefund = sum(basisRefundU), refund = sum(refundU);
  // Kapitalauszahlung private RV: Ertrag nach 15 % Teilfreistellung, bei 12 Jahren und ab 62 zur Hälfte mit persönlichem Steuersatz,
  // sonst Abgeltungsteuer. Der Nettobetrag wird ins ETF-Depot angelegt.
  // Ohne Hälftelung steht der Rest des Sparerpauschbetrags der Einheit des Vertragsinhabers (nach den Depots und früheren Auszahlungen) zu.
  // Hälftelung mit dem persönlichen Steuersatz der Einheit des Vertragsinhabers
  const zvLump = [...ev.zvEU], pbCons = units.map(() => 0);
  let lumpNet = 0, lumpTax = 0;
  const lumpTaxPer = persons.map(() => 0), lumpPer = persons.map(() => 0), lumpNetP = persons.map(() => 0), lumpMP = persons.map(() => 12);
  for (const l of lumps) {
    const j = unitOf[l.i], tx = l.gain * (1 - INS.fondsFrei) * (l.half ? 0.5 : 1);
    const pbRest = l.half ? 0 : Math.max(0, pbMaxU[j] - ev.kt.pbUsedU[j] - pbCons[j]);
    if (!l.half) pbCons[j] += Math.min(pbRest, tx);
    const t = l.half ? incomeTax(zvLump[j] + tx, L, tp[j]).total - incomeTax(zvLump[j], L, tp[j]).total : Math.max(0, tx - pbRest) * kapRate(ctx.persons[l.i].kist || 0);
    if (l.half) zvLump[j] += tx;
    lumpTax += t; lumpNet += l.amt - t; lumpTaxPer[l.i] += t; lumpPer[l.i] += l.amt; lumpNetP[l.i] += l.amt - t; lumpMP[l.i] = Math.min(lumpMP[l.i], l.m);
  }

  // ── Sparphase: ETF-Sparrate ──
  // Kapitalsteuern werden in der Entnahme aus dem Netto, die Steuer auf die Ablösung aus deren Erlös, sonst aus dem Sparbudget
  // und, wenn das nicht reicht, über den zusätzlichen Verkauf saleX bzw. aus dem Ablösungserlös (taxFromHouse) bezahlt (kapTax = kapTaxW + taxFromBudget + taxSale + houseTax)
  const taxOutside = Math.max(0, ev.kt.tax - ev.kt.taxW - houseTax);
  const taxFromBudget = Math.min(cash, taxOutside);
  const taxSale = taxOutside - taxFromBudget;
  const savePart = Math.max(0, cash - taxFromBudget + saleX + taxFromHouse - taxSale);
  // Auszahlungen aus Vorsorgeprodukten vor Entnahmestart werden ins Depot des Eigentümers reinvestiert, Kapitalauszahlungen netto.
  // Abzüge: Grenzsteuer der Produkte (gestapelt über Erwerbseinkommen und GRV) auf den Anteil außerhalb der Entnahmemonate, KV freiwillig Versicherter auf diese Quellen.
  // Grenzsteuer nur in Jahren mit solchen Auszahlungen. Sparrate und Überschüsse der Entnahme nach share
  const outP = persons.map((p, i) => avdPay[i].gross - avdW[i] + polGross[i] - polW[i]), taxOut = persons.map(() => 0);
  const fr = (g, w) => g > 0 ? (g - w) / g : 0;
  units.forEach((u, j) => {
    if (!u.idx.some(i => outP[i] > 0.01)) return;
    const mU = unitMarginal(y, u, j, ev.zvEU[j]);
    u.idx.forEach((i, a) => { taxOut[i] = mU[a].avd * fr(avdPay[i].gross, avdW[i]) + sumPol(polPay[i], (q, k) => mU[a][k] * fr(q.gross, q.W)); });
  });
  const kvOut = persons.map((p, i) => { const b = ev.kvR.by[i]; return b && outP[i] > 0.01 ? (b.avd + b.basis + b.prv) * (1 - kvShare[i]) : 0; });
  const reinvP = persons.map((p, i) => Math.max(0, outP[i] - taxOut[i] - kvOut[i]) + lumpNetP[i]);
  const etfContribP = persons.map((p, i) => (savePart + extraInvest) * share[i] + reinvP[i]);
  const avdReinvest = sum(reinvP), etfContrib = sum(etfContribP);
  // Erstattungen je Person (Anteil innerhalb der Einheit) verteilen und fürs Folgejahr vormerken
  const dedPer = avdIn.map(a => a.cF + a.zul);
  const refundPer = persons.map((p, i) => { const j = unitOf[i]; return dedU[j] > 0 ? refundU[j] * dedPer[i] / dedU[j] : 0; });
  const polRefund = persons.map((p, i) => { const j = unitOf[i]; return Object.fromEntries(POLICIES.map(k => [k, POLICY_DEF[k].deduct && basisPaidU[j] > 0 ? basisRefundU[j] * (polIn[i][k].c + polIn[i][k].z) / basisPaidU[j] : 0])); });
  ctx.pendingRefund = 0;
  persons.forEach((p, i) => {
    const to = p.avd.refundTo ?? 'same';
    if (to === 'same') pendAvd[i] += refundPer[i]; else if (to === 'etf') ctx.pendingRefund += refundPer[i];
    for (const k of POLICIES) {
      const tk = p[k]?.refundTo ?? 'same', r = polRefund[i][k];
      if (tk === 'same') pendPol[i][k] += r; else if (tk === 'etf') ctx.pendingRefund += r;
    }
  });
  ctx.sumZulagen += zulSum; ctx.sumRefunds += refund; ctx.sumBasisRefund += basisRefund;
  Object.assign(y, { basisRefund, refund, lumpNet, lumpTax, lumpTaxPer, lumpPer, lumpNetP, lumpMP, reinvP, etfContribP, taxFromBudget, taxSale, savePart, avdReinvest, etfContrib, refundPer, polRefund });
}

// Markt: ETF-Depot (Rendite, Vorabpauschale, Ausschüttungen) und Altersvorsorgedepots; Vermögen zum Jahresende
function marketYear(ctx, y) {
  const { I, persons, useAVD, wStartAbs, endAbs, depots, share, avd, pol } = ctx, { year, mk, L, yearAbs0, saveMonths, avdIn, avdPay, savePart, extraInvest, reinvP, lumpNetP, lumpMP, etfContribP, sells, sellW } = y;
  const wm0 = Math.max(0, wStartAbs - yearAbs0), wm1 = Math.min(12, endAbs - yearAbs0);
  // Verkäufe aus withdrawYear zu ihrem Zeitpunkt, verteilt wie im Probeverkauf
  const plan = sells.some(s => s.gross > 0) ? depotsSellPlan(depots, mk.R, sells, sellW) : null;
  let sold = 0;
  depots.forEach((d, i) => {
    const s = share[i], opts = buyTiming([[savePart * s, 0, saveMonths || 12], [extraInvest * s, wm0, wm1], [reinvP[i] - lumpNetP[i], 0, 12], [lumpNetP[i], lumpMP[i], 12]]);
    if (plan) opts.sell = plan[i].map(x => ({ ...x, mode: I.depot.sellMode }));
    const dy = depotYear(d, year, mk.R, etfContribP[i], L.basiszins, opts);
    sold += dy.sold;
    // Ausschüttungen brutto in aktiven Fonds (FIFO-Staffelung)
    if (dy.reinvestGross > 0) depotBuy(d, I.depot.divRedirect ? dy.activeIdx : 0, dy.reinvestGross, year);
    ctx.pendingKap[i] = dy.distTaxable + dy.vpTaxable;
    ctx.pendingKapGross[i] = dy.dist + dy.vp;
  });
  // Kursverlust bis zum Verkaufszeitpunkt: Was die Depots dann nicht mehr hergeben, fehlt in der Entnahme (Fehlbetrag)
  const unsold = sum(sells.map(s => s.gross)) - sold;
  if (unsold > 1 && y.inWithdraw) Object.assign(y, { G: Math.max(0, y.G - unsold), sellG: y.sellG - unsold, netIncome: y.netIncome - unsold, shortfall: true });

  // ── Markt: Altersvorsorgedepot ──
  persons.forEach((p, i) => {
    if (!useAVD || !p.avd.on) return;
    const a = avd[i], cost = Math.min(p.avd.cost, AVD.costMax) + p.avd.ter;   // Depotkosten plus Fondskosten (TER)
    if (avdIn[i].cF + avdIn[i].cU === 0) avdGrowPaid(a, mk.R, cost, avdPay[i].gross, avdPay[i].t);
    else { avdSaveYear(a, mk.R, cost, avdIn[i].cF, avdIn[i].cU, avdIn[i].zul, avdIn[i].m / 24); avdPaidGain(a, mk.R - cost, avdPay[i].gross, avdPay[i].t); }
  });
  const pvP = pol.map(o => sumPol(o, q => q ? q.s.K : 0));   // Vertragswerte je Person
  const pvKeep = sum(pol.map(o => sumPol(o, q => q && q.s0 >= endAbs ? q.s.K : 0)));   // nur Verträge, die bis zum Zielalter nicht verrentet werden (zählen auch im Endvermögen)
  const dvP = depots.map(depotValue);
  Object.assign(y, { dvP, dv: sum(dvP), av: avd.map(avdValue), pvP, pvSum: sum(pvP), pvKeep });
}

// Jahreszeile (nur bei opt.detail) mit Aufteilung nach Personen (pp)
function buildRow(ctx, y) {
  const { persons, units, unitOf, share, ep, depots, pol } = ctx;
  const { year, L, priceIdx, work, grv, grvTaxable, saveMonths, wMonths, inWithdraw, loanPay, loanSonder, budget, avdIn, polIn, budgetCut, basisDed, zulSum,
    avdPay, kvShare, grvW, avdW, polPay, polW, polTaxable, G, ev, extraInvest, netIncome, wT, houseG, sellG, debt,
    basisRefund, refund, lumpTax, lumpTaxPer, lumpPer, taxFromBudget, taxSale, houseTax, taxFromHouse, saleX, avdReinvest, etfContrib, reinvP, etfContribP, refundPer, polRefund, dv, dvP, av, pvP, pvSum } = y;
  const pv = persons.map((p, i) => Object.fromEntries(POLICIES.map(k => [k, pol[i][k] ? pol[i][k].s.K : 0])));
  const basisRefundPer = polRefund.map(o => sumPol(o, x => x));
  // ── Aufteilung nach Personen ──
  // ETF-Depot, Verkäufe und Kapitalertragsteuer je Person aus dem eigenen Depot, Kredit je zur Hälfte.
  // Einkommensteuer der Steuereinheit nach Anteil am steuerpflichtigen Einkommen ohne Kapital innerhalb der Einheit.
  // Steuererstattung aus § 10a nach Anteil am Sonderausgabenabzug.
  const np = persons.length;
  const taxBase = persons.map((p, i) => Math.max(0, earnedTaxable(p, work[i], L) + grvTaxable[i] + avdPay[i].taxable + polTaxable[i]));
  const mB = units.map((u, j) => unitMarginal(y, u, j, ev.zvEU[j], true));
  const pp = persons.map((p, i) => {
    const j = unitOf[i], u = units[j], tU = ev.itU[j].total, taxBaseSum = sum(u.idx.map(k => taxBase[k]));
    // Kirchensteuer nur nach Satz der Person (taxBase · Satz), der Rest der Steuer nach Anteil am steuerpflichtigen Einkommen
    const kU = ev.itU[j].kist, kw = u.idx.map(k => (taxBase[k] || (taxBaseSum > 0 ? 0 : 1)) * (persons[k].kist || 0)), kwS = sum(kw);
    const kistShare = kwS > 0 ? kU * kw[u.idx.indexOf(i)] / kwS : 0;
    const estShare = (taxBaseSum > 0 ? (tU - kU) * taxBase[i] / taxBaseSum : (tU - kU) / u.idx.length) + kistShare;
    const kvI = ev.kvR.per[i];
    // Einkommensteuer je Produkt als Grenzsteuer (ESt + Soli gestapelt, mB), dazu die Kirchensteuer der Person nach diesem Anteil; KV-Beiträge je Quelle (für die Rendite je Produkt)
    const m = mB[j][u.idx.indexOf(i)], mS = m.grv + m.avd + sumPol(m, x => x), kf0 = kistShare > 0 ? kistShare / Math.max(estShare - kistShare, mS) : 0;
    const estBy = { avd: m.avd * (1 + kf0), ...Object.fromEntries(POLICIES.map(k => [k, m[k] * (1 + kf0)])) };
    // Kapitalsteuer je Person nach ihrem Anteil (taxP), auch die Teile aus Budget, Verkauf und Ablösung: kapTax = kapTaxW + taxFromBudget + taxSale + houseTax je Person
    const kf = ev.kt.tax > 0 ? ev.kt.taxP[i] / ev.kt.tax : 1 / np;
    const sold = ev.sale.per[i].sold, Gi = ev.sale.sold > 0 ? G * sold / ev.sale.sold : 0, kapW = ev.kt.taxW * kf;
    const net = inWithdraw ? grvW[i] + avdW[i] + polW[i] + Gi - estShare * wT - kapW - kvI * kvShare[i] - extraInvest * share[i] : 0;
    const o = {
      etf: dvP[i], avd: av[i], etfContrib: etfContribP[i], avdReinvest: reinvP[i], taxFromBudget: taxFromBudget * kf, taxSale: taxSale * kf, houseTax: houseTax * kf, taxFromHouse: taxFromHouse * kf, saleX: saleX / np, avdIn: avdIn[i].cF + avdIn[i].cU, zul: avdIn[i].zul,
      refund: refundPer[i], loanPay: loanPay / np, loanSonder: loanSonder / np, budget: budget / np, debt: debt / np, netWorth: dvP[i] - debt / np + av[i] + pvP[i],
      basisRefund: basisRefundPer[i], lump: lumpPer[i], lumpTax: lumpTaxPer[i],
      grv: grv[i], avdPay: avdPay[i].gross, etfSale: sold, grvW: grvW[i], avdPayW: avdW[i], estW: estShare * wT, kvW: kvI * kvShare[i], kapTaxW: kapW,
      est: estShare, kist: kistShare, kapTax: ev.kt.taxP[i], kv: kvI, net, total: dvP[i] + av[i] + pvP[i], estBy, kvBy: ev.kvR.by[i] || { avd: 0, basis: 0, prv: 0, etf: 0 },
      funds: depots[i].funds.map(fundValue),
    };
    for (const k of POLICIES) polFields(o, k, pv[i][k], polIn[i][k], polPay[i][k]);
    return o;
  });
  const row = {
    year, ages: persons.map(p => ageAt(p, year)),
    phase: inWithdraw ? 'Entnahme' : (saveMonths > 0 ? 'Ansparen' : 'Übergang'), saveMonths, wMonths,
    priceIdx, etf: dv, avd: av, total: dv + sum(av) + pvSum,
    basisRefund, lump: lumpPer, lumpTax, budgetCut,
    etfContrib, avdReinvest, taxFromBudget, taxSale, houseTax, taxFromHouse, saleX, avdIn: avdIn.map(a => a.cF + a.cU), zulagen: zulSum, refund, loanPay, loanSonder, budget,
    debt, netWorth: dv + sum(av) + pvSum - debt,
    grv, avdPay: avdPay.map(a => a.gross), etfSale: sellG, houseSale: houseG,
    grvW, avdPayW: avdW, estW: ev.it.total * wT, kapTaxW: ev.kt.taxW, kvW: sum(ev.kvR.per.map((c, i) => c * kvShare[i])),
    est: ev.it.est, soli: ev.it.soli, kist: ev.it.kist, kapTax: ev.kt.tax,
    kv: ev.kvR.tot, net: inWithdraw ? netIncome : 0, extraInvest,
    basisDed, ep: [...ep], funds: pp[0].funds.map((f, k) => sum(pp.map(o => o.funds[k]))), pp,
  };
  for (const k of POLICIES) polFields(row, k, pv.map(o => o[k]), polIn.map(o => o[k]), polPay.map(o => o[k]));
  return row;
}

// ═══════════════════════════════════════════════════════════════
// simulate(I, A, opt)
//   opt.scenario: 'A' (nur ETF) | 'B' (eingeschaltete Vorsorgeprodukte, Rest ETF)
//   opt.targetReal: Ziel-Nettoeinkommen/Monat in Kaufkraft 2026 (Strategien realConst und perpetual)
//   opt.path: [{R, infl}] je Jahr (Monte Carlo), sonst deterministisch
//   opt.detail: Jahreszeilen mitschreiben
// ═══════════════════════════════════════════════════════════════
function simulate(I, A, opt) {
  const ctx = simCtx(I, A, opt);
  const { depots, avd, pol, loans } = ctx;
  const rows = [];
  for (let year = ctx.Y0; year <= ctx.endYear; year++) {
    const y = yearBase(ctx, year);
    workAndPension(ctx, y);
    loansYear(ctx, y);
    contribYear(ctx, y);
    payoutsYear(ctx, y);
    withdrawYear(ctx, y);
    refundsAndInvest(ctx, y);
    marketYear(ctx, y);
    if (year === ctx.wStartYear - 1) ctx.startReal = (y.dv + sum(y.av) + y.pvKeep - y.debt) / y.priceIdx;
    if (y.inWithdraw && y.shortfall && !ctx.depleted) { ctx.depleted = true; ctx.depletedYear = year; }
    if (opt.detail) rows.push(buildRow(ctx, y));
  }

  const polCap = sum(pol.map(o => sumPol(o, q => q ? q.s.K : 0)));
  const final = depotsValue(depots) + avd.reduce((s, a) => s + avdValue(a), 0) + polCap;
  // Abgeltungsteuer, die beim Verkauf der Restdepots fällig wäre (ohne Sparerpauschbetrag; für die Rendite des ETF-Depots)
  let etfTaxLatent = 0;
  if (opt.detail) {
    const sl = depotsSell(depots, depotsValue(depots), I.depot.sellMode, true), pos = sl.per.map(x => Math.max(0, x.taxable)), ps = sum(pos);
    const rt = ctx.persons.map(p => kapRate(p.kist || 0));
    etfTaxLatent = Math.max(0, sl.taxable) * (ps > 0 ? sum(pos.map((x, i) => x * rt[i])) / ps : rt[0]);
  }
  return {
    rows, depleted: ctx.depleted, depletedYear: ctx.depletedYear, wStartYear: ctx.wStartYear, wFullYear: ctx.wFullYear, endYear: ctx.endYear, startReal: ctx.startReal,
    finalReal: (final - loans.reduce((a, l) => a + l.bal, 0)) / ctx.priceIdx,
    final, etfTaxLatent,
    kv: ctx.kv, sumZulagen: ctx.sumZulagen, sumRefunds: ctx.sumRefunds, houseSale: ctx.houseSale, loans, sumBasisRefund: ctx.sumBasisRefund,
    pol: pol.map(o => Object.fromEntries(POLICIES.map(k => [k, o[k] && { ...o[k].s, s0: o[k].s0, half: o[k].half }]))),
    ep: ctx.ep,
  };
}

// AVD-Parameter (AltVRefG, verkündet BGBl. 2026 I Nr. 156)
// costMax: Depotkosten im Rechner höchstens 1 % (Annahme). Gesetzlich gedeckelt sind beim Standarddepot die Effektivkosten
// (§ 2a Abs. 2 AltZertG n. F.); ob die TER der Fonds dazuzählt, regeln Gesetz und AltvPIBV nicht ausdrücklich.
const AVD = { g1: 0.5, g1Cap: 360, g2: 0.25, fMax: 1800, minEigen: 120, kindMax: 300, einMax: 6840, payMin: 65, payMax: 70, planEndMin: 85, teilMax: 0.3, costMax: 0.01 };
