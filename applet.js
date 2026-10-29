/* Relay Switches – Cinnamon Applet
 *
 * Schaltet HTTP-Relaisboards, wie sie z. B. mit "relay?state=0/1" arbeiten.
 * Ersetzt die Nemo-Scripts (drucker-on.sh, kafi-off.sh, ...).
 *
 * Konfiguration: Rechtsklick auf das Applet → "Konfigurieren"
 *   - beliebig viele Schalter (Name, Symbol, Hosts, Ein-/Aus-/Status-Pfad)
 *   - mehrere Hosts pro Schalter werden gemeinsam geschaltet (z. B. "Media")
 *   - Gruppen fassen mehrere Schalter zu einem weiteren Switch zusammen
 *
 * Status: GET <status-pfad> wird gelesen, JSON {"on": true} oder "1"/"on" werden
 * verstanden. Nicht erreichbare Geräte werden als "offline" markiert.
 */

const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Main = imports.ui.main;
const Util = imports.misc.util;
const Gettext = imports.gettext;

const UUID = "relay-switches@ravel";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

/* Kürzt einen String auf n Zeichen inkl. Ellipse */
function shorten(text, max) {
    if (text.length <= max) return text;
    return text.substr(0, max - 1).trim() + "…";
}


class RelaySwitchesApplet extends Applet.TextIconApplet {

    constructor(orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);

        this.setAllowedLayout(Applet.AllowedLayout.BOTH);

        /* Konfiguration – wird gleich von den Settings überschrieben */
        this.switchesConfig = [];
        this.groupsConfig = [];
        this.panelDisplay = "count";
        this.panelIcon = "network-server-symbolic";
        this.panelIconOn = "";
        this.middleClick = "refresh";
        this.pollInterval = 30;
        this.timeout = 5;
        this.notifyErrors = true;
        this.showAllItems = true;

        /* Laufzeit-Zustand */
        this._switches = [];
        this._groups = [];
        this._state = {};          // Name → { on, known, offline, busy }
        this._items = {};          // Name → PopupSwitchIconMenuItem
        this._groupItems = {};     // Name → PopupSwitchIconMenuItem
        this._headerItem = null;
        this._pollSource = 0;
        this._lastRefresh = 0;
        this._currentIcon = null;
        this._removed = false;

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        this._initSettings(instanceId);

        this._onConfigChanged();
        this._schedulePoll();
    }

    /* ---------------------------------------------------------------- Settings */

    _initSettings(instanceId) {
        this.settings = new Settings.AppletSettings(this, UUID, instanceId);

        this.settings.bind("switches", "switchesConfig", () => this._onConfigChanged());
        this.settings.bind("groups", "groupsConfig", () => this._onConfigChanged());
        this.settings.bind("show-all-items", "showAllItems", () => this._onConfigChanged());

        this.settings.bind("panel-display", "panelDisplay", () => this._updatePanel());
        this.settings.bind("panel-icon", "panelIcon", () => this._updatePanel());
        this.settings.bind("panel-icon-on", "panelIconOn", () => this._updatePanel());
        this.settings.bind("middle-click", "middleClick", null);

        this.settings.bind("poll-interval", "pollInterval", () => this._schedulePoll());
        this.settings.bind("timeout", "timeout", null);
        this.settings.bind("notify-errors", "notifyErrors", null);
    }

    /* ----------------------------------------------------------- Konfiguration */

    _onConfigChanged() {
        if (this._removed) return;

        let rows = Array.isArray(this.switchesConfig) ? this.switchesConfig : [];
        let groupRows = Array.isArray(this.groupsConfig) ? this.groupsConfig : [];

        this._switches = rows
            .map((row, index) => this._normalizeSwitch(row, index))
            .filter(sw => sw.hosts.length > 0);

        /* Namen müssen eindeutig sein, sie sind der Schlüssel für Status und Gruppen */
        let seen = Object.create(null);
        this._switches.forEach(sw => {
            let base = sw.name;
            let n = 2;
            while (seen[sw.name]) sw.name = base + " (" + (n++) + ")";
            seen[sw.name] = true;
        });

        this._groups = groupRows
            .map((row, index) => this._normalizeGroup(row, index))
            .filter(gr => gr.members.length > 0);

        /* Zustand verwaister Schalter verwerfen */
        let states = {};
        this._switches.forEach(sw => {
            states[sw.name] = this._state[sw.name] ||
                { on: false, known: false, offline: false, busy: false };
        });
        this._state = states;

        this._buildMenu();
        this._exportConfig();
        this._updatePanel();
        this._refreshAll(true);
    }

    _normalizeSwitch(row, index) {
        row = row || {};
        let name = String(row.name === undefined ? "" : row.name).trim();
        if (!name) name = _("Schalter %d").format(index + 1);

        let hosts = String(row.hosts === undefined ? "" : row.hosts)
            .split(/[\s,;]+/)
            .map(h => h.trim())
            .filter(h => h.length > 0);

        return {
            name: name,
            icon: this._cleanIcon(row.icon) || "network-server-symbolic",
            hosts: hosts,
            onPath: this._normPath(row.on_path, "/relay?state=1"),
            offPath: this._normPath(row.off_path, "/relay?state=0"),
            statusPath: this._normPath(row.status_path, "/relay"),
        };
    }

    _normalizeGroup(row, index) {
        row = row || {};
        let name = String(row.name === undefined ? "" : row.name).trim();
        if (!name) name = _("Gruppe %d").format(index + 1);

        let members = String(row.members === undefined ? "" : row.members)
            .split(/[,;]+/)
            .map(m => m.trim())
            .filter(m => m.length > 0);

        return {
            name: name,
            icon: this._cleanIcon(row.icon) || "network-server-symbolic",
            members: members,
        };
    }

    _cleanIcon(icon) {
        if (icon === undefined || icon === null) return "";
        return String(icon).trim();
    }

    /* Leerer Pfad → Standard, "/" → Wurzel */
    _normPath(value, fallback) {
        if (value === undefined || value === null) return fallback;
        let path = String(value).trim();
        if (path === "") return fallback;
        return path;
    }

    /* --------------------------------------------------------------- HTTP-Teil */

    _url(host, path) {
        let base = /^[a-z][a-z0-9+.-]*:\/\//i.test(host) ? host : "http://" + host;
        base = base.replace(/\/+$/, "");
        if (!path) return base;
        if (path.charAt(0) !== "/") path = "/" + path;
        return base + path;
    }

    _httpGet(url, callback) {
        let timeout = Math.max(1, Number(this.timeout) || 5);
        let argv = [
            "curl", "-sS", "-g",
            "--max-time", String(timeout),
            "--connect-timeout", String(Math.min(timeout, 3)),
            url
        ];

        let proc;
        try {
            proc = Gio.Subprocess.new(argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            global.logError("Relay Switch: curl konnte nicht gestartet werden: " + e);
            callback(false, "");
            return;
        }

        proc.communicate_utf8_async(null, null, (p, res) => {
            let ok = false;
            let out = "";
            try {
                let [, stdout] = p.communicate_utf8_finish(res);
                out = stdout || "";
                ok = p.get_successful();
            } catch (e) {
                ok = false;
            }

            if (this._removed) return;
            try {
                callback(ok, out);
            } catch (e) {
                global.logError("Relay Switch: " + e);
            }
        });
    }

    _parseStateText(text) {
        let t = String(text).trim().toLowerCase();
        if (["1", "on", "true", "yes", "an", "ein"].indexOf(t) >= 0) return true;
        if (["0", "off", "false", "no", "aus"].indexOf(t) >= 0) return false;
        return null;
    }

    _parseState(body) {
        if (!body) return null;
        let text = String(body).trim();
        if (!text) return null;

        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            return this._parseStateText(text);
        }

        if (typeof data === "boolean") return data;
        if (typeof data === "number") return data !== 0;

        if (data && typeof data === "object") {
            let keys = ["on", "state", "relay", "power", "status"];
            for (let i = 0; i < keys.length; i++) {
                if (!(keys[i] in data)) continue;
                let value = data[keys[i]];
                if (typeof value === "boolean") return value;
                if (typeof value === "number") return value !== 0;
                if (typeof value === "string") return this._parseStateText(value);
            }
        }

        return null;
    }

    /* Status aller Hosts eines Schalters abfragen */
    _querySwitch(sw, callback) {
        let total = sw.hosts.length;
        if (total === 0) {
            callback({ on: false, offline: true });
            return;
        }

        let done = 0;
        let values = [];

        sw.hosts.forEach(host => {
            this._httpGet(this._url(host, sw.statusPath), (ok, body) => {
                values.push(ok ? this._parseState(body) : null);

                if (++done < total) return;

                let offline = values.some(v => v === null);
                callback({
                    on: values.every(v => v === true),
                    offline: offline
                });
            });
        });
    }

    /* Ein-/Ausschalten auf allen Hosts eines Schalters */
    _setHosts(sw, on, callback) {
        let total = sw.hosts.length;
        if (total === 0) {
            callback(0, 0);
            return;
        }

        let done = 0;
        let failed = 0;
        let path = on ? sw.onPath : sw.offPath;

        sw.hosts.forEach(host => {
            this._httpGet(this._url(host, path), ok => {
                if (!ok) failed++;
                if (++done === total) callback(failed, total);
            });
        });
    }

    /* ------------------------------------------------------------------- Menü */

    _iconType(name) {
        return /-symbolic(\.svg)?$/.test(name) ? St.IconType.SYMBOLIC : St.IconType.FULLCOLOR;
    }

    _buildMenu() {
        this.menu.removeAll();
        this._items = {};
        this._groupItems = {};
        this._headerItem = null;

        this._headerItem = new PopupMenu.PopupMenuItem("", { reactive: false });
        this._headerItem.actor.style = "padding-top: 4px; padding-bottom: 2px;";
        this._headerItem.label.style = "font-weight: bold; font-size: 0.92em;";
        this.menu.addMenuItem(this._headerItem);

        let switchSection = new PopupMenu.PopupMenuSection();
        this._switches.forEach(sw => {
            let item = new PopupMenu.PopupSwitchIconMenuItem(
                sw.name, false, sw.icon, this._iconType(sw.icon));
            item.connect("toggled", (actor, value) => this._onSwitchToggled(sw, value));
            this._items[sw.name] = item;
            switchSection.addMenuItem(item);
        });
        this.menu.addMenuItem(switchSection);

        if (this._groups.length > 0) {
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            let groupSection = new PopupMenu.PopupMenuSection();
            this._groups.forEach(gr => {
                let item = new PopupMenu.PopupSwitchIconMenuItem(
                    gr.name, false, gr.icon, this._iconType(gr.icon));
                item.connect("toggled", (actor, value) => this._onGroupToggled(gr, value));
                this._groupItems[gr.name] = item;
                groupSection.addMenuItem(item);
            });
            this.menu.addMenuItem(groupSection);
        }

        if (this.showAllItems && this._switches.length > 1) {
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            let allOn = new PopupMenu.PopupIconMenuItem(
                _("Alle einschalten"), "media-playback-start", St.IconType.SYMBOLIC);
            allOn.connect("activate", () => this._setAll(true));
            this.menu.addMenuItem(allOn);

            let allOff = new PopupMenu.PopupIconMenuItem(
                _("Alle ausschalten"), "media-playback-stop", St.IconType.SYMBOLIC);
            allOff.connect("activate", () => this._setAll(false));
            this.menu.addMenuItem(allOff);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let refreshItem = new PopupMenu.PopupIconMenuItem(
            _("Status aktualisieren"), "view-refresh", St.IconType.SYMBOLIC);
        refreshItem.connect("activate", () => this._refreshAll(true));
        this.menu.addMenuItem(refreshItem);

        let configItem = new PopupMenu.PopupIconMenuItem(
            _("Einstellungen"), "preferences-system", St.IconType.SYMBOLIC);
        configItem.connect("activate", () => {
            if (typeof this.configureApplet === "function") {
                this.configureApplet();
            } else {
                Util.spawnCommandLine("cinnamon-settings applets " + UUID);
            }
        });
        this.menu.addMenuItem(configItem);

        this._renderAll();
    }

    _stateOf(name) {
        if (!this._state[name]) {
            this._state[name] = { on: false, known: false, offline: false, busy: false };
        }
        return this._state[name];
    }

    _renderAll() {
        this._switches.forEach(sw => this._renderItem(sw));
        this._groups.forEach(gr => this._renderGroup(gr));
        this._renderHeader();
    }

    _renderItem(sw) {
        let item = this._items[sw.name];
        if (!item) return;

        let st = this._stateOf(sw.name);
        if (!st.busy) item.setToggleState(!!st.on);

        if (st.busy) {
            item.setStatus("…");
        } else if (st.offline) {
            item.setStatus(_("offline"));
        } else {
            item.setStatus("");
        }
    }

    _groupState(gr) {
        let allOn = gr.members.length > 0;
        let offline = false;

        gr.members.forEach(name => {
            let st = this._stateOf(name);
            if (st.offline || !st.known) offline = true;
            if (!st.on) allOn = false;
        });

        return { on: allOn, offline: offline };
    }

    _renderGroup(gr) {
        let item = this._groupItems[gr.name];
        if (!item) return;

        let gs = this._groupState(gr);
        item.setToggleState(gs.on);
        item.setStatus(gs.offline ? _("offline") : "");
    }

    _renderHeader() {
        if (!this._headerItem) return;

        let on = 0;
        let offline = 0;
        this._switches.forEach(sw => {
            let st = this._stateOf(sw.name);
            if (st.on) on++;
            if (st.offline) offline++;
        });

        let text = _("Relais") + " · " + on + "/" + this._switches.length + " " + _("an");
        if (offline > 0) text += " · " + offline + " " + _("offline");
        this._headerItem.label.set_text(text);
    }

    /* --------------------------------------------------------------- Aktionen */

    _onSwitchToggled(sw, value) {
        if (this._stateOf(sw.name).busy) return;
        this._applySwitch(sw, value);
    }

    _onGroupToggled(gr, value) {
        gr.members.forEach(name => {
            let sw = this._switches.find(s => s.name === name);
            if (!sw) return;
            if (this._stateOf(sw.name).busy) return;
            this._applySwitch(sw, value);
        });
    }

    _applySwitch(sw, on, callback) {
        let st = this._stateOf(sw.name);
        st.busy = true;
        this._renderItem(sw);
        this._renderGroupFor(sw.name);

        this._setHosts(sw, on, (failed, total) => {
            /* Danach echten Zustand vom Board lesen – nicht raten */
            this._querySwitch(sw, result => {
                if (this._removed) return;

                st.busy = false;
                st.known = !result.offline;
                st.offline = result.offline;
                st.on = result.on;

                this._renderItem(sw);
                this._renderGroupFor(sw.name);
                this._renderHeader();
                this._updatePanel();

                if (failed > 0 && this.notifyErrors) {
                    Main.notify(_("Relais nicht erreichbar"),
                        _("%s: %d von %d Geräten antworten nicht.")
                            .format(sw.name, failed, total));
                }

                if (callback) callback(failed, total);
            });
        });
    }

    _renderGroupFor(switchName) {
        this._groups.forEach(gr => {
            if (gr.members.indexOf(switchName) >= 0) this._renderGroup(gr);
        });
    }

    _setAll(on) {
        this._switches.forEach(sw => {
            if (this._stateOf(sw.name).busy) return;
            this._applySwitch(sw, on);
        });
    }

    _refreshAll(force) {
        if (this._removed) return;

        let now = GLib.get_monotonic_time();
        if (!force && (now - this._lastRefresh) < 400000) return;   // 0,4 s Bremse
        this._lastRefresh = now;

        this._switches.forEach(sw => {
            let st = this._stateOf(sw.name);
            if (st.busy) return;

            this._querySwitch(sw, result => {
                if (this._removed) return;

                st.known = !result.offline;
                st.offline = result.offline;
                st.on = result.on;

                this._renderItem(sw);
                this._renderGroupFor(sw.name);
                this._renderHeader();
                this._updatePanel();
            });
        });
    }

    _schedulePoll() {
        if (this._pollSource) {
            GLib.source_remove(this._pollSource);
            this._pollSource = 0;
        }

        let interval = Number(this.pollInterval) || 0;
        if (interval <= 0 || this._removed) return;

        this._pollSource = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, Math.max(5, Math.round(interval)), () => {
                this._refreshAll(true);
                return GLib.SOURCE_CONTINUE;
            });
    }

    /* ------------------------------------------------------------------ Panel */

    _updatePanel() {
        if (this._removed || !this._switches) return;

        let total = this._switches.length;
        let active = [];
        let offline = 0;
        let lines = [_("Relais-Steuerung")];

        this._switches.forEach(sw => {
            let st = this._stateOf(sw.name);
            let status;
            if (st.offline) {
                offline++;
                status = _("offline");
            } else if (!st.known) {
                status = _("unbekannt");
            } else {
                status = st.on ? _("an") : _("aus");
            }
            if (st.on) active.push(sw.name);
            lines.push(sw.name + ": " + status);
        });

        let label = "";
        if (active.length > 0) {
            if (this.panelDisplay === "count") {
                label = active.length + "/" + total;
            } else if (this.panelDisplay === "names") {
                label = shorten(active.join(", "), 42);
            }
        }
        this.set_applet_label(label);

        if (offline > 0) lines.push("", offline + " " + _("Gerät(e) offline"));
        this.set_applet_tooltip(lines.join("\n"));

        let icon = (active.length > 0 && this.panelIconOn) ? this.panelIconOn : this.panelIcon;
        this._setPanelIcon(icon);
    }

    _setPanelIcon(icon) {
        if (!icon || icon === this._currentIcon) return;
        this._currentIcon = icon;

        try {
            if (icon.charAt(0) === "/" || icon.indexOf("file://") === 0) {
                let path = icon.indexOf("file://") === 0
                    ? Gio.File.new_for_uri(icon).get_path() : icon;
                if (/-symbolic(\.svg)?$/.test(path)) {
                    this.set_applet_icon_symbolic_path(path);
                } else {
                    this.set_applet_icon_path(path);
                }
            } else if (/-symbolic$/.test(icon)) {
                this.set_applet_icon_symbolic_name(icon);
            } else {
                this.set_applet_icon_name(icon);
            }
        } catch (e) {
            global.logError("Relay Switch: Symbol '" + icon + "' nicht gesetzt: " + e);
        }
    }

    /* ------------------------------------------------------------- Applet-API */

    on_applet_clicked(event) {
        this._refreshAll(false);
        this.menu.toggle();
    }

    on_applet_middle_clicked(event) {
        switch (this.middleClick) {
            case "all-on":
                this._setAll(true);
                break;
            case "all-off":
                this._setAll(false);
                break;
            case "refresh":
                this._refreshAll(true);
                break;
            case "menu":
                this.menu.toggle();
                break;
            default:
                break;
        }
    }

    on_applet_removed_from_panel() {
        this._removed = true;

        if (this._pollSource) {
            GLib.source_remove(this._pollSource);
            this._pollSource = 0;
        }

        if (this.settings) this.settings.finalize();
    }

    /* Konfiguration für das CLI (relayctl) exportieren */
    _exportConfig() {
        try {
            let dir = GLib.get_user_config_dir() + "/cinnamon/spices/" + UUID;
            GLib.mkdir_with_parents(dir, 0o755);

            let data = {
                generated: new Date().toISOString(),
                switches: this._switches.map(sw => ({
                    name: sw.name,
                    icon: sw.icon,
                    hosts: sw.hosts,
                    on_path: sw.onPath,
                    off_path: sw.offPath,
                    status_path: sw.statusPath,
                })),
                groups: this._groups.map(gr => ({
                    name: gr.name,
                    icon: gr.icon,
                    members: gr.members,
                })),
            };

            GLib.file_set_contents(dir + "/switches.json", JSON.stringify(data, null, 2));
        } catch (e) {
            global.logWarning("Relay Switch: Konfiguration konnte nicht exportiert werden: " + e);
        }
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new RelaySwitchesApplet(orientation, panelHeight, instanceId);
}
