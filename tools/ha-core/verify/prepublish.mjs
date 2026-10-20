#!/usr/bin/env node
/**
 * prepublish.mjs — 发布前必跑的**唯一入口**（2026-10-13 新增）。
 *
 * 为什么要有它：发布前该跑的东西散在三处，而且其中一条**永远返回退出码 0** ——
 * `dsh-combo-sim/verify/verify_scope_refs.mjs` 把 `FAIL` 打在 stdout 上，最后一行却是
 * 无条件的 `process.exit(0)`。人一忙就会漏跑；漏跑的那一类恰好是 `AGENTS.md` 记的
 * "运行期 `ReferenceError` ⇒ combo 里 `import failed` ⇒ App 起不来"，
 * 而 `node --check` / `vm.Script` / 单文件套件**全绿都拦不住**。
 *
 * 纪律：它**只调用，不修改**。`dsh-deepworker/**` 与 `dsh-combo-sim/**`
 * 一个字节都不写（本文件自己也在 `dsh-ha-core/**` 里）。
 *
 * 顺序（每条都跑在独立子进程里，一条红了也继续跑完，最后统一汇总）：
 *   ① `dsh-deepworker/verify/verify_bundle_health.mjs`
 *      —— 线上 bundle 的静态体检（字节层 / 词法层 / 结构层 / 加载层）。
 *      它本身就是 ③ 的成员，所以只跑一次（③ 会把它跳过并在输出里说明）。
 *   ② `tools/combo-sim/verify/verify_scope_refs.mjs`
 *      —— 越界引用扫描（抓"运行期 ReferenceError"那一类）。
 *   ②' `tools/combo-sim/verify/verify_temp_isolation.mjs`（2026-10-17 新增）
 *      —— **两个真并发进程**各拿一个临时目录、都跑通、跑完不留残留；并把"固定路径"
 *      这条旧写法当变异重新做出来，断言它会红。它守的是 ② 自己的写盘点：② 曾经写死
 *      `/tmp/dsh-combo-extract`，两个门禁同时跑会互相截断（实测并发读 6/68536 次读到空文件）。
 *   ③ `dsh-deepworker/verify/verify_*.mjs` **全部**。
 *   ④ `tools/ha-core/verify/verify_core.mjs` + `verify_portability.mjs`（2026-10-14 新增）
 *      —— 共享层的 bundle 行形状断言。它们原来**不在这里**，而 2026-10-14 的启动失败
 *      恰好出在 `dsh-ha-core`：旧入口跑遍 26 步，没有一步执行过 core 的工厂、
 *      也没有一步看过它**返回了什么**。④ 就是那一步。
 *
 * 判定规则：
 *   · 任一步 `exit ≠ 0` ⇒ 整体失败；
 *   · 另外，对**所有**步骤都额外检查"输出里有没有行首 FAIL"——
 *     对 ② 这是**必须**的补丁（它不会用退出码报告失败），对其它步骤只是冗余保险。
 *
 * 用法：`node tools/ha-core/verify/prepublish.mjs`（从哪个目录跑都行：
 * 所有路径都由 `import.meta.url` 解析，绝不用 `new URL().pathname` —— 本仓库路径含中文）。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** tools/ha-core/verify -> tools/ha-core -> tools （= 全部开发工具的根） */
const REPO = path.resolve(HERE, "..", "..");
/**
 * 工具包住在插件仓库的 `tools/ha-core/`，插件根 = 本文件的上三级。
 * `PLUGIN_DIR` 由相对位置解析（不写死绝对路径）；`DSH_XH_DEEPWORKER_DIR` 仍可覆盖。
 * ⚠️ `REPO` 仍是**工具根**（`<plugin>/tools`），不是插件根：`ha-core` / `combo-sim` / … 都是它的子目录。
 */
const PLUGIN_DIR = process.env.DSH_XH_DEEPWORKER_DIR || path.resolve(HERE, "..", "..", "..");
const HA_VERIFY = path.join(PLUGIN_DIR, "verify");
const HA_CLIENT = path.join(PLUGIN_DIR, "lib", "client.js");
const CORE_CLIENT = path.join(REPO, "ha-core", "lib", "client.js");
const SCOPE_REFS = path.join(REPO, "combo-sim", "verify", "verify_scope_refs.mjs");
/**
 * 2026-10-17（第 2 段）：并发临时目录的守卫。
 * 它为什么必须在门禁里：`verify_scope_refs.mjs` 曾经把夹具与报告写进**一个固定的**
 * `/tmp/dsh-combo-extract`，两个门禁同时跑就会互相截断（`writeFileSync` 先截断再写；
 * 实测并发读 68,536 次里有 6 次读到空文件）。那条缺陷不可能被"再跑一次单进程"发现，
 * 所以它必须由**两个真并发进程**来断言 —— 就是这一步。
 */
const TEMP_ISOLATION = path.join(REPO, "combo-sim", "verify", "verify_temp_isolation.mjs");
const BUNDLE_HEALTH = path.join(HA_VERIFY, "verify_bundle_health.mjs");

/** Per-step wall-clock ceiling. The heaviest suite here is a few seconds; this is a hang guard. */
const STEP_TIMEOUT_MS = 300000;

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const buildOf = (text) => (text.match(/var BUILD = "([^"]+)"/) ?? [null, "(no BUILD marker)"])[1];

// ── the plan: ① ② ③ ────────────────────────────────────────────────────────────────────────

if (!fs.existsSync(HA_VERIFY)) {
  console.error(`FAIL: ${HA_VERIFY} does not exist — this entry point cannot enumerate the suites`);
  process.exit(1);
}

const steps = [];
if (fs.existsSync(BUNDLE_HEALTH)) {
  steps.push({ group: "① 线上 bundle 体检", label: "verify_bundle_health.mjs", file: BUNDLE_HEALTH });
} else {
  console.error(`FAIL: ① is missing: ${BUNDLE_HEALTH}`);
  process.exit(1);
}
if (fs.existsSync(SCOPE_REFS)) {
  steps.push({ group: "② 跨插件越界引用", label: "verify_scope_refs.mjs", file: SCOPE_REFS });
} else {
  console.error(`FAIL: ② is missing: ${SCOPE_REFS}`);
  process.exit(1);
}
if (fs.existsSync(TEMP_ISOLATION)) {
  steps.push({ group: "②' 并发临时目录隔离", label: "verify_temp_isolation.mjs", file: TEMP_ISOLATION });
} else {
  console.error(`FAIL: ②' is missing: ${TEMP_ISOLATION}`);
  process.exit(1);
}

// ④ The shared layer's OWN two suites. They were not reachable from here, and the 2026-10-14
//    failed boot came from dsh-ha-core: nothing in this file ever executed the core bundle's
//    factory and looked at what it RETURNED. verify_core.mjs now does exactly that, for every
//    local bundle row; verify_portability.mjs runs the same assertion plus its mutation
//    self-test. Both are read-only with respect to the repo.
const CORE_VERIFY = [
  { group: "④ 共享层（dsh-ha-core）套件", label: "verify_core.mjs", file: path.join(REPO, "ha-core", "verify", "verify_core.mjs") },
  { group: "④ 共享层（dsh-ha-core）套件", label: "verify_portability.mjs", file: path.join(REPO, "ha-core", "verify", "verify_portability.mjs") },
];
for (const step of CORE_VERIFY) {
  if (!fs.existsSync(step.file)) {
    console.error(`FAIL: ④ is missing: ${step.file}`);
    process.exit(1);
  }
  steps.push(step);
}

const suiteNames = fs.readdirSync(HA_VERIFY)
  .filter((name) => name.startsWith("verify_") && name.endsWith(".mjs"))
  .sort();
let skippedDuplicate = null;
for (const name of suiteNames) {
  if (path.join(HA_VERIFY, name) === BUNDLE_HEALTH) { skippedDuplicate = name; continue; }
  steps.push({ group: "③ 主插件套件", label: name, file: path.join(HA_VERIFY, name) });
}

// ── header: which bytes are we validating? ────────────────────────────────────────────────

console.log("prepublish gate — 发布前必跑（只调用，不修改 dsh-deepworker/** 与 tools/combo-sim/**）");
console.log(`  repo: ${REPO}`);
console.log(`  plugin: ${PLUGIN_DIR}  (独立仓库，已迁出本仓库)`);
try {
  const body = fs.readFileSync(HA_CLIENT, "utf8");
  console.log(`  online bundle: dsh-deepworker/lib/client.js  ${fs.statSync(HA_CLIENT).size} bytes  BUILD=${buildOf(body)}  sha256=${sha256(HA_CLIENT)}`);
} catch (error) {
  console.log(`  online bundle: UNREADABLE (${String((error && error.message) || error)})`);
}
try {
  console.log(`  shared core:   dsh-ha-core/lib/client.js           ${fs.statSync(CORE_CLIENT).size} bytes  sha256=${sha256(CORE_CLIENT)}`);
} catch (error) {
  console.log(`  shared core:   UNREADABLE (${String((error && error.message) || error)})`);
}
console.log(`  plan: ① ${path.relative(PLUGIN_DIR, BUNDLE_HEALTH)}`);
console.log(`        ② ${path.relative(REPO, SCOPE_REFS)}   (⚠️ 这一步永远 exit 0 —— 失败只看行首 FAIL)`);
console.log(`        ③ ${suiteNames.length} × dsh-deepworker/verify/verify_*.mjs` +
  (skippedDuplicate === null ? "" : `（其中 ${skippedDuplicate} 已在 ① 跑过，此处跳过 ⇒ 本步实跑 ${steps.filter((s) => s.group === "③ 主插件套件").length} 个）`));
console.log(`        ④ ${CORE_VERIFY.length} × tools/ha-core/verify/verify_*.mjs` +
  "（共享层的 bundle 行形状断言：工厂真的被执行，返回值必须有 apply + inject —— 2026-10-14 真机启动失败的根因）");
console.log(`  total steps: ${steps.length}\n`);

// ── run them, sequentially ─────────────────────────────────────────────────────────────────

// ── the judgement rule, and a self-test for it ─────────────────────────────────────────────
//
// A gate that cannot be shown to fail is decoration. The rule below has two halves and both are
// load-bearing, so both get a mutation that must go the right way:
//   · exit code must be 0;
//   · no line may start with FAIL. This half exists ONLY because verify_scope_refs.mjs ends in a
//     bare `process.exit(0)` — the step that catches the "runtime ReferenceError -> import failed"
//     class would otherwise be read as a success no matter what it printed.
const judge = (proc) => {
  const failLines = ((proc.stdout ?? "") + (proc.stderr ?? "")).match(/^\s*FAIL\b.*$/gm) ?? [];
  return { passed: proc.status === 0 && failLines.length === 0, failLines: failLines.map((line) => line.trim()) };
};

console.log("self-test: the pass/fail judgement rule (each case must land where it is supposed to)");
{
  const cases = [
    ["exit 0, clean output", 'console.log("PASS  a");', true],
    ["exit 0 but a FAIL line on stdout (exactly verify_scope_refs.mjs's shape)", 'console.log("PASS  a"); console.log("FAIL  b — boom");', false],
    ["exit 0 but a FAIL line on stderr", 'console.log("PASS  a"); console.error("FAIL  b — boom");', false],
    ["exit 3, clean output", 'console.log("PASS  a"); process.exit(3);', false],
  ];
  let broken = 0;
  for (const [label, code, wantPassed] of cases) {
    const proc = spawnSync(process.execPath, ["-e", code], { encoding: "utf8", timeout: 30000 });
    const verdict = judge(proc);
    if (verdict.passed !== wantPassed) {
      broken += 1;
      console.log(`  FAIL  self-test: ${label} -> judged passed=${verdict.passed}, want ${wantPassed}`);
    } else {
      console.log(`  ok    self-test: ${label} -> ${verdict.passed ? "PASS" : "FAIL"} (as required)`);
    }
  }
  if (broken > 0) {
    console.log("\nPREPUBLISH GATE: RED — the judgement rule itself is broken; nothing below would mean anything");
    process.exit(1);
  }
}
console.log("");

const results = [];
for (const [index, step] of steps.entries()) {
  const startedMs = Date.now();
  const proc = spawnSync(process.execPath, [step.file], {
    cwd: REPO,
    encoding: "utf8",
    timeout: STEP_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Date.now() - startedMs;
  const stdout = proc.stdout ?? "";
  const stderr = proc.stderr ?? "";
  const exitCode = proc.status === null ? `signal/${String(proc.signal)}` : proc.status;
  const { passed, failLines } = judge(proc);
  results.push({ step, passed, exitCode, ms, failLines, stdout, stderr });

  const mark = passed ? "PASS" : "FAIL";
  console.log(`[${String(index + 1).padStart(2)}/${steps.length}] ${mark}  ${step.label}  (exit=${exitCode}, ${ms} ms)`);
  if (!passed) {
    // Print why, but bounded: a red suite can be noisy and the summary must stay readable.
    for (const line of failLines.slice(0, 12)) console.log(`         ${line}`);
    if (failLines.length > 12) console.log(`         … ${failLines.length - 12} more FAIL line(s)`);
    const tail = (stderr.trim() === "" ? stdout : stderr).trim().split("\n").slice(-12);
    for (const line of tail) console.log(`         | ${line}`);
  }
}

// ── summary ────────────────────────────────────────────────────────────────────────────────

const failed = results.filter((r) => !r.passed);
console.log("\n================ prepublish summary ================");
console.log(`  steps run : ${results.length}`);
console.log(`  passed    : ${results.length - failed.length}`);
console.log(`  failed    : ${failed.length}`);
const totalMs = results.reduce((sum, r) => sum + r.ms, 0);
console.log(`  wall clock: ${(totalMs / 1000).toFixed(1)} s (sum of step times)`);
if (failed.length > 0) {
  console.log("  red steps :");
  for (const r of failed) console.log(`    - ${r.step.group} ${r.step.label} (exit=${r.exitCode}${r.failLines.length ? `, ${r.failLines.length} FAIL line(s)` : ""})`);
  console.log("\nPREPUBLISH GATE: RED — 不要发布");
  process.exit(1);
}
console.log("\nPREPUBLISH GATE: GREEN — 全部通过");
console.log("⚠️ 提醒（AGENTS.md）：套件的 ctx 是残缺桩 ⇒ \"全绿\"只证明「工厂能加载 + 组件能渲染」，");
console.log("   不证明「在 App 里激活完整」。后者只能真机验（重新加载界面 → 先看构建标记变了 → 再验行为）。");
process.exit(0);
