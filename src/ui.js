// ═══════════════════════════════════════════════════════════════
// OBERFLÄCHE
// ═══════════════════════════════════════════════════════════════
const STORE_KEY = 'vorsorgeplan-v1';
const clone = o => JSON.parse(JSON.stringify(o));
function deepMerge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over.map((v, i) => base[i] !== undefined && typeof base[i] === 'object' ? deepMerge(base[i], v) : v) : base;
  if (base && typeof base === 'object') { const o = { ...base }; if (over && typeof over === 'object') for (const k of Object.keys(over)) o[k] = k in base ? deepMerge(base[k], over[k]) : over[k]; return o; }
  return over === undefined ? base : over;
}
let ST = { I: clone(DEFAULTS), A: clone(ASSUME) };
try { const s = localStorage.getItem(STORE_KEY); if (s) { const p = JSON.parse(s); ST = { I: deepMerge(clone(DEFAULTS), p.I), A: deepMerge(clone(ASSUME), p.A) }; } } catch (e) { }
// Optionale Migration gespeicherter Eingaben (nur in der privaten Version definiert)
if (typeof MIGRATE === 'function') { try { MIGRATE(ST); } catch (e) { } }
ST.I.loans = ST.I.loans || [];
(ST.I.children || []).forEach(c => { if (c.zulageTo == null) { const k = ST.I.persons.findIndex(p => p.avd?.kinderzulage); c.zulageTo = k >= 0 ? k : 1; } });
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(ST)); } catch (e) { } };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const eur = n => nf0.format(Math.round(n)) + ' €';
const keur = n => Math.abs(n) >= 1e6 ? (n / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' Mio. €' : nf0.format(Math.round(n / 1000)) + ' Tsd. €';
const pc = (x, d = 1) => (x * 100).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' %';
const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function getP(path) { return path.split('.').reduce((o, k) => o?.[k], ST); }
function setP(path, v) { const ks = path.split('.'); const last = ks.pop(); const o = ks.reduce((o, k) => o[k], ST); o[last] = v; }
const idOf = p => 'f-' + p.replace(/\./g, '-');

// ─── Feld-Bausteine ───
function F(path, label, o = {}) {
  const v = getP(path);
  const t = o.t || 'num';
  const shown = t === 'pct' ? +(v * 100).toFixed(4) : v;
  const unit = o.u ?? (t === 'eur' ? '€' : t === 'pct' ? '%' : '');
  return `<div class="f"><label for="${idOf(path)}">${label}</label><div class="in"><input id="${idOf(path)}" type="number" inputmode="decimal" data-path="${path}" data-t="${t}" value="${shown}" step="${o.step ?? (t === 'pct' ? 0.1 : t === 'eur' ? 100 : 1)}"${o.min != null ? ` min="${o.min}"` : ''}${o.max != null ? ` max="${o.max}"` : ''}${o.rr ? ' data-rr="1"' : ''}>${unit ? `<span class="u">${unit}</span>` : ''}</div>${o.h ? `<div class="h">${o.h}</div>` : ''}</div>`;
}
function T(path, label, o = {}) {
  return `<div class="f"><label for="${idOf(path)}">${label}</label><div class="in"><input id="${idOf(path)}" type="text" data-path="${path}" data-t="text" value="${String(getP(path)).replace(/"/g, '&quot;')}"${o.rr ? ' data-rr="1"' : ''}></div></div>`;
}
function S(path, label, opts, o = {}) {
  const v = getP(path);
  return `<div class="f"><label for="${idOf(path)}">${label}</label><div class="in"><select id="${idOf(path)}" data-path="${path}" data-t="sel"${o.rr ? ' data-rr="1"' : ''}>${opts.map(([val, l]) => `<option value="${JSON.stringify(val).replace(/"/g, '&quot;')}"${val === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>${o.h ? `<div class="h">${o.h}</div>` : ''}</div>`;
}
function C(path, label, o = {}) {
  return `<label class="chk"><input type="checkbox" id="${idOf(path)}" data-path="${path}" data-t="bool"${getP(path) ? ' checked' : ''}${o.rr ? ' data-rr="1"' : ''}>${label}</label>`;
}
const yearOpts = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => [a + i, String(a + i)]);
const monOpts = MON.map((m, i) => [i + 1, m]);

// ─── Zustand und Neuberechnung ───
let R = null, tab = 0, chartScen = 'B', chartReal = true, chartPerson = -1, recalcT = null, MC = null;
function readInput(el) {
  const t = el.dataset.t;
  if (t === 'bool') return el.checked;
  if (t === 'sel') return JSON.parse(el.value);
  if (t === 'text') return el.value;
  const n = parseFloat(el.value);
  if (!isFinite(n)) return null;
  return t === 'pct' ? n / 100 : n;
}
document.addEventListener('input', e => onField(e.target));
document.addEventListener('change', e => onField(e.target, true));
function onField(el, isChange) {
  if (!el.dataset?.path) return;
  const v = readInput(el);
  if (v === null) return;
  setP(el.dataset.path, v);
  save();
  if (el.dataset.path === 'I.depot.nFunds') autoSplit();
  if (el.dataset.rr && isChange) { renderPanels(); }
  scheduleRecalc();
}
function scheduleRecalc() { clearTimeout(recalcT); recalcT = setTimeout(recalc, 250); }

function recalc() {
  const { I, A } = ST;
  const t0 = performance.now();
  const out = {};
  if (I.withdraw.strategy === 'realConst') {
    out.netA = maxNet(I, A, 'A');
    out.netB = maxNet(I, A, 'B', null, out.netA);
  }
  out.simA = simulate(I, A, { scenario: 'A', targetReal: out.netA || 0, detail: true });
  out.simB = simulate(I, A, { scenario: 'B', targetReal: out.netB || 0, detail: true });
  out.ms = performance.now() - t0;
  R = out;
  renderKPIs(); renderFacts();
  if (tab === 2) renderCharts();
}

// ─── Kennzahlen im Kopf ───
function rowAt(sim, y) { return sim.rows.find(r => r.year === y); }
function renderKPIs() {
  const { I } = ST;
  const sA = R.simA, sB = R.simB;
  const ws = sB.wStartYear;
  const rA = rowAt(sA, ws - 1), rB = rowAt(sB, ws - 1);
  const wA = rA ? rA.netWorth / rA.priceIdx : 0, wB = rB ? rB.netWorth / rB.priceIdx : 0;
  let html = '';
  if (I.withdraw.strategy === 'realConst') {
    const d = R.netB - R.netA;
    html += kpi('Nur ETF-Depot (A)', eur(R.netA) + '/Monat', 'Netto in heutiger Kaufkraft', 'sA');
    html += kpi('Mit Altersvorsorgedepot (B)', eur(R.netB) + '/Monat', 'Netto in heutiger Kaufkraft', 's2', true);
    html += kpi('Unterschied B gegen A', (d >= 0 ? '+' : '') + eur(d) + '/Monat', (d >= 0 ? '+' : '') + pc(d / R.netA) + ' · bis ' + (I.persons[I.withdraw.refPerson].name) + ' ' + I.withdraw.targetAge);
  } else {
    const yA = sA.depletedYear, yB = sB.depletedYear;
    html += kpi('Kapital reicht (A)', yA ? 'bis ' + (yA - 1) : 'bis Zielalter', yA ? 'danach fehlen Mittel' : 'Endvermögen ' + keur(sA.final), 'sA');
    html += kpi('Kapital reicht (B)', yB ? 'bis ' + (yB - 1) : 'bis Zielalter', yB ? 'danach fehlen Mittel' : 'Endvermögen ' + keur(sB.final), 's2', true);
    html += kpi('Wunsch-Netto', eur(I.withdraw.fixedNet) + '/Monat', I.withdraw.fixedIndexed ? 'mit Inflation angepasst' : 'nominal fest');
  }
  html += kpi('Nettovermögen bei Entnahmestart ' + ws, keur(wB) + ' (B)', keur(wA) + ' (A), heutige Kaufkraft');
  $('#kpis').innerHTML = html;
}
function kpi(l, v, d, sw, b) { return `<div class="kpi${b ? ' b' : ''}"><div class="l">${sw ? `<span class="sw" style="background:var(--${sw})"></span>` : ''}${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`; }

// ═══ Reiter 1: Haushalt ═══
function personCard(i) {
  const P = ST.I.persons[i], b = `I.persons.${i}`;
  const job = P.job === 'employee';
  return `<div class="card">
    <div class="card-h"><h2>${P.name}</h2></div>
    <div class="fields">
      ${T(b + '.name', 'Name', { rr: 1 })}
      ${S(b + '.job', 'Erwerbsart', [['employee', 'Angestellt'], ['self', 'Selbständig']], { rr: 1 })}
      ${S(b + '.bm', 'Geburtsmonat', monOpts)}
      ${F(b + '.by', 'Geburtsjahr', { t: 'int', min: 1950, max: 2005 })}
      ${F(b + '.income', 'Bruttogehalt / Gewinn ' + ST.I.startYear, { t: 'eur', step: 1000 })}
      ${F(b + '.incomeGrowth', 'Einkommen steigt pro Jahr um', { t: 'pct' })}
      ${F(b + '.retireAge', 'Renteneintritt mit', { t: 'int', u: 'Jahren', min: 63, max: 70, h: 'Regelaltersgrenze 67. Früher: 0,3 % Abschlag je Monat. Später: 0,5 % Zuschlag.' })}
    </div>
    <h3>Gesetzliche Rente</h3>
    <div class="fields">
      ${S(b + '.grvMode', 'Berechnung', [['prognose', 'Prognose aus Renteninfo'], ['ep', 'Entgeltpunkte bisher']], { rr: 1 })}
      ${P.grvMode === 'prognose'
        ? F(b + '.grvPrognose', 'Prognose laut Renteninfo', { t: 'eur', u: '€/Monat', step: 10 }) + F(b + '.grvRwInfo', 'Rentenwert zum Ausstellungsdatum', { t: 'num', step: 0.01, u: '€', h: 'Ab 1.7.2025: 40,79 €. Ab 1.7.2026: 42,52 €.' })
        : F(b + '.epNow', 'Entgeltpunkte bisher', { t: 'num', step: 0.1, h: 'Steht in der Renteninfo. Kindererziehungszeiten sind dort schon enthalten.' }) + `<div class="f">${C(b + '.rvPflicht', 'Zahlt weiter Pflichtbeiträge')}</div>`}
    </div>
    <h3>Krankenversicherung im Alter</h3>
    <div class="fields three">
      ${S(b + '.kvdr', 'Status im Alter', [['auto', 'Gesetzlich, automatisch prüfen'], ['ja', 'Gesetzlich, KVdR (pflicht)'], ['nein', 'Gesetzlich, freiwillig'], ['pkv', 'Privat (PKV)']], { rr: 1 })}
      ${P.kvdr === 'pkv' ? `
      ${F(b + '.pkvPremium', 'PKV-Beitrag heute inkl. PV', { t: 'eur', u: '€/Monat', step: 10 })}
      ${F(b + '.pkvGrowth', 'Beitrag steigt pro Jahr um', { t: 'pct', h: 'PKV langfristig etwa 3 %' })}
      ${F(b + '.pkvRelief', 'Entlastung ab Rente (heute)', { t: 'eur', u: '€/Monat', step: 10, h: 'Wegfall Krankentagegeld, Entlastungstarif' })}
      ${F(b + '.pkvBasis', 'Abziehbarer Basisanteil', { t: 'pct', step: 1 })}` : `
      ${F(b + '.firstWork', 'Erste Erwerbstätigkeit', { t: 'int', min: 1980, max: 2030 })}
      ${F(b + '.pkvYearsSecondHalf', 'Jahre privat versichert', { t: 'num', step: 0.5, u: 'J.', h: 'Nur in der zweiten Hälfte des Erwerbslebens' })}`}
    </div>
    ${C(b + '.krankengeld', 'Mit Anspruch auf Krankengeld')}
    <div class="facts" id="facts-${i}"></div>
  </div>`;
}
function loanCard(k) {
  const L = ST.I.loans[k], b = `I.loans.${k}`;
  return `<div class="fund">
    <div class="fund-h"><span style="flex:1">${L.name}</span><button class="btn" data-loan-del="${k}">Entfernen</button></div>
    <div class="fields three">
      ${T(b + '.name', 'Bezeichnung', { rr: 1 })}
      ${F(b + '.amount', 'Darlehensbetrag', { t: 'eur', step: 1000 })}
      ${F(b + '.eff', 'Effektivzins', { t: 'pct', step: 0.01 })}
      ${S(b + '.startM', 'Auszahlung (Monat)', monOpts)}
      ${F(b + '.startY', 'Auszahlung (Jahr)', { t: 'int' })}
      ${F(b + '.monthly', 'Rate', { t: 'eur', u: '€/Monat', step: 5 })}
      ${F(b + '.freeMonths', 'Tilgungsfreie Monate', { t: 'int', min: 0, max: 60, h: 'Nur Zinsen ab Auszahlung' })}
      ${F(b + '.fixBalBank', 'Restschuld laut Tilgungsplan', { t: 'eur', step: 100, h: 'Zum Ende der Zinsbindung. 0 = selbst rechnen' })}
      ${S(b + '.fixEndM', 'Zinsbindung bis (Monat)', monOpts)}
      ${F(b + '.fixEndY', 'Zinsbindung bis (Jahr)', { t: 'int' })}
      ${F(b + '.sonder', 'Sondertilgung pro Jahr', { t: 'eur', step: 500, h: 'Im Dezember, aus dem Budget' })}
      ${F(b + '.sonderFrom', 'Sondertilgung von', { t: 'int' })}
      ${F(b + '.sonderTo', 'bis', { t: 'int' })}
      ${S(b + '.after', 'Nach der Zinsbindung', [['anschluss', 'Anschlussfinanzierung'], ['etf', 'Ablösung aus ETF-Depot'], ['teil', 'Teilablösung + Anschluss']], { rr: 1 })}
      ${L.after !== 'etf' ? F(b + '.zins', 'Anschlusszins (effektiv)', { t: 'pct', step: 0.1 }) + F(b + '.years', 'Anschluss-Laufzeit', { t: 'int', u: 'Jahre' }) : ''}
      ${L.after === 'teil' ? F(b + '.teil', 'Ablösebetrag aus Depot', { t: 'eur', step: 5000 }) : ''}
    </div>
    <div class="facts" id="loanfacts-${k}"></div>
  </div>`;
}
function renderP0() {
  const I = ST.I;
  $('#p0').innerHTML = `
  <div class="grid">${personCard(0)}${personCard(1)}</div>
  <div class="card">
    <div class="card-h"><h2>Sparbudget und Hauskredit</h2></div>
    <div class="fields three">
      ${F('I.budget.monthly', 'Gesamtbudget pro Monat', { t: 'eur', step: 50, h: 'Kreditraten, Sondertilgungen und alle Sparraten' })}
      ${F('I.budget.dyn', 'Budget steigt pro Jahr um', { t: 'pct', h: 'Unabhängig von der Gehaltssteigerung in den Personenkarten' })}
      ${S('I.saveUntil', 'Sparen bis', [['first', 'Erster Rentenbeginn'], ['last', 'Letzter Rentenbeginn']])}
    </div>
    <div class="card-h"><h3>Kredite</h3><button class="btn" id="btn-loan-add">Kredit hinzufügen</button></div>
    ${I.loans.length ? `<div class="grid">${I.loans.map((l, k) => loanCard(k)).join('')}</div>` : ''}
    <div class="note" id="loan-info"></div>
    ${I.loans.length ? '<div class="row"><button class="btn" id="btn-be">Break-even-Zins berechnen</button><span id="be-out" class="muted"></span></div>' : ''}
  </div>
  <div>
    <div class="card">
      <div class="card-h"><h2>Vermögen und Kinder</h2></div>
      <div class="fields">
        ${F('I.depot.startValue', 'ETF-Depots heute (Summe)', { t: 'eur', step: 1000 })}
        ${F('I.depot.startCost', 'davon Einstandswert', { t: 'eur', step: 1000, h: 'Kaufpreis aller Anteile. Bestimmt die Steuer beim Verkauf.' })}
        ${F('I.startYear', 'Rechnung startet', { t: 'int', min: 2026, max: 2030, rr: 1 })}
      </div>
      <div class="card-h"><h3>Kinder</h3><button class="btn" id="btn-kid-add">Kind hinzufügen</button></div>
      ${I.children.map((c, k) => `<div class="fund">
        <div class="fund-h"><span style="flex:1">${c.name}</span><button class="btn" data-kid-del="${k}">Entfernen</button></div>
        <div class="fields three">
          ${T(`I.children.${k}.name`, 'Name', { rr: 1 })}
          ${S(`I.children.${k}.bm`, 'Geburtsmonat', monOpts)}
          ${F(`I.children.${k}.by`, 'Geburtsjahr', { t: 'int' })}
          ${S(`I.children.${k}.kgUntil`, 'Kindergeld bis Alter', [[18, '18 Jahre'], [25, '25 Jahre (Ausbildung)']])}
          ${S(`I.children.${k}.zulageTo`, 'Kinderzulage an', I.persons.map((p, i) => [i, p.name]))}
        </div></div>`).join('')}
      <p class="note">Kinder zählen für Kinderfreibetrag und Kindergeld, die Kinderzulage im Altersvorsorgedepot (300 € je Kind, solange Kindergeld fließt), den Abschlag in der Pflegeversicherung ab dem 2. Kind unter 25 und die 9/10-Regel (3 Jahre je Kind). Die Kinderzulage braucht beim jeweiligen Elternteil mindestens so viel Eigenbeitrag, wie sie hoch ist. Ab 2028 folgt sie gesetzlich dem Kindergeldbezug, wenn ihr nichts anderes erklärt. Die Frühstart-Rente ist nicht eingerechnet.</p>
    </div>
  </div>`;
  $('#btn-kid-add').onclick = () => { ST.I.children.push({ name: 'Kind ' + (ST.I.children.length + 1), by: 2027, bm: 1, kgUntil: 18, zulageTo: 1 }); save(); renderPanels(); scheduleRecalc(); };
  $$('[data-kid-del]').forEach(b => b.onclick = () => { ST.I.children.splice(+b.dataset.kidDel, 1); save(); renderPanels(); scheduleRecalc(); });
  $('#btn-loan-add').onclick = () => {
    const y = Math.max(ST.I.startYear, 2026);
    ST.I.loans.push({ name: 'Darlehen ' + (ST.I.loans.length + 1), amount: 300000, eff: 0.035, startY: y, startM: 1, monthly: 1350, freeMonths: 0, fixBalBank: 0,
      fixEndY: y + 10, fixEndM: 1, sonder: 0, sonderFrom: y, sonderTo: y + 9, after: 'anschluss', zins: 0.04, years: 20, teil: 0 });
    save(); renderPanels(); scheduleRecalc();
  };
  $$('[data-loan-del]').forEach(b => b.onclick = () => { ST.I.loans.splice(+b.dataset.loanDel, 1); save(); renderPanels(); scheduleRecalc(); });
  if ($('#btn-be')) $('#btn-be').onclick = () => {
    const b = $('#btn-be'); b.disabled = true; $('#be-out').textContent = 'rechnet…';
    setTimeout(() => {
      const r = houseBreakEven(ST.I, ST.A, 'B');
      b.disabled = false;
      $('#be-out').innerHTML = r.rate == null ? 'Die Ablösung aus dem Depot ist auch bei 0 % Zins besser.' : r.rate === Infinity ? 'Die Anschlussfinanzierung ist bis 15 % Zins besser.' : `Die Anschlussfinanzierung lohnt sich bis <b class="num">${pc(r.rate, 2)}</b> Zins (beide Darlehen). Darüber ist die Ablösung aus dem Depot besser.`;
    }, 30);
  };
}

function renderFacts() {
  const I = ST.I;
  I.persons.forEach((P, i) => {
    const el = $('#facts-' + i); if (!el) return;
    const rs = retireStartAbs(P), y = Math.floor(rs / 12), m = rs % 12;
    const kv = kvdrCheck(P, I.children.length);
    const zf = zugangsfaktor(P);
    const epTot = P.grvMode === 'prognose' ? P.grvPrognose / P.grvRwInfo : R.simB.ep[i];
    const row = R.simB.rows.find(r => r.grv[i] > 0 && r.year > y) || R.simB.rows.find(r => r.grv[i] > 0);
    const monthly = row ? row.grv[i] / 12 : 0;
    el.innerHTML = [
      ['Rentenbeginn', MON[m] + ' ' + y],
      ['Zugangsfaktor', zf.toLocaleString('de-DE', { maximumFractionDigits: 3 })],
      ['Steuerpflichtiger Anteil', pc(LAW.besteuerungsanteil(y))],
      ['Entgeltpunkte', epTot.toLocaleString('de-DE', { maximumFractionDigits: 1 })],
      ['Rente brutto ' + (row?.year ?? ''), eur(monthly) + '/M.'],
      ['in heutiger Kaufkraft', eur(row ? monthly / row.priceIdx : 0) + '/M.'],
    ].map(([l, v]) => `<div class="fact"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('')
      + `<div class="fact" style="grid-column:1/-1"><div class="l">Krankenversicherung im Alter</div><div class="v">${kv.pkv
        ? (() => { const rr = R.simB.rows.find(r => r.year > y) || row; const kvm = rr ? rr.pp[i].kv / 12 : 0;
            return `<span class="pill info">Privat · keine Beiträge auf Kapitalerträge</span> <span class="muted" style="font-family:var(--font-ui);font-size:11px">Eigenanteil ${rr?.year ?? ''} nach Zuschuss der Rentenversicherung: ${eur(kvm)}/M., heutige Kaufkraft ${eur(rr ? kvm / rr.priceIdx : 0)}/M.</span>`; })()
        : kv.ok
        ? `<span class="pill good">KVdR · keine Beiträge auf Depot-Erträge</span>`
        : `<span class="pill warn">Freiwillig · Beiträge auch auf Kapitalerträge und Altersvorsorgedepot</span>`}${kv.auto ? ` <span class="muted" style="font-family:var(--font-ui);font-size:11px">9/10-Regel: ${kv.have.toFixed(1)} von nötigen ${kv.need.toFixed(1)} Jahren</span>` : ''}</div></div>`;
  });
  const now = new Date(), todayAbs = now.getFullYear() * 12 + now.getMonth();
  I.loans.forEach((c, k) => {
    const el = $('#loanfacts-' + k); if (!el) return;
    const pv = loanPreview(c, todayAbs);
    el.innerHTML = [
      ['Restschuld heute', eur(pv.today)],
      ['Restschuld ' + MON[c.fixEndM - 1] + ' ' + c.fixEndY, eur(pv.fixBal ?? 0)],
      [c.after === 'etf' ? 'Ablösung aus Depot' : 'Anschlussrate', c.after === 'etf' ? eur(pv.payoff) : eur(pv.postRate) + '/M.'],
      ['Schuldenfrei', pv.end != null ? MON[pv.end % 12] + ' ' + Math.floor(pv.end / 12) : '–'],
      ['Zinsen gesamt', eur(pv.interestTotal)],
    ].map(([l, v]) => `<div class="fact"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');
  });
  const li = $('#loan-info');
  if (li) {
    const hs = R.simB.houseSale;
    const first = R.simB.rows[0];
    li.innerHTML = !I.loans.length ? 'Kein Kredit eingetragen. Das ganze Budget fließt in die Sparpläne.' : `Kreditraten ${first.year}: <b class="num">${eur(first.loanPay / 12)}</b> pro Monat. Der Rest des Budgets fließt in die Sparpläne.`
      + (hs ? ` Ablösung ${hs.year}: <b class="num">${eur(hs.payoff)}</b> Restschuld, dafür werden <b class="num">${eur(hs.gross)}</b> aus dem ETF-Depot verkauft, davon <b class="num">${eur(hs.tax)}</b> Kapitalertragsteuer.`
        + (hs.covered < hs.payoff - 1 ? ` <span class="pill warn">Depot reicht nicht</span> Die restlichen <b class="num">${eur(hs.payoff - hs.covered)}</b> laufen als Anschlussfinanzierung weiter.` : '') : '');
  }
  // Fakten Strategie-Reiter
  I.persons.forEach((P, i) => {
    const el = $('#avdfacts-' + i); if (!el) return;
    const a = P.avd;
    const cF = Math.min(a.eigen, AVD.fMax);
    const nowY = Math.max(ST.I.startYear, 2027);
    const zk = I.children.filter(c => (c.zulageTo ?? 1) === i && nowY - c.by <= c.kgUntil).length;
    const zul = zulageGrund(cF, AVD) + (zk > 0 && cF >= AVD.minEigen ? Math.min(cF, AVD.kindMax * zk) : 0);
    const startRow = R.simB.rows.find(r => r.avdPay[i] > 0);
    const before = startRow ? R.simB.rows.find(r => r.year === startRow.year - 1) : null;
    el.innerHTML = [
      ['Zulagen ' + nowY, eur(zul) + (zk ? ` (${zk} Kind${zk > 1 ? 'er' : ''})` : '')],
      ['Förderquote auf Eigenbeitrag', cF > 0 ? pc(zul / cF, 0) : '–'],
      ['Kapital bei Auszahlung', before ? keur(before.avd[i] / before.priceIdx) : '–'],
      ['Erste Auszahlung', startRow ? eur(startRow.avdPay[i] / 12 / startRow.priceIdx) + '/M.' : '–'],
    ].map(([l, v]) => `<div class="fact"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');
  });
  const fi = $('#fund-issues');
  if (fi) {
    const iss = fundIssues(I);
    fi.innerHTML = iss.length ? `<div class="note" style="background:var(--warn-soft)"><span class="pill warn">Zeiträume prüfen</span><ul style="margin:6px 0 0 18px;padding:0">${iss.map(x => `<li>${x}</li>`).join('')}</ul></div>` : '';
  }
  const rf = $('#refund-info');
  if (rf) {
    const sv = R.simB;
    rf.innerHTML = `Bis zum Rentenbeginn bekommt ihr <b class="num">${keur(sv.sumZulagen)}</b> Zulagen und <b class="num">${keur(sv.sumRefunds)}</b> zusätzliche Steuererstattung aus dem Sonderausgabenabzug (nominal). Die Erstattung fließt im Folgejahr ins ETF-Depot. Kapital in heutiger Kaufkraft.`;
  }
}

// ═══ Reiter 2: Strategie ═══
function avdCard(i) {
  const P = ST.I.persons[i], b = `I.persons.${i}.avd`;
  return `<div class="card">
    <div class="card-h"><h2>Altersvorsorgedepot ${P.name}</h2>${C(b + '.on', 'In Szenario B nutzen', { rr: 1 })}</div>
    ${P.avd.on ? `<div class="fields">
      ${F(b + '.eigen', 'Geförderter Eigenbeitrag', { t: 'eur', u: '€/Jahr', step: 60, min: 0, max: 1800, h: 'Maximal 1.800 €. Mindestens 120 € für Zulagen.' })}
      ${F(b + '.extra', 'Zusätzlich ungefördert', { t: 'eur', u: '€/Jahr', step: 120, min: 0, max: 5040, h: 'Bis 6.840 € insgesamt. Später wird nur der Ertrag besteuert.' })}
      ${F(b + '.cost', 'Kosten des Depots', { t: 'pct', step: 0.05, h: 'Fonds plus Depot. Standarddepot max. 1 %.' })}
      ${S(b + '.teilkapital', 'Einmalauszahlung zu Beginn', [[0, 'Keine'], [0.1, '10 %'], [0.2, '20 %'], [0.3, '30 % (Maximum)']])}
      ${S(b + '.payStart', 'Auszahlung ab Alter', yearOpts(65, 70))}
      ${S(b + '.payEnd', 'Auszahlungsplan bis Alter', yearOpts(85, 100))}
    </div>
    <div class="facts" id="avdfacts-${i}"></div>` : '<p class="note">In Szenario B spart ' + P.name + ' nur ins ETF-Depot.</p>'}
  </div>`;
}
function fundsHtml() {
  const D = ST.I.depot;
  const cols = ['--s1', '--s2', '--s3', '--s4', '--s5'];
  return D.funds.map((f, k) => `<div class="fund">
    <div class="fund-h"><span class="dot" style="background:var(${cols[k]})"></span>Fonds ${k + 1}</div>
    <div class="fields three">
      ${T(`I.depot.funds.${k}.name`, 'Name')}
      ${S(`I.depot.funds.${k}.type`, 'Art', [['acc', 'Thesaurierend'], ['dist', 'Ausschüttend']], { rr: 1 })}
      ${F(`I.depot.funds.${k}.ter`, 'TER', { t: 'pct', step: 0.01 })}
      ${F(`I.depot.funds.${k}.from`, 'Besparen von', { t: 'int' })}
      ${F(`I.depot.funds.${k}.to`, 'bis', { t: 'int' })}
      ${f.type === 'dist' ? F(`I.depot.funds.${k}.divY`, 'Ausschüttung', { t: 'pct', step: 0.1 }) : ''}
    </div></div>`).join('');
}
function legalTable() {
  const rows = [
    ['Einkommensteuer', 'Tarif 2026, Grundfreibetrag 12.348 €', 'G', '§ 32a EStG', 'https://www.gesetze-im-internet.de/estg/__32a.html'],
    ['Einkommensteuer', 'Tarif 2027/2028, Grundfreibetrag 12.564 / 12.900 €', 'E', 'BT-Drs. 21/8235', 'https://dserver.bundestag.de/btd/21/082/2108235.pdf'],
    ['Einkommensteuer', 'ab 2029 mit Inflation fortgeschrieben (Schalter)', 'A', 'Annahme', ''],
    ['Solidaritätszuschlag', 'Freigrenze 40.700 € (Splitting), Milderung 11,9 %', 'G', '§§ 3, 4 SolZG', 'https://www.gesetze-im-internet.de/solzg_1995/__3.html'],
    ['Kinder', 'Kinderfreibetrag 9.756 €, Kindergeld 259 € (2026)', 'G', '§§ 32, 66 EStG', 'https://www.gesetze-im-internet.de/estg/__32.html'],
    ['Rentenbesteuerung', 'Besteuerungsanteil +0,5 Pp. je Jahrgang, 100 % ab 2058', 'G', '§ 22 Nr. 1 EStG', 'https://www.gesetze-im-internet.de/estg/__22.html'],
    ['Kapitalerträge', 'Abgeltungsteuer 26,375 %, Sparerpauschbetrag 2.000 €', 'G', '§§ 20, 32d EStG', 'https://www.gesetze-im-internet.de/estg/__32d.html'],
    ['Investmentsteuer', 'Teilfreistellung 30 %, Vorabpauschale mit Basiszins 3,20 % (2026)', 'G', '§§ 18-20 InvStG', 'https://www.gesetze-im-internet.de/invstg_2018/__18.html'],
    ['Altersvorsorgedepot', 'Grundzulage 50 % bis 360 €, 25 % bis 1.800 € (max. 540 €)', 'G', '§ 84 EStG n. F.', 'https://www.recht.bund.de/bgbl/1/2026/156/VO.html'],
    ['Altersvorsorgedepot', 'Kinderzulage bis 300 €, Mindesteigenbeitrag 120 €', 'G', '§§ 85, 86 EStG n. F.', 'https://www.recht.bund.de/bgbl/1/2026/156/VO.html'],
    ['Altersvorsorgedepot', 'Sonderausgabenabzug 1.800 € + Zulage mit Günstigerprüfung', 'G', '§ 10a EStG n. F.', 'https://www.recht.bund.de/bgbl/1/2026/156/VO.html'],
    ['Altersvorsorgedepot', 'Selbständige förderberechtigt (unter 67)', 'G', '§ 10a Abs. 1 S. 5 EStG n. F.', 'https://www.recht.bund.de/bgbl/1/2026/156/VO.html'],
    ['Altersvorsorgedepot', 'Auszahlung ab 65 bis 70, Plan bis mind. 85, bis 30 % Einmalbetrag', 'G', '§ 1 AltZertG n. F.', 'https://www.recht.bund.de/bgbl/1/2026/156/VO.html'],
    ['Altersvorsorgedepot', 'Auszahlung voll steuerpflichtig, keine Vorabpauschale beim Sparen', 'G', '§ 22 Nr. 5 EStG', 'https://www.gesetze-im-internet.de/estg/__22.html'],
    ['Altersvorsorgedepot', 'KVdR beitragsfrei, freiwillig Versicherte zahlen Beiträge', 'A', 'Praxis wie Riester, nicht ausdrücklich geregelt', 'https://www.gesetze-im-internet.de/sgb_5/__229.html'],
    ['Rentenversicherung', 'Rentenwert 42,52 € ab 1.7.2026, BBG 101.400 € / 106.200 €', 'G', 'SGB VI, RV-Rechengrößen', 'https://www.deutsche-rentenversicherung.de/'],
    ['Rentenversicherung', 'Haltelinie 48 % bis 2031, danach Dämpfung (Schalter)', 'G', 'Rentenpaket 2025', ''],
    ['Rentenversicherung', 'Regelaltersgrenze 67, Abschlag 0,3 % je Monat', 'G', '§§ 35, 77 SGB VI', 'https://www.gesetze-im-internet.de/sgb_6/__77.html'],
    ['Krankenversicherung', 'BBG 69.750 € (2026) / 76.500 € (2027), Zusatzbeitrag Ø 2,9 %', 'G', 'SGB V, BStabG', ''],
    ['Krankenversicherung', 'KVdR über 9/10-Regel, freiwillige GKV zählt, 3 Jahre je Kind', 'G', '§ 5 Abs. 1 Nr. 11 SGB V', 'https://www.gesetze-im-internet.de/sgb_5/__5.html'],
    ['Krankenversicherung', 'Freiwillige Rentner: 14,0 % + Zusatzbeitrag auf Kapitalerträge, ohne Sparerpauschbetrag', 'G', '§ 240 SGB V, Beitragsverfahrensgrundsätze', ''],
    ['Pflegeversicherung', '3,6 %, Rentner zahlen voll', 'G', '§ 55 SGB XI', ''],
  ];
  const chip = s => s === 'G' ? '<span class="pill good">gilt</span>' : s === 'B' ? '<span class="pill info">beschlossen</span>' : s === 'E' ? '<span class="pill warn">Entwurf</span>' : '<span class="pill info">Annahme</span>';
  return `<div class="tablebox"><table class="legal"><thead><tr><th>Bereich</th><th>Wert im Rechner</th><th>Status</th><th>Grundlage</th></tr></thead><tbody>${rows.map(r => `<tr><td class="txt">${r[0]}</td><td class="txt">${r[1]}</td><td class="txt">${chip(r[2])}</td><td class="txt">${r[4] ? `<a href="${r[4]}" target="_blank" rel="noopener">${r[3]}</a>` : r[3]}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderP1() {
  const I = ST.I;
  const W = I.withdraw;
  $('#p1').innerHTML = `
  <p class="note"><b>Szenario A</b> spart alles ins normale ETF-Depot. <b>Szenario B</b> zahlt zuerst ins Altersvorsorgedepot und den Rest ins ETF-Depot. Beide nutzen dasselbe Budget, dieselbe Rendite und dieselbe Entnahmestrategie.</p>
  <div class="grid">${avdCard(0)}${avdCard(1)}</div>
  <div class="note" id="refund-info"></div>
  <div class="card">
    <div class="card-h"><h2>Beste Einstellung suchen</h2><button class="btn primary" id="btn-opt">Optimierer starten</button></div>
    <p class="muted" style="margin:0">Probiert für beide Personen Eigenbeitrag, Zusatzbeitrag, Auszahlungsbeginn, Laufzeit und Einmalauszahlung durch. Ziel ist das höchste dauerhafte Netto in heutiger Kaufkraft.</p>
    <div class="progress"><div id="opt-bar"></div></div>
    <div id="opt-out"></div>
  </div>
  <div class="grid">
    <div class="card">
      <div class="card-h"><h2>ETF-Depot</h2><button class="btn" id="btn-split">Zeiträume gleichmäßig verteilen</button></div>
      <div class="fields three">
        ${S('I.depot.nFunds', 'Anzahl Sparpläne', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], { rr: 1 })}
        ${S('I.depot.sellMode', 'Verkaufen zuerst aus', [['newestFirst', 'zuletzt bespartem Fonds'], ['inOrder', 'Fonds 1, 2, 3 …']])}
        <div class="f"><label>&nbsp;</label>${C('I.depot.divRedirect', 'Ausschüttungen in aktuellen Sparplan')}</div>
      </div>
      <p class="note">Die Staffelung nutzt FIFO. Wer im Alter zuerst den jüngsten Fonds verkauft, versteuert anfangs wenig Gewinn. Das verschiebt Steuern nach hinten.</p>
      <div id="fund-issues"></div>
      ${fundsHtml()}
    </div>
    <div class="card">
      <div class="card-h"><h2>Entnahme im Ruhestand</h2></div>
      <div class="fields">
        ${S('I.withdraw.strategy', 'Strategie', [['realConst', 'Höchstes gleichbleibendes Netto'], ['fixedNet', 'Wunsch-Netto vorgeben']], { rr: 1 })}
        ${F('I.withdraw.targetAge', 'Geld soll reichen bis Alter', { t: 'int', min: 80, max: 105 })}
        ${S('I.withdraw.refPerson', 'Alter von', I.persons.map((p, i) => [i, p.name]))}
        ${W.strategy === 'fixedNet' ? F('I.withdraw.fixedNet', 'Wunsch-Netto heute', { t: 'eur', u: '€/Monat', step: 100 }) + `<div class="f"><label>&nbsp;</label>${C('I.withdraw.fixedIndexed', 'Mit Inflation anpassen')}</div>` : ''}
      </div>
      <p class="note">Netto heißt hier: gesetzliche Renten, Auszahlungen aus dem Altersvorsorgedepot und Verkäufe aus dem ETF-Depot, abzüglich Einkommensteuer, Soli, Kapitalertragsteuer und eigener Kranken- und Pflegeversicherung. Die Entnahme beginnt, wenn beide in Rente sind.</p>
      <h3>Annahmen</h3>
      <div class="fields">
        ${F('A.ret', 'Rendite Aktien pro Jahr', { t: 'pct', h: 'Vor Fondskosten. Gilt als typischer Verlauf (Median).' })}
        ${F('A.inflation', 'Inflation', { t: 'pct' })}
        ${F('A.wageGrowth', 'Lohnwachstum', { t: 'pct', h: 'Treibt Rentenwert, BBG und Durchschnittsentgelt' })}
        ${F('A.rentenDaempfung', 'Rentendämpfung ab 2032', { t: 'pct', step: 0.05, h: 'Rentenanpassung = Lohnwachstum minus Dämpfung' })}
        ${F('A.basiszins', 'Basiszins ab 2027', { t: 'pct', step: 0.05 })}
        ${F('A.zusatz', 'KV-Zusatzbeitrag 2026', { t: 'pct', step: 0.05 })}
        ${F('A.zusatzDrift', 'Zusatzbeitrag steigt pro Jahr um', { t: 'pct', step: 0.01, u: 'Pp.' })}
        ${F('A.pvDrift', 'Pflegebeitrag steigt pro Jahr um', { t: 'pct', step: 0.01, u: 'Pp.' })}
        ${F('A.vol', 'Schwankung (Monte Carlo)', { t: 'pct', step: 0.5 })}
        ${F('A.inflVol', 'Schwankung Inflation', { t: 'pct', step: 0.1 })}
      </div>
      <div class="fields">
        ${C('A.indexTariff', 'Steuertarif mit Inflation fortschreiben')}
        ${C('A.useDraft', 'Tarifentwurf 2027/28 anwenden')}
        ${C('A.guenstiger', 'Günstigerprüfung für Kapitalerträge')}
        ${C('A.kvTeilfreistellung', 'KV auf Fondserträge nach Teilfreistellung')}
      </div>
    </div>
  </div>
  <details class="card"><summary>Rechtsstand und Quellen</summary>${legalTable()}
    <p class="note">Offen sind vor allem die Krankenversicherung auf Auszahlungen des Altersvorsorgedepots bei freiwillig Versicherten, der Tarif ab 2029 und der Zusatzbeitrag bis 2080. Das Gesetz zum Altersvorsorgedepot ist verkündet (BGBl. 2026 I Nr. 156), ein Produkt war im Oktober 2026 noch nicht zertifiziert.</p>
  </details>`;
  $('#btn-split').onclick = () => { autoSplit(); renderPanels(); scheduleRecalc(); save(); };
  $('#btn-opt').onclick = runOptimizer;
}
function syncFunds() {
  const D = ST.I.depot;
  const tpl = DEFAULTS.depot.funds;
  while (D.funds.length < D.nFunds) { const k = D.funds.length; D.funds.push({ ...(tpl[k] || { name: 'Fonds ' + (k + 1), type: 'acc', tf: 0.3, ter: 0.002, divY: 0 }), name: tpl[k]?.name || 'Fonds ' + (k + 1) }); }
  if (D.funds.length > D.nFunds) D.funds.length = D.nFunds;
}
// Prüft Sparzeiträume: Überschneidungen, nie besparte Fonds, Lücken
function fundIssues(I) {
  const F = I.depot.funds, out = [];
  const end = Math.floor((I.saveUntil === 'last' ? Math.max(...I.persons.map(retireStartAbs)) : Math.min(...I.persons.map(retireStartAbs))) / 12);
  F.forEach((f, k) => { if (!(f.from <= f.to)) out.push(`Fonds ${k + 1}: Beginn liegt nach dem Ende.`); });
  const who = [];
  for (let y = I.startYear; y <= end; y++) {
    const inY = F.map((f, k) => (y >= f.from && y <= f.to) ? k : -1).filter(k => k >= 0);
    who.push({ y, inY });
  }
  const ranges = (pred) => { const r = []; let s = null; who.forEach((w, i) => { if (pred(w)) { if (s == null) s = w.y; } else if (s != null) { r.push([s, who[i - 1].y]); s = null; } }); if (s != null) r.push([s, who[who.length - 1].y]); return r; };
  const fmt = ([a, b]) => a === b ? String(a) : `${a}–${b}`;
  for (let k = 0; k < F.length; k++) for (let j = k + 1; j < F.length; j++) {
    const ov = ranges(w => w.inY.includes(k) && w.inY.includes(j));
    if (ov.length) out.push(`Fonds ${k + 1} und ${j + 1} überschneiden sich (${ov.map(fmt).join(', ')}). In dieser Zeit wird nur Fonds ${Math.max(...who.find(w => w.y === ov[0][0]).inY) + 1} bespart.`);
  }
  F.forEach((f, k) => { if (f.from <= f.to && !who.some(w => w.inY.length && Math.max(...w.inY) === k)) out.push(`Fonds ${k + 1} wird nie bespart.`); });
  const gaps = ranges(w => w.inY.length === 0);
  if (gaps.length) out.push(`Kein Sparplan in ${gaps.map(fmt).join(', ')}. Dort wird der zuletzt besparte Fonds weiter bespart.`);
  return out;
}
function autoSplit() {
  const I = ST.I, D = I.depot;
  syncFunds();
  const end = Math.floor(Math.min(...I.persons.map(retireStartAbs)) / 12);
  const span = end - I.startYear + 1, n = D.funds.length;
  D.funds.forEach((f, k) => { f.from = I.startYear + Math.round(span * k / n); f.to = k === n - 1 ? end : I.startYear + Math.round(span * (k + 1) / n) - 1; });
}
function runOptimizer() {
  const b = $('#btn-opt'); b.disabled = true;
  const base = R.netB;
  optimize(ST.I, ST.A, (p, n) => { $('#opt-bar').style.width = (p * 100).toFixed(0) + '%'; $('#opt-out').innerHTML = `<p class="muted">Bisher bestes Netto: <b class="num">${eur(n)}</b>/Monat</p>`; },
    (best, n) => {
      b.disabled = false;
      const lab = { eigen: 'Geförderter Eigenbeitrag', extra: 'Ungeförderter Zusatzbeitrag', payStart: 'Auszahlung ab', payEnd: 'Plan bis', teilkapital: 'Einmalauszahlung', on: 'Genutzt' };
      const fmt = (k, v) => k === 'eigen' || k === 'extra' ? eur(v) + '/Jahr' : k === 'teilkapital' ? pc(v, 0) : k === 'on' ? (v ? 'ja' : 'nein') : v + ' Jahre';
      const rows = [];
      best.persons.forEach((p, i) => Object.keys(lab).forEach(k => { const o = ST.I.persons[i].avd[k], v = p.avd[k]; rows.push(`<tr><td>${p.name}</td><td class="txt">${lab[k]}</td><td>${fmt(k, o)}</td><td>${o !== v ? `<b>${fmt(k, v)}</b>` : fmt(k, v)}</td></tr>`); }));
      $('#opt-out').innerHTML = `<p>Bestes Netto: <b class="num">${eur(n)}</b>/Monat, das sind <b class="num">${(n - base >= 0 ? '+' : '') + eur(n - base)}</b> gegenüber deiner Einstellung.</p>
        <div class="tablebox"><table><thead><tr><th>Person</th><th>Stellschraube</th><th>Jetzt</th><th>Optimum</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
        <div class="row" style="margin-top:8px"><button class="btn primary" id="btn-opt-apply">Optimum übernehmen</button></div>`;
      $('#btn-opt-apply').onclick = () => { best.persons.forEach((p, i) => ST.I.persons[i].avd = p.avd); save(); renderPanels(); recalc(); };
    });
}

// ═══ Reiter 3: Entwicklung ═══
function renderP2() {
  const names = ST.I.persons.map(p => p.name);
  $('#p2').innerHTML = `
  <div class="row">
    <span class="muted">Details für</span>
    <div class="seg" id="seg-scen"><button data-v="A" aria-pressed="${chartScen === 'A'}">A · nur ETF</button><button data-v="B" aria-pressed="${chartScen === 'B'}">B · mit Altersvorsorgedepot</button></div>
    <div class="seg" id="seg-person"><button data-v="-1" aria-pressed="${chartPerson === -1}">Haushalt</button>${names.map((n, i) => `<button data-v="${i}" aria-pressed="${chartPerson === i}">${n}</button>`).join('')}</div>
    <span class="spacer"></span>
    <div class="seg" id="seg-real"><button data-v="1" aria-pressed="${chartReal}">Heutige Kaufkraft</button><button data-v="0" aria-pressed="${!chartReal}">Nominal</button></div>
  </div>
  <div class="card">
    <div class="card-h"><h2>Wer bringt was in den Ruhestand</h2><span class="muted" id="who-sub"></span></div>
    <div class="tablebox" id="who"></div>
    <p class="muted" style="margin:0;font-size:12px">Die Einkommensteuer wird bei Zusammenveranlagung gemeinsam festgesetzt. Hier wird sie nach dem Anteil am steuerpflichtigen Einkommen verteilt. Das gemeinsame ETF-Depot, die Kapitalertragsteuer und der Kredit zählen je zur Hälfte.</p>
  </div>
  <div class="card"><div class="card-h"><h2>Vermögen</h2><span class="muted" id="wealth-sub"></span></div><div class="chart" id="ch-wealth" role="img" aria-label="Vermögensverlauf"></div></div>
  <div class="card"><div class="card-h"><h2>Kapital je ETF-Sparplan</h2><span class="muted" id="funds-sub"></span></div><div class="chart" id="ch-funds" role="img" aria-label="Kapital je ETF-Sparplan"></div></div>
  <div class="card"><div class="card-h"><h2>Altersvorsorgedepot</h2><span class="muted" id="avd-sub"></span></div><div class="chart" id="ch-avd" role="img" aria-label="Kapital und Auszahlungen im Altersvorsorgedepot"></div></div>
  <div class="grid">
    <div class="card"><h2>Sparen pro Jahr</h2><div class="chart sm" id="ch-save" role="img" aria-label="Sparbeiträge pro Jahr"></div></div>
    <div class="card"><h2>Einkommen im Ruhestand pro Monat</h2><div class="chart sm" id="ch-income" role="img" aria-label="Einkommen im Ruhestand"></div></div>
  </div>
  <div class="grid">
    <div class="card"><h2>Steuern und Beiträge im Ruhestand pro Monat</h2><div class="chart sm" id="ch-deduct" role="img" aria-label="Abzüge im Ruhestand"></div></div>
    <div class="card"><h2>Abzüge im Vergleich A und B</h2><div class="chart sm" id="ch-compare" role="img" aria-label="Abzüge A gegen B"></div></div>
  </div>
  <div class="card">
    <div class="card-h"><h2>Monte Carlo: Wie sicher ist das Netto?</h2>
      <div class="row">${S('A.mcRuns', 'Läufe', [[100, '100'], [200, '200'], [500, '500']])}<button class="btn primary" id="btn-mc" style="align-self:flex-end">Simulation starten</button></div></div>
    <p class="muted" style="margin:0">Zufällige Renditen und Inflation je Jahr. Für jeden Verlauf wird das höchste Netto bestimmt, das bis zum Zielalter reicht. Beide Szenarien laufen auf denselben Verläufen. Die Werte gelten für den ganzen Haushalt.</p>
    <div class="progress"><div id="mc-bar"></div></div>
    <div id="mc-out"></div>
    <div class="grid"><div class="chart sm" id="ch-mc-dist" role="img" aria-label="Verteilung des Nettos"></div><div class="chart sm" id="ch-mc-fan" role="img" aria-label="Bandbreite des Vermögens"></div></div>
  </div>
  <details class="card" id="tbl-box"><summary>Jahrestabelle</summary><div class="tablebox" id="tbl"></div></details>`;
  const seg = (id, fn) => $$(`#${id} button`).forEach(b => b.onclick = () => { fn(b.dataset.v); $$(`#${id} button`).forEach(x => x.setAttribute('aria-pressed', x === b)); renderCharts(); });
  seg('seg-scen', v => chartScen = v);
  seg('seg-person', v => chartPerson = +v);
  seg('seg-real', v => chartReal = v === '1');
  $('#btn-mc').onclick = runMC;
}

// Werte je Zeile für Haushalt oder eine Person
const sum = a => a.reduce((x, y) => x + y, 0);
function V(r, k, who = chartPerson) {
  if (who >= 0) return r.pp[who][k];
  switch (k) {
    case 'avd': return sum(r.avd);
    case 'avdIn': return sum(r.avdIn);
    case 'zul': return r.zulagen;
    case 'grv': return sum(r.grv);
    case 'avdPay': return sum(r.avdPay);
    case 'est': return r.est + r.soli;
    default: return r[k];
  }
}

const charts = {};
function chartOf(id) {
  const el = document.getElementById(id); if (!el) return null;
  if (charts[id] && charts[id].getDom() !== el) { charts[id].dispose(); delete charts[id]; }
  if (!charts[id]) charts[id] = echarts.init(el, null, { renderer: 'canvas' });
  return charts[id];
}
function baseOpt(extra = {}) {
  const ink2 = cssv('--ink-2'), ink3 = cssv('--ink-3'), line = cssv('--line'), surf = cssv('--surface');
  return {
    backgroundColor: 'transparent', animationDuration: 300,
    textStyle: { fontFamily: 'Public Sans, system-ui, sans-serif', color: ink2 },
    grid: { left: 8, right: 16, top: window.innerWidth < 600 ? 68 : 44, bottom: 8, containLabel: true },
    legend: { top: 0, left: 0, textStyle: { color: ink2, fontSize: 12 }, itemWidth: 12, itemHeight: 8, icon: 'roundRect' },
    tooltip: { trigger: 'axis', backgroundColor: surf, borderColor: line, textStyle: { color: cssv('--ink'), fontSize: 12 }, valueFormatter: v => v == null ? '–' : eur(v) },
    xAxis: { type: 'category', axisLine: { lineStyle: { color: line } }, axisTick: { show: false }, axisLabel: { color: ink3 } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: line, type: [3, 3] } }, axisLabel: { color: ink3, formatter: v => Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' Mio.' : Math.abs(v) >= 1e3 ? (v / 1e3).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' Tsd.' : nf0.format(v) } },
    ...extra,
  };
}
function renderWho(sim) {
  const ws = sim.wStartYear;
  const r = sim.rows.find(x => x.year === ws), rb = sim.rows.find(x => x.year === ws - 1);
  if (!r) { $('#who').innerHTML = ''; return; }
  const P = ST.I.persons, n = P.length;
  const dv = (row, v) => chartReal ? v / row.priceIdx : v;
  const m = v => eur(dv(r, v) / 12);
  const save = sim.rows.filter(x => x.phase === 'Ansparen');
  const tot = (k, who) => sum(save.map(x => V(x, k, who)));
  const cols = [...P.map((p, i) => i), -1];
  const lines = [
    ['Nettovermögen bei Entnahmestart', who => keur(dv(rb, V(rb, 'netWorth', who))), 'sub'],
    ['davon ETF-Depot', who => keur(dv(rb, V(rb, 'etf', who))), ''],
    ...(chartScen === 'B' ? [['davon Altersvorsorgedepot', who => keur(dv(rb, V(rb, 'avd', who))), '']] : []),
    ...(chartScen === 'B' ? [['Eigene Beiträge Altersvorsorgedepot', who => keur(tot('avdIn', who)), 'n'], ['Zulagen', who => keur(tot('zul', who)), 'n'], ['Steuererstattung § 10a', who => keur(tot('refund', who)), 'n']] : []),
    ['Gesetzliche Rente', who => m(V(r, 'grv', who)), 'sub'],
    ...(chartScen === 'B' ? [['Altersvorsorgedepot', who => m(V(r, 'avdPay', who)), '']] : []),
    ['ETF-Verkauf', who => m(V(r, 'etfSale', who)), ''],
    ['Einkommensteuer + Soli', who => '−' + m(V(r, 'est', who)), ''],
    ['Kapitalertragsteuer', who => '−' + m(V(r, 'kapTax', who)), ''],
    ['Kranken- und Pflegeversicherung', who => '−' + m(V(r, 'kv', who)), ''],
    ['Netto pro Monat', who => '<b>' + m(V(r, 'net', who)) + '</b>', 'sub'],
  ];
  $('#who-sub').textContent = `Szenario ${chartScen} · erstes Entnahmejahr ${ws} · ${chartReal ? 'heutige Kaufkraft' : 'nominal'} · Summen der Sparphase nominal`;
  $('#who').innerHTML = `<table><thead><tr><th></th>${cols.map(c => `<th>${c < 0 ? 'Haushalt' : P[c].name}</th>`).join('')}</tr></thead><tbody>${lines.map(([l, f, cls]) => `<tr${cls === 'sub' ? ' style="border-top:2px solid var(--line-2)"' : ''}><td class="txt">${l}</td>${cols.map(c => `<td>${f(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function renderCharts() {
  if (!R) return;
  const sim = chartScen === 'A' ? R.simA : R.simB, other = chartScen === 'A' ? R.simB : R.simA;
  const dv = (r, v) => chartReal ? v / r.priceIdx : v;
  const C1 = cssv('--s1'), C2 = cssv('--s2'), C3 = cssv('--s3'), C4 = cssv('--s4'), C5 = cssv('--s5'), C7 = cssv('--s7'), CA = cssv('--sA'), ink = cssv('--ink'), surf = cssv('--surface');
  const years = sim.rows.map(r => r.year);
  const bar = (name, data, color, stack = 's') => ({ name, type: 'bar', stack, data, itemStyle: { color, borderColor: surf, borderWidth: 1, borderRadius: 0 }, barMaxWidth: 18, emphasis: { focus: 'series' } });
  const ws = sim.wStartYear;
  const who = chartPerson >= 0 ? ST.I.persons[chartPerson].name : 'Haushalt';
  $('#wealth-sub').textContent = `${who} · Entnahme ab ${ws} · ${chartReal ? 'in heutiger Kaufkraft' : 'nominal'}`;
  renderWho(sim);

  // Vermögen
  chartOf('ch-wealth').setOption(baseOpt({
    xAxis: { ...baseOpt().xAxis, data: years },
    series: [
      { name: chartPerson >= 0 ? 'ETF-Depot (Hälfte)' : 'ETF-Depot', type: 'line', stack: 'w', symbol: 'none', data: sim.rows.map(r => dv(r, V(r, 'etf'))), lineStyle: { width: 2, color: C3 }, itemStyle: { color: C3 }, areaStyle: { color: C3, opacity: 0.22 } },
      ...(chartScen === 'B' ? [{ name: 'Altersvorsorgedepot', type: 'line', stack: 'w', symbol: 'none', data: sim.rows.map(r => dv(r, V(r, 'avd'))), lineStyle: { width: 2, color: C2 }, itemStyle: { color: C2 }, areaStyle: { color: C2, opacity: 0.22 } }] : []),
      { name: 'Restschuld Haus', type: 'line', stack: 'd', symbol: 'none', data: sim.rows.map(r => -dv(r, V(r, 'debt'))), lineStyle: { width: 2, color: C7 }, itemStyle: { color: C7 }, areaStyle: { color: C7, opacity: 0.18 } },
      { name: 'Nettovermögen', type: 'line', symbol: 'none', data: sim.rows.map(r => dv(r, V(r, 'netWorth'))), lineStyle: { width: 2, color: ink }, itemStyle: { color: ink } },
      { name: chartScen === 'A' ? 'Netto in B' : 'Netto in A', type: 'line', symbol: 'none', data: other.rows.map(r => dv(r, V(r, 'netWorth'))), lineStyle: { width: 2, type: [6, 4], color: chartScen === 'A' ? C2 : CA }, itemStyle: { color: chartScen === 'A' ? C2 : CA },
        markLine: { symbol: 'none', silent: true, data: [{ xAxis: String(ws) }], lineStyle: { color: cssv('--ink-3'), type: [2, 3] }, label: { formatter: 'Entnahme', color: cssv('--ink-2'), position: 'end' } } },
    ],
  }), true);

  // Kapital je ETF-Sparplan
  const FC = ['--s1', '--s2', '--s3', '--s4', '--s5'].map(cssv);
  const share = chartPerson >= 0 ? 1 / ST.I.persons.length : 1;
  const fundsCfg = ST.I.depot.funds;
  $('#funds-sub').textContent = `${who} · ${chartPerson >= 0 ? 'Hälfte des gemeinsamen Depots · ' : ''}${chartReal ? 'in heutiger Kaufkraft' : 'nominal'}`;
  chartOf('ch-funds').setOption(baseOpt({
    xAxis: { ...baseOpt().xAxis, data: years },
    tooltip: { ...baseOpt().tooltip, formatter: ps => {
      const vis = ps.filter(p => p.seriesIndex < fundsCfg.length && p.value > 0.5);
      const tot = vis.reduce((a, p) => a + p.value, 0);
      return `<b>${ps[0].axisValue}</b><br>` + (vis.length ? vis.map(p => `${p.marker} ${p.seriesName}: <b>${eur(p.value)}</b>`).join('<br>') + `<br>Summe: <b>${eur(tot)}</b>` : 'Depot leer');
    } },
    series: [...fundsCfg.map((f, k) => ({
      name: f.name, type: 'line', stack: 'f', symbol: 'none', data: sim.rows.map(r => dv(r, (r.funds[k] || 0) * share)),
      lineStyle: { width: 0 }, itemStyle: { color: FC[k] }, areaStyle: { color: FC[k], opacity: 0.55 },
      ...(k === 0 ? { markLine: { symbol: 'none', silent: true, data: [{ xAxis: String(ws) }], lineStyle: { color: cssv('--ink-3'), type: [2, 3] }, label: { formatter: 'Entnahme', color: cssv('--ink-2'), position: 'end' } } } : {}),
    })), { name: 'Summe', type: 'line', symbol: 'none', data: sim.rows.map(r => dv(r, sum(r.funds) * share)), lineStyle: { width: 1.5, color: ink }, itemStyle: { color: ink } }],
  }), true);

  // Altersvorsorgedepot: Kapital je Person (Flächen) und Auszahlungen pro Monat (Linien)
  {
    const P = ST.I.persons, PC = [cssv('--s1'), cssv('--s2')];
    const avdSim = R.simB;   // das Depot gibt es nur in Szenario B
    const idx = chartPerson >= 0 ? [chartPerson] : P.map((_, i) => i);
    $('#avd-sub').textContent = `Szenario B · ${chartPerson >= 0 ? P[chartPerson].name : 'Haushalt'} · ${chartReal ? 'in heutiger Kaufkraft' : 'nominal'}`;
    const starts = idx.map(i => avdSim.rows.find(x => x.avdPay[i] > 0)?.year).filter(Boolean);
    const ends = idx.map(i => { const rr = avdSim.rows.filter(x => x.avdPay[i] > 0); return rr.length ? rr[rr.length - 1].year : null; }).filter(Boolean);
    let cum = 0;
    const paidIn = avdSim.rows.map(r => { cum += dv(r, idx.reduce((a, i) => a + r.pp[i].avdIn + r.pp[i].zul, 0)); return cum; });   // jede Einzahlung in der Kaufkraft ihres Jahres
    chartOf('ch-avd').setOption(baseOpt({
      xAxis: { ...baseOpt().xAxis, data: avdSim.rows.map(r => r.year) },
      series: [
        ...idx.map((i, n) => ({ name: P[i].name, type: 'line', stack: 'a', symbol: 'none', data: avdSim.rows.map(r => dv(r, r.avd[i])),
          lineStyle: { width: 0 }, itemStyle: { color: PC[i] }, areaStyle: { color: PC[i], opacity: 0.45 },
          ...(n === 0 && starts.length ? { markArea: { silent: true, itemStyle: { color: cssv('--surface-2'), opacity: 0.6 }, label: { color: cssv('--ink-2'), position: 'insideTop' },
            data: [[{ name: 'Auszahlungsphase', xAxis: String(Math.min(...starts)) }, { xAxis: String(Math.max(...ends)) }]] } } : {}) })),
        { name: 'Eingezahlt inkl. Zulagen', type: 'line', symbol: 'none', data: paidIn, lineStyle: { width: 1.5, type: [6, 3], color: cssv('--ink-2') }, itemStyle: { color: cssv('--ink-2') } },
      ],
    }), true);
  }

  // Sparen
  const sr = sim.rows.filter(r => r.phase === 'Ansparen');
  chartOf('ch-save').setOption(baseOpt({
    xAxis: { ...baseOpt().xAxis, data: sr.map(r => r.year) },
    series: [
      bar('Kreditrate', sr.map(r => dv(r, Math.min(V(r, 'loanPay') - V(r, 'loanSonder'), V(r, 'budget')))), CA),
      bar('Sondertilgung', sr.map(r => dv(r, V(r, 'loanSonder'))), C7),
      bar('ETF-Sparrate', sr.map(r => dv(r, V(r, 'etfContrib'))), C3),
      ...(chartScen === 'B' ? [bar('Altersvorsorgedepot', sr.map(r => dv(r, V(r, 'avdIn'))), C2), bar('Zulagen', sr.map(r => dv(r, V(r, 'zul'))), C4)] : []),
    ],
  }), true);

  // Einkommen
  const er = sim.rows.filter(r => r.phase === 'Entnahme');
  const m = (r, v) => dv(r, v) / 12;
  chartOf('ch-income').setOption(baseOpt({
    xAxis: { ...baseOpt().xAxis, data: er.map(r => r.year) },
    series: [
      bar('Gesetzliche Rente', er.map(r => m(r, V(r, 'grv'))), C1),
      ...(chartScen === 'B' ? [bar('Altersvorsorgedepot', er.map(r => m(r, V(r, 'avdPay'))), C2)] : []),
      bar(chartPerson >= 0 ? 'ETF-Verkauf (Hälfte)' : 'ETF-Verkauf', er.map(r => m(r, V(r, 'etfSale'))), C3),
      { name: 'Netto', type: 'line', symbol: 'circle', symbolSize: 4, data: er.map(r => m(r, V(r, 'net'))), lineStyle: { width: 2, color: ink }, itemStyle: { color: ink } },
    ],
  }), true);

  // Abzüge
  chartOf('ch-deduct').setOption(baseOpt({
    xAxis: { ...baseOpt().xAxis, data: er.map(r => r.year) },
    series: [
      bar('Einkommensteuer + Soli', er.map(r => m(r, V(r, 'est'))), C4),
      bar('Kapitalertragsteuer', er.map(r => m(r, V(r, 'kapTax'))), C5),
      bar('Kranken- und Pflegeversicherung', er.map(r => m(r, V(r, 'kv'))), C7),
    ],
  }), true);

  // Vergleich
  const ab = s => s.rows.filter(r => r.phase === 'Entnahme').map(r => m(r, V(r, 'est') + V(r, 'kapTax') + V(r, 'kv')));
  chartOf('ch-compare').setOption(baseOpt({
    xAxis: { ...baseOpt().xAxis, data: R.simA.rows.filter(r => r.phase === 'Entnahme').map(r => r.year) },
    series: [
      { name: 'A · nur ETF', type: 'line', symbol: 'none', data: ab(R.simA), lineStyle: { width: 2, color: CA }, itemStyle: { color: CA } },
      { name: 'B · mit Altersvorsorgedepot', type: 'line', symbol: 'none', data: ab(R.simB), lineStyle: { width: 2, color: C2 }, itemStyle: { color: C2 } },
    ],
  }), true);

  renderTable(sim);
  if (MC) renderMC();
}

function renderTable(sim) {
  const dv = (r, v) => chartReal ? v / r.priceIdx : v;
  const e = (r, k) => eur(dv(r, V(r, k)));
  const cols = [
    ['Jahr', r => r.year], ['Phase', r => r.phase], ['Alter', r => chartPerson >= 0 ? r.ages[chartPerson] : r.ages.join(' / ')],
    ['ETF-Sparrate', r => e(r, 'etfContrib')], ['AVD-Beitrag', r => e(r, 'avdIn')], ['Zulagen', r => e(r, 'zul')], ['Erstattung', r => e(r, 'refund')],
    ['Rente', r => e(r, 'grv')], ['AVD-Auszahlung', r => e(r, 'avdPay')], ['ETF-Verkauf', r => e(r, 'etfSale')],
    ['ESt + Soli', r => e(r, 'est')], ['Kapitalertragst.', r => e(r, 'kapTax')], ['KV/PV Rente', r => e(r, 'kv')],
    ['Netto/Monat', r => r.net ? eur(dv(r, V(r, 'net')) / 12) : '–'], ['ETF-Depot', r => e(r, 'etf')], ['AVD', r => e(r, 'avd')],
    ['Kredit/Jahr', r => e(r, 'loanPay')], ['Restschuld', r => e(r, 'debt')], ['Nettovermögen', r => e(r, 'netWorth')],
  ];
  $('#tbl').innerHTML = `<table><thead><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${sim.rows.map(r => `<tr class="ph-${r.phase}">${cols.map(c => `<td>${c[1](r)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function runMC() {
  const b = $('#btn-mc'); b.disabled = true; MC = null;
  monteCarlo(ST.I, ST.A, { runs: ST.A.mcRuns || 200, seed: 7 }, p => { $('#mc-bar').style.width = (p * 100).toFixed(0) + '%'; }, r => { b.disabled = false; MC = r; renderMC(); });
}
function renderMC() {
  const r = MC, qs = [0.1, 0.25, 0.5, 0.75, 0.9];
  const CA = cssv('--sA'), C2 = cssv('--s2'), surf = cssv('--surface');
  const pA = qs.map(q => pct(r.res.A, q)), pB = qs.map(q => pct(r.res.B, q));
  const winB = r.res.B.filter((v, k) => v > r.res.A[k]).length / r.runs;
  $('#mc-out').innerHTML = `<p>In 9 von 10 Verläufen reicht ein Netto von mindestens <b class="num">${eur(pA[0])}</b> (A) beziehungsweise <b class="num">${eur(pB[0])}</b> (B) pro Monat. Der typische Verlauf (Median) trägt <b class="num">${eur(pA[2])}</b> (A) und <b class="num">${eur(pB[2])}</b> (B). B liegt in <b class="num">${pc(winB, 0)}</b> der Verläufe vorn. Das Netto aus der festen Rechnung (${eur(r.det.B)} in B) wäre in ${pc(r.fail.B / r.runs, 0)} der Verläufe nicht durchzuhalten.</p>`;
  chartOf('ch-mc-dist').setOption(baseOpt({
    title: { text: 'Tragbares Netto pro Monat', textStyle: { fontSize: 12, color: cssv('--ink-2'), fontWeight: 600 }, right: 0, top: 0 },
    xAxis: { ...baseOpt().xAxis, data: ['10 %', '25 %', 'Median', '75 %', '90 %'] },
    series: [
      { name: 'A · nur ETF', type: 'bar', data: pA, itemStyle: { color: CA, borderRadius: [4, 4, 0, 0], borderColor: surf, borderWidth: 1 }, barMaxWidth: 26 },
      { name: 'B · mit AVD', type: 'bar', data: pB, itemStyle: { color: C2, borderRadius: [4, 4, 0, 0], borderColor: surf, borderWidth: 1 }, barMaxWidth: 26 },
    ],
  }), true);
  const fan = r.fan[chartScen];
  const n = fan[0].length;
  const band = q => Array.from({ length: n }, (_, t) => pct(fan.map(f => f[t]), q));
  const p10 = band(0.1), p25 = band(0.25), p50 = band(0.5), p75 = band(0.75), p90 = band(0.9);
  const col = chartScen === 'A' ? CA : C2;
  chartOf('ch-mc-fan').setOption(baseOpt({
    title: { text: 'Vermögen beim festen Netto, heutige Kaufkraft', textStyle: { fontSize: 12, color: cssv('--ink-2'), fontWeight: 600 }, right: 0, top: 0 },
    legend: { show: false },
    tooltip: { ...baseOpt().tooltip, formatter: ps => { const i = ps[0].dataIndex; return `<b>${r.years[i]}</b><br>90 %: ${eur(p90[i])}<br>75 %: ${eur(p75[i])}<br>Median: ${eur(p50[i])}<br>25 %: ${eur(p25[i])}<br>10 %: ${eur(p10[i])}`; } },
    xAxis: { ...baseOpt().xAxis, data: r.years },
    series: [
      { name: 'b', type: 'line', stack: 'f', symbol: 'none', data: p10, lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 } },
      { name: '10–25', type: 'line', stack: 'f', symbol: 'none', data: p25.map((v, i) => v - p10[i]), lineStyle: { opacity: 0 }, areaStyle: { color: col, opacity: 0.15 } },
      { name: '25–75', type: 'line', stack: 'f', symbol: 'none', data: p75.map((v, i) => v - p25[i]), lineStyle: { opacity: 0 }, areaStyle: { color: col, opacity: 0.32 } },
      { name: '75–90', type: 'line', stack: 'f', symbol: 'none', data: p90.map((v, i) => v - p75[i]), lineStyle: { opacity: 0 }, areaStyle: { color: col, opacity: 0.15 } },
      { name: 'Median', type: 'line', symbol: 'none', data: p50, lineStyle: { width: 2, color: col } },
    ],
  }), true);
}

// ─── Rahmen ───
function renderPanels() {
  syncFunds();
  renderP0(); renderP1(); renderP2();
  if (R) { renderKPIs(); renderFacts(); if (tab === 2) renderCharts(); }
}
$$('.tab').forEach(b => b.onclick = () => {
  tab = +b.dataset.tab;
  $$('.tab').forEach(x => x.setAttribute('aria-selected', x === b));
  $$('[data-panel]').forEach(p => p.hidden = +p.dataset.panel !== tab);
  try { localStorage.setItem(STORE_KEY + '-tab', tab); } catch (e) { }
  if (tab === 2) requestAnimationFrame(() => { renderCharts(); Object.values(charts).forEach(c => c.resize()); });
});
window.addEventListener('resize', () => Object.values(charts).forEach(c => c.resize()));
const reTheme = () => { if (tab === 2 && R) renderCharts(); };
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', reTheme);
new MutationObserver(reTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// Sichern / Laden
$('#btn-io').onclick = () => { $('#io').hidden = false; $('#io-text').value = JSON.stringify(ST, null, 1); $('#io-msg').textContent = ''; };
$('#io-close').onclick = () => { $('#io').hidden = true; };
$('#io-copy').onclick = async () => { const t = $('#io-text'); try { await navigator.clipboard.writeText(t.value); $('#io-msg').textContent = 'Kopiert.'; } catch (e) { t.select(); $('#io-msg').textContent = 'Text ist markiert. Mit Strg+C oder Cmd+C kopieren.'; } };
$('#io-load').onclick = () => {
  try { const p = JSON.parse($('#io-text').value); ST = { I: deepMerge(clone(DEFAULTS), p.I), A: deepMerge(clone(ASSUME), p.A) }; save(); renderPanels(); recalc(); $('#io-msg').textContent = 'Übernommen.'; }
  catch (e) { $('#io-msg').textContent = 'Der Text ist kein gültiger Export. Bitte den ganzen Text einfügen.'; }
};
let resetArm = null;
$('#btn-reset').onclick = () => {
  const b = $('#btn-reset');
  if (!resetArm) { b.textContent = 'Wirklich zurücksetzen?'; resetArm = setTimeout(() => { resetArm = null; b.textContent = 'Standardwerte'; }, 3000); return; }
  clearTimeout(resetArm); resetArm = null; b.textContent = 'Standardwerte';
  ST = { I: clone(DEFAULTS), A: clone(ASSUME) }; save(); renderPanels(); recalc();
};

// Start
if (ST.A.mcRuns == null) ST.A.mcRuns = 200;
renderPanels();
recalc();
try { const t = +localStorage.getItem(STORE_KEY + '-tab'); if (t > 0) $$('.tab')[t].click(); } catch (e) { }
