/**
 * dsh-combo-sim / verify/_temp_isolation_child.mjs
 *
 * One throwaway process that answers exactly one question: **which temp directory did THIS run
 * get, and can it write there?** It prints one JSON line and exits 0 only if every property it
 * can check by itself holds:
 *
 *   · `runFile()` produced a path inside its own `RUN_ROOT`,
 *   · `assertRunPath()` REFUSED a path outside it (the guard is armed, not decorative),
 *   · `RUN_ROOT` existed while the process was alive.
 *
 * Used by `verify_temp_isolation.mjs`, which spawns two of these at the same time and compares
 * the reported directories. `DSH_COMBO_ROUTE` points the child at a **mutated copy** of
 * lib/route.mjs — that is how the mutation ("put the fixed path back") is proved to go red.
 *
 * The leading underscore keeps `run_all.mjs` (an explicit suite list) from running it directly.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const override = process.env.DSH_COMBO_ROUTE;
const target = override ? pathToFileURL(override).href : new URL("../lib/route.mjs", import.meta.url).href;
const route = await import(target);

const file = route.runFile("isolation-probe.json");
fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));

const insideRunRoot = path.resolve(file).startsWith(path.resolve(route.RUN_ROOT) + path.sep);
let refusedOutside = false;
try {
  // The parent spawns this child with `cwd` = the repo root, which is never inside RUN_ROOT.
  route.assertRunPath(path.resolve(process.cwd(), "isolation-escape.json"));
} catch (error) {
  refusedOutside = true;
}
const alive = fs.existsSync(route.RUN_ROOT);

console.log(JSON.stringify({
  pid: process.pid,
  runRoot: route.RUN_ROOT,
  extractRoot: route.EXTRACT_ROOT,
  file,
  insideRunRoot,
  refusedOutside,
  alive,
}));

process.exit(insideRunRoot && refusedOutside && alive ? 0 : 1);
