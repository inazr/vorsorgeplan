// ═══════════════════════════════════════════════════════════════
// OBERFLÄCHE
// ═══════════════════════════════════════════════════════════════
let ST = { I: clone(DEFAULTS), A: clone(ASSUME) };
try { const s = localStorage.getItem(STORE_KEY); if (s) ST = loadState(JSON.parse(s)); } catch (e) { }
// Optionale Migration gespeicherter Eingaben (nur in der privaten Version definiert)
if (typeof MIGRATE === 'function') { try { MIGRATE(ST); } catch (e) { } }
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
  return `<div class="f"><label for="${idOf(path)}">${label}</label><div class="in"><input id="${idOf(path)}" type="text" data-path="${path}" data-t="text" value="${esc(getP(path))}"${o.rr ? ' data-rr="1"' : ''}></div></div>`;
}
function S(path, label, opts, o = {}) {
  const v = getP(path);
  return `<div class="f"><label for="${idOf(path)}">${label}</label><div class="in"><select id="${idOf(path)}" data-path="${path}" data-t="sel"${o.rr ? ' data-rr="1"' : ''}>${opts.map(([val, l]) => `<option value="${JSON.stringify(val).replace(/"/g, '&quot;')}"${val === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>${o.h ? `<div class="h">${o.h}</div>` : ''}</div>`;
}
function C(path, label, o = {}) {
  return `<label class="chk"><input type="checkbox" id="${idOf(path)}" data-path="${path}" data-t="bool"${getP(path) ? ' checked' : ''}${o.rr ? ' data-rr="1"' : ''}>${label}</label>`;
}
const yearOpts = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => [a + i, String(a + i)]);
const monOpts = MON.map((m, i) => [i + 1, m]);

// ─── Zustand und Neuberechnung ───
let R = null, tab = 0, chartScen = 'B', chartReal = true, chartPerson = -1, recalcT = null, MC = null;
// Optimum aus dem letzten Optimierer-Lauf (nur im Speicher): Produkt-Einstellungen je Person und Fingerabdruck der übrigen Eingaben
let OPT = null, OPT_RUN = null;
// Ergebnisse: A = nur ETF-Depot, B = deine Aufteilung, O = Optimum
const SCN = { A: 'Nur ETF-Depot', B: 'Deine Aufteilung', O: 'Optimum' };
const SCN_C = { A: '--sA', B: '--s2', O: '--s1' };
const PROD = { avd: { name: 'Altersvorsorgedepot', short: 'AVD' }, basis: { name: 'Basisrente', short: 'Basisrente' }, prv: { name: 'Private Rentenversicherung', short: 'private RV' } };
const fact = (l, v) => `<div class="fact"><div class="l">${l}</div><div class="v">${v}</div></div>`;
const FUND_C = ['--s1', '--s2', '--s3', '--s4', '--s5'];
const dv = (r, v) => chartReal ? v / r.priceIdx : v;
const realLabel = () => chartReal ? 'in heutiger Kaufkraft' : 'nominal';
const commit = () => { save(); renderPanels(); scheduleRecalc(); };
// Fingerabdruck ohne Produkt-Einstellungen: ändert er sich, ist das Optimum veraltet
function optSig() { const I = clone(ST.I); I.persons.forEach(p => { delete p.avd; delete p.basis; delete p.prv; }); return JSON.stringify([I, ST.A, ST.A.optMode, ST.A.optQ]); }
const simOf = k => R && R['sim' + k];
const prodUsed = (p, k) => p[k]?.on && (k === 'avd' ? p.avd.eigen + p.avd.extra > 0 : p[k].beitrag > 0);
const prodList = I => Object.keys(PROD).filter(k => I.persons.some(p => prodUsed(p, k)));
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
  const out = {};
  if (OPT) out.IO = applyPatch(I, OPT.patch);
  if (I.withdraw.strategy !== 'fixedNet') {
    out.netA = maxNet(I, A, 'A');
    out.netB = maxNet(I, A, 'B', null, out.netA);
    if (OPT) out.netO = maxNet(out.IO, A, 'B', null, out.netB);
  }
  out.simA = simulate(I, A, { scenario: 'A', targetReal: out.netA || 0, detail: true });
  out.simB = simulate(I, A, { scenario: 'B', targetReal: out.netB || 0, detail: true });
  if (OPT) out.simO = simulate(out.IO, A, { scenario: 'B', targetReal: out.netO || 0, detail: true });
  R = out;
  renderKPIs(); renderFacts();
  const ob = $('#seg-scen button[data-v="O"]');
  if (ob) { ob.disabled = !OPT; if (OPT) ob.removeAttribute('title'); }
  if (tab === 2) renderCharts();
}

// ─── Kennzahlen im Kopf ───
function rowAt(sim, y) { return sim.rows.find(r => r.year === y); }
function renderKPIs() {
  const { I } = ST;
  const ws = R.simB.wStartYear;
  const wealth = k => { const r = rowAt(simOf(k), ws - 1); return r ? r.netWorth / r.priceIdx : 0; };
  const stale = OPT && OPT.sig !== optSig();
  const used = prodList(I).map(k => PROD[k].short);
  const optSub = () => {
    if (!OPT) return 'noch nicht berechnet · Optimierer im Reiter Strategie';
    const tag = stale ? '<span class="pill warn">veraltet</span> ' : '';
    const mc = OPT.info.mode === 'mc' ? ` · ${pc(1 - OPT.info.q, 0)} der Verläufe: ${eur(OPT.info.pct)}` : '';
    return tag + optLabel(OPT.patch) + mc;
  };
  let html = '';
  if (I.withdraw.strategy !== 'fixedNet') {
    const perp = I.withdraw.strategy === 'perpetual';
    const sub = perp ? 'Kapital bleibt real erhalten' : 'Netto in heutiger Kaufkraft';
    // Bestes Ergebnis: bei fester Rendite nach Netto, nach einem Monte-Carlo-Lauf nach dem Perzentil
    const mcRun = OPT && OPT.info.mode === 'mc' && !stale;
    const nets = mcRun ? { A: OPT.info.pctA, B: OPT.info.pctB, O: OPT.info.pct } : { A: R.netA, B: R.netB, ...(OPT ? { O: R.netO } : {}) };
    const best = Object.keys(nets).reduce((a, k) => nets[k] > nets[a] + 0.5 ? k : a, 'B');
    const mark = k => k === best ? ' <span class="pill good">bestes</span>' : '';
    const dB = R.netB - R.netA;
    html += kpi(SCN.A + mark('A'), eur(R.netA) + '/Monat', sub, 'sA');
    html += kpi(SCN.B + mark('B'), eur(R.netB) + '/Monat', (used.length ? used.join(' · ') : 'keine Vorsorgeprodukte') + ` · ${dB >= 0 ? '+' : ''}${eur(dB)} gg. ETF`, 's2', true);
    html += OPT ? kpi(SCN.O + mark('O'), eur(R.netO) + '/Monat', `${R.netO - R.netB >= 0 ? '+' : ''}${eur(R.netO - R.netB)} gg. deiner Aufteilung · ` + optSub(), 's1')
      : kpi(SCN.O, '–', optSub(), 's1');
  } else {
    const reach = k => { const s = simOf(k); return s.depletedYear ? 'bis ' + (s.depletedYear - 1) : 'bis Zielalter'; };
    const rsub = k => { const s = simOf(k); return s.depletedYear ? 'danach fehlen Mittel' : 'Endvermögen ' + keur(s.final); };
    html += kpi('Kapital reicht · ' + SCN.A, reach('A'), rsub('A'), 'sA');
    html += kpi('Kapital reicht · ' + SCN.B, reach('B'), rsub('B'), 's2', true);
    html += OPT ? kpi('Kapital reicht · ' + SCN.O, reach('O'), rsub('O') + ' · ' + optSub(), 's1') : kpi(SCN.O, '–', optSub(), 's1');
  }
  html += kpi('Nettovermögen bei Entnahmestart ' + ws, keur(wealth('B')), 'deine Aufteilung · ' + keur(wealth('A')) + ' nur ETF' + (OPT ? ' · ' + keur(wealth('O')) + ' Optimum' : '') + ', heutige Kaufkraft');
  $('#kpis').innerHTML = html;
}
// Kurzbeschreibung einer Produkt-Aufteilung
function optLabel(patch) {
  const parts = Object.keys(PROD).filter(k => patch.some(p => prodUsed(p, k))).map(k => PROD[k].short);
  return parts.length ? parts.join(' · ') : 'nur ETF';
}
function kpi(l, v, d, sw, b) { return `<div class="kpi${b ? ' b' : ''}"><div class="l">${sw ? `<span class="sw" style="background:var(--${sw})"></span>` : ''}${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`; }

// ═══ Reiter 1: Haushalt ═══
function personCard(i) {
  const P = ST.I.persons[i], b = `I.persons.${i}`;
  const job = P.job === 'employee';
  return `<div class="card">
    <div class="card-h"><h2>${esc(P.name)}</h2></div>
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
        ? F(b + '.grvPrognose', 'Prognose laut Renteninfo', { t: 'eur', u: '€/Monat', step: 10 }) + F(b + '.grvRwInfo', 'Rentenwert zum Ausstellungsdatum', { t: 'num', step: 0.01, u: '€', h: Object.keys(SV.rw).sort().map(y => `Ab 1.7.${y}: ${SV.rw[y].toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €.`).join(' ') })
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
    <div class="fund-h"><span style="flex:1">${esc(L.name)}</span><button class="btn" data-loan-del="${k}">Entfernen</button></div>
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
        <div class="fund-h"><span style="flex:1">${esc(c.name)}</span><button class="btn" data-kid-del="${k}">Entfernen</button></div>
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
  $('#btn-kid-add').onclick = () => { ST.I.children.push({ name: 'Kind ' + (ST.I.children.length + 1), by: 2027, bm: 1, kgUntil: 18, zulageTo: 1 }); commit(); };
  $$('[data-kid-del]').forEach(b => b.onclick = () => { ST.I.children.splice(+b.dataset.kidDel, 1); commit(); });
  $('#btn-loan-add').onclick = () => {
    const y = Math.max(ST.I.startYear, 2026);
    ST.I.loans.push({ ...loanTpl(y), name: 'Darlehen ' + (ST.I.loans.length + 1) });
    commit();
  };
  $$('[data-loan-del]').forEach(b => b.onclick = () => { ST.I.loans.splice(+b.dataset.loanDel, 1); commit(); });
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
    ].map(([l, v]) => fact(l, v)).join('')
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
    ].map(([l, v]) => fact(l, v)).join('');
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
    const zk = I.children.filter(c => c.zulageTo === i && nowY - c.by <= c.kgUntil).length;
    const zul = zulageGrund(cF, AVD) + (zk > 0 && cF >= AVD.minEigen ? Math.min(cF, AVD.kindMax * zk) : 0);
    const startRow = R.simB.rows.find(r => r.avdPay[i] > 0);
    const before = startRow ? R.simB.rows.find(r => r.year === startRow.year - 1) : null;
    el.innerHTML = [
      ['Zulagen ' + nowY, eur(zul) + (zk ? ` (${zk} Kind${zk > 1 ? 'er' : ''})` : '')],
      ['Förderquote auf Eigenbeitrag', cF > 0 ? pc(zul / cF, 0) : '–'],
      ['Kapital bei Auszahlung', before ? keur(before.avd[i] / before.priceIdx) : '–'],
      ['Erste Auszahlung', startRow ? eur(startRow.avdPay[i] / 12 / startRow.priceIdx) + '/M.' : '–'],
    ].map(([l, v]) => fact(l, v)).join('');
  });
  // Basisrente und private RV
  I.persons.forEach((P, i) => POLICIES.forEach(k => {
    const el = $(`#${k}facts-${i}`); if (!el) return;
    const st = R.simB.pol[i][k], cfg = P[k];
    if (!st) { el.innerHTML = ''; return; }
    const y0 = Math.floor(st.s0 / 12), r0 = R.simB.rows.find(r => r.year === y0) || R.simB.rows[R.simB.rows.length - 1];
    const teil = teilOf(cfg, k);
    const cap = st.lump + (cfg.rf > 0 ? st.rentM * 10000 / cfg.rf : 0);
    const rent = st.rentM * (1 - cfg.rk);
    const eff = policyEffCost(cfg, P.by + cfg.payStart - I.startYear, ST.A.ret);
    const tot = key => sum(R.simB.rows.map(r => r.pp[i][key] || 0));
    const items = [
      ['Kapital bei Rentenbeginn ' + y0 + ' (heute)', keur(cap / r0.priceIdx)],
      [teil < 1 ? 'Erste Rente (heutige Kaufkraft)' : 'Kapitalauszahlung', teil < 1 ? eur(rent / r0.priceIdx) + '/M.' : keur(st.lump / r0.priceIdx)],
      ['Effektivkosten', eff ? pc(eff.eff, 2).replace(' %', ' Pp.') : '–'],
      ['Kosten bis Rentenbeginn', keur(st.cost)],
    ];
    if (k === 'basis') items.push(['Steuererstattung gesamt', keur(tot('basisRefund'))], ['Steuerpflichtiger Anteil', pc(LAW.besteuerungsanteil(y0), 0)]);
    else {
      if (teil > 0) items.push(['Steuer auf Kapital', keur(tot('lumpTax'))], ['Hälftelung', st.half ? 'ja' : '<span class="pill warn">nein</span>']);
      if (teil < 1) items.push(['Ertragsanteil der Rente', pc(ertragsanteil(cfg.payStart), 0)]);
    }
    el.innerHTML = items.map(([l, v]) => fact(l, v)).join('');
  }));
  // Budgetübersicht im ersten Rechenjahr
  const bt = $('#budget-tbl');
  if (bt) {
    const r = R.simB.rows[0], A0 = R.simA.rows[0];
    const n = I.persons.length;
    const per = (who, key) => who < 0 ? sum(I.persons.map((p, i) => r.pp[i][key] || 0)) : r.pp[who][key] || 0;
    const lines = [
      ['Altersvorsorgedepot (Eigenbeitrag)', w => per(w, 'avdIn')],
      ['Basisrente', w => per(w, 'basisIn')],
      ['Private Rentenversicherung', w => per(w, 'prvIn')],
      ['ETF-Depot (Rest)', w => w < 0 ? r.etfContrib : r.etfContrib / n],
      ['Kreditraten', w => w < 0 ? r.loanPay : r.loanPay / n],
    ];
    const cols = [...I.persons.map((p, i) => i), -1];
    $('#budget-sub').textContent = `${r.year} · pro Monat · nominal`;
    bt.innerHTML = `<table><thead><tr><th></th>${cols.map(c => `<th>${c < 0 ? 'Haushalt' : esc(I.persons[c].name)}</th>`).join('')}</tr></thead><tbody>${lines.map(([l, f]) => `<tr><td class="txt">${l}</td>${cols.map(c => `<td>${eur(f(c) / 12)}</td>`).join('')}</tr>`).join('')}
      <tr style="border-top:2px solid var(--line-2)"><td class="txt"><b>Budget</b></td>${cols.map(c => `<td><b>${eur((c < 0 ? r.budget : r.budget / n) / 12)}</b></td>`).join('')}</tr></tbody></table>`
      + (R.simB.rows.some(x => x.budgetCut < 0.999) ? `<p class="note" style="margin:8px"><span class="pill warn">Budget reicht nicht</span> Die Beiträge der Vorsorgeprodukte sind höher als das Budget nach Kreditraten. In diesen Jahren werden alle Beiträge anteilig gekürzt.</p>` : '');
  }
  const fi = $('#fund-issues');
  if (fi) {
    const iss = fundIssues(I);
    fi.innerHTML = iss.length ? `<div class="note" style="background:var(--warn-soft)"><span class="pill warn">Zeiträume prüfen</span><ul style="margin:6px 0 0 18px;padding:0">${iss.map(x => `<li>${x}</li>`).join('')}</ul></div>` : '';
  }
  const rf = $('#refund-info');
  if (rf) {
    const sv = R.simB;
    rf.innerHTML = `Bis zum Rentenbeginn bekommt ihr <b class="num">${keur(sv.sumZulagen)}</b> Zulagen und <b class="num">${keur(sv.sumRefunds)}</b> zusätzliche Steuererstattung aus dem Sonderausgabenabzug (nominal). Die Erstattung kommt im Folgejahr und fließt wie in der Karte eingestellt. Kapital in heutiger Kaufkraft.`;
  }
}

// ═══ Reiter 2: Strategie ═══
const REFUND_OPTS = (k) => [['same', k === 'avd' ? 'ins AVD (ungefördert)' : 'in die Basisrente'], ['etf', 'ins ETF-Depot'], ['none', 'wird verbraucht']];
function avdCard(i) {
  const P = ST.I.persons[i], b = `I.persons.${i}.avd`;
  return `<div class="card">
    <div class="card-h"><h2>Altersvorsorgedepot ${esc(P.name)}</h2>${C(b + '.on', 'Nutzen', { rr: 1 })}</div>
    ${P.avd.on ? `<div class="fields">
      ${F(b + '.eigen', 'Geförderter Eigenbeitrag', { t: 'eur', u: '€/Jahr', step: 60, min: 0, max: AVD.fMax, h: `Maximal ${eur(AVD.fMax)}. Mindestens ${eur(AVD.minEigen)} für Zulagen.` })}
      ${F(b + '.extra', 'Zusätzlich ungefördert', { t: 'eur', u: '€/Jahr', step: 120, min: 0, max: AVD.einMax - AVD.fMax, h: `Bis ${eur(AVD.einMax)} insgesamt. Später wird nur der Ertrag besteuert.` })}
      ${F(b + '.cost', 'Kosten des Depots', { t: 'pct', step: 0.05, h: 'Fonds plus Depot. Standarddepot max. 1 %.' })}
      ${S(b + '.teilkapital', 'Einmalauszahlung zu Beginn', Array.from({ length: Math.round(AVD.teilMax * 10) + 1 }, (_, k) => [k / 10, k === 0 ? 'Keine' : pc(k / 10, 0) + (k / 10 === AVD.teilMax ? ' (Maximum)' : '')]))}
      ${S(b + '.payStart', 'Auszahlung ab Alter', yearOpts(AVD.payMin, AVD.payMax))}
      ${S(b + '.payEnd', 'Auszahlungsplan bis Alter', yearOpts(AVD.planEndMin, 100))}
      ${S(b + '.refundTo', 'Steuererstattung § 10a fließt', REFUND_OPTS('avd'), { h: 'Steuerersparnis über der Zulage, kommt im Folgejahr' })}
    </div>
    <div class="facts" id="avdfacts-${i}"></div>` : '<p class="note">' + esc(P.name) + ' spart nicht ins Altersvorsorgedepot.</p>'}
  </div>`;
}
// Kostenfelder wie im Produktinformationsblatt, mit Vorlagen
function costFields(b, cfg) {
  const is = k => Object.entries(INS_PRESETS[k]).every(([f, v]) => Math.abs((cfg[f] ?? 0) - v) < 1e-9);
  return `<div class="card-h"><h3>Kosten laut Produktinformationsblatt</h3><div class="seg">${[['provision', 'Provisionstarif'], ['netto', 'Nettotarif']].map(([k, l]) => `<button data-preset="${b}|${k}" aria-pressed="${is(k)}">${l}</button>`).join('')}</div></div>
    <div class="fields three">
      ${F(b + '.akv', 'Abschluss- und Vertriebskosten', { t: 'pct', step: 0.1, h: '% der Beitragssumme, auf 5 Jahre verteilt. Zuzahlungen sofort.' })}
      ${F(b + '.vkBeitrag', 'Verwaltungskosten Beiträge', { t: 'pct', step: 0.5, h: '% jedes Beitrags' })}
      ${F(b + '.vkFix', 'Verwaltungskosten fest', { t: 'eur', u: '€/Jahr', step: 6, h: 'In der Ansparphase' })}
      ${F(b + '.vkKapital', 'Verwaltungskosten Kapital', { t: 'pct', step: 0.05, h: '% des gebildeten Kapitals pro Jahr' })}
      ${F(b + '.ter', 'Fondskosten (TER)', { t: 'pct', step: 0.05, h: 'ETF etwa 0,2 %, aktive Fonds 1,5 %' })}
      ${F(b + '.rk', 'Kosten Rentenphase', { t: 'pct', step: 0.1, h: '% jeder Rente' })}
      ${F(b + '.rf', 'Rentenfaktor', { t: 'num', step: 0.5, u: '€ je 10.000 €', h: 'Monatsrente je 10.000 € Kapital. Garantiert meist 24 bis 29 €.' })}
      ${F(b + '.rentDyn', 'Rentensteigerung', { t: 'pct', step: 0.1, h: 'pro Jahr aus Überschüssen, nicht garantiert' })}
    </div>`;
}
function basisCard(i) {
  const P = ST.I.persons[i], b = `I.persons.${i}.basis`, c = P.basis;
  return `<div class="card">
    <div class="card-h"><h2>Basisrente ${esc(P.name)}</h2>${C(b + '.on', 'Nutzen', { rr: 1 })}</div>
    ${c.on ? `<div class="fields three">
      ${F(b + '.beitrag', 'Beitrag', { t: 'eur', u: '€/Jahr', step: 300, min: 0 })}
      ${S(b + '.payStart', 'Rente ab Alter', yearOpts(INS.basisMinAge, 70), { h: `Frühestens mit ${INS.basisMinAge}` })}
      ${S(b + '.refundTo', 'Steuererstattung fließt', REFUND_OPTS('basis'), { h: 'Kommt im Folgejahr' })}
    </div>
    ${costFields(b, c)}
    <div class="facts" id="basisfacts-${i}"></div>` : `<p class="note">Beiträge sind bis zum Höchstbetrag (2026: ${eur(hbYear(2026))} je Person, abzüglich der Beiträge zur gesetzlichen Rente, bei Angestellten Arbeitnehmer- und Arbeitgeberanteil) als Sonderausgaben abziehbar. Die Rente ist wie die gesetzliche Rente zu versteuern, lebenslang, nicht vererbbar und nicht kapitalisierbar.</p>`}
  </div>`;
}
function prvCard(i) {
  const P = ST.I.persons[i], b = `I.persons.${i}.prv`, c = P.prv;
  return `<div class="card">
    <div class="card-h"><h2>Private Rentenversicherung ${esc(P.name)}</h2>${C(b + '.on', 'Nutzen', { rr: 1 })}</div>
    ${c.on ? `<div class="fields three">
      ${F(b + '.beitrag', 'Beitrag', { t: 'eur', u: '€/Jahr', step: 300, min: 0 })}
      ${S(b + '.payStart', 'Auszahlung ab Alter', yearOpts(60, 75), { h: `Hälftelung erst ab ${INS.halfAge} und nach ${INS.halfYears} Jahren` })}
      ${S(b + '.mode', 'Auszahlung als', [['rente', 'Lebenslange Rente'], ['kapital', 'Kapital (ins ETF-Depot)'], ['teil', 'Teilkapital + Rente']], { rr: 1 })}
      ${c.mode === 'teil' ? S(b + '.teil', 'Teilkapital', [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(v => [v, pc(v, 0)])) : ''}
    </div>
    ${costFields(b, c)}
    <div class="facts" id="prvfacts-${i}"></div>` : `<p class="note">Fondsgebundene Rentenversicherung ohne Förderung. In der Ansparphase fällt keine Steuer an. Die Rente ist nur mit dem Ertragsanteil steuerpflichtig (${pc(ertragsanteil(SV.rentenAlter), 0)} bei Beginn mit ${SV.rentenAlter}). Bei Kapitalauszahlung zählen ${pc(1 - INS.fondsFrei, 0)} des Ertrags, ab ${INS.halfAge} und nach ${INS.halfYears} Jahren davon die Hälfte.</p>`}
  </div>`;
}
function fundsHtml() {
  const D = ST.I.depot;
  return D.funds.map((f, k) => `<div class="fund">
    <div class="fund-h"><span class="dot" style="background:var(${FUND_C[k]})"></span>Fonds ${k + 1}</div>
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
  const n = nf0.format, t26 = LAW.tariff[2026], t27 = LAW.tariff[2027], t28 = LAW.tariff[2028], k26 = LAW.kinder[2026], hb = hbYear, rs = y => pc(lawPick(SV.rvSatz, y).v);
  const rw = SV.rw[2026].toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const zulMax = AVD.g1 * AVD.g1Cap + AVD.g2 * (AVD.fMax - AVD.g1Cap);
  const rows = [
    ['Einkommensteuer', `Tarif 2026, Grundfreibetrag ${eur(t26.gfb)}`, 'G', '§ 32a EStG', 'https://www.gesetze-im-internet.de/estg/__32a.html'],
    ['Einkommensteuer', `Tarif 2027/2028, Grundfreibetrag ${n(t27.gfb)} / ${eur(t28.gfb)}`, 'E', 'BT-Drs. 21/8235', 'https://dserver.bundestag.de/btd/21/082/2108235.pdf'],
    ['Einkommensteuer', 'ab 2029 mit Inflation fortgeschrieben (Schalter)', 'A', 'Annahme', ''],
    ['Solidaritätszuschlag', `Freigrenze ${eur(LAW.soli.freigrenzeSplit)} (Splitting), Milderung ${pc(LAW.soli.milderung)}`, 'G', '§§ 3, 4 SolZG', 'https://www.gesetze-im-internet.de/solzg_1995/__3.html'],
    ['Kinder', `Kinderfreibetrag ${eur(k26.kfb)}, Kindergeld ${eur(k26.kg)} (2026)`, 'G', '§§ 32, 66 EStG', 'https://www.gesetze-im-internet.de/estg/__32.html'],
    ['Rentenbesteuerung', 'Besteuerungsanteil +0,5 Pp. je Jahrgang, 100 % ab 2058', 'G', '§ 22 Nr. 1 EStG', 'https://www.gesetze-im-internet.de/estg/__22.html'],
    ['Kapitalerträge', `Abgeltungsteuer ${pc(LAW.abgSt * (1 + LAW.soliKap), 3)}, Sparerpauschbetrag ${eur(LAW.sparerPB)}`, 'G', '§§ 20, 32d EStG', 'https://www.gesetze-im-internet.de/estg/__32d.html'],
    ['Investmentsteuer', `Teilfreistellung 30 %, Vorabpauschale mit Basiszins ${pc(LAW.basiszins[2026] / 100, 2)} (2026)`, 'G', '§§ 18-20 InvStG', 'https://www.gesetze-im-internet.de/invstg_2018/__18.html'],
    ['Altersvorsorgedepot', `Grundzulage ${pc(AVD.g1, 0)} bis ${eur(AVD.g1Cap)}, ${pc(AVD.g2, 0)} bis ${eur(AVD.fMax)} (max. ${eur(zulMax)})`, 'G', '§ 84 EStG n. F.', 'https://www.recht.bund.de/bgbl/1/2026/156/VO.html'],
    ['Altersvorsorgedepot', `Kinderzulage bis ${eur(AVD.kindMax)}, Mindesteigenbeitrag ${eur(AVD.minEigen)}`, 'G', '§§ 85, 86 EStG n. F.', 'https://www.recht.bund.de/bgbl/1/2026/156/VO.html'],
    ['Altersvorsorgedepot', `Sonderausgabenabzug ${eur(AVD.fMax)} + Zulage mit Günstigerprüfung`, 'G', '§ 10a EStG n. F.', 'https://www.recht.bund.de/bgbl/1/2026/156/VO.html'],
    ['Altersvorsorgedepot', `Selbständige förderberechtigt (unter ${SV.rentenAlter})`, 'G', '§ 10a Abs. 1 S. 5 EStG n. F.', 'https://www.recht.bund.de/bgbl/1/2026/156/VO.html'],
    ['Altersvorsorgedepot', `Auszahlung ab ${AVD.payMin} bis ${AVD.payMax}, Plan bis mind. ${AVD.planEndMin}, bis ${pc(AVD.teilMax, 0)} Einmalbetrag`, 'G', '§ 1 AltZertG n. F.', 'https://www.recht.bund.de/bgbl/1/2026/156/VO.html'],
    ['Altersvorsorgedepot', 'Geförderter Teil voll steuerpflichtig, ungeförderter Teil nur der Ertrag, nach 12 Jahren und ab 62 zur Hälfte; keine Vorabpauschale beim Sparen', 'G', '§ 22 Nr. 5 S. 2 c EStG', 'https://www.gesetze-im-internet.de/estg/__22.html'],
    ['Altersvorsorgedepot', 'KVdR beitragsfrei, freiwillig Versicherte zahlen Beiträge', 'G', '§§ 237, 229 SGB V', 'https://www.gesetze-im-internet.de/sgb_5/__237.html'],
    ['Basisrente', `Höchstbetrag ${eur(hb(2026))} je Person (2026), gemeinsam bei Zusammenveranlagung, minus Beiträge zur GRV (AN- und AG-Anteil, Selbständige voller Beitrag)`, 'G', '§ 10 Abs. 1 Nr. 2 b, Abs. 3 EStG', 'https://www.gesetze-im-internet.de/estg/__10.html'],
    ['Basisrente', `Höchstbetrag 2027: ${eur(hb(2027))} (knappschaftliche BBG ${eur(lawPick(SV.bbgKn, 2027).v)} × ${pc(lawPick(SV.rvSatz, 2027).v + SV.knAufschlag)})`, 'E', 'SV-Rechengrößenverordnung 2027', ''],
    ['Basisrente', `Rente frühestens ab ${INS.basisMinAge}, Besteuerung wie gesetzliche Rente`, 'G', '§ 22 Nr. 1 S. 3 a aa EStG', 'https://www.gesetze-im-internet.de/estg/__22.html'],
    ['Basisrente, private RV', 'Kostenarten wie im Produktinformationsblatt', 'G', '§ 2a AltZertG, AltvPIBV', 'https://www.gesetze-im-internet.de/altzertg/__2a.html'],
    ['Private Rentenversicherung', `Rente mit Ertragsanteil (${pc(ertragsanteil(SV.rentenAlter), 0)} bei Beginn mit ${SV.rentenAlter})`, 'G', '§ 22 Nr. 1 S. 3 a bb EStG', 'https://www.gesetze-im-internet.de/estg/__22.html'],
    ['Private Rentenversicherung', `Kapital: ${pc(INS.fondsFrei, 0)} des Ertrags steuerfrei (fondsgebunden), ab ${INS.halfAge} und nach ${INS.halfYears} Jahren die Hälfte mit persönlichem Steuersatz, sonst Abgeltungsteuer`, 'G', '§ 20 Abs. 1 Nr. 6 EStG', 'https://www.gesetze-im-internet.de/estg/__20.html'],
    ['Krankenversicherung', 'Basisrente und private RV in der KVdR beitragsfrei, freiwillig Versicherte zahlen auf die volle Rente', 'G', '§ 240 SGB V', 'https://www.gesetze-im-internet.de/sgb_5/__240.html'],
    ['Krankenversicherung', `Kapitalauszahlung bei freiwillig Versicherten: 1/${INS.kvLumpMonths} über ${INS.kvLumpMonths / 12} Jahre`, 'A', 'Annahme analog § 229 SGB V', ''],
    ['Rentenversicherung', `Rentenwert ${rw} ab 1.7.2026, BBG 2026 ${eur(lawPick(SV.bbgRV, 2026).v)}`, 'G', 'SGB VI, RV-Rechengrößen', 'https://www.deutsche-rentenversicherung.de/'],
    ['Rentenversicherung', `BBG 2027 ${eur(lawPick(SV.bbgRV, 2027).v)}`, 'E', 'SV-Rechengrößenverordnung 2027 (Kabinett 7.10.2026)', ''],
    ['Rentenversicherung', `Beitragssatz ${rs(2026)} (2026)`, 'G', '§ 158 SGB VI', 'https://www.gesetze-im-internet.de/sgb_6/__158.html'],
    ['Rentenversicherung', `Beitragssatz 2027 ${rs(2027)}`, 'E', 'SV-Rechengrößen 2027 (Kabinett 7.10.2026)', ''],
    ['Rentenversicherung', `Beitragssatz ab 2028 ${rs(2028)} (Vorausschätzung)`, 'A', 'DRV, Bundesvertreterversammlung 11.6.2026', 'https://www.deutsche-rentenversicherung.de/DRV/DE/Ueber-uns-und-Presse/Presse/Pressemitteilungen/Pressemitteilungen-aktuell/2026/2026-06-11-bvv-gunkel.html'],
    ['Rentenversicherung', 'Haltelinie 48 % bis 2031, danach Dämpfung (Schalter)', 'G', 'Rentenpaket 2025', ''],
    ['Rentenversicherung', `Regelaltersgrenze ${SV.rentenAlter}, Abschlag 0,3 % je Monat`, 'G', '§§ 35, 77 SGB VI', 'https://www.gesetze-im-internet.de/sgb_6/__77.html'],
    ['Krankenversicherung', `BBG 2026 ${eur(lawPick(SV.bbgKV, 2026).v)}, Zusatzbeitrag Ø ${pc(ASSUME.zusatz)}`, 'G', 'SGB V, BStabG', ''],
    ['Krankenversicherung', `BBG 2027 ${eur(lawPick(SV.bbgKV, 2027).v)} (inkl. Sonderanhebung)`, 'E', 'SV-Rechengrößenverordnung 2027 (Kabinett 7.10.2026)', ''],
    ['Krankenversicherung', 'KVdR über 9/10-Regel, freiwillige GKV zählt, 3 Jahre je Kind', 'G', '§ 5 Abs. 1 Nr. 11 SGB V', 'https://www.gesetze-im-internet.de/sgb_5/__5.html'],
    ['Krankenversicherung', `Freiwillige Rentner: ${pc(SV.kvErm)} + Zusatzbeitrag auf Kapitalerträge, ohne Sparerpauschbetrag`, 'G', '§ 240 SGB V, Beitragsverfahrensgrundsätze', ''],
    ['Pflegeversicherung', `${pc(SV.pv)}, Rentner zahlen voll`, 'G', '§ 55 SGB XI', ''],
  ];
  const chip = s => s === 'G' ? '<span class="pill good">gilt</span>' : s === 'B' ? '<span class="pill info">beschlossen</span>' : s === 'E' ? '<span class="pill warn">Entwurf</span>' : '<span class="pill info">Annahme</span>';
  return `<div class="tablebox"><table class="legal"><thead><tr><th>Bereich</th><th>Wert im Rechner</th><th>Status</th><th>Grundlage</th></tr></thead><tbody>${rows.map(r => `<tr><td class="txt">${r[0]}</td><td class="txt">${r[1]}</td><td class="txt">${chip(r[2])}</td><td class="txt">${r[4] ? `<a href="${r[4]}" target="_blank" rel="noopener">${r[3]}</a>` : r[3]}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderP1() {
  const I = ST.I;
  const W = I.withdraw;
  $('#p1').innerHTML = `
  <p class="note">Das Sparbudget fließt zuerst in die Vorsorgeprodukte, die du hier einschaltest, der Rest ins ETF-Depot. <b>Deine Aufteilung</b> wird mit <b>nur ETF-Depot</b> und dem <b>Optimum</b> aus dem Optimierer verglichen. Alle nutzen dasselbe Budget, dieselbe Rendite und dieselbe Entnahmestrategie.</p>
  <div class="card">
    <div class="card-h"><h2>So verteilt sich dein Budget</h2><span class="muted" id="budget-sub"></span></div>
    <div class="tablebox" id="budget-tbl"></div>
  </div>
  <div class="grid">${avdCard(0)}${avdCard(1)}</div>
  <div class="note" id="refund-info"></div>
  <div class="grid">${basisCard(0)}${basisCard(1)}</div>
  <div class="grid">${prvCard(0)}${prvCard(1)}</div>
  <p class="note">Renten aus Basisrente und privater Rentenversicherung laufen lebenslang. Der Rechner rechnet wie überall bis zum Zielalter. Dass die Rente auch darüber hinaus gezahlt wird, und dass das Kapital mit Rentenbeginn nicht mehr vererbbar ist, bewertet er nicht. Das Versicherungskapital zählt bis zum Rentenbeginn zum Vermögen.</p>
  <div class="card">
    <div class="card-h"><h2>Beste Aufteilung suchen</h2><div class="row"><button class="btn primary" id="btn-opt">Optimierer starten</button><button class="btn" id="btn-opt-stop" hidden>Abbrechen</button></div></div>
    <div class="fields three">
      ${S('A.optMode', 'Verfahren', [['fast', 'Schnell (feste Rendite)'], ['mc', 'Monte Carlo (50 Verläufe)']], { rr: 1, h: ST.A.optMode === 'mc' ? 'Verfeinert das schnelle Optimum, dauert etwa eine halbe bis zwei Minuten' : 'Dauert wenige Sekunden' })}
      ${ST.A.optMode === 'mc' ? S('A.optQ', 'Ziel', [[0.1, 'Netto, das in 90 % der Verläufe reicht'], [0.25, 'Netto, das in 75 % der Verläufe reicht'], [0.5, 'Typischer Verlauf (50 %)']]) : ''}
    </div>
    <p class="muted" style="margin:0">Probiert für beide Personen aus, wie viel in Altersvorsorgedepot, Basisrente und private Rentenversicherung fließt, und deren Auszahlungsoptionen. Der Rest geht ins ETF-Depot. Kosten bleiben wie eingetragen. Ziel ist das höchste Netto in heutiger Kaufkraft.</p>
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
        ${F('I.depot.freistellung', 'Freistellungsauftrag', { t: 'eur', u: '€/Jahr', step: 100, min: 0, max: 2000, h: 'Für dieses Depot genutzter Sparerpauschbetrag, Paare höchstens 2.000 €' })}
      </div>
      <p class="note">Die Staffelung nutzt FIFO. Wer im Alter zuerst den jüngsten Fonds verkauft, versteuert anfangs wenig Gewinn. Das verschiebt Steuern nach hinten.</p>
      <div id="fund-issues"></div>
      ${fundsHtml()}
    </div>
    <div class="card">
      <div class="card-h"><h2>Entnahme im Ruhestand</h2></div>
      <div class="fields">
        ${S('I.withdraw.strategy', 'Strategie', [['realConst', 'Höchstes gleichbleibendes Netto'], ['perpetual', 'Ewige Rente (Kapital bleibt erhalten)'], ['fixedNet', 'Wunsch-Netto vorgeben']], { rr: 1 })}
        ${F('I.withdraw.targetAge', W.strategy === 'perpetual' ? 'Kapital prüfen bis Alter' : 'Geld soll reichen bis Alter', { t: 'int', min: 80, max: 105 })}
        ${S('I.withdraw.refPerson', 'Alter von', I.persons.map((p, i) => [i, p.name]))}
        ${W.strategy === 'fixedNet' ? F('I.withdraw.fixedNet', 'Wunsch-Netto heute', { t: 'eur', u: '€/Monat', step: 100 }) + `<div class="f"><label>&nbsp;</label>${C('I.withdraw.fixedIndexed', 'Mit Inflation anpassen')}</div>` : ''}
      </div>
      <p class="note">Netto heißt hier: gesetzliche Renten, Auszahlungen aus dem Altersvorsorgedepot und Verkäufe aus dem ETF-Depot, abzüglich Einkommensteuer, Soli, Kapitalertragsteuer und eigener Kranken- und Pflegeversicherung. Die Entnahme beginnt, wenn beide in Rente sind.${W.strategy === 'perpetual' ? ' <b>Ewige Rente:</b> Das Netto ist so gewählt, dass das Nettovermögen (ETF-Depot und Altersvorsorgedepot) im gewählten Alter in heutiger Kaufkraft mindestens so hoch ist wie zu Entnahmebeginn. Das Altersvorsorgedepot wird per Auszahlungsplan verbraucht, das ETF-Depot muss das ausgleichen.' : ''}</p>
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
  $('#btn-split').onclick = () => { autoSplit(); commit(); };
  $('#btn-opt').onclick = runOptimizer;
  $('#btn-opt-stop').onclick = () => { if (OPT_RUN) OPT_RUN.cancel(); OPT_RUN = null; $('#btn-opt').disabled = false; $('#btn-opt-stop').hidden = true; $('#opt-out').innerHTML = '<p class="muted">Abgebrochen.</p>'; };
  $$('[data-preset]').forEach(b => b.onclick = () => { const [path, k] = b.dataset.preset.split('|'); Object.assign(getP(path), INS_PRESETS[k]); commit(); });
  if (OPT_RUN) { $('#btn-opt').disabled = true; $('#btn-opt-stop').hidden = false; }
  if (OPT) renderOptResult();
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
const OPT_LAB = {
  avd: { on: 'Genutzt', eigen: 'Geförderter Eigenbeitrag', extra: 'Ungeförderter Zusatzbeitrag', payStart: 'Auszahlung ab', payEnd: 'Plan bis', teilkapital: 'Einmalauszahlung' },
  basis: { on: 'Genutzt', beitrag: 'Beitrag', payStart: 'Rente ab' },
  prv: { on: 'Genutzt', beitrag: 'Beitrag', payStart: 'Auszahlung ab', mode: 'Auszahlung als' },
};
function optFmt(k, v) {
  if (k === 'on') return v ? 'ja' : 'nein';
  if (['eigen', 'extra', 'beitrag'].includes(k)) return eur(v) + '/Jahr';
  if (k === 'teilkapital') return pc(v, 0);
  if (k === 'mode') return { rente: 'Rente', kapital: 'Kapital', teil: 'Teilkapital + Rente' }[v] ?? esc(v);
  return esc(v) + ' Jahre';
}
function runOptimizer() {
  const b = $('#btn-opt'); b.disabled = true; $('#btn-opt-stop').hidden = false;
  const mode = ST.A.optMode, q = ST.A.optQ;
  OPT_RUN = optimize(ST.I, ST.A, { mode, q }, (p, n, phase) => {
    $('#opt-bar').style.width = (p * 100).toFixed(0) + '%';
    $('#opt-out').innerHTML = `<p class="muted">${phase}: bisher bestes ${phase === 'Monte Carlo' ? `Netto in ${pc(1 - q, 0)} der Verläufe` : 'Netto'} <b class="num">${eur(n)}</b>/Monat</p>`;
  }, (best, n, info) => {
    OPT_RUN = null; b.disabled = false; $('#btn-opt-stop').hidden = true;
    OPT = { patch: optPatch(best), net: n, info, sig: optSig() };
    recalc(); renderOptResult();
  });
}
function renderOptResult() {
  const el = $('#opt-out'); if (!el || !OPT || !R) return;
  const P = ST.I.persons, stale = OPT.sig !== optSig();
  const rows = [];
  P.forEach((p, i) => Object.keys(OPT_LAB).forEach(k => {
    const cur = p[k], opt = OPT.patch[i][k];
    const uC = prodUsed(p, k), uO = prodUsed({ [k]: opt }, k);
    // Beiträge zeigen, wenn eines von beiden das Produkt nutzt, Auszahlungsoptionen nur für das genutzte Optimum
    const keys = Object.keys(OPT_LAB[k]).filter(f => f === 'on' || (uC || uO) && (OPT_AMOUNT[k].includes(f) || uO));
    keys.forEach(f => {
      const o = f === 'on' ? prodUsed(p, k) : cur[f], v = f === 'on' ? prodUsed({ [k]: opt }, k) : opt[f];
      rows.push(`<tr><td>${esc(p.name)}</td><td class="txt">${PROD[k].name}</td><td class="txt">${OPT_LAB[k][f]}</td><td>${optFmt(f, o)}</td><td>${o !== v ? `<b>${optFmt(f, v)}</b>` : optFmt(f, v)}</td></tr>`);
    });
  }));
  const d = (R.netO ?? 0) - (R.netB ?? 0);
  const mc = OPT.info.mode === 'mc' ? ` Ziel war das Netto, das in ${pc(1 - OPT.info.q, 0)} von ${OPT.info.runs} Verläufen reicht: Optimum <b class="num">${eur(OPT.info.pct)}</b>, deine Aufteilung <b class="num">${eur(OPT.info.pctB)}</b>, nur ETF <b class="num">${eur(OPT.info.pctA)}</b> pro Monat. Bei fester Rendite kann das Optimum darunter liegen, weil es auf schlechte Verläufe hin optimiert ist.` : '';
  el.innerHTML = `<p>${stale ? '<span class="pill warn">veraltet</span> Eingaben haben sich seit dem Lauf geändert. ' : ''}Optimum: <b class="num">${eur(R.netO ?? OPT.net)}</b>/Monat bei fester Rendite, das sind <b class="num">${(d >= 0 ? '+' : '') + eur(d)}</b> gegenüber deiner Aufteilung.${mc}</p>
    <div class="tablebox"><table><thead><tr><th>Person</th><th>Produkt</th><th>Stellschraube</th><th>Jetzt</th><th>Optimum</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
    <div class="row" style="margin-top:8px"><button class="btn primary" id="btn-opt-apply">Optimum übernehmen</button></div>`;
  $('#btn-opt-apply').onclick = () => { ST.I = applyPatch(ST.I, OPT.patch); save(); renderPanels(); recalc(); };
}

// ═══ Reiter 3: Entwicklung ═══
function renderP2() {
  const names = ST.I.persons.map(p => p.name);
  $('#p2').innerHTML = `
  <div class="row">
    <span class="muted">Details für</span>
    <div class="seg" id="seg-scen">${['A', 'B', 'O'].map(k => `<button data-v="${k}" aria-pressed="${chartScen === k}"${k === 'O' && !OPT ? ' disabled title="Erst den Optimierer im Reiter Strategie starten"' : ''}>${SCN[k]}</button>`).join('')}</div>
    <div class="seg" id="seg-person"><button data-v="-1" aria-pressed="${chartPerson === -1}">Haushalt</button>${names.map((n, i) => `<button data-v="${i}" aria-pressed="${chartPerson === i}">${esc(n)}</button>`).join('')}</div>
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
  <div class="card"><div class="card-h"><h2>Vorsorgeprodukte</h2><span class="muted" id="avd-sub"></span></div><div class="chart" id="ch-avd" role="img" aria-label="Kapital in Altersvorsorgedepot, Basisrente und privater Rentenversicherung"></div></div>
  <div class="grid">
    <div class="card"><h2>Sparen pro Jahr<span class="infotip" tabindex="0" aria-label="Annahmen">i<span class="tip" role="tooltip"><b>Annahme:</b> Die Steuer auf Ausschüttungen und Vorabpauschale des ETF-Depots wird in der Sparphase aus dem Sparbudget bezahlt und mindert die ETF-Sparrate. Erstattungen aus dem Sonderausgabenabzug (§ 10a, Basisrente) fließen je nach Einstellung als Zuzahlung ins Produkt oder ins ETF-Depot.</span></span></h2><div class="chart sm" id="ch-save" role="img" aria-label="Sparbeiträge pro Jahr"></div></div>
    <div class="card"><h2>Einkommen im Ruhestand pro Monat</h2><div class="chart sm" id="ch-income" role="img" aria-label="Einkommen im Ruhestand"></div></div>
  </div>
  <div class="grid">
    <div class="card"><h2>Steuern und Beiträge im Ruhestand pro Monat</h2><div class="chart sm" id="ch-deduct" role="img" aria-label="Abzüge im Ruhestand"></div></div>
    <div class="card"><h2>Abzüge im Vergleich</h2><div class="chart sm" id="ch-compare" role="img" aria-label="Abzüge A gegen B"></div></div>
  </div>
  <div class="card">
    <div class="card-h"><h2>Monte Carlo: Wie sicher ist das Netto?</h2>
      <div class="row">${S('A.mcRuns', 'Läufe', [[100, '100'], [200, '200'], [500, '500']])}<button class="btn primary" id="btn-mc" style="align-self:flex-end">Simulation starten</button></div></div>
    <p class="muted" style="margin:0">Zufällige Renditen und Inflation je Jahr. Für jeden Verlauf wird das höchste Netto bestimmt, das bis zum Zielalter reicht. Nur ETF, deine Aufteilung und das Optimum laufen auf denselben Verläufen. Die Werte gelten für den ganzen Haushalt.</p>
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
const PERS_ARR = ['basis', 'prv', 'basisIn', 'prvIn', 'basisPay', 'prvPay', 'basisPayW', 'prvPayW', 'lump', 'avd', 'avdIn', 'grv', 'avdPay', 'grvW', 'avdPayW'];
function V(r, k, who = chartPerson) {
  if (who >= 0) return r.pp[who][k];
  if (PERS_ARR.includes(k)) return sum(r[k]);
  switch (k) {
    case 'zul': return r.zulagen;
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
// Tooltip: Bezeichnungen links, Werte rechtsbündig untereinander
const tipRow = (label, v, strong) => `<span${strong ? ' style="font-weight:700"' : ''}>${label}</span><span style="text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums;font-weight:${strong ? 700 : 600}">${v == null ? '–' : eur(v)}</span>`;
const tipSum = ps => tipRow('Summe', ps.reduce((a, p) => a + (p.value || 0), 0), true);
const tip = (title, rows) => `<b>${title}</b><div style="display:grid;grid-template-columns:auto auto;column-gap:16px;row-gap:2px;margin-top:4px">${rows.join('')}</div>`;
const tipSeries = ps => ps.map(p => tipRow(`${p.marker}${esc(p.seriesName)}`, p.value));
function baseOpt(extra = {}) {
  const ink2 = cssv('--ink-2'), ink3 = cssv('--ink-3'), line = cssv('--line'), surf = cssv('--surface');
  return {
    backgroundColor: 'transparent', animationDuration: 300,
    textStyle: { fontFamily: 'Public Sans, system-ui, sans-serif', color: ink2 },
    grid: { left: 8, right: 16, top: window.innerWidth < 600 ? 68 : 44, bottom: 8, containLabel: true },
    legend: { top: 0, left: 0, textStyle: { color: ink2, fontSize: 12 }, itemWidth: 12, itemHeight: 8, icon: 'roundRect' },
    tooltip: { trigger: 'axis', backgroundColor: surf, borderColor: line, textStyle: { color: cssv('--ink'), fontSize: 12 }, formatter: ps => tip(ps[0].axisValue, tipSeries(ps)) },
    xAxis: { type: 'category', axisLine: { lineStyle: { color: line } }, axisTick: { show: false }, axisLabel: { color: ink3 } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: line, type: [3, 3] } }, axisLabel: { color: ink3, formatter: v => Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' Mio.' : Math.abs(v) >= 1e3 ? (v / 1e3).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' Tsd.' : nf0.format(v) } },
    ...extra,
  };
}
// Platz für mehrzeilige Legenden in den kleinen Charts
const withLegend = opt => { const n = opt.series.length, el = 44 + (n > 4 ? 22 : 0) + (n > 7 ? 22 : 0); opt.grid = { ...opt.grid, top: window.innerWidth < 600 ? el + 24 : el }; return opt; };
function renderWho(sim) {
  const ws = sim.wFullYear;
  const r = sim.rows.find(x => x.year === ws), rb = sim.rows.find(x => x.year === sim.wStartYear - 1);
  if (!r) { $('#who').innerHTML = ''; return; }
  const P = ST.I.persons, n = P.length;
  const m = v => eur(dv(r, v) / 12);
  const save = sim.rows.filter(x => x.saveMonths > 0);
  const tot = (k, who) => sum(save.map(x => V(x, k, who)));
  const has = k => sim.rows.some(x => V(x, k, -1) > 0 || V(x, k + 'Pay', -1) > 0);
  const cols = [...P.map((p, i) => i), -1];
  const lines = [
    ['Nettovermögen bei Entnahmestart', who => keur(dv(rb, V(rb, 'netWorth', who))), true],
    ['davon ETF-Depot', who => keur(dv(rb, V(rb, 'etf', who)))],
    ...(has('avd') ? [['davon Altersvorsorgedepot', who => keur(dv(rb, V(rb, 'avd', who)))]] : []),
    ...(has('basis') ? [['davon Basisrente', who => keur(dv(rb, V(rb, 'basis', who)))]] : []),
    ...(has('prv') ? [['davon private Rentenversicherung', who => keur(dv(rb, V(rb, 'prv', who)))]] : []),
    ...(has('avd') ? [['Eigene Beiträge Altersvorsorgedepot', who => keur(tot('avdIn', who))], ['Zulagen', who => keur(tot('zul', who))], ['Steuererstattung § 10a', who => keur(tot('refund', who))]] : []),
    ...(has('basis') ? [['Beiträge Basisrente', who => keur(tot('basisIn', who))], ['Steuererstattung Basisrente', who => keur(tot('basisRefund', who))]] : []),
    ...(has('prv') ? [['Beiträge private Rentenversicherung', who => keur(tot('prvIn', who))]] : []),
    ['Gesetzliche Rente', who => m(V(r, 'grv', who)), true],
    ...(has('avd') ? [['Altersvorsorgedepot', who => m(V(r, 'avdPay', who))]] : []),
    ...(has('basis') ? [['Basisrente', who => m(V(r, 'basisPay', who))]] : []),
    ...(has('prv') ? [['Private Rentenversicherung', who => m(V(r, 'prvPay', who))]] : []),
    ['ETF-Verkauf', who => m(V(r, 'etfSale', who))],
    ['Einkommensteuer + Soli', who => '−' + m(V(r, 'est', who))],
    ['Kapitalertragsteuer', who => '−' + m(V(r, 'kapTax', who))],
    ['Kranken- und Pflegeversicherung', who => '−' + m(V(r, 'kv', who))],
    ['Netto pro Monat', who => '<b>' + m(V(r, 'net', who)) + '</b>', true],
  ];
  $('#who-sub').textContent = `${SCN[chartScen]} · erstes volles Entnahmejahr ${ws} · ${chartReal ? 'heutige Kaufkraft' : 'nominal'} · Summen der Sparphase nominal`;
  $('#who').innerHTML = `<table><thead><tr><th></th>${cols.map(c => `<th>${c < 0 ? 'Haushalt' : esc(P[c].name)}</th>`).join('')}</tr></thead><tbody>${lines.map(([l, f, sub]) => `<tr${sub ? ' style="border-top:2px solid var(--line-2)"' : ''}><td class="txt">${l}</td>${cols.map(c => `<td>${f(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function renderCharts() {
  if (!R) return;
  if (chartScen === 'O' && !R.simO) chartScen = 'B';
  const sim = simOf(chartScen), others = ['A', 'B', 'O'].filter(k => k !== chartScen && simOf(k));
  const C1 = cssv('--s1'), C2 = cssv('--s2'), C3 = cssv('--s3'), C4 = cssv('--s4'), C5 = cssv('--s5'), C6 = cssv('--s6'), C7 = cssv('--s7'), C8 = cssv('--s8'), CA = cssv('--sA'), ink = cssv('--ink'), surf = cssv('--surface');
  const years = sim.rows.map(r => r.year);
  // Einheitlicher Stil: Flächen mit dünner Kante und geringer Deckkraft, Summenlinien 2 px, Entnahmestart als gestrichelte Linie
  const area = (name, data, color, stack) => ({ name, type: 'line', stack, symbol: 'none', data, lineStyle: { width: 1, color }, itemStyle: { color }, areaStyle: { color, opacity: 0.25 } });
  const total = (name, data, extra = {}) => ({ name, type: 'line', symbol: 'none', data, lineStyle: { width: 2, color: ink }, itemStyle: { color: ink }, ...extra });
  const wLine = ws => ({ markLine: { symbol: 'none', silent: true, data: [{ xAxis: String(ws) }], lineStyle: { color: cssv('--ink-3'), type: [2, 3] }, label: { formatter: 'Entnahme', color: cssv('--ink-2'), position: 'end' } } });
  // Feste Produktfarben in allen Charts: gesetzliche Rente C1, Altersvorsorgedepot C2, ETF C3, Basisrente C7, private RV C4.
  // Reihenfolgen mit validate_palette geprüft, auch wenn einzelne Produkte fehlen.
  const PC = { grv: C1, avd: C2, etf: C3, basis: C7, prv: C4 };
  const on = k => sim.rows.some(r => V(r, k) > 0);   // Serie nur zeigen, wenn das Produkt genutzt wird
  const scC = k => cssv(SCN_C[k]);
  const bar = (name, data, color, stack = 's') => ({ name, type: 'bar', stack, data, itemStyle: { color, borderColor: surf, borderWidth: 1, borderRadius: 0 }, barMaxWidth: 18, emphasis: { focus: 'series' } });
  const ws = sim.wStartYear;
  const who = chartPerson >= 0 ? ST.I.persons[chartPerson].name : 'Haushalt';
  $('#wealth-sub').textContent = `${who} · Entnahme ab ${ws} · ${realLabel()}`;
  renderWho(sim);

  // Vermögen
  chartOf('ch-wealth').setOption(baseOpt({
    xAxis: { ...baseOpt().xAxis, data: years },
    series: [
      ...(on('prv') ? [area('Private RV', sim.rows.map(r => dv(r, V(r, 'prv'))), PC.prv, 'w')] : []),
      area(chartPerson >= 0 ? 'ETF-Depot (Hälfte)' : 'ETF-Depot', sim.rows.map(r => dv(r, V(r, 'etf'))), PC.etf, 'w'),
      ...(on('avd') ? [area('Altersvorsorgedepot', sim.rows.map(r => dv(r, V(r, 'avd'))), PC.avd, 'w')] : []),
      ...(on('basis') ? [area('Basisrente', sim.rows.map(r => dv(r, V(r, 'basis'))), PC.basis, 'w')] : []),
      ...(sim.rows.some(r => r.debt > 0) ? [area('Restschuld Haus', sim.rows.map(r => -dv(r, V(r, 'debt'))), C8, 'd')] : []),
      total('Nettovermögen', sim.rows.map(r => dv(r, V(r, 'netWorth'))), wLine(ws)),
      ...others.map(k => ({ name: 'Nettovermögen ' + SCN[k], type: 'line', symbol: 'none', data: simOf(k).rows.map(r => dv(r, V(r, 'netWorth'))), lineStyle: { width: 2, type: [6, 4], color: scC(k) }, itemStyle: { color: scC(k) } })),
    ],
  }), true);

  // Kapital je ETF-Sparplan
  const FC = FUND_C.map(cssv);
  const share = chartPerson >= 0 ? 1 / ST.I.persons.length : 1;
  const fundsCfg = ST.I.depot.funds;
  $('#funds-sub').textContent = `${who} · ${chartPerson >= 0 ? 'Hälfte des gemeinsamen Depots · ' : ''}${realLabel()}`;
  chartOf('ch-funds').setOption(baseOpt({
    xAxis: { ...baseOpt().xAxis, data: years },
    tooltip: { ...baseOpt().tooltip, formatter: ps => {
      const vis = ps.filter(p => p.seriesIndex < fundsCfg.length && p.value > 0.5);
      const tot = vis.reduce((a, p) => a + p.value, 0);
      return vis.length ? tip(ps[0].axisValue, [...tipSeries(vis), tipRow('Summe', tot, true)]) : `<b>${ps[0].axisValue}</b><br>Depot leer`;
    } },
    series: [...fundsCfg.map((f, k) => area(f.name, sim.rows.map(r => dv(r, (r.funds[k] || 0) * share)), FC[k], 'f')),
      total('Summe', sim.rows.map(r => dv(r, sum(r.funds) * share)), wLine(ws))],
  }), true);

  // Vorsorgeprodukte: Kapital je Person (Flächen) und Einzahlungen (Linie)
  {
    const P = ST.I.persons, PPC = [cssv('--s1'), cssv('--s2')];
    const k = chartScen === 'A' ? 'B' : chartScen, avdSim = simOf(k);   // nur ETF hat keine Vorsorgeprodukte
    const idx = chartPerson >= 0 ? [chartPerson] : P.map((_, i) => i);
    $('#avd-sub').textContent = `${SCN[k]} · ${chartPerson >= 0 ? P[chartPerson].name : 'Haushalt'} · Altersvorsorgedepot, Basisrente und private RV · ${realLabel()}`;
    let cum = 0;
    const paidIn = avdSim.rows.map(r => { cum += dv(r, idx.reduce((a, i) => a + r.pp[i].avdIn + r.pp[i].zul + r.pp[i].basisIn + r.pp[i].prvIn, 0)); return cum; });   // jede Einzahlung in der Kaufkraft ihres Jahres
    chartOf('ch-avd').setOption(baseOpt({
      xAxis: { ...baseOpt().xAxis, data: avdSim.rows.map(r => r.year) },
      series: [
        ...idx.map(i => area(P[i].name, avdSim.rows.map(r => dv(r, r.avd[i] + r.basis[i] + r.prv[i])), PPC[i], 'a')),
        { name: chartPerson >= 0 ? 'Einzahlungen inkl. Zulagen' : 'Gemeinsame Einzahlungen inkl. Zulagen', type: 'line', symbol: 'none', data: paidIn, lineStyle: { width: 2, type: [6, 4], color: cssv('--ink-2') }, itemStyle: { color: cssv('--ink-2') }, ...wLine(avdSim.wStartYear) },
      ],
    }), true);
  }

  // Sparen
  const sr = sim.rows.filter(r => r.saveMonths > 0);
  chartOf('ch-save').setOption(withLegend(baseOpt({
    xAxis: { ...baseOpt().xAxis, data: sr.map(r => r.saveMonths < 12 ? `${r.year} (${r.saveMonths} Mon.)` : r.year) },
    tooltip: { ...baseOpt().tooltip, formatter: ps => tip(ps[0].axisValue, [...tipSeries(ps), tipSum(ps)]) },
    // Reihenfolge und Farben: Kredit C6, Sondertilgung CA, Steuern C8, private RV, ETF, Basisrente, AVD, Zulagen C1
    series: [
      ...(on('loanPay') ? [bar('Kreditrate', sr.map(r => dv(r, Math.min(V(r, 'loanPay') - V(r, 'loanSonder'), V(r, 'budget')))), C6)] : []),
      ...(on('loanSonder') ? [bar('Sondertilgung', sr.map(r => dv(r, V(r, 'loanSonder'))), CA)] : []),
      bar('Steuern auf Fondserträge', sr.map(r => dv(r, V(r, 'taxFromBudget'))), C8),
      ...(on('prvIn') ? [bar('Private RV', sr.map(r => dv(r, V(r, 'prvIn'))), PC.prv)] : []),
      bar('ETF-Sparrate', sr.map(r => dv(r, V(r, 'etfContrib') - V(r, 'avdReinvest'))), PC.etf),
      ...(on('basisIn') ? [bar('Basisrente', sr.map(r => dv(r, V(r, 'basisIn'))), PC.basis)] : []),
      ...(on('avdIn') ? [bar('Altersvorsorgedepot', sr.map(r => dv(r, V(r, 'avdIn'))), PC.avd), bar('Zulagen', sr.map(r => dv(r, V(r, 'zul'))), C1)] : []),
    ],
  })), true);

  // Einkommen
  // Monatswerte der Entnahmemonate; angebrochene Jahre sind an der Achse markiert
  const er = sim.rows.filter(r => r.wMonths > 0);
  const m = (r, v) => dv(r, v) / r.wMonths;
  const wYear = r => r.wMonths < 12 ? `${r.year} (${r.wMonths} Mon.)` : r.year;
  chartOf('ch-income').setOption(withLegend(baseOpt({
    xAxis: { ...baseOpt().xAxis, data: er.map(wYear) },
    tooltip: { ...baseOpt().tooltip, formatter: ps => { const b = ps.filter(p => p.seriesType === 'bar'); return tip(ps[0].axisValue, [...tipSeries(b), tipSum(b), ...tipSeries(ps.filter(p => p.seriesType !== 'bar'))]); } },
    series: [
      ...(on('prvPayW') ? [bar('Private RV', er.map(r => m(r, V(r, 'prvPayW'))), PC.prv)] : []),
      bar('Gesetzliche Rente', er.map(r => m(r, V(r, 'grvW'))), PC.grv),
      ...(on('avdPayW') ? [bar('Altersvorsorgedepot', er.map(r => m(r, V(r, 'avdPayW'))), PC.avd)] : []),
      bar(chartPerson >= 0 ? 'ETF-Verkauf (Hälfte)' : 'ETF-Verkauf', er.map(r => m(r, V(r, 'etfSale'))), PC.etf),
      ...(on('basisPayW') ? [bar('Basisrente', er.map(r => m(r, V(r, 'basisPayW'))), PC.basis)] : []),
      { name: 'Netto', type: 'line', symbol: 'circle', symbolSize: 4, data: er.map(r => m(r, V(r, 'net'))), lineStyle: { width: 2, color: ink }, itemStyle: { color: ink } },
    ],
  })), true);

  // Abzüge
  chartOf('ch-deduct').setOption(baseOpt({
    xAxis: { ...baseOpt().xAxis, data: er.map(wYear) },
    tooltip: { ...baseOpt().tooltip, formatter: ps => tip(ps[0].axisValue, [...tipSeries(ps), tipSum(ps)]) },
    series: [
      bar('Einkommensteuer + Soli', er.map(r => m(r, V(r, 'estW'))), C5),
      bar('Kapitalertragsteuer', er.map(r => m(r, V(r, 'kapTaxW'))), C6),
      bar('Kranken- und Pflegeversicherung', er.map(r => m(r, V(r, 'kvW'))), CA),
    ],
  }), true);

  // Vergleich
  const ab = s => s.rows.filter(r => r.wMonths > 0).map(r => m(r, V(r, 'estW') + V(r, 'kapTaxW') + V(r, 'kvW')));
  chartOf('ch-compare').setOption(baseOpt({
    xAxis: { ...baseOpt().xAxis, data: R.simA.rows.filter(r => r.wMonths > 0).map(wYear) },
    series: ['A', 'B', 'O'].filter(simOf).map(k => ({ name: SCN[k], type: 'line', symbol: 'none', data: ab(simOf(k)), lineStyle: { width: 2, color: scC(k) }, itemStyle: { color: scC(k) } })),
  }), true);

  renderTable(sim);
  if (MC) renderMC();
}

function renderTable(sim) {
  const e = (r, k) => eur(dv(r, V(r, k)));
  const cols = [
    ['Jahr', r => r.year], ['Phase', r => r.phase], ['Alter', r => chartPerson >= 0 ? r.ages[chartPerson] : r.ages.join(' / ')],
    ['ETF-Sparrate', r => e(r, 'etfContrib')], ['AVD-Beitrag', r => e(r, 'avdIn')], ['Zulagen', r => e(r, 'zul')], ['Erstattung', r => e(r, 'refund')],
    ['Basis-Beitrag', r => e(r, 'basisIn')], ['Erstattung Basis', r => e(r, 'basisRefund')], ['PRV-Beitrag', r => e(r, 'prvIn')],
    ['Rente', r => e(r, 'grv')], ['AVD-Auszahlung', r => e(r, 'avdPay')], ['Basisrente', r => e(r, 'basisPay')], ['PRV-Rente', r => e(r, 'prvPay')], ['PRV-Kapital', r => e(r, 'lump')], ['ETF-Verkauf', r => e(r, 'etfSale')],
    ['ESt + Soli', r => e(r, 'est')], ['Kapitalertragst.', r => e(r, 'kapTax')], ['KV/PV Rente', r => e(r, 'kv')],
    ['Netto/Monat', r => r.net ? eur(dv(r, V(r, 'net')) / r.wMonths) : '–'], ['ETF-Depot', r => e(r, 'etf')], ['AVD', r => e(r, 'avd')], ['Basisrente', r => e(r, 'basis')], ['Priv. RV', r => e(r, 'prv')],
    ['Kredit/Jahr', r => e(r, 'loanPay')], ['Restschuld', r => e(r, 'debt')], ['Nettovermögen', r => e(r, 'netWorth')],
  ];
  $('#tbl').innerHTML = `<table><thead><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${sim.rows.map(r => `<tr class="ph-${r.phase}">${cols.map(c => `<td>${c[1](r)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function runMC() {
  const b = $('#btn-mc'); b.disabled = true; MC = null;
  const variants = [{ key: 'A', I: ST.I, scenario: 'A' }, { key: 'B', I: ST.I, scenario: 'B' }, ...(OPT ? [{ key: 'O', I: applyPatch(ST.I, OPT.patch), scenario: 'B' }] : [])];
  monteCarlo(ST.I, ST.A, { runs: ST.A.mcRuns, seed: MC_SEED, variants }, p => { $('#mc-bar').style.width = (p * 100).toFixed(0) + '%'; }, r => { b.disabled = false; MC = r; renderMC(); });
}
function renderMC() {
  const r = MC, qs = [0.1, 0.25, 0.5, 0.75, 0.9];
  const surf = cssv('--surface');
  const P = Object.fromEntries(r.keys.map(k => [k, qs.map(q => pct(r.res[k], q))]));
  const list = f => r.keys.map(k => `<b class="num">${f(k)}</b> (${SCN[k]})`).join(', ');
  const best = r.keys.reduce((a, k) => P[k][0] > P[a][0] ? k : a, r.keys[0]);
  $('#mc-out').innerHTML = `<p>In 9 von 10 Verläufen reicht ein Netto von mindestens ${list(k => eur(P[k][0]))} pro Monat. Der typische Verlauf (50 %) trägt ${list(k => eur(P[k][2]))}. Am besten abgesichert ist <b>${SCN[best]}</b>. Das Netto aus der festen Rechnung wäre in ${list(k => pc(r.fail[k] / r.runs, 0))} der Verläufe nicht durchzuhalten. Schwankungen kosten: Bei gleicher typischer Rendite trägt ein schwankender Verlauf weniger als gleichmäßiges Wachstum, weil Verluste vor allem in der Entnahme durch Verkäufe zu niedrigen Kursen dauerhaft fehlen. Lebenslange Renten aus Versicherungen schwanken in der Entnahme nicht mehr.</p>`;
  chartOf('ch-mc-dist').setOption(baseOpt({
    title: { text: 'Tragbares Netto pro Monat', textStyle: { fontSize: 12, color: cssv('--ink-2'), fontWeight: 600 }, right: 0, top: 0 },
    xAxis: { ...baseOpt().xAxis, data: ['10 %', '25 %', '50 %', '75 %', '90 %'] },
    series: r.keys.map(k => ({ name: SCN[k], type: 'bar', data: P[k], itemStyle: { color: cssv(SCN_C[k]), borderRadius: [4, 4, 0, 0], borderColor: surf, borderWidth: 1 }, barMaxWidth: 26 })),
  }), true);
  const key = r.keys.includes(chartScen) ? chartScen : 'B';
  const fan = r.fan[key];
  const n = fan[0].length;
  const band = q => Array.from({ length: n }, (_, t) => pct(fan.map(f => f[t]), q));
  const p10 = band(0.1), p25 = band(0.25), p50 = band(0.5), p75 = band(0.75), p90 = band(0.9);
  const col = cssv(SCN_C[key]);
  chartOf('ch-mc-fan').setOption(baseOpt({
    title: { text: `Vermögen beim festen Netto · ${SCN[key]}`, textStyle: { fontSize: 12, color: cssv('--ink-2'), fontWeight: 600 }, right: 0, top: 0 },
    legend: { show: false },
    tooltip: { ...baseOpt().tooltip, formatter: ps => { const i = ps[0].dataIndex; return tip(r.years[i], [['90 %', p90], ['75 %', p75], ['50 %', p50], ['25 %', p25], ['10 %', p10]].map(([l, a]) => tipRow(l, a[i]))); } },
    xAxis: { ...baseOpt().xAxis, data: r.years },
    series: [
      { name: 'b', type: 'line', stack: 'f', symbol: 'none', data: p10, lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 } },
      { name: '10–25', type: 'line', stack: 'f', symbol: 'none', data: p25.map((v, i) => v - p10[i]), lineStyle: { opacity: 0 }, areaStyle: { color: col, opacity: 0.15 } },
      { name: '25–75', type: 'line', stack: 'f', symbol: 'none', data: p75.map((v, i) => v - p25[i]), lineStyle: { opacity: 0 }, areaStyle: { color: col, opacity: 0.32 } },
      { name: '75–90', type: 'line', stack: 'f', symbol: 'none', data: p90.map((v, i) => v - p75[i]), lineStyle: { opacity: 0 }, areaStyle: { color: col, opacity: 0.15 } },
      { name: '50 %', type: 'line', symbol: 'none', data: p50, lineStyle: { width: 2, color: col } },
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
  try { ST = loadState(JSON.parse($('#io-text').value)); save(); renderPanels(); recalc(); $('#io-msg').textContent = 'Übernommen.'; }
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
renderPanels();
recalc();
try { const t = +localStorage.getItem(STORE_KEY + '-tab'); if (t > 0) $$('.tab')[t].click(); } catch (e) { }
// Hinweis nur für die laufende Sitzung ausblenden, beim nächsten Öffnen ist er wieder da
try { if (sessionStorage.getItem(STORE_KEY + '-disclaimer')) $('#disclaimer').hidden = true; } catch (e) { }
$('#disclaimer-close').onclick = () => { $('#disclaimer').hidden = true; try { sessionStorage.setItem(STORE_KEY + '-disclaimer', '1'); } catch (e) { } };
