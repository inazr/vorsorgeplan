// ═══════════════════════════════════════════════════════════════
// IMMOBILIENKREDITE: Annuitätendarlehen ab Auszahlung, Monat für Monat
// Effektivzins wird in einen Monatszins umgerechnet: (1 + eff)^(1/12) − 1
// Nach Ende der Zinsbindung: Anschlussfinanzierung, Ablösung aus dem ETF-Depot
// oder Teilablösung + Anschluss. Sondertilgungen jährlich im Dezember.
// ═══════════════════════════════════════════════════════════════
const loanRateM = eff => Math.pow(1 + eff, 1 / 12) - 1;
const annuityM = (bal, rM, n) => n <= 0 ? bal : rM > 0 ? bal * rM / (1 - Math.pow(1 + rM, -n)) : bal / n;
const absM = (y, m) => y * 12 + (m - 1);

const makeLoanState = c => ({ c, bal: c.amount, rM: loanRateM(c.eff), pay: c.monthly, phase: 'fix', fixBal: null, postRate: 0, interestTotal: 0 });
function makeLoans(cfgs, simStartAbs) {
  const st = cfgs.map(makeLoanState);
  // Vergangenheit bis Simulationsstart abspulen (ohne Sondertilgungen)
  for (const l of st) for (let a = absM(l.c.startY, l.c.startM); a < simStartAbs; a++) loanMonth(l, a, true);
  return st;
}

function loanMonth(l, a, past) {
  const out = { pay: 0, sonder: 0, payoff: 0, interest: 0 };
  if (a < absM(l.c.startY, l.c.startM) || l.phase === 'done' || l.bal <= 0.005) { if (l.bal <= 0.005) l.phase = 'done'; return out; }
  if (l.phase === 'fix' && a === absM(l.c.fixEndY, l.c.fixEndM)) {
    if (l.c.fixBalBank > 0) l.bal = Math.max(0, l.c.fixBalBank - (l.sonderSum || 0));   // Tilgungsplan der Bank minus eigene Sondertilgungen (gesparte Zinsen konservativ ignoriert)
    l.fixBal = l.bal;
    if (l.c.after === 'etf') { out.payoff = l.bal; l.bal = 0; l.phase = 'done'; return out; }
    if (l.c.after === 'teil') { const x = Math.min(l.c.teil, l.bal); out.payoff = x; l.bal -= x; }
    l.phase = 'post'; l.rM = loanRateM(l.c.zins); l.pay = annuityM(l.bal, l.rM, l.c.years * 12); l.postRate = l.pay;
    if (l.bal <= 0.005) { l.phase = 'done'; return out; }
  }
  const i = l.bal * l.rM;
  const free = l.phase === 'fix' && a - absM(l.c.startY, l.c.startM) < (l.c.freeMonths || 0);   // tilgungsfreie Anlaufzeit
  const p = free ? i : Math.min(l.pay, l.bal + i);
  l.bal = l.bal + i - p;
  l.interestTotal += i;
  out.pay = p; out.interest = i;
  const y = Math.floor(a / 12), m = a % 12;
  if (!past && l.phase === 'fix' && m === 11 && l.c.sonder > 0 && y >= l.c.sonderFrom && y <= l.c.sonderTo) {
    const s = Math.min(l.c.sonder, l.bal); l.bal -= s; out.sonder = s; l.sonderSum = (l.sonderSum || 0) + s;
  }
  if (l.bal <= 0.005) { l.bal = 0; l.phase = 'done'; }
  return out;
}

// Vorschau für die Oberfläche: Restschuld heute, bei Zinsbindungsende, Anschlussrate, Zinsen
function loanPreview(c, todayAbs) {
  const l = makeLoanState(c);
  let today = null, payoff = 0, end = null;
  const fixAbs = absM(c.fixEndY, c.fixEndM);
  for (let a = absM(c.startY, c.startM); a < fixAbs + 600; a++) {
    if (a === todayAbs) today = l.bal;
    const o = loanMonth(l, a, a < todayAbs);
    payoff += o.payoff;
    if (l.phase === 'done') { end = a; break; }
  }
  return { today: today ?? l.bal, fixBal: l.fixBal, postRate: l.postRate, payoff, end, interestTotal: l.interestTotal };
}
