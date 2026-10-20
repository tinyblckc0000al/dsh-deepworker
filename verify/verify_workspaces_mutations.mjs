// verify_workspaces_mutations.mjs — 变异检验（2026-10-17 第 2 段：多工作区模型）。
// 把每一种坏写法重新做出来，断言 `verify_workspaces.mjs` **必须报红**；同时断言已知好版本报绿。
//
// 纪律 11：一条断言只有在"把 bug 改回去它就会红"时才算数。这里 6 条：
//   ⑥ 老数据平滑迁移                         → 不读老键
//   ⑦ 跨工作区命令必须先 cd                  → 去掉 cd
//   ⑧ cd 用 &&（失败不许继续）               → 改成 ;
//   ⑩ stopBeforeStart 不许把同一条命令跑两遍 → 去掉去重
//   ⑫ path 必须规范化（去尾斜杠）            → 去掉 normalize
//   ⑬ 头部只给"列表里的工作区"渲染按钮        → 给未配置的也造一条
// （批量的那几条 ①②③④⑤⑨⑪ 在 verify_batch_mutations.mjs —— 第 3 段。）

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
  fs.copyFileSync(path.join(HERE, 'verify_workspaces.mjs'), path.join(dir, 'verify', 'verify_workspaces.mjs'));
  const r = spawnSync(process.execPath, [path.join(dir, 'verify', 'verify_workspaces.mjs')], {
    encoding: 'utf8',
    timeout: 120000,
    env: Object.assign({}, process.env, { NODE_PATH })
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const MUTATIONS = [
  {
    name: '⑥ 老数据不再迁移（单工作区配置全丢）',
    apply: (s) => s.replace('      var legacy = wsReadLegacyMap();', '      var legacy = {};'),
    mustChange: /var legacy = \{\};/,
  },

  {
    name: '⑦ 执行时不再先 cd 到工作区自己的目录',
    apply: (s) => s.replace('termWrapCommand(termCommandWithCwd(job.cwd, entry.command))',
      'termWrapCommand(entry.command)'),
    mustChange: /termWrapCommand\(entry\.command\)/,
  },

  {
    name: '⑧ cd 与命令之间用 ; 而不是 &&（cd 失败也继续跑）',
    apply: (s) => s.replace('      return "cd " + termQuotePath(path) + " && { " + trimmed + " ; }";',
      '      return "cd " + termQuotePath(path) + " ; { " + trimmed + " ; }";'),
    mustChange: /"cd " \+ termQuotePath\(path\) \+ " ; \{ "/,
  },

  {
    name: '⑩ stopBeforeStart 与 preStart 里的 stop 重复跑（同一条命令跑两遍）',
    apply: (s) => s.replace('        if (entry.stopBeforeStart === true && entry.preStart.indexOf("stop") < 0',
      '        if (entry.stopBeforeStart === true'),
    mustChange: /if \(entry\.stopBeforeStart === true\n/,
  },
  {
    name: '⑫ 路径不再去尾斜杠（/w/one 与 /w/one/ 变成两条工作区）',
    apply: (s) => s.replace('      while (text.length > 1 && text.charAt(text.length - 1) === "/") text = text.slice(0, -1);', ''),
    mustChange: (s) => !/while \(text\.length > 1 && text\.charAt\(text\.length - 1\) === "\/"\)/.test(s),
  },
  {
    name: '⑬ 头部对"不在列表里的工作区"也渲染按钮（用户看不出它没配置）',
    apply: (s) => s.replace(
      '        var entry = termWorkspaceEntry(cwd);\n        if (entry === null) return null;',
      '        var entry = termWorkspaceEntry(cwd);\n        if (entry === null) entry = wsNormalizeEntry({ path: "/tmp/fallback" }, "/tmp/fallback");'),
    mustChange: /entry = wsNormalizeEntry\(\{ path: "\/tmp\/fallback" \}/,
  },
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
