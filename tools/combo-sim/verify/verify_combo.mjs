/**
 * dsh-combo-sim / verify/verify_combo.mjs
 *
 * The controlled experiment.
 *
 * Question: can a combo-aware simulator — one that concatenates bundles exactly
 * like the host, executes the result as ONE classic script in ONE vm context, and
 * then walks rows in manifest order with the shipped retry/fallback rules —
 * reproduce the App's `N entry did not activate` crashes for the samples on this
 * machine?
 *
 * Ground truth for the combo partition: the combo URLs recorded in the App's own
 * crash logs (lib/route.mjs loadRealCombos). Reconstructing the Loader scan order
 * from disk is not possible; reading the real URLs out of the logs is.
 *
 * Hard rules enforced here:
 *   - every path WRITTEN is under this run's own temp dir (lib/route.mjs `runFile`/`assertRunPath`)
 *   - repository and ~/.dsh are read-only inputs
 *
 * Usage:  node verify/verify_combo.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { ComboSimulator, sha256 } from "../lib/simulate.mjs";
import {
  buildComboModel,
  buildTransport,
  loadOfficialBundles,
  loadRealCombos,
  applyRealCombos,
  projectedComboUrlBytes,
  RUN_ROOT,
  runFile,
} from "../lib/route.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WS = path.resolve(HERE, "..", "..");

/**
 * 2026-10-17（第 1 段搬迁）：本工具包搬进插件仓库的 `tools/combo-sim/` ⇒ 插件根 = 本文件上三级。
 * `WS` 仍然是**工具根**（`<plugin>/tools`），两者不再有父子关系。
 * 可用 `DSH_XH_DEEPWORKER_DIR` 覆盖（换机器 / 夹具时不必改代码）。
 */
const PLUGIN_DIR = process.env.DSH_XH_DEEPWORKER_DIR || path.resolve(HERE, "..", "..", "..");

const LIVE_BUNDLE = path.join(PLUGIN_DIR, "lib", "client.js");
const SAMPLES = [
  { key: "good-before-task15", label: "能启动 · before-task15", file: "/tmp/client.js.before-task15.bak", expect: "started" },
  { key: "broken-task14", label: "曾失败 · broken-task14", file: "/tmp/client.js.broken-task14.bak", expect: "crashed" },
  { key: "broken-task12", label: "曾失败 · broken-task12", file: "/tmp/client.js.broken-task12.bak", expect: "crashed" },
];

/** PLATFORM_MODULES, read verbatim off the shipped shell (index-5SrrfWpU.js, rM()). */
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
function makeSeedStub(spec, cache) {
  if (cache.has(spec)) return cache.get(spec);
  const stub = new Proxy(function inert() {}, {
    get: (_t, p) => (p === "then" ? undefined : makeSeedStub(`${spec}.${String(p)}`, cache)),
    apply: () => makeSeedStub(`${spec}()`, cache),
    construct: () => makeSeedStub(`new ${spec}()`, cache),
    has: () => true,
  });
  cache.set(spec, stub);
  return stub;
}
const seedCache = new Map();
const PLATFORM_SEED = Object.fromEntries(PLATFORM_MODULE_KEYS.map((k) => [k, makeSeedStub(k, seedCache)]));

const results = { checks: [], notes: [], scenarioRuns: [], sampleRuns: [] };
let failures = 0;
const check = (name, ok, detail = "") => {
  results.checks.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const note = (line) => {
  results.notes.push(line);
  console.log(`      ${line}`);
};
const readText = (file) => {
  const text = fs.readFileSync(file, "utf8");
  return { file, text, sha256: sha256(text), bytes: Buffer.byteLength(text), build: (text.match(/BUILD = "([^"]+)"/) ?? [])[1] ?? "?" };
};
const short = (s, n = 130) => (s && s.length > n ? `${s.slice(0, n)}…` : s);

/** Boot one fresh page over `batches` with `replacements` swapped into the rows. */
async function runScenario({ batches, byId, replacements = new Map(), names, label }) {
  const { transport } = buildTransport({ batches, byId }, { replace: replacements });
  const single = new Map();
  for (const key of transport.keys()) {
    const m = /^plugins\/\?\?([^/]+)\/client\.js&rev=/.exec(key);
    if (m) single.set(m[1], key);
  }
  const modules = batches.flatMap((b) => b.ids.map((id) => ({ id, initialUrl: b.url, url: single.get(id) })));
  const sim = new ComboSimulator({ libraries: PLATFORM_SEED, allowUnknownLibraries: true });
  sim.attachTransport(transport, label);
  const rows = await sim.boot({ modules });
  const audit = sim.bootAudit(names);
  return { sim, rows, audit, transport, single };
}

// ── 0. guard rails ──────────────────────────────────────────────────────────
console.log("== 0. guard rails ==");
// The scratch directory is per-run (lib/route.mjs RUN_ROOT: mkdtemp + pid + random suffix, removed
// on exit) — asserted, not assumed: a fixed shared path let concurrent runs truncate each other.
const isUnderOsTemp = path.resolve(RUN_ROOT) === path.join(path.resolve(os.tmpdir()), path.basename(RUN_ROOT));
check("RUN_ROOT lives directly under the OS temp dir", isUnderOsTemp, RUN_ROOT);
check("RUN_ROOT carries this process's pid (a per-run name, not a fixed one)", path.basename(RUN_ROOT).includes(`-${process.pid}-`), path.basename(RUN_ROOT));
check("workspace bundle present (read-only input)", fs.existsSync(LIVE_BUNDLE), LIVE_BUNDLE);
for (const s of SAMPLES) check(`sample present: ${s.key}`, fs.existsSync(s.file), s.file);

// ── 1. the real partition, read out of the crash logs ───────────────────────
console.log("\n== 1. real combo partition (recovered from the App's crash logs) ==");
const baseModel = buildComboModel();
const official = loadOfficialBundles();
for (const [pkg, bundle] of official) {
  const id = `@deepseek-ai/${pkg}`;
  if (!baseModel.byId.has(id)) baseModel.byId.set(id, { id, pkg, ...bundle, kind: "official-extra" });
}
const combos = loadRealCombos();
check("at least one combo URL was recovered from the crash logs", combos.length > 0, `${combos.length} combos`);
for (const c of combos) {
  note(`${c.crashLogName}  rev=${c.rev}  rows=${c.rows}  urlBytes=${c.urlBytes} / 3072`);
  note(`    first=${c.ids[0]}`);
  note(`    last =${c.ids[c.ids.length - 1]}`);
}
const model = applyRealCombos(baseModel, combos);
check(
  "every id in a recovered combo has an extracted bundle",
  model.realCombosMissingExtraction.length === 0,
  model.realCombosMissingExtraction.join(", ") || "none missing",
);
// ⚠️ These combos are RECORDINGS, not the live graph: loadRealCombos() parses the combo URLs out
// of the App's own crash logs (~/Library/Logs/DeepSeek Harness/crash-*-web-boot.log). A recording
// keeps whatever package name was current when the crash happened, so the 2026-10-15 rename to
// `dsh-deepworker` does NOT rewrite them — the recorded URLs still say `dsh-history-actions`.
// Both spellings are therefore accepted, and the id actually present in the recording is used as
// the key for every replacement below. Do not collapse this to one name: a replacement keyed on
// an id the recording does not contain is silently not applied, which kills the positive control
// (it stays green) instead of failing loudly.
const RECORDED_IDS = ["dsh-deepworker", "dsh-history-actions"];
const HA_ID = RECORDED_IDS.find((id) => combos.some((c) => c.ids.includes(id))) ?? RECORDED_IDS[1];
const ourCombo = combos.find((c) => c.ids.includes(HA_ID));
check("a recovered combo contains our plugin (" + RECORDED_IDS.join(" | ") + ")", ourCombo !== undefined);
if (ourCombo) {
  const idx = ourCombo.ids.indexOf(HA_ID);
  note(`position of ${HA_ID} inside its real combo: index ${idx} of ${ourCombo.rows} (0-based)`);
  note(`rows before it: ${idx}; rows after it: ${ourCombo.rows - idx - 1}`);
  check("the recovered combo URL fits the shipped 3 KiB budget", ourCombo.urlBytes <= 3 * 1024, `${ourCombo.urlBytes} bytes`);
}
const reconstructed = baseModel.batches;
const cut = projectedComboUrlBytes(reconstructed[0].ids);
const cutPlusOne = projectedComboUrlBytes([...reconstructed[0].ids, reconstructed[1].ids[0]]);
check(
  "the reconstructed order reproduces the shipped 3 KiB cut-off",
  cut <= 3 * 1024 && cutPlusOne > 3 * 1024,
  `batch#0 projection ${cut} ≤ 3072, +1 row ${cutPlusOne} > 3072`,
);
note(`the recovered combo list and the reconstructed order are different lists (recovered first id=${combos[0]?.ids[0]}, reconstructed first id=${reconstructed[0].ids[0]})`);
note("⇒ every scenario below uses the recovered lists; the reconstruction is used only for the 3 KiB cut-off check");

// ── 2. single-file semantics (what the existing local checks do) ────────────
console.log("\n== 2. single-file semantics (node --check / vm.Script equivalent) ==");
const sampleRecs = new Map();
for (const s of SAMPLES) {
  const rec = readText(s.file);
  sampleRecs.set(s.key, rec);
  let ok = true;
  let message = "";
  try {
    new vm.Script(rec.text, { filename: s.file });
  } catch (error) {
    ok = false;
    message = `${error.name}: ${error.message}`;
  }
  check(`single-file parse OK: ${s.key}`, ok, message);
  note(`${s.key.padEnd(20)} ${String(rec.bytes).padStart(7)} B  sha=${rec.sha256.slice(0, 16)}  BUILD=${rec.build}`);
}
const live = readText(LIVE_BUNDLE);
note(`${"LIVE".padEnd(20)} ${String(live.bytes).padStart(7)} B  sha=${live.sha256.slice(0, 16)}  BUILD=${live.build}`);
note(`live bundle === good-before-task15 ? ${live.sha256 === sampleRecs.get("good-before-task15").sha256}`);
note(`live bundle === broken-task14    ? ${live.sha256 === sampleRecs.get("broken-task14").sha256}`);

// ── 3. positive control on the real combo ──────────────────────────────────
console.log("\n== 3. positive control on the real combo (harness sensitivity) ==");
{
  const brokenText = 'window.__ModuleLoader__.load({ id: "' + HA_ID + '", factory: (require) => ({ apply() {} }) });\nconst oops = ;\n';
  const { rows, audit } = await runScenario({
    batches: model.batches,
    byId: model.byId,
    replacements: new Map([[HA_ID, { id: HA_ID, text: brokenText }]]),
    names: [HA_ID, "dsh-rewind"],
    label: "positive-control",
  });
  const ha = rows.find((r) => r.id === HA_ID);
  const rw = rows.find((r) => r.id === "dsh-rewind");
  const failedAll = rows.filter((r) => r.outcome !== "registered").map((r) => r.id);
  check("positive control: a syntax error in one bundle is detected", audit.thrown !== null && /did not activate/.test(audit.thrown.message));
  check("positive control: the broken row fails", ha?.outcome !== "registered");
  check("positive control: the audit names exactly one entry (the broken one)", audit.failed.length === 1 && audit.failed[0].startsWith(HA_ID + ":"));
  check("positive control: rows after the break survive on their own one-row URLs", rw?.outcome === "registered");
  note(`broken row failure text: ${short(ha?.error?.message, 200)}`);
  note(`contains "skipped after an earlier failure of this bundle": ${/skipped after an earlier failure of this bundle/.test(ha?.error?.message ?? "")}`);
  note(`whole-graph rows that failed: ${failedAll.length} of ${rows.length}`);
  results.scenarioRuns.push({ name: "positive-control", failedCount: failedAll.length, auditFailed: audit.failed, historyActions: ha?.error?.message ?? null, rewind: rw?.error?.message ?? null });
}

// ── 4. controlled experiment: each sample's bytes inside the real combo ────
console.log("\n== 4. controlled experiment: sample bytes inside the real combo ==");
for (const s of SAMPLES) {
  const rec = sampleRecs.get(s.key);
  const { sim, rows, audit } = await runScenario({
    batches: model.batches,
    byId: model.byId,
    replacements: new Map([[HA_ID, { id: HA_ID, text: rec.text }]]),
    names: [HA_ID, "dsh-rewind"],
    label: s.key,
  });
  const registration = {};
  const messages = {};
  for (const n of [HA_ID, "dsh-rewind"]) {
    const r = rows.find((x) => x.id === n);
    registration[n] = r ? `${r.outcome}${r.via ? ` (${r.via})` : ""}` : "(absent)";
    messages[n] = r?.error?.message ?? null;
  }
  const factories = [HA_ID, "dsh-rewind"].map((n) => {
    const f = sim.inspectFactory(n, { callFactory: true });
    return { id: n, registered: f.registered, factoryType: f.factoryType, applyType: f.applyType, reason: f.reason };
  });
  const failedRows = rows.filter((r) => r.outcome !== "registered").map((r) => r.id);
  const run = {
    key: s.key,
    label: s.label,
    expect: s.expect,
    build: rec.build,
    sha256: rec.sha256.slice(0, 16),
    registration,
    messages,
    factories,
    scriptErrorKinds: [...new Set(sim.scriptErrors.map((e) => e.kind))],
    failedRowCount: failedRows.length,
    failedRowsSample: failedRows.slice(0, 5),
    auditFailed: audit.failed,
    wouldCrashBoot: audit.thrown !== null,
  };
  results.sampleRuns.push(run);
  note(`--- ${s.key} (${s.label}; expected ${s.expect}) ---`);
  note(`  registration        : ${JSON.stringify(registration)}`);
  note(`  script-error kinds  : ${JSON.stringify(run.scriptErrorKinds)}`);
  note(`  factories           : ${JSON.stringify(factories)}`);
  note(`  failing rows        : ${run.failedRowCount} (${run.failedRowsSample.join(", ") || "-"})`);
  note(`  boot audit          : ${run.auditFailed.join(" | ") || "(none)"}`);
  note(`  ⇒ simulated boot    : ${run.wouldCrashBoot ? "CRASHES (N entry did not activate)" : "starts"}`);
}

// ── 5. discrimination verdict ──────────────────────────────────────────────
console.log("\n== 5. discrimination verdict ==");
let matched = 0;
for (const r of results.sampleRuns) {
  const predicted = r.wouldCrashBoot ? "crashed" : "started";
  const ok = predicted === r.expect;
  if (ok) matched += 1;
  note(`${r.key.padEnd(20)} predicted="${predicted}" expected="${r.expect}" → ${ok ? "MATCH" : "MISMATCH"}`);
}
const discriminates = matched === results.sampleRuns.length;
check("simulator discriminates the good sample from the two crashed samples", discriminates, `${matched}/${results.sampleRuns.length}`);
const identical =
  results.sampleRuns.length === SAMPLES.length &&
  results.sampleRuns.every(
    (r) =>
      JSON.stringify(r.registration) === JSON.stringify(results.sampleRuns[0].registration) &&
      JSON.stringify(r.factories) === JSON.stringify(results.sampleRuns[0].factories) &&
      r.wouldCrashBoot === results.sampleRuns[0].wouldCrashBoot,
  );
if (identical) {
  note("All three samples are indistinguishable under combo semantics: same registrations, same factory/apply types, no crash.");
  note("⇒ the simulator CANNOT discriminate, so the logged crashes are not reproducible from these bundle bytes.");
}
results.verdict = { discriminates, matched, total: SAMPLES.length, allIdentical: identical };

// ── 6. evidence ────────────────────────────────────────────────────────────
console.log("\n== 6. write evidence ==");
const outPath = runFile("verify-combo-report.json");
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      liveSha256: live.sha256,
      liveBuild: live.build,
      realCombos: combos.map((c) => ({ crashLog: c.crashLogName, rev: c.rev, rows: c.rows, urlBytes: c.urlBytes, first: c.ids[0], last: c.ids[c.ids.length - 1], ids: c.ids })),
      results,
    },
    null,
    2,
  ),
);
check("evidence written into this run's temp dir", fs.existsSync(outPath), outPath);

console.log(`\n== summary: ${results.checks.filter((c) => c.ok).length}/${results.checks.length} checks passed ==`);
console.log(failures === 0 ? "suite ran clean" : `${failures} check(s) failed`);
process.exit(0);
