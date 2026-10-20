/**
 * verify_task8_mask_timer_mutations.mjs — 任务 8（掩层）＋**任务 10**（侧栏计时已删、头部倒计时保留）
 * 的**变异检验**。
 *
 * 把每一处最容易写错的地方**改回去**，断言 `verify_task8_mask_timer.mjs` 必须变红，
 * 而且红在**对应的那条**断言上。只看「退出码非 0」不够：一个无关的崩溃也能让退出码非 0。
 *
 * 每个变异都必须让套件红：
 *   ① 把侧栏计时条目**加回来**      ⇒ 注册级断言（「不得再注册 id=...」）
 *   ② 把计时 i18n 键**加回来**      ⇒ 词表断言（「zh 词典不得再留只被计时用的键」）
 *   ③ 把读数接缝 focusSidebarTimer 加回来 ⇒ 接缝断言
 *   ④ 头部倒计时被摘掉（行为变异）   ⇒ ⑦「工作区锁下头部标签必须含时间」
 *   ⑤ 掩层的标记属性改名            ⇒ 源码守卫「掩层必须保留」
 *   ⑥ 掩层判定改成前缀匹配          ⇒ 反向守卫「前缀匹配会锁错」
 *
 * ⚠️ 纪律：所有变异都只写**临时目录**（AGENTS.md「测试不许碰真实路径」），
 * 通过 `HA_CLIENT_JS` 让套件读变异副本，绝不碰被 HMR 监视的 `lib/client.js`。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SUITE = path.join(here, 'verify_task8_mask_timer.mjs');
const LIVE = path.join(here, '..', 'lib', 'client.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-task10-mut-'));

let pass = 0, fail = 0;
const assert = (name, cond, detail) => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); } };

function runSuite(file) {
  try {
    const out = execFileSync(process.execPath, [SUITE], { encoding: 'utf8', env: Object.assign({}, process.env, { HA_CLIENT_JS: file }), stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : 1, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

// 开发期可以在**未部署**的临时副本上做变异检验（HA_TASK8_BASE=.pending-client.js）。
// 部署后不带参数 = 对着线上 lib/client.js 跑。
const BASE = process.env.HA_TASK8_BASE || LIVE;
const src = fs.readFileSync(BASE, 'utf8');

/**
 * 按锚点精确替换：`anchor` 必须在 base 里**唯一**，否则直接报错。
 * 手写缩进的替换串会静默不生效（踩过：变异没生效却报「红在别处」），
 * 所以一律「先断言锚点唯一，再替换」。
 */
function mutate(src, anchor, replacement, label) {
  const n = src.split(anchor).length - 1;
  if (n !== 1) throw new Error('锚点不唯一（' + n + ' 次）：' + label + ' :: ' + JSON.stringify(anchor.slice(0, 80)));
  return src.replace(anchor, replacement);
}

console.log(`tmp: ${tmp}\nbase: ${BASE} (${Buffer.byteLength(src)} bytes)\n`);

console.log('基线');
{
  const r = runSuite(BASE);
  assert('基线 bundle 上套件必须全绿（本套件的前提）', r.code === 0, 'exit=' + r.code + '\n' + r.out.split('\n').slice(-6).join('\n'));
}

const EXPORTS_TAIL = 'paintLockedSessions: function () { return typeof testHooks.paintLockedSessions === "function" ? testHooks.paintLockedSessions() : undefined; } };';
const EXPORTS_TAIL_BACK = 'paintLockedSessions: function () { return typeof testHooks.paintLockedSessions === "function" ? testHooks.paintLockedSessions() : undefined; }, focusSidebarTimer: function () { return typeof testHooks.focusSidebarTimer === "function" ? testHooks.focusSidebarTimer() : undefined; } };';

const SIDEBAR_ENTRY_BACK = [
  '        var disposeTimer = ctx.slots.register({',
  '          name: "sidebar.footer.action",',
  '          id: "history-actions-focus-timer",',
  '          order: 4,',
  '          locale: NS,',
  '          label: function () { return "专注中"; }',
  '        }, function () { return null; });',
  '        var dispose = ctx.slots.register({',
].join('\n');

/* 每个变异：{name, make, expectFail} —— expectFail 是**必须出现**的那条断言文字 */
const mutations = [
  {
    name: '① 把侧栏计时条目加回来（在「笔记」上面，order 4）',
    make: (s) => mutate(s,
      '        var dispose = ctx.slots.register({',
      SIDEBAR_ENTRY_BACK,
      'reg/add-back'),
    expectFail: '不得再注册 id=history-actions-focus-timer 的条目',
  },
  {
    name: '② 把计时的 i18n 键加回来（中英各一条，键集仍然一致 ⇒ 只能靠词表断言抓）',
    make: (s) => {
      let out = mutate(s,
        '      "focus.rowLocked": "已锁住：专注期间不可用",',
        '      "focus.timerSidebar": "🔒 专注中 · 还剩 {left}",\n      "focus.rowLocked": "已锁住：专注期间不可用",',
        'i18n/zh-back');
      out = mutate(out,
        '      "focus.rowLocked": "Locked out: unavailable while focusing",',
        '      "focus.timerSidebar": "🔒 Focused · {left} left",\n      "focus.rowLocked": "Locked out: unavailable while focusing",',
        'i18n/en-back');
      return out;
    },
    expectFail: 'zh 词典不得再留只被计时用的键',
  },
  {
    name: '③ 把读数接缝 focusSidebarTimer 加回来（testHooks + exports.__test 两处）',
    make: (s) => {
      let out = mutate(s,
        '      testHooks.focusDimMarks = function (items, lock) { return focusDimMarks(items, lock, activeSessionId()); };',
        '      testHooks.focusSidebarTimer = function () { return "MUTATION"; };\n      testHooks.focusDimMarks = function (items, lock) { return focusDimMarks(items, lock, activeSessionId()); };',
        'seam/back');
      out = mutate(out, EXPORTS_TAIL, EXPORTS_TAIL_BACK, 'seam/exports-back');
      return out;
    },
    expectFail: 'api.focusSidebarTimer 读数接缝必须已删除',
  },
  {
    name: '④ 头部倒计时被摘掉（focusHeaderLabel 直接返回静态文案）',
    make: (s) => mutate(s,
      '      function focusHeaderLabel() {\n        try {',
      '      function focusHeaderLabel() {\n        try {\n          return t("focus.headerLockShort");   // MUTATION: the countdown is gone',
      'header/no-countdown'),
    // 红在**行为**断言上：标签永远是「专注」，不含 HH:MM。
    expectFail: '工作区锁下头部标签必须含时间',
  },
  {
    name: '⑤ 掩层标记属性改名（掩层被改坏必须变红；行为断言先红）',
    make: (s) => mutate(s,
      '      var FOCUS_DIM_ATTR = "data-ha-focus-dim";',
      '      var FOCUS_DIM_ATTR = "data-x";   // MUTATION: the mask attribute is gone',
      'mask/attr-renamed'),
    expectFail: '非目标工作区的会话行必须上灰',
  },
  {
    name: '⑥ 掩层判定改成前缀匹配（父目录会被当成锁的目标）',
    make: (s) => mutate(s,
      '            if (path === "" || path === targetPath) continue;',
      '            if (path === "" || targetPath.indexOf(path) === 0) continue;   // MUTATION: prefix match',
      'mask/prefix'),
    expectFail: '前缀匹配会锁错',
  },
  {
    name: '⑦ 把锁 emoji 加回头部按钮（用户明确要去掉的那一个）',
    // 任务 15 起计时那个 label 的 `jsx("span", …)` 变成了**多行**（加了 style 对象）⇒
    // 逐字锚点失效。这里改用「空白折叠」的等价锚点：把目标片段压成单行形式再按正则替换回原文，
    // 既不依赖缩进/换行，也不放宽到能匹配别的 span（children 的表达式必须逐字相同）。
    make: (s) => {
      const re = /\(0, react_jsx_runtime\.jsx\)\("span",\s*\{(?:[^}]*?style:\s*\{[^}]*\}\s*,)?\s*children:\s*locked \? \(t\("focus\.headerUnlockShort"\) \+ " " \+ countdown\) : t\("focus\.headerLockShort"\)\s*\},\s*"label"\)/;
      const hit = re.exec(s);
      if (!hit) throw new Error('锚点找不到：头部计时 label 的 jsx("span", …)（header/emoji-back）');
      const emoji = '(0, react_jsx_runtime.jsx)("span", { children: locked ? "\ud83d\udd12" : "\ud83d\udd13" }, "icon"), ';
      return s.slice(0, hit.index) + emoji + s.slice(hit.index);
    },
    // 红在**行为**断言上：SSR 渲染出来的按钮里又出现了 🔓。
    expectFail: '未锁时按钮渲染不得含',
  },
];

console.log('\n变异（每一个都必须 RED，且红在对应的断言上）');
for (const m of mutations) {
  const mutated = m.make(src);
  const effective = mutated !== src;
  const file = path.join(tmp, m.name.replace(/[^\w]+/g, '_').slice(0, 36) + '.js');
  fs.writeFileSync(file, mutated, 'utf8');
  const r = runSuite(file);
  const hit = r.out.indexOf(m.expectFail) !== -1;
  assert(m.name + ' → RED@对应断言', effective && r.code !== 0 && hit,
    !effective ? '变异没生效（源串找不到）' : (r.code === 0 ? '套件仍然全绿' : '红了，但不是这条断言：' + (r.out.split('\n').filter((l) => l.startsWith('FAIL')).join(' | ') || '(无 FAIL 行)')));
  if (effective && r.code !== 0 && hit) {
    const line = r.out.split('\n').find((l) => l.startsWith('FAIL'));
    console.log(`       ↳ ${line}`);
  }
}

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'}: ${pass} passed / ${fail} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
