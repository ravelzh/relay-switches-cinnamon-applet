#!/usr/bin/env bash
# Installiert das Cinnamon-Applet "Relay Switches".
#
#   ./install.sh                  fuer den aktuellen Benutzer
#   ./install.sh --panel          + in die obere Leiste haengen
#   ./install.sh --cli            + "relayctl" nach ~/.local/bin
#   ./install.sh --reload         Cinnamon am Ende neu laden
#   ./install.sh --all            alles davon
#
#   sudo ./install.sh --for raveloffice --panel --cli --settings
#                                 fuer einen anderen Benutzer (braucht sudo);
#                                 --settings uebernimmt die eigenen Einstellungen
set -euo pipefail

UUID="relay-switches@ravel"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ADD_PANEL=0
RELOAD=0
INSTALL_CLI=0
COPY_SETTINGS=0
TARGET_USER=""

while [ $# -gt 0 ]; do
    case "$1" in
        --panel)  ADD_PANEL=1 ;;
        --reload) RELOAD=1 ;;
        --cli)    INSTALL_CLI=1 ;;
        --settings) COPY_SETTINGS=1 ;;
        --all)    ADD_PANEL=1; RELOAD=1; INSTALL_CLI=1; COPY_SETTINGS=1 ;;
        --for)    TARGET_USER="${2:-}"; shift ;;
        -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
        *) echo "Unbekannte Option: $1" >&2; exit 1 ;;
    esac
    shift
done

if [ -n "$TARGET_USER" ] && [ "$TARGET_USER" != "$(id -un)" ]; then
    if [ "$(id -u)" -ne 0 ]; then
        echo "Fuer einen anderen Benutzer bitte mit sudo starten:" >&2
        echo "  sudo $0 --for $TARGET_USER --panel --cli" >&2
        exit 1
    fi
    TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
    TARGET_GROUP="$(id -gn "$TARGET_USER")"
    AS_TARGET=(sudo -u "$TARGET_USER" -H)

    # D-Bus-Adresse der laufenden Cinnamon-Sitzung des Zielbenutzers
    target_pid="$(pgrep -u "$TARGET_USER" -x cinnamon | head -1 || true)"
    if [ -n "$target_pid" ]; then
        TARGET_BUS="$(tr '\0' '\n' < "/proc/$target_pid/environ" | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p')"
    else
        TARGET_BUS=""
    fi
else
    TARGET_USER="$(id -un)"
    TARGET_HOME="$HOME"
    TARGET_GROUP="$(id -gn)"
    AS_TARGET=()
    TARGET_BUS="${DBUS_SESSION_BUS_ADDRESS:-}"
fi

DEST="$TARGET_HOME/.local/share/cinnamon/applets/$UUID"
BIN="$TARGET_HOME/.local/bin"

# --- Dateien kopieren -------------------------------------------------------
if [ "${#AS_TARGET[@]}" -gt 0 ]; then
    "${AS_TARGET[@]}" mkdir -p "$DEST"
    for file in metadata.json applet.js settings-schema.json icon.png icon.svg; do
        install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 644 "$SRC/$file" "$DEST/$file"
    done
else
    install -d "$DEST"
    install -m 644 "$SRC/metadata.json" "$SRC/applet.js" "$SRC/settings-schema.json" \
                   "$SRC/icon.png" "$SRC/icon.svg" "$DEST/"
fi
echo "Applet installiert fuer $TARGET_USER: $DEST"

if [ "$INSTALL_CLI" = 1 ]; then
    if [ "${#AS_TARGET[@]}" -gt 0 ]; then
        "${AS_TARGET[@]}" mkdir -p "$BIN"
        install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 755 "$SRC/relayctl" "$BIN/relayctl"
    else
        install -d "$BIN"
        install -m 755 "$SRC/relayctl" "$BIN/relayctl"
    fi
    echo "CLI installiert:      $BIN/relayctl"
fi

# --- Einstellungen des aufrufenden Benutzers uebernehmen ---------------------
if [ "$COPY_SETTINGS" = 1 ]; then
    if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
        SOURCE_HOME="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
    else
        SOURCE_HOME="$HOME"
    fi
    SRC_CFG="$SOURCE_HOME/.config/cinnamon/spices/$UUID/$UUID.json"
    DST_CFG="$TARGET_HOME/.config/cinnamon/spices/$UUID/$UUID.json"

    if [ "$TARGET_HOME" = "$SOURCE_HOME" ]; then
        echo "Gleicher Benutzer - Einstellungen bleiben unveraendert."
    elif [ ! -f "$SRC_CFG" ]; then
        echo "Keine Einstellungen gefunden ($SRC_CFG) - uebersprungen."
    else
        mkdir -p "$(dirname "$DST_CFG")"
        python3 "$SRC/import-settings.py" "$SRC_CFG" "$DEST/settings-schema.json" "$DST_CFG"
        if [ "${#AS_TARGET[@]}" -gt 0 ]; then
            chown "$TARGET_USER:$TARGET_GROUP" "$DST_CFG"
            [ -f "$DST_CFG.bak" ] && chown "$TARGET_USER:$TARGET_GROUP" "$DST_CFG.bak"
        fi
        echo "Einstellungen uebernommen: $DST_CFG"
    fi
fi

# --- in die Leiste haengen --------------------------------------------------
if [ "$ADD_PANEL" = 1 ]; then
    if [ -z "$TARGET_BUS" ]; then
        echo "Keine laufende Cinnamon-Sitzung von $TARGET_USER gefunden - bitte das"
        echo "Applet manuell hinzufuegen: Rechtsklick auf die Leiste -> Applets."
    else
        "${AS_TARGET[@]}" env DBUS_SESSION_BUS_ADDRESS="$TARGET_BUS" \
            python3 - "$UUID" <<'PY'
import ast
import subprocess
import sys

uuid = sys.argv[1]
current = subprocess.check_output(["gsettings", "get", "org.cinnamon", "enabled-applets"]).decode()
entries = ast.literal_eval(current)

if any(uuid in entry.split(":")[3] for entry in entries):
    print("Applet haengt bereits in der Leiste.")
else:
    ids = [int(entry.split(":")[4]) for entry in entries if entry.count(":") >= 4]
    instance = (max(ids) + 1) if ids else 0
    entries.append("panel1:right:19:%s:%d" % (uuid, instance))
    subprocess.check_call([
        "gsettings", "set", "org.cinnamon", "enabled-applets",
        "[" + ", ".join("'%s'" % entry for entry in entries) + "]",
    ])
    print("Applet zur oberen Leiste hinzugefuegt (rechts, Position 19).")
PY
    fi
fi

# --- Cinnamon neu laden -----------------------------------------------------
if [ "$RELOAD" = 1 ]; then
    if [ -z "$TARGET_BUS" ]; then
        echo "Cinnamon von $TARGET_USER laeuft nicht - nichts zu laden."
    else
        "${AS_TARGET[@]}" env DBUS_SESSION_BUS_ADDRESS="$TARGET_BUS" dbus-send --session \
            --dest org.Cinnamon --object-path /org/Cinnamon \
            --type=method_call org.Cinnamon.Eval string:'global.reexec_self()' >/dev/null 2>&1 || true
        echo "Cinnamon von $TARGET_USER wird neu geladen ..."
    fi
else
    echo
    echo "Cinnamon neu laden (falls noetig): Alt+F2 druecken, 'r' eingeben, Enter."
    echo "Danach: Rechtsklick auf die Leiste -> Applets -> 'Relay Switches' hinzufuegen."
fi
