// ═══════════════════════════════════════════════════════════════
// ZUSTAND: reine Helfer (kein DOM, kein localStorage)
// ═══════════════════════════════════════════════════════════════
const STORE_KEY = 'vorsorgeplan-v1';
const clone = o => JSON.parse(JSON.stringify(o));
// Wirksame Eingaben: ohne Person 2 nur Person 1, unverheiratet, alle Verweise (Kinderzulage, Kindergeld, Altersbezug) auf Person 1. Sonst eine tiefe Kopie.
function effI(I) {
  const J = clone(I);
  if (J.person2On === false) {
    J.persons = [J.persons[0]]; J.married = false;
    J.children.forEach(c => { c.zulageTo = 0; c.kgTo = 0; if ('kezTo' in c) c.kezTo = 0; });
    J.withdraw.refPerson = 0;
  }
  return J;
}
// Text für innerHTML entschärfen (Werte können aus geladenen Eingaben stammen)
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function deepMerge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over.map((v, i) => base[i] !== undefined && typeof base[i] === 'object' ? deepMerge(base[i], v) : v) : base;
  if (base && typeof base === 'object') { const o = { ...base }; if (over && typeof over === 'object') for (const k of Object.keys(over)) o[k] = k in base ? deepMerge(base[k], over[k]) : over[k]; return o; }
  return over === undefined ? base : over;
}
// Neuer Kredit mit Beispielwerten (auch Vorlage für die Typprüfung geladener Kredite)
const loanTpl = y => ({ name: 'Darlehen', amount: 300000, eff: 0.035, startY: y, startM: 1, monthly: 1350, freeMonths: 0, fixBalBank: 0,
  fixEndY: y + 10, fixEndM: 1, sonder: 0, sonderFrom: y, sonderTo: y + 9, after: 'anschluss', zins: 0.04, years: 20, teil: 0 });
// Erlaubte Werte der Auswahlfelder, nach Feldname
const ENUMS = { job: ['employee', 'self'], grvMode: ['prognose', 'ep'], kvdr: ['auto', 'ja', 'nein', 'pkv'], mode: ['rente', 'kapital', 'teil'], refundTo: ['same', 'etf', 'none'],
  optMode: ['fast', 'mc'], strategy: ['realConst', 'perpetual', 'fixedNet'], sellMode: ['newestFirst', 'inOrder'], saveUntil: ['first', 'last'], after: ['anschluss', 'etf', 'teil'], type: ['acc', 'dist'], kist: [0, 0.08, 0.09] };   // kist: Kirchensteuersatz (Zahl, nur diese Werte)
// Geladene Eingaben an die Form der Standardwerte anpassen: Zahlen, Schalter und Auswahlfelder nur mit gültigen Werten
function conform(base, val, key) {
  if (Array.isArray(base)) return Array.isArray(val) ? val.map((v, i) => conform(base[i] ?? base[0] ?? v, v, key)) : base;
  if (base && typeof base === 'object') {
    const o = val && typeof val === 'object' ? { ...val } : {};   // unbekannte Schlüssel bleiben für Migrationen erhalten
    for (const k of Object.keys(base)) o[k] = conform(base[k], val?.[k], k);
    return o;
  }
  if (typeof base === 'number' && ENUMS[key]) return ENUMS[key].includes(Number(val)) && val !== null && val !== '' ? Number(val) : base;
  if (typeof base === 'number') { const n = Number(val); return val !== null && val !== '' && isFinite(n) ? n : base; }
  if (typeof base === 'boolean') return typeof val === 'boolean' ? val : base;
  if (typeof base === 'string') return ENUMS[key] ? (ENUMS[key].includes(val) ? val : base) : (val == null ? base : String(val));
  return val === undefined ? base : val;
}
const TPL_I = { ...DEFAULTS, loans: [loanTpl(2026)] };
// Keine Migrationen alter Stände: unbekannte oder ungültige Werte fallen auf die Standardwerte zurück
const loadState = p => ({ I: conform(TPL_I, deepMerge(clone(DEFAULTS), p.I)), A: conform(ASSUME, deepMerge(clone(ASSUME), p.A)) });
