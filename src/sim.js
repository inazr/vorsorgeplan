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
function monthsRetired(P, year) {
  const s = retireStartAbs(P), y0 = year * 12, y1 = year * 12 + 11;
  return Math.max(0, Math.min(12, y1 - Math.max(s, y0) + 1));
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
//   opt.targetReal: Ziel-Nettoeinkommen/Monat in heutiger Kaufkraft (Strategie realConst)
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
  const wStartYear = Math.floor(lastRet / 12) + (lastRet % 12 === 0 ? 0 : 1); // erstes volles Jahr beide in Rente
  const refP = persons[I.withdraw.refPerson ?? 0];
  const endYear = refP.by + I.withdraw.targetAge;

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

  for (let year = Y0; year <= endYear; year++) {
    const t = year - Y0;
    const mk = opt.path ? opt.path[t] : { R: A.ret, infl: A.inflation };
    if (t > 0) priceIdx *= 1 + (opt.path ? opt.path[t - 1].infl : A.inflation);
    const L = lawYear(year, A, priceIdx);
    const kgKids = I.children.filter(c => year - c.by <= c.kgUntil);
    const nKids = kgKids.length;
    // PV: Abschlag 0,25 Pp. je Kind unter 25 ab dem 2. Kind (max. 4), Kinderlosenzuschlag ohne Kinder
    const k25 = I.children.filter(c => year - c.by < 25).length;
    const pvAb = 0.0025 * Math.min(4, Math.max(0, k25 - 1));
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
    const saveMonths = Math.max(0, Math.min(12, saveEndAbs - yearAbs0));
    const inWithdraw = year >= wStartYear;

    // Budget und Kredit
    let loanPay = 0, loanSonder = 0, loanPayoff = 0, loanInterest = 0;
    const payoffs = [];
    for (const l of loans) for (let m = 0; m < 12; m++) {
      const o = loanMonth(l, yearAbs0 + m, false);
      loanPay += o.pay + o.sonder; loanSonder += o.sonder; loanPayoff += o.payoff; loanInterest += o.interest;
      if (o.payoff > 0) payoffs.push({ l, amt: o.payoff });
    }
    let debt = loans.reduce((a, l) => a + l.bal, 0);
    const budget = B.monthly * Math.pow(1 + B.dyn, t) * saveMonths;
    const loanInSave = loanPay * saveMonths / 12;
    let sparBudget = Math.max(0, budget - loanInSave);
    // Nach Sparende werden Kreditraten aus der Rente bezahlt (zählen als Ausgabe der Entnahme)
    const loanAfterSave = loanPay - loanInSave;

    // ── Altersvorsorgedepot: Beiträge und Zulagen ──
    const avdIn = persons.map(() => ({ cF: 0, cU: 0, zul: 0 }));
    if (useAVD && year >= 2027 && saveMonths > 0) {
      persons.forEach((p, i) => {
        const cfg = p.avd; if (!cfg.on) return;
        if (ageAt(p, year) >= 67) return;
        const f = saveMonths / 12;
        const cF = Math.min(cfg.eigen, AVD.fMax) * f;
        const cU = Math.min(cfg.extra, AVD.einMax - Math.min(cfg.eigen, AVD.fMax)) * f;
        let zul = zulageGrund(cF, AVD);
        // Kinderzulage: 100 % der Beiträge, max. 300 € je zugeordnetem Kind mit Kindergeld
        const zk = kgKids.filter(c => (c.zulageTo ?? 1) === i).length;
        if (zk > 0 && cF >= AVD.minEigen) zul += Math.min(cF, AVD.kindMax * zk);
        avdIn[i] = { cF, cU, zul };
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
    // AVD-Auszahlungen
    const avdPay = persons.map((p, i) => {
      if (!useAVD || !p.avd.on) return { gross: 0, taxable: 0 };
      const age = ageAt(p, year);
      const a = avd[i];
      if (age < p.avd.payStart || avdValue(a) <= 0) return { gross: 0, taxable: 0 };
      let res = { gross: 0, taxable: 0 };
      if (!a.paying) {
        a.paying = true;
        if (p.avd.teilkapital > 0) res = avdWithdraw(a, avdValue(a) * p.avd.teilkapital);
      }
      const left = p.avd.payEnd - age + 1;
      const r2 = avdWithdraw(a, left <= 1 ? avdValue(a) : avdValue(a) / left);
      return { gross: res.gross + r2.gross, taxable: res.taxable + r2.taxable };
    });

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
      return { sale, it, kt, kvR, zvE };
    }

    let G = 0, ev, extraInvest = 0, netIncome = 0, target = 0, shortfall = false;
    const grossPens = grv.reduce((a, b) => a + b, 0) + avdPay.reduce((s, a) => s + a.gross, 0);

    // Hausablösung über ETF-Entnahme
    let houseG = 0;
    if (loanPayoff > 0 && !inWithdraw) {
      let lo = 0, hi = depotValue(depot);
      for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; const e = evalYear(mid, true); const net = mid - e.kt.tax; if (net < loanPayoff) lo = mid; else hi = mid; }
      houseG = hi;
    }

    if (inWithdraw) {
      if (I.withdraw.strategy === 'realConst') target = opt.targetReal * 12 * priceIdx;
      else if (I.withdraw.strategy === 'fixedNet') target = I.withdraw.fixedNet * 12 * (I.withdraw.fixedIndexed ? priceIdx : 1);
      target += loanAfterSave + loanPayoff;   // Kreditrate nach Sparende und Ablösung aus dem Depot zusätzlich
      const netOf = g => { const e = evalYear(g, true); return { net: grossPens + g - e.it.total - e.kt.tax - e.kvR.tot, e }; };
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
    const sellG = inWithdraw ? G : houseG;
    if (sellG > 0) depotSell(depot, sellG, I.depot.sellMode, false);
    depot.lossCarry = ev.kt.newLoss;
    if (houseG > 0 || (loanPayoff > 0 && !inWithdraw)) {
      // Reicht das Depot nicht, läuft der ungedeckte Rest als Anschlussfinanzierung weiter
      const covered = Math.max(0, houseG - ev.kt.tax);
      const gap = loanPayoff - covered;
      if (gap > 1) for (const { l, amt } of payoffs) {
        const rem = gap * amt / loanPayoff;
        l.bal = rem; l.phase = 'post'; l.rM = loanRateM(l.c.zins); l.pay = annuityM(rem, l.rM, l.c.years * 12); l.postRate = l.pay;
      }
      houseSale = { year, gross: houseG, tax: ev.kt.tax, payoff: loanPayoff, covered: Math.min(covered, loanPayoff) };
    }
    debt = loans.reduce((a, l) => a + l.bal, 0);

    // §10a-Günstigerprüfung (Steuerersparnis über der Zulage fließt ins ETF-Depot)
    if (dedSum > 0) {
      const tA = incomeTax(ev.zvE, nKids, L).total, tB = incomeTax(Math.max(0, ev.zvE - dedSum), nKids, L).total;
      refund = Math.max(0, tA - tB - zulSum);
    }

    // ── Sparphase: ETF-Sparrate ──
    const avdOut = avdIn.reduce((s, a) => s + a.cF + a.cU, 0);
    let etfContrib = 0;
    if (!inWithdraw) {
      // Kapitalsteuern der Sparphase werden aus dem Sparbudget bezahlt
      etfContrib = Math.max(0, sparBudget - avdOut - ev.kt.tax + pendingRefund);
    } else {
      etfContrib = extraInvest + pendingRefund;
    }
    pendingRefund = refund;
    sumZulagen += zulSum; sumRefunds += refund; sumKapTax += ev.kt.tax;

    // Nicht verbrauchte Altersvorsorge-Auszahlungen vor Entnahmestart werden reinvestiert
    if (!inWithdraw && grossPens > 0 && saveMonths < 12) {
      const avdNet = avdPay.reduce((s, a) => s + a.gross, 0);
      if (avdNet > 0) etfContrib += avdNet * (1 - 0.3); // grobe Steuer/SV-Annahme für Übergangsjahre
    }

    // ── Markt: ETF-Depot ──
    const dy = depotYear(depot, year, mk.R, etfContrib, L.basiszins, { vpFracNew: 6.5 / 12 });
    // Ausschüttungen brutto in aktiven Fonds (FIFO-Staffelung)
    if (dy.reinvestGross > 0) depotBuy(depot, I.depot.divRedirect ? dy.activeIdx : 0, dy.reinvestGross, year);
    pendingKap = dy.distTaxable + dy.vpTaxable;
    sumVP += dy.vp;

    // ── Markt: Altersvorsorgedepot ──
    persons.forEach((p, i) => {
      if (!useAVD || !p.avd.on) return;
      const a = avd[i];
      if (a.paying || avdIn[i].cF + avdIn[i].cU === 0) avdGrow(a, mk.R, p.avd.cost);
      else avdSaveYear(a, mk.R, p.avd.cost, avdIn[i].cF, avdIn[i].cU, avdIn[i].zul);
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
      const net = inWithdraw ? grv[i] + avdPay[i].gross + sellG / np - estShare - ev.kt.tax / np - kvI - extraInvest / np : 0;
      return {
        etf: dv / np, avd: av[i], etfContrib: etfContrib / np, avdIn: avdIn[i].cF + avdIn[i].cU, zul: avdIn[i].zul,
        refund: dedSum > 0 ? refund * dedPer[i] / dedSum : 0, loanPay: loanPay / np, loanSonder: loanSonder / np, budget: budget / np, debt: debt / np, netWorth: (dv - debt) / np + av[i],
        grv: grv[i], avdPay: avdPay[i].gross, etfSale: sellG / np,
        est: estShare, kapTax: ev.kt.tax / np, kv: kvI, net, total: dv / np + av[i],
      };
    });
    if (inWithdraw && shortfall && !depleted) { depleted = true; depletedYear = year; }
    if (inWithdraw && target > 0) minNetRatio = Math.min(minNetRatio, netIncome / target);

    if (row) Object.assign(row, {
      phase: inWithdraw ? 'Entnahme' : (saveMonths > 0 ? 'Ansparen' : 'Übergang'),
      priceIdx, etf: dv, etfCost: depotCost(depot), avd: av, total: dv + av.reduce((a, b) => a + b, 0),
      etfContrib, avdIn: avdIn.map(a => a.cF + a.cU), zulagen: zulSum, refund, loanPay, loanSonder, loanInterest, budget,
      debt, netWorth: dv + av.reduce((a, b) => a + b, 0) - debt,
      grv, grvTaxable, avdPay: avdPay.map(a => a.gross), etfSale: sellG, houseSale: houseG,
      zvE: ev.zvE, est: ev.it.est, soli: ev.it.soli, kapTax: ev.kt.tax, guenstiger: ev.kt.guenstiger,
      kv: ev.kvR.tot, vp: dy.vp, dist: dy.dist, net: inWithdraw ? netIncome : 0, target, shortfall,
      ep: [...ep], funds: depot.funds.map(fundValue), pp,
    });
    if (row) rows.push(row);
  }

  const wRows = rows.filter(r => r.phase === 'Entnahme');
  return {
    rows, depleted, depletedYear, wStartYear, endYear, minNetRatio,
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
