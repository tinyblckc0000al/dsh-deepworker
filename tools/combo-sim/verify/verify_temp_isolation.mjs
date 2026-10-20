/**
 * dsh-combo-sim / verify/verify_temp_isolation.mjs
 *
 * WHY THIS EXISTS (2026-10-17): `lib/route.mjs` used to hard-code ONE temp root
 * (`/tmp/dsh-combo-extract`) and `assertTempPath()` asserted that fixed prefix. Every suite
 * therefore wrote its fixtures and reports to the same paths, so two gates running at the same
 * time stepped on each other: `fs.writeFileSync` truncates first, and a concurrent reader really
 * does observe an EMPTY file (measured: 6 of 68,536 reads while three runs overlapped). Nothing
 * in this repo happened to read those files back, which is exactly why the fake red looked
 * random rather than systematic — and why a fake GREEN was possible for any future input.
 *
 * WHAT IS ASSERTED (each one is behaviour, not a grep):
 *   ① two CONCURRENT processes each get their OWN temp root, and each can write + read there
 *   ② the escape guard is armed in both of them (`assertRunPath` refuses a path outside)
 *   ③ the real `verify_scope_refs.mjs` suite runs green TWICE AT THE SAME TIME, writes its report
 *      into two different directories, and both directories are gone once the processes exit
 *   ④ no residue: neither the probe roots nor the suite roots exist afterwards
 *
 * MUTATION (proves ①②③ can actually fail): a copy of lib/route.mjs with the fixed path put back
 * is used for the same two concurrent runs — the isolation verdict MUST then be red, both for the
 * probe children and for the real suite. Anchors are checked for "hit exactly once" so a mutation
 * can never silently become a no-op.
 *
 * Everything this suite writes lives under `os.tmpdir()`; the repository and ~/.dsh are never
 * touched. Run: node verify/verify_temp_isolation.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, "..");
const PLUGIN_DIR = process.env.DSH_XH_DEEPWORKER_DIR || path.resolve(PKG, "..", "..");

let pass = 0;
let fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass += 1; console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

/** Run one child to completion, collecting stdout/stderr. Never throws. */
function run(file, { env = {}, cwd = PLUGIN_DIR, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], {
      cwd,
      env: Object.assign({}, process.env, env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (error) { /* already gone */ } }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

const lastJsonLine = (text) => {
  const lines = text.trim().split("\n").filter((line) => line.trim().startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try { return JSON.parse(lines[i]); } catch (error) { /* keep looking upwards */ }
  }
  return null;
};

const PROBE = path.join(HERE, "_temp_isolation_child.mjs");

/**
 * The isolation verdict, shared by the live run and by the mutation. Returns
 * `{ ok, roots, why }` — `ok` is the property "two concurrent runs are truly independent".
 */
async function probeIsolation(routeOverride) {
  const env = routeOverride ? { DSH_COMBO_ROUTE: routeOverride } : {};
  const [first, second] = await Promise.all([run(PROBE, { env }), run(PROBE, { env })]);
  const roots = [lastJsonLine(first.stdout), lastJsonLine(second.stdout)];
  const why = [];
  if (roots[0] === null || roots[1] === null) why.push("a probe printed no readable JSON line");
  if (first.code !== 0 || second.code !== 0) why.push(`probe exit codes ${first.code}/${second.code}`);
  if (roots[0] !== null && roots[0].insideRunRoot !== true) why.push("probe 1 did not write inside its RUN_ROOT");
  if (roots[1] !== null && roots[1].insideRunRoot !== true) why.push("probe 2 did not write inside its RUN_ROOT");
  if (roots[0] !== null && roots[0].refusedOutside !== true) why.push("probe 1 did not refuse a path outside RUN_ROOT");
  if (roots[1] !== null && roots[1].refusedOutside !== true) why.push("probe 2 did not refuse a path outside RUN_ROOT");
  const dirs = roots.map((r) => (r === null ? null : r.runRoot));
  if (dirs[0] === null || dirs[1] === null || dirs[0] === dirs[1]) why.push(`the two runs shared a directory: ${JSON.stringify(dirs)}`);
  if (dirs[0] !== null && path.resolve(dirs[0]).startsWith(path.resolve("/tmp/dsh-combo-extract"))) why.push("a run wrote into the extraction cache");
  const leftover = dirs.filter((dir) => dir !== null && fs.existsSync(dir));
  if (leftover.length > 0) why.push(`residue left on disk: ${JSON.stringify(leftover)}`);
  return { ok: why.length === 0, roots, why };
}

/**
 * Two REAL concurrent runs of verify_scope_refs.mjs. The verdict is red if either run reports a
 * FAIL line, if they share a report directory, or if a directory survives the process.
 */
async function suiteIsolation(suiteFile) {
  const [first, second] = await Promise.all([run(suiteFile), run(suiteFile)]);
  const why = [];
  if (first.code !== 0 || second.code !== 0) why.push(`suite exit codes ${first.code}/${second.code}`);
  const failLines = [first, second].map((r) => (r.stdout.match(/^FAIL /gm) ?? []).length);
  if (failLines[0] !== 0 || failLines[1] !== 0) why.push(`FAIL lines ${failLines[0]}/${failLines[1]}`);
  const passLines = [first, second].map((r) => (r.stdout.match(/^PASS /gm) ?? []).length);
  if (passLines[0] === 0 || passLines[1] === 0) why.push(`a run printed no PASS line at all (${passLines[0]}/${passLines[1]})`);
  const reports = [first, second].map((r) => {
    const m = r.stdout.match(/^report: (.+)$/m);
    return m === null ? null : m[1].trim();
  });
  if (reports[0] === null || reports[1] === null) why.push("a run did not print its report path");
  else if (path.dirname(reports[0]) === path.dirname(reports[1])) why.push(`both runs wrote to ${path.dirname(reports[0])}`);
  const dirs = reports.map((r) => (r === null ? null : path.dirname(r)));
  const leftover = dirs.filter((dir) => dir !== null && fs.existsSync(dir));
  if (leftover.length > 0) why.push(`report directories survived the run: ${JSON.stringify(leftover)}`);
  return { ok: why.length === 0, reports, passLines, failLines, why };
}

// ── ① ② two concurrent probe processes ───────────────────────────────────────────────────────
// Snapshot the OLD fixed path BEFORE anything runs: "not touched" is only provable against a
// value taken earlier (reading it twice at the end would be a tautology).
const LEGACY_REPORT = "/tmp/dsh-combo-extract/scope-refs.json";
const legacyBefore = fs.existsSync(LEGACY_REPORT) ? fs.statSync(LEGACY_REPORT).mtimeMs : null;
console.log("== ① two concurrent probe processes: own directory each, guard armed ==");
const live = await probeIsolation(null);
check("two concurrent runs get DIFFERENT temp roots, both write inside them, guard refuses escapes, nothing left behind",
  live.ok, live.ok ? JSON.stringify(live.roots.map((r) => r.runRoot)) : live.why.join("; "));

// ── ③ two concurrent REAL suite runs ────────────────────────────────────────────────────────
console.log("\n== ② two concurrent verify_scope_refs.mjs runs: both green, different report dirs ==");
const liveSuite = await suiteIsolation(path.join(HERE, "verify_scope_refs.mjs"));
check("verify_scope_refs.mjs runs TWICE AT ONCE: both green, reports in different directories, both directories removed",
  liveSuite.ok, liveSuite.ok
    ? `PASS lines ${liveSuite.passLines.join("/")}, report dirs ${JSON.stringify(liveSuite.reports.map((r) => path.basename(path.dirname(r))))}`
    : liveSuite.why.join("; "));

// ── the mutation: put the fixed path back ───────────────────────────────────────────────────
console.log("\n== mutation: lib/route.mjs with the fixed temp path put back ==");
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ha-combo-isolation-"));
let mutationReport = "";
try {
  const FIXED = path.join(sandbox, "dsh-combo-run-fixed");
  const routeSource = fs.readFileSync(path.join(PKG, "lib", "route.mjs"), "utf8");
  const ANCHOR = "export const RUN_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), `dsh-combo-run-${process.pid}-`));";
  const KEEP_ANCHOR = 'const KEEP_RUN_ROOT = process.env.DSH_COMBO_KEEP === "1";';
  const hits = routeSource.split(ANCHOR).length - 1;
  if (hits !== 1) throw new Error(`the RUN_ROOT anchor hit ${hits} times (must be exactly 1) — the mutation would be a no-op`);
  let mutated = routeSource.split(ANCHOR).join(`export const RUN_ROOT = ${JSON.stringify(FIXED)};`);
  // The second half of the mutation keeps the directory alive: otherwise the first process to
  // exit deletes it under the second one and both die with an exception, which would let the
  // sharp failure ("the two runs SHARED a directory") hide behind a crash.
  const keepHits = mutated.split(KEEP_ANCHOR).length - 1;
  if (keepHits !== 1) throw new Error(`the KEEP_RUN_ROOT anchor hit ${keepHits} times (must be exactly 1)`);
  mutated = mutated.split(KEEP_ANCHOR).join("const KEEP_RUN_ROOT = true;");
  if (mutated.includes("mkdtempSync(path.join(os.tmpdir(), `dsh-combo-run-")) throw new Error("the mutation did not remove the per-run mkdtemp");
  // The mutated route must live next to a copy of lib/simulate.mjs (route.mjs imports it), so the
  // sandbox gets a real lib/ directory — and the SAME copy is used by both mutations below.
  const copy = path.join(sandbox, "combo-sim");
  fs.mkdirSync(path.join(copy, "verify"), { recursive: true });
  fs.cpSync(path.join(PKG, "lib"), path.join(copy, "lib"), { recursive: true });
  const mutatedPath = path.join(copy, "lib", "route.mjs");
  fs.writeFileSync(mutatedPath, mutated);

  const mutatedProbe = await probeIsolation(mutatedPath);
  check("mutation ①: fixed path ⇒ the two concurrent probes SHARE one directory ⇒ assertion goes RED",
    mutatedProbe.ok === false,
    mutatedProbe.ok ? "the mutation was not caught (both runs still isolated?)" : mutatedProbe.why.join("; "));
  mutationReport = mutatedProbe.why.join("; ");

  // The same mutation, but through the REAL suite: the copied package runs the real scope scan.
  fs.cpSync(path.join(PKG, "verify", "verify_scope_refs.mjs"), path.join(copy, "verify", "verify_scope_refs.mjs"));
  const mutatedSuite = await suiteIsolation(path.join(copy, "verify", "verify_scope_refs.mjs"));
  check("mutation ②: fixed path ⇒ two concurrent verify_scope_refs runs collide ⇒ assertion goes RED",
    mutatedSuite.ok === false,
    mutatedSuite.ok ? "the mutation was not caught (two real runs stayed isolated?)" : mutatedSuite.why.join("; "));
} catch (error) {
  check("mutation applies (a broken anchor must not look like a passing mutation)", false, String((error && error.message) || error));
} finally {
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (error) { /* temp only */ }
}

// ── ④ residue ──────────────────────────────────────────────────────────────────────────────
console.log("\n== ③ residue ==");
{
  const observed = [live, liveSuite].flatMap((r) => (r.roots ?? []).map((x) => x && x.runRoot))
    .concat(liveSuite.reports.map((r) => (r === null ? null : path.dirname(r))))
    .filter((dir) => typeof dir === "string");
  const leftover = observed.filter((dir) => fs.existsSync(dir));
  check("every temp directory this suite observed is gone", leftover.length === 0, leftover.length === 0
    ? `${observed.length} director(ies) checked, 0 left`
    : JSON.stringify(leftover));
}

// The OLD fixed path must no longer be written at all. mtime is the evidence: unchanged means
// not touched (and "absent before, absent after" also counts as untouched).
{
  const after = fs.existsSync(LEGACY_REPORT) ? fs.statSync(LEGACY_REPORT).mtimeMs : null;
  check("the old fixed path /tmp/dsh-combo-extract/scope-refs.json was not rewritten by these runs",
    legacyBefore === after, legacyBefore === null ? "absent before and after (nothing to collide with)" : `mtime still ${new Date(after).toISOString()}`);
}

console.log("");
if (mutationReport !== "") console.log(`mutation evidence: ${mutationReport}`);
console.log(`== ${pass} passed / ${fail} failed ==`);
if (fail > 0) {
  console.log("TEMP ISOLATION CHECKS FAILED");
  process.exit(1);
}
console.log("TEMP ISOLATION CHECKS PASSED");
