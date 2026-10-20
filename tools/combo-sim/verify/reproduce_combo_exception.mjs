/**
 * dsh-combo-sim / verify/reproduce_combo_exception.mjs
 *
 * Reconstructs a REAL combo (the byte-for-byte concatenation the Host serves for a
 * recovered combo URL), executes it once as a classic script in a vm context, and
 * reports exactly which member bundle threw and at which line of its own source.
 *
 * Why this matters: the App's crash log 2026-10-13T06:03:58Z records
 *     Uncaught (in promise) ReferenceError: events is not defined
 * with the stack anchored at the combo URL. That is a *concatenation-level*
 * failure — the concatenated script is syntactically valid, so `node --check` and
 * every per-file suite pass, yet the script throws while executing inside one
 * member bundle.
 *
 * Usage:
 *   node verify/reproduce_combo_exception.mjs                 # every recovered combo
 *   node verify/reproduce_combo_exception.mjs <rev>           # one recovered combo
 *   node verify/reproduce_combo_exception.mjs --bundle <path> # a standalone bundle
 *   node verify/reproduce_combo_exception.mjs --concat <p1> <p2> ...  # ad-hoc combo
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { prepareSource, sha256 } from "../lib/simulate.mjs";
import { loadRealCombos, OFFICIAL_ROOT, runFile } from "../lib/route.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/**
 * 2026-10-17（第 1 段搬迁）：本工具包搬进插件仓库的 `tools/combo-sim/` ⇒ 插件根 = 上三级。
 * 原来这里用 `WS`（= 工作区根）去找本地包 `WS/<id>/lib/client.js`；搬进来之后本地活着的
 * 包只剩主插件一个，且它在 `tools/` **之上**，所以直接由相对位置解析，不再拼 `WS/<id>/`。
 */
const PLUGIN_DIR = process.env.DSH_XH_DEEPWORKER_DIR || path.resolve(HERE, "..", "..", "..");

const PLATFORM_MODULE_KEYS = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-client-store",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-dockkit",
];

function makeStub(spec, cache) {
  if (cache.has(spec)) return cache.get(spec);
  const stub = new Proxy(function inert() {}, {
    get: (_t, p) => (p === "then" ? undefined : makeStub(`${spec}.${String(p)}`, cache)),
    apply: () => makeStub(`${spec}()`, cache),
    construct: () => makeStub(`new ${spec}()`, cache),
    has: () => true,
  });
  cache.set(spec, stub);
  return stub;
}

/** Materialized factories, so `require(...)` inside a factory returns something. */
function buildSeed() {
  const cache = new Map();
  return Object.fromEntries(PLATFORM_MODULE_KEYS.map((k) => [k, makeStub(k, cache)]));
}

/**
 * Resolve one combo id to its bundle text.
 * Recovered combos use both scoped (`@deepseek-ai/<pkg>`) and unscoped
 * (`dsh-history-actions`) ids; both name a package directory we already extracted.
 */
function locateBundle(id) {
  const candidates = [
    path.join(OFFICIAL_ROOT, id, "lib/client.js"),
    path.join(OFFICIAL_ROOT, id.replace(/^@deepseek-ai\//, ""), "lib/client.js"),
    // 本地包：只剩主插件（dsh-deepworker）还活着；它在 tools/ 之上。
    path.join(PLUGIN_DIR, "lib", "client.js"),
    path.join(PLUGIN_DIR, "lib", "index.js"),
  ];
  const replacements = new Map();
  // Ad-hoc overrides: /tmp/client.js.<name>.bak can stand in for dsh-history-actions.
  for (const name of ["before-task15", "broken-task14", "broken-task12", "before-task14", "before-task13"]) {
    const p = `/tmp/client.js.${name}.bak`;
    if (fs.existsSync(p)) replacements.set(name, p);
  }
  for (const p of candidates) if (fs.existsSync(p)) return { id, file: p, text: fs.readFileSync(p, "utf8") };
  return null;
}

/**
 * Concatenate like the Host does, recording each member's generated-line span so
 * a stack frame in combo coordinates can be mapped back to (bundle, line).
 */
function buildCombo(bundles) {
  let source = "";
  let line = 1;
  const spans = [];
  for (const b of bundles) {
    const prepared = prepareSource(b.text).source;
    const lines = prepared.split("\n").length;
    spans.push({ id: b.id, file: b.file, generatedStart: line, generatedEnd: line + lines - 1, lines });
    source += `${prepared};\n`;
    line += lines + 1;
  }
  return { source, spans, totalLines: line - 1 };
}

/** Parse a V8 stack frame line for a generated line number. */
function generatedLineOf(stack) {
  const m = /:(\d+):(\d+)\)?/.exec(stack ?? "");
  return m ? Number(m[1]) : null;
}

function mapToBundle(spans, generatedLine) {
  if (generatedLine === null) return null;
  const span = spans.find((s) => generatedLine >= s.generatedStart && generatedLine <= s.generatedEnd);
  if (!span) return null;
  return { ...span, bundleLine: generatedLine - span.generatedStart + 1 };
}

function runCombo({ source, spans, label, rev }) {
  const context = vm.createContext(
    (() => {
      const sandbox = {
        console: { log() {}, warn() {}, error() {}, info() {} },
        document: { createElement: () => ({ style: {}, append() {}, remove() {}, addEventListener() {}, setAttribute() {} }), head: { append() {} }, body: { append() {} }, querySelector: () => null, querySelectorAll: () => [] },
        setTimeout,
        clearTimeout,
        Promise,
        require: undefined,
      };
      sandbox.window = sandbox;
      sandbox.globalThis = sandbox;
      const registrations = [];
      const sink = {
        mode: "live",
        load: (r) => {
          registrations.push(r);
          return undefined;
        },
      };
      sandbox.__ModuleLoader__ = sink;
      sandbox._ModuleLoader__ = sink;
      sandbox.__comboRegistrations = registrations;
      return sandbox;
    })(),
    { name: label },
  );

  const result = { label, rev, bundles: spans.map((s) => ({ id: s.id, file: s.file, generatedStart: s.generatedStart, lines: s.lines })), ok: false, thrown: null };
  let script;
  try {
    script = new vm.Script(source, { filename: label });
  } catch (error) {
    result.thrown = { phase: "parse", name: error.name, message: error.message, mapped: mapToBundle(spans, generatedLineOf(error.stack)) };
    return result;
  }
  try {
    script.runInContext(context);
    result.ok = true;
  } catch (error) {
    result.thrown = { phase: "execution", name: error.name, message: error.message, mapped: mapToBundle(spans, generatedLineOf(error.stack)), stack: error.stack };
  }
  result.registerCount = context.__comboRegistrations.length;
  result.registeredIds = context.__comboRegistrations.map((r) => r.id);
  return result;
}

// ── main ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const combos = loadRealCombos();
const reports = [];

if (argv[0] === "--bundle") {
  const file = argv[1];
  const text = fs.readFileSync(file, "utf8");
  const combo = buildCombo([{ id: path.basename(path.dirname(file)), file, text }]);
  reports.push(runCombo({ ...combo, label: file, rev: "n/a" }));
} else if (argv[0] === "--concat") {
  const bundles = argv.slice(1).map((f) => ({ id: path.basename(path.dirname(f)), file: f, text: fs.readFileSync(f, "utf8") }));
  const combo = buildCombo(bundles);
  reports.push(runCombo({ ...combo, label: "ad-hoc concat", rev: "n/a" }));
} else {
  const wanted = argv[0] && !argv[0].startsWith("--") ? argv[0] : null;
  for (const c of combos) {
    if (wanted && c.rev !== wanted) continue;
    const bundles = [];
    const missing = [];
    for (const id of c.ids) {
      const found = locateBundle(id);
      if (found) bundles.push(found);
      else missing.push(id);
    }
    const combo = buildCombo(bundles);
    const report = runCombo({ ...combo, label: `${c.crashLogName}#rev=${c.rev}`, rev: c.rev });
    report.source = c.crashLogName;
    report.missingBundles = missing;
    reports.push(report);
  }
}

for (const r of reports) {
  console.log(`\n### ${r.label}  (${r.bundles.length} bundles, rev ${r.rev})`);
  if (r.missingBundles?.length) console.log(`    MISSING bundles (skipped, not faked): ${r.missingBundles.join(", ")}`);
  if (r.ok) {
    console.log(`    executed OK; registered ${r.registerCount} factories`);
    continue;
  }
  const t = r.thrown;
  console.log(`    ${t.phase.toUpperCase()} FAILURE: ${t.name}: ${t.message}`);
  if (t.mapped) {
    console.log(`    ⇒ threw inside bundle "${t.mapped.id}"`);
    console.log(`      file: ${t.mapped.file}`);
    console.log(`      bundle line ${t.mapped.bundleLine} (generated line ${t.mapped.generatedStart + t.mapped.bundleLine - 1})`);
    const src = fs.readFileSync(t.mapped.file, "utf8").split("\n");
    for (let i = Math.max(1, t.mapped.bundleLine - 3); i <= Math.min(src.length, t.mapped.bundleLine + 3); i += 1) {
      console.log(`      ${i === t.mapped.bundleLine ? ">>" : "  "} ${String(i).padStart(5)} | ${src[i - 1]?.slice(0, 170)}`);
    }
  } else {
    console.log("    ⇒ could not attribute the frame to a member bundle");
    if (t.stack) console.log(t.stack.split("\n").slice(0, 6).map((l) => `      ${l}`).join("\n"));
  }
}

const outPath = runFile("reproduce-combo-exception.json");
fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2));

// ── checks ──────────────────────────────────────────────────────────────────
// The interesting result here is a NEGATIVE one: every recovered combo executes
// cleanly today, so the historical throw is not reproducible from current bytes.
console.log("");
const checks = [];
checks.push(["at least one recovered combo was replayed", reports.length > 0, `${reports.length}`]);
checks.push([
  "every recovered combo parses as one classic script",
  reports.every((r) => r.thrown === null || r.thrown.phase !== "parse"),
  reports.filter((r) => r.thrown?.phase === "parse").map((r) => r.label).join(", ") || "no parse failures",
]);
checks.push([
  "every member bundle of every replayed combo registers its factory",
  reports.every((r) => r.ok === true && r.registerCount === r.bundles.length && (r.missingBundles ?? []).length === 0),
  reports.map((r) => `${r.label.split("#")[1] ?? r.label}: ${r.registerCount}/${r.bundles.length}`).join("; "),
]);
checks.push([
  "no replayed combo reproduces a runtime throw today",
  reports.every((r) => r.thrown === null),
  reports.filter((r) => r.thrown).map((r) => `${r.label}: ${r.thrown.name}: ${r.thrown.message}`).join(" | ") || "none threw",
]);
if (argv[0] === "--bundle" || argv[0] === "--concat") {
  checks.push(["ad-hoc single/combo replay executed", reports[0]?.ok === true || reports[0]?.thrown !== null]);
}
let bad = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) bad += 1;
}
console.log(`\nreport: ${outPath}`);
