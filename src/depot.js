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

// Ein Jahr Marktentwicklung + Sparrate + Ausschüttung + Vorabpauschale.
// contrib wird zum mittleren Kaufzeitpunkt opts.buyT (Jahresbruchteil, 0,5 = gleichmäßig übers Jahr) investiert.
// Liefert steuerrelevante Beträge (vor Teilfreistellung und Pauschbetrag).
function depotYear(d, year, R, contrib, basiszins, opts) {
  const out = { dist: 0, distTaxable: 0, vp: 0, vpTaxable: 0, contrib: 0 };
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

// ═══════════════════════════════════════════════════════════════
// ALTERSVORSORGEDEPOT (AltVRefG, ab 2027) je Person
// Zwei Töpfe: gefördert (Eigenbeitrag bis 1.800 € + Zulagen, voll steuerpflichtig)
// und ungefördert (Beiträge darüber, nur Ertrag steuerpflichtig)
// ═══════════════════════════════════════════════════════════════
function makeAVD() {
  return { fv: 0, uv: 0, uCost: 0, paying: false };
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

function avdWithdraw(a, pay) {
  const tot = avdValue(a);
  pay = Math.min(pay, tot);
  if (pay <= 0) return { gross: 0, taxable: 0 };
  const sF = a.fv / tot, sU = a.uv / tot;
  const pF = pay * sF, pU = pay * sU;
  const uGainRatio = a.uv > 0 ? Math.max(0, (a.uv - a.uCost) / a.uv) : 0;
  const taxable = pF + pU * uGainRatio;     // §22 Nr. 5 S. 1 voll, S. 2 c nur Unterschiedsbetrag
  const costOut = pU * (1 - uGainRatio);
  a.fv -= pF; a.uv -= pU; a.uCost = Math.max(0, a.uCost - costOut);
  return { gross: pay, taxable };
}
