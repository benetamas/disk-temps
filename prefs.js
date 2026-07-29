// vim: set sw=4 sts=4 et:
// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

imports.gi.versions.Gtk = '4.0';

const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const I18n = Me.imports.i18n;

function init() {
    ExtensionUtils.initTranslations(Me.metadata['gettext-domain']);
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

function buildPrefsPage(settings, language) {
    let _ = I18n.createTranslator(language, `${Me.path}/locale`);

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

    addRow(grid, row++, _('Language'),
        comboFor(settings, 'language', [
            ['en', 'English'],
            ['de', 'Deutsch'],
            ['hu', 'Magyar'],
        ]),
        _('Language used by this extension. Changes apply immediately.'));

    addRow(grid, row++, _('Panel position'),
        comboFor(settings, 'panel-position', [
            ['left', _('Left')],
            ['center', _('Center')],
            ['right', _('Right')],
        ]),
        _('The section of the GNOME panel where the indicator is placed.'));

    addRow(grid, row++, _('Position in section'),
        spinFor(settings, 'panel-index', -1, 20),
        _('−1 places it at the end. In the left section, 0 is the first position after Activities.'));

    addRow(grid, row++, _('Panel content'),
        comboFor(settings, 'panel-mode', [
            ['all', _('All disk temperatures')],
            ['hottest', _('Hottest only')],
        ]),
        _('The drop-down menu always shows every detected disk.'));

    let iconSwitch = new Gtk.Switch({ active: settings.get_boolean('show-icon') });
    settings.bind('show-icon', iconSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    addRow(grid, row++, _('Thermometer icon'), iconSwitch,
        _('Show an icon before the temperatures. Its color follows the most severe disk state.'));

    let devSwitch = new Gtk.Switch({ active: settings.get_boolean('show-dev-label') });
    settings.bind('show-dev-label', devSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    addRow(grid, row++, _('Device label in panel'), devSwitch,
        _('Show the device name before its temperature: “sdb 54°” instead of just “54°”.'));

    let typeSwitch = new Gtk.Switch({ active: settings.get_boolean('show-type') });
    settings.bind('show-type', typeSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    addRow(grid, row++, _('Show disk type'), typeSwitch,
        _('Show an HDD, SSD, or NVMe label next to the temperature: “sdb HDD 54°”.'));

    let warmSwitch = new Gtk.Switch({ active: settings.get_boolean('panel-only-warm') });
    settings.bind('panel-only-warm', warmSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    addRow(grid, row++, _('Only warm or hotter disks'), warmSwitch,
        _('Show only disks at or above their warm threshold and disks with read errors. When all disks are cool, show “OK 32°”. The menu still shows every disk.'));

    let systinSwitch = new Gtk.Switch({ active: settings.get_boolean('show-systin') });
    settings.bind('show-systin', systinSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    addRow(grid, row++, _('System temperature in panel'), systinSwitch,
        _('Show the detected SYSTIN, System, Motherboard, or Ambient hwmon sensor after the icon, using its own name. Disk filtering does not hide it.'));

    addRow(grid, row++, _('Panel order'),
        comboFor(settings, 'panel-order', [
            ['device', _('Device name (fixed)')],
            ['temperature', _('Hottest first')],
        ]),
        _('A fixed order prevents values from changing places.'));

    addRow(grid, row++, _('Refresh interval (seconds)'),
        spinFor(settings, 'refresh-seconds', 1, 300),
        _('SMART reading interval. Default: 5.'));

    let darkSwitch = new Gtk.Switch({ active: settings.get_boolean('dark-menu') });
    settings.bind('dark-menu', darkSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    addRow(grid, row++, _('Dark drop-down menu'), darkSwitch,
        _('Use a dark menu background independently of the shell theme. Secondary text can be difficult to read with this disabled on light themes.'));

    let sensorSwitch = new Gtk.Switch({ active: settings.get_boolean('show-sensors') });
    settings.bind('show-sensors', sensorSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    addRow(grid, row++, _('System sensors in menu'), sensorSwitch,
        _('Show the detected system temperature and measurable fans from the same motherboard hwmon device. A fan is monitored after it has reported a positive speed.'));

    addRow(grid, row++, _('Alert: system temperature (°C)'),
        spinFor(settings, 'alert-systin', 0, 90),
        _('Default: 44. The indicator turns warm 3 °C earlier. Sensor placement depends on the motherboard, so adjust this value for the machine if necessary. 0 disables the alert.'));

    addRow(grid, row++, _('Alert: HDD (°C)'),
        spinFor(settings, 'alert-hdd', 0, 90),
        _('Alert threshold for any hard disk. Default: 50. 0 disables the alert.'));

    addSection(grid, row++, _('Thresholds'));

    addRow(grid, row++, _('HDD warm (°C)'),
        spinFor(settings, 'threshold-hdd-warm', 0, 100),
        _('Default: 45. Provides an early warning before the 50 °C normal-range boundary.'));

    addRow(grid, row++, _('HDD hot (°C)'),
        spinFor(settings, 'threshold-hdd-hot', 0, 100),
        _('A hard disk is hot from this temperature. Default: 50; many drives specify 60 °C as their maximum.'));

    addRow(grid, row++, _('SATA SSD warm (°C)'),
        spinFor(settings, 'threshold-ssd-warm', 0, 100),
        _('Default: 55. SATA SSDs commonly specify 70 °C as their upper operating temperature.'));

    addRow(grid, row++, _('SATA SSD hot (°C)'),
        spinFor(settings, 'threshold-ssd-hot', 0, 100),
        _('Default: 65. Sustained operation above this point calls for better cooling.'));

    addRow(grid, row++, _('NVMe warm (°C)'),
        spinFor(settings, 'threshold-nvme-warm', 0, 100),
        _('Default: 60. Provides an early warning before the 70 °C operating limit.'));

    addRow(grid, row++, _('NVMe hot (°C)'),
        spinFor(settings, 'threshold-nvme-hot', 0, 100),
        _('Default: 70. This is a common upper operating limit and NVMe warning point.'));

    addSection(grid, row++, _('Colors'));

    addRow(grid, row++, _('Cool'), colorFor(settings, 'color-cool'),
        _('Color used below the warm threshold.'));
    addRow(grid, row++, _('Warm'), colorFor(settings, 'color-warm'),
        _('Color used between the warm and hot thresholds.'));
    addRow(grid, row++, _('Hot'), colorFor(settings, 'color-hot'),
        _('Color used above the hot threshold. Alerts and the alert icon use it too.'));
    addRow(grid, row++, _('Unknown / read error'), colorFor(settings, 'color-na'),
        _('Color used when a reading failed (n/a) or no data is available yet.'));

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

function buildPrefsWidget() {
    let settings = ExtensionUtils.getSettings();
    let stack = new Gtk.Stack({
        hexpand: true,
        vexpand: true,
    });

    for (let language of ['en', 'de', 'hu'])
        stack.add_named(buildPrefsPage(settings, language), language);

    stack.set_visible_child_name(settings.get_string('language'));
    settings.connect('changed::language', () => {
        stack.set_visible_child_name(settings.get_string('language'));
    });

    return stack;
}
