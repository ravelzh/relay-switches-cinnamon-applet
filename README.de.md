# Relay Switches — Cinnamon-Applet

[English](README.md)

Applet für die Leiste, das HTTP-Relaisboards schaltet (Steckdosen,
Kaffeemaschine, Drucker, …). Ein Klick öffnet ein Menü mit den konfigurierten
Schaltern und liest den echten Zustand vom Board zurück.

![Menü](docs/screenshot.png)

## Funktionen

- Beliebig viele Schalter mit eigenem Namen, Symbol, Hosts und Pfaden.
- Mehrere Hosts pro Schalter werden gemeinsam geschaltet (z. B. eine
  Steckdosenleiste auf zwei Boards).
- Gruppen fassen mehrere Schalter zu einem zusätzlichen Schalter zusammen.
- Echter Status: der Status-Pfad wird gelesen, statt den Zustand zu raten.
- Symbol in der Leiste, optional Zähler (`2/4`) oder die Namen der aktiven Schalter.
- Regelmäßige Statusabfrage, optional Benachrichtigung, wenn ein Gerät nicht antwortet.
- CLI `relayctl` für Scripts, Hotkeys und Cron — nutzt dieselbe Konfiguration, ohne Cinnamon.
- Oberfläche auf Deutsch und Englisch.

## Installation

```bash
git clone git@gitlab.maeli.net:ravel/cinnamon-applets.git
cd cinnamon-applets/relay-switches@ravel
./install.sh --panel --cli --reload
```

Ohne `--panel` das Applet über Rechtsklick auf die Leiste → **Applets**
hinzufügen. `--cli` installiert `relayctl` nach `~/.local/bin`, `--reload` lädt
Cinnamon neu.

Für einen anderen Benutzer auf demselben Rechner (inklusive eigener
Einstellungen und Leisten-Eintrag):

```bash
sudo ./install.sh --for BENUTZER --panel --cli --settings
```

Die Übersetzungen werden bei der Installation aus `po/*.po` nach
`~/.local/share/locale` kompiliert; im Repository liegen keine erzeugten Dateien.

## Konfiguration

Rechtsklick auf das Applet → **Konfigurieren**.

| Seite | Optionen |
| --- | --- |
| Schalter | Name, Symbol, Host(s), Ein-/Aus-/Status-Pfad pro Schalter; Gruppen |
| Leiste | Text neben dem Symbol, Symbol, Symbol wenn etwas an ist |
| Verhalten | Abfrageintervall, Benachrichtigungen, HTTP-Zeitlimit, Mittelklick |

Ein Schalter braucht nur Name und Host — die Pfade sind standardmäßig
`/relay?state=1`, `/relay?state=0` und `/relay`.

```
Name       Symbol              Host(s)          Ein   Aus   Status
Kaffee     coffee-symbolic     192.168.1.50     -     -     -
Media      audio-speakers      TV, Verstärker   -     -     -
```

Mehrere Hosts werden mit Komma getrennt, erlaubt sind IP-Adressen oder URLs
(`http://board.local:8080`). Gruppen stehen auf derselben Seite und verweisen
auf Schalternamen; eine Gruppe ist an, wenn alle Mitglieder an sind.

![Einstellungen](docs/settings.png)

## Status-Format

Die Antwort des Status-Pfads darf JSON sein (`{"on": true}`), ein reiner Wert
(`true`, `false`, `1`, `0`, `on`, `off`) oder ein JSON-Objekt mit einem der
Schlüssel `on`, `state`, `relay`, `power`, `status`. Antwortet ein Host nicht
oder liefert etwas Unbekanntes, gilt der Schalter als *offline*; schalten lässt
er sich trotzdem.

## CLI

`relayctl` liest die Konfiguration, die das Applet nach
`~/.config/cinnamon/spices/relay-switches@ravel/switches.json` exportiert:

```bash
relayctl list
relayctl status
relayctl on Kaffee
relayctl off Media
relayctl toggle Drucker
relayctl all-off
```

Namen werden zuerst exakt, dann als eindeutiger Teilstring gesucht;
Gruppennamen funktionieren genauso. Rückgabewert ist `1`, wenn ein Gerät nicht
erreichbar war.

## Deinstallation

```bash
rm -rf ~/.local/share/cinnamon/applets/relay-switches@ravel \
       ~/.config/cinnamon/spices/relay-switches@ravel \
       ~/.local/share/locale/*/LC_MESSAGES/relay-switches@ravel.mo \
       ~/.local/bin/relayctl
```

## Hinweise

- Benötigt Cinnamon 5.8 oder neuer, getestet auf 6.6.
- HTTP-Anfragen laufen über `curl` (asynchron, ohne Shell).
- Symbolische Symbolnamen enden auf `-symbolic` und folgen der Leistenfarbe.
- Nach Änderungen an den Applet-Dateien Cinnamon neu laden (Alt+F2, `r`, Enter).
