/**
 * dsh-combo-sim / verify/reconcile_code_cache.mjs
 *
 * Three artifacts claim to be the same 0.2.0-rc.2 client, and they are not.
 * This probe compares their literal string tables and reports the disagreement
 * instead of hiding it, because every mechanism claim in this package has to say
 * WHICH artifact it was read from.
 *
 *   A. app.asar shell        dsh-web-frontend/dist/assets/index-5SrrfWpU.js
 *      Contains the boot audit `eM`, which DOES call `modules.importError(id)` and
 *      prints `${name}: import failed: ${error.message}` when the map has an entry.
 *
 *   B. app.asar client half  dsh-client-modules/lib/client.js
 *      Prints the SHORT form `client-modules: ${id} import failed (see console)`
 *      (no "for the import error") and rejects transport with
 *      `client-modules: bundle script ${url} failed to load`.
 *
 *   C. the page's executed  dsh-client-modules  (V8 code cache, 24 entries,
 *      mtimes 2026-10-09T15:38Z … 2026-10-13T11:08Z, i.e. straddling both crash
 *      times 10:31Z and 11:05Z) contains only the short form and NO
 *      "see console for the import error" and NO "bundle script" literal at all.
 *
 * A V8 code cache preserves the compiled script's literal string table, so C is a
 * record of what actually ran. A and C cannot both be the same build of the shell
 * half: A's audit was written against a client build that carried the long message.
 *
 * Consequence (recorded in README → 未查清项): the bundle that produced the logged
 * `import failed` was not the client-modules build inside today's app.asar, so the
 * crash cannot be attributed to the artifact this package read line by line.
 *
 * Purely read-only. Writes one JSON report under /tmp.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runFile } from "../lib/route.mjs";

const ASAR = "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar";
const ASAR_CLIENT_MODULES = "dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js";
const ASAR_SHELL = "dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-5SrrfWpU.js";
const CACHE_DIR = path.join(os.homedir(), "Library/Application Support/@deepseek-ai/dsh-desktop/Code Cache/js");

/** Literals that separate the candidate builds. */
const PROBES = [
  "see console for the import error",
  "import failed (see console for the import error)",
  "import failed (see console)",
  "bundle script",
  "skipped after an earlier failure of this bundle",
  "could not load",
  "duplicate factory registration",
  "is waiting for activation",
];

function readFromAsar(key) {
  const fd = fs.openSync(ASAR, "r");
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const pickleSize = head.readUInt32LE(4);
    const jsonSize = head.readUInt32LE(12);
    const jb = Buffer.alloc(jsonSize);
    fs.readSync(fd, jb, 0, jsonSize, 16);
    const header = JSON.parse(jb.toString("utf8"));
    const base = 16 + pickleSize;
    let node = header;
    for (const seg of key.split("/")) {
      node = node.files?.[seg];
      if (!node) throw new Error(`combo-sim: ${key} not found inside ${ASAR}`);
    }
    const buf = Buffer.alloc(node.size);
    fs.readSync(fd, buf, 0, node.size, base + Number(node.offset));
    return { text: buf.toString("utf8"), bytes: node.size, integrity: node.integrity ?? null };
  } finally {
    fs.closeSync(fd);
  }
}

const countOccurrences = (haystack, needle) => {
  let n = 0;
  let i = -1;
  while ((i = haystack.indexOf(needle, i + 1)) !== -1) n += 1;
  return n;
};
const probeCounts = (text) => Object.fromEntries(PROBES.map((p) => [p, countOccurrences(text, p)]));

const asarClientModules = readFromAsar(ASAR_CLIENT_MODULES);
const asarShell = readFromAsar(ASAR_SHELL);

const report = {
  generatedAt: new Date().toISOString(),
  asar: { path: ASAR, mtime: fs.statSync(ASAR).mtime.toISOString() },
  asarClientModules: { key: ASAR_CLIENT_MODULES, bytes: asarClientModules.bytes, integrity: asarClientModules.integrity, probeCounts: probeCounts(asarClientModules.text) },
  asarShell: { key: ASAR_SHELL, bytes: asarShell.bytes, probeCounts: probeCounts(asarShell.text) },
  codeCache: {
    dir: CACHE_DIR,
    entriesScanned: 0,
    entriesMentioningClientModules: 0,
    mtimeRange: [null, null],
    newestEntry: null,
    probeCounts: Object.fromEntries(PROBES.map((p) => [p, 0])),
  },
  conclusion: null,
};

const times = [];
for (const name of fs.existsSync(CACHE_DIR) ? fs.readdirSync(CACHE_DIR) : []) {
  const file = path.join(CACHE_DIR, name);
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    continue;
  }
  report.codeCache.entriesScanned += 1;
  const text = buf.toString("latin1");
  if (!text.includes("duplicate factory registration")) continue;
  report.codeCache.entriesMentioningClientModules += 1;
  const st = fs.statSync(file);
  times.push(st.mtimeMs);
  if (report.codeCache.newestEntry === null || st.mtimeMs > new Date(report.codeCache.newestEntry.mtime).getTime()) {
    report.codeCache.newestEntry = { file, mtime: st.mtime.toISOString() };
  }
  for (const p of PROBES) if (text.includes(p)) report.codeCache.probeCounts[p] += 1;
}
if (times.length) report.codeCache.mtimeRange = [new Date(Math.min(...times)).toISOString(), new Date(Math.max(...times)).toISOString()];

const shellHasLongAudit = report.asarShell.probeCounts["see console for the import error"] > 0;
const appClientHasShort = report.asarClientModules.probeCounts["import failed (see console)"] > 0;
const appClientHasLong = report.asarClientModules.probeCounts["see console for the import error"] > 0;
const appClientHasBundleScript = report.asarClientModules.probeCounts["bundle script"] > 0;
const cacheHasLong = report.codeCache.probeCounts["see console for the import error"] > 0;
const cacheHasBundleScript = report.codeCache.probeCounts["bundle script"] > 0;
const cacheHasShort = report.codeCache.probeCounts["import failed (see console)"] > 0;

report.conclusion = {
  shellAuditExpectsLongMessage: shellHasLongAudit,
  appClientModulesEmitsLongMessage: appClientHasLong,
  appClientModulesEmitsShortMessage: appClientHasShort,
  appClientModulesEmitsBundleScriptFailure: appClientHasBundleScript,
  executedBuildEmitsLongMessage: cacheHasLong,
  executedBuildEmitsShortMessage: cacheHasShort,
  executedBuildEmitsBundleScriptFailure: cacheHasBundleScript,
  internalMismatchInTodayAppAsar: shellHasLongAudit && !appClientHasLong,
  executedBuildDiffersFromAppAsar: cacheHasShort && (!cacheHasLong || !cacheHasBundleScript),
  statement:
    shellHasLongAudit && !appClientHasLong
      ? "Today's app.asar is internally inconsistent: its shell audit calls modules.importError(id) and renders '…see console for the import error', while the client-modules bundle in the same app.asar emits only the short '(see console)' and rejects transport with 'bundle script … failed to load'. They are different builds of the same declared version."
      : "no internal mismatch detected with these probes",
};

const outPath = runFile("reconcile-code-cache.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(JSON.stringify(report.conclusion, null, 2));
console.log("\nprobe counts (shell / client-modules / code cache):");
for (const p of PROBES) {
  console.log(`  ${p.padEnd(48)} ${String(report.asarShell.probeCounts[p]).padStart(3)} ${String(report.asarClientModules.probeCounts[p]).padStart(3)} ${String(report.codeCache.probeCounts[p]).padStart(3)}`);
}
console.log("");

const checks = [
  [
    "app.asar shell audit references the importErrors map",
    shellHasLongAudit,
    "index-5SrrfWpU.js contains 'see console for the import error'",
  ],
  [
    "app.asar client-modules emits the short form",
    appClientHasShort,
    "client.js contains 'import failed (see console)'",
  ],
  [
    "today's app.asar is internally inconsistent (shell expects a message the bundle never produces)",
    report.conclusion.internalMismatchInTodayAppAsar === true,
    report.conclusion.statement,
  ],
  [
    "code cache contains executions of client-modules",
    report.codeCache.entriesMentioningClientModules > 0,
    `${report.codeCache.entriesMentioningClientModules} entries, ${report.codeCache.mtimeRange[0]} … ${report.codeCache.mtimeRange[1]}`,
  ],
  [
    "code-cache window straddles both crash times (10:31Z, 11:05Z)",
    report.codeCache.mtimeRange[0] !== null &&
      report.codeCache.mtimeRange[0] < "2026-10-13T11:05:00Z" &&
      report.codeCache.mtimeRange[1] > "2026-10-13T10:31:00Z",
    `${report.codeCache.mtimeRange[0]} … ${report.codeCache.mtimeRange[1]}`,
  ],
  [
    "the build the page executed differs from today's app.asar bundle",
    report.conclusion.executedBuildDiffersFromAppAsar === true,
    `executed: long=${cacheHasLong ? "yes" : "no"} bundleScript=${cacheHasBundleScript ? "yes" : "no"} short=${cacheHasShort ? "yes" : "no"}`,
  ],
];

let bad = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) bad += 1;
}
console.log(`\nfull report: ${outPath}`);
