# Vorsorgeplan

*Stand: 22.10.2026, 18:06 Uhr · Rechtsstand 20.10.2026*

Ein Rechner für die private Altersvorsorge in Deutschland. Er vergleicht zwei Wege für dasselbe Sparbudget:

- **Szenario A:** alles in ein normales ETF-Depot
- **Szenario B:** zuerst ins neue staatlich geförderte Altersvorsorgedepot (ab 2027), der Rest ins ETF-Depot

Gerechnet wird für einen Haushalt mit zwei Personen, von heute bis zum gewählten Zielalter. Steuern, Kranken- und Pflegeversicherung, gesetzliche Rente und Immobilienkredite sind eingerechnet. Ergebnis ist das höchste monatliche Netto im Ruhestand in heutiger Kaufkraft, das bis zum Zielalter reicht.

Die Seite ist eine einzelne HTML-Datei. Sie läuft komplett im Browser, lädt nichts von fremden Servern nach und speichert Eingaben nur lokal im Browser.

## Nutzung

- **Online:** über GitHub Pages dieses Repositorys
- **Offline:** Die Datei `vorsorgeplan-<version>.html` aus dem neuesten Release herunterladen und im Browser öffnen.

Eingaben lassen sich über „Eingaben sichern / laden“ als Text kopieren und auf einem anderen Gerät wieder einfügen.

## Was der Rechner abbildet

**Haushalt**
- Zwei Personen, angestellt oder selbständig, mit eigener Einkommensentwicklung
- Gesetzliche Rente über Entgeltpunkte oder die Prognose der Renteninformation, mit Abschlag bzw. Zuschlag bei früherem oder späterem Rentenbeginn
- Krankenversicherung im Alter: KVdR mit automatischer Prüfung der 9/10-Regel, freiwillig gesetzlich oder privat
- Beliebig viele Kinder mit Kindergeld, Kinderfreibetrag, Kinderzulage und Pflegeversicherungs-Abschlag
- Sparbudget mit jährlicher Steigerung, beliebig viele Annuitätendarlehen mit Zinsbindung, Sondertilgung, Anschlussfinanzierung oder Ablösung aus dem Depot

**Anlage**
- Altersvorsorgedepot je Person: Grundzulage, Kinderzulage, Sonderausgabenabzug mit Günstigerprüfung, ungeförderte Zusatzbeiträge, Auszahlungsplan, Einmalauszahlung bis 30 %
- ETF-Depot mit bis zu fünf gestaffelten Sparplänen, FIFO je Fonds, Vorabpauschale, Teilfreistellung, Ausschüttungen, Sparerpauschbetrag und Verlustverrechnung

**Auswertung**
- Kennzahlen A gegen B, Aufteilung nach Personen, Charts zu Vermögen, Fonds, Altersvorsorgedepot, Sparraten, Einkommen und Abzügen
- Optimierer für die Einstellungen des Altersvorsorgedepots
- Monte-Carlo-Simulation mit zufälligen Renditen und Inflation
- Break-even-Zins für die Anschlussfinanzierung
- Jahrestabelle

## Rechtsstand und Annahmen

| Bereich | Stand im Rechner | Status |
|---|---|---|
| Einkommensteuer | Tarif 2026, Entwurf 2027/2028, danach mit Inflation fortgeschrieben (abschaltbar) | Gesetz / Entwurf / Annahme |
| Altersvorsorgedepot | Altersvorsorgereformgesetz, BGBl. 2026 I Nr. 156, ab 01.01.2027 | Gesetz |
| Rentenbesteuerung | Besteuerungsanteil nach Wachstumschancengesetz | Gesetz |
| Kapitalerträge | Abgeltungsteuer, Teilfreistellung, Vorabpauschale mit Basiszins 3,20 % (2026) | Gesetz |
| Gesetzliche Rente | Rentenwert 42,52 € ab 01.07.2026, Haltelinie bis 2031, danach Dämpfung (einstellbar) | Gesetz / Annahme |
| Krankenversicherung | BBG 2026/2027, Zusatzbeitrag 2,9 % mit einstellbarem Anstieg | Gesetz / Annahme |

Offene Punkte:
- Ob freiwillig Versicherte Beiträge auf Auszahlungen aus dem Altersvorsorgedepot zahlen, ist gesetzlich nicht ausdrücklich geregelt. Der Rechner folgt der Praxis bei Riester.
- Tarif, Beitragssätze und Rentenanpassung nach 2028 sind Annahmen.
- Die Frühstart-Rente ist nicht eingerechnet.

Die Gesetzeswerte stehen in `src/law.js` (Steuern) und `src/sim.js` (Sozialversicherung). Sie müssen jährlich aktualisiert werden.

## Entwicklung

Voraussetzung ist Node.js ab Version 20. Es gibt keine Abhängigkeiten.

```
node test/run-tests.mjs    # Rechenproben
node scripts/build.mjs     # baut dist/index.html
```

Aufbau:

| Datei | Inhalt |
|---|---|
| `src/law.js` | Einkommensteuertarif, Soli, Kinder, Kapitalertragsteuer, Besteuerungsanteil |
| `src/depot.js` | ETF-Depot mit Tranchen und Altersvorsorgedepot |
| `src/loans.js` | Annuitätendarlehen |
| `src/sim.js` | Jahressimulation, Sozialversicherung, gesetzliche Rente |
| `src/analysis.js` | Maximales Netto, Optimierer, Monte Carlo, Break-even |
| `src/defaults.js` | Beispielhaushalt und Annahmen |
| `src/ui.js`, `src/page.html` | Oberfläche |
| `vendor/`, `fonts/` | Apache ECharts und Schriftarten, werden beim Build eingebettet |

## Releases

Releases entstehen automatisch:

1. Version in `package.json` erhöhen, zum Beispiel auf `1.1.0`
2. Auf `main` pushen

Der Workflow legt den Tag `v1.1.0` an und hängt die fertige HTML-Datei an das Release. Ein manuell gepushter Tag `v*` funktioniert ebenfalls. Jeder Push auf `main` aktualisiert außerdem die GitHub-Pages-Seite.

GitHub Pages einmalig einschalten: Settings → Pages → Source: „GitHub Actions“.

## Hinweis

Der Rechner ist eine Modellrechnung und keine Steuer-, Rechts- oder Anlageberatung. Alle Angaben ohne Gewähr.

## Lizenz

MIT. Eingebettet sind Apache ECharts (Apache License 2.0) sowie die Schriftarten Public Sans und JetBrains Mono (SIL Open Font License 1.1).
