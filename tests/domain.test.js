// Run from the extension root: gjs tests/domain.test.js

const GLib = imports.gi.GLib;
const System = imports.system;

const scriptDirectory = GLib.path_get_dirname(System.programInvocationName);
const projectRoot = GLib.build_filenamev([
    GLib.get_current_dir(),
    scriptDirectory,
    '..',
]);
imports.searchPath.unshift(projectRoot);

const Domain = imports.domain;

let assertions = 0;

function assertEqual(actual, expected, message) {
    assertions++;
    if (actual !== expected)
        throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertArrayEqual(actual, expected, message) {
    assertEqual(JSON.stringify(actual), JSON.stringify(expected), message);
}

function drive(dev, temp, kind = 'ssd') {
    return { dev, temp, kind };
}

assertEqual(Domain.kelvinToCelsius(303.15), 30, 'Kelvin conversion');
assertEqual(Domain.kelvinToCelsius(0), null, 'Invalid Kelvin value');
assertEqual(Domain.shortDevice('/dev/sda'), 'sda', 'Device prefix removal');
assertEqual(Domain.shortModel('Samsung  SSD 870 EVO'), 'SSD 870 EVO', 'Model prefix removal');
assertEqual(Domain.shortModel('1234567890123456789012345'), '12345678901234567890123…',
    'Long model truncation');

assertEqual(Domain.levelForTemperature(null, 'hdd'), 'na', 'Missing temperature');
assertEqual(Domain.levelForTemperature(44, 'hdd'), 'cool', 'Cool HDD');
assertEqual(Domain.levelForTemperature(45, 'hdd'), 'warm', 'Warm HDD boundary');
assertEqual(Domain.levelForTemperature(50, 'hdd'), 'hot', 'Hot HDD boundary');
assertEqual(Domain.levelForTemperature(54, 'ssd'), 'cool', 'Cool SATA SSD');
assertEqual(Domain.levelForTemperature(55, 'ssd'), 'warm', 'Warm SATA SSD boundary');
assertEqual(Domain.levelForTemperature(65, 'ssd'), 'hot', 'Hot SATA SSD boundary');
assertEqual(Domain.levelForTemperature(59, 'nvme'), 'cool', 'Cool NVMe');
assertEqual(Domain.levelForTemperature(60, 'nvme'), 'warm', 'Warm NVMe boundary');
assertEqual(Domain.levelForTemperature(70, 'nvme'), 'hot', 'Hot NVMe boundary');
assertEqual(Domain.needsAttention(drive('/dev/sda', null, 'hdd')), true,
    'Unreadable drive needs attention');

assertEqual(Domain.worstLevel([
    drive('/dev/nvme0', 60, 'nvme'),
    drive('/dev/sda', 50, 'hdd'),
]), 'hot', 'Worst level uses severity instead of highest number');

assertEqual(Domain.systinLevel(null, 44), 'na', 'Missing SYSTIN');
assertEqual(Domain.systinLevel(43, 44), 'warm', 'SYSTIN warning band');
assertEqual(Domain.systinLevel(44, 44), 'hot', 'SYSTIN alert boundary');
assertEqual(Domain.systinLevel(80, 0), 'cool', 'Disabled SYSTIN alert');

assertEqual(Domain.sanitizeColor('#aabbcc', 'fallback'), '#aabbcc', 'RGB color');
assertEqual(Domain.sanitizeColor('#aabbccdd', 'fallback'), '#aabbccdd', 'RGBA color');
assertEqual(Domain.sanitizeColor('#fff; color: red', 'fallback'), 'fallback',
    'Unsafe color fallback');

let devices = [
    drive('/dev/nvme1', null),
    drive('/dev/sdb', null),
    drive('/dev/sda', null),
    drive('/dev/nvme0', null),
];
devices.sort(Domain.compareDevices);
assertArrayEqual(devices.map(item => item.dev),
    ['/dev/sda', '/dev/sdb', '/dev/nvme0', '/dev/nvme1'],
    'Stable device order');

let temperatures = [
    drive('/dev/nvme0', null),
    drive('/dev/sdb', 40),
    drive('/dev/sda', 55),
];
temperatures.sort(Domain.compareDrivesByTemperature);
assertArrayEqual(temperatures.map(item => item.dev),
    ['/dev/sda', '/dev/sdb', '/dev/nvme0'],
    'Temperature order');

print(`domain.test.js: ${assertions} assertions passed`);
