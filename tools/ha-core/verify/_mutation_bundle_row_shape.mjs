#!/usr/bin/env node
/**
 * _mutation_bundle_row_shape.mjs — does the bundle-row shape gate actually go red?
 *
 * This is the mutation self-test for `_bundle_row_shape.mjs`, run against COPIES of the real
 * packages (not synthetic fixtures): every local bundle row is copied into a throwaway temp dir,
 * the copy is mutated, and the real assertion code is re-run against the copy. The repository is
 * opened read-only and its bytes are re-hashed afterwards — a mutation that touched a real file
 * would be a worse bug than the one this guards.
 *
 * The three mutations are the three ways the 2026-10-14 failed boot can be re-created:
 *   ① the client factory stops exporting apply        (the exact defect)
 *   ② the client factory's inject stops being an array (the second deps handshake)
 *   ③ the host half renames apply                      (the loader's other half)
 *
 * Usage: `node dsh-ha-core/verify/_mutation_bundle_row_shape.mjs` (from any directory)
 * Exit 0 only if the unmutated copy is green AND each mutation is red for its own reason.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTempPath, auditBundleRowShapes, listLocalPackages, isBundleRow } from "./_bundle_row_shape.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** dsh-ha-core/verify -> dsh-ha-core -> <repo> */
const REPO = path.resolve(HERE, "..", "..");
const CORE_REL = "dsh-ha-core";

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const bad = (message) => {
  console.error("FAIL: " + message);
  process.exitCode = 1;
};
const ok = (message) => console.log("  ok   " + message);

/** Copy every bundle-row package into `dest` (node_modules never travels). */
const copyBundleRows = (dest) => {
  const rows = listLocalPackages(REPO).filter((p) => isBundleRow(p.pkg, []));
  for (const row of rows) {
    fs.cpSync(row.dir, assertTempPath(path.join(dest, row.rel)), {
      recursive: true,
      filter: (src) => !src.split(path.sep).includes("node_modules"),
    });
  }
  return rows.map((r) => r.rel);
};

/** Replace one exact literal and fail loudly when it is not there (a no-op mutation proves nothing). */
const replaceOnce = (file, from, to) => {
  const body = fs.readFileSync(file, "utf8");
  if (!body.includes(from)) throw new Error(`mutation target not found in ${file}: ${JSON.stringify(from)}`);
  fs.writeFileSync(file, body.replace(from, to));
};

const tempRoot = assertTempPath(fs.mkdtempSync(path.join(os.tmpdir(), "verify-bundle-row-")));
// Hashes of the real files this run must not touch.
const guarded = [
  path.join(REPO, CORE_REL, "lib", "client.js"),
  path.join(REPO, CORE_REL, "lib", "index.js"),
  path.join(REPO, CORE_REL, "package.json"),
];
const before = new Map(guarded.map((f) => [f, sha256(f)]));

console.log(`bundle-row shape mutation check (copies under ${tempRoot}; repo stays read-only)`);

try {
  // ── 0. the control: copies of the real packages must be green ─────────────────────────────
  const control = path.join(tempRoot, "control");
  const copied = copyBundleRows(control);
  const controlRun = await auditBundleRowShapes(control, { profileBundles: [] });
  if (controlRun.errors.length > 0) {
    bad(`the unmutated copy of the real packages is not green, so a red mutation below would prove nothing:\n      ${controlRun.errors.join("\n      ")}`);
  } else {
    ok(`control: ${copied.length} real bundle row(s) copied [${copied.join(", ")}] stay green (${controlRun.checks} assertions)`);
  }

  const cases = [
    {
      label: "① the client factory stops exporting apply (the 2026-10-14 defect)",
      expect: (errors) => errors.find((e) => e.includes("dsh-ha-core/lib/client.js") && e.includes("apply")),
      mutate: (copyDir) =>
        replaceOnce(path.join(copyDir, "lib", "client.js"), "    exports.apply = function () {};\n", ""),
    },
    {
      label: "② the client factory's inject stops being an array",
      expect: (errors) => errors.find((e) => e.includes("Array.isArray(inject)")),
      mutate: (copyDir) =>
        replaceOnce(path.join(copyDir, "lib", "client.js"), "exports.inject = [];", 'exports.inject = "slots";'),
    },
    {
      label: "③ the host half renames apply",
      expect: (errors) => errors.find((e) => e.includes("dsh-ha-core/lib/index.js") && e.includes("apply")),
      mutate: (copyDir) => {
        // Rename consistently, so the import still succeeds and the SHAPE assertion is what fires
        // (an undefined-identifier import error would also be red, but for the wrong reason).
        const host = path.join(copyDir, "lib", "index.js");
        replaceOnce(host, "function apply()", "function applyRenamed()");
        replaceOnce(host, "export { apply };", "export { applyRenamed };");
      },
    },
  ];

  for (const [index, testCase] of cases.entries()) {
    const dir = path.join(tempRoot, `mutation-${index + 1}`);
    copyBundleRows(dir);
    const copyDir = path.join(dir, CORE_REL);
    testCase.mutate(copyDir);
    // Refresh the core copy inside the mutation so the failure cannot be the import cache.
    fs.utimesSync(path.join(copyDir, "lib", "client.js"), new Date(), new Date());
    fs.utimesSync(path.join(copyDir, "lib", "index.js"), new Date(), new Date());
    const run = await auditBundleRowShapes(dir, { profileBundles: [] });
    const hit = testCase.expect(run.errors);
    if (hit) ok(`mutation ${testCase.label} goes red -> ${hit.trim()}`);
    else bad(`mutation ${testCase.label} was NOT caught; errors were ${JSON.stringify(run.errors)}`);
  }

  // ── the real files must be byte-identical ──────────────────────────────────────────────────
  const touched = guarded.filter((f) => sha256(f) !== before.get(f));
  if (touched.length > 0) bad(`this check modified real file(s): ${JSON.stringify(touched)}`);
  else ok(`read-only: ${guarded.length} real file(s) byte-identical before and after (every write confined to ${tempRoot})`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

if (process.exitCode === 1) {
  console.error("\nBUNDLE-ROW SHAPE MUTATION CHECK: RED");
} else {
  console.log("\nBUNDLE-ROW SHAPE MUTATION CHECK: GREEN — all three mutations trip the gate");
}
