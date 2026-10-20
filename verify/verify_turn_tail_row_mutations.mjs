// verify_turn_tail_row_mutations.mjs — 变异检验（2026-10-17 第 1 段：删除「回退到此」）。
//
// 纪律 11：断言若不能被证明会红，就是装饰。这里把每一种"删错了"或"删回去了"的写法重新做出来，
// 断言 `verify_turn_tail_row.mjs` **必须报红**；同时断言已知好版本报绿。
//
//   M1 把 action.rollback 加回**两个**词典（zh + en）        → 词典/源码扫描必须红
//   M2 把「回退到此」按钮加回那排（用户点名的那条变异）      → 5 颗/顺序断言 + 扫描必须红
//   M2b 往那排塞一颗**文案无害**的第 6 颗按钮                → 只有行为级计数能抓（证明它不是 grep）
//   M3 顺手删掉「在此分支」的 onClick                        → "每颗都带 onClick" 必须红
//   M4 把 forkBefore 删掉（连带删多了）                      → 看门断言必须红
//
// ⚠️ 锚点失配 = 空操作，比没有更糟 ⇒ 每条变异都断言"命中恰好 1 次"，并断言产物里确实有变化。
// 所有变异只写**临时目录**（AGENTS.md：测试不许碰真实路径；lib/client.js 被 HMR 监视）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIVE = path.join(HERE, '..', 'lib', 'client.js');
const GOOD = fs.readFileSync(LIVE, 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-row-mut-'));

let pass = 0, fail = 0;
const assert = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
};

/** 把一段 bundle 放进一个临时"包"里，跑一次真套件，返回 {code, out}。 */
function verdict(bundleText) {
  const dir = fs.mkdtempSync(path.join(tmp, 'pkg-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.mkdirSync(path.join(dir, 'verify'));
  fs.writeFileSync(path.join(dir, 'lib', 'client.js'), bundleText);
  fs.copyFileSync(path.join(HERE, 'verify_turn_tail_row.mjs'), path.join(dir, 'verify', 'verify_turn_tail_row.mjs'));
  const r = spawnSync(process.execPath, [path.join(dir, 'verify', 'verify_turn_tail_row.mjs')], { encoding: 'utf8', timeout: 120000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/** 命中必须恰好 1 次；否则这条变异是空操作（或炸了别的行）⇒ 直接算失败。 */
function mustReplace(text, old, neu, label) {
  const hits = text.split(old).length - 1;
  if (hits !== 1) throw new Error('anchor "' + label + '" hit ' + hits + ' times (must be exactly 1)');
  return text.split(old).join(neu);
}

const ROW_OPEN = '            style: rowStyle,\n            children: [\n';

const MUTATIONS = [
  {
    name: 'M1 action.rollback 被加回两个词典',
    apply: (s) => {
      let out = mustReplace(s, '      "action.retry": "重试本轮",\n',
        '      "action.rollback": "回退到此",\n      "action.retry": "重试本轮",\n', 'zh 词典插入点');
      out = mustReplace(out, '      "action.retry": "Retry this turn",\n',
        '      "action.rollback": "Roll back here",\n      "action.retry": "Retry this turn",\n', 'en 词典插入点');
      if (out.split('"action.rollback"').length - 1 !== 2) throw new Error('the key was not re-added twice');
      return out;
    }
  },
  {
    name: 'M2 「回退到此」按钮被加回那排（原样）',
    apply: (s) => mustReplace(s, ROW_OPEN,
      ROW_OPEN +
      '              (0, react_jsx_runtime.jsx)("button", {\n' +
      '                type: "button",\n' +
      '                style: buttonStyle,\n' +
      '                onClick: onQuote,\n' +
      '                children: "回退到此"\n' +
      '              }),\n', '那排按钮的开头')
  },
  {
    name: 'M2b 那排被塞进一颗文案无关的第 6 颗按钮（只有计数能抓）',
    apply: (s) => {
      const out = mustReplace(s, ROW_OPEN,
        ROW_OPEN +
        '              (0, react_jsx_runtime.jsx)("button", {\n' +
        '                type: "button",\n' +
        '                style: buttonStyle,\n' +
        '                onClick: onQuote,\n' +
        '                children: "多出来的按钮"\n' +
        '              }),\n', '那排按钮的开头');
      // 这颗按钮不带任何被扫的关键词 ⇒ 文本扫描永远不会红，只有"恰好 5 颗"能抓。
      if (out.includes('action.rollback') || out.includes('回退到此')) throw new Error('this mutation must stay text-scan-clean');
      return out;
    }
  },
  {
    name: 'M3 「在此分支」的 onClick 被顺手删掉',
    apply: (s) => mustReplace(s,
      '                onClick: onBranch,\n                children: t("action.branch")\n',
      '                children: t("action.branch")\n', '在此分支按钮的 props')
  },
  {
    name: 'M4 forkBefore 被删掉（删除越界）',
    apply: (s) => {
      let out = mustReplace(s, '      var forkBefore = props.forkBefore;\n', '', '组件里的 forkBefore');
      out = mustReplace(out, '              forkBefore: function (boundary) { return doFork(sessionId, boundary); },\n', '', 'inject 里的 forkBefore');
      if (out.includes('forkBefore')) throw new Error('forkBefore still present after the mutation');
      return out;
    }
  },
  {
    // 「在此分支」看起来还活着（有 onClick、文案也对），但接错了 handler —— 只有"真点数一次
    // ctx.sessions.fork"这条行为级断言能抓。文本扫描、SSR 渲染都永远绿。
    name: 'M5 「在此分支」接错 handler（有 onClick 但不 fork）',
    apply: (s) => mustReplace(s,
      '                onClick: onBranch,\n                children: t("action.branch")\n',
      '                onClick: onQuote,\n                children: t("action.branch")\n', '在此分支按钮的 handler')
  }
];

console.log('baseline: the live bundle must pass the row suite');
{
  const good = verdict(GOOD);
  assert('live bundle -> GREEN (exit=0)', good.code === 0, 'exit=' + good.code + '\n' + good.out.split('\n').slice(-6).join('\n'));
}

for (const mutation of MUTATIONS) {
  let mutated = null;
  try {
    mutated = mutation.apply(GOOD);
  } catch (e) {
    assert(mutation.name + ' -> 变异本身可应用', false, String(e && e.message || e));
    continue;
  }
  if (mutated === GOOD) {
    assert(mutation.name + ' -> 变异本身可应用', false, '产物与原文相同（空操作）');
    continue;
  }
  const r = verdict(mutated);
  const failLines = (r.out.match(/^\s*FAIL\b.*$/gm) || []).map((line) => line.trim());
  assert(mutation.name + ' -> RED', r.code !== 0, '套件没抓到（exit=0）');
  if (r.code !== 0) {
    const why = failLines.slice(0, 2).join(' | ') || r.out.trim().split('\n').slice(-2).join(' | ');
    console.log('         ↳ ' + why);
  }
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* temp only */ }

console.log('');
if (fail > 0) {
  console.error(fail + ' mutation check(s) failed (pass=' + pass + ')');
  console.error('TURN-TAIL ROW MUTATION CHECKS FAILED');
  process.exit(1);
}
console.log('all ' + pass + ' mutation checks behaved (' + MUTATIONS.length + ' mutations + 1 baseline)');
console.log('TURN-TAIL ROW MUTATION CHECKS PASSED');
