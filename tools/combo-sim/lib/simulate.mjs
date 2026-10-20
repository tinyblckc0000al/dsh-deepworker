/**
 * dsh-combo-sim / lib/simulate.mjs
 *
 * Faithful re-implementation of the DSH **client module system** script-arrival
 * semantics, for offline diagnosis of "one bundle in a combo breaks the rest".
 *
 * Everything here mirrors observed shipped code (see README.md → 已核实事实 for the
 * file:line citations into app.asar). The parts copied verbatim in behaviour:
 *
 *   1. A combo is assembled by CONCATENATING the bundle sources:
 *        for (const resource of resources) source += `${prepareSource(resource).source};\n`;
 *      (@deepseek-ai/dsh-client-modules/lib/index.js:330-334 buildComboScript)
 *   2. The combo is delivered to the page as ONE same-origin **classic** <script>:
 *        const el = document.createElement("script"); el.src = url; document.head.append(el);
 *      (…/dsh-client-modules/lib/client.js:450-464 defaultLoadBundle)
 *      ⇒ all bundles in one combo share ONE global lexical scope (classic script
 *        semantics: top-level `let`/`const`/`class` land in the shared global
 *        lexical environment, `var`/`function` on the shared global object).
 *   3. `arrive()` retry/fallback order, `failedBundleUrls`, `executedBundleUrls`,
 *      `register()` duplicate rejection, `materialize()` memoization, and
 *      `recordingImportError` are ported from
 *      …/dsh-client-modules/lib/client.js:568-783.
 *
 * No network, no browser, no writes outside the paths given in `scriptPaths`.
 */

import vm from "node:vm";
import crypto from "node:crypto";

/** Mirror of `prepareSource` (…/dsh-client-modules/lib/index.js:253-264). */
const SOURCE_URL_TRAILER = /\/\/# sourceURL=([^\n]*)\s*$/;
const SOURCE_MAP_TRAILER = /\/\/# sourceMappingURL=([^\n]*)\s*$/;

/**
 * An inert stand-in for a module that is neither a platform seed nor a registered
 * row. Used only by `allowUnknownLibraries` probes; every property access returns
 * another inert callable, so a factory body can run to its `exports.apply = …`
 * tail without a real React. Behaviour is NOT modelled.
 */
function makeInertStub(spec, cache = new Map()) {
  if (cache.has(spec)) return cache.get(spec);
  const target = function inert() {};
  const stub = new Proxy(target, {
    get(_t, prop) {
      if (prop === "__spec") return spec;
      if (prop === Symbol.toPrimitive || prop === "toString") return () => `[inert ${String(spec)}]`;
      if (prop === "then") return undefined;
      return makeInertStub(`${String(spec)}.${String(prop)}`, cache);
    },
    apply() {
      return makeInertStub(`${String(spec)}()`, cache);
    },
    construct() {
      return makeInertStub(`new ${String(spec)}()`, cache);
    },
    has() {
      return true;
    },
  });
  cache.set(spec, stub);
  return stub;
}

export function prepareSource(text) {
  let source = text;
  const sourceUrl = SOURCE_URL_TRAILER.exec(source)?.[1];
  source = source.replace(SOURCE_URL_TRAILER, "").replace(SOURCE_MAP_TRAILER, "");
  if (!source.endsWith("\n")) source += "\n";
  const fallbackSource =
    sourceUrl === undefined
      ? null
      : /^(?:[A-Za-z][A-Za-z\d+.-]*:|\/)/.test(sourceUrl)
        ? sourceUrl
        : `/${sourceUrl}`;
  return { source, fallbackSource };
}

/** Mirror of `buildComboScript` (…/dsh-client-modules/lib/index.js:329-334). */
export function concatCombo(bundles) {
  let source = "";
  for (const b of bundles) source += `${prepareSource(b.text).source};\n`;
  return source;
}

export function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/**
 * Model of the real Loader's entry identity vs the id a bundle registers.
 *
 * Observed on disk (all 71 extracted bundles):
 *   registered id            manifest / entry id
 *   ------------------------ ---------------------
 *   "@deepseek-ai/dsh-client-ui-layout"    "dsh-client-ui-layout"
 *   "dsh-deepworker"                  "dsh-deepworker"
 * The shipped `stripClientSuffix` only removes a trailing "/client", so the two
 * spellings are distinct strings; only a row whose registered id already equals
 * the bare id is found by `factories.has(id)`. That asymmetry is modelled here so
 * the simulator reproduces the real ratio of batch hits to per-row fallbacks.
 * (Merging the two spellings is a deliberate simplification: it preserves the
 * "was this row registered" question, which is what decide fiber-vs-no-fiber.)
 */
const nameOf = (id) => (id.startsWith("@deepseek-ai/") ? id.slice("@deepseek-ai/".length) : id);

/**
 * A `window.__ModuleLoader__`-compatible registration sink, matching the target
 * the HTML facade installs (…/dsh-client-modules/lib/client.js:559-566, 568-581).
 */
class RegistrationSink {
  constructor() {
    this.registrations = [];
    this.duplicates = [];
    /** How many of `registrations` a loadShared() completion has already drained. */
    this.drained = 0;
  }
  load(registration) {
    this.registrations.push(registration);
    return undefined;
  }
}

/**
 * Ported subset of ClientModuleSystem (…/dsh-client-modules/lib/client.js:506-840),
 * reduced to the arrival/materialization paths that decide "did this entry get a
 * fiber". The cordis Loader half is NOT modelled; a row either materializes or it
 * does not.
 */
export class ComboSimulator {
  constructor({ libraries = {}, loadBundle, verbose = false, allowUnknownLibraries = false } = {}) {
    this.factories = new Map();
    this.loadCache = new Map();
    this.importErrors = new Map();
    this.failedBundleUrls = new Set();
    this.executedBundleUrls = new Set();
    this.pendingArrival = new Map();
    this.materializing = new Set();
    this.sink = new RegistrationSink();
    this.transportLog = [];
    this.scriptErrors = [];
    this.executions = [];
    this.verbose = verbose;
    this.libraries = libraries;
    this.allowUnknownLibraries = allowUnknownLibraries;
    this.unknownLibrariesRequested = new Set();
    this.scriptPaths = [];
    this.loadBundle = loadBundle ?? ((url) => this.defaultLoadBundle(url));
  }

  /** Register every script path this simulator is allowed to read from. */
  allowScriptPaths(paths) {
    this.scriptPaths = [...paths];
  }

  /**
   * Mirror of defaultLoadBundle (…/client.js:450-464): a classic script. In the
   * browser this is a shared global lexical scope; here it is one vm context per
   * *batch execution*, reused for every script so that cross-script declaration
   * collisions behave exactly like the browser's.
   */
  constructorContext(label) {
    const sandbox = {
      console: {
        log: (...a) => this.verbose && console.log(`[${label}]`, ...a),
        warn: (...a) => this.verbose && console.warn(`[${label}]`, ...a),
        error: () => {},
        info: () => {},
      },
      window: null,
      document: {
        createElement: () => ({ style: {}, append() {}, remove() {}, addEventListener() {}, setAttribute() {} }),
        head: { append() {} },
        body: { append() {} },
      },
      setTimeout,
      clearTimeout,
      Promise,
      __DSH_BOOT__: undefined,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.__ModuleLoader__ = this.sink;
    // DSH plugin bundles are generated as classic scripts whose first statement
    // is the bare global `_ModuleLoader__.load({...})` (see every extracted
    // lib/client.js line 1), so the bare name must resolve. In the browser a bare
    // identifier does NOT find a `window.<name>` property through the object
    // environment record, so the HTML facade must install it as a real global —
    // we model the effect (an own property of globalThis) rather than its source.
    sandbox._ModuleLoader__ = this.sink;
    sandbox.require = undefined;
    return vm.createContext(sandbox, { name: label });
  }

  /**
   * Execute one classic script (a combo or a single bundle) in `context`.
   * Returns an explicit outcome instead of throwing, because the browser treats a
   * parse/execution failure as "this script registered nothing".
   */
  executeScript(url, code, context) {
    const record = { url, ok: false, kind: null, error: null };
    let script;
    try {
      script = new vm.Script(code, { filename: url });
    } catch (error) {
      record.kind = "parse-error";
      record.error = { name: error?.name, message: error?.message };
      this.scriptErrors.push({ url, ...record });
      return record;
    }
    try {
      script.runInContext(context);
      record.ok = true;
      record.kind = "executed";
    } catch (error) {
      record.kind = "execution-error";
      record.error = { name: error?.name, message: error?.message };
      this.scriptErrors.push({ url, ...record });
      return record;
    }
    return record;
  }

  /**
   * Transport for one URL. `url` is opaque; the caller (route.mjs) maps it to a
   * body. A body of `null` models an HTTP error (nothing executed).
   */
  defaultLoadBundle(url) {
    const body = this.transport.get(url);
    this.transportLog.push(url);
    if (body === undefined) {
      return Promise.reject(new Error(`client-modules: bundle script ${url} failed to load`));
    }
    const record = this.executeScript(url, body, this.context);
    this.executions.push(record);
    if (!record.ok) {
      return Promise.reject(
        new Error(
          `client-modules: bundle script ${url} failed to load` +
            (record.kind === "parse-error"
              ? ` (SyntaxError: ${record.error.message})`
              : ` (threw during execution: ${record.error.name}: ${record.error.message})`),
        ),
      );
    }
    return Promise.resolve();
  }

  /** Attach the transport table (url → script text) and the shared vm context. */
  attachTransport(transport, contextLabel = "combo") {
    this.transport = transport;
    this.context = this.constructorContext(contextLabel);
  }

  /** Ported from ClientModuleSystem.register (…/client.js:568-581). */
  register(registration) {
    if (typeof registration !== "object" || registration === null)
      throw new Error("client-modules: __ModuleLoader__.load requires a registration object");
    if (typeof registration.id !== "string" || registration.id.length === 0)
      throw new Error("client-modules: registration.id must be a non-empty string");
    const rawId = registration.id;
    const id = nameOf(rawId);
    if (this.factories.has(id)) {
      const error = new Error(
        `client-modules: duplicate factory registration for "${rawId}" (bundle executed twice without invalidate?)`,
      );
      this.sink.duplicates.push({ id: rawId, error });
      throw error;
    }
    this.factories.set(id, { factory: registration.factory, rawId, rev: registration.rev });
  }

  /**
   * Drain every registration a script produced into the live factory table.
   * Single drain point, called by {@link ComboSimulator.loadShared} after the
   * script has executed — mirroring the shipped `loadShared`, where the facade's
   * live `load` is `register` (…/client.js:562-566, 582-594).
   */
  drainRegistrations(url) {
    const fresh = this.sink.registrations.slice(this.sink.drained);
    this.sink.drained = this.sink.registrations.length;
    for (const registration of fresh) {
      try {
        this.register(registration);
      } catch (error) {
        this.scriptErrors.push({ url, kind: "duplicate-registration", error: { name: error.name, message: error.message } });
      }
    }
    return fresh.length;
  }

  /** Ported from loadShared (…/client.js:582-594). */
  loadShared(url) {
    let transport = this.pendingArrival.get(url);
    if (transport === undefined) {
      transport = this.loadBundle(url)
        .then(() => {
          this.executedBundleUrls.add(url);
          this.drainRegistrations(url);
        })
        .finally(() => this.pendingArrival.delete(url));
      this.pendingArrival.set(url, transport);
    }
    return transport;
  }

  /**
   * Ported from arrive (…/client.js:610-642) including the exact failure strings:
   *   `${url}: ${message}` … `${preferred}: skipped after an earlier failure of this bundle`
   *   `${url}: loaded without registering "${id}" via __ModuleLoader__.load`
   *   `client-modules: could not load "${id}": ${failures.join("; ")}`
   */
  async arrive(row) {
    const id = nameOf(row.id);
    if (this.loadCache.has(id) || this.factories.has(id)) return { id, outcome: "registered", via: "already-registered" };
    const preferred = row.initialUrl;
    const fallback = row.url !== preferred ? row.url : undefined;
    const failures = [];
    const attempt = async (url) => {
      try {
        await this.loadShared(url);
      } catch (error) {
        failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
        return "transport-failed";
      }
      if (this.factories.has(id)) return "registered";
      failures.push(`${url}: loaded without registering "${id}" via __ModuleLoader__.load`);
      return "not-registered";
    };
    let outcome = "transport-failed";
    if (this.failedBundleUrls.has(preferred)) {
      failures.push(`${preferred}: skipped after an earlier failure of this bundle`);
    } else if (fallback !== undefined && this.executedBundleUrls.has(preferred)) {
      failures.push(`${preferred}: already executed without registering "${id}"`);
      outcome = "not-registered";
      this.failedBundleUrls.add(preferred);
    } else {
      outcome = await attempt(preferred);
      if (outcome === "transport-failed") outcome = await attempt(preferred);
      if (outcome !== "registered" && fallback !== undefined) this.failedBundleUrls.add(preferred);
    }
    if (outcome !== "registered" && fallback !== undefined) outcome = await attempt(fallback);
    if (outcome !== "registered") {
      const error = new Error(`client-modules: could not load "${id}": ${failures.join("; ")}`);
      this.importErrors.set(id, error);
      return { id, outcome: "not-registered", error, failures };
    }
    this.importErrors.delete(id);
    return { id, outcome: "registered" };
  }

  /** Ported from materialize (…/client.js:670-695) minus style ownership. */
  materialize(id) {
    const existing = this.loadCache.get(id);
    if (existing !== undefined) return existing;
    const registered = this.factories.get(id);
    if (registered === undefined) throw new Error(`client-modules: no registered factory for "${id}"`);
    if (this.materializing.has(id))
      throw new Error(`client-modules: require cycle through "${id}" (factory-form CJS cannot deliver partial exports)`);
    this.materializing.add(id);
    try {
      const edges = new Set();
      const record = { id, exports: registered.factory(this.makeRequire(id, edges)), edges };
      this.loadCache.set(id, record);
      return record;
    } finally {
      this.materializing.delete(id);
    }
  }

  /** Ported from makeRequire (…/client.js:696-715), static-seed branch first. */
  makeRequire(ownerId, edges) {
    const require = (spec) => {
      edges.add(spec);
      if (Object.hasOwn(this.libraries, spec)) return this.libraries[spec];
      if (this.allowUnknownLibraries) {
        // The real page seeds exactly PLATFORM_MODULES (see README → 已核实事实 3):
        //   react, react/jsx-runtime, react-dom, react-dom/client,
        //   @deepseek-ai/cordis, @deepseek-ai/dsh-client-store,
        //   @deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-primitives,
        //   @deepseek-ai/dsh-client-ui-dockkit
        // Everything else a bundle requires must come from another registered row.
        // This off-by-default flag substitutes inert stubs so that "does the factory
        // body run at all" can be probed without shipping React. It is NOT a
        // faithful model of missing-package errors.
        this.unknownLibrariesRequested.add(spec);
        return makeInertStub(spec);
      }
      const record = this.loadCache.get(spec);
      if (record !== undefined) return record.exports;
      if (this.factories.has(spec)) return this.materialize(spec).exports;
      throw new Error(
        `client-modules: require("${spec}") missed the module table — not a platform seed word, not a materialized module, and no registered package factory`,
      );
    };
    require.async = async (spec) => {
      edges.add(spec);
      throw new Error(`combo-sim: require.async("${spec}") is out of scope for the arrival simulator`);
    };
    return require;
  }

  /**
   * The whole boot arrival pass for one manifest: rows are visited in manifest
   * order, each arriving its own URL (shared batches dedupe through
   * pendingArrival, exactly like the page).
   */
  async boot(manifest) {
    const results = [];
    for (const row of manifest.modules) {
      try {
        results.push(await this.arrive(row));
      } catch (error) {
        results.push({ id: row.id, outcome: "threw", error });
      }
    }
    return results;
  }

  /**
   * The audit the shipped shell actually runs
   * (index-5SrrfWpU.js: `eM` → `n.importError(a)`), reproduced verbatim so the
   * simulator says what the App would say.
   */
  bootAudit(entryNames) {
    const lines = [];
    for (const entryName of entryNames) {
      const name = nameOf(entryName);
      if (!this.factories.has(name) && !this.loadCache.has(name)) {
        const importError = this.importErrors.get(name);
        lines.push(
          importError === undefined
            ? `${name}: import failed (see console for the import error)`
            : `${name}: import failed: ${importError.message}`,
        );
        continue;
      }
      // A registered factory still has to survive materialization and expose a
      // callable `apply` (cordis: "expect function or object with an apply
      // method"); a throw here is the other way an entry ends up without a fiber.
      try {
        const exports = this.materialize(name).exports;
        const apply = exports?.apply ?? exports?.default?.apply;
        if (typeof apply !== "function") {
          lines.push(`${name}: failed (exports.apply is ${apply === undefined ? "missing" : typeof apply})`);
          continue;
        }
      } catch (error) {
        lines.push(`${name}: failed (factory threw: ${error.name}: ${error.message})`);
        continue;
      }
      lines.push(`${name}: active`);
    }
    const failed = lines.filter((l) => !l.endsWith(": active"));
    return {
      lines,
      failed,
      thrown:
        failed.length === 0
          ? null
          : new Error(`web boot: ${String(failed.length)} entr${failed.length === 1 ? "y" : "ies"} did not activate\n${failed.join("\n")}`),
    };
  }

  /** Factory/apply-type report for one row id (materialize once, capture the error). */
  inspectFactory(rowId, { callFactory = true } = {}) {
    const id = nameOf(rowId);
    const registered = this.factories.get(id);
    if (registered === undefined) {
      return { id, registered: false, reason: "no factory registered", factoryType: null, applyType: null, exportsKeys: [] };
    }
    if (typeof registered.factory !== "function")
      return { id, registered: true, reason: "registration.factory is not a function", factoryType: typeof registered.factory, applyType: null, exportsKeys: [] };
    const report = { id, registered: true, factoryType: "function", reason: null, factoryError: null, applyType: null, applyKind: null, exportsKeys: [] };
    if (!callFactory) return report;
    let exports;
    try {
      exports = this.materialize(id).exports;
    } catch (error) {
      report.reason = `factory threw: ${error.name}: ${error.message}`;
      report.factoryError = { name: error.name, message: error.message };
      return report;
    }
    report.exportsKeys = exports && typeof exports === "object" ? Object.keys(exports) : [];
    const apply = exports?.apply ?? exports?.default?.apply;
    report.applyType = typeof apply;
    report.applyKind =
      typeof apply === "function" ? "function" : apply === undefined ? "missing" : `not-callable (${typeof apply})`;
    if (typeof apply !== "function") report.reason = `exports.apply is ${report.applyKind}`;
    return report;
  }
}
