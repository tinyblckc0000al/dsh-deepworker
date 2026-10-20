// dsh-history-actions — host half.
//
// The browser half (lib/client.js) owns every UI feature. This half owns exactly one
// thing: the **focus lock** — while it is armed, state-changing tool calls are refused in
// every session except the locked target.
//
// Why the host: the client cannot refuse a tool call at all, and a client plugin cannot add
// a host RPC (Typert remotes are generated at build time). The lock state therefore lives in
// a plain JSON file that BOTH sides can reach: the host reads it on every call, and the
// agent (or the user, through the agent) writes it. No new surface is needed.
//
// Design notes: docs/archive/focus-lock-design.md. Invariant that matters most is "do not hurt the
// usable area": only a known MUTATOR is refused, everything unknown is allowed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The session id inside an agent, whichever shape it arrives in.
 *
 * Measured shapes: `agent.session` is an object (its `id` may be a string or an object with
 * its own `id`). A string is still accepted so the unit tests and any future shape keep
 * working. An empty result is safer than a wrong one: `decide` treats it as "not the target"
 * only for a SESSION lock, and a session lock with no session is refused — so this function
 * must be right, not merely tolerant.
 * @returns {string}
 */
export function sessionIdOf(agent) {
  if (agent === null || typeof agent !== "object") return "";
  const raw = agent.session;
  if (typeof raw === "string") return raw;
  if (raw !== null && typeof raw === "object") {
    if (typeof raw.id === "string") return raw.id;
    if (raw.id !== null && typeof raw.id === "object" && typeof raw.id.id === "string") return raw.id.id;
    if (typeof raw.sessionId === "string") return raw.sessionId;
  }
  if (typeof agent.sessionId === "string") return agent.sessionId;
  // Real-machine observation (2026-10-11, second sample): the agent carries its OWN id at the
  // top level as `id: "session-<uuid>"`. That is the value `decide` needs, and missing it was
  // what made the guard refuse even the locked session.
  if (typeof agent.id === "string") return agent.id;
  return "";
}

/** One session id, in the one spelling the ownership account uses.
 *
 * The registry keys `sessionIds` by the id the session was attached with, while the agent
 * carries `session-<uuid>` at its top level (measured) and the client sometimes hands over the
 * bare uuid. Comparing the raw strings would then silently miss — the same class of silent
 * miss that made the guard refuse the locked session. Only the `session-` prefix is normalised.
 * @returns {string}
 */
function sameSessionKey(value) {
  const raw = typeof value === "string" ? value : String(value == null ? "" : value);
  return raw.replace(/^session-/, "");
}

/**
 * The canonical workspace `path` owning `sessionId`, or "" when there is none.
 *
 * Why not `agent.workspace`: the real-machine observation (2026-10-11/12, carried in
 * `~/.dsh/focus-lock-observe.json`) shows the agent has NO `workspace` field at all, so that
 * read always yielded "" and `decide` then refused *every* mutator — including the ones inside
 * the locked workspace. That is the harm this guard must never cause.
 *
 * Why not `cwd`: the host attaches a session only when `cwd === workspace.path` EXACTLY
 * (dsh-workspace/lib/index.js:122, and the path is `fs.realpath`-canonicalised at :36-51), and
 * two workspaces may be parent and child of each other. A prefix test would name the wrong
 * workspace; the ownership account cannot.
 *
 * Defensive by construction: a missing/unreadable registry, a session in no workspace (a
 * subagent session never attaches), or any unexpected shape all return "" — which `decide`
 * treats as "unknown", i.e. NOT the target. The caller decides what that means; this function
 * never throws and never guesses.
 * @param {object|null} registry - `ctx.get("workspaceRegistry")`, or null.
 * @param {string} sessionId - the agent's session id, in any spelling.
 * @returns {string} canonical workspace path, or "".
 */
export function workspacePathFor(registry, sessionId) {
  try {
    const want = sameSessionKey(sessionId);
    if (want === "") return "";
    if (registry === null || registry === undefined || typeof registry.list !== "function") return "";
    const items = registry.list();
    if (!Array.isArray(items)) return "";
    for (const workspace of items) {
      if (workspace === null || typeof workspace !== "object") continue;
      const ids = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : null;
      if (ids === null) continue;
      for (const id of ids) {
        if (sameSessionKey(id) === want) return typeof workspace.path === "string" ? workspace.path : "";
      }
    }
    return "";
  } catch (e) {
    return "";
  }
}

/** Tools that change state. A refusal list, not an allow list: an unknown tool must keep
 * working, because breaking something benign is worse than missing something exotic. */
const MUTATORS = [
  "bash", "pwsh", "shell", "terminal", "terminal_write", "terminal_start",
  "write", "edit", "apply_patch", "str_replace_editor", "multi_edit", "create_file", "delete_file", "move_file",
  "subagent", "subagent_fork", "subagent_prompt", "workflow", "job_start", "job_kill",
  "mcp_call", "mcp_tool"
];

/** Tools that always pass, whatever the lock says. Reads are the whole point of "never hurt
 * the usable area", and the guard's own reporting must work while locked. */
const ALWAYS_ALLOWED = [
  "read", "view", "cat", "ls", "list", "glob", "grep", "search", "codebase_search",
  "web_search", "web_fetch", "skill", "ask_user_question", "todo_write",
  "schedule_list", "schedule_create", "schedule_update", "schedule_delete", "focus_lock"
];

/** Where the one-shot agent-shape observation is written (readable from a shell). */
export function observationPath(env) {
  const e = env || (typeof process === "undefined" ? {} : process.env) || {};
  if (typeof e.DSH_FOCUS_OBSERVE === "string" && e.DSH_FOCUS_OBSERVE !== "") return e.DSH_FOCUS_OBSERVE;
  return path.join(os.homedir(), ".dsh", "focus-lock-observe.json");
}

/**
 * Where a refusal is recorded, with the decision's OWN view of time.
 *
 * The one question a refusal must be able to answer afterwards is "what did the guard think
 * the time and the lock were?" — a refusal you cannot explain is indistinguishable from a bug,
 * and that ambiguity is exactly what cost a round here. Only refusals are written, so the file
 * stays tiny and meaningful.
 */
export function refusalLogPath(env) {
  const e = env || (typeof process === "undefined" ? {} : process.env) || {};
  if (typeof e.DSH_FOCUS_REFUSALS === "string" && e.DSH_FOCUS_REFUSALS !== "") return e.DSH_FOCUS_REFUSALS;
  return path.join(os.homedir(), ".dsh", "focus-lock-refusals.json");
}

/** Absolute path of the lock file. Lazy so a test can point it elsewhere first. */
function lockPath(env) {
  const e = env || (typeof process === "undefined" ? {} : process.env) || {};
  if (typeof e.DSH_FOCUS_LOCK === "string" && e.DSH_FOCUS_LOCK !== "") return e.DSH_FOCUS_LOCK;
  const home = os.homedir();
  return path.join(home, ".dsh", "focus-lock.json");
}

/** Coerce anything read from disk into a usable lock, or null. Corrupt input disarms the
 * lock rather than jamming every tool call: a broken file must never brick the session. */
/** Ten minutes: long enough to stop the reflex, short enough not to feel like a jail. */
export const DEFAULT_COOLDOWN_MS = 600000;

export function normaliseLock(raw, nowMs) {
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (raw.enabled !== true) return null;
  if (raw.kind !== "session" && raw.kind !== "workspace") return null;
  if (typeof raw.targetId !== "string" || raw.targetId === "") return null;
  const untilMs = typeof raw.untilMs === "number" && Number.isFinite(raw.untilMs) ? raw.untilMs : null;
  if (untilMs === null) return null;
  const cooldownMs = typeof raw.cooldownMs === "number" && raw.cooldownMs >= 0 ? raw.cooldownMs : DEFAULT_COOLDOWN_MS;
  // The cooldown runs from when the lock was armed. A missing value means "armed just now",
  // which is the strict reading: it can only make the way out later, never earlier.
  const lockedAtMs = typeof raw.lockedAtMs === "number" && Number.isFinite(raw.lockedAtMs) ? raw.lockedAtMs : nowMs;
  const unlocks = Array.isArray(raw.unlocks)
    ? raw.unlocks.filter((u) => u && typeof u === "object").map((u) => ({
        atMs: typeof u.atMs === "number" ? u.atMs : 0,
        wentTo: typeof u.wentTo === "string" ? u.wentTo : ""
      }))
    : [];
  return { enabled: true, kind: raw.kind, targetId: raw.targetId, untilMs, cooldownMs, lockedAtMs, unlocks };
}

export function readLock(file, nowMs) {
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return null;
  }
  const lock = normaliseLock(raw, now);
  if (lock === null) return null;
  if (lock.untilMs <= now) return null;
  return lock;
}

/**
 * The whole policy, as a pure function — this is the part worth testing.
 * @param {object|null} lock - normalised lock, or null when disarmed.
 * @param {{sessionId?: string, workspaceId?: string}} where - who is calling. For a workspace
 *   lock, `workspaceId` must be the CANONICAL WORKSPACE PATH (the same spelling as
 *   `lock.targetId`): the ownership-account projection and the client both use `path`, not the
 *   opaque `workspaceId`. The key keeps its name for callers, but its meaning is "the workspace
 *   this call is in", not "the registry id of that workspace".
 * @param {string} toolName - the tool about to run.
 * @returns {{allow: boolean, reason?: string}}
 */
export function decide(lock, where, toolName) {
  if (lock === null) return { allow: true };
  const name = String(toolName == null ? "" : toolName);
  if (ALWAYS_ALLOWED.indexOf(name) !== -1) return { allow: true };
  const isMutator = MUTATORS.indexOf(name) !== -1 || /^(terminal|job|mcp)_/.test(name);
  if (!isMutator) return { allow: true };
  const sessionId = where && typeof where.sessionId === "string" ? where.sessionId : "";
  // Exact equality on purpose: the host attaches a session only when `cwd === path` exactly,
  // so a parent and a child directory are two different workspaces and a prefix test would
  // open the wrong one.
  const workspacePath = where && typeof where.workspaceId === "string" ? where.workspaceId : "";
  const targeted = lock.kind === "session"
    ? (sessionId !== "" && sessionId === lock.targetId)
    : (workspacePath !== "" && workspacePath === lock.targetId);
  if (targeted) return { allow: true };
  return {
    allow: false,
    reason: "专注锁已开启：只能在锁定的" + (lock.kind === "session" ? "会话" : "工作区")
      + "（" + lock.targetId + "）里执行会改变状态的命令。解锁定于 "
      + new Date(lock.untilMs).toISOString() + "。"
  };
}

/**
 * The way out, as a pure function.
 *
 * A lock that cannot be released is not a focus tool, it is a fault — but a lock that can be
 * released instantly is not focus either. The cooldown is the whole tension, so it is explicit
 * and configurable (0 means "release immediately").
 * @returns {{allow: boolean, waitMs: number}}
 */
export function canUnlock(lock, nowMs) {
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  if (lock === null) return { allow: true, waitMs: 0 };
  const readyAt = lock.lockedAtMs + lock.cooldownMs;
  if (now >= readyAt) return { allow: true, waitMs: 0 };
  return { allow: false, waitMs: readyAt - now };
}

/**
 * Release the lock and append the record.
 *
 * The record is the only part of "forced focus" that can survive a user who simply opens
 * another window — the UI cannot stop that, but the log makes it visible. `wentTo` names
 * where they went, so the log says something useful later.
 * @returns {object} the disarmed state to write back.
 */
export function unlock(lock, nowMs, wentTo) {
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  const base = lock === null ? { kind: "session", targetId: "", cooldownMs: DEFAULT_COOLDOWN_MS, unlocks: [] } : lock;
  const records = (base.unlocks || []).concat([{ atMs: now, wentTo: typeof wentTo === "string" ? wentTo : "" }]);
  return {
    enabled: false,
    kind: base.kind,
    targetId: base.targetId,
    untilMs: now,
    cooldownMs: base.cooldownMs === undefined ? DEFAULT_COOLDOWN_MS : base.cooldownMs,
    lockedAtMs: now,
    unlocks: records.slice(-50)
  };
}

/**
 * Report the calling agent's shape ONCE.
 *
 * The workspace-file channel is only viable if `agent.workspace` is a real path: the client
 * can read and write files through the workspace RPC, but the host has to look in the same
 * place. One observation settles it; repeating it per call would be noise.
 */
const OBSERVED_CONTEXTS = new WeakSet();
function observeAgentOnce(ctx, agent) {
  // Keyed by ctx, not by module state: a module-level flag makes the function unobservable
  // in a second test and would also leak across plugin instances.
  if (OBSERVED_CONTEXTS.has(ctx)) return;
  OBSERVED_CONTEXTS.add(ctx);
  try {
    const shape = {};
    for (const key of Object.keys(agent)) {
      const value = agent[key];
      shape[key] = typeof value === "string"
        ? (value.length > 120 ? value.slice(0, 120) + "…" : value)
        : (value === null ? "null" : Array.isArray(value) ? "array(" + value.length + ")" : typeof value);
      // One level deep for the interesting fields: "object" alone could not tell us that
      // `session` hides the id we need, which is exactly what cost a debugging round.
      if ((key === "session" || key === "workspace") && value !== null && typeof value === "object") {
        shape[key + ".keys"] = Object.keys(value).slice(0, 24);
      }
    }
    const line = "[focus-lock] agent shape: " + JSON.stringify(shape);
    // Write it where a human can actually read it. The app's runtime log is not reachable
    // from here (only crash logs are written), so `logger.info` alone would have been a
    // report into the void — the same mistake as a silent failure, one level up.
    try {
      fs.mkdirSync(path.dirname(observationPath()), { recursive: true });
      fs.writeFileSync(observationPath(), JSON.stringify({ at: new Date().toISOString(), shape }, null, 2) + "\n");
    } catch (e) { /* the file is a nicety, never a requirement */ }
    if (typeof ctx.logger === "object" && ctx.logger !== null && typeof ctx.logger.info === "function") ctx.logger.info(line);
    else if (typeof console !== "undefined") console.log(line);
  } catch (e) { /* observation must never affect a decision */ }
}

/** Host plugin entry. `tools/pre-execute` is a middleware: `next()` passes, returning
 * `{kind:"cancel"}` vetoes — the same shape the shipped Auto-review layer uses. */
export function apply(ctx) {
  const file = lockPath();
  ctx.effect(function* () {
    yield ctx.on("tools/pre-execute", async (exec, next) => {
      const agent = exec && exec.agent;
      if (agent === void 0 || agent === null) return next();
      observeAgentOnce(ctx, agent);
      let lock = null;
      try {
        lock = readLock(file);
      } catch (e) {
        return next();
      }
      if (lock === null) return next();
      // Real-machine data (2026-10-11) shows `agent.session` is an OBJECT, not a string.
      // Reading it as a string yielded "", which would have refused the LOCKED session too —
      // the exact harm this guard must never cause. Both shapes are accepted.
      const sessionId = sessionIdOf(agent);
      // `workspaceId` here is the CANONICAL WORKSPACE PATH — the same spelling the client
      // writes into the lock's `targetId` (`items[i].path`). Reading `agent.workspace` was the
      // bug: the real agent has no such field, so this was always "" and `decide` refused every
      // mutator, including the ones inside the locked workspace.
      // `ctx.get` reads a service WITHOUT an inject requirement, and the whole read is
      // best-effort: no registry (or an unreadable one) must leave the guard exactly as safe
      // as before, never throwing inside a middleware.
      let workspacePath = "";
      try {
        const registry = typeof ctx.get === "function" ? ctx.get("workspaceRegistry") : null;
        workspacePath = workspacePathFor(registry, sessionId);
      } catch (e) {
        workspacePath = "";
      }
      let verdict;
      try {
        verdict = decide(lock, { sessionId, workspaceId: workspacePath }, exec.name);
      } catch (e) {
        return next();
      }
      if (verdict.allow) return next();
      try {
        const record = {
          at: new Date(Date.now()).toISOString(),
          nowMs: Date.now(),
          untilMs: lock.untilMs,
          expired: lock.untilMs <= Date.now(),
          kind: lock.kind,
          targetId: lock.targetId,
          sessionId: sessionId,
          // The refusal record is the only evidence a refusal ever happened, so it must name
          // the workspace the way the decision compared it: the canonical path.
          workspacePath: workspacePath,
          tool: exec.name,
          reason: verdict.reason
        };
        const logFile = refusalLogPath();
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        fs.writeFileSync(logFile, JSON.stringify(record, null, 2) + "\n");
      } catch (e) { /* a diagnostic must never change the decision */ }
      try {
        if (typeof ctx.logger === "object" && ctx.logger !== null && typeof ctx.logger.warn === "function") {
          ctx.logger.warn("[focus-lock] refused " + exec.name + " in " + sessionId + ": " + verdict.reason);
        }
      } catch (e) { /* reporting must never break the refusal */ }
      return { kind: "cancel" };
    });
  });
}

export const name = "dsh-focus-lock";
export const inject = [];
export { lockPath, MUTATORS, ALWAYS_ALLOWED, observeAgentOnce };