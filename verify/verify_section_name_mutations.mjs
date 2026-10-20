// verify_section_name_mutations.mjs — 变异检验：把「改名漏改一处」这件事重新做出来，
// 断言 `verify_section_name.mjs` **必须报红**。同时断言已知好版本报绿。
//
// 为什么：改名守卫的全部价值在于"漏改一处就红"。一个守卫若在已知坏例上还是绿，
// 它就等于没有 —— 而它现在护的正是本机反复栽过的"说的和做的不一样"。
//
// 所有变异只写**临时目录**（AGENTS.md：测试不许碰真实路径）。
// 用法：node verify/verify_section_name_mutations.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.join(HERE, 'verify_section_name.mjs');
const PKG = path.resolve(HERE, '..');
const LIVE = path.join(PKG, 'lib', 'client.js');
const GOOD = fs.readFileSync(LIVE, 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-section-mut-'));

let pass = 0, fail = 0;
const assert = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
};

/**
 * Run the guard against a candidate bundle in an ISOLATED copy of the package, so the
 * mutation can never reach the live file the HMR watcher is listening on.
 */
function guardVerdict(bundleText) {
  const dir = fs.mkdtempSync(path.join(tmp, 'pkg-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.mkdirSync(path.join(dir, 'verify'));
  fs.writeFileSync(path.join(dir, 'lib', 'client.js'), bundleText);
  // The guard reads READMEs and every verify_*.mjs, so give it its siblings verbatim.
  for (const f of ['README.md', 'README.en.md']) fs.copyFileSync(path.join(PKG, f), path.join(dir, f));
  for (const f of fs.readdirSync(HERE)) {
    if (/^verify_.*\.mjs$/.test(f)) fs.copyFileSync(path.join(HERE, f), path.join(dir, 'verify', f));
  }
  const r = spawnSync(process.execPath, [path.join(dir, 'verify', 'verify_section_name.mjs')], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

console.log(`tmp: ${tmp}\nbase: ${LIVE} (${Buffer.byteLength(GOOD)} bytes)\n`);

// ── 0. 基线：好版本必须绿（本套件自己的前提） ─────────────────────────────────
console.log('基线');
{
  const r = guardVerdict(GOOD);
  assert('已知好版本 → GREEN', r.code === 0, r.out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 3).join(' | '));
}

// ── 变异：每一个都必须 RED ────────────────────────────────────────────────────
const mutations = [
  {
    name: '① 只改标题、漏改一条指路句（focus.wrapUnlock 的 zh 版）',
    make: (s) => s.replace('"focus.wrapUnlock": "想提前脱身：点标题栏的「解除专注」，或设置 → DeepWorker 里的「立即解锁」。",',
      '"focus.wrapUnlock": "想提前脱身：点标题栏的「解除专注」，或设置 → 历史操作里的「立即解锁」。",'),
  },
  {
    name: '② 只改 zh、漏改 en 的 settings.title',
    make: (s) => s.replace('"settings.title": "DeepWorker",', '"settings.title": "History actions",'),
  },
  {
    name: '③ settings.title 两处都回退成旧名',
    make: (s) => s.replace(/"settings\.title": "DeepWorker",/g, '"settings.title": "历史操作",'),
  },
  {
    name: '④ 漏改「功能开关」那条 banner（feature.notesOffBanner）',
    make: (s) => s.replace('"feature.notesOffBanner": "笔记功能已关闭（设置 → DeepWorker → 功能开关 里可以打开）。存下来的笔记没有被删除。",',
      '"feature.notesOffBanner": "笔记功能已关闭（设置 → 历史操作 → 功能开关 里可以打开）。存下来的笔记没有被删除。",'),
  },
  {
    name: '⑤ 漏改 toast（settings.applyFailures.toast 的 en 版）',
    make: (s) => s.replace('"settings.applyFailures.toast": "DeepWorker had a failed contribution (see Settings → DeepWorker):\\n",',
      '"settings.applyFailures.toast": "DeepWorker had a failed contribution (see Settings → History actions):\\n",'),
  },
  {
    name: '⑥ 指路句改成不存在的分区（拼错成 DeepWroker）——闭集必须拦住',
    make: (s) => s.replace('"feature.disabled": "{name} 已关闭（设置 → DeepWorker 里可以打开）",',
      '"feature.disabled": "{name} 已关闭（设置 → DeepWroker 里可以打开）",'),
  },
  {
    name: '⑦ tabsLabel 回退成旧名',
    make: (s) => s.replace('"settings.tabsLabel": "DeepWorker 设置分区",', '"settings.tabsLabel": "历史操作设置分区",'),
  },
];

console.log('\n变异（每一个都必须 RED）');
for (const m of mutations) {
  const mutated = m.make(GOOD);
  const effective = mutated !== GOOD;
  if (!effective) { assert(m.name + ' → RED', false, '变异没生效（src 里找不到目标串）'); continue; }
  const r = guardVerdict(mutated);
  assert(m.name + ' → RED', r.code !== 0, '守卫没抓到（exit=0）');
}

// ── 夹具漂移也必须红：把指路句抄进某个套件里 ──────────────────────────────────
console.log('\n变异（夹具漂移）');
{
  const dir = fs.mkdtempSync(path.join(tmp, 'pkg-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.mkdirSync(path.join(dir, 'verify'));
  fs.writeFileSync(path.join(dir, 'lib', 'client.js'), GOOD);
  for (const f of ['README.md', 'README.en.md']) fs.copyFileSync(path.join(PKG, f), path.join(dir, f));
  for (const f of fs.readdirSync(HERE)) {
    if (/^verify_.*\.mjs$/.test(f)) fs.copyFileSync(path.join(HERE, f), path.join(dir, 'verify', f));
  }
  // 模拟"下一轮有人手抄了一份旧指路句进夹具"
  fs.appendFileSync(path.join(dir, 'verify', 'verify_render.mjs'),
    "\nconst DRIFTED = '设置 → 历史操作 里可以打开';\n");
  const r = spawnSync(process.execPath, [path.join(dir, 'verify', 'verify_section_name.mjs')], { encoding: 'utf8' });
  assert('⑧ 夹具里手抄了一份旧指路句 → RED', r.status !== 0, '守卫没抓到（exit=0）');
}

// ── README 漂移也必须红 ───────────────────────────────────────────────────────
console.log('\n变异（README 漂移）');
{
  const dir = fs.mkdtempSync(path.join(tmp, 'pkg-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.mkdirSync(path.join(dir, 'verify'));
  fs.writeFileSync(path.join(dir, 'lib', 'client.js'), GOOD);
  fs.copyFileSync(path.join(PKG, 'README.en.md'), path.join(dir, 'README.en.md'));
  fs.writeFileSync(path.join(dir, 'README.md'), fs.readFileSync(path.join(PKG, 'README.md'), 'utf8') + '\n设置 → 历史操作 →「重新加载界面」\n');
  for (const f of fs.readdirSync(HERE)) {
    if (/^verify_.*\.mjs$/.test(f)) fs.copyFileSync(path.join(HERE, f), path.join(dir, 'verify', f));
  }
  const r = spawnSync(process.execPath, [path.join(dir, 'verify', 'verify_section_name.mjs')], { encoding: 'utf8' });
  assert('⑨ README 留着旧菜单路径 → RED', r.status !== 0, '守卫没抓到（exit=0）');
}

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'}: ${pass} passed / ${fail} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
