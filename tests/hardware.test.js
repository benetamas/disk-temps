// Run from the extension root: gjs tests/hardware.test.js

const GLib = imports.gi.GLib;
const System = imports.system;

const scriptDirectory = GLib.path_get_dirname(System.programInvocationName);
const projectRoot = GLib.build_filenamev([
    GLib.get_current_dir(),
    scriptDirectory,
    '..',
]);
imports.searchPath.unshift(projectRoot);

const Hardware = imports.hardware;

let assertions = 0;

function assertEqual(actual, expected, message) {
    assertions++;
    if (actual !== expected)
        throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertArrayEqual(actual, expected, message) {
    assertEqual(JSON.stringify(actual), JSON.stringify(expected), message);
}

assertArrayEqual(
    Hardware.nvmeControllerNames(['nvme10', 'nvme2n1', 'nvme2', 'nvme0', 'loop0']),
    ['nvme0', 'nvme2', 'nvme10'],
    'NVMe controller filtering and numeric order');

assertEqual(Hardware.ambientLabelPriority('SYSTIN'), 0, 'SYSTIN priority');
assertEqual(Hardware.ambientLabelPriority('System Temp'), 1, 'System priority');
assertEqual(Hardware.ambientLabelPriority('Motherboard'), 2, 'Motherboard priority');
assertEqual(Hardware.ambientLabelPriority('CPU Package'), null, 'CPU is not ambient');
assertEqual(Hardware.ambientLabelPriority('PCH_CHIP_TEMP'), null, 'PCH is not ambient');

let selected = Hardware.selectAmbientSensor([
    { label: 'Ambient', id: 'ambient' },
    { label: 'System Temp', id: 'system' },
    { label: 'SYSTIN', id: 'systin' },
]);
assertEqual(selected.id, 'systin', 'Best ambient sensor selection');

assertEqual(Hardware.fanDisplayName(4, '', 'SYSTIN', 'nct6798'),
    'fan4 (SYSTIN)', 'Fan temperature source label');
assertEqual(Hardware.fanDisplayName(2, 'CPU Fan', 'PECI', 'nct6798'),
    'fan2 (CPU Fan)', 'Explicit fan label wins');
assertEqual(Hardware.fanDisplayName(1, '', '', 'it8688'),
    'fan1 (it8688)', 'Chip fallback label');

print(`hardware.test.js: ${assertions} assertions passed`);
