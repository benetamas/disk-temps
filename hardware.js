// vim: set sw=4 sts=4 et:
// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

/*
 * Hardverfelderítés a GNOME Shell/UI rétegtől függetlenül.
 *
 * A `var` deklarációk szándékosak: a GNOME Shell 40 legacy GJS
 * modulbetöltője ezeket teszi elérhetővé a `Me.imports.hardware` névtérben.
 */

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const ByteArray = imports.byteArray;

const NVME_CONTROLLER_PATTERN = /^nvme(\d+)$/;
const TEMPERATURE_LABEL_PATTERN = /^temp(\d+)_label$/;
const FAN_INPUT_PATTERN = /^fan(\d+)_input$/;

var readText = function (path) {
    try {
        let [ok, bytes] = GLib.file_get_contents(path);
        return ok ? ByteArray.toString(bytes).trim() : null;
    } catch (e) {
        return null;
    }
};

var readInt = function (path) {
    let text = readText(path);
    if (text === null)
        return null;

    let value = parseInt(text, 10);
    return Number.isFinite(value) ? value : null;
};

var listDirectory = function (path) {
    let names = [];
    let enumerator = null;

    try {
        let directory = Gio.File.new_for_path(path);
        enumerator = directory.enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NONE,
            null);

        let info;
        while ((info = enumerator.next_file(null)) !== null)
            names.push(info.get_name());
    } catch (e) {
        return [];
    } finally {
        if (enumerator) {
            try {
                enumerator.close(null);
            } catch (e) {
                // A felderítés ettől még használható.
            }
        }
    }

    return names;
};

var findExecutable = function (name, fallbackPaths) {
    let fromPath = GLib.find_program_in_path(name);
    if (fromPath)
        return fromPath;

    for (let path of fallbackPaths || []) {
        if (GLib.file_test(path, GLib.FileTest.IS_EXECUTABLE))
            return path;
    }
    return null;
};

var nvmeControllerNames = function (names) {
    return names
        .map(name => {
            let match = name.match(NVME_CONTROLLER_PATTERN);
            return match ? { name, index: parseInt(match[1], 10) } : null;
        })
        .filter(item => item !== null)
        .sort((left, right) => left.index - right.index)
        .map(item => item.name);
};

function findNvmeHwmonTemperature(controllerPath) {
    let hwmonRoot = `${controllerPath}/device/hwmon`;
    for (let name of listDirectory(hwmonRoot).sort()) {
        let inputPath = `${hwmonRoot}/${name}/temp1_input`;
        if (readInt(inputPath) !== null)
            return inputPath;
    }
    return null;
}

var discoverNvmeControllers = function (
    sysClassRoot = '/sys/class/nvme',
    deviceRoot = '/dev'
) {
    return nvmeControllerNames(listDirectory(sysClassRoot)).map(name => {
        let controllerPath = `${sysClassRoot}/${name}`;
        return {
            path: `${deviceRoot}/${name}`,
            dev: `${deviceRoot}/${name}`,
            model: readText(`${controllerPath}/model`) || '',
            temperaturePath: findNvmeHwmonTemperature(controllerPath),
        };
    });
};

// Kisebb érték = jobb, egyértelműbb rendszer-/ház-hőmérséklet címke.
var ambientLabelPriority = function (label) {
    let normalized = (label || '').trim().toLowerCase();
    if (normalized === 'systin')
        return 0;
    if (/^system(?:\s+\d+|\s+temp(?:erature)?)?$/.test(normalized))
        return 1;
    if (/^(motherboard|mainboard|mb)(?:\s+temp(?:erature)?)?$/.test(normalized))
        return 2;
    if (/^(chassis|case)(?:\s+temp(?:erature)?)?$/.test(normalized))
        return 3;
    if (/^ambient(?:\s+temp(?:erature)?)?$/.test(normalized))
        return 4;
    if (/^board(?:\s+temp(?:erature)?)?$/.test(normalized))
        return 5;
    return null;
};

var selectAmbientSensor = function (candidates) {
    let ranked = candidates
        .map(candidate => ({
            candidate,
            priority: ambientLabelPriority(candidate.label),
        }))
        .filter(item => item.priority !== null)
        .sort((left, right) => left.priority - right.priority);
    return ranked.length > 0 ? ranked[0].candidate : null;
};

var fanDisplayName = function (index, label, sourceLabel, chip) {
    let detail = (label || '').trim() || (sourceLabel || '').trim() || (chip || '').trim();
    return detail ? `fan${index} (${detail})` : `fan${index}`;
};

function temperatureSensors(hwmonPath) {
    let sensors = [];
    for (let name of listDirectory(hwmonPath)) {
        let match = name.match(TEMPERATURE_LABEL_PATTERN);
        if (!match)
            continue;

        let index = parseInt(match[1], 10);
        let label = readText(`${hwmonPath}/${name}`);
        let inputPath = `${hwmonPath}/temp${index}_input`;
        if (!label || readInt(inputPath) === null)
            continue;

        sensors.push({ index, label, inputPath });
    }
    return sensors;
}

function fansForMonitor(hwmonPath, chip, sensors) {
    let sensorLabels = new Map(sensors.map(sensor => [sensor.index, sensor.label]));
    let fans = [];

    for (let name of listDirectory(hwmonPath)) {
        let match = name.match(FAN_INPUT_PATTERN);
        if (!match)
            continue;

        let index = parseInt(match[1], 10);
        let inputPath = `${hwmonPath}/${name}`;
        if (readInt(inputPath) === null)
            continue;

        let sourceIndex = readInt(`${hwmonPath}/pwm${index}_temp_sel`);
        let label = readText(`${hwmonPath}/fan${index}_label`);
        let sourceLabel = sourceIndex === null ? '' : sensorLabels.get(sourceIndex) || '';

        fans.push({
            id: `${hwmonPath}:fan${index}`,
            index,
            inputPath,
            pwmPath: `${hwmonPath}/pwm${index}`,
            name: fanDisplayName(index, label, sourceLabel, chip),
        });
    }

    return fans.sort((left, right) => left.index - right.index);
}

var discoverSystemMonitor = function (hwmonRoot = '/sys/class/hwmon') {
    let candidates = [];

    for (let name of listDirectory(hwmonRoot).sort()) {
        if (!/^hwmon\d+$/.test(name))
            continue;

        let path = `${hwmonRoot}/${name}`;
        let chip = readText(`${path}/name`) || name;
        let sensors = temperatureSensors(path);
        for (let sensor of sensors)
            candidates.push({ path, chip, sensor, sensors, label: sensor.label });
    }

    let selected = selectAmbientSensor(candidates);
    if (!selected)
        return null;

    return {
        path: selected.path,
        chip: selected.chip,
        temperature: selected.sensor,
        fans: fansForMonitor(selected.path, selected.chip, selected.sensors),
    };
};
