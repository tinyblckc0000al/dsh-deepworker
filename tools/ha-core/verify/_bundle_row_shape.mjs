/**
 * _bundle_row_shape.mjs — the contract a package must satisfy **to be loaded as a bundle row**.
 *
 * ── Why this file exists (the real-machine failure it was bought with) ──────────────────────
 *
 * 2026-10-14: adding `dsh-ha-core` to `~/.dsh/profiles/desktop/package.json`'s
 * `dsh.profile.bundles` made the App fail to start. The renderer reported, verbatim:
 *
 *   Error: invalid plugin, expect function or object with an "apply" method, received object
 *
 * (crash log `~/Library/Logs/DeepSeek Harness/crash-2026-10-14T01-32-39-811Z-web-boot.log`,
 *  landed there by the host's `bootFailed` handler, app.asar `lib/main.js:11573`).
 *
 * The cause: `dsh-ha-core/lib/client.js` was written as a **shared library only** — its factory
 * returned `{ __test, sameSessionId, version }` and nothing else. But the client half of a
 * bundle row is not "just a module": the shell hands the factory's return value straight to
 * cordis as the plugin object.
 *
 *   app.asar `dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js:671-690`
 *     `exports: registered.factory(this.makeRequire(ownerId, edges))`      // materialize
 *     `import(specifier) { … return this.materialize(id).exports; }`       // :743-756
 *   app.asar `dsh-web-frontend/dist/assets/index-5SrrfWpU.js` (the vendored cordis Loader)
 *     `const o=this.loader.unwrapExports(n); … this.fiber=this.ctx.registry.plugin(o,…)`
 *     `plugin(e,…){const s=this.resolve(e);if(!s)throw new Error('invalid plugin, expect
 *      function or object with an "apply" method, received '+typeof e);`
 *     `resolve(e){try{if(typeof e=="function")return e;if(of(e))return e.apply}catch{}}`
 *
 * So: a factory that returns an object without `apply` is not a shared layer that "has no
 * behaviour yet" — it is an invalid plugin, and it takes the whole boot down.
 *
 * ── What this module checks (every bundle row, always) ──────────────────────────────────────
 *
 * For each local package that will be loaded as a bundle row (`package.json.dsh.bundle` exists,
 * or its name is listed in the profile's `dsh.profile.bundles`):
 *
 *   1. the HOST half must export `apply` as a function (dynamic `import()` of the real entry);
 *   2. if the package declares a CLIENT half (`exports["./client"]` or `dsh.client`), the
 *      client factory must be **actually executed** (in `node:vm`, with a fake `require`) and
 *      its return value must satisfy `typeof exports.apply === "function"` and
 *      `Array.isArray(exports.inject)`.
 *
 * Check 2 deliberately executes rather than greps: the failure that motivated this file was a
 * perfectly syntax-valid file whose *value* was the wrong shape, so `node --check`, `vm.Script`,
 * and every text-level assertion stayed green.
 *
 * ── Path discipline ────────────────────────────────────────────────────────────────────────
 *
 * This module WRITES NOTHING. The profile manifest is read read-only (and its absence is a
 * note, never a failure). Any caller that builds fixtures must keep them under `os.tmpdir()`;
 * `assertTempPath()` below is the assertion for that, and it is exported so the suites use it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";

/** The shell's window between two bundle-script evaluations; the guard is a hang detector. */
const SCRIPT_TIMEOUT_MS = 20000;
/** A factory that blocks for this long is not a plugin, it is a bug. */
const FACTORY_TIMEOUT_MS = 20000;

/** The desktop profile manifest. Read-only here; never written (see the module docstring). */
export const PROFILE_MANIFEST = path.join(os.homedir(), ".dsh", "profiles", "desktop", "package.json");

/**
 * Assert that a path a test is about to create lives under the OS temp dir.
 * The rule it enforces ("all test paths point at a temp dir") is not a style preference:
 * a suite once wrote into `~/.dsh` and made real state indistinguishable from test state.
 * @param {string} candidate absolute path
 * @returns {string} `candidate`, for use in an expression
 */
export function assertTempPath(candidate) {
  const resolved = path.resolve(candidate);
  const tempRaw = path.resolve(os.tmpdir());
  // macOS: os.tmpdir() is /var/folders/... while its realpath is /private/var/folders/...
  const temps = new Set([tempRaw, fs.realpathSync(tempRaw)]);
  // The candidate usually does not exist yet, so canonicalise its nearest existing ancestor.
  let existing = resolved;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const canonical = path.join(fs.realpathSync(existing), path.relative(existing, resolved));
  for (const temp of temps) {
    if (canonical === temp || canonical.startsWith(temp + path.sep)) return candidate;
  }
  throw new Error(`test path ${canonical} is not under the temp dir ${tempRaw} — test fixtures must never touch real state`);
}

/**
 * Read the profile's `dsh.profile.bundles` **read-only**.
 * @param {string} [manifestPath]
 * @returns {{ok: boolean, path: string, bundles: string[], error: string|null}}
 */
export function readProfileBundles(manifestPath = PROFILE_MANIFEST) {
  try {
    const pkg = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const list = pkg && pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles;
    return {
      ok: true,
      path: manifestPath,
      bundles: Array.isArray(list) ? list.filter((item) => typeof item === "string") : [],
      error: null,
    };
  } catch (error) {
    return { ok: false, path: manifestPath, bundles: [], error: String((error && error.message) || error) };
  }
}

/**
 * Every immediate subdirectory of `root` that holds a readable `package.json` with a name.
 * Skips dot-directories and node_modules.
 * @param {string} root
 * @returns {{name: string, dir: string, pkg: object, rel: string}[]}
 */
export function listLocalPackages(root) {
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const dir = path.join(root, entry.name);
    let pkg = null;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    } catch {
      continue;
    }
    if (!pkg || typeof pkg.name !== "string" || pkg.name === "") continue;
    found.push({ name: pkg.name, dir, pkg, rel: entry.name });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Will this package be loaded as a bundle row?
 * The two clauses are the two ways a row appears: it declares a bundle patch, or the profile
 * lists it (the profile is what actually inserts the row at boot).
 * @param {object} pkg parsed package.json
 * @param {string[]} profileBundles names from `dsh.profile.bundles` (read-only)
 */
export function isBundleRow(pkg, profileBundles) {
  const declaresPatch = Boolean(pkg && pkg.dsh && pkg.dsh.bundle);
  return declaresPatch || profileBundles.includes(pkg && pkg.name);
}

/** Strip a leading "./" so diagnostics read `lib/client.js`, not `./lib/client.js`. */
function pretty(rel) {
  return typeof rel === "string" ? rel.replace(/^\.\//, "") : String(rel);
}

/** Normalise an `exports` entry (string | {default}) to a relative path, or null. */
export function exportTarget(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.default === "string") return value.default;
  return null;
}

/**
 * The client-bundle path this package promises to ship, or null when it has no client half.
 * @param {object} pkg
 * @returns {string|null} repo-relative-to-package path
 */
export function declaredClientBundle(pkg) {
  const viaExports = exportTarget(pkg && pkg.exports && pkg.exports["./client"]);
  if (viaExports !== null) return viaExports;
  if (pkg && pkg.dsh && pkg.dsh.client) return null; // declares a client half but no path ⇒ callers report it
  return null;
}

/**
 * The host entry this package promises (`main`, else `exports["."]`).
 * @param {object} pkg
 * @returns {string|null}
 */
export function declaredHostEntry(pkg) {
  if (pkg && typeof pkg.main === "string" && pkg.main !== "") return pkg.main;
  return exportTarget(pkg && pkg.exports && pkg.exports["."]);
}

/**
 * A callable/gettable stand-in for every module a factory may `require`.
 * Used only inside the vm sandbox; it never touches the real module system.
 * @param {string} label
 */
function makeStub(label = "stub") {
  const fn = function () {};
  return new Proxy(fn, {
    get(target, key) {
      if (key === Symbol.toPrimitive) return () => label;
      if (key === "then") return undefined;
      if (key === Symbol.toStringTag) return "Module";
      if (key === "default") return makeStub(`${label}.default`);
      return makeStub(`${label}.${String(key)}`);
    },
    apply() {
      return makeStub(`${label}()`);
    },
    construct() {
      return makeStub(`new ${label}`);
    },
    has() {
      return true;
    },
  });
}

/** Globals the client bundles are allowed to see. Anything else stays undefined (loudly). */
function makeSandbox() {
  const sandbox = {
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    document: makeStub("document"),
    navigator: { userAgent: "dsh-ha-core verify harness", language: "zh-CN" },
    location: { href: "http://127.0.0.1/" },
  };
  sandbox.window = { __ModuleLoader__: { load: (registration) => { sandbox.__registration = registration; } } };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  return sandbox;
}

/**
 * Mirror of the vendored cordis Loader's `unwrapExports`
 * (app.asar dsh-web-frontend/dist/assets/index-5SrrfWpU.js:
 *  `unwrapExports(e){return Cn(e)||(e=e.default??e,!e.__esModule)?e:e.default??e}`, `Cn(e){return e==null}`).
 * A bundle that sets `__esModule` gets unwrapped before the shape is judged, exactly as at boot.
 * @param {*} api
 */
export function mirrorUnwrapExports(api) {
  if (api === null || api === undefined) return api;
  let value = api.default !== undefined && api.default !== null ? api.default : api;
  if (!value.__esModule) return value;
  return value.default !== undefined && value.default !== null ? value.default : value;
}

/**
 * Register a real client bundle in a vm and **execute its factory** with a fake `require`.
 * @param {string} bundleFile absolute path to the client bundle
 * @returns {{id: string|null, api: *, error: string|null, unwrapped: *}}
 */
export function executeClientFactory(bundleFile) {
  const code = fs.readFileSync(bundleFile, "utf8");
  const sandbox = makeSandbox();
  vm.createContext(sandbox);
  try {
    vm.runInContext(code, sandbox, { filename: bundleFile, timeout: SCRIPT_TIMEOUT_MS });
  } catch (error) {
    return { id: null, api: null, error: `bundle did not evaluate: ${String((error && error.message) || error)}`, unwrapped: null };
  }
  const registration = sandbox.__registration;
  if (!registration || typeof registration !== "object") {
    return { id: null, api: null, error: "no window.__ModuleLoader__.load({...}) registration", unwrapped: null };
  }
  if (typeof registration.factory !== "function") {
    return { id: registration.id ?? null, api: null, error: "registration.factory is not a function", unwrapped: null };
  }
  let api;
  try {
    // Inside the context, so the fake require and the factory share one realm and one timeout.
    sandbox.__fakeRequire = (specifier) => makeStub(`require(${String(specifier)})`);
    vm.runInContext("__factoryResult = __registration.factory(__fakeRequire);", sandbox, {
      filename: `${bundleFile}#factory`,
      timeout: FACTORY_TIMEOUT_MS,
    });
    api = sandbox.__factoryResult;
  } catch (error) {
    return { id: registration.id ?? null, api: null, error: `factory threw: ${String((error && error.message) || error)}`, unwrapped: null };
  }
  return { id: registration.id, api, error: null, unwrapped: mirrorUnwrapExports(api) };
}

/**
 * The two assertions this module exists for, applied to one package.
 * @param {{name: string, dir: string, pkg: object, rel: string}} p
 * @param {{profileBundles: string[]}} options
 * @returns {Promise<{name: string, results: {name: string, pass: boolean, message: string}[], clientHalf: boolean}>}
 */
export async function checkPackageShape(p, options) {
  const profileBundles = (options && options.profileBundles) || [];
  const results = [];
  const add = (name, pass, message) => results.push({ name, pass, message });

  // ── host half: the loader activates this entry, so it must carry apply ────────────────────
  const hostRel = declaredHostEntry(p.pkg);
  if (hostRel === null) {
    add(`${p.name}: host entry`, false, `${p.name}/package.json declares neither "main" nor exports["."] — a bundle row needs a host entry that exports apply`);
  } else {
    const hostFile = path.join(p.dir, hostRel);
    if (!fs.existsSync(hostFile)) {
      add(`${p.name}: host apply`, false, `${p.name}/${pretty(hostRel)} does not exist, so no host apply can be loaded`);
    } else {
      try {
        const url = `${pathToFileURL(hostFile).href}?v=${fs.statSync(hostFile).mtimeMs}-${fs.statSync(hostFile).size}`;
        const mod = await import(url);
        add(
          `${p.name}: host apply`,
          typeof mod.apply === "function",
          `${p.name}/${pretty(hostRel)}: host half must export a function named apply (got ${typeof mod.apply}) — the loader refuses anything else with 'invalid plugin, expect function or object with an "apply" method, received ${typeof mod.apply}'`,
        );
      } catch (error) {
        add(`${p.name}: host apply`, false, `${p.name}/${pretty(hostRel)} could not be imported: ${String((error && error.message) || error)}`);
      }
    }
  }

  // ── client half: the factory's RETURN VALUE is the plugin object ──────────────────────────
  const clientRel = declaredClientBundle(p.pkg);
  const declaresClient = Boolean(p.pkg && p.pkg.dsh && p.pkg.dsh.client) || clientRel !== null;
  if (!declaresClient) {
    add(`${p.name}: client factory shape`, true, `${p.name}: no client half declared — nothing to execute (host-only bundle row)`);
    return { name: p.name, results, clientHalf: false };
  }
  if (clientRel === null) {
    add(
      `${p.name}: client factory shape`,
      false,
      `${p.name}/package.json declares dsh.client but no exports["./client"] target — the shell would expect a bundle that has no path`,
    );
    return { name: p.name, results, clientHalf: true };
  }
  const clientFile = path.join(p.dir, clientRel);
  if (!fs.existsSync(clientFile)) {
    add(`${p.name}: client factory shape`, false, `${p.name}/${pretty(clientRel)} does not exist — exports["./client"] is declared, so the shell will look for it`);
    return { name: p.name, results, clientHalf: true };
  }
  const run = executeClientFactory(clientFile);
  if (run.error !== null) {
    add(`${p.name}: client factory shape`, false, `${p.name}/${pretty(clientRel)}: ${run.error}`);
    return { name: p.name, results, clientHalf: true };
  }
  if (run.id !== p.name) {
    add(
      `${p.name}: client factory shape`,
      false,
      `${p.name}/${pretty(clientRel)} registers id ${JSON.stringify(run.id)} but the package is named ${JSON.stringify(p.name)} — the require() table is keyed by package name`,
    );
  }
  const api = run.unwrapped;
  add(
    `${p.name}: client exports.apply`,
    Boolean(api) && typeof api.apply === "function",
    `${p.name}/${pretty(clientRel)}: the factory return value must have typeof apply === "function" (got ${api === null || api === undefined ? String(api) : typeof api.apply}) — the shell hands this object to cordis, which throws 'invalid plugin, expect function or object with an "apply" method, received ${api === null ? String(api) : typeof api}'`,
  );
  add(
    `${p.name}: client exports.inject`,
    Boolean(api) && Array.isArray(api.inject),
    `${p.name}/${pretty(clientRel)}: the factory return value must have Array.isArray(inject) (got ${api === null || api === undefined ? "no exports" : Array.isArray(api.inject) ? "array" : typeof api.inject}) — cordis reads it with mo.resolve(e.inject)`,
  );
  return { name: p.name, results, clientHalf: true };
}

/**
 * Apply `checkPackageShape` to every bundle row under `root`.
 * @param {string} root repository root
 * @param {{profileBundles?: string[], offset?: number, extraRoots?: string[]}} [options]
 *   `extraRoots` are additional directories whose immediate subdirectories are local packages.
 *   They exist because `dsh-deepworker` moved out of this repo to `~/.dsh/plugins/`
 *   (2026-10-17): without them the sweep would silently stop covering it, and a sweep with a
 *   hole is unguarded by construction. A package is visited once even if it appears twice.
 * @returns {Promise<{checks: number, results: {name: string, pass: boolean, message: string}[], errors: string[], rows: string[], profile: object}>}
 */
export async function auditBundleRowShapes(root, options = {}) {
  const profile = options.profileBundles
    ? { ok: true, path: "(supplied)", bundles: options.profileBundles, error: null }
    : readProfileBundles();
  const results = [];
  const errors = [];
  const rows = [];
  let checks = options.offset || 0;
  const seen = new Set();
  const candidates = [];
  for (const dir of [root, ...(options.extraRoots || [])]) {
    if (typeof dir !== "string" || dir === "" || seen.has(dir)) continue;
    seen.add(dir);
    try {
      candidates.push(...listLocalPackages(dir));
    } catch {
      // A missing extra root must not be silently equivalent to "no more packages": that would
      // re-open the hole this option closes. The caller names a real directory or gets an error.
      if (dir !== root) errors.push(`extra root ${dir} cannot be read — the bundle-row sweep would silently skip it`);
    }
  }
  const visited = new Set();
  for (const p of candidates) {
    if (visited.has(p.dir)) continue;
    visited.add(p.dir);
    if (!isBundleRow(p.pkg, profile.bundles)) continue;
    rows.push(p.name);
    const outcome = await checkPackageShape(p, { profileBundles: profile.bundles });
    for (const result of outcome.results) {
      checks += 1;
      results.push(result);
      if (!result.pass) errors.push(`[${checks}] ${result.message}`);
    }
  }
  return { checks, results, errors, rows, profile };
}
