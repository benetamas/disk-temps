// vim: set sw=4 sts=4 et:
// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

imports.gi.versions.Gtk = '4.0';

const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;

const ExtensionUtils = imports.misc.extensionUtils;

function init() {
}

function addSection(grid, row, title) {
    let label = new Gtk.Label({
        label: `<b>${title}</b>`,
        use_markup: true,
        halign: Gtk.Align.START,
        margin_top: row === 0 ? 0 : 12,
    });
    grid.attach(label, 0, row, 2, 1);
}

// GSettings-ben #rrggbb-t tarolunk; a Gtk.ColorButton Gdk.RGBA-val dolgozik.
function colorFor(settings, key) {
    let rgba = new Gdk.RGBA();
    if (!rgba.parse(settings.get_string(key)))
        rgba.parse('#ffffff');

    let button = new Gtk.ColorButton({ rgba });
    button.connect('color-set', () => {
        let c = button.get_rgba();
        let hex = '#' + [c.red, c.green, c.blue]
            .map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
        settings.set_string(key, hex);
    });
    settings.connect(`changed::${key}`, () => {
        let next = new Gdk.RGBA();
        if (next.parse(settings.get_string(key)) && !next.equal(button.get_rgba()))
            button.set_rgba(next);
    });

    return button;
}

function addRow(grid, row, labelText, widget, hint) {
    let label = new Gtk.Label({
        label: labelText,
        halign: Gtk.Align.START,
        hexpand: true,
    });

    if (hint) {
        let box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 2,
            hexpand: true,
        });
        let hintLabel = new Gtk.Label({
            label: `<small>${hint}</small>`,
            use_markup: true,
            halign: Gtk.Align.START,
            wrap: true,
        });
        hintLabel.add_css_class('dim-label');
        box.append(label);
        box.append(hintLabel);
        grid.attach(box, 0, row, 1, 1);
    } else {
        grid.attach(label, 0, row, 1, 1);
    }

    widget.set_halign(Gtk.Align.END);
    widget.set_valign(Gtk.Align.CENTER);
    grid.attach(widget, 1, row, 1, 1);
}

function comboFor(settings, key, options) {
    let combo = new Gtk.ComboBoxText();
    for (let [id, text] of options)
        combo.append(id, text);

    combo.set_active_id(settings.get_string(key));
    combo.connect('changed', () => {
        let id = combo.get_active_id();
        if (id && id !== settings.get_string(key))
            settings.set_string(key, id);
    });
    settings.connect(`changed::${key}`, () => {
        let id = settings.get_string(key);
        if (id !== combo.get_active_id())
            combo.set_active_id(id);
    });

    return combo;
}

function spinFor(settings, key, min, max) {
    let spin = Gtk.SpinButton.new_with_range(min, max, 1);
    spin.set_value(settings.get_int(key));
    settings.bind(key, spin, 'value', Gio.SettingsBindFlags.DEFAULT);
    return spin;
}

function buildPrefsWidget() {
    let settings = ExtensionUtils.getSettings();

    let grid = new Gtk.Grid({
        column_spacing: 24,
        row_spacing: 14,
        margin_top: 24,
        margin_bottom: 24,
        margin_start: 24,
        margin_end: 24,
        column_homogeneous: false,
        valign: Gtk.Align.START,   // ne nyuljon, a ScrolledWindow gorgesse
    });

    let row = 0;

    addRow(grid, row++, 'Panel oldal',
        comboFor(settings, 'panel-position', [
            ['left', 'Bal'],
            ['center', 'Közép'],
            ['right', 'Jobb'],
        ]),
        'A GNOME panel melyik boxába kerüljön az indikátor.');

    addRow(grid, row++, 'Pozíció a boxban',
        spinFor(settings, 'panel-index', -1, 20),
        '−1 = a box végére. Balra 0 = az Activities után az első hely.');

    addRow(grid, row++, 'Panel tartalom',
        comboFor(settings, 'panel-mode', [
            ['all', 'Minden diszk hőfoka'],
            ['hottest', 'Csak a legmelegebb'],
        ]),
        'A legördülő menüben mindig mind a hét diszk látszik.');

    let iconSwitch = new Gtk.Switch({ active: settings.get_boolean('show-icon') });
    settings.bind('show-icon', iconSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    addRow(grid, row++, 'Hőmérő ikon', iconSwitch,
        'Ikon a hőfokok előtt. Színe a legmelegebb diszket követi.');

    let devSwitch = new Gtk.Switch({ active: settings.get_boolean('show-dev-label') });
    settings.bind('show-dev-label', devSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    addRow(grid, row++, 'Dev címke a panelen', devSwitch,
        'Hőfok elé kiírja az eszköznevet: „sdb 54°” a puszta „54°” helyett.');

    let typeSwitch = new Gtk.Switch({ active: settings.get_boolean('show-type') });
    settings.bind('show-type', typeSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    addRow(grid, row++, 'Diszktípus kiírása', typeSwitch,
        'HDD / SSD / NVMe címke a hőfok mellett: „sdb HDD 54°”.');

    let warmSwitch = new Gtk.Switch({ active: settings.get_boolean('panel-only-warm') });
    settings.bind('panel-only-warm', warmSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    addRow(grid, row++, 'Csak a sárga vagy melegebb', warmSwitch,
        'A panelen csak a saját küszöbüket elért diszkek (HDD 45 °C, SATA SSD 55 °C, NVMe 60 °C) és a hibás olvasások. Ha mind hideg: „OK 32°”. A menüben mindig mind látszik.');

    let systinSwitch = new Gtk.Switch({ active: settings.get_boolean('show-systin') });
    settings.bind('show-systin', systinSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    addRow(grid, row++, 'Ház hőfok a panelen', systinSwitch,
        'A SYSTIN a panelen, az ikon után: „ház 38°”. Ez vezérli a ventilátor-görbét és előbb emelkedik, mint a lemezek — a szűrés nem érinti, hidegen is látszik. Színe a SYSTIN riasztási küszöbhöz igazodik.');

    addRow(grid, row++, 'Panel sorrend',
        comboFor(settings, 'panel-order', [
            ['device', 'Eszköznév (fix)'],
            ['temperature', 'Legmelegebb elöl'],
        ]),
        'Fix sorrendnél nem ugrálnak az értékek egymás helyére.');

    addRow(grid, row++, 'Frissítés (másodperc)',
        spinFor(settings, 'refresh-seconds', 1, 300),
        'SMART olvasás gyakorisága. Default 5.');

    let darkSwitch = new Gtk.Switch({ active: settings.get_boolean('dark-menu') });
    settings.bind('dark-menu', darkSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    addRow(grid, row++, 'Sötét lenyíló menü', darkSwitch,
        'Saját sötét háttér a menünek, a shell témától függetlenül. Kikapcsolva világos témán (Lavanda: fehér menü) a másodlagos szövegek nehezen olvashatók.');

    let sensorSwitch = new Gtk.Switch({ active: settings.get_boolean('show-sensors') });
    settings.bind('show-sensors', sensorSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    addRow(grid, row++, 'Ház-szenzorok a menüben', sensorSwitch,
        'SYSTIN (ház-ambient) és a mérhető ventilátorok RPM-je. Ami egyszer forgott, azt onnantól figyeli — ha leáll, „ÁLL” lesz belőle.');

    addRow(grid, row++, 'Riasztás: SYSTIN (°C)',
        spinFor(settings, 'alert-systin', 0, 90),
        'Ház-ambient küszöb. Default 44; 41 °C-tól sárga, 44 °C-tól piros. 0 = kikapcsolva.');

    addRow(grid, row++, 'Riasztás: HDD (°C)',
        spinFor(settings, 'alert-hdd', 0, 90),
        'Bármely merevlemez küszöbe. Default 50. A tápra kötött ventilátorok RPM-je nem olvasható, ezért a következményt figyeljük. 0 = kikapcsolva.');

    addSection(grid, row++, 'Küszöbök');

    addRow(grid, row++, 'HDD sárga (°C)',
        spinFor(settings, 'threshold-hdd-warm', 0, 100),
        'Default 45. Korai figyelmeztetés az 50 °C-os normál tartományhatár előtt.');

    addRow(grid, row++, 'HDD piros (°C)',
        spinFor(settings, 'threshold-hdd-hot', 0, 100),
        'Merevlemez ettől számít forrónak. Default 50, a WD spec max 60.');

    addRow(grid, row++, 'SATA SSD sárga (°C)',
        spinFor(settings, 'threshold-ssd-warm', 0, 100),
        'Default 55. A SATA SSD-k üzemi felső határa tipikusan 70 °C.');

    addRow(grid, row++, 'SATA SSD piros (°C)',
        spinFor(settings, 'threshold-ssd-hot', 0, 100),
        'Default 65. Efölött tartósan már javítani kell a hűtést.');

    addRow(grid, row++, 'NVMe sárga (°C)',
        spinFor(settings, 'threshold-nvme-warm', 0, 100),
        'Default 60. Korai figyelmeztetés a 70 °C-os üzemi határ előtt.');

    addRow(grid, row++, 'NVMe piros (°C)',
        spinFor(settings, 'threshold-nvme-hot', 0, 100),
        'Default 70, a gyártói üzemi felső határ és az NVMe ajánlott figyelmeztetési pont.');

    addSection(grid, row++, 'Színek');

    addRow(grid, row++, 'Hideg', colorFor(settings, 'color-cool'),
        'A küszöbök alatti hőfokok színe.');
    addRow(grid, row++, 'Meleg', colorFor(settings, 'color-warm'),
        'A sárga küszöb és a piros közötti sáv.');
    addRow(grid, row++, 'Forró', colorFor(settings, 'color-hot'),
        'A piros küszöb fölött. A riasztás sor és a riasztó ikon is ezt használja.');
    addRow(grid, row++, 'Ismeretlen / hibás', colorFor(settings, 'color-na'),
        'Ha az olvasás nem sikerült (n/a), vagy még nincs adat.');

    // A GNOME 40 prefs ablaka fix meretu es a widgetet nem gorgeti, csak
    // levagja -- 14 sorral mar nem latszott az alja. ScrolledWindow-ba tesszuk.
    // min_content_* adja a kert kezdomeretet; a natural height-et NEM
    // propagaljuk, kulonben ugyanolyan magas maradna, mint a grid, es semmit
    // nem javitanank.
    let scrolled = new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        propagate_natural_height: false,
        min_content_height: 560,
        min_content_width: 640,
        hexpand: true,
        vexpand: true,
    });
    scrolled.set_child(grid);

    return scrolled;
}
