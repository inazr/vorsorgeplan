// ═══════════════════════════════════════════════════════════════
// JAHRESSIMULATION: eine Engine für Einzelrechnung, Optimierer und Monte Carlo
// ═══════════════════════════════════════════════════════════════
const SV = { // Sozialversicherung, Basisjahr 2026 (G), Fortschreibung mit Lohnentwicklung
  base: 2026,
  bbgRV: { 2026: 101400, 2027: 106200 },
  bbgKV: { 2026: 69750, 2027: 76500 },       // 2027 inkl. Sonderanhebung BStabG
  de: { 2026: 51944, 2027: 53452 },          // Durchschnittsentgelt (vorläufig)
  bez: { 2026: 47460, 2027: 49560 },         // Bezugsgröße p.a.
  rw: { 2025: 40.79, 2026: 42.52 },          // aktueller Rentenwert ab 1.7.
  rvAN: 0.093, kvGen: 0.146, kvErm: 0.140, pv: 0.036, pvKinderlos: 0.006,
  rentenAlter: 67,
};

function idxVal(table, year, growth) { // Wert aus Tabelle, danach mit growth fortgeschrieben
  const ys = Object.keys(table).map(Number).sort((a, b) => a - b);
  let base = ys[0];
  for (const y of ys) if (y <= year) base = y;
  return table[base] * Math.pow(1 + growth, Math.max(0, year - base));
}

// Rentenwert: Anpassung = Lohnwachstum, nach Ende der Haltelinie (2031) gedämpft
function rwFor(year, A) {
  let rw = SV.rw[2026];
  for (let y = 2027; y <= year; y++) rw *= 1 + A.wageGrowth - (y > 2031 ? A.rentenDaempfung : 0);
  return rw;
}
function lawYear(year, A, priceIdx) {
  const { p, idx } = tariffFor(year, { useDraft: A.useDraft, indexTariff: A.indexTariff, inflation: A.inflation });
  const lastKid = Math.max(...Object.keys(LAW.kinder).filter(y => A.useDraft || LAW.kinder[y].st !== 'E').map(Number));
  const kYear = Math.min(year, lastKid), kIdx = year > lastKid && A.indexTariff ? Math.pow(1 + A.inflation, year - lastKid) : 1;
  const w = A.wageGrowth;
  return {
    year, p, idx,
    soliFG: LAW.soli.freigrenzeSplit * (A.indexTariff ? Math.max(1, Math.pow(1 + A.inflation, year - 2026)) : 1),
    kfb: LAW.kinder[kYear].kfb * kIdx, kg: LAW.kinder[kYear].kg * kIdx * 12,
    anPausch: (A.useDraft && year >= 2027 ? 1430 : 1230) * kIdx,
    bbgRV: idxVal(SV.bbgRV, year, w), bbgKV: idxVal(SV.bbgKV, year, w), de: idxVal(SV.de, year, w),
    rw: rwFor(year, A), bez: idxVal(SV.bez, year, w),
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
  return { est, soli: soliOf(soliBase, L), total: est + soliOf(soliBase, L) };
}

// Kapitalertragsteuer mit Pauschbetrag, Verlustvortrag, optional Günstigerprüfung
function kapTax(kapTaxable, lossCarry, L, zvEOther, nKids, A) {
  let base = kapTaxable - lossCarry;
  let newLoss = 0;
  if (base < 0) { newLoss = -base; base = 0; }
  const afterSPB = Math.max(0, base - LAW.sparerPB);
  const abg = afterSPB * LAW.abgSt * (1 + LAW.soliKap);
  let tax = abg, guenstiger = false;
  if (A.guenstiger && afterSPB > 0) {
    const t0 = incomeTax(zvEOther, nKids, L).total, t1 = incomeTax(zvEOther + afterSPB, nKids, L).total;
    if (t1 - t0 < abg) { tax = t1 - t0; guenstiger = true; }
  }
  return { tax, newLoss, afterSPB, guenstiger };
}

// ─── Personen-Helfer ───
function retireStartAbs(P) { return (P.by + P.retireAge) * 12 + (P.bm - 1) + 1; } // Monat nach Geburtstag
function monthsRetired(P, year) { return monthsIn(year, retireStartAbs(P), Infinity); }
// Anzahl der Monate des Jahres im Zeitraum [from, to) (absolute Monate: Jahr * 12 + Monat − 1)
function monthsIn(year, from, to) { return Math.max(0, Math.min(year * 12 + 12, to) - Math.max(year * 12, from)); }
function avdPayStartAbs(P) { return (P.by + P.avd.payStart) * 12 + P.bm; } // Monat nach Geburtstag
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

// ═══════════════════════════════════════════════════════════════
// simulate(I, A, opt)
//   opt.scenario: 'A' (nur ETF) | 'B' (ETF + Altersvorsorgedepot)
//   opt.targetReal: Ziel-Nettoeinkommen/Monat in heutiger Kaufkraft (Strategien realConst und perpetual)
//   opt.path: [{R, infl}] je Jahr (Monte Carlo), sonst deterministisch
//   opt.detail: Jahreszeilen mitschreiben
// ═══════════════════════════════════════════════════════════════
function simulate(I, A, opt) {
  const Y0 = I.startYear;
  const [S, W] = I.persons;
  const persons = I.persons;
  const useAVD = opt.scenario === 'B';
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
  const renteFB = persons.map(() => null);   // Rentenfreibetrag (fix ab Folgejahr)
  const renteStartY = persons.map(p => Math.floor(retireStartAbs(p) / 12));

  // Kredit
  const B = I.budget;
  const loans = makeLoans(I.loans || [], Y0 * 12);

  let priceIdx = 1, pendingKap = 0, pendingRefund = 0, depleted = false, depletedYear = null;
  let sumZulagen = 0, sumRefunds = 0, sumKapTax = 0, sumVP = 0, houseSale = null;
  const rows = [];
  let minNetRatio = Infinity;
  let startReal = I.depot.startValue;   // reales Nettovermögen zu Entnahmebeginn (Ende des Vorjahres)

  for (let year = Y0; year <= endYear; year++) {
    const t = year - Y0;
    const mk = opt.path ? opt.path[t] : { R: A.ret, infl: A.inflation };
    if (t > 0) priceIdx *= 1 + (opt.path ? opt.path[t - 1].infl : A.inflation);
    const L = lawYear(year, A, priceIdx);
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
    const row = opt.detail ? { year, ages: persons.map(p => ageAt(p, year)), R: mk.R } : null;

    // ── Erwerbseinkommen (anteilig bis Rentenbeginn) ──
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
      return e * zugangsfaktor(p) * L.rw * m;
    });
    const grvTaxable = grv.map((g, i) => {
      if (g <= 0) return 0;
      const ba = LAW.besteuerungsanteil(renteStartY[i]);
      if (year === renteStartY[i]) return g * ba;
      if (renteFB[i] == null) renteFB[i] = g * (1 - ba);   // erstes volles Jahr fixiert Freibetrag
      return Math.max(0, g - renteFB[i]);
    });

    // ── Vorsorgeaufwendungen Erwerbsphase ──
    let vorsorge = 0;
    persons.forEach((p, i) => {
      const w = work[i]; if (w.m <= 0) return;
      const bbgKV = L.bbgKV * w.m / 12, bbgRV = L.bbgRV * w.m / 12;
      if (p.job === 'employee') {
        if (p.rvPflicht) vorsorge += SV.rvAN * Math.min(w.g, bbgRV);
        vorsorge += ((SV.kvGen + L.zus) / 2 * (p.krankengeld ? 0.96 : 1) + L.pv / 2 - pvAb + (childless ? SV.pvKinderlos : 0)) * Math.min(w.g, bbgKV);
      } else {
        const rate = p.krankengeld ? SV.kvGen : SV.kvErm;
        vorsorge += ((rate + L.zus) * (p.krankengeld ? 0.96 : 1) + L.pv - pvAb + (childless ? SV.pvKinderlos : 0)) * Math.min(w.g, bbgKV);
      }
    });

    // ── Spar- oder Entnahmephase ──
    const yearAbs0 = year * 12;
    const saveMonths = monthsIn(year, 0, saveEndAbs);
    const wMonths = monthsIn(year, wStartAbs, endAbs);   // Entnahmemonate im Jahr
    const inWithdraw = wMonths > 0;
    const inW = a => a >= wStartAbs && a < endAbs;

    // Budget und Kredit
    let loanPay = 0, loanSonder = 0, loanPayoff = 0, loanInterest = 0, loanInSave = 0, loanInW = 0, payoffInW = 0;
    const payoffs = [];
    for (const l of loans) for (let m = 0; m < 12; m++) {
      const a = yearAbs0 + m, o = loanMonth(l, a, false);
      loanPay += o.pay + o.sonder; loanSonder += o.sonder; loanPayoff += o.payoff; loanInterest += o.interest;
      if (a < saveEndAbs) loanInSave += o.pay + o.sonder;
      if (inW(a)) { loanInW += o.pay + o.sonder; payoffInW += o.payoff; }
      else if (o.payoff > 0) payoffs.push({ l, amt: o.payoff });
    }
    const payoffOut = loanPayoff - payoffInW;   // Ablösung außerhalb der Entnahme: Verkauf aus dem Depot
    let debt = loans.reduce((a, l) => a + l.bal, 0);
    const budget = B.monthly * Math.pow(1 + B.dyn, t) * saveMonths;
    let sparBudget = Math.max(0, budget - loanInSave);
    // In der Entnahme werden Kreditraten aus der Rente bezahlt (zählen als Ausgabe der Entnahme)

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
        let zul = zulageGrund(cF, AVD);
        // Kinderzulage: 100 % der Beiträge, max. 300 € je zugeordnetem Kind mit Kindergeld
        const zk = kgKids.filter(c => (c.zulageTo ?? 1) === i).length;
        if (zk > 0 && cF >= AVD.minEigen) zul += Math.min(cF, AVD.kindMax * zk);
        avdIn[i] = { cF, cU, zul, m };
      });
    }

    // ── Steuer Erwerbsphase / Grundlage zvE ohne Kapital ──
    const zvEBase = (p => p)(
      persons.reduce((s, p, i) => s + (p.job === 'employee' ? Math.max(0, work[i].g - (work[i].m > 0 ? L.anPausch : 0)) : work[i].g), 0)
    );

    // §10a Günstigerprüfung
    let refund = 0;
    const zulSum = avdIn.reduce((s, a) => s + a.zul, 0);
    const dedSum = avdIn.reduce((s, a) => s + a.cF + a.zul, 0);

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
      if (!a.paying) {
        a.paying = true;
        if (p.avd.teilkapital > 0) res = avdWithdraw(a, avdValue(a) * p.avd.teilkapital);
      }
      const left = s1 - Math.max(s0, yearAbs0);
      const r2 = avdWithdraw(a, left <= m ? avdValue(a) : avdValue(a) * m / left);
      return { gross: res.gross + r2.gross, taxable: res.taxable + r2.taxable, m, mW: monthsIn(year, Math.max(s0, wStartAbs), Math.min(s1, endAbs)) };
    });
    // Anteile, die in die Entnahmemonate fallen (Renten und KV je Person, Einkommensteuer nach Einkommensanteil)
    const kvShare = persons.map(p => { const mR = monthsRetired(p, year); return mR > 0 ? monthsIn(year, Math.max(retireStartAbs(p), wStartAbs), endAbs) / mR : 0; });
    const grvW = grv.map((g, i) => g * kvShare[i]);
    const avdW = avdPay.map(a => a.m > 0 ? a.gross * a.mW / a.m : 0);

    // Einkommen ohne Kapital
    const pensionPers = persons.map((p, i) => grv[i] > 0 || avdPay[i].gross > 0);
    const wkRente = pensionPers.filter(Boolean).length * LAW.pausch.rentnerWK;
    const otherIncome = zvEBase + grvTaxable.reduce((a, b) => a + b, 0) + avdPay.reduce((s, a) => s + a.taxable, 0) - wkRente;

    // KV/PV der Rentner je Person (eigener Anteil). Kapitalerträge hälftig je Ehegatte.
    function kvRetire(kapPerPerson) {
      let tot = 0, deductible = 0;
      const per = persons.map(() => 0);
      persons.forEach((p, i) => {
        const m = monthsRetired(p, year);
        if (m <= 0) return;
        const f = m / 12, bbg = L.bbgKV * f;
        const pvRate = L.pv - pvAb + (childless ? SV.pvKinderlos : 0);
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
        if (kv[i].ok && A.kvAvdKvdr) {   // Risikoschalter: KVdR zahlt künftig Beiträge auf AVD-Auszahlungen (wie Versorgungsbezüge)
          const rest = Math.max(0, bbg - bR);
          c += Math.min(avdPay[i].gross, rest) * (SV.kvGen + L.zus + pvRate);
        }
        if (!kv[i].ok) {
          const rest = Math.max(0, bbg - bR);
          const sonst = Math.max(0, avdPay[i].gross + kapPerPerson * f - 51 * f);
          const bS = Math.min(sonst, rest);
          const fehl = Math.max(0, L.bez / 3 * f - bR - bS);   // Mindestbemessung
          c += (bS + fehl) * (SV.kvErm + L.zus + pvRate);
        }
        tot += c; deductible += c; per[i] = c;
      });
      return { tot, deductible, per };
    }

    // Steuer + SV für gegebenen ETF-Verkauf (dry run)
    function evalYear(G, dry) {
      const sale = G > 0 ? depotSell(depot, G, I.depot.sellMode, true) : { sold: 0, taxable: 0 };
      const kapT = pendingKap + sale.taxable;
      // KV-Basis freiwillig: Gewinn inkl. Ausschüttung/VP, ohne Sparerpauschbetrag; Teilfreistellung per Schalter
      const kapForKV = Math.max(0, A.kvTeilfreistellung ? kapT : kapT / 0.7);
      const kvR = kvRetire(kapForKV / 2);
      const zvE = Math.max(0, otherIncome - vorsorge - kvR.deductible - LAW.pausch.sonderausg);
      const it = incomeTax(zvE, nKids, L);
      const kt = kapTax(kapT, depot.lossCarry, L, zvE, nKids, A);
      // Steuer auf Vorabpauschale/Ausschüttungen des Vorjahres ist im Januar fällig, Steuer auf Verkäufe in der Entnahme
      kt.taxW = !inWithdraw ? 0 : wStartAbs <= yearAbs0 ? kt.tax : Math.max(0, kt.tax - kapTax(pendingKap, depot.lossCarry, L, zvE, nKids, A).tax);
      return { sale, it, kt, kvR, zvE };
    }

    let G = 0, ev, extraInvest = 0, netIncome = 0, target = 0, shortfall = false;
    const sum = a => a.reduce((x, y) => x + y, 0);
    const grossW = sum(grvW) + sum(avdW);
    const incAll = sum(work.map(w => w.g)) + sum(grv) + sum(avdPay.map(a => a.gross));
    const wT = !inWithdraw ? 0 : incAll > 0 ? grossW / incAll : 1;   // Anteil der Einkommensteuer, der auf die Entnahmemonate fällt

    // Hausablösung über ETF-Entnahme
    let houseG = 0;
    if (payoffOut > 0) {
      let lo = 0, hi = depotValue(depot);
      for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; const e = evalYear(mid, true); const net = mid - e.kt.tax; if (net < payoffOut) lo = mid; else hi = mid; }
      houseG = hi;
    }

    if (inWithdraw) {
      if (I.withdraw.strategy !== 'fixedNet') target = opt.targetReal * wMonths * priceIdx;
      else if (I.withdraw.strategy === 'fixedNet') target = I.withdraw.fixedNet * wMonths * (I.withdraw.fixedIndexed ? priceIdx : 1);
      target += loanInW + payoffInW;   // Kreditraten und Ablösung in den Entnahmemonaten zusätzlich
      const netOf = g => { const e = evalYear(g, true); return { net: grossW + g - e.it.total * wT - e.kt.taxW - sum(e.kvR.per.map((c, i) => c * kvShare[i])), e }; };
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
      ev = evalYear(houseG, true);
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
      houseSale = { year, gross: houseG, tax: ev.kt.tax, payoff: payoffOut, covered: Math.min(covered, payoffOut) };
    }
    debt = loans.reduce((a, l) => a + l.bal, 0);

    // §10a-Günstigerprüfung (Steuerersparnis über der Zulage fließt ins ETF-Depot)
    if (dedSum > 0) {
      const tA = incomeTax(ev.zvE, nKids, L).total, tB = incomeTax(Math.max(0, ev.zvE - dedSum), nKids, L).total;
      refund = Math.max(0, tA - tB - zulSum);
    }

    // ── Sparphase: ETF-Sparrate ──
    const avdOut = avdIn.reduce((s, a) => s + a.cF + a.cU, 0);
    // Kapitalsteuern werden in der Entnahme aus dem Netto, sonst aus dem Sparbudget bezahlt
    const taxOutside = ev.kt.tax - ev.kt.taxW;
    const taxFromBudget = Math.min(taxOutside, Math.max(0, sparBudget - avdOut + pendingRefund));
    const savePart = Math.max(0, sparBudget - avdOut - taxOutside + pendingRefund);
    // Altersvorsorge-Auszahlungen vor Entnahmestart werden reinvestiert (grobe Steuer/SV-Annahme 30 %)
    const avdReinvest = (sum(avdPay.map(a => a.gross)) - sum(avdW)) * (1 - 0.3);
    const etfContrib = savePart + extraInvest + avdReinvest;
    pendingRefund = refund;
    sumZulagen += zulSum; sumRefunds += refund; sumKapTax += ev.kt.tax;

    // ── Markt: ETF-Depot ──
    const wm0 = Math.max(0, wStartAbs - yearAbs0), wm1 = Math.min(12, endAbs - yearAbs0);
    const dy = depotYear(depot, year, mk.R, etfContrib, L.basiszins, buyTiming([[savePart, 0, saveMonths || 12], [extraInvest, wm0, wm1], [avdReinvest, 0, 12]]));
    // Ausschüttungen brutto in aktiven Fonds (FIFO-Staffelung)
    if (dy.reinvestGross > 0) depotBuy(depot, I.depot.divRedirect ? dy.activeIdx : 0, dy.reinvestGross, year);
    pendingKap = dy.distTaxable + dy.vpTaxable;
    sumVP += dy.vp;

    // ── Markt: Altersvorsorgedepot ──
    persons.forEach((p, i) => {
      if (!useAVD || !p.avd.on) return;
      const a = avd[i];
      if (avdIn[i].cF + avdIn[i].cU === 0) avdGrow(a, mk.R, p.avd.cost);
      else avdSaveYear(a, mk.R, p.avd.cost, avdIn[i].cF, avdIn[i].cU, avdIn[i].zul, avdIn[i].m / 24);
    });

    const dv = depotValue(depot), av = avd.map(avdValue);

    // ── Aufteilung nach Personen ──
    // Gemeinsames ETF-Depot, Kredit und Kapitalertragsteuer je zur Hälfte.
    // Einkommensteuer (Splitting) nach Anteil am steuerpflichtigen Einkommen ohne Kapital.
    // Steuererstattung aus § 10a nach Anteil am Sonderausgabenabzug.
    const np = persons.length;
    const taxBase = persons.map((p, i) => Math.max(0, (p.job === 'employee' ? work[i].g - (work[i].m > 0 ? L.anPausch : 0) : work[i].g) + grvTaxable[i] + avdPay[i].taxable));
    const taxBaseSum = taxBase.reduce((a, b) => a + b, 0);
    const dedPer = avdIn.map(a => a.cF + a.zul);
    const pp = persons.map((p, i) => {
      const estShare = taxBaseSum > 0 ? (ev.it.est + ev.it.soli) * taxBase[i] / taxBaseSum : (ev.it.est + ev.it.soli) / np;
      const kvI = ev.kvR.per[i];
      const net = inWithdraw ? grvW[i] + avdW[i] + G / np - estShare * wT - ev.kt.taxW / np - kvI * kvShare[i] - extraInvest / np : 0;
      return {
        etf: dv / np, avd: av[i], etfContrib: etfContrib / np, avdReinvest: avdReinvest / np, taxFromBudget: taxFromBudget / np, avdIn: avdIn[i].cF + avdIn[i].cU, zul: avdIn[i].zul,
        refund: dedSum > 0 ? refund * dedPer[i] / dedSum : 0, loanPay: loanPay / np, loanSonder: loanSonder / np, budget: budget / np, debt: debt / np, netWorth: (dv - debt) / np + av[i],
        grv: grv[i], avdPay: avdPay[i].gross, etfSale: sellG / np, grvW: grvW[i], avdPayW: avdW[i], estW: estShare * wT, kvW: kvI * kvShare[i], kapTaxW: ev.kt.taxW / np,
        est: estShare, kapTax: ev.kt.tax / np, kv: kvI, net, total: dv / np + av[i],
      };
    });
    if (year === wStartYear - 1) startReal = (dv + av.reduce((a, b) => a + b, 0) - debt) / priceIdx;
    if (inWithdraw && shortfall && !depleted) { depleted = true; depletedYear = year; }
    if (inWithdraw && target > 0) minNetRatio = Math.min(minNetRatio, netIncome / target);

    if (row) Object.assign(row, {
      phase: inWithdraw ? 'Entnahme' : (saveMonths > 0 ? 'Ansparen' : 'Übergang'), saveMonths, wMonths,
      priceIdx, etf: dv, etfCost: depotCost(depot), avd: av, total: dv + av.reduce((a, b) => a + b, 0),
      etfContrib, avdReinvest, taxFromBudget, avdIn: avdIn.map(a => a.cF + a.cU), zulagen: zulSum, refund, loanPay, loanSonder, loanInterest, budget,
      debt, netWorth: dv + av.reduce((a, b) => a + b, 0) - debt,
      grv, grvTaxable, avdPay: avdPay.map(a => a.gross), etfSale: sellG, houseSale: houseG,
      grvW, avdPayW: avdW, estW: (ev.it.est + ev.it.soli) * wT, kapTaxW: ev.kt.taxW, kvW: sum(ev.kvR.per.map((c, i) => c * kvShare[i])),
      zvE: ev.zvE, est: ev.it.est, soli: ev.it.soli, kapTax: ev.kt.tax, guenstiger: ev.kt.guenstiger,
      kv: ev.kvR.tot, vp: dy.vp, dist: dy.dist, net: inWithdraw ? netIncome : 0, target, shortfall,
      ep: [...ep], funds: depot.funds.map(fundValue), pp,
    });
    if (row) rows.push(row);
  }

  const wRows = rows.filter(r => r.phase === 'Entnahme');
  return {
    rows, depleted, depletedYear, wStartYear, wFullYear, endYear, minNetRatio, startReal,
    finalReal: (depotValue(depot) + avd.reduce((s, a) => s + avdValue(a), 0) - loans.reduce((a, l) => a + l.bal, 0)) / priceIdx,
    final: depotValue(depot) + avd.reduce((s, a) => s + avdValue(a), 0),
    kv, sumZulagen, sumRefunds, sumKapTax, sumVP, houseSale, loans,
    ep,
  };
}

// AVD-Parameter (AltVRefG, verkündet BGBl. 2026 I Nr. 156)
const AVD = { g1: 0.5, g1Cap: 360, g2: 0.25, fMax: 1800, minEigen: 120, kindMax: 300, einMax: 6840, payMin: 65, payMax: 70, planEndMin: 85, teilMax: 0.3 };

// ═══════════════════════════════════════════════════════════════
// Höchstes nachhaltiges reales Netto: Bisektion über das Ziel
// ═══════════════════════════════════════════════════════════════
function solveMaxNet(I, A, scenario, path) {
  let lo = 0, hi = 30000;
  for (let k = 0; k < 28; k++) {
    const mid = (lo + hi) / 2;
    const r = simulate(I, A, { scenario, targetReal: mid, path });
    if (r.depleted) hi = mid; else lo = mid;
    if (hi - lo < 1) break;
  }
  return lo;
}
