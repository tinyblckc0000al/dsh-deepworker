// verify_feature_scope_note_mutations.mjs — 变异检验：把那句说明**删掉 / 挪走 / 掏空**，
// 断言 `verify_feature_scope_note.mjs` 必须报红；同时断言已知好版本报绿。
//
// 纪律 11。三个真实形状：
//   ① 删掉那句话（用户又回到"为什么会话操作里有的开关，基础页要再挂一遍？"）
//   ② 保留但**挪到总开关下面**（说明读起来变成了"这几个开关的注解"，而它讲的是整张卡片）
//   ③ 元素还在、文字被清空（最阴的一种：DOM 钩子满足、用户什么也看不到）
//   ④ 把那份 zh 文案从词典里删掉（键没了 ⇒ 页面渲染出裸键名）
//
// 所有变异只写**临时目录**（AGENTS.md：测试不许碰真实路径；lib/client.js 被 HMR 监视）。
// 用法：node verify/verify_feature_scope_note_mutations.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIVE = path.join(HERE, '..', 'lib', 'client.js');
const GOOD = fs.readFileSync(LIVE, 'utf8');
const NODE_PATH = path.join(HERE, '..', 'node_modules');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-scopenote-mut-'));

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
  fs.copyFileSync(path.join(HERE, 'verify_feature_scope_note.mjs'), path.join(dir, 'verify', 'verify_feature_scope_note.mjs'));
  const r = spawnSync(process.execPath, [path.join(dir, 'verify', 'verify_feature_scope_note.mjs')], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { NODE_PATH })
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const NOTE_ELEMENT = `                    (0, react_jsx_runtime.jsx)("div", {
                      "data-dw-feature-scope-note": "",
                      style: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-secondary)", padding: "2px 0 8px" },
                      children: t("settings.featureScopeNote")
                    }, "feature-scope-note"),
`;

console.log(`tmp: ${tmp}\nbase: ${LIVE} (${Buffer.byteLength(GOOD)} bytes)\n`);

console.log('基线');
{
  const r = verdict(GOOD);
  assert('已知好版本 → GREEN', r.code === 0, r.out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 3).join(' | '));
}

const MUTATIONS = [
  {
    name: '① 整段说明被删掉（用户又不知道两种开关的区别）',
    apply: (s) => s.replace(NOTE_ELEMENT, ''),
    // ⚠️ 判据必须看**元素本身**（`"data-dw-feature-scope-note": ""`），不能只看那个词 ——
    //    元素正上方那三条注释里也有这个词，按词判会把"删干净了"误报成"变异没生效"。
    mustChange: (s) => !/"data-dw-feature-scope-note": ""/.test(s),
  },
  {
    name: '② 说明被复制一份（同一个说明出现两次，页面读起来重复）',
    apply: (s) => s.replace(NOTE_ELEMENT, NOTE_ELEMENT + NOTE_ELEMENT),
    mustChange: (s) => (s.match(/"data-dw-feature-scope-note": ""/g) || []).length === 2,
  },
  {
    name: '③ 元素还在、文字被掏空（DOM 钩子满足、用户什么也看不到）',
    apply: (s) => s.replace('                      children: t("settings.featureScopeNote")',
      '                      children: ""'),
    mustChange: /children: ""\n                    \}, "feature-scope-note"\)/,
  },
  {
    name: '④ zh 词典里那句文案被删（页面渲染出裸键名）',
    // 两份词典（zh + en）一起删：只删一份就变成"键集不一致"，那是另一个缺陷。
    apply: (s) => s.replace(/\n      "settings\.featureScopeNote": "[^"]*",/g, ''),
    // 判据是"**定义**没了"（`"key":`），不是"这个词没了" —— JSX 里还有 `t("settings.featureScopeNote")`。
    mustChange: (s) => (s.match(/"settings\.featureScopeNote":/g) || []).length === 0,
  },
];

console.log('\n变异（每一个都必须 RED）');
for (const m of MUTATIONS) {
  const mutated = m.apply(GOOD);
  const effective = mutated !== GOOD && (typeof m.mustChange === 'function' ? m.mustChange(mutated) : m.mustChange.test(mutated));
  if (!effective) { assert(m.name + ' → RED', false, '变异没生效（anchor 失配 ⇒ 空操作）'); continue; }
  const r = verdict(mutated);
  const firstFail = r.out.split('\n').filter((l) => /FAIL/.test(l))[0] || '';
  assert(m.name + ' → RED', r.code !== 0, '套件没抓到（exit=0）');
  if (r.code !== 0) console.log('       ↳ ' + firstFail.trim().slice(0, 150));
}

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'}: ${pass} passed / ${fail} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
