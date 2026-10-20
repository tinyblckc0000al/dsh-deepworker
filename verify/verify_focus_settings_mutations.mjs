#!/usr/bin/env node
/**
 * verify_focus_settings_mutations.mjs — 证明 verify_focus_settings.mjs 的每条断言真的会红。
 * 变异只写 /tmp 副本，绝不触碰线上 lib/client.js。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITE = path.join(HERE, 'verify_focus_settings.mjs');
const LIVE = path.join(HERE, '..', 'lib', 'client.js');
const SOURCE = fs.readFileSync(LIVE, 'utf8');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-focus-settings-mut-'));

let failures = 0;
const fail = (m) => { failures++; console.error('FAIL: ' + m); };

function runSuite(src) {
  const file = path.join(TMP, `client-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(file, src);
  const proc = spawnSync(process.execPath, [SUITE], { encoding: 'utf8', env: Object.assign({}, process.env, { HA_CLIENT_JS: file }) });
  const out = (proc.stdout || '') + (proc.stderr || '');
  return { code: proc.status, out, failLines: out.split('\n').filter((l) => /^FAIL\b/.test(l.trim())).map((l) => l.trim()) };
}
const mustReplace = (s, needle, replacement, what) => {
  const n = s.split(needle).length - 1;
  if (n !== 1) throw new Error(`anchor "${what}" occurs ${n} time(s), expected exactly 1`);
  return s.replace(needle, replacement);
};
function mutation({ name, mutate, expect }) {
  const src = mutate(SOURCE);
  if (src === SOURCE) { fail(`${name}: the mutation did not change the file (anchor missing)`); return; }
  const r = runSuite(src);
  if (r.code === 0 || r.failLines.length === 0) { fail(`${name}: the checker stayed GREEN — this mutation must be RED`); return; }
  const hit = r.failLines.find((l) => expect.test(l));
  if (!hit) { fail(`${name}: went RED but not for the expected reason.\n        want /${expect.source}/\n        got: ${r.failLines.slice(0, 3).join('\n             ')}`); return; }
  console.log(`  ok   ${name} -> RED`);
  console.log(`         ↳ ${hit.slice(0, 200)}`);
}

console.log(`tmp:   ${TMP}`);
console.log(`suite: ${SUITE}`);
console.log(`live:  ${LIVE} (${Buffer.byteLength(SOURCE)} bytes)\n`);

console.log('基线');
{
  const r = runSuite(SOURCE);
  if (r.code === 0 && r.failLines.length === 0) console.log('  ok   the live bundle is GREEN');
  else fail(`the baseline should be GREEN, got exit=${r.code}: ${r.failLines.slice(0, 3).join(' | ')}`);
}

console.log('\n状态来源 / 刷新');
mutation({
  name: '① readFocus 退回只读宿主文件缓存（本地锁又看不见）⇒ 红',
  mutate: (s) => mustReplace(s,
    `  var eff = effectiveFocusState();
  return eff === null || typeof eff !== "object" ? null : eff;`,
    `  return focusFileCache !== null ? focusFileCache : readFocusStateFromTranscript();`,
    'readFocus effective'),
  expect: /readFocus does not read through effectiveFocusState/,
});
mutation({
  name: '② 锁定按钮之后不再刷新状态行 ⇒ 红（用户点的就是这个 bug）',
  mutate: (s) => mustReplace(s, 'testHooks.focusLockFor(30);\n                      refreshFocus();', 'testHooks.focusLockFor(30);', 'lock refresh'),
  expect: /lock button refreshes the row after locking/,
});
mutation({
  name: '③ 解锁按钮之后不再刷新状态行 ⇒ 红',
  mutate: (s) => mustReplace(s, 'testHooks.focusUnlockLocal();\n                      refreshFocus();', 'testHooks.focusUnlockLocal();', 'unlock refresh'),
  expect: /unlock button refreshes the row after unlocking/,
});
mutation({
  name: '④ 去掉 5 秒自动重读（锁到期后状态行停在旧值）⇒ 红',
  mutate: (s) => mustReplace(s, 'var timer = setInterval(refreshFocus, 5000);', 'var timer = setInterval(function () {}, 5000);', 'refresh interval'),
  expect: /the row re-reads every 5 s while mounted/,
});

console.log('\n文案 / 展示');
mutation({
  name: '⑤ 给 focus.free 加回 ✅ ⇒ 红（设置页不再有例外）',
  mutate: (s) => mustReplace(s, '"focus.free": "未锁定",', '"focus.free": "未锁定 ✅",', 'focus.free check'),
  expect: /focus\.free still contains ✅/,
});
mutation({
  name: '⑥ 状态行又打印 targetId / ISO 时间 ⇒ 红',
  mutate: (s) => mustReplace(s,
    '          return describeFocusState(focus[0], t, Date.now());',
    '          return describeFocusState(focus[0], t, Date.now()) + " · " + String(focus[0] && focus[0].targetId);',
    'focusStateLine internal id'),
  expect: /still prints internal ids|does not delegate/,
});
mutation({
  name: '⑦ 工作区锁也说成「只留当前会话」⇒ 红（范围说错）',
  mutate: (s) => mustReplace(s,
    'var scope = state.kind === "workspace" ? translate("focus.scopeWorkspace") : translate("focus.scopeSession");',
    'var scope = translate("focus.scopeSession");',
    'scope label'),
  expect: /workspace lock, 1 min left: expected/,
});
mutation({
  name: '⑧ 剩余时间恒为 1 分钟 ⇒ 红（时间说错）',
  mutate: (s) => mustReplace(s, 'var minutes = Math.max(1, Math.ceil(left / 60000));', 'var minutes = 1;', 'remaining minutes'),
  expect: /session lock, 30 min left: expected/,
});

console.log(`\n${failures === 0 ? 'GREEN' : 'RED'}: ${failures === 0 ? 'every mutation landed where it was supposed to' : failures + ' failure(s)'}`);
if (!process.env.KEEP_TMP) fs.rmSync(TMP, { recursive: true, force: true }); else console.log('TMP kept: ' + TMP);
process.exit(failures === 0 ? 0 : 1);
