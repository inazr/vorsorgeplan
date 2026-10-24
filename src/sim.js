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
  rentenAlter: 67,
};

// Hinweis: SV-Tabellen ignorieren den Entwurfsschalter A.useDraft; SV-Werte mit Status E gelten immer (der Schalter betrifft nur Steuertarif und Kinderwerte)
function idxVal(table, year, growth) { // Wert aus Tabelle, danach mit growth fortgeschrieben
  const { y: base, v } = lawPick(table, year);
  return v * Math.pow(1 + growth, Math.max(0, year - base));
}
// Höchstbetrag Altersvorsorgeaufwendungen je Person = Höchstbeitrag zur knappschaftlichen RV (§ 10 Abs. 3 S. 1 EStG)
const hbFor = L => Math.ceil(L.bbgKn * (L.rvSatz + SV.knAufschlag));
const hbYear = y => hbFor({ bbgKn: idxVal(SV.bbgKn, y, 0), rvSatz: lawPick(SV.rvSatz, y).v }); // Anzeige: Tabellenwerte ohne Fortschreibung

// Rentenwert ab 1.7. des Jahres y: Tabelle, danach Anpassung = Lohnwachstum, nach der Haltelinie gedämpft
function rwJul(y, A) {
  const ys = Object.keys(SV.rw).map(Number), last = Math.max(...ys);
  if (y <= last) return SV.rw[Math.max(...ys.filter(k => k <= y), Math.min(...ys))]; // in der Tabelle: letzter Eintrag ≤ y, davor der erste
  let rw = SV.rw[last];
  for (let k = last + 1; k <= y; k++) rw *= 1 + A.wageGrowth - (k > SV.halteBis ? A.rentenDaempfung : 0);
  return rw;
}
// Jahresrente aus e Entgeltpunkten: Monate Jan-Jun mit dem Wert ab 1.7. des Vorjahres, Jul-Dez mit dem neuen Wert; ab Monat fromAbs
function grvYear(e, zf, year, fromAbs, A) {
  const h1 = monthsIn(year, fromAbs, year * 12 + 6), h2 = monthsIn(year, Math.max(fromAbs, year * 12 + 6), Infinity);
  return e * zf * (h1 * rwJul(year - 1, A) + h2 * rwJul(year, A));
}
function lawYear(year, A, priceIdx) {
  const { p, idx } = tariffFor(year, { useDraft: A.useDraft, indexTariff: A.indexTariff, inflation: A.inflation });
  const { y: kY, v: kd } = lawPick(LAW.kinder, year, A.useDraft);
  const kIdx = year > kY && A.indexTariff ? Math.pow(1 + A.inflation, year - kY) : 1;
  const w = A.wageGrowth;
  return {
    year, p, idx,
    soliFG: LAW.soli.freigrenzeSplit * (A.indexTariff ? Math.max(1, Math.pow(1 + A.inflation, year - 2026)) : 1),
    kfb: kd.kfb * kIdx, kg: kd.kg * kIdx * 12,
    anPausch: lawPick(LAW.pausch.anPausch, year, A.useDraft).v * kIdx,
    bbgRV: idxVal(SV.bbgRV, year, w), bbgKn: idxVal(SV.bbgKn, year, w), rvSatz: lawPick(SV.rvSatz, year).v, bbgKV: idxVal(SV.bbgKV, year, w), de: idxVal(SV.de, year, w),
    bez: idxVal(SV.bez, year, w),
    zus: A.zusatz + A.zusatzDrift * Math.max(0, year - 2026),
    pv: SV.pv + A.pvDrift * Math.max(0, year - 2026),
    basiszins: (LAW.basiszins[year] ?? A.basiszins * 100) / 100,
    priceIdx,
  };
}

// Einkommensteuer Splitting + Soli, mit Kinder-Günstigerprüfung
function estSplit(zvE, L) {
  if (zvE <= 0) return 0;
  return 2 * L.idx * estGrund(zvE / 2 / L.idx, L.p);
}
function soliOf(estBase, L) {
  if (estBase <= L.soliFG) return 0;
  return Math.min(LAW.soli.satz * estBase, LAW.soli.milderung * (estBase - L.soliFG));
}
function incomeTax(zvE, nKids, L) {
  const e0 = estSplit(zvE, L);
  let est = e0, soliBase = e0;
  if (nKids > 0) {
    const eK = estSplit(zvE - nKids * L.kfb, L);
    const kg = nKids * L.kg;
    if (eK + kg < e0) est = eK + kg; // Freibetrag günstiger: Kindergeld wird hinzugerechnet
    soliBase = eK;
  }
  const soli = soliOf(soliBase, L);
  return { est, soli, total: est + soli };
}

// Kapitalertragsteuer mit Pauschbetrag (Freistellungsauftrag), Verlustvortrag, optional Günstigerprüfung
function kapTax(kapTaxable, lossCarry, L, zvEOther, nKids, A, pb = LAW.sparerPB) {
  let base = kapTaxable - lossCarry;
  let newLoss = 0;
  if (base < 0) { newLoss = -base; base = 0; }
  const pbUsed = Math.min(Math.min(pb, LAW.sparerPB), base), afterSPB = Math.max(0, base - Math.min(pb, LAW.sparerPB));   // pbUsed: vom Depot verbrauchter Teil des Pauschbetrags
  const abg = afterSPB * LAW.abgSt * (1 + LAW.soliKap);
  let tax = abg, guenstiger = false;
  if (A.guenstiger && afterSPB > 0) {
    const t0 = incomeTax(zvEOther, nKids, L).total, t1 = incomeTax(zvEOther + afterSPB, nKids, L).total;
    if (t1 - t0 < abg) { tax = t1 - t0; guenstiger = true; }
  }
  return { tax, newLoss, afterSPB, guenstiger, pbUsed };
}

// ─── Personen-Helfer ───
function retireStartAbs(P) { return (P.by + P.retireAge) * 12 + (P.bm - 1) + 1; } // Monat nach Geburtstag
function monthsRetired(P, year) { return monthsIn(year, retireStartAbs(P), Infinity); }
// Anzahl der Monate des Jahres im Zeitraum [from, to) (absolute Monate: Jahr * 12 + Monat − 1)
function monthsIn(year, from, to) { return Math.max(0, Math.min(year * 12 + 12, to) - Math.max(year * 12, from)); }
function avdPayStartAbs(P) { return (P.by + P.avd.payStart) * 12 + P.bm; } // Monat nach Geburtstag
function policyPayStartAbs(P, k) { return (P.by + P[k].payStart) * 12 + P.bm; } // Rentenbeginn Basisrente / private RV
// Monate mit Kind bis einschließlich Geburtstagsmonat zum Alter untilAge
function kidMonths(c, year, untilAge) { const b = c.by * 12 + (c.bm ?? 1) - 1; return monthsIn(year, b, b + untilAge * 12 + 1); }
// Mittlerer Kaufzeitpunkt (Jahresbruchteil) und Zwölftelung der Vorabpauschale für Zahlungen [Betrag, Monat von, Monat bis)
function buyTiming(parts) {
  let s = 0, t = 0, v = 0;
  for (const [amt, m0, m1] of parts) if (amt > 0) { s += amt; t += amt * (m0 + m1) / 24; v += amt * (25 - m0 - m1) / 24; }
  return s > 0 ? { buyT: t / s, vpFracNew: v / s } : { buyT: 0.5, vpFracNew: 6.5 / 12 };
}
function zugangsfaktor(P) {
  const m = (P.retireAge - SV.rentenAlter) * 12;
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

// Annahme: Anteil der Auszahlungen vor Entnahmestart (Steuer und SV), der nicht reinvestiert wird
const REINVEST_ABZUG = 0.3;
// Steuerpflichtiger Rentenanteil: im Startjahr gross · Besteuerungsanteil, danach wird der Freibetrag (im ersten vollen Jahr) festgeschrieben; st = { fb: null }
function taxablePension(gross, startYear, year, st) {
  const ba = LAW.besteuerungsanteil(startYear);
  if (year === startYear) return gross * ba;
  if (st.fb == null) st.fb = gross * (1 - ba);
  return Math.max(0, gross - st.fb);
}
// Steuerpflichtiges Erwerbseinkommen einer Person (Arbeitnehmer: abzüglich Arbeitnehmerpauschbetrag); floor0: Arbeitnehmeranteil nicht unter 0
// (zvEBase ja; taxBase nein, dort wird erst die Summe mit den Renten bei 0 gekappt, sonst verschöbe sich die Aufteilung der ESt bei Einkommen unter dem Pauschbetrag)
function earnedTaxable(p, w, L, floor0) { if (p.job !== 'employee') return w.g; const x = w.g - (w.m > 0 ? L.anPausch : 0); return floor0 ? Math.max(0, x) : x; }
// Summe eines Arrays (auch in ui.js genutzt)
const sum = a => a.reduce((x, y) => x + y, 0);
// Summe von f(o[k], k) über alle Versicherungsprodukte (Reihenfolge wie POLICIES)
const sumPol = (o, f) => POLICIES.reduce((s, k) => s + f(o[k], k), 0);
// Zeilenfelder je Produkt: Kapital k, Einzahlung kIn, Rente kPay, davon in Entnahmemonaten kPayW (je Person oder als Arrays)
function polFields(o, k, v, io, pay) {
  const m = (x, f) => Array.isArray(x) ? x.map(f) : f(x);
  o[k] = v; o[k + 'In'] = m(io, x => x.c + x.z); o[k + 'Pay'] = m(pay, x => x.gross); o[k + 'PayW'] = m(pay, x => x.W);
}

// KV/PV der Rentner je Person (eigener Anteil). Kapitalerträge hälftig je Ehegatte.
function kvRetire(ctx, y, kapPerPerson) {
  const { persons, kv, opt } = ctx, { year, L, pvZu, grv, avdPay, polPay, polGross, lumpKV } = y;
  let tot = 0, deductible = 0;
  const per = persons.map(() => 0);
  // Nur in der Detailrechnung: Beiträge freiwillig Versicherter je Quelle (für die Rendite je Produkt)
  const by = opt.detail ? persons.map(() => ({ avd: 0, basis: 0, prv: 0, etf: 0 })) : null;
  persons.forEach((p, i) => {
    const m = monthsRetired(p, year);
    if (m <= 0) return;
    const f = m / 12, bbg = L.bbgKV * f;
    const pvRate = L.pv + pvZu;
    if (kv[i].pkv) {   // Private KV: Beitrag unabhängig vom Einkommen, Zuschuss der DRV (§ 106 SGB VI) max. halber Beitrag
      const g = Math.pow(1 + (p.pkvGrowth ?? 0.03), year - 2026);
      const prem = Math.max(0, (p.pkvPremium - (p.pkvRelief || 0)) * g) * 12 * f;
      const zus = Math.min(grv[i] * (SV.kvGen + L.zus) / 2, prem / 2);
      const c = prem - zus;
      tot += c; deductible += Math.max(0, prem * (p.pkvBasis ?? 0.85) - zus); per[i] = c;
      return;
    }
    const bR = Math.min(grv[i], bbg);
    let c = bR * ((SV.kvGen + L.zus) / 2 + pvRate);   // KVdR und freiwillig: DRV trägt die Hälfte der KV
    // KVdR-Pflichtversicherte: nach § 237 SGB V zählen nur Rente, Versorgungsbezüge (§ 229) und Arbeitseinkommen.
    // Das AVD gehört zur privaten Vorsorge und steht nicht im Katalog des § 229 (betrieblich nimmt § 229 Abs. 1 Nr. 5 Altersvorsorgevermögen nach § 92 EStG sogar aus).
    if (!kv[i].ok) {
      const rest = Math.max(0, bbg - bR);
      // Freiwillig: Beiträge auch auf Versicherungsrenten (voller Zahlbetrag) und Kapitalauszahlungen
      const sonst = Math.max(0, avdPay[i].gross + polGross[i] + lumpKV[i] + kapPerPerson * f);
      const bS = Math.min(sonst, rest);
      const fehl = Math.max(0, L.bez / 3 * f - bR - bS);   // Mindestbemessung
      c += (bS + fehl) * (SV.kvErm + L.zus + pvRate);
      if (by && sonst > 0) {
        const q = bS * (SV.kvErm + L.zus + pvRate) / sonst;
        Object.assign(by[i], { avd: avdPay[i].gross * q, basis: polPay[i].basis.gross * q, prv: (polPay[i].prv.gross + lumpKV[i]) * q, etf: kapPerPerson * f * q });
      }
    }
    tot += c; deductible += c; per[i] = c;
  });
  return { tot, deductible, per, by };
}

// Steuer + SV für gegebenen ETF-Verkauf G (Probeverkauf, das Depot bleibt unverändert)
function evalYear(ctx, y, G) {
  const { I, A, depot, pb, wStartAbs, pendingKap } = ctx, { L, nKids, otherIncome, vorsorge, inWithdraw, yearAbs0 } = y;
  const sale = G > 0 ? depotSell(depot, G, I.depot.sellMode, true) : { sold: 0, taxable: 0 };
  const kapT = pendingKap + sale.taxable;
  // KV-Basis freiwillig: Gewinn inkl. Ausschüttung/VP, ohne Sparerpauschbetrag; Teilfreistellung per Schalter
  const kapForKV = Math.max(0, A.kvTeilfreistellung ? kapT : kapT / 0.7);
  const kvR = kvRetire(ctx, y, kapForKV / 2);
  const zvE = Math.max(0, otherIncome - vorsorge - kvR.deductible - LAW.pausch.sonderausg);
  const it = incomeTax(zvE, nKids, L);
  const kt = kapTax(kapT, depot.lossCarry, L, zvE, nKids, A, pb);
  // Steuer auf Vorabpauschale/Ausschüttungen des Vorjahres ist im Januar fällig, Steuer auf Verkäufe in der Entnahme
  kt.taxW = !inWithdraw ? 0 : wStartAbs <= yearAbs0 ? kt.tax : Math.max(0, kt.tax - kapTax(pendingKap, depot.lossCarry, L, zvE, nKids, A, pb).tax);
  return { sale, it, kt, kvR, zvE };
}

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

  const depot = makeDepot({ funds: I.depot.funds, startValue: I.depot.startValue, startCost: I.depot.startCost, startYear: Y0 });
  const avd = persons.map(() => makeAVD());
  const kv = persons.map(p => kvdrCheck(p, I.children.length));
  const ep = persons.map(p => p.epNow);
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
  const loans = makeLoans(I.loans || [], Y0 * 12);
  const pb = I.depot.freistellung ?? LAW.sparerPB;   // Freistellungsauftrag für das ETF-Depot
  return {
    I, A, opt, Y0, persons, useAVD, saveEndAbs, wStartAbs, wStartYear, wFullYear, endAbs, endYear,
    depot, avd, kv, ep, renteFB, renteStartY, pol, kvLump, pendAvd, pendPol, loans, pb,
    priceIdx: 1, pendingKap: 0, pendingRefund: 0, depleted: false, depletedYear: null,
    sumZulagen: 0, sumRefunds: 0, houseSale: null, sumBasisRefund: 0,
    startReal: I.depot.startValue,   // reales Nettovermögen zu Entnahmebeginn (Ende des Vorjahres)
  };
}

// Jahresgrundlagen: Markt, Preisindex, Gesetzeswerte, Kinder (Kindergeld, Kinderfreibetrag, PV-Abschlag), Spar- und Entnahmemonate
function yearBase(ctx, year) {
  const { I, A, opt, Y0, saveEndAbs, wStartAbs, endAbs } = ctx;
  const t = year - Y0;
  const mk = opt.path ? opt.path[t] : { R: A.ret, infl: A.inflation };
  if (t > 0) ctx.priceIdx *= 1 + (opt.path ? opt.path[t - 1].infl : A.inflation);
  const L = lawYear(year, A, ctx.priceIdx);
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
  return { year, t, mk, L, priceIdx: ctx.priceIdx, kgKids, nKids, pvZu, yearAbs0: year * 12, saveMonths, wMonths, inWithdraw: wMonths > 0 };
}

// Erwerbseinkommen (anteilig bis Rentenbeginn), Entgeltpunkte, gesetzliche Rente, Vorsorgeaufwendungen der Erwerbsphase
function workAndPension(ctx, y) {
  const { A, persons, ep, renteFB, renteStartY } = ctx, { year, t, L, pvZu } = y;
  const work = persons.map((p, i) => {
    const m = 12 - monthsRetired(p, year);
    const g = p.income * Math.pow(1 + p.incomeGrowth, t) * m / 12;
    return { m, g };
  });
  // Entgeltpunkte (nur Pflichtversicherte)
  persons.forEach((p, i) => { if (p.grvMode !== 'prognose' && p.rvPflicht && work[i].m > 0) ep[i] += Math.min(work[i].g, L.bbgRV * work[i].m / 12) / L.de; });

  // ── Gesetzliche Rente ──
  const grv = persons.map((p, i) => {
    const m = monthsRetired(p, year);
    if (m <= 0) return 0;
    const e = p.grvMode === 'prognose' ? p.grvPrognose / p.grvRwInfo : ep[i];
    return grvYear(e, zugangsfaktor(p), year, retireStartAbs(p), A);
  });
  const grvTaxable = grv.map((g, i) => {
    if (g <= 0) return 0;
    return taxablePension(g, renteStartY[i], year, renteFB[i]);
  });

  // ── Vorsorgeaufwendungen Erwerbsphase ──
  let vorsorge = 0;
  persons.forEach((p, i) => {
    const w = work[i]; if (w.m <= 0) return;
    const bbgKV = L.bbgKV * w.m / 12, bbgRV = L.bbgRV * w.m / 12;
    if (p.job === 'employee') {
      if (p.rvPflicht) vorsorge += L.rvSatz / 2 * Math.min(w.g, bbgRV);
      vorsorge += ((SV.kvGen + L.zus) / 2 * (p.krankengeld ? 1 - SV.kgAbzug : 1) + L.pv / 2 + pvZu) * Math.min(w.g, bbgKV);
    } else {
      const rate = p.krankengeld ? SV.kvGen : SV.kvErm;
      if (p.rvPflicht) vorsorge += L.rvSatz * Math.min(w.g, bbgRV);   // Pflichtversicherte Selbständige tragen den vollen Beitrag
      vorsorge += ((rate + L.zus) * (p.krankengeld ? 1 - SV.kgAbzug : 1) + L.pv + pvZu) * Math.min(w.g, bbgKV);
    }
  });
  // Grundlage zvE ohne Kapital
  const zvEBase = persons.reduce((s, p, i) => s + earnedTaxable(p, work[i], L, true), 0);
  Object.assign(y, { work, grv, grvTaxable, vorsorge, zvEBase });
}

// Kreditraten des Jahres, Ablösungen außerhalb der Entnahme, Spar-Budget nach Kreditraten
function loansYear(ctx, y) {
  const { I, loans, saveEndAbs, wStartAbs, endAbs } = ctx, { t, yearAbs0, saveMonths } = y, B = I.budget;
  let loanPay = 0, loanSonder = 0, loanPayoff = 0, loanInSave = 0, loanInW = 0, payoffInW = 0;
  const payoffs = [];
  for (const l of loans) for (let m = 0; m < 12; m++) {
    const a = yearAbs0 + m, o = loanMonth(l, a, false);
    loanPay += o.pay + o.sonder; loanSonder += o.sonder; loanPayoff += o.payoff;
    if (a < saveEndAbs) loanInSave += o.pay + o.sonder;
    if (a >= wStartAbs && a < endAbs) { loanInW += o.pay + o.sonder; payoffInW += o.payoff; }
    else if (o.payoff > 0) payoffs.push({ l, amt: o.payoff });
  }
  const payoffOut = loanPayoff - payoffInW;   // Ablösung außerhalb der Entnahme: Verkauf aus dem Depot
  const budget = B.monthly * Math.pow(1 + B.dyn, t) * saveMonths;
  // In der Entnahme werden Kreditraten aus der Rente bezahlt (zählen als Ausgabe der Entnahme)
  Object.assign(y, { loanPay, loanSonder, loanInW, payoffInW, payoffs, payoffOut, budget, sparBudget: Math.max(0, budget - loanInSave) });
}

// AVD- und Versicherungsbeiträge, Kürzung aufs Sparbudget, Zulagen, Zuzahlungen aus Erstattungen, Ansparen und Verrentung, Basisrenten-Abzug
function contribYear(ctx, y) {
  const { Y0, persons, useAVD, saveEndAbs, avd, pol, kvLump, pendAvd, pendPol } = ctx, { year, mk, L, kgKids, work, yearAbs0, sparBudget } = y;
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
    const zk = kgKids.filter(c => c.zulageTo === i).length;
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
      policyAnnuitize(q.s, q.cfg, year, teilOf(q.cfg, k));
      if (q.s.lump > 0) { lumps.push({ i, k, amt: q.s.lump, gain: q.s.gain, half: q.half, m: mG }); kvLump[i].push({ amt: q.s.lump, from: q.s0 }); }
    }
  }));
  // Höchstbetrag für abzugsfähige Versicherungen (Basisrente): gemeinsamer Höchstbetrag minus Beiträge zur gesetzlichen RV (Angestellte AN- plus AG-Anteil, Selbständige ihr voller Beitrag)
  const grvBeitr = sum(persons.map((p, i) => p.rvPflicht && work[i].m > 0 ? L.rvSatz * Math.min(work[i].g, L.bbgRV * work[i].m / 12) : 0));
  const basisPaid = sum(polIn.map(o => sumPol(o, (x, k) => POLICY_DEF[k].deduct ? x.c + x.z : 0)));
  const basisDed = Math.min(basisPaid, Math.max(0, persons.length * hbFor(L) - grvBeitr));

  // §10a Günstigerprüfung: Zulagen und Sonderausgabenabzug
  const zulSum = avdIn.reduce((s, a) => s + a.zul, 0);
  const dedSum = avdIn.reduce((s, a) => s + a.cF + a.zul, 0);
  Object.assign(y, { avdIn, polIn, budgetCut, refundEtf, lumps, basisPaid, basisDed, zulSum, dedSum });
}

// AVD-Auszahlung, Versicherungsrenten, Anteile der Entnahmemonate, KV-Bemessung aus Kapitalauszahlungen, steuerpflichtiges Einkommen ohne Kapital
function payoutsYear(ctx, y) {
  const { persons, useAVD, wStartAbs, endAbs, avd, pol, kvLump } = ctx, { year, grv, grvTaxable, zvEBase, yearAbs0 } = y;
  // ── Entnahme / laufende Rechnung ──
  // AVD-Auszahlungen ab dem Monat nach dem Geburtstag zum Auszahlungsbeginn, Restkapital / Restmonate
  const avdPay = persons.map((p, i) => {
    const none = { gross: 0, taxable: 0, m: 0, mW: 0 };
    if (!useAVD || !p.avd.on) return none;
    const a = avd[i];
    const s0 = avdPayStartAbs(p), s1 = s0 + (p.avd.payEnd - p.avd.payStart + 1) * 12;
    const m = monthsIn(year, s0, s1);
    if (m <= 0 || avdValue(a) <= 0) return none;
    let res = { gross: 0, taxable: 0 };
    const half = avdHalf(a, s0, p);
    if (!a.paying) {
      a.paying = true;
      if (p.avd.teilkapital > 0) res = avdWithdraw(a, avdValue(a) * p.avd.teilkapital, half);
    }
    const left = s1 - Math.max(s0, yearAbs0);
    const r2 = avdWithdraw(a, left <= m ? avdValue(a) : avdValue(a) * m / left, half);
    return { gross: res.gross + r2.gross, taxable: res.taxable + r2.taxable, m, mW: monthsIn(year, Math.max(s0, wStartAbs), Math.min(s1, endAbs)) };
  });
  // Anteile, die in die Entnahmemonate fallen (Renten und KV je Person, Einkommensteuer nach Einkommensanteil)
  const kvShare = persons.map(p => { const mR = monthsRetired(p, year); return mR > 0 ? monthsIn(year, Math.max(retireStartAbs(p), wStartAbs), endAbs) / mR : 0; });
  const grvW = grv.map((g, i) => g * kvShare[i]);
  const avdW = avdPay.map(a => a.m > 0 ? a.gross * a.mW / a.m : 0);
  // Versicherungsrenten: Basisrente mit Besteuerungsanteil wie die gesetzliche Rente, private RV mit Ertragsanteil
  const polPay = persons.map((p, i) => Object.fromEntries(POLICIES.map(k => {
    const q = pol[i][k]; if (!q || !q.s.paying) return [k, { gross: 0, taxable: 0, W: 0 }];
    const m = monthsIn(year, q.s0, Infinity);
    const gross = policyRent(q.s, q.cfg, year, m);
    let taxable = 0;
    if (gross > 0 && POLICY_DEF[k].rentTax === 'kohorte') {
      taxable = taxablePension(gross, Math.floor(q.s0 / 12), year, q);
    } else if (gross > 0) taxable = gross * ertragsanteil(q.cfg.payStart);
    const W = m > 0 ? gross * monthsIn(year, Math.max(q.s0, wStartAbs), endAbs) / m : 0;
    return [k, { gross, taxable, W }];
  })));
  const polGross = polPay.map(o => sumPol(o, x => x.gross)), polW = polPay.map(o => sumPol(o, x => x.W));
  const polTaxable = polPay.map(o => sumPol(o, x => x.taxable));
  // KV-Bemessung freiwillig Versicherter: 1/120 der Kapitalauszahlung je Monat über 10 Jahre
  const lumpKV = kvLump.map(ls => sum(ls.map(l => l.amt / INS.kvLumpMonths * monthsIn(year, l.from, l.from + INS.kvLumpMonths))));

  // Einkommen ohne Kapital
  const pensionPers = persons.map((p, i) => grv[i] > 0 || avdPay[i].gross > 0 || polGross[i] > 0);
  const wkRente = pensionPers.filter(Boolean).length * LAW.pausch.rentnerWK;
  const otherIncome = zvEBase + grvTaxable.reduce((a, b) => a + b, 0) + avdPay.reduce((s, a) => s + a.taxable, 0) + sum(polTaxable) - wkRente;

  Object.assign(y, { avdPay, kvShare, grvW, avdW, polPay, polGross, polW, polTaxable, lumpKV, otherIncome });
}

// Entnahme: ETF-Verkauf per Bisektion bis zum Zielnetto, Hausablösung außerhalb der Entnahme aus dem Depot; Verkauf ausführen
function withdrawYear(ctx, y) {
  const { I, opt, depot, loans } = ctx, { year, priceIdx, work, grv, wMonths, inWithdraw, loanInW, payoffInW, payoffs, payoffOut, kvShare, grvW, avdW, avdPay, polGross, polW } = y;
  const evalY = G => evalYear(ctx, y, G);
  let G = 0, ev, extraInvest = 0, netIncome = 0, target = 0, shortfall = false;
  const grossW = sum(grvW) + sum(avdW) + sum(polW);
  const incAll = sum(work.map(w => w.g)) + sum(grv) + sum(avdPay.map(a => a.gross)) + sum(polGross);
  const wT = !inWithdraw ? 0 : incAll > 0 ? grossW / incAll : 1;   // Anteil der Einkommensteuer, der auf die Entnahmemonate fällt

  // Hausablösung über ETF-Entnahme
  let houseG = 0;
  if (payoffOut > 0) {
    let lo = 0, hi = depotValue(depot);
    for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; const e = evalY(mid); const net = mid - e.kt.tax; if (net < payoffOut) lo = mid; else hi = mid; }
    houseG = hi;
  }

  if (inWithdraw) {
    if (I.withdraw.strategy !== 'fixedNet') target = opt.targetReal * wMonths * priceIdx;
    else target = I.withdraw.fixedNet * wMonths * (I.withdraw.fixedIndexed ? priceIdx : 1);
    target += loanInW + payoffInW;   // Kreditraten und Ablösung in den Entnahmemonaten zusätzlich
    const netOf = g => { const e = evalY(g); return { net: grossW + g - e.it.total * wT - e.kt.taxW - sum(e.kvR.per.map((c, i) => c * kvShare[i])), e }; };
    const n0 = netOf(0);
    if (n0.net >= target) { G = 0; ev = n0.e; extraInvest = n0.net - target; netIncome = target; }
    else {
      const maxG = depotValue(depot);
      const nMax = netOf(maxG);
      if (nMax.net < target) { G = maxG; ev = nMax.e; netIncome = nMax.net; shortfall = true; }
      else {
        let lo = 0, hi = maxG;
        for (let k = 0; k < 36; k++) { const mid = (lo + hi) / 2; if (netOf(mid).net < target) lo = mid; else hi = mid; }
        G = hi; ev = netOf(G).e; netIncome = target;
      }
    }
  } else {
    ev = evalY(houseG);
  }

  // Verkauf ausführen
  const sellG = G + houseG;
  if (sellG > 0) depotSell(depot, sellG, I.depot.sellMode, false);
  depot.lossCarry = ev.kt.newLoss;
  if (payoffOut > 0) {
    // Reicht das Depot nicht, läuft der ungedeckte Rest als Anschlussfinanzierung weiter
    const covered = Math.max(0, houseG - ev.kt.tax);
    const gap = payoffOut - covered;
    if (gap > 1) for (const { l, amt } of payoffs) {
      const rem = gap * amt / payoffOut;
      l.bal = rem; l.phase = 'post'; l.rM = loanRateM(l.c.zins); l.pay = annuityM(rem, l.rM, l.c.years * 12); l.postRate = l.pay;
    }
    ctx.houseSale = { year, gross: houseG, tax: ev.kt.tax, payoff: payoffOut, covered: Math.min(covered, payoffOut) };
  }
  Object.assign(y, { G, ev, extraInvest, netIncome, shortfall, wT, houseG, sellG, debt: loans.reduce((a, l) => a + l.bal, 0) });
}

// Erstattungen (Basisrente, § 10a), Steuer auf Kapitalauszahlungen, ETF-Sparrate und Reinvestition, Erstattungen fürs Folgejahr vormerken
function refundsAndInvest(ctx, y) {
  const { persons, pendAvd, pendPol } = ctx, { L, nKids, sparBudget, avdIn, polIn, refundEtf, lumps, basisPaid, basisDed, zulSum, dedSum, avdPay, avdW, polGross, polW, ev, extraInvest } = y;
  // Sonderausgabenabzug Basisrente (§ 10 Abs. 1 Nr. 2 b EStG), danach § 10a-Günstigerprüfung (Steuerersparnis über der Zulage).
  // Beide Erstattungen kommen im Folgejahr und fließen je nach Einstellung ins Produkt, ins ETF-Depot oder in den Konsum.
  const t0 = incomeTax(ev.zvE, nKids, L).total;
  const tBasis = basisDed > 0 ? incomeTax(Math.max(0, ev.zvE - basisDed), nKids, L).total : t0;
  const basisRefund = t0 - tBasis;
  const refund = dedSum > 0 ? Math.max(0, tBasis - incomeTax(Math.max(0, ev.zvE - basisDed - dedSum), nKids, L).total - zulSum) : 0;
  // Kapitalauszahlung private RV: Ertrag nach 15 % Teilfreistellung, bei 12 Jahren und ab 62 zur Hälfte mit persönlichem Steuersatz,
  // sonst Abgeltungsteuer. Der Nettobetrag wird ins ETF-Depot angelegt.
  // Ohne Hälftelung steht der Rest des Sparerpauschbetrags (nach dem Depot und früheren Auszahlungen) zu.
  let zvLump = ev.zvE, lumpNet = 0, lumpTax = 0, pbCons = 0;
  const lumpTaxPer = persons.map(() => 0), lumpPer = persons.map(() => 0);
  for (const l of lumps) {
    const tx = l.gain * (1 - INS.fondsFrei) * (l.half ? 0.5 : 1);
    const pbRest = l.half ? 0 : Math.max(0, LAW.sparerPB - ev.kt.pbUsed - pbCons);
    if (!l.half) pbCons += Math.min(pbRest, tx);
    const t = l.half ? incomeTax(zvLump + tx, nKids, L).total - incomeTax(zvLump, nKids, L).total : Math.max(0, tx - pbRest) * LAW.abgSt * (1 + LAW.soliKap);
    if (l.half) zvLump += tx;
    lumpTax += t; lumpNet += l.amt - t; lumpTaxPer[l.i] += t; lumpPer[l.i] += l.amt;
  }
  const lumpM = lumps.length ? Math.min(...lumps.map(l => l.m)) : 0;

  // ── Sparphase: ETF-Sparrate ──
  // Beiträge aus dem Budget (ohne Zuzahlungen aus Erstattungen)
  const avdOut = avdIn.reduce((s, a) => s + a.cF + a.cU - (a.zuz || 0), 0) + sum(polIn.map(o => sumPol(o, x => x.c)));
  // Kapitalsteuern werden in der Entnahme aus dem Netto, sonst aus dem Sparbudget bezahlt
  const taxOutside = ev.kt.tax - ev.kt.taxW;
  const taxFromBudget = Math.min(taxOutside, Math.max(0, sparBudget - avdOut + refundEtf));
  const savePart = Math.max(0, sparBudget - avdOut - taxOutside + refundEtf);
  // Auszahlungen aus Vorsorgeprodukten vor Entnahmestart werden reinvestiert (grobe Steuer/SV-Annahme 30 %), Kapitalauszahlungen netto
  const avdReinvest = (sum(avdPay.map(a => a.gross)) - sum(avdW) + sum(polGross) - sum(polW)) * (1 - REINVEST_ABZUG) + lumpNet;
  const etfContrib = savePart + extraInvest + avdReinvest;
  // Erstattungen je Person verteilen und fürs Folgejahr vormerken
  const dedPer = avdIn.map(a => a.cF + a.zul);
  const refundPer = persons.map((p, i) => dedSum > 0 ? refund * dedPer[i] / dedSum : 0);
  const polRefund = persons.map((p, i) => Object.fromEntries(POLICIES.map(k => [k, POLICY_DEF[k].deduct && basisPaid > 0 ? basisRefund * (polIn[i][k].c + polIn[i][k].z) / basisPaid : 0])));
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
  Object.assign(y, { basisRefund, refund, lumpNet, lumpTax, lumpTaxPer, lumpPer, lumpM, taxFromBudget, savePart, avdReinvest, etfContrib, refundPer, polRefund });
}

// Markt: ETF-Depot (Rendite, Vorabpauschale, Ausschüttungen) und Altersvorsorgedepots; Vermögen zum Jahresende
function marketYear(ctx, y) {
  const { I, persons, useAVD, wStartAbs, endAbs, depot, avd, pol } = ctx, { year, mk, L, yearAbs0, saveMonths, avdIn, savePart, extraInvest, avdReinvest, lumpNet, lumpM, etfContrib } = y;
  const wm0 = Math.max(0, wStartAbs - yearAbs0), wm1 = Math.min(12, endAbs - yearAbs0);
  const dy = depotYear(depot, year, mk.R, etfContrib, L.basiszins, buyTiming([[savePart, 0, saveMonths || 12], [extraInvest, wm0, wm1], [avdReinvest - lumpNet, 0, 12], [lumpNet, lumpM, 12]]));
  // Ausschüttungen brutto in aktiven Fonds (FIFO-Staffelung)
  if (dy.reinvestGross > 0) depotBuy(depot, I.depot.divRedirect ? dy.activeIdx : 0, dy.reinvestGross, year);
  ctx.pendingKap = dy.distTaxable + dy.vpTaxable;

  // ── Markt: Altersvorsorgedepot ──
  persons.forEach((p, i) => {
    if (!useAVD || !p.avd.on) return;
    const a = avd[i], cost = Math.min(p.avd.cost, AVD.costMax) + p.avd.ter;   // Depotkosten plus Fondskosten (TER)
    if (avdIn[i].cF + avdIn[i].cU === 0) avdGrow(a, mk.R, cost);
    else avdSaveYear(a, mk.R, cost, avdIn[i].cF, avdIn[i].cU, avdIn[i].zul, avdIn[i].m / 24);
  });
  const pvP = pol.map(o => sumPol(o, q => q ? q.s.K : 0));   // Vertragswerte je Person
  Object.assign(y, { dv: depotValue(depot), av: avd.map(avdValue), pvP, pvSum: sum(pvP) });
}

// Jahreszeile (nur bei opt.detail) mit Aufteilung nach Personen (pp)
function buildRow(ctx, y) {
  const { persons, ep, depot, pol } = ctx;
  const { year, L, priceIdx, work, grv, grvTaxable, saveMonths, wMonths, inWithdraw, loanPay, loanSonder, budget, avdIn, polIn, budgetCut, basisDed, zulSum,
    avdPay, kvShare, grvW, avdW, polPay, polW, polTaxable, G, ev, extraInvest, netIncome, wT, houseG, sellG, debt,
    basisRefund, refund, lumpTax, lumpTaxPer, lumpPer, taxFromBudget, avdReinvest, etfContrib, refundPer, polRefund, dv, av, pvP, pvSum } = y;
  const pv = persons.map((p, i) => Object.fromEntries(POLICIES.map(k => [k, pol[i][k] ? pol[i][k].s.K : 0])));
  const basisRefundPer = polRefund.map(o => sumPol(o, x => x));
  // ── Aufteilung nach Personen ──
  // Gemeinsames ETF-Depot, Kredit und Kapitalertragsteuer je zur Hälfte.
  // Einkommensteuer (Splitting) nach Anteil am steuerpflichtigen Einkommen ohne Kapital.
  // Steuererstattung aus § 10a nach Anteil am Sonderausgabenabzug.
  const np = persons.length;
  const taxBase = persons.map((p, i) => Math.max(0, earnedTaxable(p, work[i], L) + grvTaxable[i] + avdPay[i].taxable + polTaxable[i]));
  const taxBaseSum = taxBase.reduce((a, b) => a + b, 0);
  const pp = persons.map((p, i) => {
    const estShare = taxBaseSum > 0 ? (ev.it.est + ev.it.soli) * taxBase[i] / taxBaseSum : (ev.it.est + ev.it.soli) / np;
    const kvI = ev.kvR.per[i];
    // Einkommensteuer je Produkt nach Anteil am steuerpflichtigen Einkommen, KV-Beiträge je Quelle (für die Rendite je Produkt)
    const estOf = x => taxBase[i] > 0 ? estShare * x / taxBase[i] : 0;
    const estBy = { avd: estOf(avdPay[i].taxable), ...Object.fromEntries(POLICIES.map(k => [k, estOf(polPay[i][k].taxable)])) };
    const net = inWithdraw ? grvW[i] + avdW[i] + polW[i] + G / np - estShare * wT - ev.kt.taxW / np - kvI * kvShare[i] - extraInvest / np : 0;
    const o = {
      etf: dv / np, avd: av[i], etfContrib: etfContrib / np, avdReinvest: avdReinvest / np, taxFromBudget: taxFromBudget / np, avdIn: avdIn[i].cF + avdIn[i].cU, zul: avdIn[i].zul,
      refund: refundPer[i], loanPay: loanPay / np, loanSonder: loanSonder / np, budget: budget / np, debt: debt / np, netWorth: (dv - debt) / np + av[i] + pvP[i],
      basisRefund: basisRefundPer[i], lump: lumpPer[i], lumpTax: lumpTaxPer[i],
      grv: grv[i], avdPay: avdPay[i].gross, etfSale: sellG / np, grvW: grvW[i], avdPayW: avdW[i], estW: estShare * wT, kvW: kvI * kvShare[i], kapTaxW: ev.kt.taxW / np,
      est: estShare, kapTax: ev.kt.tax / np, kv: kvI, net, total: dv / np + av[i] + pvP[i], estBy, kvBy: ev.kvR.by[i],
    };
    for (const k of POLICIES) polFields(o, k, pv[i][k], polIn[i][k], polPay[i][k]);
    return o;
  });
  const row = {
    year, ages: persons.map(p => ageAt(p, year)),
    phase: inWithdraw ? 'Entnahme' : (saveMonths > 0 ? 'Ansparen' : 'Übergang'), saveMonths, wMonths,
    priceIdx, etf: dv, avd: av, total: dv + sum(av) + pvSum,
    basisRefund, lump: lumpPer, lumpTax, budgetCut,
    etfContrib, avdReinvest, taxFromBudget, avdIn: avdIn.map(a => a.cF + a.cU), zulagen: zulSum, refund, loanPay, loanSonder, budget,
    debt, netWorth: dv + sum(av) + pvSum - debt,
    grv, avdPay: avdPay.map(a => a.gross), etfSale: sellG, houseSale: houseG,
    grvW, avdPayW: avdW, estW: (ev.it.est + ev.it.soli) * wT, kapTaxW: ev.kt.taxW, kvW: sum(ev.kvR.per.map((c, i) => c * kvShare[i])),
    est: ev.it.est, soli: ev.it.soli, kapTax: ev.kt.tax,
    kv: ev.kvR.tot, net: inWithdraw ? netIncome : 0, extraInvest,
    basisDed, ep: [...ep], funds: depot.funds.map(fundValue), pp,
  };
  for (const k of POLICIES) polFields(row, k, pv.map(o => o[k]), polIn.map(o => o[k]), polPay.map(o => o[k]));
  return row;
}

// ═══════════════════════════════════════════════════════════════
// simulate(I, A, opt)
//   opt.scenario: 'A' (nur ETF) | 'B' (eingeschaltete Vorsorgeprodukte, Rest ETF)
//   opt.targetReal: Ziel-Nettoeinkommen/Monat in heutiger Kaufkraft (Strategien realConst und perpetual)
//   opt.path: [{R, infl}] je Jahr (Monte Carlo), sonst deterministisch
//   opt.detail: Jahreszeilen mitschreiben
// ═══════════════════════════════════════════════════════════════
function simulate(I, A, opt) {
  const ctx = simCtx(I, A, opt);
  const { depot, avd, pol, loans } = ctx;
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
    if (year === ctx.wStartYear - 1) ctx.startReal = (y.dv + sum(y.av) + y.pvSum - y.debt) / y.priceIdx;
    if (y.inWithdraw && y.shortfall && !ctx.depleted) { ctx.depleted = true; ctx.depletedYear = year; }
    if (opt.detail) rows.push(buildRow(ctx, y));
  }

  const polCap = sum(pol.map(o => sumPol(o, q => q ? q.s.K : 0)));
  const final = depotValue(depot) + avd.reduce((s, a) => s + avdValue(a), 0) + polCap;
  // Abgeltungsteuer, die beim Verkauf des Restdepots fällig wäre (ohne Sparerpauschbetrag; für die Rendite des ETF-Depots)
  const etfTaxLatent = opt.detail ? Math.max(0, depotSell(depot, depotValue(depot), I.depot.sellMode, true).taxable) * LAW.abgSt * (1 + LAW.soliKap) : 0;
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
