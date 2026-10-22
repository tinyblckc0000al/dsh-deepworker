/**
 * verify_debug_gate_mutations.mjs — `verify_debug_gate.mjs` 的**变异检验**。
 *
 * 一条断言只有在"把 bug 改回去它就会红"时才算数（AGENTS.md 纪律 11）。这里把三种
 * 已知会复现用户问题的写法各改回去一次，**每一条都必须让主套件变红**：
 *
 *   ① 去掉门控（`session.rename` 恢复成无条件调用）          ⇒ 主套件红
 *   ② `SETTING_DEFAULTS` 里把默认值改成 `true`                ⇒ 主套件红
 *   ③ 把复选框与设置键的绑定断开（`row("retryNote", …)`）      ⇒ 主套件红
 *
 * 另加三条，专门证明**各条断言各自独立有效**（不是靠同一条文本 grep 撑着）：
 *   ④ 五处气泡的门控全部拆掉（把门条件 `<indent>if (resendTraceOn) {` 改成 `if (true) {`；
 *      rename 那处不动）⇒ 只有**气泡**断言能抓到它（rename 仍是 0）⇒ 证明气泡那半边真的在测行为。
 *      ⚠️ 2026-10-15：气泡的门控从 `resendTraceOn && showNotice(…)`（一个表达式语句）
 *      改回常规的 `if (resendTraceOn) { showNotice(…); }` —— 旧形状只是为了绕开
 *      `verify_scope_refs.mjs` 的形参绑定假阳性（详见该文件头部）。所以这条变异也跟着
 *      改成"把门条件改成恒真"，并按行首缩进 + 下一行 `showNotice(` 精确命中五个代码点，
 *      不去动注释里的同名文本。
 *   ⑤ `row()` 的 `checked` 表达式改成读**别的键**（源码里
 *      `row("debugResendTrace", t("settings.debugResendTrace"))` 一字不动）
 *      ⇒ 只有**渲染级**的 checked 断言能抓到它 ⇒ 证明那条不是文本断言。
 *   ⑥ 门变量写成常量 `true`（开关不再接线）⇒ 只有**运行时**的「开关为假 ⇒ 零气泡」能抓到它。
 *
 * 变异只写在 `/tmp` 的副本上：`lib/client.js` 被 HMR 监视，**绝不**把坏字节写到线上。
 *
 * 用法：`node verify/verify_debug_gate_mutations.mjs`
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITE = path.join(HERE, 'verify_debug_gate.mjs');
const LIVE = path.join(HERE, '..', 'lib', 'client.js');

const MUTATIONS = [
  {
    name: '① 去掉门控：session.rename 恢复成无条件调用',
    apply: (s) => s.replace(
      'if (resendTraceEnabled() && ctx.remote && ctx.remote.session && typeof ctx.remote.session.rename === "function") {',
      'if (ctx.remote && ctx.remote.session && typeof ctx.remote.session.rename === "function") {')
  },
  {
    name: '② SETTING_DEFAULTS 里 debugResendTrace 的默认值改成 true',
    // 2026-10-15：`debugResendTrace` 不再是 SETTING_DEFAULTS 的最后一项（功能总开关排在它
    // 后面），所以它现在**带尾逗号**。匹配必须容忍两种写法，否则这条变异会静默变成空操作
    // —— 而"空操作"会被下面的 no-op 检查判红（那次正是它把这件事报出来的）。
    apply: (s) => s.replace(/      debugResendTrace: false,?\n/, '      debugResendTrace: true,\n')
  },
  {
    name: '③ 复选框与设置键的绑定断开：row("debugResendTrace", …) 改成绑定 retryNote',
    apply: (s) => s.replace(
      'row("debugResendTrace", t("settings.debugResendTrace"))',
      'row("retryNote", t("settings.debugResendTrace"))')
  },
  {
    name: '④ 五处气泡的门控全部拆掉（门条件改成恒真；rename 那处不动）',
    apply: (s) => s.replace(/^([ \t]*)if \(resendTraceOn\) \{\n([ \t]*)showNotice\(/gm, '$1if (true) {\n$2showNotice(')
  },
  {
    name: '⑤ 复选框的 checked 表达式改读别的键（源码里的 row(...) 一字不动）',
    // 2026-10-15 改版：设置页的 row() 先把判定收进 `isOn`（bug 形状同前），所以变异点跟着
    // 搬到那一行：让 checked 的来源改读**别的键**，`row(...)` 调用点一字不动 ⇒ 复选框与
    // 它自己的设置键脱钩。
    // ⚠️ 两次踩坑记录（都实测过，别再改回去）：
    //   ① 把 `isOn` 写成 `(...) || true || key === …` 是**空转**：`||` 比三目优先级高，
    //      整个条件恒真 ⇒ 三目退回 `state[0][key] !== false`，行为与原来一模一样。
    //   ② 目标键必须是**非布尔判定**那一支（`debugResendTrace` 走 `=== true`）。功能开关
    //      走的是 `!== false`，测试用 `retryNote: true` 去反证它根本不会变红。
    apply: (s) => s.replace(
      'var isOn = defaultOn ? state[0][key] !== false : state[0][key] === true;',
      'var isOn = state[0]["retryNote"] === true;')
  },
  {
    name: '⑥ 门变量被写成常量 true（开关不再接线：resendTraceOn 恒真）',
    apply: (s) => s.split('var resendTraceOn = resendTraceEnabled();').join('var resendTraceOn = true;')
  }
];

/** Run the main suite against `candidate`; return { status, output }. */
function runSuite(candidate, label) {
  const proc = spawnSync(process.execPath, [SUITE], {
    cwd: path.join(HERE, '..'),
    encoding: 'utf8',
    env: Object.assign({}, process.env, { HA_CLIENT_JS: candidate }),
    maxBuffer: 32 * 1024 * 1024
  });
  const output = (proc.stdout || '') + (proc.stderr || '');
  return { status: proc.status === null ? -1 : proc.status, output: output, label: label };
}

const source = fs.readFileSync(LIVE, 'utf8');
let failures = 0;
const fail = (m) => { failures++; console.error('FAIL: ' + m); };
const okLog = (m) => console.log('  ok   ' + m);

console.log('mutation checks for verify_debug_gate.mjs\n');

/* 0) baseline: the UNMUTATED live bundle must pass, or every mutation below is meaningless. */
{
  const base = runSuite(LIVE, 'baseline');
  if (base.status !== 0) {
    fail('baseline: the unmutated online bundle must PASS the gate suite, got exit=' + base.status +
      '\n' + base.output.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 6).join('\n'));
  } else {
    okLog('baseline: 未变异的线上 bundle 通过（' + (base.output.match(/DEBUG GATE CHECKS PASSED \((\d+) ok\)/) || [0, '?'])[1] + ' ok）');
  }
}

/* 1) each mutation must turn the suite red. */
let caught = 0;
for (const [index, mutation] of MUTATIONS.entries()) {
  const mutated = mutation.apply(source);
  if (mutated === source) {
    fail('mutation "' + mutation.name + '" 没有改动源码（模式没命中）—— 这条变异是空操作，不算数');
    continue;
  }
  const tmp = path.join(os.tmpdir(), 'debug-gate-mutant-' + (index + 1) + '.js');
  fs.writeFileSync(tmp, mutated);
  const result = runSuite(tmp, mutation.name);
  try { fs.unlinkSync(tmp); } catch (e) { /* temp file */ }
  const failLines = result.output.split('\n').filter((l) => /^FAIL/.test(l.trim()));
  if (result.status !== 0 && failLines.length > 0) {
    caught++;
    // Print up to three: the point is to show BOTH halves (source-level AND the runtime
    // "rename count = 0" reading) going red, not just the first grep that happened to trip.
    const shown = failLines.slice(0, 3).map((l) => l.trim().slice(0, 160)).join('\n           → ');
    okLog('caught: ' + mutation.name + ' (' + failLines.length + ' FAIL line(s))\n           → ' + shown);
  } else {
    fail('mutation NOT caught: ' + mutation.name + ' (exit=' + result.status + ', FAIL lines=' + failLines.length + ')');
  }
}

console.log('\n' + (caught === MUTATIONS.length && failures === 0
  ? 'ALL ' + caught + ' MUTATIONS CAUGHT'
  : (MUTATIONS.length - caught) + '/' + MUTATIONS.length + ' mutations caught, ' + failures + ' failure(s)'));
process.exit(failures === 0 ? 0 : 1);
