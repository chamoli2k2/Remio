const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

/**
 * The app imports a few plain modules from the repository's `shared/` folder (limits, the note
 * embed format, cloze parsing, brand names), the same files the website and the server use, so the
 * rules cannot drift between them. Metro only bundles what it is told to watch, hence the folder
 * is added here. Those files import nothing, so no extra module resolution is needed.
 */
const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders || []), path.resolve(__dirname, '../shared')];
module.exports = config;
