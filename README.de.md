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

## Sprachen

Die Oberfläche gibt es auf Deutsch und Englisch. Englisch ist die
Quellsprache, Deutsch kommt aus `po/de.po`; die Sprache folgt der
Desktop-Locale, im Applet gibt es keinen Umschalter. Die Übersetzungen werden
bei der Installation nach `~/.local/share/locale` kompiliert, im Repository
liegen keine erzeugten Dateien.

Für eine weitere Sprache `po/de.po` nach `po/<sprache>.po` kopieren, die
`msgstr`-Werte übersetzen und die `msgfmt`-Schleife aus der Installation erneut
ausführen (`xgettext`/`msgmerge` erzeugen die String-Liste nach Änderungen neu).

## Installation

```bash
git clone git@gitlab.maeli.net:ravel/cinnamon-applets.git
cd cinnamon-applets/relay-switches@ravel

# Applet-Dateien
install -d ~/.local/share/cinnamon/applets/relay-switches@ravel
install -m 644 metadata.json applet.js settings-schema.json icon.png \
        ~/.local/share/cinnamon/applets/relay-switches@ravel/

# Übersetzungen (braucht gettext)
for po in po/*.po; do
    lang="$(basename "$po" .po)"
    install -d "$HOME/.local/share/locale/$lang/LC_MESSAGES"
    msgfmt -o "$HOME/.local/share/locale/$lang/LC_MESSAGES/relay-switches@ravel.mo" "$po"
done

# optional: CLI
install -Dm 755 relayctl ~/.local/bin/relayctl
```

Cinnamon neu laden, danach Rechtsklick auf die Leiste → **Applets** →
**Relay Switches**:

```bash
dbus-send --session --dest org.Cinnamon --object-path /org/Cinnamon \
  --type=method_call org.Cinnamon.Eval string:'global.reexec_self()'
```

Für einen anderen Benutzer auf demselben Rechner, inklusive der eigenen
Schalter:

```bash
sudo install -d -o USER -g USER ~USER/.local/share/cinnamon/applets/relay-switches@ravel \
    ~USER/.config/cinnamon/spices/relay-switches@ravel
sudo install -o USER -g USER -m 644 metadata.json applet.js settings-schema.json icon.png \
    ~USER/.local/share/cinnamon/applets/relay-switches@ravel/
sudo install -o USER -g USER -m 644 \
    ~/.config/cinnamon/spices/relay-switches@ravel/relay-switches@ravel.json \
    ~USER/.config/cinnamon/spices/relay-switches@ravel/
```

Die Einstellungsdatei wird unverändert kopiert; Cinnamon behält die Werte und
passt die Datei beim ersten Start des Applets an das installierte Schema an.

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
       ~/.local/share/locale/*/LC_MESSAGES/relay-switches@ravel.mo
rm -f  ~/.local/bin/relayctl            # nur wenn die CLI installiert wurde
```

## Hinweise

- Benötigt Cinnamon 5.8 oder neuer, getestet auf 6.6.
- HTTP-Anfragen laufen über `curl` (asynchron, ohne Shell).
- Symbolische Symbolnamen enden auf `-symbolic` und folgen der Leistenfarbe.
- Nach Änderungen an den Applet-Dateien Cinnamon neu laden (Alt+F2, `r`, Enter).
