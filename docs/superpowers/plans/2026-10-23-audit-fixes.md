# Audit-Befunde beheben – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Ziel:** Alle Befunde des Audits vom 23.10.2026 beheben (toter Code, DRY/SOLID/KISS/YAGNI, Testlücken, fachliche Fehler), ohne dass sich Ergebnisse ungewollt verschieben.

**Architektur:** Zuerst ein Golden-Master-Test, der die heutigen Ergebnisse auf ±1 € festhält. Danach folgen Umbauten, die nichts an den Ergebnissen ändern dürfen, gegen genau diesen Test. Die fachlichen Korrekturen ändern Ergebnisse bewusst: Jede von ihnen zieht die Sollwerte einzeln nach und begründet die Richtung der Änderung. Die großen Strukturumbauten (Produkttabelle, `simulate` aufteilen) kommen zuletzt und müssen ebenfalls ergebnisneutral sein.

**Tech Stack:** Vanilla-JS ohne Module, globaler Scope, Node ≥ 20 für Tests und Build, ECharts in der UI.

**Spec:** Audit-Bericht im Chat vom 23.10.2026. Die Befunde stehen als Anhang am Ende dieses Plans, jeweils mit Verweis auf den Task.

## Global Constraints

- Code, Kommentare, UI-Texte und Commit-Texte auf Deutsch, im Stil des umgebenden Codes: dichte Einzeiler, kurze Namen, Kommentare mit Paragrafen.
- Keine Abhängigkeiten, kein `npm install`. Prüfen mit `node test/run-tests.mjs`, bauen mit `node scripts/build.mjs`.
- Engine-Dateien dürfen keine Browser-APIs nutzen. Eine neue Engine-Datei muss in **beiden** Listen ergänzt werden, in `scripts/build.mjs` (`ENGINE`) und in `test/run-tests.mjs`.
- Neue Eingabefelder brauchen einen Standardwert in `src/defaults.js`, neue Auswahlfelder einen Eintrag in `ENUMS`.
- Text aus Eingaben in `innerHTML` immer mit `esc()` ausgeben.
- **Commits nur nach ausdrücklicher Freigabe durch den Nutzer** (CLAUDE.md). Am Ende jeder Phase steht daher ein Checkpoint statt eines Commits. Commits gehen direkt auf `main`.
- Ein ergebnisneutraler Task gilt erst als fertig, wenn der Golden Master **unverändert** grün ist. Sollwerte dürfen nur die Tasks 12–15 ändern.
- Handybreite 390 px ohne horizontales Scrollen, falls sich die UI ändert (Tasks 5, 7, 11, 17, 19).

## Review Focus

1. **Alte gespeicherte Stände laden:** `localStorage` oder Export mit entfernten Feldern (z. B. `kinderzulage`) oder ohne neue Felder müssen ohne Fehler laden und Standardwerte bekommen. Test in Task 3.
2. **Rentenbeginn in der ersten oder zweiten Jahreshälfte:** Beginnt die Rente im Juli statt im Januar, darf das Netto nicht springen. `maxNet` über `bm` 1…12 muss gleichmäßig verlaufen. Test in Task 2, nach Task 13 erneut.
3. **AVD-Vertrag kürzer als 12 Jahre:** Wer bei Vertragsbeginn schon älter ist, z. B. Jahrgang 1965 mit Auszahlung ab 65, bekommt keine Hälftelung. Test in Task 12.
4. **Selbständige ohne RV-Pflicht:** Sie bekommen keinen RV-Vorsorgeabzug und keine Kürzung des Höchstbetrags. Selbständige mit Pflicht bekommen beides. Test in Task 15.
5. **Haushalt ohne Kinder, PKV und `fixedNet` mit `depleted`:** Diese Pfade laufen ohne `NaN` durch. Sie stehen im Golden Master (Task 1) und in den Strategie-Tests (Task 2).

---

## Phase 0 – Sicherheitsnetz

### Task 1: Golden Master

**Files:**
- Modify: `test/run-tests.mjs:1-15` (Helfer), `test/run-tests.mjs:39-47` (Block 5)

**Interfaces:**
- Produces: im vm-Kontext `mk(f)` liefert `{ I, A }` als tiefe Kopien von `DEFAULTS`/`ASSUME`, `f(I, A)` passt sie an. In `run-tests.mjs` die Konstante `GOLD` (Name → Sollwert in €) und die Funktion `gold(name, wert)`, die mit ±1 € prüft. Die Tasks 12–15 ändern nur `GOLD`.

- [ ] **Schritt 1: Helfer im vm-Kontext anlegen.** Direkt nach dem Laden der Engine-Dateien:

```js
vm.runInContext(`function mk(f) { const I = JSON.parse(JSON.stringify(DEFAULTS)), A = JSON.parse(JSON.stringify(ASSUME)); if (f) f(I, A); return { I, A }; }`, ctx);
const mn = (patch, scen = 'B') => g(`(() => { const { I, A } = mk(${patch || 'null'}); return maxNet(I, A, '${scen}'); })()`);
```

- [ ] **Schritt 2: Varianten festlegen und heutige Werte messen.** Varianten als Funktions-Strings für `mk`:

| Name | Patch `(I, A) => …` | Szenario | Richtwert laut Audit |
|---|---|---|---|
| `baseA` | – | A | 9.080 |
| `baseB` | – | B | 9.401 |
| `perpetual` | `I.withdraw.strategy = 'perpetual'` | B | 7.716 |
| `pkv` | `I.persons.forEach(p => p.kvdr = 'pkv')` | B | 9.041 |
| `freiwillig` | `I.persons.forEach(p => p.kvdr = 'nein')` | B | – |
| `noDraft` | `A.useDraft = false` | B | 8.541 |
| `kinderlos` | `I.children = []` | B | 9.364 |
| `avdNone` | `I.persons.forEach(p => p.avd.refundTo = 'none')` | B | 9.320 |
| `avdExtra` | `I.persons.forEach(p => p.avd.extra = 3000)` | B | – |
| `basisSame` / `basisEtf` / `basisNone` | `I.persons[0].basis.on = true; I.persons[0].basis.beitrag = 6000; I.persons[0].basis.refundTo = 'same'\|'etf'\|'none'` | B | 8.293 / 8.624 / 8.025 |
| `prvKapital` | `I.persons[1].prv.on = true; I.persons[1].prv.mode = 'kapital'` | B | – |
| `prvKapital61` | wie `prvKapital`, dazu `I.persons[1].prv.payStart = 61` | B | – |
| `selfRv` | `I.persons[0].job = 'self'; I.persons[0].rvPflicht = true` | B | – |
| `self` | `I.persons[0].job = 'self'; I.persons[0].rvPflicht = false` | B | – |
| `saveLast` | `I.saveUntil = 'last'; I.persons[1].retireAge = 64` | B | – |
| `bm7` | `I.persons.forEach(p => p.bm = 7)` | B | – |
| `loanTeil` | `I.loans = [{ name: 'T', amount: 300000, eff: 0.035, startY: 2026, startM: 1, monthly: 1350, freeMonths: 0, fixBalBank: 0, fixEndY: 2036, fixEndM: 1, sonder: 0, sonderFrom: 2026, sonderTo: 2035, after: 'teil', zins: 0.04, years: 20, teil: 50000 }]` | B | – |

Zusätzlich für `baseB` bei `targetReal = maxNet`: die Werte `startReal`, `finalReal`, `sumZulagen` und `sumRefunds` aus `simulate`.

Messen: einmal alle Werte mit `console.log` ausgeben, die gerundeten Zahlen als `GOLD = { baseA: …, … }` übernehmen. Weicht ein Wert mit Richtwert um mehr als 2 € davon ab, anhalten und den Nutzer fragen.

- [ ] **Schritt 3: Block 5 umstellen.** Die Prüfung `Netto plausibel` durch `gold('baseA', r.nA)` und `gold('baseB', r.nB)` ersetzen. Danach eine Schleife über alle Varianten mit `gold(name, mn(patch, scen))`. Die Ausgabezeile „Beispielhaushalt …“ bleibt erhalten.

- [ ] **Schritt 4: Prüfen.** `node test/run-tests.mjs` meldet 0 fehlgeschlagen. Gegenprobe: in `ASSUME.ret` vorübergehend 0.0701 eintragen, dann müssen `gold`-Prüfungen scheitern. Danach zurücksetzen.

### Task 2: Tests für ungetestete Pfade (heutiges Verhalten festhalten)

**Files:**
- Modify: `test/run-tests.mjs` (neue Blöcke 12–19)

**Interfaces:**
- Consumes: `mk`, `mn`, `gold` aus Task 1.

- [ ] **Schritt 1: Block 12, Entnahmestrategien.**
  - perpetual: `s.finalReal >= s.startReal - 1` bei `targetReal = maxNet`, und `maxNet(perpetual) < maxNet(realConst)`.
  - fixedNet = 2500: in Entnahmejahren mit `!shortfall` ist `row.net ≈ 2500 · wMonths · priceIdx` (±1).
  - fixedNet = 20000: `depleted === true` und `depletedYear` liegt zwischen `wStartYear` und `endYear`.
- [ ] **Schritt 2: Block 13, `refundTo`-Matrix für AVD.**
  - `same`: Im Jahr nach einer Erstattung steigt `avdIn` um höchstens `einMax`.
  - `etf`: `etfContrib(etf) > etfContrib(same)` im Folgejahr.
  - `none`: `finalReal(none) < finalReal(same)`.
  - `sumRefunds` ist in allen drei Fällen gleich (±1 % wegen des anderen zvE).
- [ ] **Schritt 3: Block 14, Monatsgenauigkeit.**
  - `monthsIn(2030, 2030*12+3, Infinity) === 9`
  - `retireStartAbs({ by: 1997, retireAge: 67, bm: 3 }) === 2064*12 + 3`
  - Mit `saveUntil = 'last'` und unterschiedlichen Rentenbeginnen gibt es ein Jahr mit `saveMonths > 0 && wMonths > 0`.
  - `grvW === grv · Anteil` je Person.
  - Gleichmäßigkeit: `maxNet` für `bm = 1…12` (beide Personen); kein Sprung zwischen Nachbarn größer als 3 %.
- [ ] **Schritt 4: Block 15, Depot.** Fonds mit `price 100`, `ter 0`, `tf 0.3`:
  - `depotYear`: Vorabpauschale = `min(p0·bz·0,7, p1−p0+D) − D` je Anteil, Zwölftelung `vpFracNew` bei neuer Tranche.
  - `depotSell` FIFO: Tranchen cost 50 bzw. 90 mit vp 10, Kurs 100, Verkauf 150 € ⇒ `gain = 50`, `taxable = 35`.
- [ ] **Schritt 5: Block 16, `kapTax`.** Verlustvortrag größer als Ertrag ⇒ `newLoss > 0, tax 0`. Mit `pb = 1000` wird nur 1.000 abgezogen. Günstigerprüfung bei kleinem `zvEOther` ⇒ `guenstiger === true`.
- [ ] **Schritt 6: Block 17, Darlehen.**
  - `freeMonths = 12` ⇒ im ersten Jahr `pay ≈ Zins`.
  - `fixBalBank` setzt die Restschuld beim Ende der Zinsbindung.
  - `after: 'teil'` ⇒ `payoff === teil`.
  - `loanPreview(c).end` liegt nach `fixEnd`.
- [ ] **Schritt 7: Block 18, Fortschreibung.**
  - `tariffFor(2035, { useDraft: true, indexTariff: true, inflation: 0.02 }).idx ≈ 1.02^7`
  - `tariffFor(2027, { useDraft: false, … }).p === LAW.tariff[2026]`
  - `idxVal(SV.bbgRV, 2030, 0.03) ≈ 106200·1.03^3`
  - `rwFor`: ab 2032 kleineres Wachstum als bis 2031.
- [ ] **Schritt 8: Block 19, KV der Rentner und AVD.**
  - KVdR (`kvdr: 'ja'`): In jedem Entnahmejahr ist `pp[i].kv` in Szenario A und B gleich (±0,01). Auszahlungen aus dem AVD lösen nach § 237 SGB V keine Beiträge aus.
  - Freiwillig (`kvdr: 'nein'`): In einem Jahr mit `avdPay[i] > 0` ist `kv` in B höher als bei KVdR.
- [ ] **Schritt 9: Block 20, Monte Carlo (asynchron, eigener Kontext).**
  - Zweiten Kontext `{ console, Math, JSON, setTimeout, Date }` anlegen.
  - `rng(1)` liefert zweimal dieselbe Folge.
  - `pct([1,2,3,4], 0.5) === 2.5`
  - `makePaths(3, 10, ASSUME, 7)` ist deterministisch.
  - `monteCarlo` mit `runs: 3`: `onDone` liefert `res.A.length === 3`. Dafür ein `await new Promise(...)` vor der Abschlusszeile. `optimize` bleibt ungetestet (≈ 10 s, über `optStart`/`optFinish`/`applyPatch` abgedeckt).
- [ ] **Schritt 10: Prüfen.** `node test/run-tests.mjs` ist grün, Laufzeit unter 30 s.

### Task 3: Reine UI-Helfer in die Engine verschieben und testen

**Files:**
- Create: `src/state.js`
- Modify: `src/ui.js:4-33` (entfernen), `scripts/build.mjs:12`, `test/run-tests.mjs:9`, `CLAUDE.md` (Lade-Reihenfolge)

**Interfaces:**
- Produces (global): `STORE_KEY`, `clone(o)`, `esc(v)`, `deepMerge(base, over)`, `loanTpl(y)`, `ENUMS`, `conform(base, val, key)`, `TPL_I`, `loadState(p) → { I, A }`.
- Neue Lade-Reihenfolge: `law, depot, insurance, loans, sim, defaults, state, analysis`.

- [ ] **Schritt 1: Tests schreiben (Block 21).**
  - `esc('<a href="x">\'&')` ergibt `'&lt;a href=&quot;x&quot;&gt;&#39;&amp;'`.
  - `loadState({ I: { persons: [{ avd: { kinderzulage: true } }], budget: { monthly: '1200' } }, A: { optMode: 'xyz' } })` ergibt:
    - `I.budget.monthly === 1200`
    - `A.optMode === 'fast'`
    - `I.persons[0].avd.eigen === 1800`
    - `I.children[0].zulageTo === 0`
  - `loadState({})` ist gleich `{ I: DEFAULTS, A: ASSUME }` (JSON-Vergleich).
- [ ] **Schritt 2: Laufen lassen.** Erwartet: FEHLER „loadState is not defined“.
- [ ] **Schritt 3: Verschieben.** Die Zeilen 4–33 aus `ui.js` unverändert nach `src/state.js` verschieben, mit Kopfkommentar im Stil der anderen Dateien. `state` in beide Listen nach `defaults` eintragen.
- [ ] **Schritt 4: Prüfen.** Tests grün. `node scripts/build.mjs`, Seite über `python3 -m http.server 8765` in `dist/` öffnen. Die Seite lädt, es gibt keine Konsolenfehler, Export und Import funktionieren.

**Checkpoint Phase 0:** Nutzer um Commit-Freigabe bitten (Vorschlag: „Tests: Golden Master, ungetestete Pfade, UI-Helfer in state.js“).

---

## Phase 1 – Toter Code (ergebnisneutral)

### Task 4: Toter Code in der Engine

**Files:**
- Modify: `src/sim.js`, `src/depot.js`, `src/loans.js`, `src/law.js`, `src/insurance.js`, `src/ui.js:503` (Rechtsstand-Zeile), `CLAUDE.md`

- [ ] **Schritt 1: Entfernen.**
  - `solveMaxNet` (`sim.js:583-595`) und `avdPayout` (`depot.js:154-161`).
  - Den KVdR-Zweig `A.kvAvdKvdr` (`sim.js:387-390`). Begründung für den Kommentar: Nach § 237 SGB V zählen bei KVdR-Pflichtversicherten nur Rente, Versorgungsbezüge (§ 229) und Arbeitseinkommen. Das AVD gehört zur privaten Vorsorge und steht nicht im Katalog des § 229. Bei der betrieblichen Altersversorgung nimmt § 229 Abs. 1 Nr. 5 Altersvorsorgevermögen nach § 92 EStG sogar ausdrücklich aus.
- [ ] **Schritt 2: Rechtsstand-Zeile anpassen** (`ui.js:503`). Sie lautet dann: `['Altersvorsorgedepot', 'KVdR beitragsfrei, freiwillig Versicherte zahlen Beiträge', 'G', '§§ 237, 229 SGB V', 'https://www.gesetze-im-internet.de/sgb_5/__237.html']`. In `ui.js:591` den Satz zur offenen KV-Frage auf freiwillig Versicherte beschränken (das bleibt richtig).
- [ ] **Schritt 3: Ungelesene Felder entfernen.** Für jedes Feld vorher `grep -rn "<feld>" src test` ausführen und nur bei 0 Lesern löschen:
  - `sim.js`:
    - `const [S, W]`
    - `minNetRatio`, `sumVP`, `sumKapTax`, `sumLumpTax` samt Aufsummierung
    - die Zeilenfelder `etfCost`, `loanInterest` (mit `loanInterest`-Akkumulation in Zeile 233/237), `grvTaxable`, `zvE`, `guenstiger`, `vp`, `dist`, `target`, `shortfall` und `R` (in `row`-Init Zeile 185)
    - `SV.base`
  - `depot.js`: `totalIn` und in `makeAVD` `contribF`, `refunds`, `planEnd`, `startBal`, `done` (`zulagen` und `uCost` behalten, falls gelesen).
  - `loans.js`: `postEnd`.
  - `law.js`: `teilfreistellungAktien`.
  - `INS.basisMinAge` und `AVD.payMin/payMax/planEndMin/teilMax` **nicht** löschen, Task 7 nutzt sie.
- [ ] **Schritt 4: Kleinigkeiten in `sim.js`.**
  - `(p => p)(…)` (313) direkt zuweisen.
  - `else if (… 'fixedNet')` (434) zu `else` machen.
  - `soliOf` in `incomeTax` (65) einmal berechnen.
  - `pvRate` einmal je Jahr nach `childless` berechnen und in 218, 221 und 376 nutzen. Achtung: Zeile 218 nutzt `L.pv / 2`, nicht `L.pv`. Deshalb nur `pvZu = -pvAb + (childless ? SV.pvKinderlos : 0)` herausziehen.
  - `polCap()` und die Vermögenssumme am Ende (572-573) einmal berechnen.
- [ ] **Schritt 5: CLAUDE.md.** Den Satz zu `solveMaxNet` streichen. `applyPatch` liegt in `analysis.js`, nicht in der UI.
- [ ] **Schritt 6: Prüfen.** Tests grün, Golden Master unverändert. Build läuft, die Seite lädt ohne Konsolenfehler.

### Task 5: Toter Code in UI und CSS

**Files:**
- Modify: `src/ui.js`, `src/page.html`

- [ ] **Schritt 1: Entfernen.**
  - `ui.js:38` (`loans || []`) und `ui.js:39` (Migration `zulageTo`).
  - `?? 1` in `ui.js:346` und `sim.js:278`. Dort `c.zulageTo` direkt nutzen, der Standardwert ist 0 und `conform` setzt ihn.
  - `out.ms` und `t0` (`ui.js:114, 125`).
  - `|| 200` (`ui.js:946`) und `ui.js:1016`.
- [ ] **Schritt 2: `renderWho`.** Die dritte Spalte wird zum Boolean `sub` (`true` statt `'sub'`, sonst weglassen). Die Abfrage in Zeile 800 entsprechend anpassen.
- [ ] **Schritt 3: CSS.** `.grid-3`, `.pill.bad`, `.hl` und `.neg` löschen. `--bad`/`--bad-soft` in allen **drei** Theme-Blöcken löschen, nachdem `grep -n "\-\-bad" src` außerhalb der Definitionen 0 Treffer liefert.
- [ ] **Schritt 4: Prüfen.**
  - Tests grün, Build läuft.
  - Im Browser alle drei Reiter, hell und dunkel, ohne Konsolenfehler.
  - Mit 390 px ist `scrollWidth === 390`.
  - Einen alten Export mit `kinderzulage` laden: er lädt ohne Fehler (deckt Review Focus 1 ab).

**Checkpoint Phase 1:** Commit-Freigabe einholen („Toten Code entfernt“).

---

## Phase 2 – DRY und Gesetzeswerte an einer Stelle (ergebnisneutral)

### Task 6: Gesetzestabellen jahresweise auflösen (`lawPick`)

**Files:**
- Modify: `src/law.js:19-23, 31-39`, `src/sim.js:15-20, 28-45`
- Test: `test/run-tests.mjs` (Block 18 ergänzen)

**Interfaces:**
- Produces: `lawPick(table, year, useDraft = true) → { y, v }`. Liefert den letzten Eintrag mit Jahr ≤ `year`, oder den ersten Eintrag, wenn `year` davor liegt. Einträge mit `st === 'E'` werden übersprungen, wenn `useDraft` falsch ist. Ein Eintrag ist entweder eine Zahl (gilt als `'G'`) oder `{ v | Felder…, st }`. `v` ist der ganze Eintrag oder die Zahl.
- Changed: `LAW.pausch.anPausch = { 2026: 1230, 2027: { v: 1430, st: 'E' } }`.

- [ ] **Schritt 1: Tests.**
  - `lawPick({ 2026: 1, 2027: { v: 2, st: 'E' } }, 2030, false).v === 1`
  - Dasselbe mit `true` ergibt `.v === 2` und `.y === 2027`.
  - `lawPick(LAW.tariff, 2025).y === 2026`
- [ ] **Schritt 2: Implementieren** in `law.js`.
- [ ] **Schritt 3: Aufrufer umstellen.**
  - `tariffFor` nutzt `lawPick`. `idx` bleibt wie bisher.
  - `idxVal` nutzt `lawPick(table, year).y`.
  - In `lawYear` die Kinderwerte über `lawPick(LAW.kinder, year, A.useDraft)` holen (`kIdx` wie bisher ab dem gefundenen Jahr, solange `year > y`).
  - `anPausch` wird `lawPick(LAW.pausch.anPausch, year, A.useDraft).v · kIdx`. `kIdx` bleibt bewusst wie heute, damit das Ergebnis gleich bleibt.
- [ ] **Schritt 4: Prüfen.** Tests grün, Golden Master unverändert, insbesondere `noDraft`.

### Task 7: Grenzen aus `AVD`/`INS` ableiten (Optimierer und UI)

**Files:**
- Modify: `src/analysis.js:45-49`, `src/ui.js:197, 420-425, 452, 456, 487-518`

**Interfaces:**
- Consumes: `AVD` (`fMax`, `g1Cap`, `einMax`, `payMin`, `payMax`, `planEndMin`, `teilMax`), `INS.basisMinAge`, `INS.halfAge`, `SV.rw`, `idxVal(INS.hb, …)`, `LAW.*`.
- Produces: `OPT_SPACE` mit denselben Werten wie heute.

- [ ] **Schritt 1: Test.** `JSON.stringify(OPT_SPACE)` gleich dem heutigen Literal (als Erwartungswert in den Test kopieren).
- [ ] **Schritt 2: `OPT_SPACE` ableiten.**
  - `eigen`: `[0, AVD.g1Cap, AVD.fMax / 2, AVD.fMax]`
  - `extra`: Drittel von `AVD.einMax − AVD.fMax`
  - `payStart`: `AVD.payMin…AVD.payMax`
  - `payEnd`: `[AVD.planEndMin, 88, 91, 95, 100]`
  - `teilkapital`: `[0, AVD.teilMax]`
  - Basisrente `payStart`: `[INS.basisMinAge, 65, 67, 70]`
- [ ] **Schritt 3: UI.**
  - `avdCard`: `max`, Hinweistexte, Teilkapital-Optionen (in 0,1-Schritten bis `AVD.teilMax`) sowie `yearOpts(AVD.payMin, AVD.payMax)` und `yearOpts(AVD.planEndMin, 100)`.
  - `basisCard`: `yearOpts(INS.basisMinAge, 70)` und der Höchstbetrag im Hinweis aus `idxVal(INS.hb, 2026, 0)`.
  - `ui.js:197`: Rentenwerte aus `SV.rw`.
  - `legalTable`: die Zahlen in den Zeilen aus `LAW`, `SV`, `AVD` und `INS` mit `eur`/`pc` formatieren. Dazu gehören Grundfreibetrag, Kinderwerte, Sparer-Pauschbetrag, Basiszins, Zulagen, Höchstbeträge, Rentenwert, BBG und Pflegebeitrag. Reiner Erklärtext bleibt Text.
- [ ] **Schritt 4: Prüfen.** Tests grün, Golden Master unverändert. Im Browser zeigen Rechtsstand-Tabelle und Hinweise dieselben Zahlen wie vorher (Vorher/Nachher-Vergleich nach CLAUDE.md, Text per `diff` der extrahierten Tabellen).

### Task 8: Doppelte Rechnungen in `sim.js` und benannte Annahmen

**Files:**
- Modify: `src/sim.js`

**Interfaces:**
- Produces:
  - `taxablePension(gross, startYear, year, st)`: `st` ist ein Objekt `{ fb: null }` je Rente. Erstes Jahr `gross · ba`, danach wird der Freibetrag festgeschrieben.
  - `earnedTaxable(p, w, L)`: steuerpflichtiges Erwerbseinkommen einer Person.
  - In `SV`: `kgAbzug: 0.04` (§ 10 Abs. 1 Nr. 3 S. 4 EStG, Abschlag bei Anspruch auf Krankengeld).
  - Modulkonstante `REINVEST_ABZUG = 0.3` (Annahme: Steuer und SV auf Auszahlungen vor Entnahmestart).

- [ ] **Schritt 1: `taxablePension`** für die gesetzliche Rente (`203-209`) und die Basisrente (`350-353`) nutzen. Die Freibetrags-Halter sind `renteFB[i]` und `q.fb`.
- [ ] **Schritt 2: `earnedTaxable`** in `zvEBase` (314) und `taxBase` (534) nutzen.
- [ ] **Schritt 3: Konstanten verwenden.** `0.96` durch `1 − SV.kgAbzug` ersetzen, `0.3` (495) durch `REINVEST_ABZUG`. `51 * f` bleibt bis Task 14.
- [ ] **Schritt 4: Prüfen.** Tests grün, Golden Master unverändert.

### Task 9: Analyse und Darlehen

**Files:**
- Modify: `src/analysis.js`, `src/loans.js`, `src/ui.js:677, 946`

**Interfaces:**
- Produces:
  - `horizonYears(I)`
  - `chunked(next, onStep, onDone) → { cancel() }`: `next()` führt einen Schritt aus und liefert `false`, wenn er fertig ist. Die Funktion läuft in 60-ms-Häppchen über `setTimeout`.
  - `monteCarlo(...)` liefert jetzt `{ cancel() }`.
  - `makeLoanState(c)`
  - Konstanten `OPT_SEED = 11`, `MC_SEED = 7`.

- [ ] **Schritt 1:** `JSON.parse(JSON.stringify(…))` in `analysis.js` durch `clone` ersetzen (aus `state.js`, das vor `analysis` geladen wird).
- [ ] **Schritt 2:** `horizonYears` in `optimize` und `monteCarlo` nutzen.
- [ ] **Schritt 3: `chunked` einführen** und in `optimize` und `monteCarlo` verwenden. Die vorab nötigen `maxNet`-Aufrufe in `monteCarlo` (149) werden zum ersten Schritt von `next`, statt die UI synchron zu blockieren. `onStep` bekommt weiter `k / runs`.
- [ ] **Schritt 4:** In `ui.js:677` übernimmt der Button „Optimum übernehmen“ das Ergebnis mit `ST.I = applyPatch(ST.I, OPT.patch)`.
- [ ] **Schritt 5:** `makeLoanState` in `makeLoans` und `loanPreview` nutzen.
- [ ] **Schritt 6: Prüfen.**
  - Tests grün, Golden Master unverändert, der Monte-Carlo-Test aus Block 20 grün.
  - Im Browser: Monte Carlo mit 100 Läufen und der Optimierer im schnellen Modus laufen bis zum Ende, Abbrechen funktioniert.

### Task 10: Build robust machen

**Files:**
- Modify: `scripts/build.mjs:29-35`, `src/page.html` (Footer)

- [ ] **Schritt 1:** In `page.html` die Versionsnummer als Platzhalter `{{VERSION}}` eintragen: `keine Steuer- oder Anlageberatung · Version {{VERSION}}`.
- [ ] **Schritt 2:** Helfer `sub(page, needle, repl)` einführen. Er bricht mit `throw new Error('Platzhalter fehlt: ' + needle)` ab, wenn `needle` nicht vorkommt. Alle `.replace`-Aufrufe, `{{VERSION}}` und `<header class="top">` darüber laufen lassen. `{{TITLE}}` behält `replaceAll`, prüft aber, dass der Platzhalter vorkommt.
- [ ] **Schritt 3: Prüfen.**
  - `node scripts/build.mjs` läuft, im Footer steht „Version x.y.z“.
  - Gegenprobe: `/*UI*/` vorübergehend umbenennen, dann bricht der Build mit Exit-Code 1 ab. Danach zurücksetzen.

### Task 11: Kleine Wiederholungen in der UI

**Files:**
- Modify: `src/ui.js`

**Interfaces:**
- Produces:
  - `PROD` wird `{ avd: { name, short }, … }` (`short`: `AVD`, `Basisrente`, `private RV`). Alle Leser von `PROD[k]` auf `PROD[k].name` umstellen.
  - Helfer `fact(l, v)` auf Modulebene.
  - `commit()` = `save(); renderPanels(); scheduleRecalc();`
  - `dv(r, v)` auf Modulebene.
  - `realLabel()` liefert `'in heutiger Kaufkraft' | 'nominal'`.
  - `FUND_C = ['--s1', …, '--s5']`.

- [ ] **Schritt 1:** `PROD` mit Kurznamen. Die Ternaries in 140 und 173 durch `PROD[k].short` ersetzen.
- [ ] **Schritt 2:** `fact` überall in `renderFacts` nutzen (312, 330, 355, 380).
- [ ] **Schritt 3:** `commit()` in den sechs Click-Handlern nutzen (277-284, 593, 596).
- [ ] **Schritt 4:** `dv` (774, 806, 929), `realLabel()` (799, 821, 842, 859) und `FUND_C` (475, 839) zusammenführen. In `V()` die Fälle `avd`, `avdIn`, `grv`, `avdPay`, `grvW` und `avdPayW` in `PERS_ARR` aufnehmen.
- [ ] **Schritt 5: Prüfen.**
  - Tests grün, Build läuft.
  - Im Browser alle Reiter und Charts, dazu Personenauswahl, die Umschalter für Kaufkraft und Nominal und die Kennzahlen mit Kurznamen.
  - Mit 390 px kein horizontales Scrollen.

**Checkpoint Phase 2:** Commit-Freigabe einholen („Gesetzeswerte an einer Stelle, Wiederholungen zusammengeführt“).

---

## Phase 3 – Fachliche Korrekturen (ändern Sollwerte bewusst)

Jeder Task endet so:
1. Tests laufen lassen. Die geänderten `gold`-Prüfungen zeigen die neuen Werte.
2. Prüfen, ob die Richtung der Änderung zur Erwartung passt.
3. `GOLD` anpassen, mit Kommentar `// Task N: <Grund>, <alt> → <neu>`.
4. In den Tests ist danach außer den erwarteten `gold`-Werten nichts rot.

### Task 12: Hälftelung beim ungeförderten AVD-Topf

**Files:**
- Modify: `src/depot.js:135-173`, `src/sim.js:250-260, 324-339`, `src/ui.js` (Rechtsstand-Zeile 502)
- Test: `test/run-tests.mjs`

**Interfaces:**
- Produces:
  - `makeAVD()` bekommt `startAbs: null` (absoluter Monat des ersten Beitrags).
  - `avdWithdraw(a, pay, half = false)`: Bei `half` ist nur die Hälfte des Unterschiedsbetrags aus dem ungeförderten Topf steuerpflichtig.
  - `avdHalf(a, payAbs, P)`: `true`, wenn `payAbs − a.startAbs ≥ INS.halfYears · 12` und das Alter beim Auszahlungsbeginn ≥ `INS.halfAge` ist. Rechtsgrundlage: § 22 Nr. 5 S. 2 c EStG verweist auf § 20 Abs. 1 Nr. 6 S. 2.

- [ ] **Schritt 1: Tests.**
  - Unit-Test: AVD mit `uv = 10000`, `uCost = 6000`, `fv = 0`; `avdWithdraw(a, 1000, true).taxable ≈ 200`, ohne `half` ≈ 400.
  - Review Focus 3: `by = 1965`, AVD ab 2027, `payStart = 65` (2030). In keinem Auszahlungsjahr ist der steuerpflichtige Betrag halbiert. Das lässt sich über `simulate(...).rows` mit `detail` prüfen: Der Vergleich zu `half = false` ergibt dasselbe Netto.
- [ ] **Schritt 2: Laufen lassen.** Der Unit-Test scheitert.
- [ ] **Schritt 3: Implementieren.**
  - `startAbs` beim ersten Jahr mit `avdIn[i].m > 0` setzen, auf den Monat `max(2027·12, Y0·12)`.
  - In `avdPay` (sim.js 334/337) `avdHalf(...)` mit dem Auszahlungsbeginn `s0` übergeben.
- [ ] **Schritt 4: Rechtsstand-Zeile 502 ergänzen.** „Ungeförderter Teil: nur Ertrag, nach 12 Jahren und ab 62 zur Hälfte“, Status `'G'`, Fundstelle `§ 22 Nr. 5 S. 2 c EStG`.
- [ ] **Schritt 5: Sollwerte.** Erwartung: Nur `avdExtra` steigt, alle anderen Werte bleiben gleich, weil im Standard `extra = 0` ist. `GOLD` anpassen.

### Task 13: Rentenwert gilt ab 1. Juli

**Files:**
- Modify: `src/sim.js:10, 22-27, 39, 197-202`, `src/ui.js` (Hinweis 197, Rechtsstand)
- Test: `test/run-tests.mjs`

**Interfaces:**
- Produces:
  - `rwJul(y, A)`: Rentenwert ab 1.7. des Jahres `y`. Aus `SV.rw`, solange ein Eintrag vorhanden ist, danach mit `A.wageGrowth − (y > SV.halteBis ? A.rentenDaempfung : 0)` fortgeschrieben.
  - `SV.halteBis = 2031` ersetzt das Literal.
  - `grvYear(e, zf, year, fromAbs, A)`: Summe der Monatsrenten im Jahr. Die Monate Januar bis Juni im Zeitraum werden mit `rwJul(year − 1)` bewertet, die Monate Juli bis Dezember mit `rwJul(year)`.
  - Das Feld `L.rw` entfällt. Wer es noch liest, nutzt `rwJul`.

- [ ] **Schritt 1: Tests.**
  - `rwJul(2026, ASSUME) === 42.52` und `rwJul(2025, ASSUME) === 40.79`.
  - Für die ganze Jahresrente 2026 bei 1 EP und Zugangsfaktor 1 gilt `grvYear(1, 1, 2026, 0, ASSUME) ≈ 6·40.79 + 6·42.52`.
  - Rentenbeginn im Oktober: nur Monate zu `rwJul(year)`.
- [ ] **Schritt 2: Laufen lassen.** Die Tests scheitern.
- [ ] **Schritt 3: Implementieren** und in `grv` (197-202) nutzen.
- [ ] **Schritt 4: Review Focus 2.** Den Test „`bm` 1…12 gleichmäßig“ aus Task 2 erneut laufen lassen, er muss grün bleiben.
- [ ] **Schritt 5: Sollwerte.** Erwartung: Alle Werte sinken leicht, die gesetzliche Rente fällt um etwa 1–2 %. `GOLD` anpassen.

### Task 14: Kleinkorrekturen (KV-Abzug, Sparer-Pauschbetrag, Status 2027)

**Files:**
- Modify: `src/sim.js:6-9, 394, 477-484`, `src/ui.js` (Rechtsstand 512, 515), `README.md` (Rechtsstand-Tabelle, „Stand“-Zeile)

- [ ] **Schritt 1: KV-Abzug.** `- 51 * f` in `sim.js:394` streichen. Für die Beitragsbemessung freiwillig Versicherter gibt es keinen Werbungskostenabzug (§ 240 SGB V, Beitragsverfahrensgrundsätze Selbstzahler).
- [ ] **Schritt 2: Sparer-Pauschbetrag bei Kapitalauszahlung ohne Hälftelung.**
  - Test: Bei `prvKapital61` ist die Steuer gleich `max(0, tx − pbRest) · 0,25 · 1,055`. Dabei ist `pbRest = LAW.sparerPB − min(pb, max(0, kapT − lossCarry))`.
  - `pbRest` aus `ev` bestimmen: `kapTax` liefert dafür zusätzlich `pbUsed`.
  - Der bestehende Test „ohne Hälftelung Abgeltungsteuer“ (Block 8) wird auf `pbRest` angepasst.
- [ ] **Schritt 3: Status 2027.**
  - Die SV-Werte 2027 in `sim.js` als `{ v, st: 'E' }` kennzeichnen. `idxVal` nutzt `lawPick(…, useDraft)` aus Task 6. Für die SV gilt `useDraft = true`, damit sich das Ergebnis nicht ändert, das Kennzeichen dokumentiert nur. Kommentar: „Kabinett 7.10.2026, Bundesrat ausstehend“.
  - Rechtsstand in UI und README in eine Zeile 2026 (`G`) und eine Zeile 2027 (`E`) aufteilen.
  - README-„Stand“ auf 23.10.2026 setzen.
- [ ] **Schritt 4: Sollwerte.** Erwartung: `freiwillig` sinkt minimal (ohne Abzug steigen die KV-Beiträge). `prvKapital61` steigt leicht. Alle anderen Werte bleiben gleich. `GOLD` anpassen.

### Task 15: RV-Beitragssatz jahresweise, Höchstbetrag abgeleitet, Selbständige

**Files:**
- Modify: `src/sim.js:4-13, 211-223, 307-310`, `src/insurance.js:15`, `src/ui.js` (Rechtsstand 504-505), `README.md`
- Test: `test/run-tests.mjs`

**Interfaces:**
- Produces:
  - `SV.rvSatz = { 2026: 0.186, 2027: { v: 0.186, st: 'E' }, 2028: { v: 0.199, st: 'A' } }` (Wert für 2028 siehe Schritt 1).
  - `SV.bbgKn = { 2026: 124800, 2027: { v: 130800, st: 'E' } }`.
  - `SV.knAufschlag = 0.061` (Beitragssatz der knappschaftlichen RV minus allgemeiner Satz).
  - `L.rvSatz`, `L.bbgKn` in `lawYear`.
  - `hbFor(L) = Math.ceil(L.bbgKn · (L.rvSatz + SV.knAufschlag))` (§ 10 Abs. 3 S. 1 EStG: Höchstbeitrag zur knappschaftlichen RV).
  - `SV.rvAN` entfällt, stattdessen gilt `L.rvSatz / 2`. `INS.hb` entfällt.

- [ ] **Schritt 1: Werte belegen.** Den RV-Beitragssatz ab 2028 im Rentenversicherungsbericht 2026 (Bundesregierung/DRV) nachschlagen. Lässt sich 19,9 % dort nicht finden, `2028` weglassen, dann gilt 18,6 % fortgeschrieben. Den Fund dem Nutzer melden.
- [ ] **Schritt 2: Tests.**
  - `hbFor` ergibt 2026 30.826 und 2027 32.308.
  - Review Focus 4:
    - `selfRv` hat im ersten Jahr einen höheren Vorsorgeabzug als `self`. Vergleichsgröße ist `zvE`, also das zvE des Jahres über einen Prüfwert, nicht über ein Zeilenfeld. Alternativ `basisDed` über eine Basisrente mit 30.000 €.
    - Bei `selfRv` ist der Höchstbetrag um den vollen RV-Beitrag gekürzt.
    - `self` bleibt unverändert.
- [ ] **Schritt 3: Implementieren.**
  - In `vorsorge` zählen bei `job === 'self' && p.rvPflicht` jetzt `L.rvSatz · min(g, bbgRV)` (der volle Beitrag).
  - `grvBeitr` umfasst für Angestellte `L.rvSatz · …` (Arbeitnehmer- plus Arbeitgeberanteil) und für pflichtversicherte Selbständige ihren vollen Beitrag.
  - `basisDed` nutzt `hbFor(L)` statt `idxVal(INS.hb, …)`. Achtung: Bisher wurde mit `A.wageGrowth` fortgeschrieben, jetzt läuft die Fortschreibung über `bbgKn` mit `w`. Das ist äquivalent, solange der Satz konstant bleibt.
- [ ] **Schritt 4: Rechtsstand und README.** Höchstbetrag 2026 (`G`) und 2027 (`E`) aus `hbFor`. Der RV-Satz bekommt eine eigene Zeile mit Status.
- [ ] **Schritt 5: Sollwerte.** Erwartung:
  - `selfRv` steigt (höherer Abzug, mehr Spielraum für die Basisrente).
  - Ein höherer Satz ab 2028 ändert im Modell nur Vorsorgeabzug und Höchstbetrag, nicht Budget oder Rente. Die übrigen Varianten verschieben sich daher nur um wenige Euro.
  - Die gemessenen Abweichungen dem Nutzer berichten, dann `GOLD` anpassen.

**Checkpoint Phase 3:** Commit-Freigabe einholen. Die neuen Referenzwerte melden, in CLAUDE.md („Referenzwerte Beispielhaushalt“) und im README nachziehen.

---

## Phase 4 – Struktur (ergebnisneutral)

### Task 16: Produkttabelle in der Engine

**Files:**
- Modify: `src/insurance.js:21`, `src/sim.js` (alle `basis`/`prv`-Summen: 269, 309, 358-359, 489, 500, 503-505, 526-527, 543-544, 556-557)

**Interfaces:**
- Produces in `insurance.js`:

```js
// Versicherungsprodukte: Steuer der Rente, Kapitaloption, Sonderausgabenabzug
const POLICY_DEF = {
  basis: { rentTax: 'kohorte', lump: false, deduct: true },
  prv:   { rentTax: 'ertragsanteil', lump: true, deduct: false },
};
const POLICIES = Object.keys(POLICY_DEF);
```

- Produces in `sim.js`:
  - `sumPol(o, f)`: Summe von `f(o[k], k)` über `POLICIES`.
  - Die Pendings `pendPol[i][k]` ersetzen `pendBasis`.
  - `teilOf(cfg, k)` (Teilkapital aus `mode`) wird auch in `ui.js:364` genutzt.
- Zeilenfelder und `pp` behalten **exakt** ihre Namen (`basis`, `prv`, `basisIn`, …), damit sich die UI in diesem Task nicht ändert.

- [ ] **Schritt 1:** `k === 'prv'` (302), `k === 'basis'` (350) und die Erstattung (503-505) über `POLICY_DEF[k]` steuern.
- [ ] **Schritt 2:** Alle ausgeschriebenen `basis + prv`-Summen auf `sumPol` umstellen.
- [ ] **Schritt 3:** Die Zeilen- und `pp`-Felder je Produkt in einer Schleife erzeugen, z. B. `for (const k of POLICIES) { row[k] = …; row[k + 'In'] = …; }`.
- [ ] **Schritt 4: Prüfen.** Tests grün, Golden Master unverändert. Probe: Ein drittes Dummy-Produkt in `POLICY_DEF` (nur lokal, nicht übernehmen) braucht keine weitere Änderung in `sim.js`.

### Task 17: Produkttabelle in der UI

**Files:**
- Modify: `src/ui.js` (PROD, OPT_LAB, PERS_ARR, V, renderWho 783-792, Charts 828-901, renderTable 933-937, Budgettabelle 389-391, paidIn 861)

**Interfaces:**
- Consumes: `PROD[k] = { name, short, color: '--s2'|'--s7'|'--s4', lab: OPT_LAB[k] }` aus Task 11, dazu `POLICIES`.
- Produces: Who-Zeilen, Tabellenspalten, Budgetzeilen und die Vermögens- und Einkommensserien werden je Produkt in Schleifen über `Object.keys(PROD)` erzeugt. **Die Stapelreihenfolgen der Charts bleiben genau wie heute**, weil sie mit der Palettenprüfung abgestimmt sind. Dafür eine feste Liste je Chart, z. B. `ORDER_WEALTH = ['prv', 'etf', 'avd', 'basis']`.

- [ ] **Schritt 1:** `PERS_ARR` aus `PROD`/`POLICIES` erzeugen.
- [ ] **Schritt 2:** `renderWho`, `renderTable` und die Budgettabelle über Schleifen erzeugen.
- [ ] **Schritt 3:** Charts über `ORDER_*`-Listen mit `PC` aus `PROD[k].color` erzeugen.
- [ ] **Schritt 4: Prüfen.**
  - Vorher/Nachher-Vergleich nach CLAUDE.md: `dist/orig.html` gegen den neuen Build. Für Haushalt und Person 1 jeweils Screenshot oder Tooltip-Text jedes Charts vergleichen, mit und ohne Basisrente und private RV. Reihenfolge und Farben sind gleich.
  - Mit 390 px kein horizontales Scrollen. `.playwright-mcp/` danach löschen.

### Task 18: `simulate` aufteilen, `pp` nur bei `detail`

**Files:**
- Modify: `src/sim.js:124-578`

**Interfaces:**
- Produces: `simulate` bleibt die einzige öffentliche Jahressimulation mit derselben Signatur und demselben Rückgabewert. Intern werden benannte Funktionen auf Modulebene ausgelagert. Sie bekommen einen Kontext `ctx` mit dem laufenden Zustand (`depot`, `avd`, `pol`, `ep`, `renteFB`, `kvLump`, `pend*`, `loans` …) und das Jahresobjekt `y` mit `year`, `t`, `L`, `mk`, `priceIdx`, `nKids`, `pvAb` und Ähnlichem:
  - `yearBase(ctx, year) → y`: Markt, Gesetzeswerte, Kinder, PV-Abschlag.
  - `workAndPension(ctx, y)`: Erwerb, Entgeltpunkte, gesetzliche Rente, Vorsorgeaufwendungen.
  - `loansYear(ctx, y)`
  - `contribYear(ctx, y)`: AVD- und Versicherungsbeiträge, `budgetCut`, Zulagen, Zuzahlungen, Ansparen und Verrentung.
  - `payoutsYear(ctx, y)`: AVD-Auszahlung, Versicherungsrenten, KV-Anteile.
  - `kvRetire(ctx, y, kapPerPerson)` und `evalYear(ctx, y, G)`: bisher Closures, jetzt auf Modulebene.
  - `withdrawYear(ctx, y)`: Bisektion für Entnahme und Hausablösung.
  - `refundsAndInvest(ctx, y)`
  - `marketYear(ctx, y)`
  - `buildRow(ctx, y)`: nur bei `opt.detail`, inklusive `pp`.
- `startReal`, `depleted` und der Rest werden außerhalb von `buildRow` berechnet. Sie dürfen nicht von `pp` abhängen.

- [ ] **Schritt 1:** Erst die Closures `kvRetire` und `evalYear` auf Modulebene ziehen und prüfen (Tests und Golden Master).
- [ ] **Schritt 2:** Danach die übrigen Abschnitte einzeln in der Reihenfolge des Codes auslagern. **Nach jedem Abschnitt** Tests und Golden Master laufen lassen.
- [ ] **Schritt 3:** `pp` und `taxBase` nur in `buildRow` berechnen.
- [ ] **Schritt 4: Prüfen.**
  - Tests grün, Golden Master unverändert.
  - Laufzeit: `maxNet(DEFAULTS, ASSUME, 'B')` im node:vm messen, der Wert darf nicht über dem Wert vor dem Umbau liegen (Richtwert ≈ 100 ms). Mit und ohne Umbau messen und berichten.

### Task 19: `renderFacts` und `renderCharts` aufteilen

**Files:**
- Modify: `src/ui.js:295-411, 802-926`

**Interfaces:**
- Produces:
  - `renderFacts()` ruft auf: `factsPersons`, `factsLoans`, `factsLoanInfo`, `factsAvd`, `factsPolicies`, `factsBudget`, `factsFunds`, `factsRefund`.
  - `renderCharts()` ruft auf: `chartWealth`, `chartFunds`, `chartProducts`, `chartSave`, `chartIncome`, `chartDeduct`, `chartCompare`, dazu `renderWho` und `renderTable`.
  - Die gemeinsamen Helfer `area`, `total`, `wLine`, `bar`, `on` und `PC` werden zu Modulhelfern, die `sim` und die Farben als Parameter bekommen. `PC` wird einmal pro `renderCharts` über `chartCtx()` gebaut.

- [ ] **Schritt 1:** `renderFacts` aufteilen.
- [ ] **Schritt 2:** `renderCharts` aufteilen.
- [ ] **Schritt 3: Prüfen.** Wie Task 17, Schritt 4: gleiche Charts, Tooltips und Fakten, hell und dunkel, mit 390 px.

### Task 20: Dokumentation und Abschlussprüfung

**Files:**
- Modify: `CLAUDE.md`, `README.md`

- [ ] **Schritt 1: CLAUDE.md.**
  - Neue Lade-Reihenfolge mit `state`.
  - `lawPick` und Status-Einträge.
  - `POLICY_DEF` und `PROD`.
  - Neue Referenzwerte.
  - Hinweis, dass `GOLD` bei bewusster Ergebnisänderung nachzuziehen ist.
  - Die Teilfunktionen von `simulate`.
  - Checkliste für Gesetzesänderungen ohne `ui.js`, weil die UI-Werte jetzt abgeleitet sind.
- [ ] **Schritt 2: README.** Rechtsstand-Tabelle und „Stand“ prüfen.
- [ ] **Schritt 3: Abschluss.**
  - `node test/run-tests.mjs` ist grün.
  - `node scripts/build.mjs` läuft.
  - Browser-Durchgang über alle Reiter mit Optimierer, Monte Carlo, Export und Import, hell und dunkel, 390 px.
  - `.playwright-mcp/` löschen.
- [ ] **Schritt 4:** Nutzer fragen, ob die Version in `package.json` erhöht werden soll (Release über die CI), und um Commit-Freigabe bitten.

---

## Anhang: Befund → Task

| Befund (Audit) | Task |
|---|---|
| Kein Golden Master, Referenzwerte nur ausgegeben | 1 |
| Ungetestete Pfade: Strategien, `refundTo`, Monatsgenauigkeit, Depot, `kapTax`, KV, Darlehen, Fortschreibung, MC | 2 |
| UI-Helfer (`conform`, `esc`, `deepMerge`) nicht testbar | 3 |
| `solveMaxNet`, `avdPayout`, `kvAvdKvdr`, ungelesene Felder und Konstanten, IIFE, `else if`, doppeltes `soliOf`, `pvRate` dreifach, `polCap` doppelt | 4 |
| UI-Altlasten (Migration, Fallbacks, `out.ms`, Spalte `'n'`), ungenutztes CSS | 5 |
| Jahresauflösung dreifach, `anPausch` hart verdrahtet | 6 |
| `OPT_SPACE` und UI-Grenzen hart verdrahtet, Rechtswerte als UI-Text | 7 |
| Besteuerungsanteil doppelt, Erwerbseinkommen doppelt, magische Zahlen 0,96 und 0,3 | 8 |
| `clone` achtfach, `applyPatch` in der UI umgangen, Horizont doppelt, Chunking doppelt, MC ohne `cancel`, Seeds verstreut, Darlehens-Init doppelt | 9 |
| Build ersetzt lautlos | 10 |
| UI: Kurznamen, Fakt-Template, `commit`, `dv`, Kaufkraft-Label, Fondsfarben, `V()`-Switch | 11 |
| AVD ungefördert ohne Hälftelung | 12 |
| Rentenwert ab 1.1. statt 1.7. | 13 |
| 51-€-Abzug, Sparer-Pauschbetrag bei Kapitalauszahlung, Status der SV-Werte 2027 | 14 |
| `rvAN` fest, Höchstbetrag 2027, RV-pflichtige Selbständige | 15 |
| Open/Closed bei neuen Produkten (Engine) | 16 |
| Open/Closed bei neuen Produkten (UI) | 17 |
| `simulate` monolithisch, `pp` im Hot Path | 18 |
| `renderFacts`/`renderCharts` zu groß | 19 |
| CLAUDE.md veraltet (`solveMaxNet`, `applyPatch`) | 4, 20 |
