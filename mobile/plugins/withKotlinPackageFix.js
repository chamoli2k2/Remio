// The Android package is "in.remio.app", and `in` is a reserved word in Kotlin. The expo-widgets plugin writes
// "package in.remio.app" unquoted into its provider file, which fails to compile. Quote each segment that is a
// Kotlin keyword. Listed before expo-widgets in app.json so that it runs after that plugin has written its files.
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const KEYWORDS = new Set(['in', 'is', 'as', 'if', 'do', 'for', 'fun', 'val', 'var', 'when', 'while', 'object', 'class', 'interface', 'package', 'return', 'super', 'this', 'throw', 'try', 'typealias', 'typeof', 'null', 'true', 'false', 'else', 'break', 'continue']);
const quote = pkg => pkg.split('.').map(s => (KEYWORDS.has(s) ? `\`${s}\`` : s)).join('.');

module.exports = config => withDangerousMod(config, ['android', async cfg => {
  const pkg = cfg.android?.package;
  if (!pkg) return cfg;
  const dir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/java', ...pkg.split('.'));
  if (!fs.existsSync(dir)) return cfg;
  const fixed = quote(pkg);
  if (fixed === pkg) return cfg;
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.kt'))) {
    const p = path.join(dir, f);
    const text = fs.readFileSync(p, 'utf8');
    const next = text.replace(new RegExp(`^package ${pkg.replace(/\./g, '\\.')}\\s*$`, 'm'), `package ${fixed}`);
    if (next !== text) fs.writeFileSync(p, next);
  }
  return cfg;
}]);
