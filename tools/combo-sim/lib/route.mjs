/**
 * dsh-combo-sim / lib/route.mjs
 *
 * Rebuilds the *real* combo partitioning for this machine's desktop profile and
 * provides the url → script-body transport a ComboSimulator needs.
 *
 * What is reconstructed (all constants and formulae are read off the shipped
 * implementation, not guessed):
 *   - combo URL:            /plugins/??<id>/client.js,<id>/client.js&rev=<rev>
 *                           (…/dsh-client-modules/lib/index.js:203-208, 216-218)
 *   - partition limit:      MAX_COMBO_URL_BYTES = 3 * 1024  (…/index.js:161-163, 231-252)
 *                           projected bytes = len("/plugins/??") + Σ(len(id)+len("/client.js")) + (n-1) + len(".map") + len("&rev="+64 hex)
 *   - concat body:          each bundle prepared (sourceURL/sourceMappingURL trailers
 *                           stripped, newline ensured) then joined with ";\n"
 *                           (…/index.js:253-264, 329-334)
 *   - single-row URL:       comboReference([id], rev) — the documented per-row fallback
 *                           (…/index.js:216-218, 670-679; used by client arrive() at
 *                           …/dsh-client-modules/lib/client.js:615, 639)
 *
 * What is NOT reconstructable from disk (recorded as a limitation, see README):
 *   - the exact scan order of the live Loader table. It is approximated by the
 *     mount order of the `insert:` rows in the shipped cordis.patch.yml files,
 *     base first, then web-app, then the profile's own `dsh.profile.bundles`
 *     third-party rows in array order. Any error in this order can only move a
 *     row between adjacent batches; the failure semantics under test depend on
 *     *which rows share a batch*, which is reported explicitly.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { concatCombo, prepareSource, sha256 } from "./simulate.mjs";


/**
 * GROUND TRUTH: combo lists recovered verbatim from the App's own crash logs.
 *
 * `crash-*-web-boot.log` records the renderer console, and for some crashes that
 * console contains the *combo URL itself* (from `[cordis-client-runner]` error
 * lines that carry the page URL). Those URLs are the only on-disk record of the
 * real partition, i.e. of which bundles shared one script. They are read here
 * rather than reconstructed.
 */
export const CRASH_LOG_DIR = path.join(os.homedir(), "Library/Logs/DeepSeek Harness");

export function loadRealCombos() {
  if (!fs.existsSync(CRASH_LOG_DIR)) return [];
  const found = [];
  const seen = new Set();
  for (const name of fs.readdirSync(CRASH_LOG_DIR).sort()) {
    if (!name.startsWith("crash-") || !name.endsWith("-web-boot.log")) continue;
    const file = path.join(CRASH_LOG_DIR, name);
    const text = fs.readFileSync(file, "utf8");
    const re = /dsh-app:\/\/app\/plugins\/\?\?([^:\s]+)&rev=([0-9a-f]+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const ids = m[1].split(",").map((s) => s.replace(/\/client\.js$/, ""));
      const key = `${m[2]}::${ids.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        crashLog: file,
        crashLogName: name,
        rev: m[2],
        ids,
        rows: ids.length,
        // byte cost of the exact URL as it appeared (the real protocol-limit budget)
        urlBytes: Buffer.byteLength(`plugins/??${m[1]}&rev=${m[2]}`),
        projectionWithThisUrl: projectedComboUrlBytes(ids),
      });
    }
  }
  return found;
}

/**
 * Swap a model's batch list for ground-truth batches recovered from crash logs.
 * `model.byId` must already contain every id in those batches; ids that no
 * extraction covers are reported instead of being silently dropped.
 */
export function applyRealCombos(model, combos) {
  const missing = new Set();
  const batches = [];
  for (const combo of combos) {
    for (const id of combo.ids) if (!model.byId.has(id)) missing.add(id);
    batches.push({
      index: batches.length,
      phase: "application",
      ids: combo.ids,
      rev: combo.rev,
      url: `plugins/??${combo.ids.map((id) => `${id}/client.js`).join(",")}&rev=${combo.rev}`,
      source: `crash-log:${combo.crashLogName}`,
      urlBytes: combo.urlBytes,
    });
  }
  const batchOf = new Map();
  for (const batch of batches) for (const id of batch.ids) batchOf.set(id, batch);
  return { ...model, batches, batchOf, realCombos: combos, realCombosMissingExtraction: [...missing] };
}

/**
 * TWO temp roots, because they answer two different questions.
 *
 *   RUN_ROOT     — THIS run's private scratch directory: `fs.mkdtempSync` (pid + 6 random
 *                  chars) at import time, **removed on exit**. Everything a suite WRITES
 *                  lives here, and `assertRunPath()` refuses anything else.
 *   EXTRACT_ROOT — the stable extraction CACHE produced once by `tools/extract-asar.mjs`
 *                  (official bundle bytes + manifest). Suites only ever READ it.
 *
 * Why the split exists (measured 2026-10-17, before the change): with ONE fixed
 * /tmp/dsh-combo-extract every run shared every write path. A reader polling the report
 * while three concurrent runs overlapped saw the file **empty** 6 times in 68,536 reads —
 * `fs.writeFileSync` truncates first, so a concurrent suite can read a half-written or empty
 * artifact. Nothing in this repo happened to read those files back, so the collision did not
 * reach a verdict (9 concurrent runs × 3 all stayed green, which is why the fake-red was
 * rare and looked random); a per-run directory makes the class structurally impossible.
 *
 * ⚠️ Do NOT reintroduce a fixed write path here, and do NOT derive one from `process.pid`
 * alone: two suites inside ONE process would reuse it. `newRunDir()` calls mkdtemp every
 * time, so even repeated calls in the same process get DIFFERENT directories.
 */
export const EXTRACT_ROOT = process.env.DSH_COMBO_EXTRACT_ROOT || "/tmp/dsh-combo-extract";
export const RUN_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), `dsh-combo-run-${process.pid}-`));
export const OFFICIAL_ROOT = path.join(EXTRACT_ROOT, "official");
export const OFFICIAL_MANIFEST = path.join(EXTRACT_ROOT, "official-manifest.json");
export const PROFILE_PACKAGE = path.join(os.homedir(), ".dsh/profiles/desktop/package.json");

/** `DSH_COMBO_KEEP=1` keeps this run's directory (reports are otherwise deleted on exit). */
const KEEP_RUN_ROOT = process.env.DSH_COMBO_KEEP === "1";

/** Best-effort removal of this run's directory. Never throws: it runs on the way out. */
export function removeRunRoot() {
  if (KEEP_RUN_ROOT) return false;
  try {
    fs.rmSync(RUN_ROOT, { recursive: true, force: true });
    return true;
  } catch (error) {
    return false;
  }
}

process.on("exit", removeRunRoot);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    removeRunRoot();
    process.exit(130);
  });
}

/** macOS: os.tmpdir() is /var/folders/… whose realpath is /private/var/folders/… */
function canonicalPath(candidate) {
  const resolved = path.resolve(candidate);
  let existing = resolved;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  return path.join(fs.realpathSync(existing), path.relative(existing, resolved));
}

function isUnder(child, root) {
  const c = canonicalPath(child);
  const r = canonicalPath(root);
  return c === r || c.startsWith(r + path.sep);
}

/**
 * Every path a suite **writes** must live under THIS run's directory.
 * The rule is not style: fixtures/reports under one shared path let two concurrent runs
 * truncate each other's files (see the RUN_ROOT note above).
 * @param {string} candidate absolute path
 * @returns {string} the resolved path, for use in an expression
 */
export function assertRunPath(candidate) {
  const resolved = path.resolve(candidate);
  if (!isUnder(resolved, RUN_ROOT)) {
    throw new Error(`combo-sim: refusing to write outside this run's temp dir ${RUN_ROOT}: ${resolved}`);
  }
  return resolved;
}

/**
 * Read-only inputs (the extraction cache) also have to be temp, but need not belong to this
 * run. Used for reads of `OFFICIAL_ROOT`; **writes** go through `assertRunPath`/`runFile`.
 */
export function assertTempPath(candidate) {
  const resolved = path.resolve(candidate);
  if (!isUnder(resolved, RUN_ROOT) && !isUnder(resolved, EXTRACT_ROOT)) {
    throw new Error(`combo-sim: refusing to touch non-temp path ${resolved} (allowed roots: ${RUN_ROOT}, ${EXTRACT_ROOT})`);
  }
  return resolved;
}

/** Path of an artifact this run owns. Idempotent (RUN_ROOT is created once). */
export function runFile(name) {
  fs.mkdirSync(RUN_ROOT, { recursive: true });
  return assertRunPath(path.join(RUN_ROOT, name));
}

/** A FRESH sub-directory of this run: mkdtemp ⇒ unique even for repeated calls in one process. */
export function newRunDir(prefix = "dir") {
  fs.mkdirSync(RUN_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(RUN_ROOT, `${prefix}-`));
}

/** Constants copied from @deepseek-ai/dsh-client-modules/lib/index.js:161-163. */
export const MAX_COMBO_URL_BYTES = 3 * 1024;
export const HASH_REVISION_LENGTH = 12; // …/dsh-client-modules/lib/index.js:162
/** `comboReference` strips the leading slash of `/plugins`. */
const PLUGIN_ROUTE = "plugins";

/** Literal port of `comboReference(ids, rev, sourceMap)` (…/index.js:203-218). */
export function comboReference(ids, rev, sourceMap = false) {
  const search = `??${ids.map((id) => `${id}/client.js${sourceMap ? ".map" : ""}`).join(",")}&rev=${rev}`;
  return `${PLUGIN_ROUTE}/${search}`;
}

/** Literal port of `projectedComboUrlBytes` (…/index.js:231-234). */
export function projectedComboUrlBytes(ids) {
  return Buffer.byteLength(comboReference(ids, "0".repeat(HASH_REVISION_LENGTH), true));
}

/** Literal port of `partitionComboRecords` (…/index.js:235-252). */
export function partitionIds(ids) {
  const chunks = [];
  let current = [];
  for (const id of ids) {
    const candidate = [...current, id];
    if (projectedComboUrlBytes(candidate) <= MAX_COMBO_URL_BYTES) {
      current = candidate;
      continue;
    }
    if (current.length === 0) throw new Error(`combo-sim: ${id} exceeds the combo URL limit`);
    chunks.push(current);
    current = [id];
    if (projectedComboUrlBytes(current) > MAX_COMBO_URL_BYTES) throw new Error(`combo-sim: ${id} exceeds the combo URL limit`);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Stable pseudo-rev for an offline row. The shipped revisions are sha1 truncated
 * to 12 hex chars (`shortHash`/`framedHash`, …/index.js:183-190); the exact value
 * is irrelevant to arrival semantics, only its stability and width are.
 */
export function revOf(text) {
  return createHash("sha1").update(text).digest("hex").slice(0, HASH_REVISION_LENGTH);
}

function readPatchMountOrder(yamlPath) {
  const text = fs.readFileSync(yamlPath, "utf8");
  const insertAt = text.indexOf("- insert:");
  const body = insertAt === -1 ? text : text.slice(insertAt);
  const out = [];
  const seen = new Set();
  for (const m of body.matchAll(/name:\s*'@deepseek-ai\/([a-z0-9-]+)'/g)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

/** The extracted official bundles, keyed by package name. */
export function loadOfficialBundles() {
  const manifest = JSON.parse(fs.readFileSync(OFFICIAL_MANIFEST, "utf8"));
  const bundles = new Map();
  for (const row of manifest.files) {
    const file = path.join(OFFICIAL_ROOT, row.pkg, "lib/client.js");
    assertTempPath(file);
    const text = fs.readFileSync(file, "utf8");
    const actual = sha256(text);
    if (actual !== row.sha256) throw new Error(`combo-sim: extracted bundle ${row.pkg} changed since extraction (sha mismatch)`);
    bundles.set(row.pkg, { pkg: row.pkg, text, sha256: actual, bytes: row.bytes, source: "app.asar" });
  }
  return bundles;
}

/**
 * Third-party rows from the profile: read-only, resolves each package's
 * `exports["./client"].default` relative to the package directory.
 */
export function loadProfileRows() {
  const pkg = JSON.parse(fs.readFileSync(PROFILE_PACKAGE, "utf8"));
  const rows = [];
  const skipped = [];
  for (const name of pkg?.dsh?.profile?.bundles ?? []) {
    const spec = pkg.dependencies?.[name];
    if (spec === undefined || !spec.startsWith("link:")) {
      skipped.push({ pkg: name, reason: "not a link: dependency (shipped package)" });
      continue;
    }
    const dir = spec.slice("link:".length);
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    } catch (error) {
      skipped.push({ pkg: name, reason: `package.json unreadable: ${error.message}` });
      continue;
    }
    const clientDecl = manifest.dsh?.client;
    if (clientDecl === undefined || clientDecl.platform !== "web") {
      skipped.push({ pkg: name, reason: "no dsh.client platform:web declaration" });
      continue;
    }
    const clientExport = manifest.exports?.["./client"];
    const rel = typeof clientExport === "string" ? clientExport : clientExport?.default;
    if (typeof rel !== "string") {
      skipped.push({ pkg: name, reason: 'dsh.client declared but exports["./client"] missing' });
      continue;
    }
    const file = path.join(dir, rel);
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      skipped.push({ pkg: name, reason: `client bundle unreadable (${file}): ${error.message}` });
      continue;
    }
    rows.push({
      pkg: name,
      id: name,
      text,
      sha256: sha256(text),
      bytes: Buffer.byteLength(text),
      source: "profile-link",
      path: file,
      inject: clientDecl.inject ?? [],
    });
  }
  return { rows, skipped };
}

/** Detect the bundle id a script registers (mirrors register()'s owner id). */
export function registeredIdOf(text) {
  const m = /^\s*_?window\.?__ModuleLoader__\.load\(\{\s*\n?\s*id:\s*"([^"]+)"/.exec(text) ??
    /id:\s*"([^"]+)"/.exec(text);
  return m?.[1] ?? null;
}

/**
 * Build the boot table in the approximated scan order and partition it.
 * Returned rows carry everything needed to synthesize the real combo.
 */
export function buildComboModel({ extras = [] } = {}) {
  const basePatch = "/tmp/asar-x/x/dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml";
  const webPatch = "/tmp/asar-x/x/dsh/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml";
  const missingPatches = [basePatch, webPatch].filter((p) => !fs.existsSync(p));

  const mountOrder = [
    ...readPatchMountOrder(basePatch),
    ...readPatchMountOrder(webPatch),
  ];
  const official = loadOfficialBundles();
  const { rows: profileRows, skipped } = loadProfileRows();

  // Official rows in mount order (only packages that ship a client bundle appear
  // in the module graph), then profile-contributed rows in bundles[] order.
  const ordered = [];
  const claimed = new Set();
  for (const name of mountOrder) {
    if (official.has(name) && !claimed.has(name)) {
      // The Loader's entry id IS the package name, so official rows carry the scope
      // and the combo URL says `??@deepseek-ai/<pkg>/client.js` — exactly as the
      // crash log's console line shows. Profile-contributed packages are unscoped.
      const id = `@deepseek-ai/${name}`;
      claimed.add(name);
      ordered.push({ id, pkg: name, ...official.get(name), kind: "official" });
    }
  }
  const officialNotMounted = [...official.keys()].filter((k) => !claimed.has(k));

  for (const row of profileRows) {
    if (!claimed.has(row.id)) {
      claimed.add(row.id);
      ordered.push({ id: row.id, ...row, kind: "profile" });
    }
  }
  for (const extra of extras) {
    if (!claimed.has(extra.id)) {
      claimed.add(extra.id);
      ordered.push({ ...extra });
    }
  }

  const byId = new Map(ordered.map((r) => [r.id, r]));
  const ids = ordered.map((r) => r.id);
  const batches = partitionIds(ids).map((chunk, index) => {
    const rev = revOf(JSON.stringify(chunk.map((id) => [id, revOf(byId.get(id).text)])));
    return { index, phase: "application", ids: chunk, rev, url: comboReference(chunk, rev) };
  });
  const batchOf = new Map();
  for (const batch of batches) for (const id of batch.ids) batchOf.set(id, batch);

  return {
    ordered,
    byId,
    batches,
    batchOf,
    skipped,
    missingPatches,
    mountOrderCount: mountOrder.length,
    officialNotMounted,
    limitations: [
      "loader table scan order approximated by cordis.patch.yml insert-row order + profile bundles[] order",
      ...(missingPatches.length ? [`missing patch files: ${missingPatches.join(", ")}`] : []),
      ...(officialNotMounted.length ? [`official client packages not referenced by any mount order: ${officialNotMounted.join(", ")}`] : []),
    ],
  };
}

/**
 * Canonical body for one row served on its own one-resource combo URL.
 *
 * The host builds a single-row combo as `buildCombo([record])`, whose
 * `buildComboScript` runs `prepareSource` on that one bundle and appends ";\n"
 * (…/dsh-client-modules/lib/index.js:329-334). The bytes — and therefore the
 * revision — of a row's own URL differ from the bytes it has inside a batch.
 */
export function rowBody(text) {
  return `${prepareSource(text).source};\n`;
}

/** Stable per-row revision: hash of the exact bytes the row's own URL serves. */
export function rowRev(text) {
  return revOf(rowBody(text));
}

/**
 * Build the transport table (url → script text) for a combo model, optionally
 * replacing one row's bytes (the controlled experiment's independent variable).
 *
 * Every url in the returned map is a url the shipped host would serve:
 *   - one batch url per partition, body = all rows concatenated in order
 *   - one single-row url per row, body = that row alone
 */
export function buildTransport(model, { replace = new Map() } = {}) {
  const transport = new Map();
  const detail = [];
  const singleUrlByRow = new Map();
  for (const batch of model.batches) {
    const resources = batch.ids.map((id) => {
      const row = model.byId.get(id);
      if (!row) throw new Error(`combo-sim: no bundle for id ${id}`);
      const text = replace.has(id) ? replace.get(id).text : row.text;
      return { id, text };
    });
    const body = concatCombo(resources);
    transport.set(batch.url, body);
    detail.push({
      kind: "batch",
      url: batch.url,
      ids: batch.ids,
      bytes: Buffer.byteLength(body),
      replaced: batch.ids.filter((id) => replace.has(id)),
    });
    for (const resource of resources) {
      const url = comboReference([resource.id], rowRev(resource.text));
      singleUrlByRow.set(resource.id, url);
      if (!transport.has(url)) {
        const singleBody = rowBody(resource.text);
        transport.set(url, singleBody);
        detail.push({ kind: "single", url, ids: [resource.id], bytes: Buffer.byteLength(singleBody) });
      }
    }
  }
  return { transport, detail, singleUrlByRow };
}

/** Where our three plugins land, for the report. */
export function describeBatching(model) {
  const out = [];
  for (const batch of model.batches) {
    const interesting = batch.ids.filter((id) => id.startsWith("dsh-deepworker") || id.startsWith("dsh-history-actions") || id.startsWith("dsh-rewind") || id.startsWith("dsh-focus-lock"));
    if (interesting.length) {
      out.push({
        index: batch.index,
        size: batch.ids.length,
        startsWith: batch.ids[0],
        endsWith: batch.ids[batch.ids.length - 1],
        interesting,
        url: batch.url,
        projectedBytes: projectedComboUrlBytes(batch.ids),
      });
    }
  }
  return out;
}
