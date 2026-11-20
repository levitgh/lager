# Lager

Lagerverwaltung für die Euroboxen im Keller: 2 Regale mit je 10 Fächern
(Fach 1 links unten, Fach 2 rechts unten, dann weiter nach oben).

- Pro Box: Name, Gegenstände mit **Soll** (gehört rein) und **Ist** (ist drin)
- Status auf einen Blick: komplett, fehlt, falsch einsortiert
- Suche über alle Boxen, Übersicht „Fehlt“
- Boxen verschieben/tauschen, Gegenstände in andere Box verschieben
- Läuft auf iPhone, iPad und Laptop, auch vom Home-Bildschirm

## Daten

Alle Daten liegen in `data.json` in diesem Repository. Die App liest und
schreibt die Datei über die GitHub-API, dadurch sind alle Geräte synchron.

Zum **Bearbeiten** braucht jedes Gerät einmalig ein Token:

1. github.com → Settings → Developer settings → Personal access tokens →
   **Fine-grained tokens** → Generate new token
2. Repository access: **Only select repositories** → `lager`
3. Permissions → Repository permissions → **Contents: Read and write**
4. Token in der App unter Einstellungen (Regler-Symbol oben rechts) eintragen

Ohne Token ist die App nur lesbar. Das Repository ist öffentlich, also ist
auch der Inhalt der Boxen öffentlich einsehbar.

## Installation auf dem iPhone

Seite in Safari öffnen → Teilen → **Zum Home-Bildschirm**.
