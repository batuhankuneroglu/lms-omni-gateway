// Run once with LM Studio fully closed, after npm run build.
// Never execute during plugin registration: LM Studio owns the live settings.
const {readFileSync, writeFileSync, renameSync, existsSync, mkdirSync} = require('node:fs');
const {join} = require('node:path');
const {execFileSync} = require('node:child_process');
const {LegacySettings, pluginDataDirectory} = require('../dist/legacy-settings');
const {globalSettingsPath} = require('../dist/model-settings');
const {migrateSidebarSettings} = require('../dist/settings-migration');
const marker = join(pluginDataDirectory, 'native-defaults-v2.json');
if (existsSync(marker)) { console.log('Migration already completed; native settings were not changed.'); process.exit(0); }
if (process.platform === 'win32') {
  const running = execFileSync('powershell.exe', ['-NoProfile', '-Command', "[bool](Get-Process -Name 'LM Studio' -ErrorAction SilentlyContinue)"], {encoding:'utf8',windowsHide:true}).trim();
  if (running !== 'False') throw new Error('Close LM Studio completely before migrating settings.');
}
const original = readFileSync(globalSettingsPath, 'utf8');
const store = new LegacySettings();
const state = store.read();
const migrated = migrateSidebarSettings(original, id => store.config(state, id), state.provider);
if (readFileSync(globalSettingsPath, 'utf8') !== original) throw new Error('Settings changed; migration cancelled.');
const temporary = globalSettingsPath + '.sidebar-migration.tmp';
writeFileSync(temporary, migrated, {mode:0o600});
renameSync(temporary, globalSettingsPath);
mkdirSync(pluginDataDirectory, {recursive:true});
writeFileSync(marker, JSON.stringify({version:2,completedAt:new Date().toISOString()}));
console.log('Migrated this plugin only. Existing native values and other plugin settings were preserved.');
