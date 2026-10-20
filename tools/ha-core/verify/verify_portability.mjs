// Portability gate — run before anything is published.
//
// Two independent jobs in one file:
//   1) the real audit over these three packages: no hardcoded absolute paths in published code,
//      every package.json contract that the loader depends on, the cordis peer dependency, and
//      THE BUNDLE-ROW PLUGIN SHAPE (host apply + the client factory's executed return value);
//   2) a mutation self-test: the audit is run against synthetic packages built in a temp dir
//      (one file intentionally contains /Users/, one package declares an id that disagrees with
//      its bundle, one declares exports["./client"] pointing at a file that does not exist, one
//      client factory returns an object with no apply, one returns a non-array inject, and one
//      host half renames apply). If those fixtures do not go red the gate is broken, so it fails.
//
// The bundle-row shape assertions live in ./_bundle_row_shape.mjs, shared verbatim with
// verify_core.mjs, so the two suites cannot drift. They exist because on 2026-10-14 a real
// machine refused to boot: dsh-ha-core/lib/client.js exported only its shared helpers, and the
// shell hands a bundle row's factory return value straight to cordis, which threw
// `invalid plugin, expect function or object with an "apply" method, received object`.
// Every check in this file was green at the time — none of them looked at that return value.
//
// It is standalone: `node verify_portability.mjs`, no other suite, no env vars, and it never
// writes inside the repository (fixtures live under os.tmpdir(), asserted by assertTempPath).
// Paths are resolved relative to this file with fileURLToPath — URL.pathname does not decode,
// and this repo's path contains non-ASCII characters.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTempPath, auditBundleRowShapes, readProfileBundles } from "./_bundle_row_shape.mjs";

const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };
const ok = (m) => console.log("  ok   " + m);

const fromUrl = (url) => fileURLToPath(url);
/** This file's own directory (no `HERE` before 2026-10-17: the file used `new URL("../../")` only). */
const HERE = path.dirname(fromUrl(import.meta.url));

/**
 * 2026-10-17（第 1 段搬迁）：本工具包搬进插件仓库的 `tools/ha-core/` ⇒ 插件根 = 本文件上三级。
 * 于是这个审计的「三个包」仍不共享一个 `root`：`dsh-ha-core` / `dsh-focus-lock` 在
 * `tools/ha-core`、`tools/focus-lock`（**目录名去掉了 `dsh-` 前缀，包名没变**），主插件在
 * `tools/` 之上。`SUITE_DIRS` 把「目录名」这件事集中到一处，夹具仍用老目录名。
 * 可用 `DSH_XH_DEEPWORKER_DIR` 覆盖（换机器 / 夹具时不必改代码）。
 */
const PLUGIN_DIR = process.env.DSH_XH_DEEPWORKER_DIR || path.resolve(HERE, "..", "..", "..");
/** 真实仓库的目录名（2026-10-17 起工具包目录去掉了 `dsh-` 前缀；`package.json` 的 name 未变）。 */
const SUITE_DIRS = { haCore: "ha-core", focusLock: "focus-lock" };

// ── audit (used for the real packages and, unchanged, for the mutation fixtures) ────────────

// A file is published if package.json "files" lists it, so anything in it must be portable.
const ABSOLUTE_PATH_MARKERS = ["/Users/", "/Applications/"];

// Tolerates the formatting variants the bundles use: a leading comment between the call and the
// object, either indentation width, a trailing comma after the id, and any key order.
const BUNDLE_ID_RE = /__ModuleLoader__\s*\.\s*load\s*\(\s*\{[\s\S]{0,200}?\bid\s*:\s*"([^"]+)"/;

/**
 * @param {string} root absolute directory that holds the two package directories still in the repo
 * @param {number} assertionOffset how many assertions were checked before the audit started
 * @param {string} [pluginDir] where `dsh-deepworker` lives; defaults to `root/dsh-deepworker`
 *   (the mutation fixtures build all three packages under one root, so they pass nothing).
 * @param {{haCore?: string, focusLock?: string}} [dirs] directory names under `root` for the two
 *   tool packages; defaults to the fixture layout `dsh-ha-core` / `dsh-focus-lock`. The real run
 *   passes `SUITE_DIRS` because `tools/` drops the `dsh-` prefix (2026-10-17 move).
 * @returns {{errors: string[], results: {pass: boolean, name: string}[]}} `errors[0]` is the
 *   headline failure (the one that matters most), the rest is context.
 */
const audit = (root, assertionOffset, pluginDir = path.join(root, "dsh-deepworker"), dirs = {}) => {
  const haCoreDir = dirs.haCore || "dsh-ha-core";
  const focusLockDir = dirs.focusLock || "dsh-focus-lock";
  const read = (file) => {
    try {
      return fs.readFileSync(file, "utf8");
    } catch (error) {
      return { error: String(error.message || error) };
    }
  };
  const exists = (file) => {
    try {
      fs.accessSync(file);
      return true;
    } catch {
      return false;
    }
  };

  let checks = assertionOffset;
  const results = [];
  const errors = [];
  const record = (name, pass, message) => {
    checks += 1;
    results.push({ pass, name });
    if (!pass) errors.push(`[${checks}] ${message}`);
    return pass;
  };

  const packages = [
    {
      label: "dsh-ha-core",
      // 真实运行：`tools/ha-core`（包名仍是 dsh-ha-core）；夹具：`root/dsh-ha-core`。
      dir: path.join(root, haCoreDir),
      // The client half is optional: a package without one is skipped for the id check.
      clientBundle: "lib/client.js",
      clientBundleRequired: true,
      files: ["lib/index.js", "lib/client.js"],
    },
    {
      label: "dsh-deepworker",
      // 迁出本仓库后它不在 `root` 下了：真实审计传新位置，夹具仍传 `root/dsh-deepworker`。
      dir: pluginDir,
      clientBundle: "lib/client.js",
      clientBundleRequired: false,
      files: ["lib/client.js", "lib/index.js"],
    },
    {
      label: "dsh-focus-lock",
      // 同上：真实运行 `tools/focus-lock`，夹具 `root/dsh-focus-lock`。
      dir: path.join(root, focusLockDir),
      // No client half at all — so there must be no exports["./client"] either.
      clientBundle: "lib/index.js",
      clientBundleRequired: false,
      files: ["lib/index.js", "lib/focus-lock-cli.mjs"],
    },
  ];

  for (const spec of packages) {
    // 1. published code must not carry a hardcoded absolute path
    for (const rel of spec.files) {
      const file = path.join(spec.dir, rel);
      const body = read(file);
      if (typeof body !== "string") {
        record(`${spec.label}: ${rel}`, false, `${spec.label}/${rel} cannot be read (${body.error})`);
        continue;
      }
      const marker = ABSOLUTE_PATH_MARKERS.find((m) => body.includes(m));
      record(
        `${spec.label}: ${rel}`,
        !marker,
        `${spec.label}/${rel} hardcodes the absolute path marker ${JSON.stringify(marker)} — published code must stay portable`,
      );
    }

    // 2a. the package name and the client bundle id must be the same string
    const pkgFile = path.join(spec.dir, "package.json");
    const raw = read(pkgFile);
    let pkg = null;
    if (typeof raw !== "string") {
      record(`${spec.label}: package.json`, false, `${spec.label}/package.json cannot be read (${raw.error})`);
    } else {
      try {
        pkg = JSON.parse(raw);
        record(`${spec.label}: package.json`, true, "");
      } catch (error) {
        record(`${spec.label}: package.json`, false, `${spec.label}/package.json is not valid JSON (${String(error.message || error)})`);
      }
    }
    if (!pkg) continue;

    const bundleFile = path.join(spec.dir, spec.clientBundle);
    const bundleRaw = read(bundleFile);
    if (typeof bundleRaw !== "string") {
      if (spec.clientBundleRequired) {
        record(
          `${spec.label}: bundle id`,
          false,
          `${spec.label}/${spec.clientBundle} cannot be read (${bundleRaw.error}) — the declared id cannot be checked against the bundle`,
        );
      }
    } else {
      const match = BUNDLE_ID_RE.exec(bundleRaw);
      if (!match) {
        if (spec.clientBundleRequired) {
          record(
            `${spec.label}: bundle id`,
            false,
            `${spec.label}/${spec.clientBundle} declares no __ModuleLoader__.load({ id: "..." })`,
          );
        }
      } else {
        record(
          `${spec.label}: bundle id`,
          match[1] === pkg.name,
          `${spec.label}: package.json name ${JSON.stringify(pkg.name)} but the client bundle registers id ${JSON.stringify(match[1])} — require() looks the bundle up by package name`,
        );
      }
    }

    // 2b. dsh.bundle.patch is a file the package promises to ship
    const patch = pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch;
    if (typeof patch === "string" && patch.length > 0) {
      const patchFile = path.join(spec.dir, patch);
      record(
        `${spec.label}: dsh.bundle.patch`,
        exists(patchFile),
        `${spec.label}: dsh.bundle.patch points at ${JSON.stringify(patch)}, which does not exist — the loader would fail on a missing patch file`,
      );
    }

    // 2c. every exports target must exist; "./client" in particular is how the shell finds the
    // bundle, and "declared but absent" is a startup failure rather than a soft error.
    const clientExport = pkg.exports && pkg.exports["./client"];
    if (clientExport) {
      const target = typeof clientExport === "string" ? clientExport : clientExport.default;
      record(
        `${spec.label}: exports["./client"]`,
        typeof target === "string" && exists(path.join(spec.dir, target)),
        `${spec.label}: exports["./client"] points at ${JSON.stringify(target)}, which does not exist — declaring it makes the shell expect a bundle that will never load`,
      );
    }
    for (const [key, value] of Object.entries(pkg.exports || {})) {
      const target = typeof value === "string" ? value : value && value.default;
      if (typeof target !== "string" || !target.startsWith("./")) continue;
      record(
        `${spec.label}: exports[${JSON.stringify(key)}] target`,
        exists(path.join(spec.dir, target)),
        `${spec.label}: exports[${JSON.stringify(key)}] points at ${JSON.stringify(target)}, which does not exist`,
      );
    }

    // 3. the cordis peer dependency is what makes the package loadable inside a DSH profile
    const peer = pkg.peerDependencies && pkg.peerDependencies["@deepseek-ai/cordis"];
    record(
      `${spec.label}: peerDependencies`,
      typeof peer === "string" && peer.length > 0,
      `${spec.label}: peerDependencies["@deepseek-ai/cordis"] is missing — the package cannot be loaded as a cordis entry`,
    );
  }

  return { errors, results, checks };
};

/**
 * `audit()` plus the bundle-row shape sweep, as one result.
 * The shape part must execute real factories, so it is async while the path/contract part is not.
 * @param {string} root repository-shaped root
 * @param {string[]|undefined} profileBundles fixture profile bundles; undefined means "read the
 *   real desktop profile read-only" (the real run only — fixtures must never read real state)
 * @param {{pluginDir?: string, extraRoots?: string[], dirs?: object}} [options] the real run points
 *   these at the migrated plugin + `tools/` dir names (2026-10-17); fixtures leave them unset so
 *   every package comes from `root` under its fixture name.
 * @returns {Promise<{errors: string[], results: {pass: boolean, name: string}[], checks: number, rows: object}>}
 */
const auditAll = async (root, profileBundles, options = {}) => {
  const base = audit(root, 0, options.pluginDir, options.dirs);
  const rows = await auditBundleRowShapes(root, {
    offset: base.checks,
    ...(profileBundles === undefined ? {} : { profileBundles }),
    ...(options.extraRoots === undefined ? {} : { extraRoots: options.extraRoots }),
  });
  base.checks = rows.checks;
  base.results.push(...rows.results);
  base.errors.push(...rows.errors);
  base.rows = rows;
  return base;
};

/** One line per bundle row, so a red sweep names the package and the exact half that failed. */
const printRows = (rows) => {
  console.log(
    `  bundle rows: ${rows.rows.length} (${rows.rows.join(", ")}) — ` +
      (rows.profile.ok ? `profile dsh.profile.bundles = ${JSON.stringify(rows.profile.bundles)}` : `profile unreadable (${rows.profile.error})`),
  );
  for (const result of rows.results) {
    if (result.pass) {
      const skipped = result.message.includes("no client half");
      console.log(`    ok   ${result.name}${skipped ? " — host-only, skipped" : ""}`);
    } else {
      console.log(`    FAIL ${result.name}`);
    }
  }
};

// ── 1. the real audit ──────────────────────────────────────────────────────────────────────

console.log("portability: absolute paths, package contracts, cordis peer, and the bundle-row plugin shape");
const realRoot = fromUrl(new URL("../../", import.meta.url));
const realProfile = readProfileBundles();
// 主插件已迁出（2026-10-17）：包目录与 bundle 行扫描都要额外带上它的新位置，否则这一层
// 会「因为读不到而静默少审一个包」——那正是本套件存在的理由（2026-10-14 的启动失败）。
const real = await auditAll(realRoot, undefined, {
  pluginDir: PLUGIN_DIR,
  extraRoots: [path.dirname(PLUGIN_DIR)],
  dirs: SUITE_DIRS,
});
printRows(real.rows);
if (real.errors.length > 0) fail(real.errors.join("\n      "));
ok(
  `${real.checks} contract assertions over the local packages` +
    " (published files, bundle ids, exports targets, bundle patches, cordis peer, host apply, executed client factory shape)",
);
ok(`no hardcoded ${ABSOLUTE_PATH_MARKERS.join(" or ")} in any published code file`);
ok(
  `bundle-row sweep covered ${real.rows.rows.length} row(s) and executed ${real.rows.results.filter((r) => r.name.includes("client exports.apply")).length} client factor(ies); ` +
    (realProfile.ok ? `profile read-only: ${realProfile.path}` : `profile not read (${realProfile.error})`),
);

// ── 2. mutation self-test — does the gate actually go red? ─────────────────────────────────

// Everything below happens in a throwaway temp dir that is removed on the way out. Nothing is
// written inside the repository.
const buildFixture = (dir, options = {}) => {
  const write = (rel, body) => {
    const file = assertTempPath(path.join(dir, rel));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };
  const pkg = (extra) => JSON.stringify({
    name: "dsh-ha-core",
    type: "module",
    main: "lib/index.js",
    exports: { ".": { default: "./lib/index.js" }, "./client": { default: "./lib/client.js" } },
    dsh: { client: { platform: "web" }, bundle: { patch: "./cordis.patch.yml" } },
    peerDependencies: { "@deepseek-ai/cordis": "~4.0.4" },
    ...extra,
  }, null, 2);

  // Shape-valid by default: the host half exports apply, and the client factory returns a plugin
  // object with apply + inject. A fixture that is invalid for some OTHER reason (a bad path, a
  // bad id, a phantom export) must not also be invalid here, or the mutation proves nothing.
  const hostHalf = (name) => `export function apply() {}\nexport const name = ${JSON.stringify(name)};\n`;
  const clientHalf = (id) =>
    `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(id)},\n  factory: function () { return { apply: function () {}, inject: [] }; },\n});\n`;

  write("dsh-ha-core/lib/index.js", options.indexBody || hostHalf("dsh-ha-core"));
  write("dsh-ha-core/lib/client.js", options.clientBody || clientHalf("dsh-ha-core"));
  write("dsh-ha-core/cordis.patch.yml", "- insert:\n    - id: dsh-ha-core\n");
  write("dsh-ha-core/package.json", options.haCorePackage || pkg());
  write("dsh-deepworker/lib/index.js", hostHalf("dsh-deepworker"));
  write("dsh-deepworker/lib/client.js", clientHalf("dsh-deepworker"));
  write("dsh-deepworker/cordis.patch.yml", "- insert:\n    - id: dsh-deepworker\n");
  write("dsh-deepworker/package.json", JSON.stringify({
    name: "dsh-deepworker",
    type: "module",
    main: "lib/index.js",
    exports: { ".": { default: "./lib/index.js" }, "./client": { default: "./lib/client.js" } },
    dsh: { client: { platform: "web" }, bundle: { patch: "./cordis.patch.yml" } },
    peerDependencies: { "@deepseek-ai/cordis": "~4.0.4" },
  }, null, 2));
  write("dsh-focus-lock/lib/index.js", options.focusLockIndexBody || hostHalf("dsh-focus-lock"));
  write("dsh-focus-lock/lib/focus-lock-cli.mjs", "#!/usr/bin/env node\nprocess.stdout.write(\"focus-lock\\n\");\n");
  write("dsh-focus-lock/cordis.patch.yml", "- insert:\n    - id: dsh-focus-lock\n");
  write("dsh-focus-lock/package.json", options.focusLockPackage || JSON.stringify({
    name: "dsh-focus-lock",
    type: "module",
    main: "lib/index.js",
    exports: { ".": { default: "./lib/index.js" }, "./package.json": "./package.json" },
    dsh: { bundle: { patch: "./cordis.patch.yml" } },
    peerDependencies: { "@deepseek-ai/cordis": "~4.0.4" },
  }, null, 2));
};

/**
 * Run the whole gate (paths + contracts + executed bundle-row shape) over one fixture root.
 * Fixtures pass `[]` explicitly so the real profile is never read for them.
 * @param {string} root
 * @returns {Promise<{errors: string[], results: {pass: boolean, name: string}[], checks: number, rows: object}>}
 */
const auditFixture = (root) => auditAll(root, []);

const runSelfTests = async () => {
  const tempRoot = assertTempPath(fs.mkdtempSync(path.join(os.tmpdir(), "verify-portability-")));
  let failures = 0;
  try {
    // (a) the clean control must stay green — otherwise a red assertion below proves nothing
    const clean = path.join(tempRoot, "clean");
    buildFixture(clean);
    const cleanRun = await auditFixture(clean);
    const cleanFailures = cleanRun.results.filter((r) => !r.pass);
    if (cleanFailures.length === 0) {
      ok(`self-test: a clean synthetic package set stays green (${cleanRun.checks} assertions, ${cleanRun.rows.rows.length} bundle rows swept)`);
    } else {
      failures += 1;
      console.error("FAIL: self-test: the clean synthetic package set is not green — the audit has a false positive:");
      for (const f of cleanFailures) console.error(`      ${f.name}`);
    }

    // (b) mutation: one published file hardcodes /Users/<somewhere>
    const mutated = path.join(tempRoot, "mutated");
    buildFixture(mutated, {
      indexBody: 'export function apply() {}\nexport const HOME = "/Users/me/work/project";\n',
    });
    const mutatedRun = await auditFixture(mutated);
    const pathFailure = mutatedRun.errors.find((e) => e.includes("dsh-ha-core/lib/index.js"));
    if (pathFailure) {
      ok(`self-test: /Users/ in a published file is caught -> ${pathFailure.trim()}`);
    } else {
      failures += 1;
      console.error("FAIL: self-test: an absolute path in dsh-ha-core/lib/index.js was NOT caught — the gate is dead");
    }

    // (c) mutation: package name and client bundle id disagree (the "declared vs actual" trap)
    const idMismatch = path.join(tempRoot, "id-mismatch");
    buildFixture(idMismatch, {
      haCorePackage: JSON.stringify({
        name: "dsh-ha-core-renamed",
        type: "module",
        main: "lib/index.js",
        exports: { ".": { default: "./lib/index.js" }, "./client": { default: "./lib/client.js" } },
        dsh: { client: { platform: "web" }, bundle: { patch: "./cordis.patch.yml" } },
        peerDependencies: { "@deepseek-ai/cordis": "~4.0.4" },
      }, null, 2),
    });
    const idRun = await auditFixture(idMismatch);
    const idFailure = idRun.errors.find((e) => e.includes("registers id"));
    if (idFailure) {
      ok(`self-test: a name/bundle-id mismatch is caught -> ${idFailure.trim()}`);
    } else {
      failures += 1;
      console.error("FAIL: self-test: a package name that disagrees with its bundle id was NOT caught");
    }

    // (d) mutation: exports["./client"] declared but the file does not exist (the real accident:
    // "declared but absent" is a startup failure, not a soft error)
    const missingExport = path.join(tempRoot, "missing-export");
    buildFixture(missingExport, {
      indexBody: 'export function apply() {}\nexport const version = "0.1.0";\n// no client half in this mutated package\n',
      focusLockPackage: JSON.stringify({
        name: "dsh-focus-lock",
        type: "module",
        main: "lib/index.js",
        exports: { ".": { default: "./lib/index.js" }, "./client": { default: "./lib/client.js" } },
        dsh: { bundle: { patch: "./cordis.patch.yml" } },
        peerDependencies: { "@deepseek-ai/cordis": "~4.0.4" },
      }, null, 2),
    });
    const exportRun = await auditFixture(missingExport);
    const exportFailure = exportRun.errors.find((e) => e.includes('exports["./client"]'));
    if (exportFailure) {
      ok(`self-test: exports["./client"] pointing at a missing file is caught -> ${exportFailure.trim()}`);
    } else {
      failures += 1;
      console.error('FAIL: self-test: exports["./client"] pointing at a missing file was NOT caught');
    }

    // (e) mutation: a missing cordis peer dependency
    const noPeer = path.join(tempRoot, "no-peer");
    buildFixture(noPeer, {
      focusLockPackage: JSON.stringify({
        name: "dsh-focus-lock",
        type: "module",
        main: "lib/index.js",
        exports: { ".": { default: "./lib/index.js" }, "./package.json": "./package.json" },
        dsh: { bundle: { patch: "./cordis.patch.yml" } },
      }, null, 2),
    });
    const peerRun = await auditFixture(noPeer);
    const peerFailure = peerRun.errors.find((e) => e.includes("peerDependencies"));
    if (peerFailure) {
      ok(`self-test: a missing cordis peer dependency is caught -> ${peerFailure.trim()}`);
    } else {
      failures += 1;
      console.error("FAIL: self-test: a missing cordis peer dependency was NOT caught");
    }

    // ── (f)(g)(h) THE CLASS THIS GATE WAS MISSING: the factory's RETURN VALUE ───────────────
    // Reproduces the 2026-10-14 real-machine failure in three independent ways. Each must be
    // caught by executing the factory, which is why a text-level check cannot substitute.

    // (f) mutation: the client factory returns an object with no apply — the exact real defect
    const noApply = path.join(tempRoot, "client-no-apply");
    buildFixture(noApply, {
      clientBody: 'window.__ModuleLoader__.load({\n  id: "dsh-ha-core",\n  factory: function () { return { inject: [], sameSessionId: function () { return false; } }; },\n});\n',
    });
    const noApplyRun = await auditFixture(noApply);
    const noApplyFailure = noApplyRun.errors.find((e) => e.includes("dsh-ha-core/lib/client.js") && e.includes("apply"));
    if (noApplyFailure) {
      ok(`self-test: a client factory with no apply is caught -> ${noApplyFailure.trim()}`);
    } else {
      failures += 1;
      console.error("FAIL: self-test: a client factory whose return value has no apply was NOT caught — this is the 2026-10-14 failed-boot defect");
    }

    // (g) mutation: inject is not an array (cordis reads it with mo.resolve(e.inject))
    const badInject = path.join(tempRoot, "client-bad-inject");
    buildFixture(badInject, {
      clientBody: 'window.__ModuleLoader__.load({\n  id: "dsh-ha-core",\n  factory: function () { return { apply: function () {}, inject: "slots" }; },\n});\n',
    });
    const badInjectRun = await auditFixture(badInject);
    const badInjectFailure = badInjectRun.errors.find((e) => e.includes("Array.isArray(inject)"));
    if (badInjectFailure) {
      ok(`self-test: a non-array client inject is caught -> ${badInjectFailure.trim()}`);
    } else {
      failures += 1;
      console.error("FAIL: self-test: a client factory whose inject is not an array was NOT caught");
    }

    // (h) mutation: the host half renames apply (the loader refuses anything without it)
    const noHostApply = path.join(tempRoot, "host-no-apply");
    buildFixture(noHostApply, {
      indexBody: 'export function applyRenamed() {}\nexport const name = "dsh-ha-core";\n',
    });
    const noHostApplyRun = await auditFixture(noHostApply);
    const noHostApplyFailure = noHostApplyRun.errors.find((e) => e.includes("dsh-ha-core/lib/index.js") && e.includes("apply"));
    if (noHostApplyFailure) {
      ok(`self-test: a host half without apply is caught -> ${noHostApplyFailure.trim()}`);
    } else {
      failures += 1;
      console.error("FAIL: self-test: a host half that renames apply was NOT caught");
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  if (failures > 0) fail(`mutation self-test: ${failures} of the fixtures did not trip the gate`);
};

await runSelfTests();
ok("mutation self-test: the gate goes red on absolute paths, id mismatch, phantom exports, a missing peer dep, a missing client apply, a non-array inject, and a renamed host apply");

console.log("\nPORTABILITY CHECKS PASSED");
