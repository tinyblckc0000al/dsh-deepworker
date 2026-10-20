#!/usr/bin/env node
/** Default focus config: manual switch + scope/minutes; header locks without a dialog. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(process.env.HA_CLIENT_JS || path.join(HERE, '..', 'lib', 'client.js'), 'utf8');
let failed = 0;
const fail = (m) => { failed++; console.error('FAIL: ' + m); };
const ok = (m) => console.log('  ok   ' + m);
const assert = (m, c, d) => c ? ok(m) : fail(m + (d ? ': ' + d : ''));

assert('defaults are declared', ['focusDefaultEnabled', 'focusDefaultScope', 'focusDefaultMinutes'].every((k) => src.includes(k + ':')));
assert('header has a quick path', src.includes('if (defaults.enabled)') && src.includes('focusLockFor(defaults.minutes, defaults.scope)'));
assert('quick path precedes the dialog', src.indexOf('if (defaults.enabled)') < src.indexOf('setOpen(true);', src.indexOf('if (defaults.enabled)')));
assert('header exposes the quick state', src.includes('"data-dw-focus-default"'));
assert('settings has switch and scope/minutes hooks', src.includes('row("focusDefaultEnabled"') && src.includes('"focus-default-scope"') && src.includes('"focus-default-minutes"'));
assert('scope uses native radios', src.includes('type: "radio"') && src.includes('name: "dw-focus-default-scope"') && src.includes('checked: focusDefault.scope'));
assert('i18n keys exist', ['focus.defaultsTitle', 'focus.defaultsHint', 'focus.defaultsEnable', 'focus.defaultsScope', 'focus.defaultsMinutes'].every((k) => src.includes('"' + k + '"')));

const start = src.indexOf('    function focusDefaultsFrom(settings) {');
const end = src.indexOf('    /**\n     * Persist settings, REPORTING whether it worked.', start);
assert('normalizer found', start >= 0 && end > start);
if (start >= 0 && end > start) {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src.slice(start, end) + '\nthis.focusDefaultsFrom = focusDefaultsFrom;', sandbox);
  const f = sandbox.focusDefaultsFrom;
  const d = f({});
  assert('empty settings are off/session/30', d.enabled === false && d.scope === 'session' && d.minutes === 30);
  const w = f({ focusDefaultEnabled: true, focusDefaultScope: 'workspace', focusDefaultMinutes: 45 });
  assert('workspace/45 is preserved', w.enabled === true && w.scope === 'workspace' && w.minutes === 45);
  assert('bad scope falls back to session', f({ focusDefaultScope: 'bogus' }).scope === 'session');
  assert('zero minutes falls back to 30', f({ focusDefaultMinutes: 0 }).minutes === 30);
  assert('minutes clamp to 10080', f({ focusDefaultMinutes: 99999 }).minutes === 10080);
  assert('fractional minutes floor', f({ focusDefaultMinutes: 12.9 }).minutes === 12);
}
if (failed) { console.error(`\n${failed} FAILURE(S)`); process.exit(1); }
console.log('\nfocus defaults: GREEN');
