// ═══════════════════════════════════════════════════════════════
// ETF-DEPOT mit Tranchen (Lots), FIFO je Fonds, Vorabpauschale
// ═══════════════════════════════════════════════════════════════
// Fonds: {name, type:'acc'|'dist', tf, ter, divY, from, to, price, lots:[{y,units,cost,vp}]}
// Lot.vp = Summe der Vorabpauschalen (vor Teilfreistellung) der Besitzzeit, mindert den späteren Gewinn (§19 InvStG)

function makeDepot(cfg) {
  const funds = cfg.funds.map(f => ({ ...f, price: 100, lots: [], lastY: null }));
  // Bestand: als Tranche im ersten Fonds, Einstandswert separat
  if (cfg.startValue > 0) {
    const f0 = funds[0];
    f0.lots.push({ y: cfg.startYear - 1, units: cfg.startValue / f0.price, cost: cfg.startCost, vp: 0 });
    f0.lastY = cfg.startYear - 1;
  }
  return { funds, lossCarry: 0 };
}

function depotValue(d) {
  let v = 0;
  for (const f of d.funds) for (const l of f.lots) v += l.units * f.price;
  return v;
}
function fundValue(f) { let v = 0; for (const l of f.lots) v += l.units * f.price; return v; }

// Aktiver Fonds für ein Jahr: der letzte, dessen Besparungszeitraum das Jahr enthält
function activeFundIndex(d, year) {
  let idx = -1;
  d.funds.forEach((f, i) => { if (year >= f.from && year <= f.to) idx = i; });
  if (idx < 0) { // nach Ende aller Zeiträume: zuletzt besparter Fonds
    let best = -1;
    d.funds.forEach((f, i) => { if (f.lastY != null && (best < 0 || f.lastY >= d.funds[best].lastY)) best = i; });
    idx = best < 0 ? 0 : best;
  }
  return idx;
}

// Kursfaktor eines Fonds bis zum Zeitpunkt t (Jahresbruchteil), wie beim Kauf
const fundGrowth = (f, R, t) => Math.pow(Math.max(0.01, 1 + R - f.ter), t);
function depotValueAt(d, R, t) { let v = 0; for (const f of d.funds) v += fundValue(f) * fundGrowth(f, R, t); return v; }
// Verkauf zum Zeitpunkt t: Kurs p0·(1+g)^t, Tranchen FIFO wie depotSell
function depotSellAt(d, gross, mode, R, t) {
  const p0 = d.funds.map(f => f.price);
  d.funds.forEach(f => { f.price *= fundGrowth(f, R, t); });
  const r = depotSell(d, gross, mode, false);
  d.funds.forEach((f, i) => { f.price = p0[i]; });
  return r;
}

// Ein Jahr Marktentwicklung + Sparrate + Ausschüttung + Vorabpauschale.
// contrib wird zum mittleren Kaufzeitpunkt opts.buyT (Jahresbruchteil, 0,5 = gleichmäßig übers Jahr) investiert.
// opts.sell = { gross, mode, t } (oder eine Liste davon): Verkäufe zum Zeitpunkt t vor Kauf, Ausschüttung und Vorabpauschale.
// Liefert steuerrelevante Beträge (vor Teilfreistellung und Pauschbetrag) und die verkauften Beträge sold.
function depotYear(d, year, R, contrib, basiszins, opts) {
  const out = { dist: 0, distTaxable: 0, vp: 0, vpTaxable: 0, contrib: 0, sold: 0 };
  if (opts.sell) for (const s of [].concat(opts.sell)) if (s.gross > 0) out.sold += depotSellAt(d, s.gross, s.mode, R, s.t).sold;
  const act = activeFundIndex(d, year);
  let reinvest = 0;
  for (let i = 0; i < d.funds.length; i++) {
    const f = d.funds[i];
    const p0 = f.price;
    const g = R - f.ter;                       // Rendite nach Fondskosten (inkl. Ausschüttung)
    const unitsStart = f.lots.reduce((s, l) => s + l.units, 0);
    // Kauf in diesem Jahr
    let newLot = null;
    if (i === act && contrib > 0) {
      const buyT = opts.buyT ?? 0.5;
      const pMid = p0 * Math.pow(Math.max(0.01, 1 + g), buyT);
      newLot = { y: year, units: contrib / pMid, cost: contrib, vp: 0 };
      f.lots.push(newLot); f.lastY = year; out.contrib += contrib;
    }
    // Kursentwicklung und Ausschüttung (am Jahresende, aus dem Kurs heraus)
    const pPre = p0 * (1 + g);
    const D = f.type === 'dist' ? p0 * f.divY : 0;        // Ausschüttung je Anteil
    const p1 = Math.max(0.0001, pPre - D);
    f.price = p1;
    // Ausschüttung auf Bestand zu Jahresbeginn + neue Tranche anteilig nach Haltedauer
    const unitsForDist = unitsStart + (newLot ? newLot.units * (1 - (opts.buyT ?? 0.5)) : 0);
    const distTotal = D * unitsForDist;
    if (distTotal > 0) { out.dist += distTotal; out.distTaxable += distTotal * (1 - f.tf); reinvest += distTotal; }
    // Vorabpauschale je Anteil: Basisertrag gedeckelt durch Wertsteigerung + Ausschüttung, minus Ausschüttung
    const basis = p0 * basiszins * 0.7;
    const cap = Math.max(0, p1 - p0 + D);
    const vpUnit = Math.max(0, Math.min(basis, cap) - D);
    if (vpUnit > 0) {
      for (const l of f.lots) {
        const frac = l === newLot ? opts.vpFracNew : 1;   // Zwölftelung im Kaufjahr
        const v = vpUnit * l.units * frac;
        l.vp += v; out.vp += v; out.vpTaxable += v * (1 - f.tf);
      }
    }
  }
  out.reinvestGross = reinvest;   // Ausschüttungen brutto, Steuer wird außerhalb abgezogen
  out.activeIdx = act;
  return out;
}

// Ausschüttungen (netto) in den aktiven Fonds reinvestieren
function depotBuy(d, idx, amount, year) {
  if (amount <= 0) return;
  const f = d.funds[idx];
  f.lots.push({ y: year, units: amount / f.price, cost: amount, vp: 0 });
  f.lastY = Math.max(f.lastY ?? year, year);
}

// Reihenfolge der Fonds beim Verkauf: zuletzt besparter Fonds zuerst (FIFO-Staffelung)
function sellOrder(d, mode) {
  const idx = d.funds.map((f, i) => i).filter(i => d.funds[i].lots.length);
  if (mode === 'newestFirst') idx.sort((a, b) => (d.funds[b].lastY ?? 0) - (d.funds[a].lastY ?? 0));
  return idx;
}

// Simuliert einen Verkauf (ohne Zustand zu ändern, wenn dry=true).
// Liefert steuerpflichtigen Gewinn nach Teilfreistellung (kann negativ sein).
function depotSell(d, gross, mode, dry) {
  let rest = gross, taxable = 0, gain = 0, sold = 0;
  for (const i of sellOrder(d, mode)) {
    if (rest <= 1e-9) break;
    const f = d.funds[i];
    let k = 0;
    while (rest > 1e-9 && k < f.lots.length) {
      const l = f.lots[k];
      const val = l.units * f.price;
      if (val <= 1e-9) { k++; continue; }
      const take = Math.min(rest, val);
      const share = take / val;
      const g = take - (l.cost + l.vp) * share;
      gain += g; taxable += g * (1 - f.tf); sold += take; rest -= take;
      if (!dry) {
        l.units -= l.units * share; l.cost -= l.cost * share; l.vp -= l.vp * share;
        if (share >= 1 - 1e-12) { f.lots.splice(k, 1); continue; }
      }
      k++;
    }
  }
  return { sold, gain, taxable };
}

// Verkaufskurve für viele Probeverkäufe im selben Jahr: kumulierte Werte V, Gewinne G und steuerpflichtige Gewinne T in Verkaufsreihenfolge.
// Ein Teilverkauf einer Tranche ist linear, curveSell entspricht daher depotSell(…, dry = true).
function sellCurve(d, mode) {
  const V = [0], G = [0], T = [0];
  for (const i of sellOrder(d, mode)) {
    const f = d.funds[i];
    for (const l of f.lots) {
      const val = l.units * f.price; if (val <= 1e-9) continue;
      const g = val - l.cost - l.vp, n = V.length - 1;
      V.push(V[n] + val); G.push(G[n] + g); T.push(T[n] + g * (1 - f.tf));
    }
  }
  return { V, G, T };
}
function curveSell(c, gross) {
  const { V, G, T } = c, n = V.length - 1;
  if (gross >= V[n]) return { sold: V[n], gain: G[n], taxable: T[n] };
  let lo = 0, hi = n;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (V[m] <= gross) lo = m; else hi = m; }
  const s = (gross - V[lo]) / (V[hi] - V[lo]);
  return { sold: gross, gain: G[lo] + s * (G[hi] - G[lo]), taxable: T[lo] + s * (T[hi] - T[lo]) };
}

// ─── Mehrere Depots (ein ETF-Depot je Person) ───
function depotsValue(ds) { let v = 0; for (const d of ds) v += depotValue(d); return v; }
// Verkauf über alle Depots: Aufteilung nach Gewichten shares (Standard: Anteil am Depotwert), was ein Depot nicht hergibt, übernehmen die anderen.
// cv: Verkaufskurven je Depot (sellCurve), liefern Depotwerte und beschleunigen Probeverkäufe. per: Ergebnis je Depot.
function depotsSell(ds, gross, mode, dry, shares, cv) {
  const v = cv ? cv.map(c => c.V[c.V.length - 1]) : ds.map(depotValue), w = shares || v, wSum = w.reduce((a, b) => a + b, 0);
  const amt = ds.map((d, i) => Math.min(v[i], gross > 0 && wSum > 0 ? gross * w[i] / wSum : 0));
  let rest = gross - amt.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ds.length && rest > 1e-9; i++) { const x = Math.min(rest, v[i] - amt[i]); if (x > 0) { amt[i] += x; rest -= x; } }
  const out = { sold: 0, gain: 0, taxable: 0, per: [] };
  ds.forEach((d, i) => {
    const r = amt[i] <= 0 ? { sold: 0, gain: 0, taxable: 0 } : dry && cv ? curveSell(cv[i], amt[i]) : depotSell(d, amt[i], mode, dry);
    out.sold += r.sold; out.gain += r.gain; out.taxable += r.taxable; out.per.push(r);
  });
  return out;
}

// Verkäufe eines Jahres zu ihrem Zeitpunkt (sells: [{ gross, t }], aufsteigend nach t) auf die Depots verteilen: nach Gewichten w (Probeverkauf zu Jahresbeginn),
// gedeckelt auf den Depotwert zum Zeitpunkt t; was ein Depot nicht hergibt, übernehmen die anderen. Liefert je Depot die Liste [{ gross, t }].
function depotsSellPlan(ds, R, sells, w) {
  const v0 = ds.map(depotValue), rem = [...v0], wSum = w.reduce((a, b) => a + b, 0), plan = ds.map(() => []);
  for (const { gross, t } of sells) {
    if (!(gross > 0)) continue;
    const f = ds.map((d, i) => v0[i] > 0 ? depotValueAt(d, R, t) / v0[i] : 0), cap = rem.map((r, i) => r * f[i]);
    const amt = ds.map((d, i) => Math.min(cap[i], wSum > 0 ? gross * w[i] / wSum : 0));
    let rest = gross - amt.reduce((a, b) => a + b, 0);
    for (let i = 0; i < ds.length && rest > 1e-9; i++) { const x = Math.min(rest, cap[i] - amt[i]); if (x > 0) { amt[i] += x; rest -= x; } }
    amt.forEach((a, i) => { if (a > 0) { plan[i].push({ gross: a, t }); rem[i] = Math.max(0, rem[i] - a / f[i]); } });
  }
  return plan;
}

// ═══════════════════════════════════════════════════════════════
// ALTERSVORSORGEDEPOT (AltVRefG, ab 2027) je Person
// Zwei Töpfe: gefördert (Eigenbeitrag bis 1.800 € + Zulagen, voll steuerpflichtig)
// und ungefördert (Beiträge darüber, nur Ertrag steuerpflichtig)
// ═══════════════════════════════════════════════════════════════
function makeAVD() {
  return { fv: 0, uv: 0, uCost: 0, paying: false, startAbs: null };   // startAbs: absoluter Monat des ersten Beitrags
}
function avdValue(a) { return a.fv + a.uv; }

function zulageGrund(c, P) {
  if (c < P.minEigen) return 0;
  return P.g1 * Math.min(c, P.g1Cap) + P.g2 * Math.max(0, Math.min(c, P.fMax) - P.g1Cap);
}

// Jahr der Ansparphase: Beiträge zum mittleren Zeitpunkt buyT (Jahresbruchteil), Zulage am Jahresende
function avdSaveYear(a, R, cost, cF, cU, zul, buyT = 0.5) {
  const g = R - cost, gc = Math.pow(Math.max(0.01, 1 + g), 1 - buyT);
  a.fv = a.fv * (1 + g) + cF * gc + zul;
  a.uv = a.uv * (1 + g) + cU * gc;
  a.uCost += cU;
}
function avdGrow(a, R, cost) { const g = R - cost; a.fv *= (1 + g); a.uv *= (1 + g); }
// Auszahlung paid zur Mitte der Auszahlungsmonate (t Jahre): das Restkapital bekommt zusätzlich die Rendite g des Ausgezahlten bis t (nach Anteil der Töpfe)
function avdPaidGain(a, g, paid, t) {
  const tot = avdValue(a); if (!(paid > 0) || tot <= 0) return;
  const x = paid * (Math.pow(Math.max(0.01, 1 + g), t) - 1);
  a.fv += x * a.fv / tot; a.uv += x * a.uv / tot;
}
function avdGrowPaid(a, R, cost, paid, t) { avdGrow(a, R, cost); avdPaidGain(a, R - cost, paid, t); }

// Hälftelung des ungeförderten Teils: § 22 Nr. 5 S. 2 c EStG verweist auf § 20 Abs. 1 Nr. 6 S. 2 (12 Jahre Laufzeit, ab 62)
function avdHalf(a, payAbs, P) {
  return a.startAbs != null && payAbs - a.startAbs >= INS.halfYears * 12 && Math.floor((payAbs - (P.by * 12 + P.bm - 1)) / 12) >= INS.halfAge;
}
function avdWithdraw(a, pay, half = false) {
  const tot = avdValue(a);
  pay = Math.min(pay, tot);
  if (pay <= 0) return { gross: 0, taxable: 0 };
  const sF = a.fv / tot, sU = a.uv / tot;
  const pF = pay * sF, pU = pay * sU;
  const uGainRatio = a.uv > 0 ? Math.max(0, (a.uv - a.uCost) / a.uv) : 0;
  const taxable = pF + pU * uGainRatio * (half ? 0.5 : 1);     // §22 Nr. 5 S. 1 voll, S. 2 c nur Unterschiedsbetrag (ggf. zur Hälfte)
  const costOut = pU * (1 - uGainRatio);
  a.fv -= pF; a.uv -= pU; a.uCost = Math.max(0, a.uCost - costOut);
  return { gross: pay, taxable };
}
