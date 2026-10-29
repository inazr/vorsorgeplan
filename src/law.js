// ═══════════════════════════════════════════════════════════════
// GESETZLICHE WERTE nach Jahr, mit Status und Quelle
// Status: G = geltendes Recht, B = beschlossen, E = Entwurf, A = Annahme
// ═══════════════════════════════════════════════════════════════
const LAW = {
  // §32a EStG. Zonen: gfb | e2 (Ende Zone 2) | e3 | e4 | e5 (null = keine 47%-Zone)
  tariff: {
    2026: { st: 'G', gfb: 12348, e2: 17799, e3: 69878, e4: 277825, e5: null,
      a: 914.51, b: 173.10, c: 1034.87, d4: 11135.63, d5: 19470.38, d6: null,
      src: 'https://www.gesetze-im-internet.de/estg/__32a.html' },
    2027: { st: 'E', gfb: 12564, e2: 17799, e3: 70600, e4: 249999, e5: 279999,
      a: 952.24, b: 170.74, c: 993.86, d4: 11241.73, d5: 18741.70, d6: 24341.68,
      src: 'https://dserver.bundestag.de/btd/21/082/2108235.pdf' },
    2028: { st: 'E', gfb: 12900, e2: 17799, e3: 70600, e4: 249999, e5: 279999,
      a: 1017.55, b: 170.74, c: 930.08, d4: 11305.52, d5: 18805.49, d6: 24405.47,
      src: 'https://dserver.bundestag.de/btd/21/082/2108235.pdf' },
  },
  soli: { st: 'G', freigrenzeSplit: 40700, satz: 0.055, milderung: 0.119, src: 'https://www.gesetze-im-internet.de/solzg_1995/__3.html' },
  kinder: { // Summe beider Eltern inkl. BEA, Kindergeld je Monat
    2026: { kfb: 9756, kg: 259, st: 'G' }, 2027: { kfb: 10056, kg: 267, st: 'E' }, 2028: { kfb: 10236, kg: 272, st: 'E' },
  },
  pausch: { anPausch: { 2026: 1230, 2027: { v: 1430, st: 'E' } }, rentnerWK: 102, sonderausg: 72 },
  eb24b: { 2026: { v: 4260, plus: 240, st: 'G' } },   // Entlastungsbetrag für Alleinerziehende: erstes Kind, je weiteres Kind (§ 24b Abs. 2 EStG)
  abgSt: 0.25, soliKap: 0.055, sparerPB: 2000,
  basiszins: { 2023: 2.55, 2024: 2.29, 2025: 2.53, 2026: 3.20 },
  // Altersentlastungsbetrag (§ 24a EStG, Status G): Satz und Höchstbetrag nach dem Jahr, das auf die Vollendung des 64. Lebensjahres folgt
  altEntl(y) {
    const n = Math.max(0, y - 2005), k = Math.min(n, 15), k2 = Math.min(Math.max(0, n - 15), 2), k3 = Math.max(0, n - 17);
    return { pct: Math.max(0, 0.40 - 0.016 * k - 0.008 * k2 - 0.004 * k3), max: Math.max(0, 1900 - 76 * k - 38 * k2 - 19 * k3) };
  },
  // Besteuerungsanteil Renten nach Wachstumschancengesetz
  besteuerungsanteil(y) {
    return (y <= 2005 ? 50 : y <= 2020 ? 50 + 2 * (y - 2005) : y <= 2022 ? 80 + (y - 2020) : Math.min(100, 82 + 0.5 * (y - 2022))) / 100;
  },
};

// Abgeltungssatz inkl. Soli und Kirchensteuer k (§ 32d Abs. 1 S. 3 EStG: Kirchensteuer mindert die Bemessungsgrundlage)
function kapRate(k) { return LAW.abgSt / (1 + LAW.abgSt * k) * (1 + LAW.soliKap + k); }

// Jahresweise Tabelle auflösen: letzter Eintrag mit Jahr <= year, davor der erste. Einträge sind Zahlen (gelten als 'G') oder Objekte mit st;
// Entwürfe ('E') zählen nur mit useDraft. v ist bei { v, st } der innere Wert, sonst der ganze Eintrag.
function lawPick(table, year, useDraft = true) {
  const e = y => table[y], st = x => (x !== null && typeof x === 'object' && x.st) || 'G';
  const ys = Object.keys(table).map(Number).filter(y => useDraft || st(e(y)) !== 'E').sort((a, b) => a - b);
  let y0 = ys[0];
  for (const y of ys) if (y <= year) y0 = y;
  const x = e(y0);
  return { y: y0, v: x !== null && typeof x === 'object' && Object.prototype.hasOwnProperty.call(x, 'v') ? x.v : x };
}

// Liefert den Tarif für ein Jahr. Nach dem letzten bekannten Jahr wird skaliert (Indexierung) oder eingefroren.
// opts.cp (optional): Preisfaktor vom Tarifjahr bis year (Monte-Carlo-Pfad), sonst opts.inflation fest
function tariffFor(year, opts) {
  const { y: base, v: p } = lawPick(LAW.tariff, year, opts.useDraft);
  const idx = (year > base && opts.indexTariff) ? (opts.cp ? opts.cp(base) : Math.pow(1 + opts.inflation, year - base)) : 1;
  return { p, idx };
}

function estGrund(x, p) { // Einzeltarif, x = zvE
  x = Math.floor(x);
  if (x <= p.gfb) return 0;
  if (x <= p.e2) { const y = (x - p.gfb) / 1e4; return (p.a * y + 1400) * y; }
  if (x <= p.e3) { const z = (x - p.e2) / 1e4; return (p.b * z + 2397) * z + p.c; }
  if (x <= p.e4) return 0.42 * x - p.d4;
  if (p.e5 == null || x <= p.e5) return 0.45 * x - p.d5;
  return 0.47 * x - p.d6;
}
