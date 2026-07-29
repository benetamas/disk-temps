# Disk Temperatures

A GNOME Shell 40 extension that monitors HDD, SATA SSD, and NVMe temperatures
from one panel indicator. The drop-down menu lists every detected disk by
temperature, while the panel can show all disks, only the hottest disk, or
only disks that need attention.

## Data sources and automatic discovery

| Device | Source | Privileges |
|---|---|---|
| ATA HDD and SATA SSD | UDisks2 D-Bus: `Drive.Ata.SmartUpdate()` and `SmartTemperature` | None under the usual active-session policy |
| NVMe SSD | Kernel `hwmon`, falling back to the detected `nvme-cli` | Usually none; optional `sudo -n` fallback on restricted systems |
| System temperature and fans | Detected sensors under `/sys/class/hwmon` | None |

The extension discovers NVMe controllers under `/sys/class/nvme`, so device
names and counts are not hard-coded. It first uses the kernel NVMe `hwmon`
temperature. If that is unavailable, it locates `nvme` through `PATH` and
common system directories, runs it directly, and only then tries `sudo -n`.
The extension never displays a password prompt.

If the machine requires a NOPASSWD rule for NVMe access, configure it for the
actual executable reported by:

```bash
command -v nvme
```

ATA SMART updates use the `nowakeup` option, so a sleeping disk is not spun up
only to refresh the indicator. Authorization for explicit SMART updates is
controlled by the distribution's UDisks2/Polkit policy.

## Preferences

Open the preferences from the menu or run:

```bash
gnome-extensions prefs disk-temps@lycantrop.hu
```

Changes take effect immediately.

| Key | Default | Description |
|---|---|---|
| `language` | `en` | Extension language: `en`, `de`, or `hu` |
| `panel-position` | `left` | GNOME panel section: `left`, `center`, or `right` |
| `panel-index` | `-1` | Position in the selected section; `-1` means the end |
| `panel-mode` | `all` | `all` shows selected disks; `hottest` shows one value |
| `show-icon` | `true` | Show the thermometer icon |
| `show-dev-label` | `true` | Show device names such as `sdb` or `nvme0` |
| `show-type` | `true` | Show HDD, SSD, or NVMe next to the temperature |
| `panel-only-warm` | `true` | Show only warm/hot disks and read failures |
| `panel-order` | `device` | Fixed device order or hottest first |
| `refresh-seconds` | `5` | Temperature refresh interval |
| `threshold-hdd-warm` | `45` | HDD warm threshold in °C |
| `threshold-hdd-hot` | `50` | HDD hot threshold in °C |
| `threshold-ssd-warm` | `55` | SATA SSD warm threshold in °C |
| `threshold-ssd-hot` | `65` | SATA SSD hot threshold in °C |
| `threshold-nvme-warm` | `60` | NVMe warm threshold in °C |
| `threshold-nvme-hot` | `70` | NVMe hot threshold in °C |
| `color-cool` | `#8ff0a4` | Cool color |
| `color-warm` | `#f8e45c` | Warm color |
| `color-hot` | `#ff7b63` | Hot and alert color |
| `color-na` | `#8c8c94` | Unknown/read-error color |
| `dark-menu` | `true` | Use an extension-provided dark menu background |
| `show-systin` | `true` | Show the detected system temperature in the panel |
| `show-sensors` | `true` | Show system temperature and measurable fans in the menu |
| `alert-systin` | `44` | System-temperature alert; `0` disables it |
| `alert-hdd` | `50` | HDD alert; `0` disables it |

Settings can also be changed from the command line:

```bash
SCHEMADIR=~/.local/share/gnome-shell/extensions/disk-temps@lycantrop.hu/schemas
gsettings --schemadir "$SCHEMADIR" set org.gnome.shell.extensions.disk-temps language de
gsettings --schemadir "$SCHEMADIR" set org.gnome.shell.extensions.disk-temps panel-position right
gsettings --schemadir "$SCHEMADIR" set org.gnome.shell.extensions.disk-temps panel-mode hottest
```

Compile the schema after changing its XML source:

```bash
glib-compile-schemas ~/.local/share/gnome-shell/extensions/disk-temps@lycantrop.hu/schemas/
```

## Languages

The extension has its own language selector at the top of its Preferences
window. It does not change the GNOME desktop language.

Supported languages:

- English — default and fallback
- German — `Deutsch`
- Hungarian — `Magyar`

The panel, menu, alerts, preferences, and GSettings descriptions use the
selected language. Translation catalogs can be compiled with:

```bash
make translations
```

Run `make pot` after adding or changing translatable source strings, then
update `po/de.po` and `po/hu.po`.

## Icon

`icons/disk-temperature-symbolic.svg` is bundled with the extension, avoiding
a dependency on a particular icon theme. As a symbolic icon, it follows the
configured state color.

Do not use negative margins on `.disk-temp-icon`. On GNOME Shell 40 this can
produce a negative actor allocation and make the entire top panel disappear.
Use positive spacing or padding instead.

## Thresholds and colors

HDD, SATA SSD, and NVMe devices have separate warm/hot threshold pairs.
Different storage technologies have different normal operating ranges, so a
single threshold would produce misleading warnings.

Colors are stored in GSettings and applied as runtime styles. Values must use
`#rrggbb` or `#rrggbbaa`; invalid values fall back to the built-in defaults.
Changing a threshold immediately rebuilds the filtered panel contents.

## Dark menu

Shell themes control popup-menu colors. Some light themes make secondary text
and colored values difficult to read, so `dark-menu` adds a theme-independent
dark background. Disable it to use the Shell theme without overrides.

## System sensors and fan alerts

The extension scans `/sys/class/hwmon` instead of relying on a specific
`hwmonX` index, motherboard, or monitoring chip. It identifies a system or
case temperature through labels such as:

- `SYSTIN`
- `System`
- `Motherboard` or `Mainboard`
- `Chassis` or `Case`
- `Ambient`
- `Board`

If no suitable sensor is found, the system-sensor section stays hidden while
disk monitoring continues normally.

Fans are discovered on the same `hwmon` device as the selected system sensor.
A fan becomes monitored after reporting a positive speed once. This avoids
false alerts from unused headers while still detecting when a previously
running fan drops to 0 RPM. Fans without a tachometer signal cannot be
monitored in software.

The default system-temperature alert is 44 °C. Its physical meaning depends
on the motherboard, so adjust it for the machine or set it to 0 to disable the
alert.

## Runtime behavior

- Every detected disk is listed in the menu.
- A refresh cycle never overlaps the previous cycle.
- UDisks, NVMe, and `hwmon` devices are rediscovered periodically.
- UDisks hotplug events trigger an immediate disk-list rebuild.
- Standby ATA disks retain their last known value and are marked as standby.
- An unreadable disk is shown as `n/a` instead of being silently hidden.
- NVMe read failures do not prevent ATA disks from updating.
- Alerts turn the icon red and add a warning row to the menu.

## Development

`extension.js` owns the GNOME Shell, D-Bus, settings, and widget lifecycle.
`domain.js` contains display-independent temperature logic, `hardware.js`
contains portable hardware discovery, and `i18n.js` loads extension-local
translation catalogs without changing GNOME Shell's process-wide locale.

Run all regression, translation, syntax, and schema checks with:

```bash
make test
```

Build an installable extension bundle containing the modules, icon,
translations, and compiled schema with:

```bash
make pack
```
