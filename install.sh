#!/usr/bin/env bash
# Install the Cinnamon applet "Relay Switches".
#
#   ./install.sh                  install for the current user
#   ./install.sh --panel          also add it to the panel
#   ./install.sh --cli            also install relayctl to ~/.local/bin
#   ./install.sh --reload         reload Cinnamon afterwards
#   ./install.sh --all            all of the above
#
#   sudo ./install.sh --for USER --panel --cli --settings
#                                 install for another user (needs sudo);
#                                 --settings copies your own configuration
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
        --panel)    ADD_PANEL=1 ;;
        --reload)   RELOAD=1 ;;
        --cli)      INSTALL_CLI=1 ;;
        --settings) COPY_SETTINGS=1 ;;
        --all)      ADD_PANEL=1; RELOAD=1; INSTALL_CLI=1; COPY_SETTINGS=1 ;;
        --for)      TARGET_USER="${2:-}"; shift ;;
        -h|--help)  sed -n '2,11p' "$0"; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
    shift
done

if [ -n "$TARGET_USER" ] && [ "$TARGET_USER" != "$(id -un)" ]; then
    if [ "$(id -u)" -ne 0 ]; then
        echo "Installing for another user requires sudo:" >&2
        echo "  sudo $0 --for $TARGET_USER --panel --cli" >&2
        exit 1
    fi
    TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
    TARGET_GROUP="$(id -gn "$TARGET_USER")"
    AS_TARGET=(sudo -u "$TARGET_USER" -H)

    # D-Bus address of the target user's running Cinnamon session
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
LOCALE="$TARGET_HOME/.local/share/locale"
BIN="$TARGET_HOME/.local/bin"

# --- Files -------------------------------------------------------------------
if [ "${#AS_TARGET[@]}" -gt 0 ]; then
    "${AS_TARGET[@]}" mkdir -p "$DEST"
    for file in metadata.json applet.js settings-schema.json icon.png; do
        install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 644 "$SRC/$file" "$DEST/$file"
    done
else
    install -d "$DEST"
    install -m 644 "$SRC/metadata.json" "$SRC/applet.js" "$SRC/settings-schema.json" \
                   "$SRC/icon.png" "$DEST/"
fi
echo "Applet installed for $TARGET_USER: $DEST"

# --- Translations ------------------------------------------------------------
# The .po files are compiled at install time, so the repository stays free of
# generated .mo files.
if ! command -v msgfmt >/dev/null 2>&1; then
    echo "msgfmt not found (package 'gettext') - translations skipped." >&2
else
    for po in "$SRC"/po/*.po; do
        [ -e "$po" ] || continue
        lang="$(basename "$po" .po)"
        mo_dir="$LOCALE/$lang/LC_MESSAGES"
        tmp="$(mktemp)"
        msgfmt --check -o "$tmp" "$po"

        if [ "${#AS_TARGET[@]}" -gt 0 ]; then
            "${AS_TARGET[@]}" mkdir -p "$mo_dir"
            install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 644 "$tmp" "$mo_dir/$UUID.mo"
        else
            install -d "$mo_dir"
            install -m 644 "$tmp" "$mo_dir/$UUID.mo"
        fi
        rm -f "$tmp"
        echo "Translation installed:  $lang"
    done
fi

# --- CLI ---------------------------------------------------------------------
if [ "$INSTALL_CLI" = 1 ]; then
    if [ "${#AS_TARGET[@]}" -gt 0 ]; then
        "${AS_TARGET[@]}" mkdir -p "$BIN"
        install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 755 "$SRC/relayctl" "$BIN/relayctl"
    else
        install -d "$BIN"
        install -m 755 "$SRC/relayctl" "$BIN/relayctl"
    fi
    echo "CLI installed:          $BIN/relayctl"
fi

# --- Copy the settings of the calling user -----------------------------------
if [ "$COPY_SETTINGS" = 1 ]; then
    if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
        SOURCE_HOME="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
    else
        SOURCE_HOME="$HOME"
    fi
    SRC_CFG="$SOURCE_HOME/.config/cinnamon/spices/$UUID/$UUID.json"
    DST_CFG="$TARGET_HOME/.config/cinnamon/spices/$UUID/$UUID.json"

    if [ "$TARGET_HOME" = "$SOURCE_HOME" ]; then
        echo "Same user - settings left untouched."
    elif [ ! -f "$SRC_CFG" ]; then
        echo "No settings found ($SRC_CFG) - skipped."
    else
        mkdir -p "$(dirname "$DST_CFG")"
        # A verbatim copy is enough: the schema checksum differs from the one in
        # the file, so Cinnamon keeps the stored values and rewrites the format.
        [ -f "$DST_CFG" ] && cp -f "$DST_CFG" "$DST_CFG.bak"
        install -m 644 "$SRC_CFG" "$DST_CFG"
        if [ "${#AS_TARGET[@]}" -gt 0 ]; then
            chown "$TARGET_USER:$TARGET_GROUP" "$DST_CFG"
            [ -f "$DST_CFG.bak" ] && chown "$TARGET_USER:$TARGET_GROUP" "$DST_CFG.bak"
        fi
        echo "Settings copied:        $DST_CFG"
    fi
fi

# --- Add to the panel --------------------------------------------------------
if [ "$ADD_PANEL" = 1 ]; then
    if [ -z "$TARGET_BUS" ]; then
        echo "No running Cinnamon session for $TARGET_USER - add the applet manually:"
        echo "right-click the panel -> Applets."
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
    print("Applet is already on the panel.")
else:
    ids = [int(entry.split(":")[4]) for entry in entries if entry.count(":") >= 4]
    instance = (max(ids) + 1) if ids else 0
    entries.append("panel1:right:19:%s:%d" % (uuid, instance))
    subprocess.check_call([
        "gsettings", "set", "org.cinnamon", "enabled-applets",
        "[" + ", ".join("'%s'" % entry for entry in entries) + "]",
    ])
    print("Applet added to the top panel (right, position 19).")
PY
    fi
fi

# --- Reload Cinnamon ---------------------------------------------------------
if [ "$RELOAD" = 1 ]; then
    if [ -z "$TARGET_BUS" ]; then
        echo "Cinnamon of $TARGET_USER is not running - nothing to reload."
    else
        "${AS_TARGET[@]}" env DBUS_SESSION_BUS_ADDRESS="$TARGET_BUS" dbus-send --session \
            --dest org.Cinnamon --object-path /org/Cinnamon \
            --type=method_call org.Cinnamon.Eval string:'global.reexec_self()' >/dev/null 2>&1 || true
        echo "Reloading Cinnamon of $TARGET_USER ..."
    fi
else
    echo
    echo "Reload Cinnamon if needed: Alt+F2, type 'r', Enter."
    echo "Then add the applet: right-click the panel -> Applets -> 'Relay Switches'."
fi
