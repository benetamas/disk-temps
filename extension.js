// vim: set sw=4 sts=4 et:
// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const St = imports.gi.St;
const ByteArray = imports.byteArray;

const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const Me = ExtensionUtils.getCurrentExtension();
const Domain = Me.imports.domain;
const ICON_FILE = `${Me.path}/icons/disk-temperature-symbolic.svg`;

const NVME_DEVICES = ['/dev/nvme0', '/dev/nvme1'];

// Ennyi frissitesi kor utan ujraenumeraljuk az udisks diszkeket. Kell, mert
// boot utan az udisks kesobb adja ki egyes lemezek Drive.Ata interfeszet.
const REDISCOVER_TICKS = 12;
const SUDO = '/usr/bin/sudo';
const NVME = '/usr/sbin/nvme';

// Super I/O chip a haz-szenzorokhoz (SYSTIN, ventilator RPM)
const HWMON_CHIP = 'nct6798';
const HWMON_FAN_CHANNELS = 7;
// Amit meressel azonositottunk ezen az alaplapon (ASRock Z490 Pro4).
// A 4/5/6 mind SYSTIN-vezerelt haz-ventilator (temp_sel=1); a header szama
// kulonbozteti meg oket. Az fan1/fan3/fan7 ures (100% PWM-en is 0 RPM).
const FAN_NAMES = { 2: 'CPU', 4: 'ház', 5: 'ház', 6: 'ház' };

const UDISKS_NAME = 'org.freedesktop.UDisks2';
const UDISKS_PATH = '/org/freedesktop/UDisks2';
const IFACE_DRIVE = 'org.freedesktop.UDisks2.Drive';
const IFACE_ATA = 'org.freedesktop.UDisks2.Drive.Ata';
const IFACE_BLOCK = 'org.freedesktop.UDisks2.Block';
const IFACE_PARTITION = 'org.freedesktop.UDisks2.Partition';

const ObjectManagerIface = `
<node>
  <interface name="org.freedesktop.DBus.ObjectManager">
    <method name="GetManagedObjects">
      <arg type="a{oa{sa{sv}}}" name="objects" direction="out"/>
    </method>
    <signal name="InterfacesAdded">
      <arg type="o" name="object_path"/>
      <arg type="a{sa{sv}}" name="interfaces_and_properties"/>
    </signal>
    <signal name="InterfacesRemoved">
      <arg type="o" name="object_path"/>
      <arg type="as" name="interfaces"/>
    </signal>
  </interface>
</node>`;

const AtaIface = `
<node>
  <interface name="org.freedesktop.UDisks2.Drive.Ata">
    <method name="SmartUpdate">
      <arg type="a{sv}" name="options" direction="in"/>
    </method>
    <property type="b" name="SmartEnabled" access="read"/>
    <property type="d" name="SmartTemperature" access="read"/>
  </interface>
</node>`;

const ObjectManagerProxy = Gio.DBusProxy.makeProxyWrapper(ObjectManagerIface);
const AtaProxy = Gio.DBusProxy.makeProxyWrapper(AtaIface);

// a{sv} deepUnpack után a value-k GVariant-ok maradnak
function unwrap(value) {
    return value instanceof GLib.Variant ? value.deepUnpack() : value;
}

// PreferredDevice = 'ay' bytestring, NUL-terminált
function bytestring(value) {
    let bytes = unwrap(value);
    if (bytes === null || bytes === undefined)
        return null;
    if (typeof bytes === 'string')
        return bytes;

    let str = ByteArray.toString(bytes);
    let nul = str.indexOf('\0');
    return nul < 0 ? str : str.slice(0, nul);
}

// --- haz-szenzorok (nct6798 hwmon, vilagolvashato sysfs, nem kell jog) ---

function readSysfsInt(path) {
    try {
        let [ok, bytes] = GLib.file_get_contents(path);
        if (!ok)
            return null;

        let value = parseInt(ByteArray.toString(bytes).trim(), 10);
        return Number.isFinite(value) ? value : null;
    } catch (e) {
        return null;
    }
}

// A hwmon INDEX bootonkent valtozhat, ezert nev szerint keressuk a chipet.
function findHwmon(chip) {
    for (let i = 0; i < 16; i++) {
        let dir = `/sys/class/hwmon/hwmon${i}`;
        try {
            let [ok, bytes] = GLib.file_get_contents(`${dir}/name`);
            if (ok && ByteArray.toString(bytes).trim() === chip)
                return dir;
        } catch (e) {
            // nincs ilyen hwmon index, megyunk tovabb
        }
    }
    return null;
}

let DiskTempsButton = GObject.registerClass(
class DiskTempsButton extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, 'Disk Temperatures', false);

        this._settings = settings;
        this._settingsIds = [];
        this._cancellable = new Gio.Cancellable();
        this._stopped = false;
        this._timeout = null;

        // Kuszoboket es szineket a legelejen betoltjuk: a _syncPanel es a
        // _render mar hasznalja oket.
        this._loadAppearance();

        this._ataDrives = [];       // udisks-ból, SmartTemperature-rel
        this._nvmeDrives = NVME_DEVICES.map(path => ({
            path,
            dev: path,
            model: '',
            kind: 'nvme',     // kuszob-osztaly
            type: 'NVMe',     // kijelzett tipus
            temp: null,
            standby: false,
            failed: false,
        }));
        this._nvmeBusy = 0;
        this._nvmeFailLogged = false;
        this._smartFailLogged = false;

        this._hwmon = findHwmon(HWMON_CHIP);
        this._systin = null;
        this._fans = [];
        // Amit egyszer forogni lattunk, azt tovabb figyeljuk -- igy egy kesobb
        // leallo ventilator 0 RPM-mel ott marad a listaban (ez a hibadetektor),
        // es egy uj headerre atdugott ventilator magatol megjelenik.
        this._fanSeen = new Set();

        this._ataKey = null;    // a legutobb felepitett ATA diszkkeszlet
        this._ticks = 0;

        this._objectManager = null;
        this._interfacesAddedId = 0;
        this._interfacesRemovedId = 0;
        this._rebuildQueued = false;
        this._lastUpdate = null;

        this._panelBox = new St.BoxLayout({
            style_class: 'disk-temp-panel',
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._panelBox);

        this._panelItems = new Map();
        this._panelIcon = null;
        this._panelStructure = null;    // mit épített legutóbb a _syncPanel

        this._rows = new Map();
        this._section = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._section);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._sensorRows = new Map();
        this._sensorStructure = null;
        this._sensorSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._sensorSection);

        this._alertItem = new PopupMenu.PopupMenuItem('', {
            reactive: false,
            can_focus: false,
            style_class: 'disk-temp-alert',
        });
        this._alertItem.visible = false;
        this.menu.addMenuItem(this._alertItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._footer = new PopupMenu.PopupMenuItem('Frissítve: –', {
            reactive: false,
            can_focus: false,
            style_class: 'disk-temp-footer',
        });
        this.menu.addMenuItem(this._footer);

        this._prefsItem = new PopupMenu.PopupMenuItem('Beállítások…');
        this._prefsItem.connect('activate', () => ExtensionUtils.openPrefs());
        this.menu.addMenuItem(this._prefsItem);
        // Ennek a labeljenek nincs sajat style class-a, tehat a tema szinet
        // orokolne (Lavanda: fekete) -- sotet hatteren olvashatatlan lenne.
        this._prefsItem.label.add_style_class_name('disk-temp-menu-text');

        this._applyMenuTheme();

        // A kuszob megvaltoztatja, hogy melyik diszk esik a szuresbe, tehat a
        // panel szerkezetet is ujra kell epiteni, nem csak ujraszinezni.
        for (let key of ['threshold-hdd-warm', 'threshold-hdd-hot',
                         'threshold-ssd-warm', 'threshold-ssd-hot',
                         'threshold-nvme-warm', 'threshold-nvme-hot',
                         'color-cool', 'color-warm', 'color-hot', 'color-na']) {
            this._settingsIds.push(this._settings.connect(`changed::${key}`, () => {
                this._loadAppearance();
                this._syncPanel(true);
            }));
        }

        this._settingsIds.push(...[
            this._settings.connect('changed::panel-mode', () => this._syncPanel(true)),
            this._settings.connect('changed::show-dev-label', () => this._syncPanel(true)),
            this._settings.connect('changed::show-icon', () => this._syncPanel(true)),
            this._settings.connect('changed::panel-order', () => this._syncPanel(true)),
            this._settings.connect('changed::show-type', () => this._syncPanel(true)),
            this._settings.connect('changed::panel-only-warm', () => this._syncPanel(true)),
            this._settings.connect('changed::show-systin', () => this._syncPanel(true)),
            this._settings.connect('changed::show-sensors', () => this._syncPanel(true)),
            this._settings.connect('changed::dark-menu', () => this._applyMenuTheme()),
            this._settings.connect('changed::alert-systin', () => this._render()),
            this._settings.connect('changed::alert-hdd', () => this._render()),
            this._settings.connect('changed::refresh-seconds', () => this._restartTimer()),
        ]);

        this._syncPanel(true);
        this._connectUdisks();
        this._refresh();
        this._restartTimer();
    }

    // Kuszobok es szinek a beallitasokbol, cache-elve: a render 7+ labelt fest
    // minden korben, nem akarunk annyi GSettings olvasast.
    _loadAppearance() {
        this._thresholds = {
            hdd: {
                warm: this._settings.get_int('threshold-hdd-warm'),
                hot: this._settings.get_int('threshold-hdd-hot'),
            },
            ssd: {
                warm: this._settings.get_int('threshold-ssd-warm'),
                hot: this._settings.get_int('threshold-ssd-hot'),
            },
            nvme: {
                warm: this._settings.get_int('threshold-nvme-warm'),
                hot: this._settings.get_int('threshold-nvme-hot'),
            },
        };

        this._colors = {};
        for (let level of ['cool', 'warm', 'hot', 'na']) {
            this._colors[level] = Domain.sanitizeColor(
                this._settings.get_string(`color-${level}`), Domain.DEFAULT_COLORS[level]);
        }
    }

    _level(temp, kind) {
        return Domain.levelForTemperature(temp, kind, this._thresholds);
    }

    // Ket helyen kell -- a menu sorban es a panel labelen -- ezert egy helyen
    // szamoljuk, kulonben a ket kijelzes elcsuszhatna egymastol.
    _systinLevel() {
        return Domain.systinLevel(this._systin, this._settings.get_int('alert-systin'));
    }

    // Az osztaly a layoutot adja (min-width, font), a szin inline jon -- azt a
    // stiluslap nem tudna, mert futasidoben allithato.
    _paint(actor, baseClass, level) {
        actor.set_style_class_name(`${baseClass} disk-temp-${level}`);
        actor.set_style(`color: ${this._colors[level]};`);
    }

    // A shell tema szabja meg a menu hatteret; a Lavanda peldaul feher (#FFFFFF)
    // hatteret es fekete szoveget hasznal, amiben a mi vilagos labeljeink
    // olvashatatlanok. Ezzel a class-szal sajat sotet hattert kap a dropdown.
    _applyMenuTheme() {
        if (this._settings.get_boolean('dark-menu'))
            this.menu.actor.add_style_class_name('disk-temp-menu');
        else
            this.menu.actor.remove_style_class_name('disk-temp-menu');
    }

    _restartTimer() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }
        if (this._stopped)
            return;

        let interval = this._settings.get_int('refresh-seconds');
        this._timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            if (this._stopped)
                return GLib.SOURCE_REMOVE;

            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _connectUdisks() {
        new ObjectManagerProxy(Gio.DBus.system, UDISKS_NAME, UDISKS_PATH, (proxy, error) => {
            if (this._stopped)
                return;

            if (error) {
                logError(error, 'disk-temps: udisks2 ObjectManager nem elérhető');
                this._render();
                return;
            }

            this._objectManager = proxy;
            this._interfacesAddedId = proxy.connectSignal('InterfacesAdded',
                () => this._queueRebuild());
            this._interfacesRemovedId = proxy.connectSignal('InterfacesRemoved',
                () => this._queueRebuild());
            this._rebuildDrives();
        }, this._cancellable);
    }

    // Hotplug eventek sorozatban jönnek; egy tickbe csomagoljuk őket
    _queueRebuild() {
        if (this._stopped || this._rebuildQueued)
            return;

        this._rebuildQueued = true;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._rebuildQueued = false;
            if (this._stopped)
                return GLib.SOURCE_REMOVE;

            this._rebuildDrives();
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuildDrives() {
        if (!this._objectManager)
            return;

        this._objectManager.GetManagedObjectsRemote((result, error) => {
            if (this._stopped)
                return;

            if (error) {
                logError(error, 'disk-temps: GetManagedObjects hiba');
                return;
            }

            let [objects] = result;

            // teljes lemez block node-ok (partíciók nélkül) → /dev/sdX
            let devByDrive = {};
            for (let path in objects) {
                let ifaces = objects[path];
                let block = ifaces[IFACE_BLOCK];
                if (!block || ifaces[IFACE_PARTITION])
                    continue;

                let drivePath = unwrap(block['Drive']);
                if (!drivePath || drivePath === '/')
                    continue;

                let dev = bytestring(block['PreferredDevice']);
                if (dev)
                    devByDrive[drivePath] = dev;
            }

            let ataDrives = [];
            let nvmeModels = {};

            for (let path in objects) {
                let ifaces = objects[path];
                let drive = ifaces[IFACE_DRIVE];
                if (!drive)
                    continue;

                let dev = devByDrive[path] || null;
                let model = unwrap(drive['Model']) || '';
                let ata = ifaces[IFACE_ATA];

                if (!ata) {
                    // udisks 2.9.4 nem ismeri az NVMe-t: csak a modellnevet visszük el
                    let match = dev ? dev.match(/^(\/dev\/nvme\d+)n\d+$/) : null;
                    if (match)
                        nvmeModels[match[1]] = model;
                    continue;
                }

                let rotation = unwrap(drive['RotationRate']);
                let previous = this._ataDrives.find(d => d.path === path);

                ataDrives.push({
                    path,
                    dev: dev || path.split('/').pop(),
                    model,
                    kind: rotation > 0 ? 'hdd' : 'ssd',
                    type: rotation > 0 ? 'HDD' : 'SSD',
                    temp: Domain.kelvinToCelsius(unwrap(ata['SmartTemperature'])),
                    standby: false,
                    failed: false,
                    proxy: previous ? previous.proxy : null,
                    propsChangedId: previous ? previous.propsChangedId : 0,
                });
            }

            // eltűnt drive-ok proxyjának elengedése
            for (let old of this._ataDrives) {
                if (ataDrives.some(d => d.path === old.path))
                    continue;
                if (old.proxy && old.propsChangedId)
                    old.proxy.disconnect(old.propsChangedId);
            }

            this._ataDrives = ataDrives;

            for (let entry of this._nvmeDrives)
                entry.model = nvmeModels[entry.path] || entry.model;

            for (let drive of this._ataDrives) {
                if (!drive.proxy)
                    this._createAtaProxy(drive);
            }

            // Az ujraenumeralas percenkent lefut; ha a diszkkeszlet nem
            // valtozott, ne epitsuk ujra a menut (nyitott menuben villogna).
            let key = ataDrives.map(d => d.path).sort().join(',');
            if (key === this._ataKey) {
                this._render();
                return;
            }

            if (this._ataKey !== null && this._ataKey !== undefined)
                log(`disk-temps: diszklista valtozott (${ataDrives.length} ATA diszk)`);

            this._ataKey = key;
            this._rebuildRows();
            this._syncPanel(true);
        });
    }

    _createAtaProxy(drive) {
        new AtaProxy(Gio.DBus.system, UDISKS_NAME, drive.path, (proxy, error) => {
            if (this._stopped)
                return;

            if (error) {
                logError(error, `disk-temps: Drive.Ata proxy hiba (${drive.dev})`);
                return;
            }

            drive.proxy = proxy;
            drive.propsChangedId = proxy.connect('g-properties-changed', () => {
                if (this._stopped)
                    return;

                drive.temp = Domain.kelvinToCelsius(proxy.SmartTemperature);
                this._render();
            });
            drive.temp = Domain.kelvinToCelsius(proxy.SmartTemperature);
            this._render();
        }, this._cancellable);
    }

    _refresh() {
        this._readSensors();

        // Periodikus ujraenumeralas. Boot utan az udisks nem feltetlenul adta
        // meg ki minden lemez Drive.Ata interfeszet (a RAID tagoknal a tomb
        // osszeallitasa kozben), es az InterfacesAdded event nem mindig potolja
        // oket -- igy egy induláskor kimaradt diszk orokre kimaradt volna.
        this._ticks = (this._ticks || 0) + 1;
        if (this._ticks % REDISCOVER_TICKS === 0)
            this._rebuildDrives();

        for (let drive of this._ataDrives) {
            if (!drive.proxy)
                continue;

            // nowakeup: standby lemezt nem pörgetünk fel puszta kijelzésért
            drive.proxy.SmartUpdateRemote({ nowakeup: GLib.Variant.new_boolean(true) },
                (result, error) => {
                    if (this._stopped)
                        return;

                    if (error) {
                        if (error.message && error.message.indexOf('WouldWakeup') >= 0) {
                            drive.standby = true;
                        } else if (!this._smartFailLogged) {
                            logError(error, `disk-temps: SmartUpdate hiba (${drive.dev})`);
                            this._smartFailLogged = true;
                        }
                    } else {
                        drive.standby = false;
                        drive.temp = Domain.kelvinToCelsius(drive.proxy.SmartTemperature);
                    }

                    this._lastUpdate = new Date();
                    this._render();
                });
        }

        if (this._nvmeBusy === 0) {
            for (let entry of this._nvmeDrives)
                this._readNvme(entry);
        }

        if (this._ataDrives.length === 0)
            this._render();
    }

    _readNvme(entry) {
        let proc;
        try {
            proc = Gio.Subprocess.new(
                [SUDO, '-n', NVME, 'smart-log', '-o', 'json', entry.path],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            entry.temp = null;
            entry.failed = true;
            if (!this._nvmeFailLogged) {
                logError(e, 'disk-temps: nvme spawn hiba');
                this._nvmeFailLogged = true;
            }
            this._render();
            return;
        }

        this._nvmeBusy++;
        proc.communicate_utf8_async(null, this._cancellable, (p, res) => {
            this._nvmeBusy--;
            if (this._stopped)
                return;

            try {
                let [, stdout, stderr] = p.communicate_utf8_finish(res);
                if (!p.get_successful()) {
                    let detail = (stderr || '').trim() || `exit ${p.get_exit_status()}`;
                    throw new Error(`${entry.path}: ${detail}`);
                }

                let data = JSON.parse(stdout);
                entry.temp = Domain.kelvinToCelsius(data.temperature);
                entry.failed = false;
            } catch (e) {
                entry.temp = null;
                entry.failed = true;
                if (!this._nvmeFailLogged) {
                    logError(e, 'disk-temps: nvme smart-log olvasás sikertelen');
                    this._nvmeFailLogged = true;
                }
            }

            this._lastUpdate = new Date();
            this._render();
        });
    }

    _allDrives() {
        return this._ataDrives.concat(this._nvmeDrives);
    }

    // sysfs olvasas, par mikroszekundum -- nem kell async
    _readSensors() {
        if (!this._hwmon)
            return;

        let raw = readSysfsInt(`${this._hwmon}/temp1_input`);
        this._systin = raw === null ? null : Math.round(raw / 1000);

        let fans = [];
        for (let i = 1; i <= HWMON_FAN_CHANNELS; i++) {
            let rpm = readSysfsInt(`${this._hwmon}/fan${i}_input`);
            if (rpm === null)
                continue;

            if (rpm > 0)
                this._fanSeen.add(i);
            if (!this._fanSeen.has(i))
                continue;   // ures header, sose forgott -- nem listazzuk

            let pwm = readSysfsInt(`${this._hwmon}/pwm${i}`);
            fans.push({
                index: i,
                rpm,
                duty: pwm === null ? null : Math.round(pwm * 100 / 255),
            });
        }
        this._fans = fans;
    }

    // Mi indokol riasztast? A tapra kotott ventilatorok RPM-je nem olvashato
    // (a tacho vezetek nincs bekotve), ezert a kovetkezmenyt figyeljuk:
    // haz-ambient, HDD homerseklet, es a mar ismert ventilatorok leallasa.
    _alerts() {
        let list = [];

        let sysLimit = this._settings.get_int('alert-systin');
        if (sysLimit > 0 && this._systin !== null && this._systin >= sysLimit)
            list.push(`SYSTIN ${this._systin}°C (≥${sysLimit})`);

        let hddLimit = this._settings.get_int('alert-hdd');
        if (hddLimit > 0) {
            for (let drive of this._ataDrives) {
                if (drive.kind === 'hdd' && drive.temp !== null && drive.temp >= hddLimit)
                    list.push(`${Domain.shortDevice(drive.dev)} ${drive.temp}°C (≥${hddLimit})`);
            }
        }

        for (let fan of this._fans) {
            if (fan.rpm === 0)
                list.push(`fan${fan.index}${FAN_NAMES[fan.index] ? ' (' + FAN_NAMES[fan.index] + ')' : ''} áll`);
        }

        return list;
    }

    _panelDrives() {
        let drives = this._allDrives().slice();
        if (this._settings.get_boolean('panel-only-warm'))
            drives = drives.filter(d => Domain.needsAttention(d, this._thresholds));

        if (this._settings.get_string('panel-order') === 'temperature')
            return drives.sort(Domain.compareDrivesByTemperature);

        return drives.sort(Domain.compareDevices);
    }

    // egy panel-label szovege: [dev] [tipus] hofok
    _panelText(drive) {
        let value;
        if (drive.temp === null)
            value = drive.failed ? 'n/a' : '–';
        else
            value = `${drive.temp}°`;

        let parts = [];
        if (this._settings.get_boolean('show-dev-label'))
            parts.push(Domain.shortDevice(drive.dev));
        if (this._settings.get_boolean('show-type'))
            parts.push(drive.type || '');
        parts.push(value);

        return parts.filter(p => p !== '').join(' ');
    }

    // A panel-labelek egyszer készülnek el; a render csak a szövegüket írja át.
    // force=true → struktúra újraépítése (mód-, sorrend- vagy diszklista-váltás).
    // Mibol all a panel felepitese. Egy helyen szamoljuk, hogy a _syncPanel es a
    // _render ne tudjon elcsuszni egymastol (kulonben vegtelen ujraepites lenne).
    _structureKey(drives) {
        return [
            this._settings.get_string('panel-mode'),
            this._settings.get_boolean('show-dev-label'),
            this._settings.get_boolean('show-icon'),
            this._settings.get_boolean('show-type'),
            this._settings.get_boolean('panel-only-warm'),
            // a SYSTIN label jon/megy, tehat a szerkezet resze; a szenzor
            // elerhetosege is, kulonben egy kesobb megtalalt hwmon nem jelenne meg
            this._settings.get_boolean('show-systin'),
            this._hwmon !== null,
            drives.map(d => d.dev).join(','),
        ].join('|');
    }

    _syncPanel(force) {
        if (this._stopped)
            return;

        let mode = this._settings.get_string('panel-mode');
        let showIcon = this._settings.get_boolean('show-icon');
        let drives = this._panelDrives();
        let structure = this._structureKey(drives);

        if (force || structure !== this._panelStructure) {
            this._panelBox.destroy_all_children();
            this._panelItems.clear();
            this._panelIcon = null;
            this._panelStructure = structure;

            if (showIcon) {
                this._panelIcon = new St.Icon({
                    gicon: Gio.icon_new_for_string(ICON_FILE),
                    style_class: 'system-status-icon disk-temp-icon',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._panelBox.add_child(this._panelIcon);
            }

            // Haz hofok fix helyen, a diszkek ELOTT: a diszklista hossza a
            // szuresstol fugg, a haz-ertek nem ugralhat vizszintesen.
            // Ha nincs nct6798, a label meg se jelenjen -- ne foglaljon helyet
            // egy orok n/a.
            if (this._settings.get_boolean('show-systin') && this._hwmon !== null) {
                let label = new St.Label({
                    text: 'ház …',
                    style_class: 'disk-temp-panel-item',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._panelBox.add_child(label);
                this._panelItems.set('__systin__', label);
            }

            if (mode === 'hottest') {
                let label = new St.Label({
                    text: '…',
                    style_class: 'disk-temp-panel-item',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._panelBox.add_child(label);
                this._panelItems.set('__hottest__', label);
            } else if (drives.length === 0) {
                // szures aktiv es minden diszk hideg -- ne maradjon puszta ikon
                let label = new St.Label({
                    text: 'OK',
                    style_class: 'disk-temp-panel-item disk-temp-cool',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._panelBox.add_child(label);
                this._panelItems.set('__ok__', label);
            } else {
                for (let drive of drives) {
                    let label = new St.Label({
                        text: '…',
                        style_class: 'disk-temp-panel-item',
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    this._panelBox.add_child(label);
                    this._panelItems.set(drive.dev, label);
                }
            }
        }

        this._render();
    }

    _render() {
        if (this._stopped)
            return;

        let drives = this._allDrives();
        if (drives.length !== this._rows.size)
            this._rebuildRows();

        // panel struktúra követi a sorrend-beállítást és a diszklistát
        let mode = this._settings.get_string('panel-mode');
        let panelDrives = this._panelDrives();
        if (this._structureKey(panelDrives) !== this._panelStructure) {
            this._syncPanel(true);
            return;
        }

        let hottest = null;
        let hottestKind = 'ssd';
        let hottestDrive = null;
        for (let drive of drives) {
            if (drive.temp !== null && (hottest === null || drive.temp > hottest)) {
                hottest = drive.temp;
                hottestKind = drive.kind;
                hottestDrive = drive;
            }
        }

        // --- ház-szenzorok és riasztás ---
        this._renderSensors();
        let alerts = this._alerts();
        if (alerts.length > 0) {
            this._alertItem.label.set_text(`⚠ ${alerts.join('  ·  ')}`);
            // a riasztas sor is a beallitott "forro" szint hasznalja
            this._alertItem.label.set_style(`color: ${this._colors.hot}; font-weight: bold;`);
            this._alertItem.visible = true;
        } else {
            this._alertItem.visible = false;
        }

        // --- panel ---
        // az ikon a legsúlyosabb diszk-állapotot mutatja; riasztás felülírja
        if (this._panelIcon) {
            let level = alerts.length > 0
                ? 'hot'
                : Domain.worstLevel(drives, this._thresholds);
            this._paint(this._panelIcon, 'system-status-icon disk-temp-icon', level);
        }

        // ház hőfok: mindkét panel-mode-ban, a szűréstől függetlenül
        let systinLabel = this._panelItems.get('__systin__');
        if (systinLabel) {
            systinLabel.set_text(this._systin === null ? 'ház n/a' : `ház ${this._systin}°`);
            this._paint(systinLabel, 'disk-temp-panel-item', this._systinLevel());
        }

        if (mode === 'hottest') {
            let label = this._panelItems.get('__hottest__');
            if (label) {
                if (hottest === null) {
                    label.set_text('n/a');
                    this._paint(label, 'disk-temp-panel-item', 'na');
                } else {
                    let type = this._settings.get_boolean('show-type') && hottestDrive
                        ? `${hottestDrive.type} ` : '';
                    label.set_text(`${type}${hottest}°C`);
                    this._paint(label, 'disk-temp-panel-item', this._level(hottest, hottestKind));
                }
            }
        } else {
            let okLabel = this._panelItems.get('__ok__');
            if (okLabel) {
                // Minden diszk a sarga kuszob alatt. Ha viszont riasztas van
                // (meleg haz vagy leallt ventilator), az kerul ide -- kulonben
                // egy "OK" moge rejtenenk el a problemat.
                if (alerts.length > 0) {
                    okLabel.set_text(alerts[0]);
                    this._paint(okLabel, 'disk-temp-panel-item', 'hot');
                } else {
                    okLabel.set_text(hottest === null ? 'n/a' : `OK ${hottest}°`);
                    this._paint(okLabel, 'disk-temp-panel-item', 'cool');
                }
            }

            for (let drive of panelDrives) {
                let label = this._panelItems.get(drive.dev);
                if (!label)
                    continue;

                label.set_text(this._panelText(drive));
                this._paint(label, 'disk-temp-panel-item', this._level(drive.temp, drive.kind));
            }
        }

        // --- menü: mindig hőfok szerint csökkenő ---
        let sorted = drives.slice().sort(Domain.compareDrivesByTemperature);
        sorted.forEach((drive, index) => {
            let row = this._rows.get(drive.dev);
            if (!row)
                return;

            row.typeLabel.set_text(drive.type || '');
            row.modelLabel.set_text(Domain.shortModel(drive.model));

            let text;
            if (drive.temp === null)
                text = drive.failed ? 'n/a' : '–';
            else if (drive.standby)
                text = `${drive.temp} °C (standby)`;
            else
                text = `${drive.temp} °C`;

            row.tempLabel.set_text(text);
            this._paint(row.tempLabel, 'disk-temp-value', this._level(drive.temp, drive.kind));
            this._section.moveMenuItem(row.item, index);
        });

        let stamp = this._lastUpdate ? this._lastUpdate.toLocaleTimeString() : '–';
        let footer = `Frissítve: ${stamp}`;
        if (this._nvmeDrives.some(d => d.failed))
            footer += ' · NVMe: sudo olvasás sikertelen';

        this._footer.label.set_text(footer);
    }

    // Szenzor-sorok: SYSTIN + azok a ventilátorok, amiket már láttunk forogni.
    _syncSensorRows() {
        let show = this._settings.get_boolean('show-sensors') && this._hwmon !== null;
        let key = show ? `on|${this._fans.map(f => f.index).join(',')}` : 'off';
        if (key === this._sensorStructure)
            return;

        this._sensorStructure = key;
        this._sensorSection.removeAll();
        this._sensorRows.clear();
        if (!show)
            return;

        let makeRow = (id, name) => {
            let item = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
            });
            let nameLabel = new St.Label({
                text: name,
                style_class: 'disk-temp-sensor-name',
                y_align: Clutter.ActorAlign.CENTER,
            });
            let valueLabel = new St.Label({
                text: '–',
                style_class: 'disk-temp-value',
                y_align: Clutter.ActorAlign.CENTER,
            });
            item.add_child(nameLabel);
            item.add_child(valueLabel);
            this._sensorRows.set(id, { item, nameLabel, valueLabel });
            this._sensorSection.addMenuItem(item);
        };

        makeRow('systin', 'ház (SYSTIN)');
        for (let fan of this._fans)
            makeRow(`fan${fan.index}`, this._fanLabel(fan.index));
    }

    _fanLabel(index) {
        return FAN_NAMES[index] ? `fan${index} (${FAN_NAMES[index]})` : `fan${index}`;
    }

    _renderSensors() {
        this._syncSensorRows();
        if (this._sensorRows.size === 0)
            return;

        let sys = this._sensorRows.get('systin');
        if (sys) {
            sys.valueLabel.set_text(this._systin === null ? 'n/a' : `${this._systin} °C`);
            this._paint(sys.valueLabel, 'disk-temp-value', this._systinLevel());
        }

        for (let fan of this._fans) {
            let row = this._sensorRows.get(`fan${fan.index}`);
            if (!row)
                continue;

            let text = fan.rpm === 0 ? 'ÁLL' : `${fan.rpm} RPM`;
            if (fan.duty !== null)
                text += ` · ${fan.duty}%`;

            row.valueLabel.set_text(text);
            this._paint(row.valueLabel, 'disk-temp-value', fan.rpm === 0 ? 'hot' : 'cool');
        }
    }

    // A menüsorok is egyszer készülnek el — nyitott menüben nem villog a lista.
    _rebuildRows() {
        this._section.removeAll();
        this._rows.clear();

        for (let drive of this._allDrives()) {
            let item = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
            });

            let devLabel = new St.Label({
                text: Domain.shortDevice(drive.dev),
                style_class: 'disk-temp-dev',
                y_align: Clutter.ActorAlign.CENTER,
            });
            let typeLabel = new St.Label({
                text: drive.type || '',
                style_class: 'disk-temp-type',
                y_align: Clutter.ActorAlign.CENTER,
            });
            let modelLabel = new St.Label({
                text: Domain.shortModel(drive.model),
                style_class: 'disk-temp-model',
                y_align: Clutter.ActorAlign.CENTER,
            });
            let tempLabel = new St.Label({
                text: '–',
                style_class: 'disk-temp-value',
                y_align: Clutter.ActorAlign.CENTER,
            });

            item.add_child(devLabel);
            item.add_child(typeLabel);
            item.add_child(modelLabel);
            item.add_child(tempLabel);

            this._rows.set(drive.dev, { item, devLabel, typeLabel, modelLabel, tempLabel });
            this._section.addMenuItem(item);
        }
    }

    stop() {
        this._stopped = true;

        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }

        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        for (let id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];

        if (this._objectManager) {
            if (this._interfacesAddedId)
                this._objectManager.disconnectSignal(this._interfacesAddedId);
            if (this._interfacesRemovedId)
                this._objectManager.disconnectSignal(this._interfacesRemovedId);
            this._objectManager = null;
        }

        for (let drive of this._ataDrives) {
            if (drive.proxy && drive.propsChangedId)
                drive.proxy.disconnect(drive.propsChangedId);
            drive.proxy = null;
        }

        this._ataDrives = [];
        this._nvmeDrives = [];
        this._rows.clear();
        this._sensorRows.clear();
        this._fans = [];
        this._fanSeen.clear();
        this._panelItems.clear();
        this._panelIcon = null;
        this.menu.removeAll();
    }
});

let diskTempsButton = null;
let settings = null;
let positionIds = [];

function addToPanel() {
    diskTempsButton = new DiskTempsButton(settings);
    Main.panel.addToStatusArea('disk-temps', diskTempsButton,
        settings.get_int('panel-index'),
        settings.get_string('panel-position'));
}

function removeFromPanel() {
    if (diskTempsButton) {
        diskTempsButton.stop();
        diskTempsButton.destroy();
        diskTempsButton = null;
    }
}

// panel-position / panel-index csak újralétrehozással mozdítható
function repositionIndicator() {
    removeFromPanel();
    addToPanel();
}

function init() {
}

function enable() {
    settings = ExtensionUtils.getSettings();
    positionIds = [
        settings.connect('changed::panel-position', () => repositionIndicator()),
        settings.connect('changed::panel-index', () => repositionIndicator()),
    ];
    addToPanel();
}

function disable() {
    removeFromPanel();

    for (let id of positionIds)
        settings.disconnect(id);
    positionIds = [];
    settings = null;
}
