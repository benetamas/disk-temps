// vim: set sw=4 sts=4 et:
// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

/*
 * Extension-local translations.
 *
 * Changing the process locale would affect GNOME Shell and every extension
 * loaded into it. This module reads this extension's compiled gettext
 * catalogs directly, so the selected language remains isolated.
 */

const GLib = imports.gi.GLib;
const ByteArray = imports.byteArray;

const MO_MAGIC = 0x950412de;
const SUPPORTED_LANGUAGES = new Set(['en', 'de', 'hu']);
const catalogCache = new Map();

var normalizeLanguage = function (language) {
    let normalized = (language || '').trim().toLowerCase().split(/[-_.@]/)[0];
    return SUPPORTED_LANGUAGES.has(normalized) ? normalized : 'en';
};

function readUint32(view, offset, littleEndian) {
    if (offset < 0 || offset + 4 > view.byteLength)
        throw new Error('Invalid MO table offset');
    return view.getUint32(offset, littleEndian);
}

function decode(bytes, offset, length) {
    if (offset < 0 || length < 0 || offset + length > bytes.byteLength)
        throw new Error('Invalid MO string offset');
    return ByteArray.toString(bytes.subarray(offset, offset + length));
}

function loadCatalog(path) {
    if (catalogCache.has(path))
        return catalogCache.get(path);

    let messages = new Map();
    try {
        let [ok, bytes] = GLib.file_get_contents(path);
        if (!ok)
            return messages;

        let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let littleEndian;
        if (view.getUint32(0, true) === MO_MAGIC)
            littleEndian = true;
        else if (view.getUint32(0, false) === MO_MAGIC)
            littleEndian = false;
        else
            throw new Error('Invalid MO magic');

        let count = readUint32(view, 8, littleEndian);
        let originalTable = readUint32(view, 12, littleEndian);
        let translatedTable = readUint32(view, 16, littleEndian);
        if (count > 100000 ||
            originalTable + count * 8 > view.byteLength ||
            translatedTable + count * 8 > view.byteLength)
            throw new Error('Invalid MO table size');

        for (let index = 0; index < count; index++) {
            let originalLength = readUint32(
                view, originalTable + index * 8, littleEndian);
            let originalOffset = readUint32(
                view, originalTable + index * 8 + 4, littleEndian);
            let translatedLength = readUint32(
                view, translatedTable + index * 8, littleEndian);
            let translatedOffset = readUint32(
                view, translatedTable + index * 8 + 4, littleEndian);

            let original = decode(bytes, originalOffset, originalLength).split('\0')[0];
            let translated = decode(
                bytes, translatedOffset, translatedLength).split('\0')[0];
            if (original && translated)
                messages.set(original, translated);
        }
    } catch (e) {
        logError(e, `disk-temps: failed to load translation catalog ${path}`);
    }

    catalogCache.set(path, messages);
    return messages;
}

var createTranslator = function (language, localeRoot) {
    let selected = normalizeLanguage(language);
    if (selected === 'en')
        return message => message;

    let path = `${localeRoot}/${selected}/LC_MESSAGES/disk-temperatures.mo`;
    let messages = loadCatalog(path);
    return message => messages.get(message) || message;
};
