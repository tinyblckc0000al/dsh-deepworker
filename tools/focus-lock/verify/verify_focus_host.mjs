// The host half of the focus lock: a pure decision function plus the middleware shape.
// Everything here is asserted against the real module — the guard is the only thing that
// can refuse a tool call, so a bug in it either jams real work or lets work through.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

// The module reads its path lazily, but the middleware test needs the file to be THIS one —
// so point it before importing. Self-contained on purpose: running the suite alone must work.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "focus-suite-"));
const TMP_LOCK = path.join(TMP_DIR, "lock.json");
const TMP_OBSERVE = path.join(TMP_DIR, "observe.json");
// BOTH paths, for the WHOLE suite. A suite that writes to the user's real ~/.dsh is not a
// test, it is a side effect: an earlier version of this file leaked `{"session":"sess-B"}`
// into the real observation file and it read exactly like real data.
process.env.DSH_FOCUS_LOCK = TMP_LOCK;
process.env.DSH_FOCUS_OBSERVE = TMP_OBSERVE;
process.env.DSH_FOCUS_REFUSALS = path.join(TMP_DIR, "refusals.json");

const mod = await import("../lib/index.js");
const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };
const ok = (m) => console.log("  ok   " + m);

const now = Date.now();
const armed = (patch) => mod.normaliseLock(Object.assign({ enabled: true, kind: "session", targetId: "sess-A", untilMs: now + 60000, cooldownMs: 600000, unlocks: [] }, patch));

// ---- 1. disarmed means nothing changes ------------------------------------
if (mod.decide(null, { sessionId: "sess-B" }, "bash").allow !== true) fail("a disarmed lock must allow everything");
ok("disarmed: every tool passes");

// ---- 1b. the session id, in every shape seen on the real machine ----
// Second real-machine sample (2026-10-11) showed the id at the TOP level as
// `id: "session-<uuid>"`; the first showed `session` as an object. Both were guesses at
// first, which is exactly why this is asserted rather than assumed.
{
  const shapes = [
    [{ id: "session-abc" }, "session-abc"],
    [{ session: { id: "s1" } }, "s1"],
    [{ session: { id: { id: "s2" } } }, "s2"],
    [{ session: { sessionId: "s3" } }, "s3"],
    [{ session: "s4" }, "s4"],
    [{ sessionId: "s5" }, "s5"],
    [{ id: "session-x", session: { id: "inner" } }, "inner"],
    [{}, ""], [null, ""], [42, ""]
  ];
  for (const [input, want] of shapes) {
    if (mod.sessionIdOf(input) !== want) {
      fail("sessionIdOf(" + JSON.stringify(input) + ") must be " + JSON.stringify(want) + ", got " + JSON.stringify(mod.sessionIdOf(input)));
    }
  }
  const lock = armed({ targetId: "session-abc" });
  if (mod.decide(lock, { sessionId: mod.sessionIdOf({ id: "session-abc" }) }, "bash").allow !== true) {
    fail("the top-level id shape must resolve to the locked session (else the guard harms the target)");
  }
  ok("sessionIdOf: ten shapes resolve, and the real top-level id reaches the locked session");
}

// ---- 2. lock to a SESSION -------------------------------------------------
{
  const lock = armed({});
  if (mod.decide(lock, { sessionId: "sess-B" }, "bash").allow !== false) fail("a mutator outside the locked session must be refused");
  const refusal = mod.decide(lock, { sessionId: "sess-B" }, "bash");
  if (!/专注锁/.test(refusal.reason || "")) fail("the refusal must carry a readable reason, got " + JSON.stringify(refusal.reason));
  if (!/sess-A/.test(refusal.reason || "")) fail("the reason must name the locked target");
  if (mod.decide(lock, { sessionId: "sess-A" }, "bash").allow !== true) fail("the locked session keeps full capability");
  ok("session lock: refused outside, allowed inside, with a readable reason");
}

// ---- 3. lock to a WORKSPACE ----------------------------------------------
{
  const lock = armed({ kind: "workspace", targetId: "ws-1" });
  if (mod.decide(lock, { sessionId: "s2", workspaceId: "ws-1" }, "write").allow !== true) fail("the locked workspace must keep working");
  if (mod.decide(lock, { sessionId: "s2", workspaceId: "ws-2" }, "write").allow !== false) fail("another workspace must be refused");
  if (mod.decide(lock, { sessionId: "s2" }, "write").allow !== false) fail("an unknown workspace must not be assumed to be the target");
  if (mod.decide(lock, { sessionId: "s2", workspaceId: "ws-1" }, "read").allow !== true) fail("reads stay allowed in the locked workspace");
  ok("workspace lock: target works, others refused, reads always pass");
}

// ---- 4. never hurt the usable area ---------------------------------------
{
  const lock = armed({});
  const harmless = ["read", "view", "glob", "grep", "web_search", "web_fetch", "skill", "ask_user_question", "todo_write", "schedule_list", "schedule_create", "schedule_update", "schedule_delete", "focus_lock"];
  for (const tool of harmless) {
    if (mod.decide(lock, { sessionId: "other" }, tool).allow !== true) fail(tool + " must never be blocked by the lock");
  }
  if (mod.decide(lock, { sessionId: "other" }, "some_brand_new_tool").allow !== true) fail("an UNKNOWN tool must be allowed: refusing it would be the harm this rule exists to prevent");
  if (mod.decide(lock, { sessionId: "other" }, "terminal_write").allow !== false) fail("a prefixed mutator must be refused");
  if (mod.decide(lock, { sessionId: "other" }, "mcp_anything").allow !== false) fail("mcp_* must be refused");
  ok("harmless and unknown tools pass; known mutators are refused (" + mod.MUTATORS.length + " listed)");
}

// ---- 5. corrupt state must disarm, not jam -------------------------------
{
  const bad = [null, 42, "x", [], {}, { enabled: true }, { enabled: true, kind: "nope", targetId: "s", untilMs: now + 1000 }, { enabled: true, kind: "session", targetId: "", untilMs: now + 1000 }, { enabled: true, kind: "session", targetId: "s", untilMs: "later" }, { enabled: false, kind: "session", targetId: "s", untilMs: now + 1000 }];
  for (const raw of bad) {
    if (mod.normaliseLock(raw) !== null) fail("this must not normalise into an armed lock: " + JSON.stringify(raw));
  }
  const coercing = mod.normaliseLock({ enabled: true, kind: "session", targetId: "s", untilMs: now + 1000 });
  if (coercing.cooldownMs !== 600000) fail("a missing cooldown must default to ten minutes, got " + coercing.cooldownMs);
  if (coercing.unlocks.length !== 0) fail("unlocks must default to an empty list");
  ok("corrupt or partial state disarms the lock instead of jamming every call");
}

// ---- 6. the file path must be an arbitrary, timed lock -------------------
{
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "focus-")), "lock.json");
  fs.writeFileSync(file, JSON.stringify({ enabled: true, kind: "session", targetId: "sess-A", untilMs: now + 60000, cooldownMs: 1, unlocks: [] }));
  const lock = mod.readLock(file, now);
  if (lock === null || lock.targetId !== "sess-A") fail("a valid file must read back as an armed lock");
  fs.writeFileSync(file, JSON.stringify({ enabled: true, kind: "session", targetId: "sess-A", untilMs: now - 1, cooldownMs: 1, unlocks: [] }));
  if (mod.readLock(file, now) !== null) fail("an EXPIRED lock must read as disarmed — the way out must not depend on the UI");
  fs.writeFileSync(file, "{not json");
  if (mod.readLock(file, now) !== null) fail("a corrupt file must read as disarmed");
  if (mod.readLock(path.join(os.tmpdir(), "focus-does-not-exist.json"), now) !== null) fail("a missing file must read as disarmed");
  ok("reading the lock: valid arms it, expired/corrupt/missing disarm it");
}

// ---- 7. the middleware shape ---------------------------------------------
{
  const calls = [];
  const ctx = {
    effect(fn) { const it = fn(); if (it && typeof it.next === "function") it.next(); },
    on(event, handler) { calls.push({ event, handler }); },
    logger: { warn: () => {} }
  };
  mod.apply(ctx);
  const reg = calls.find((c) => c.event === "tools/pre-execute");
  if (!reg) fail("apply() must register the tools/pre-execute middleware");
  let passed = 0;
  const next = () => { passed += 1; return "passed"; };
  const exec = (name, session) => ({ name, agent: { session } });
  const file = TMP_LOCK;
  fs.writeFileSync(file, JSON.stringify({ enabled: true, kind: "session", targetId: "sess-A", untilMs: Date.now() + 60000, cooldownMs: 1, unlocks: [] }));
  const refused = await reg.handler(exec("bash", "sess-B"), next);
  if (passed !== 0) fail("a refused call must not reach next()");
  if (!refused || refused.kind !== "cancel") fail("a refusal must use the {kind:'cancel'} shape, got " + JSON.stringify(refused));
  const allowed = await reg.handler(exec("read", "sess-B"), next);
  if (passed !== 1 || allowed !== "passed") fail("a harmless call must pass through via next()");
  const inside = await reg.handler(exec("bash", "sess-A"), next);
  if (inside !== "passed") fail("the locked session must pass through");
  fs.unlinkSync(file);
  const unlocked = await reg.handler(exec("bash", "sess-B"), next);
  if (unlocked !== "passed") fail("with the file gone, everything passes again");
  const noAgent = await reg.handler({ name: "bash" }, next);
  if (noAgent !== "passed") fail("a call with no agent must not be refused");
  ok("middleware: next() passes, {kind:'cancel'} refuses, and a missing agent never blocks");
}

// ---- 8. the way out: cooldown and records ------------------------------
// "Must leave a way out" and "must not be a reflex" are the same knob. Zero is a legal
// value on purpose: the user owns this machine and can always choose no cooldown.
{
  const now = 1000000;
  const lock = mod.normaliseLock({ enabled: true, kind: "session", targetId: "s", untilMs: now + 3600000 }, now);
  if (mod.canUnlock(lock, now).allow !== false) fail("a fresh lock must not release instantly");
  if (mod.canUnlock(lock, now).waitMs !== 600000) fail("the default cooldown must be ten minutes, got " + mod.canUnlock(lock, now).waitMs);
  if (mod.canUnlock(lock, now + 599999).allow !== false) fail("one millisecond early must still wait");
  if (mod.canUnlock(lock, now + 600000).allow !== true) fail("the cooldown must really end");
  const zero = mod.normaliseLock({ enabled: true, kind: "session", targetId: "s", untilMs: now + 1000, cooldownMs: 0 }, now);
  if (mod.canUnlock(zero, now).allow !== true) fail("cooldown 0 must be an instant escape hatch");
  if (mod.canUnlock(null, now).allow !== true) fail("a disarmed lock is always releasable");

  const off = mod.unlock(lock, now + 600000, "session:other");
  if (off.enabled !== false) fail("unlocking must disarm the lock");
  if (off.unlocks.length !== 1) fail("the unlock must be recorded");
  if (off.unlocks[0].wentTo !== "session:other") fail("the record must say where they went");
  if (off.unlocks[0].atMs !== now + 600000) fail("the record must carry the time");
  const again = mod.unlock(mod.normaliseLock(Object.assign({}, off, { enabled: true, untilMs: now + 9e6 }), now), now, "x");
  if (again.unlocks.length !== 2) fail("records must accumulate across unlocks");
  let many = off;
  for (let i = 0; i < 80; i++) many = mod.unlock(mod.normaliseLock(Object.assign({}, many, { enabled: true, untilMs: now + 9e6 }), now), now, "r" + i);
  if (many.unlocks.length > 50) fail("the record list must be capped, got " + many.unlocks.length);
  ok("cooldown gates the way out (0 = instant), and unlocks are recorded, capped at 50");
}

// ---- 9. the CLI is the writer today: same functions, same cooldown ----------
// The agent sets the lock by running this. It must reuse the tested functions — especially
// the cooldown, because a cooldown the agent can bypass is not a cooldown.
{
  // fileURLToPath, NOT `.pathname`: this workspace path contains Chinese characters and
  // `.pathname` leaves them percent-encoded, so the spawn cannot find the file.
  const cli = fileURLToPath(new URL("../lib/focus-lock-cli.mjs", import.meta.url));
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "focus-cli-")), "lock.json");
  const run = (...argv) => spawnSync(process.execPath, [cli, ...argv, "--lock-file", file, "--mirror", path.join(TMP_DIR, "mirror-main.json")], { encoding: "utf8" });
  // The CLI prints a human block AND a machine-readable marker line. Assertions read the
  // marker: it is the contract, and parsing the whole stdout broke the moment the human
  // block gained a line.
  const markerOf = (res) => {
    const line = String(res.stdout || "").split("\n").filter((l) => l.indexOf("[focus-lock-state] ") === 0).pop();
    if (line === undefined) fail("no focus-lock marker in output: " + JSON.stringify(String(res.stdout || "").slice(0, 200)));
    return JSON.parse(line.slice("[focus-lock-state] ".length));
  };

  const locked = run("lock", "--kind", "session", "--target", "sess-X", "--minutes", "30");
  if (locked.status !== 0) fail("lock must succeed: " + locked.stderr);
  const state = markerOf(locked);
  if (state.locked !== true || state.targetId !== "sess-X") fail("lock must report the armed state");
  if (state.waitSeconds !== 600) fail("the default cooldown must be ten minutes, got " + state.waitSeconds);

  const early = run("unlock", "--went-to", "session:other");
  if (early.status !== 3) fail("the cooldown must refuse an early unlock, got exit " + early.status);
  if (!/cooldown/.test(early.stderr)) fail("the refusal must say why");

  const instant = run("lock", "--kind", "workspace", "--target", "ws-1", "--minutes", "30", "--cooldown", "0");
  if (instant.status !== 0) fail("a zero-cooldown lock must be settable");
  const freed = run("unlock", "--went-to", "workspace:elsewhere");
  if (freed.status !== 0) fail("a zero cooldown must release immediately");
  if (markerOf(freed).unlocks !== 1) fail("the unlock must be recorded");
  if (markerOf(run("status")).locked !== false) fail("after unlocking, status must report unlocked");

  const bad = run("lock", "--kind", "nope", "--target", "x");
  if (bad.status !== 2) fail("an invalid kind must be rejected, got exit " + bad.status);
  const noTarget = run("lock", "--kind", "session");
  if (noTarget.status !== 2) fail("a missing target must be rejected");
  ok("CLI: locks, refuses an early unlock (exit 3), honours cooldown 0, records, rejects bad input");

  // ---- the workspace mirror the UI can read ----
  // The client cannot read the global file (no fs, no new RPC) but it CAN read inside a
  // workspace, so the state is mirrored there. The global file stays authoritative: a
  // mirror that fails must never weaken the guard.
  const mirror = path.join(path.dirname(file), "ws-mirror.json");
  const lockArgs = ["lock", "--kind", "session", "--target", "sess-M", "--minutes", "5", "--cooldown", "0"];
  if (run(...lockArgs, "--mirror", mirror).status !== 0) fail("locking with a mirror must succeed");
  if (!fs.existsSync(mirror)) fail("the mirror must be written next to the workspace");
  const globalBody = fs.readFileSync(file, "utf8");
  if (fs.readFileSync(mirror, "utf8") !== globalBody) fail("the mirror must match the authoritative file");
  if (JSON.parse(globalBody).targetId !== "sess-M") fail("the authoritative file must carry the target");

  const unlocked = run("unlock", "--mirror", mirror, "--went-to", "x");
  if (unlocked.status !== 0) fail("unlocking with a mirror must succeed");
  if (JSON.parse(fs.readFileSync(mirror, "utf8")).enabled !== false) fail("the mirror must follow the unlock");

  // A mirror that cannot be written must NOT stop the lock from arming.
  const blocked = path.join(file, "cannot", "exist", "mirror.json");   // a file as a directory
  const stillLocked = run(...lockArgs, "--mirror", blocked);
  if (stillLocked.status !== 0) fail("an unwritable mirror must not fail the lock");
  if (JSON.parse(fs.readFileSync(file, "utf8")).enabled !== true) fail("the global file must still be armed");
  const selfMirror = run(...lockArgs, "--mirror", file);               // mirror == target
  if (selfMirror.status !== 0) fail("a self-mirror must not fail");
  ok("the workspace mirror matches the global state, and a failed mirror never weakens it");

  // ---- the unlock history must survive a re-lock ----
  // readLock deliberately refuses a disarmed file, so carrying the record forward needs the
  // raw file. Getting this wrong silently erases every earlier break.
  const history = path.join(path.dirname(file), "history.json");
  const h = (...a) => spawnSync(process.execPath, [cli, ...a, "--lock-file", history, "--mirror", path.join(TMP_DIR, "mirror-history.json")], { encoding: "utf8" });
  if (h("lock", "--kind", "session", "--target", "s", "--minutes", "5", "--cooldown", "0").status !== 0) fail("history: first lock failed");
  if (h("unlock", "--went-to", "session:other").status !== 0) fail("history: unlock failed");
  if (h("lock", "--kind", "session", "--target", "s", "--minutes", "5", "--cooldown", "0").status !== 0) fail("history: re-lock failed");
  const carried = markerOf(h("status"));
  if (carried.unlocks !== 1) fail("the unlock count must survive a re-lock, got " + carried.unlocks);
  if (!Array.isArray(carried.recent) || carried.recent.length !== 1) fail("the recent list must survive a re-lock");
  if (carried.recent[0].wentTo !== "session:other") fail("the record must keep WHERE the user went");
  if (!/^\d{4}-\d{2}-\d{2}T/.test(carried.recent[0].at || "")) fail("the record must carry a readable time");
  ok("the unlock history (time + destination) survives unlock and re-lock");
}

// ---- 14. a session's workspace comes from the OWNERSHIP ACCOUNT, never from `agent.workspace`
// The real-machine shape (`~/.dsh/focus-lock-observe.json`, 2026-10-12) has NO `workspace`
// field on the agent, so the old read was always "" and `decide` refused every mutator —
// including the ones inside the locked workspace. These are the rules the replacement obeys.
// `workspacePath` is a PATH, not a registry id: the host attaches a session only when
// `cwd === path` exactly, and the client writes `items[i].path` into the lock's targetId.
{
  const WS_A = "/Users/x/wsA";
  const W_NESTED = WS_A + "/nested";
  const W_B = "/Users/x/wsB";
  const registry = {
    list: () => [
      { id: "ws-a", path: WS_A, title: "A", sessionIds: ["session-AAAA", "session-AAAA-2"] },
      { id: "ws-nested", path: W_NESTED, title: "A/nested", sessionIds: ["session-NESTED"] },
      { id: "ws-b", path: W_B, title: "B", sessionIds: ["session-BBBB"] }
    ]
  };
  if (mod.workspacePathFor(registry, "session-AAAA") !== WS_A) fail("an attached session must resolve to its workspace path");
  if (mod.workspacePathFor(registry, "AAAA") !== WS_A) fail("the bare uuid must match the `session-` spelling in the account");
  if (mod.workspacePathFor(registry, "session-NESTED") !== W_NESTED) fail("a child directory is its OWN workspace (exact compare, no prefix)");
  if (mod.workspacePathFor(registry, "session-CCCC") !== "") fail("an ungrouped session must resolve to the empty string, not to a guess");
  if (mod.workspacePathFor(registry, "") !== "") fail("an empty id must resolve to the empty string");
  if (mod.workspacePathFor(null, "session-AAAA") !== "") fail("no registry must resolve to the empty string");
  if (mod.workspacePathFor({ list: () => { throw new Error("registry down"); } }, "session-AAAA") !== "") fail("a throwing registry must resolve to the empty string, never propagate");
  if (mod.workspacePathFor({ list: () => "nope" }, "session-AAAA") !== "") fail("a non-array list() must resolve to the empty string");
  if (mod.workspacePathFor({ list: () => [null, 42, { path: WS_A }, { sessionIds: "x", path: WS_A }] }, "session-AAAA") !== "") {
    fail("malformed items must be skipped, not guessed at");
  }
  ok("the ownership account resolves a session to its workspace PATH (exact match, ungrouped/unreadable => empty)");
}

// ---- 15. the middleware really uses it: inside the locked workspace keeps working ---------
{
  const WS_A = "/Users/x/wsA";
  const WS_B = "/Users/x/wsB";
  const registry = { list: () => [
    { id: "ws-a", path: WS_A, title: "A", sessionIds: ["session-A"] },
    { id: "ws-b", path: WS_B, title: "B", sessionIds: ["session-B"] }
  ] };
  const calls = [];
  const ctx = {
    effect(fn) { const it = fn(); if (it && typeof it.next === "function") it.next(); },
    on(event, handler) { calls.push({ event, handler }); },
    get(name) { return name === "workspaceRegistry" ? registry : undefined; },
    logger: { warn: () => {} }
  };
  mod.apply(ctx);
  const reg = calls.find((c) => c.event === "tools/pre-execute");
  if (!reg) fail("apply() must still register the tools/pre-execute middleware");
  let passed = 0;
  const next = () => { passed += 1; return "passed"; };
  const exec = (name, session) => ({ name, agent: { id: session } });
  fs.writeFileSync(TMP_LOCK, JSON.stringify({ enabled: true, kind: "workspace", targetId: WS_A, untilMs: Date.now() + 60000, cooldownMs: 1, unlocks: [] }));

  const inside = await reg.handler(exec("bash", "session-A"), next);
  if (inside !== "passed") fail("a mutator INSIDE the locked workspace must pass — refusing it is the bug this test exists for");
  const readInside = await reg.handler(exec("read", "session-A"), next);
  if (readInside !== "passed") fail("reads must stay allowed inside the locked workspace");
  const outside = await reg.handler(exec("bash", "session-B"), next);
  if (passed !== 2) fail("a mutator in the locked workspace must reach next() twice by now, got " + passed);
  if (!outside || outside.kind !== "cancel") fail("a mutator in ANOTHER workspace must be refused, got " + JSON.stringify(outside));
  const ungrouped = await reg.handler(exec("bash", "session-UNKNOWN"), next);
  if (!ungrouped || ungrouped.kind !== "cancel") fail("a session the account does not know is NOT the target, so it must be refused");

  // A host WITHOUT the registry must behave exactly as before this fix: unknown workspace =>
  // refused (fail closed for mutators). The point is that it must not THROW inside middleware.
  const noRegistry = [];
  const ctx2 = {
    effect(fn) { const it = fn(); if (it && typeof it.next === "function") it.next(); },
    on(event, handler) { noRegistry.push({ event, handler }); },
    logger: { warn: () => {} }
  };
  mod.apply(ctx2);
  const reg2 = noRegistry.find((c) => c.event === "tools/pre-execute");
  let passed2 = 0;
  const next2 = () => { passed2 += 1; return "passed"; };
  const lonely = await reg2.handler({ name: "bash", agent: { id: "session-A" } }, next2);
  if (!lonely || lonely.kind !== "cancel") fail("with no registry a workspace lock must still refuse (never assume the caller is the target)");
  // ... and a ctx.get that itself throws must not break the middleware.
  const ctx3 = {
    effect(fn) { const it = fn(); if (it && typeof it.next === "function") it.next(); },
    on(event, handler) { noRegistry.push({ event, handler }); },
    get() { throw new Error("get exploded"); },
    logger: { warn: () => {} }
  };
  mod.apply(ctx3);
  const reg3 = noRegistry.filter((c) => c.event === "tools/pre-execute").pop();
  const survived = await reg3.handler({ name: "bash", agent: { id: "session-A" } }, next2);
  if (!survived || survived.kind !== "cancel") fail("a throwing ctx.get must leave the guard working (refuse, never crash)");
  fs.unlinkSync(TMP_LOCK);
  ok("middleware: locked workspace works, other/unknown workspaces refused, a missing or throwing registry never breaks it");
}

// ---- 16. MUTATION: put `agent.workspace` back and the assertions above must go RED ---------
// The suite is only worth what it can catch. The historical bug is re-created verbatim in a
// copy of the module, loaded from a DIFFERENT path (so node's per-path ESM cache cannot hand
// back the fixed module) and run through the same middleware test. Nothing is mutated on disk.
{
  const source = fs.readFileSync(fileURLToPath(new URL("../lib/index.js", import.meta.url)), "utf8");
  // Built from single-character parts on purpose: the mutated line must contain quotes, and a
  // stray escape written here would silently become a syntax error in THIS file instead of a
  // mutation of the OTHER one (that is exactly how this section broke the first time).
  const Q = String.fromCharCode(34);
  // The WHOLE fixed block (comment + registry lookup) is replaced by the pre-fix read. A
  // narrower anchor would be overwritten by the code right below it — measured: mutating only
  // the `let workspacePath = "";` line left the registry assignment in place, so the mutation
  // was never actually in effect and the test "passed" a wrong module.
  const OLD = [
    "      // `workspaceId` here is the CANONICAL WORKSPACE PATH — the same spelling the client",
    "      // writes into the lock's `targetId` (`items[i].path`). Reading `agent.workspace` was the",
    "      // bug: the real agent has no such field, so this was always " + Q + Q + " and `decide` refused every",
    "      // mutator, including the ones inside the locked workspace.",
    "      // `ctx.get` reads a service WITHOUT an inject requirement, and the whole read is",
    "      // best-effort: no registry (or an unreadable one) must leave the guard exactly as safe",
    "      // as before, never throwing inside a middleware.",
    "      let workspacePath = " + Q + Q + ";",
    "      try {",
    "        const registry = typeof ctx.get === " + Q + "function" + Q + " ? ctx.get(" + Q + "workspaceRegistry" + Q + ") : null;",
    "        workspacePath = workspacePathFor(registry, sessionId);",
    "      } catch (e) {",
    "        workspacePath = " + Q + Q + ";",
    "      }"
  ].join("\n");
  const NEW = [
    "      // Real-machine data (2026-10-11): the agent carries no usable workspace field, so this",
    "      // read yielded " + Q + Q + " and `decide` refused every mutator — the historical bug.",
    "      const workspacePath = typeof agent.workspace === " + Q + "string" + Q + " ? agent.workspace : " + Q + Q + ";"
  ].join("\n");
  const mutated = source.replace(OLD, NEW);
  if (mutated === source || source.split(OLD).length - 1 !== 1) {
    fail("the mutation anchor is gone or ambiguous - the guard cannot be proven");
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "focus-mutant-"));
  const file = path.join(dir, "index.mjs");
  fs.writeFileSync(file, mutated);
  let mutant = null;
  try {
    mutant = await import(pathToFileURL(file).href);
  } finally {
    // Loaded modules are cached but the source is already in memory; removing the directory
    // keeps the checkout clean without affecting this process.
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const WS_A = "/Users/x/wsA";
  const registry = { list: () => [{ id: "ws-a", path: WS_A, title: "A", sessionIds: ["session-A"] }] };
  const seen = [];
  const ctx = {
    effect(fn) { const it = fn(); if (it && typeof it.next === "function") it.next(); },
    on(event, handler) { seen.push({ event, handler }); },
    get(name) { return name === "workspaceRegistry" ? registry : undefined; },
    logger: { warn: () => {} }
  };
  mutant.apply(ctx);
  const reg = seen.find((c) => c.event === "tools/pre-execute");
  if (!reg) fail("the mutated module must still register the middleware (else the mutation is not testing the fix)");
  fs.writeFileSync(TMP_LOCK, JSON.stringify({ enabled: true, kind: "workspace", targetId: WS_A, untilMs: Date.now() + 60000, cooldownMs: 1, unlocks: [] }));
  const verdict = await reg.handler({ name: "bash", agent: { id: "session-A" } }, () => "passed");
  fs.unlinkSync(TMP_LOCK);
  if (!verdict || verdict.kind !== "cancel") {
    fail("the `agent.workspace` mutation went UNDETECTED: it allowed a mutator in the locked workspace (that is exactly the bug)");
  }
  ok("mutation `agent.workspace` is caught: the pre-fix read refuses the locked workspace and §15 sees it");
}

// ---- 17. the agent-shape observation fires once per context --------------
// It exists to answer one question: is `agent.workspace` a PATH (then host and client can
// share one file) or an opaque id (then they cannot)? It must not spam, and it must never
// change a decision.
{
  const observeFile = TMP_OBSERVE;
  const logs = [];
  const ctx = { logger: { info: (x) => logs.push(x), warn: () => {} } };
  mod.observeAgentOnce(ctx, { session: "s", workspace: "/Users/x/ws", big: "y".repeat(200), nested: { a: 1 }, list: [1, 2], nil: null });
  // The point of the observation is to be READABLE: logger output is not reachable on this
  // machine (only crash logs are written), so it must land in a file.
  if (!fs.existsSync(observeFile)) fail("the observation must be written to a readable file");
  const observed = JSON.parse(fs.readFileSync(observeFile, "utf8"));
  if (!/Users\/x\/ws/.test(JSON.stringify(observed.shape))) fail("the file must carry the workspace value");
  if (!observed.at) fail("the file must be timestamped");
  mod.observeAgentOnce(ctx, { session: "other" });
  if (logs.length !== 1) fail("the observation must fire exactly once per context, got " + logs.length);
  if (!/workspace/.test(logs[0])) fail("the observation must include the workspace field");
  if (logs[0].indexOf("y".repeat(200)) !== -1) fail("a long string must be truncated");
  if (!/…/.test(logs[0])) fail("truncation must be visible in the report");
  if (!/"nested":"object"/.test(logs[0])) fail("non-string fields must be reported by type");
  const other = { logger: { info: (x) => logs.push(x) } };
  mod.observeAgentOnce(other, { session: "x" });
  if (logs.length !== 2) fail("a different context must observe again");
  const broken = { logger: { info: () => { throw new Error("logger down"); } } };
  mod.observeAgentOnce(broken, { session: "x" });
  ok("the agent-shape observation is once-per-context, truncated, and crash-proof");
}

// ---- 18. the suite must not touch the user's real files ------------------
// Asserted, not promised: this is the failure mode that already happened once.
{
  const real = path.join(os.homedir(), ".dsh");
  if (mod.lockPath() !== TMP_LOCK) fail("the suite must point the lock away from " + real + ", got " + mod.lockPath());
  if (mod.observationPath() !== TMP_OBSERVE) fail("the suite must point the observation away from " + real);
  if (path.resolve(mod.lockPath()).indexOf(path.resolve(real)) === 0) fail("the lock path must not live under the real ~/.dsh");
  if (path.resolve(mod.observationPath()).indexOf(path.resolve(real)) === 0) fail("the observation path must not live under the real ~/.dsh");
  // The real observation file may exist because the RUNNING app writes it — that is the
  // point of the observation, not a test leak. What must hold is that THIS suite's writes
  // went to the temp path, which the two assertions above establish.
  if (fs.existsSync(TMP_OBSERVE) && path.resolve(TMP_OBSERVE).indexOf(path.resolve(real)) === 0) {
    fail("the suite's observation path must not be inside the real ~/.dsh");
  }
  ok("the suite writes only to a temp dir; the real ~/.dsh is untouched");
}

// ---- 19. the suite writes where it says it does ----------------------------
// It cannot police the real checkout: a REAL lock legitimately writes a workspace mirror, and
// a manual CLI run leaves one too. What it CAN guarantee is that its own tests pointed the CLI
// at its temp dir — that is the property that keeps the real repo clean.
{
  const tempMirrors = ["mirror-main.json", "mirror-history.json"].map((n) => path.join(TMP_DIR, n));
  const made = tempMirrors.filter((f) => fs.existsSync(f));
  if (made.length === 0) fail("the CLI tests must write their mirrors into the temp dir (found none)");
  if (mod.lockPath() === undefined || mod.lockPath().indexOf(TMP_DIR) !== 0) fail("the suite's lock path must live in the temp dir");
  ok("the CLI tests write only into the temp dir (" + made.length + " mirror files there)");
}

console.log("\nFOCUS-LOCK HOST CHECKS PASSED");
