// verify_terminal_header_mutations.mjs — 变异检验：把"order 改回去"和"去掉竖线"各做一遍，
// 断言 `verify_terminal_header.mjs` **必须报红**；同时断言已知好版本报绿。
//
// 纪律 11：一条断言只有在"把 bug 改回去它就会红"时才算数。这两条正是用户看真机截图才发现的
// 问题（紧挨着官方【打开】像同一组），所以它们各配一条变异。
//
// 所有变异只写**临时目录**（AGENTS.md：测试不许碰真实路径；lib/client.js 被 HMR 监视）。
// 用法：node verify/verify_terminal_header_mutations.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const LIVE = path.join(HERE, '..', 'lib', 'client.js');
const GOOD = fs.readFileSync(LIVE, 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-termhdr-mut-'));

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
  fs.copyFileSync(path.join(HERE, 'verify_terminal_header.mjs'), path.join(dir, 'verify', 'verify_terminal_header.mjs'));
  // ⚠️ 隔离副本在 /tmp，`require('react')` 从那里往上找不到 —— 所以把【插件自己】的 node_modules
  //    挂到 NODE_PATH 上（NODE_PATH 正是 CJS 解析的回退路径）。不这么做的话**基线就会红**，
  //    而基线的红是"套件自己跑不起来"，不是"变异被抓到"（假绿的反面同样致命）。
  const r = spawnSync(process.execPath, [path.join(dir, 'verify', 'verify_terminal_header.mjs')], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { NODE_PATH: path.join(HERE, '..', 'node_modules') })
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
    name: '① order 改回 40（用户看到的那种"挤在【打开】旁边"）',
    apply: (s) => s.replace('          order: -20,', '          order: 40,'),
    mustChange: /\n          order: 40,/,
  },
  {
    name: '①b order 改回改造前的 -8（仍在【打开】右边）',
    apply: (s) => s.replace('          order: -20,', '          order: -8,'),
    mustChange: /\n          order: -8,/,
  },
  {
    name: '①c order 改成 -10（与 open-in-app **同值** ⇒ 不再"严格在它前面"）',
    apply: (s) => s.replace('          order: -20,', '          order: -10,'),
    mustChange: /\n          order: -10,/,
  },
  {
    name: '①d 顺手把既有条目也改掉（专注锁 -12 → 40）',
    apply: (s) => s.replace('          order: -12,', '          order: 40,'),
    mustChange: /\n          order: 40,/,
  },
  {
    name: '② 去掉竖线（把 separator 从返回节点里摘掉）',
    apply: (s) => s.replace('children: children.concat([separator])', 'children: children'),
    mustChange: /children: children\n/,
  },
  {
    name: '②b 竖线保留但高度/色值被清掉（渲染出一个看不见的 span）',
    apply: (s) => s.replace('            background: "var(--dsw-alias-border-l3)"', '            background: "none"'),
    mustChange: /background: "none"/,
  },
  {
    name: '②c 竖线不 aria-hidden（进无障碍树，读屏会念一个空元素）',
    apply: (s) => s.replace('          "aria-hidden": "true",\n          "data-dw-terminal-separator": "",', '          "data-dw-terminal-separator": "",'),
    mustChange: /data-dw-terminal-separator/,
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
