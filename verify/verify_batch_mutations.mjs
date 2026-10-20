// verify_batch_mutations.mjs — 变异检验（2026-10-17 第 3 段：批量）。把每一种坏写法重新做出来，
// 断言 `verify_batch.mjs` **必须报红**；同时断言已知好版本报绿。
//
// 纪律 11。这里 7 条，逐条对应用户点名要求：
//   ① 勾选 2 个 ⇒ 恰好 2 次 create、顺序与列表一致   → 反向遍历
//   ② 停止批量走各工作区的停止命令                   → 一律用启动命令
//   ③ 超过每会话上限 ⇒ 提前报错且一个都不创建         → 去掉上限检查
//   ④ 某个失败后其余仍被执行且汇总含失败项           → 失败后中断
//   ⑤ 未勾选时按钮禁用                               → 去掉 disabled
//   ⑨ 批量串行                                       → 改成并行
//   ⑪ 「done」≠「成功」（非零退出码也算失败）         → 把 done 当成功
// （工作区模型那几条 ⑥⑦⑧⑩⑫⑬ 在 verify_workspaces_mutations.mjs —— 第 2 段。）

// 所有变异只写**临时目录**（AGENTS.md：测试不许碰真实路径；lib/client.js 被 HMR 监视）。
// 用法：node verify/verify_workspaces_mutations.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIVE = path.join(HERE, '..', 'lib', 'client.js');
const GOOD = fs.readFileSync(LIVE, 'utf8');
const NODE_PATH = path.join(HERE, '..', 'node_modules');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-ws-mut-'));

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
  fs.copyFileSync(path.join(HERE, 'verify_batch.mjs'), path.join(dir, 'verify', 'verify_batch.mjs'));
  const r = spawnSync(process.execPath, [path.join(dir, 'verify', 'verify_batch.mjs')], {
    encoding: 'utf8',
    timeout: 120000,
    env: Object.assign({}, process.env, { NODE_PATH })
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const MUTATIONS = [
  {
    name: '① 批量的执行顺序被反转（不再按列表顺序）',
    apply: (s) => s.replace(
      '        for (var i = 0; i < paths.length; i++) {\n          var entry = wsFind(store, paths[i]);',
      '        for (var i = paths.length - 1; i >= 0; i--) {\n          var entry = wsFind(store, paths[i]);'),
    mustChange: /for \(var i = paths\.length - 1; i >= 0; i--\) \{\n          var entry = wsFind/,
  },

  {
    name: '② 批量停止跑的是**启动**命令',
    apply: (s) => s.replace('          var job = termJobForEntry(entry, action, t);',
      '          var job = termJobForEntry(entry, "start", t);'),
    mustChange: /var job = termJobForEntry\(entry, "start", t\);/,
  },

  {
    name: '③ 去掉每会话上限的前置检查（9 个就开 9 个）',
    apply: (s) => s.replace(
      '        if (paths.length > TERM_SESSION_MAX) {\n          return refuse(t("term.batchTooMany", { n: paths.length, max: TERM_SESSION_MAX }));\n        }',
      '        if (false) {\n          return refuse(t("term.batchTooMany", { n: paths.length, max: TERM_SESSION_MAX }));\n        }'),
    mustChange: /if \(false\) \{\n          return refuse\(t\("term\.batchTooMany"/,
  },

  {
    name: '④ 一个失败之后就不再跑其余的（半路停下）',
    apply: (s) => s.replace(
      '            chain = chain.then(function () {\n              if (onProgress !== null) {',
      '            chain = chain.then(function () {\n              if (summary.failed > 0) return null;\n              if (onProgress !== null) {'),
    mustChange: /if \(summary\.failed > 0\) return null;/,
  },

  {
    name: '⑤ 未勾选时批量按钮不再禁用（点不动却不说话）',
    apply: (s) => s.split('disabled: busy || checkedPaths.length === 0,').join('disabled: busy,'),
    mustChange: (s) => !/disabled: busy \|\| checkedPaths\.length === 0,/.test(s),
  },

  {
    name: '⑨ 批量改成**并行**（chain 不再串起来）',
    apply: (s) => s.replace('            chain = chain.then(function () {\n              if (onProgress !== null) {',
      '            chain = Promise.resolve().then(function () {\n              if (onProgress !== null) {'),
    mustChange: /chain = Promise\.resolve\(\)\.then\(function \(\) \{/,
  },

  {
    name: '⑪ 把「done」当成功（非零退出码被记账成成功）',
    apply: (s) => s.replace(
      '                var ok = outcome !== null && outcome !== undefined\n'
      + '                  && (outcome.state === "running" || (outcome.state === "done" && outcome.code === 0));',
      '                var ok = outcome !== null && outcome !== undefined && (outcome.state === "done" || outcome.state === "running");'),
    mustChange: /var ok = outcome !== null && outcome !== undefined && \(outcome\.state === "done" \|\| outcome\.state === "running"\);/,
  }
];

console.log(`tmp: ${tmp}\nbase: ${LIVE} (${Buffer.byteLength(GOOD)} bytes)\n`);

console.log('基线');
{
  const r = verdict(GOOD);
  assert('已知好版本 → GREEN', r.code === 0, r.out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 4).join(' | '));
}

console.log('\n变异（每一个都必须 RED）');
for (const m of MUTATIONS) {
  const mutated = m.apply(GOOD);
  const effective = mutated !== GOOD && (typeof m.mustChange === 'function' ? m.mustChange(mutated) : m.mustChange.test(mutated));
  if (!effective) { assert(m.name + ' → RED', false, '变异没生效（anchor 失配 ⇒ 空操作）'); continue; }
  const r = verdict(mutated);
  const firstFail = r.out.split('\n').filter((l) => /FAIL/.test(l))[0] || '';
  assert(m.name + ' → RED', r.code !== 0, '套件没抓到（exit=0）');
  if (r.code !== 0) console.log('       ↳ ' + firstFail.trim().slice(0, 160));
}

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'}: ${pass} passed / ${fail} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
