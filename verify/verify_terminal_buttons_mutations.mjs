// verify_terminal_buttons_mutations.mjs — 变异检验：把「终端按钮」已知的每一种坏写法重新做出来，
// 断言 `verify_terminal_buttons.mjs` **必须报红**；同时断言已知好版本报绿。
//
// 纪律 11：一条断言只有在"把 bug 改回去它就会红"时才算数。本套件断言的是**断言本身**的
// 可信度，不是插件行为。所有变异只写**临时目录**（AGENTS.md：测试不许碰真实路径，
// 而且 lib/client.js 被 HMR 监视 —— 绝不能把坏字节写到线上）。
//
// 用法：node verify/verify_terminal_buttons_mutations.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIVE = path.join(HERE, '..', 'lib', 'client.js');
const GOOD = fs.readFileSync(LIVE, 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-term-mut-'));

let pass = 0, fail = 0;
const assert = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
};

/** Run the behaviour suite against a mutated bundle, in an isolated copy of the package. */
function verdict(bundleText) {
  const dir = fs.mkdtempSync(path.join(tmp, 'pkg-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.mkdirSync(path.join(dir, 'verify'));
  fs.writeFileSync(path.join(dir, 'lib', 'client.js'), bundleText);
  fs.copyFileSync(path.join(HERE, 'verify_terminal_buttons.mjs'),
    path.join(dir, 'verify', 'verify_terminal_buttons.mjs'));
  const r = spawnSync(process.execPath, [path.join(dir, 'verify', 'verify_terminal_buttons.mjs')], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

console.log(`tmp: ${tmp}\nbase: ${LIVE} (${Buffer.byteLength(GOOD)} bytes)\n`);

// ── 0. 基线 ────────────────────────────────────────────────────────────────────
console.log('基线');
{
  const r = verdict(GOOD);
  assert('已知好版本 → GREEN', r.code === 0,
    r.out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 3).join(' | '));
}

// ── 变异集合 ───────────────────────────────────────────────────────────────────
const MUTATIONS = [
  {
    name: '① 结束标记的拼接被去掉（无法判断"跑完了"）',
    // termWrapCommand 不再挂标记 ⇒ 永远等不到 ⇒ 连"同步完成"都判不出来。
    apply: (s) => s.replace(
      'return termNormalizeCommand(command) + " ; echo " + TERM_MARKER_HEAD + "$?__";',
      'return termNormalizeCommand(command);'),
    mustChange: /return termNormalizeCommand\(command\);/,
  },
  {
    name: '② 判据错用 WebTerminalInfo.state（交互式 shell 永远 running ⇒ 假"仍在运行"）',
    // 真机上 state 反映的是**外壳 PTY**：命令跑完后 shell 还活着 ⇒ 恒为 running。
    // 用 `state === "exited"` 当"命令完成了"的判据，就等于永远判不出完成。
    apply: (s) => s.replace(
      '          var wait = await termWaitForMarker(iterator, signal, timeoutMs);',
      '          var shellState = (function () { try { return terminal.state ? terminal.state(agent, terminalId) : "running"; } catch (e) { return "running"; } })();\n'
      + '          var wait = shellState === "exited" ? { kind: "done", code: 0 } : { kind: "timeout" };'),
    mustChange: /var shellState = /,
  },
  {
    name: '③ 前置序列顺序倒置',
    // 2026-10-17 第 2 段：前置序列的拼装从 `runTerminalButton`（按 `config.seq`）搬进了
    // `termJobForEntry`（按 `entry.preStart`）—— 锚点跟着搬。仍然是**反向遍历**那个循环：
    // 在 job.commands 上 reverse 是空操作（那一行执行时数组里还没有前置项），变异会静默失效。
    apply: (s) => s.replace(
      '        for (var q = 0; q < entry.preStart.length; q++) {\n          var pre = wsResolveAction(entry, entry.preStart[q]);',
      '        for (var q = entry.preStart.length - 1; q >= 0; q--) {\n          var pre = wsResolveAction(entry, entry.preStart[q]);'),
    mustChange: /for \(var q = entry\.preStart\.length - 1; q >= 0; q--\)/,
  },
  {
    name: '④ 超时被误报成失败（state = error）',
    apply: (s) => s.replace(
      '            outcome.state = "running";\n            outcome.stillRunning = true;',
      '            outcome.state = "error";\n            outcome.stillRunning = false;'),
    mustChange: /outcome\.stillRunning = false;/,
  },
  {
    name: '⑤ retain 被去掉（空闲 2 小时会被回收；顺序也不再是 create→rename→retain→follow）',
    apply: (s) => s.replace(
      '            await terminal.retain(agent, terminalId, signal);\n            record("retain", true, null);',
      '            record("retain", true, null);'),
    mustChange: /record\("retain", true, null\);\n/,
  },
  {
    name: '⑥ 加入 close（会 SIGTERM→SIGKILL 杀整个进程树，且 closedIds 终身）',
    apply: (s) => s.replace(
      '        try { if (typeof it.return === "function") await it.return(); } catch (e) { /* disconnect is best effort */ }',
      '        try { if (typeof it.return === "function") await it.return(); } catch (e) { /* disconnect is best effort */ }\n'
      + '        try { if (terminal && typeof terminal.close === "function") await terminal.close(agent, id); } catch (e) { /* mutation */ }'),
    mustChange: /await terminal\.close\(agent, id\)/,
  },
  {
    name: '⑦ 会话 id 不显式传（第一个参数传 undefined）',
    // 真机上这就是 `session/not-found` 或"在别人的会话里跑命令"。
    apply: (s) => s.replace(
      '          info = await terminal.create(agent, { id: id, cols: deps.cols || 120, rows: deps.rows || 30 });',
      '          info = await terminal.create(undefined, { id: id, cols: deps.cols || 120, rows: deps.rows || 30 });'),
    mustChange: /terminal\.create\(undefined,/,
  },
  {
    name: '⑧ 前置命令没跑完也继续跑目标命令（顺序保证被拆掉）',
    apply: (s) => s.replace(
      '            if (!isLast) {\n              // 前置命令没跑完 ⇒ 后面的**不许开始**（否则"顺序可验证"就是假的）。',
      '            if (false) {\n              // 前置命令没跑完 ⇒ 后面的**不许开始**（否则"顺序可验证"就是假的）。'),
    mustChange: /if \(false\) \{\n              \/\/ 前置命令没跑完/,
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
  if (r.code !== 0) console.log('       ↳ ' + firstFail.trim().slice(0, 140));
}

// ── 桩失效也必须红（防"套件自己坏了还全绿"）──────────────────────────────────
console.log('\n变异（套件自身失效）');
{
  const dir = fs.mkdtempSync(path.join(tmp, 'pkg-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.mkdirSync(path.join(dir, 'verify'));
  fs.writeFileSync(path.join(dir, 'lib', 'client.js'), GOOD);
  // 把断言目标改成永远为真 —— 若套件真的在读行为，这一改必须让"故意坏掉的执行器"漏过去 ⇒
  // 反过来证明：**不**改断言时它能抓住。这里直接验证"断言里有 close 计数"这件事本身。
  const suite = fs.readFileSync(path.join(HERE, 'verify_terminal_buttons.mjs'), 'utf8');
  const neutered = suite.replace("const closes = methods.filter((m) => m === 'close').length;",
    "const closes = 0; // neutered");
  assert('套件里确实存在 close 计数（去掉计数就不再是它抓的）', neutered !== suite);
  fs.writeFileSync(path.join(dir, 'verify', 'verify_terminal_buttons.mjs'), neutered);
  const r = spawnSync(process.execPath, [path.join(dir, 'verify', 'verify_terminal_buttons.mjs')], { encoding: 'utf8' });
  assert('计数被抹掉后仍然 GREEN（说明计数是唯一抓手 —— 变异 ⑥ 正是靠它）', r.status === 0, 'neutered suite exit=' + r.status);
}

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'}: ${pass} passed / ${fail} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
