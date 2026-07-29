// Run from the extension root: gjs tests/translations.test.js

const GLib = imports.gi.GLib;
const System = imports.system;

const scriptDirectory = GLib.path_get_dirname(System.programInvocationName);
const projectRoot = GLib.build_filenamev([
    GLib.get_current_dir(),
    scriptDirectory,
    '..',
]);
const localeDirectory = GLib.build_filenamev([projectRoot, 'locale']);

imports.searchPath.unshift(projectRoot);
const I18n = imports.i18n;

let assertions = 0;

function assertEqual(actual, expected, message) {
    assertions++;
    if (actual !== expected)
        throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

assertEqual(I18n.normalizeLanguage('de_DE.UTF-8'), 'de', 'German locale normalization');
assertEqual(I18n.normalizeLanguage('hu-HU'), 'hu', 'Hungarian locale normalization');
assertEqual(I18n.normalizeLanguage('fr_FR'), 'en', 'Unsupported language fallback');

assertEqual(I18n.createTranslator('de', localeDirectory)('Settings…'),
    'Einstellungen…', 'German catalog');
assertEqual(I18n.createTranslator('hu', localeDirectory)('Settings…'),
    'Beállítások…', 'Hungarian catalog');
assertEqual(I18n.createTranslator('en', localeDirectory)('Settings…'),
    'Settings…', 'English source fallback');

print(`translations.test.js: ${assertions} assertions passed`);
