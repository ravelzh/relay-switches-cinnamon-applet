# Relay Switches — Cinnamon applet

[Deutsch](README.de.md)

Panel applet for HTTP relay boards (smart sockets, coffee machine, printer, …).
One click opens a menu that switches the configured relays and reads the real
state back from the board.

![Menu](docs/screenshot.png)

## Features

- Any number of switches, each with its own name, icon, hosts and paths.
- Several hosts per switch are switched together (e.g. one power strip on two boards).
- Groups combine several switches into one additional switch.
- Real status: the applet reads the status path instead of assuming the state.
- Panel icon, optional counter (`2/4`) or the names of the active switches.
- Periodic status polling, optional notification when a device does not answer.
- `relayctl` CLI for scripts, hotkeys and cron — same configuration, no Cinnamon needed.
- English and German user interface.

## Languages

The interface is available in English and German. English is the source
language, German comes from `po/de.po`; the language follows the desktop locale,
there is no switch inside the applet. The translations are compiled to
`~/.local/share/locale` during installation, so the repository contains no
generated files.

To add a language, copy `po/de.po` to `po/<language>.po`, translate the
`msgstr` values and run the `msgfmt` loop from the installation again
(`xgettext`/`msgmerge` regenerate the string list after changes).

## Installation

```bash
git clone git@gitlab.maeli.net:ravel/cinnamon-applets.git
cd cinnamon-applets/relay-switches@ravel

# applet files
install -d ~/.local/share/cinnamon/applets/relay-switches@ravel
install -m 644 metadata.json applet.js settings-schema.json icon.png \
        ~/.local/share/cinnamon/applets/relay-switches@ravel/

# translations (needs gettext)
for po in po/*.po; do
    lang="$(basename "$po" .po)"
    install -d "$HOME/.local/share/locale/$lang/LC_MESSAGES"
    msgfmt -o "$HOME/.local/share/locale/$lang/LC_MESSAGES/relay-switches@ravel.mo" "$po"
done

# optional: CLI
install -Dm 755 relayctl ~/.local/bin/relayctl
```

Reload Cinnamon, then right-click the panel → **Applets** → **Relay Switches**:

```bash
dbus-send --session --dest org.Cinnamon --object-path /org/Cinnamon \
  --type=method_call org.Cinnamon.Eval string:'global.reexec_self()'
```

For another user on the same machine, including your own switches:

```bash
sudo install -d -o USER -g USER ~USER/.local/share/cinnamon/applets/relay-switches@ravel \
    ~USER/.config/cinnamon/spices/relay-switches@ravel
sudo install -o USER -g USER -m 644 metadata.json applet.js settings-schema.json icon.png \
    ~USER/.local/share/cinnamon/applets/relay-switches@ravel/
sudo install -o USER -g USER -m 644 \
    ~/.config/cinnamon/spices/relay-switches@ravel/relay-switches@ravel.json \
    ~USER/.config/cinnamon/spices/relay-switches@ravel/
```

The settings file is copied as it is; Cinnamon keeps the values and adapts the
file to the installed schema the first time the applet starts.

## Configuration

Right-click the applet → **Configure**.

| Page | Options |
| --- | --- |
| Switches | Name, icon, host(s), on/off/status path per switch; groups |
| Panel | Text next to the icon, icon, icon while something is on |
| Behavior | Polling interval, notifications, HTTP timeout, middle click action |

A switch only needs a name and a host — the paths default to
`/relay?state=1`, `/relay?state=0` and `/relay`.

```
Name      Icon                Host(s)          On   Off   Status
Coffee    coffee-symbolic     192.168.1.50     -    -     -
Media     audio-speakers      TV, Amplifier    -    -     -
```

Several hosts are separated by commas. Hosts may be IP addresses or URLs
(`http://board.local:8080`). Groups are listed on the same page and refer to
switch names; a group is on when all of its members are on.

![Settings](docs/settings.png)

## Status format

The response of the status path may be JSON (`{"on": true}`), a bare value
(`true`, `false`, `1`, `0`, `on`, `off`) or a JSON object with one of the keys
`on`, `state`, `relay`, `power`, `status`. If a host does not answer or returns
something unknown, the switch is marked *offline*; it can still be switched.

## CLI

`relayctl` reads the configuration the applet exports to
`~/.config/cinnamon/spices/relay-switches@ravel/switches.json`:

```bash
relayctl list
relayctl status
relayctl on Coffee
relayctl off Media
relayctl toggle Printer
relayctl all-off
```

Names are matched exactly first, then as an unambiguous substring; group names
work the same way. Exit code is `1` if a device could not be reached.

## Removal

```bash
rm -rf ~/.local/share/cinnamon/applets/relay-switches@ravel \
       ~/.config/cinnamon/spices/relay-switches@ravel \
       ~/.local/share/locale/*/LC_MESSAGES/relay-switches@ravel.mo
rm -f  ~/.local/bin/relayctl            # only if the CLI was installed
```

## Notes

- Requires Cinnamon 5.8 or newer; tested on 6.6.
- HTTP requests use `curl` (asynchronous, without a shell).
- Symbolic icon names end in `-symbolic` and follow the panel color.
- After changing the applet files, reload Cinnamon (Alt+F2, `r`, Enter).
