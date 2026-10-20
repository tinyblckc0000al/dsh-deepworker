#!/usr/bin/env node
/**
 * Manual version check contract:
 *   · no network at load; only the settings-page button calls the registry
 *   · numeric compare; unknown versions never claim an update
 *   · failure still exposes the npm page and repository
 *   · no auto-install
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.join(HERE, '..');
const src = fs.readFileSync(process.env.HA_CLIENT_JS || path.join(PKG, 'lib', 'client.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));

let failures = 0;
const fail = (m) => { failures++; console.error('FAIL: ' + m); };
const ok = (m) => console.log('  ok   ' + m);
const assert = (m, cond, detail) => { if (cond) ok(m); else fail(m + (detail === undefined ? '' : ': ' + detail)); };

const vsn = src.match(/var VERSION = "([^"]+)";/);
assert('bundle has VERSION', vsn !== null);
if (vsn) assert('VERSION matches package.json', vsn[1] === pkg.version, `${vsn[1]} != ${pkg.version}`);

assert('registry URL', src.includes('var UPDATE_REGISTRY_URL = "https://registry.npmjs.org/dsh-deepworker/latest";'));
assert('npm release page URL', src.includes('var UPDATE_PAGE_URL = "https://www.npmjs.com/package/dsh-deepworker";'));
assert('repository URL', src.includes('var REPO_URL = "https://github.com/tinyblckc0000al/dsh-deepworker";'));
assert('manual-only fetch: no auto check hook', (() => {
  const start = src.indexOf('function UpdatePanel');
  const end = src.indexOf('function HistoryActionsSettings');
  if (start < 0 || end < 0) return false;
  const block = src.slice(start, end);
  return !block.includes('useEffect') && block.includes('onClick: check');
})());
assert('fetch is no-store', src.includes('cache: "no-store"'));
assert('fetch has timeout', src.includes('UPDATE_TIMEOUT_MS = 4000') && src.includes('clearTimeout(timer)'));
assert('fetch aborts', src.includes('AbortController') && src.includes('controller.abort()'));
assert('update opens external URL', src.includes('window.open(url, "_blank", "noopener,noreferrer")'));
assert('failure exposes manual links', src.includes('t("update.failed"') && src.includes('UPDATE_PAGE_URL') && src.includes('REPO_URL'));
assert('update command is copyable', src.includes('t("update.copy")') && src.includes('navigator.clipboard.writeText(command)'));
assert('update panel hook', src.includes('"data-dw-update": ""'));
assert('update panel only on the basic tab', (() => {
  const basic = src.indexOf('settingsPanel("basic"');
  const focus = src.indexOf('settingsPanel("focus"');
  const calls = src.split('(0, react_jsx_runtime.jsx)(UpdatePanel').length - 1;
  const at = src.indexOf('(0, react_jsx_runtime.jsx)(UpdatePanel');
  return calls === 1 && basic >= 0 && focus > basic && at > basic && at < focus;
})());
assert('no auto-install', !src.includes('runTerminalButton(') || !src.slice(src.indexOf('function UpdatePanel'), src.indexOf('function HistoryActionsSettings')).includes('runTerminalButton'));

// Extract the pure comparator and test it in isolation.
const start = src.indexOf('    function versionParts(value) {');
const end = src.indexOf('    function fetchLatestVersion()');
assert('comparator source found', start >= 0 && end > start);
if (start >= 0 && end > start) {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src.slice(start, end) + '\nthis.versionParts = versionParts; this.compareVersions = compareVersions;', sandbox);
  const cmp = sandbox.compareVersions;
  const eq = (a, b) => cmp(a, b) === 0;
  const gt = (a, b) => cmp(a, b) === 1;
  const lt = (a, b) => cmp(a, b) === -1;
  assert('equal versions', eq('0.1.2', '0.1.2'));
  assert('patch order', gt('0.1.3', '0.1.2'));
  assert('minor order', gt('0.2.0', '0.1.9'));
  assert('major order', gt('1.0.0', '0.9.9'));
  assert('numeric not lexicographic', gt('0.1.10', '0.1.9'));
  assert('stable beats prerelease', gt('1.0.0', '1.0.0-beta'));
  assert('prerelease order', gt('1.0.0-beta.2', '1.0.0-beta.1'));
  assert('invalid is equal (never an update)', eq('not-a-version', '0.1.2'));
  assert('v prefix accepted', eq('v0.1.2', '0.1.2'));
}

if (failures > 0) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('\nupdate check: GREEN');
