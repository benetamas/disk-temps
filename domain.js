// vim: set sw=4 sts=4 et:
// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

/*
 * A kijelzéstől és a GNOME Shelltől független hőmérséklet-logika.
 *
 * A `var` deklarációk szándékosak: a GNOME Shell 40 legacy GJS
 * modulbetöltője ezeket teszi elérhetővé a `Me.imports.domain` névtérben.
 */

var DEFAULT_THRESHOLDS = {
    hdd: { warm: 45, hot: 50 },
    ssd: { warm: 55, hot: 65 },
    nvme: { warm: 60, hot: 70 },
};

var DEFAULT_COLORS = {
    cool: '#8ff0a4',
    warm: '#f8e45c',
    hot: '#ff7b63',
    na: '#8c8c94',
};

const LEVEL_SEVERITY = { cool: 0, na: 1, warm: 2, hot: 3 };
const MODEL_PREFIX = /^(WDC|KINGSTON|Samsung|SAMSUNG|Seagate|INTEL|Crucial|SanDisk)\s+/;

var kelvinToCelsius = function (kelvin) {
    if (typeof kelvin !== 'number' || kelvin <= 0)
        return null;
    return Math.round(kelvin - 273.15);
};

var shortDevice = function (device) {
    return (device || '').replace(/^\/dev\//, '');
};

var shortModel = function (model) {
    let shortened = (model || '').trim().replace(MODEL_PREFIX, '');
    return shortened.length > 24 ? `${shortened.slice(0, 23)}…` : shortened;
};

// SATA előre, NVMe utána, csoporton belül névsorban — fix, nem ugráló sorrend.
var deviceSortKey = function (device) {
    let name = shortDevice(device);
    return `${name.startsWith('nvme') ? 1 : 0}:${name}`;
};

var compareDevices = function (left, right) {
    return deviceSortKey(left.dev).localeCompare(deviceSortKey(right.dev));
};

// Hőfok szerint csökkenő, ismeretlen értékek a lista végén.
var compareDrivesByTemperature = function (left, right) {
    if (left.temp === null && right.temp === null)
        return compareDevices(left, right);
    if (left.temp === null)
        return 1;
    if (right.temp === null)
        return -1;
    return right.temp - left.temp;
};

var levelForTemperature = function (temperature, kind, thresholds) {
    if (temperature === null)
        return 'na';

    let configured = thresholds || DEFAULT_THRESHOLDS;
    let limits = configured[kind] || configured.ssd || DEFAULT_THRESHOLDS.ssd;
    if (temperature >= limits.hot)
        return 'hot';
    if (temperature >= limits.warm)
        return 'warm';
    return 'cool';
};

// Az n/a szándékosan figyelmet kér: egy nem olvasható diszket nem rejtünk el.
var needsAttention = function (drive, thresholds) {
    return levelForTemperature(drive.temp, drive.kind, thresholds) !== 'cool';
};

// A legsúlyosabb állapot számít, nem a legnagyobb hőmérséklet: a küszöbök
// eszköztípusonként eltérnek.
var worstLevel = function (drives, thresholds) {
    let worst = 'cool';
    for (let drive of drives) {
        let level = levelForTemperature(drive.temp, drive.kind, thresholds);
        if (LEVEL_SEVERITY[level] > LEVEL_SEVERITY[worst])
            worst = level;
    }
    return worst;
};

// A ház-ambientnek nincs saját küszöbpárja: 3 fokkal a riasztás előtt sárga.
var systinLevel = function (temperature, alertLimit) {
    if (temperature === null)
        return 'na';
    if (!(alertLimit > 0))
        return 'cool';
    if (temperature >= alertLimit)
        return 'hot';
    if (temperature >= alertLimit - 3)
        return 'warm';
    return 'cool';
};

// A szín inline style-ba kerül, ezért csak a két támogatott hex alakot fogadjuk.
var sanitizeColor = function (value, fallback) {
    return /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value || '')
        ? value
        : fallback;
};
