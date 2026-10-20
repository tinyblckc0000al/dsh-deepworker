/**
 * dsh-combo-sim / verify/run_all.mjs
 *
 * One entry point for every sub-suite. Each suite runs in its own child process so
 * one crash cannot hide the others; each prints its own PASS/FAIL lines and this
 * runner repeats a summary plus the exit status of each.
 *
 * Read-only with respect to the repository and ~/.dsh. Every artifact a suite WRITES lands in
 * that run's own temp directory (`lib/route.mjs` RUN_ROOT: mkdtemp + pid, removed on exit);
 * the only stable path is the read-only extraction cache under /tmp/dsh-combo-extract
 * (produced by tools/extract-asar.mjs, READ by the suites). Both rules are asserted inside
 * lib/route.mjs (`assertRunPath` / `assertTempPath`) and by verify_temp_isolation.mjs.
 *
 * Usage:  node verify/run_all.mjs
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITES = [
  { name: "combo controlled experiment", file: "verify_combo.mjs" },
  { name: "scope-reference scan", file: "verify_scope_refs.mjs" },
  { name: "real-combo exception replay", file: "reproduce_combo_exception.mjs" },
  { name: "app.asar ↔ code-cache reconciliation", file: "reconcile_code_cache.mjs" },
];

const results = [];
for (const suite of SUITES) {
  const file = path.join(HERE, suite.file);
  console.log(`\n${"━".repeat(78)}\n▶ ${suite.name}  (${suite.file})\n${"━".repeat(78)}`);
  const run = spawnSync(process.execPath, [file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  process.stdout.write(out);
  const pass = (out.match(/^PASS /gm) ?? []).length;
  const fail = (out.match(/^FAIL /gm) ?? []).length;
  results.push({ name: suite.name, file: suite.file, status: run.status, pass, fail });
}

console.log(`\n${"━".repeat(78)}\nSUMMARY\n${"━".repeat(78)}`);
for (const r of results) {
  const verdict = r.fail === 0 ? "all green" : `${r.fail} FAIL`;
  console.log(`${(r.status === 0 ? "ok  " : "exit")}  ${r.name.padEnd(38)} PASS=${String(r.pass).padStart(2)} FAIL=${String(r.fail).padStart(2)}  ${verdict}`);
}
console.log(`
TWO FAILS ARE EXPECTED, and both ARE findings (not regressions):

  1. verify_combo.mjs — "simulator discriminates the good sample from the two crashed
     samples": the three samples are behaviourally identical, so the logged crashes
     are not reproducible from these bundle bytes.
  2. reconcile_code_cache.mjs — "app.asar bundle and the executed bundle do NOT agree":
     the page executed a client-modules build whose string table differs from the
     bundle inside today's app.asar, so no mechanism claim may be attributed to the
     page without saying which artifact it was read from.

Every other check must be green.
`);
