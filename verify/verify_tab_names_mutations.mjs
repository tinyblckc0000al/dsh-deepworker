// verify_tab_names_mutations.mjs — 变异检验：把「改名」这件事故意做坏，断言
// `verify_tab_names.mjs` **必须报红**；同时断言已知好版本报绿。
//
// 纪律 11：一条断言只有在"把 bug 改回去它就会红"时才算数。这里放四个真实形状：
//   ① 只改 zh、漏改 en（英文界面仍写 Terminal）
//   ② 两处都留着旧名（等于没改）
//   ③ 改名顺手把 tab 挪了位置（用户只说改名）
//   ④ **过度改名**：把指的是真终端的 `term.settingsTitle` 一起改成「命令按钮」
//
// 所有变异只写**临时目录**（AGENTS.md：测试不许碰真实路径；lib/client.js 被 HMR 监视）。
// 用法：node verify/verify_tab_names_mutations.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIVE = path.join(HERE, '..', 'lib', 'client.js');
const GOOD = fs.readFileSync(LIVE, 'utf8');
const NODE_PATH = path.join(HERE, '..', 'node_modules');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-tabname-mut-'));

let pass = 0, fail = 0;
const assert = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
};

function verdict(bundleText) {
  const dir = fs.mkdtempSync(path.join(tmp, 'pkg-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.mkdirSync(path.join(dir, 'verify'));
  fs.writeFileSync(path.join(dir, 'lib', 'client.js'), bundleText);
  fs.copyFileSync(path.join(HERE, 'verify_tab_names.mjs'), path.join(dir, 'verify', 'verify_tab_names.mjs'));
  // 隔离副本在 /tmp ⇒ `require('react')` 找不到；NODE_PATH 指向插件自带的 node_modules。
  const r = spawnSync(process.execPath, [path.join(dir, 'verify', 'verify_tab_names.mjs')], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { NODE_PATH })
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

console.log(`tmp: ${tmp}\nbase: ${LIVE} (${Buffer.byteLength(GOOD)} bytes)\n`);

console.log('基线');
{
  const r = verdict(GOOD);
  assert('已知好版本 → GREEN', r.code === 0, r.out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 3).join(' | '));
}

const MUTATIONS = [
  {
    name: '① 只改 zh、漏改 en（英文界面仍写 Terminal）',
    apply: (s) => s.replace('      "settings.tab.terminal": "Commands",', '      "settings.tab.terminal": "Terminal",'),
    mustChange: /"settings\.tab\.terminal": "Terminal"/,
  },
  {
    name: '② 两处都留着旧名（等于没改名）',
    apply: (s) => s.replace('      "settings.tab.terminal": "命令按钮",', '      "settings.tab.terminal": "终端",'),
    mustChange: /"settings\.tab\.terminal": "终端"/,
  },
  {
    name: '③ 改名顺手把 tab 挪了位置（terminal 挪到 actions 之前）',
    apply: (s) => s.replace(
      '        { value: "actions", labelKey: "settings.tab.actions" },\n'
      + '        // 2026-10-17：给终端按钮单独一个 tab（用户原话："启动按钮没有单独的tab页吗"）。\n'
      + '        // 顺序在「会话操作」之后；value = `terminal`，面板 id / aria-controls 由同一个 value 拼。\n'
      + '        { value: "terminal", labelKey: "settings.tab.terminal" }',
      '        { value: "terminal", labelKey: "settings.tab.terminal" },\n'
      + '        { value: "actions", labelKey: "settings.tab.actions" }'),
    mustChange: /value: "terminal", labelKey: "settings\.tab\.terminal" \},\n        \{ value: "actions"/,
  },
  {
    name: '④ 过度改名：把指的是真终端的**功能名** term.featureName 也改成「命令按钮」',
    // 这一档的名字说的是"点头部按钮会开一个终端" —— 它是真的终端，改掉就是"说的和做的不一样"。
    apply: (s) => s.replace('      "term.featureName": "终端按钮",', '      "term.featureName": "命令按钮",'),
    mustChange: /"term\.featureName": "命令按钮"/,
  },
  {
    name: '④b 页内标题与 tab 脱节（settingsTitle 留回「终端按钮」）',
    apply: (s) => s.replace('      "term.settingsTitle": "命令按钮",', '      "term.settingsTitle": "终端按钮",'),
    mustChange: /"term\.settingsTitle": "终端按钮"/,
  },
];

console.log('\n变异（每一个都必须 RED）');
for (const m of MUTATIONS) {
  const mutated = m.apply(GOOD);
  const effective = mutated !== GOOD && m.mustChange.test(mutated);
  if (!effective) { assert(m.name + ' → RED', false, '变异没生效（anchor 失配 ⇒ 空操作）'); continue; }
  const r = verdict(mutated);
  const firstFail = r.out.split('\n').filter((l) => /FAIL/.test(l))[0] || '';
  assert(m.name + ' → RED', r.code !== 0, '套件没抓到（exit=0）');
  if (r.code !== 0) console.log('       ↳ ' + firstFail.trim().slice(0, 150));
}

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'}: ${pass} passed / ${fail} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
