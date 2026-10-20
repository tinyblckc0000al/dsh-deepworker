// Focus-lock control for the AGENT (and for anyone at a shell).
//
// The lock must be settable without a UI: a client plugin cannot write host state (no fs,
// no new RPC), so the practical writer today is the agent. This CLI reuses the SAME tested
// pure functions the guard uses — including the cooldown — which means the cooldown binds
// the agent too, not just the user. That is the point of "forced focus".
//
//   node lib/focus-lock-cli.mjs status
//   node lib/focus-lock-cli.mjs lock  --kind session|workspace --target <id> [--minutes 30] [--cooldown 10]
//   node lib/focus-lock-cli.mjs unlock [--went-to <where>]
import fs from "node:fs";
import path from "node:path";
import { lockPath, readLock, canUnlock, unlock, normaliseLock, DEFAULT_COOLDOWN_MS } from "./index.js";

const args = process.argv.slice(2);
const command = args[0] || "status";
function flag(name, fallback) {
  const i = args.indexOf("--" + name);
  return i === -1 || i + 1 >= args.length ? fallback : args[i + 1];
}
const file = flag("lock-file", lockPath());
const now = Date.now();

/**
 * Where the CLIENT can read the same state.
 *
 * The guard reads the global file, but a client plugin cannot: it has no filesystem, and it
 * cannot add a host RPC. It CAN read files inside a workspace through the workspace-files
 * RPC — so the state is mirrored next to the working directory, where the UI can see it.
 * Two writers, one shape, one direction of truth (the global file is authoritative).
 */
function workspaceMirrorPath() {
  const explicit = flag("mirror", "");
  if (explicit !== "") return explicit;
  if (process.env.DSH_FOCUS_MIRROR) return process.env.DSH_FOCUS_MIRROR;
  return path.join(process.cwd(), ".dsh-focus-lock.json");
}

function write(state) {
  const body = JSON.stringify(state, null, 2) + "\n";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  try {
    const mirror = (state && typeof state.mirrorPath === "string" && state.mirrorPath !== "")
      ? state.mirrorPath
      : workspaceMirrorPath();
    if (mirror !== "" && path.resolve(mirror) !== path.resolve(file)) {
      fs.mkdirSync(path.dirname(mirror), { recursive: true });
      fs.writeFileSync(mirror, body);
    }
  } catch (e) { /* the mirror is for the UI; the guard never depends on it */ }
}
/**
 * The unlock history, even while disarmed.
 *
 * `readLock` refuses a disarmed file on purpose (that is what makes unlocking work), so it
 * cannot be used to carry the record forward — an unlock would silently erase every earlier
 * break. This reads the raw file instead.
 * @returns {Array<{atMs: number, wentTo: string}>}
 */
function readRecords(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(raw && raw.unlocks) ? raw.unlocks : [];
  } catch (e) {
    return [];
  }
}

function report(lock) {
  if (lock === null) return { locked: false };
  const gate = canUnlock(lock, now);
  return {
    locked: true, kind: lock.kind, targetId: lock.targetId,
    until: new Date(lock.untilMs).toISOString(),
    releaseAt: new Date(lock.lockedAtMs + lock.cooldownMs).toISOString(),
    canUnlockNow: gate.allow, waitSeconds: Math.ceil(gate.waitMs / 1000),
    unlocks: lock.unlocks.length,
    // The last few breaks, with WHERE the user went: requirement ⑤ is a record, and a bare
    // count cannot tell the user anything they can act on.
    recent: (lock.unlocks || []).slice(-5).map((u) => ({
      at: new Date(u.atMs).toISOString(),
      wentTo: u.wentTo
    }))
  };
}

/**
 * One machine-readable line, so the CLIENT can read the state out of the transcript.
 *
 * The client has no filesystem and no new RPC, so it cannot read the lock file. But the
 * output of this command lands in the conversation, and the client renders that — which
 * makes the transcript a channel that already exists. The enforcement only has to work in
 * the session the user is ABOUT to leave, and that session's client can see this line.
 * @param {object} state - the report() result.
 */
function marker(state) {
  // FIRST line of the output, on purpose: the client reads this out of the rendered
  // transcript, and a long tool result can be collapsed to its first lines. Putting the
  // marker last (as it was) meant the client usually never saw it, so the UI lock silently
  // did nothing. One line, first, machine-readable.
  return "[focus-lock-state] " + JSON.stringify(state);
}

if (command === "status") {
  console.log(marker(report(readLock(file, now))));
  console.log(JSON.stringify(report(readLock(file, now)), null, 2));
} else if (command === "lock") {
  const kind = flag("kind", "session");
  const target = flag("target", "");
  if (kind !== "session" && kind !== "workspace") { console.error("--kind must be session or workspace"); process.exit(2); }
  if (target === "") { console.error("--target is required"); process.exit(2); }
  const minutes = Number(flag("minutes", "30"));
  const cooldownMinutes = Number(flag("cooldown", String(DEFAULT_COOLDOWN_MS / 60000)));
  if (!Number.isFinite(minutes) || minutes <= 0) { console.error("--minutes must be positive"); process.exit(2); }
  if (!Number.isFinite(cooldownMinutes) || cooldownMinutes < 0) { console.error("--cooldown must be >= 0"); process.exit(2); }
  // Keep the previous unlock log: it is the record of how often focus was broken.
  const previous = { unlocks: readRecords(file) };
  const state = {
    enabled: true, kind, targetId: target,
    lockedAtMs: now, untilMs: now + minutes * 60000,
    cooldownMs: Math.round(cooldownMinutes * 60000),
    unlocks: Array.isArray(previous.unlocks) ? previous.unlocks.slice(-50) : [],
    // Remember WHERE the mirror went: unlock must update the SAME file, and without this it
    // defaulted to process.cwd() — silently leaving a stale "locked" mirror behind, so the UI
    // stayed blocked after unlocking (measured today).
    mirrorPath: workspaceMirrorPath()
  };
  write(state);
  const armed = report(normaliseLock(state, now));
  console.log(marker(armed));
  console.log(JSON.stringify(armed, null, 2));
} else if (command === "unlock") {
  const lock = readLock(file, now);
  if (lock === null) { console.log(JSON.stringify({ locked: false, note: "nothing to unlock" }, null, 2)); process.exit(0); }
  const gate = canUnlock(lock, now);
  if (!gate.allow) {
    // The cooldown binds the agent exactly as it binds the user.
    console.error(JSON.stringify({ ok: false, reason: "cooldown", waitSeconds: Math.ceil(gate.waitMs / 1000) }, null, 2));
    process.exit(3);
  }
  const freed = unlock(lock, now, flag("went-to", "unknown"));
  if (typeof lock.mirrorPath === "string" && lock.mirrorPath !== "") freed.mirrorPath = lock.mirrorPath;
  write(freed);
  const done = { ok: true, unlocks: (lock.unlocks || []).length + 1 };
  console.log(marker({ locked: false, unlocks: done.unlocks }));
  console.log(JSON.stringify(done, null, 2));
} else {
  console.error("usage: status | lock --kind session|workspace --target <id> [--minutes N] [--cooldown N] | unlock [--went-to X]");
  process.exit(2);
}
