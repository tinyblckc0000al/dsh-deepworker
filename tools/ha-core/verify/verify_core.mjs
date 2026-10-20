// The shared layer's own suite. It must pass on its own, like every other suite here.
//
// Three jobs, in the order they run:
//
//   1. PRE-LAND GATE — `node verify_core.mjs --bundle=<path>` checks one bundle file that is
//      about to be moved into lib/client.js, using the SAME assertion as the live check below.
//      This is what makes "write the pending file → validate → mv" a single chain: the bytes
//      that land are the bytes that passed. Read-only; it writes nothing (the pending file lives
//      outside any watched directory on purpose).
//
//   2. THE CORE'S OWN CONTRACT — id === package name, the factory's return value is a
//      shape-valid plugin (executed with a fake require, never grepped), and the shared helpers
//      still behave. This is the assertion that was missing when a real machine failed to boot:
//      the bundle id, the package name and the host half were all checked, but nobody looked at
//      what the CLIENT factory actually RETURNED.
//
//   3. THE SWEEP — every local package that will be loaded as a bundle row (dsh.bundle present,
//      or named in the profile's dsh.profile.bundles) is checked through
//      verify/_bundle_row_shape.mjs. A defect of this class is a class, not an instance
//      (AGENTS.md discipline 3), so the guard is repo-wide and it executes every factory.
//
// What it cannot prove: that the plugins activate fully inside the App (the harness ctx is a
// stub). "Green here" means "this file cannot be the reason the App refuses to boot".
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { auditBundleRowShapes, executeClientFactory } from "./_bundle_row_shape.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** tools/ha-core/verify -> tools/ha-core -> tools （= 全部开发工具的根） */
const REPO = path.resolve(HERE, "..", "..");
const CORE_CLIENT = path.join(HERE, "..", "lib", "client.js");
/**
 * 2026-10-17（第 1 段搬迁）：本工具包搬进了插件仓库的 `tools/ha-core/`，插件根 = 本文件上三级。
 * 第 3 节的「类扫描」仍要带上主插件所在目录 —— 否则它会在无人察觉的情况下从扫描里消失，
 * 而「有洞的扫描」等于没有扫描。`REPO`（= `tools/`）覆盖工具包，`EXTRA_ROOT` 覆盖主插件。
 * 可用 `DSH_XH_DEEPWORKER_DIR` 覆盖（换机器 / 夹具时不必改代码）。
 */
const PLUGIN_DIR = process.env.DSH_XH_DEEPWORKER_DIR || path.resolve(HERE, "..", "..", "..");

const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };
const ok = (m) => console.log("  ok   " + m);

/**
 * The bundle-row plugin shape, asserted on ONE already-materialized factory return value.
 * Extracted so the pre-land gate and the live check cannot drift apart.
 * @param {*} api the factory's return value (already through mirrorUnwrapExports)
 * @param {string} where label for the diagnostics
 */
function assertPluginShape(api, where) {
  if (typeof api.apply !== "function") {
    fail(
      `${where}: the factory return value must have typeof apply === "function" (got ${api === null || api === undefined ? String(api) : typeof api.apply}) — ` +
        'the shell hands this object to cordis, which throws `invalid plugin, expect function or object with an "apply" method, received object` and the App does not boot',
    );
  }
  if (!Array.isArray(api.inject)) {
    fail(
      `${where}: the factory return value must have Array.isArray(inject) (got ${Array.isArray(api.inject) ? "array" : typeof api.inject}) — ` +
        "cordis reads it with mo.resolve(e.inject)",
    );
  }
}

/** The shared helper behaviour consumers depend on; used by both modes. */
function assertSameSessionId(api, where) {
  if (typeof api.sameSessionId !== "function") fail(`${where}: factory exports no sameSessionId function`);
  const cases = [
    [["session-abc", "abc"], true],
    [["abc", "session-abc"], true],
    [["session-abc", "session-abc"], true],
    [["abc", "abd"], false],
    [["", "abc"], false],
    [[null, null], false],
  ];
  const wrong = cases.find(([args, want]) => api.sameSessionId(...args) !== want);
  if (wrong !== undefined) fail(`${where}: sameSessionId(${wrong[0].map((a) => JSON.stringify(a)).join(", ")}) !== ${wrong[1]}`);
}

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// ── 1. pre-land gate: one pending bundle file, exact same shape assertion ───────────────────

const bundleArg = process.argv.slice(2).find((arg) => arg.startsWith("--bundle="));
if (bundleArg !== undefined) {
  const target = path.resolve(process.cwd(), bundleArg.slice("--bundle=".length));
  console.log("pre-land bundle gate: " + target);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) fail(`${target} is not a readable file`);
  const run = executeClientFactory(target);
  if (run.error !== null) fail(`${target}: ${run.error}`);
  if (run.id !== pkg.name) fail(`${target}: registers id ${JSON.stringify(run.id)} but the package is named ${JSON.stringify(pkg.name)}`);
  assertPluginShape(run.unwrapped, target);
  assertSameSessionId(run.unwrapped, target);
  if (run.unwrapped.version !== pkg.version) fail(`${target}: exports.version ${JSON.stringify(run.unwrapped.version)} !== package version ${JSON.stringify(pkg.version)}`);
  ok(`factory returns apply (${typeof run.unwrapped.apply}) + inject (array, length ${run.unwrapped.inject.length}) + the shared helpers`);
  console.log("\nPRE-LAND BUNDLE SHAPE OK — the pending bytes are safe to `mv` into place");
  console.log("(read-only gate: nothing was written; all fixture paths are absent by design)");
  process.exit(0);
}

// ── 2. the live core bundle ────────────────────────────────────────────────────────────────

const code = fs.readFileSync(CORE_CLIENT, "utf8");
let loaded = null;
const sandbox = { window: { __ModuleLoader__: { load: (r) => { loaded = r; } } } };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "core-client.js" });
if (loaded === null) fail("the bundle must self-register through window.__ModuleLoader__.load");
if (loaded.id !== "dsh-ha-core") fail("the bundle id must equal the package name (that is how require() finds it), got " + loaded.id);
const api = loaded.factory(function () { throw new Error("core must not require anything yet"); });

{
  assertSameSessionId(api, "lib/client.js");
  ok("sameSessionId: prefix, equality, and the empty cases");
}
{
  // The bundle-row plugin shape. Without apply/inject the shell's cordis call throws
  // 'invalid plugin, expect function or object with an "apply" method, received object' and the
  // App does not boot (real machine, 2026-10-14).
  assertPluginShape(api, "lib/client.js");
  ok(`bundle-row plugin shape: typeof apply === "function" (${typeof api.apply}), Array.isArray(inject) (${Array.isArray(api.inject)})`);
}
{
  // The package contract the consuming plugins depend on.
  if (pkg.name !== "dsh-ha-core") fail("package name must match the bundle id");
  if (!pkg.exports || !pkg.exports["./client"]) fail("exports['./client'] is how the shell finds the bundle");
  if (!pkg.dsh || !pkg.dsh.client || pkg.dsh.client.platform !== "web") fail("dsh.client.platform must be web");
  if (!Array.isArray(pkg.dsh.client.external)) fail("external must be a string array (it is the declared-import mechanism)");
  if (!pkg.dsh.bundle || !pkg.dsh.bundle.patch) fail("a bundle patch is what makes the loader insert the row");
  if (!fs.existsSync(new URL("../cordis.patch.yml", import.meta.url))) fail("the patch file referenced by package.json must exist");
  ok("package contract: id, ./client export, dsh.client, and the bundle patch");
}

// ── 3. the class-wide sweep: every local bundle row, factory executed ───────────────────────

{
  const sweep = await auditBundleRowShapes(REPO, { extraRoots: [path.dirname(PLUGIN_DIR)] });
  console.log(
    "bundle-row sweep (" +
      (sweep.profile.ok ? `profile bundles: ${sweep.profile.bundles.join(", ")}` : `profile unreadable (${sweep.profile.error}) — the dsh.bundle clause still applies`) +
      ")",
  );
  for (const result of sweep.results) {
    if (result.pass) ok(result.name + (result.name.includes("client factory shape") && result.message.includes("no client half") ? " — host-only, skipped" : ""));
    else console.error("  FAIL " + result.name + "\n         -> " + result.message);
  }
  // A guard on the sweep itself: no package that declares a bundle patch may escape it.
  const declared = fs
    .readdirSync(REPO, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
    .map((e) => path.join(REPO, e.name, "package.json"))
    .filter((f) => fs.existsSync(f))
    .map((f) => ({ file: f, json: JSON.parse(fs.readFileSync(f, "utf8")) }))
    .filter(({ json }) => json && json.dsh && json.dsh.bundle)
    .map(({ json }) => json.name);
  const escaped = declared.filter((name) => !sweep.rows.includes(name));
  if (escaped.length > 0) fail(`the sweep skipped bundle row(s) ${JSON.stringify(escaped)} — a bundle row that escapes the sweep is unguarded by construction`);
  if (sweep.errors.length > 0) fail(`bundle-row sweep: ${sweep.errors.length} of ${sweep.checks} assertions failed\n      ` + sweep.errors.join("\n      "));
  const withClient = sweep.results.filter((r) => r.name.includes("client exports.apply")).length;
  ok(`sweep: ${sweep.rows.length} bundle row(s) [${sweep.rows.join(", ")}], ${withClient} with an executed client factory, ${sweep.checks} assertions`);
}

console.log("\nHA-CORE CHECKS PASSED");
