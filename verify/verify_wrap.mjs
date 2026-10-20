// Service-level session-switch interception: the wrapper ported from dsh-probe-lock.
//
// The probe proved on the real app that wrapping ctx.uiWorkspace's five methods covers every
// "switch session" entry point. This suite guards the ported kernel against the four traps the
// probe already paid for, all of which fail SILENTLY in the app:
//   1. a cross-method re-entrancy counter is required (this.x() inside a method resolves to the
//      instance's wrapper, so one user action would be judged N times)
//   2. `this === ws` is the wrong "is this internal?" test (the entry point IS the instance)
//   3. an accessor without a setter silently drops the assignment, so the wrap must READ BACK
//   4. machine-read output must be pure ASCII
// Plus the design rule this plugin runs on: anything unreadable/unjudgeable is ALLOWED
// (better to miss a block than to block the wrong session), and a way out must always exist.
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };
const ok = (m) => console.log("  ok   " + m);

const ME = "session-AAAAAAAA-1111-2222-3333-444444444444";
const OTHER = "session-BBBBBBBB-9999-8888-7777-666666666666";
const THIRD = "session-CCCCCCCC-0000-1111-2222-333333333333";
const KEY = "dsh.deepworker.focusLocal";

/**
 * The workspace ownership account as the app hands it out (§6.1):
 *   items = ctx.uiWorkspace.workspaces.list.getSnapshot().items
 *   item  = { workspaceId, path, title, sessionIds[], createdAt, updatedAt }
 *
 * W_NESTED is deliberately a child directory of W_A: `startsWith` would call it "inside
 * W_A", while the host demands `cwd === path` exactly. It is the fixture that would catch
 * a prefix-based judge.
 */
const W_WS_A = "/Users/x/wsA";
const W_WS_B = "/Users/x/wsB";
const W_NESTED = W_WS_A + "/nested";
const SIBLING = "session-AAAAAAAA-9999-8888-7777-666666666666";
const UNGROUPED = "session-DDDDDDDD-1111-2222-3333-444444444444";
const WORKSPACES = [
  { workspaceId: "ws-a", path: W_WS_A, title: "A", sessionIds: [ME, SIBLING], createdAt: 1, updatedAt: 2 },
  { workspaceId: "ws-b", path: W_WS_B, title: "B", sessionIds: [OTHER], createdAt: 1, updatedAt: 2 },
  { workspaceId: "ws-nested", path: W_NESTED, title: "A/nested", sessionIds: [THIRD], createdAt: 1, updatedAt: 2 }
];


function lockFor(targetId, kind, untilMs) {
  return JSON.stringify({
    enabled: true, kind: kind || "session", targetId: targetId,
    lockedAtMs: 1, untilMs: untilMs === undefined ? Date.now() + 600000 : untilMs,
    cooldownMs: 0, unlocks: []
  });
}

/**
 * What `ctx.uiWorkspace` ACTUALLY is in the running app: a cordis 4 "traceable" Proxy,
 * NOT the Service instance.
 *
 * Measured on this machine by importing the real `@deepseek-ai/cordis@4.0.4` out of the
 * shipped `app.asar` and registering a `class extends Service` under the name
 * "uiWorkspace" (same shape as `@deepseek-ai/dsh-client-ui-workspace/lib/client.js:757,770`):
 *
 *   ctx.uiWorkspace === serviceInstance        -> false      (it is a Proxy)
 *   ws.openSession === ws.openSession          -> false      (a NEW Proxy per read!)
 *   ws.openSession = w; ws.openSession === w   -> false      <<< the real readback-mismatch
 *   ws.openSession("X")                        -> runs w     (the assignment DID land)
 *   Object.getOwnPropertyDescriptor(ws, "openSession").value === w -> true
 *
 * Source of that behaviour (`@deepseek-ai/cordis/lib/index.js`):
 *   :84-90   getTraceable()      — any value carrying `symbols.tracker` (every `Service`
 *                                  gets one in its constructor, :1781) is wrapped
 *   :126-144 createTraceable.get — the function branch (:140-142) returns a fresh
 *                                  `createShadowMethod()` Proxy (:117-122) on every read
 *   :145-152 createTraceable.set — `Reflect.set(target, prop, value, shadow)`: the write
 *                                  lands on the proxied Service instance, so dispatch
 *                                  really does go through the wrapper
 *   (no `getOwnPropertyDescriptor` trap -> the descriptor is the TARGET's own property,
 *    which is why the descriptor read-back is the honest identity check)
 *
 * The stub below reproduces exactly those two axes (fresh identity per read, write lands on
 * the target). It is a fixture, not a copy of cordis: it deliberately omits the ctx-shadow
 * plumbing that is irrelevant to identity.
 */
function traceableProxy(value) {
  // cordis keeps a ctx-extended receiver shadow; identity is what matters here. Without
  // this copy the HAND-OUT object would be missing every own property of the service
  // (measured: a ctx handed out that way loses `workspaces`, and the plugin then reads no
  // ownership account at all — which looks exactly like "the feature is off").
  const shadow = Object.assign({}, value);
  return new Proxy(value, {
    get: (target, prop, receiver) => {
      const inner = Reflect.get(target, prop, target);
      if (typeof inner !== "function") return inner;
      return new Proxy(inner, {
        apply: (fn, thisArg, args) => Reflect.apply(fn, thisArg === receiver ? shadow : thisArg, args)
      });
    },
    set: (target, prop, newValue) => Reflect.set(target, prop, newValue, target)
  });
}

/**
 * Boot the bundle with a real ctx and a REAL latching uiWorkspace, then return the handles.
 * @param handOut — optional `(ws) => handedToCtx`: what `ctx.uiWorkspace` resolves to.
 *                  Default is the bare object (the suite's original stub); the app hands
 *                  out `traceableProxy(ws)`.
 */

function boot(entries, beforeApply, handOut) {
  return bootCode(code, entries, beforeApply, handOut);
}

/**
 * Boot an ARBITRARY copy of the bundle — the same sandbox, the same ctx — so a mutation can
 * be run through the real factory. The mutation test needs this: `code` is read once at the
 * top of the file, and the only honest way to prove an assertion can fail is to execute a
 * version that is known to be wrong.
 */
function bootCode(source, entries, beforeApply, handOut, factorySource) {
  const store = new Map(entries || []);
  const windowObj = { __ModuleLoader__: {}, innerWidth: 1200, innerHeight: 800 };
  let loaded = null;
  windowObj.__ModuleLoader__.load = (r) => { loaded = r; };
  const sandbox = {
    window: windowObj, document: undefined,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, console
  };
  sandbox.globalThis = sandbox;
  const baseRequire = (id) => id === "react" ? { memo: (c) => c }
    : id === "react/jsx-runtime" ? { jsx: () => null, jsxs: () => null, Fragment: Symbol("F") }
      : { Modal: function () {} };
  sandbox.require = baseRequire;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "client.js" });

  const calls = { openSession: 0, openWorkspace: 0, startSession: 0, replaceMain: 0, clearMain: 0 };
  const ws = {
    mainReference: { sessionId: ME },
    // The authoritative ownership account. `sessionIds` decides membership — never a cwd
    // prefix: W_NESTED sits UNDER W_A's path on purpose, because the host compares
    // `cwd === path` exactly and a `startsWith` test would merge two real workspaces.
    workspaces: { list: { getSnapshot: () => ({ items: WORKSPACES }) } },
    openSession: function () { calls.openSession++; },
    // Deliberately NOT a Promise: the wrapper keeps its re-entrancy counter raised until a
    // returned thenable settles, so a never-settling stub would leave depth stuck at 1 and
    // silently turn every later call in this boot into an "internal call". The real host
    // returns a Promise; this suite does not await, so it must return a plain value.
    openWorkspace: function () { calls.openWorkspace++; return undefined; },
    startSession: function () { calls.startSession++; },
    replaceMain: function () { calls.replaceMain++; },
    clearMain: function () { calls.clearMain++; }
  };
  const ctx = {
    effect: (fn) => { try { fn(); } catch (e) { /* a stub effect must not break the load */ } return () => {}; },
    locale: { register: () => {}, bind: () => (k) => k },
    slots: { inject: (n, f) => { f(); }, register: () => {} },
    sessions: { create: async () => "x", list: { getSnapshot: () => ({ ids: [], byId: {} }) } },
    layout: { selectPanel: () => {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
    uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => undefined }) }) },
    uiWorkspace: typeof handOut === "function" ? handOut(ws) : ws,
    remote: {
      session: { prompt: async () => ({ ok: true }) },
      agentPresets: { list: async () => ({ ok: true, value: { presets: [] } }), select: async () => ({ ok: true }) },
      workspace: { create: async () => ({ ok: true }) }
    }
  };
  // ── the workspace ownership account (docs/archive/session-lock-surface.md §6.1) ───────────────
  // `items` is exactly what the app hands out: { workspaceId, path, title, sessionIds[] }
  // and it lives on the uiWorkspace object itself (see the `ws` literal below), so the bare
  // stub AND the traceable Proxy — which reads through to the same target — both serve it.
  // `path` is the LOCK TARGET SPELLING: the service-level decision compares canonical paths,
  // never `workspaceId`.
  // Two ways in, and they exercise the SAME factory:
  //   · the real one: the bundle registers itself through `__ModuleLoader__.load`
  //   · the mutation harness: a *mutated body* is handed in and wrapped back into a factory
  //     (see §10), so a mutation is judged by the real kernel, not by a re-implementation
  let factory = null;
  if (typeof factorySource === "string" && factorySource !== "") {
    // The wrapper takes NO parameters on purpose. The bundle body declares its own
    // `var module`/`var exports`, and a wrapper parameter of the same name would be
    // shadowed — which silently empties the returned object (measured: 0 keys, no `apply`).
    // Calling `factory(sandbox.require, undefined, sandbox.require)` covers both
    // conventions: the bundle's own signature is `(require)`.
    const wrapper = "(function () {\n" + factorySource + "\n  return module.exports;\n})";
    factory = vm.runInContext(wrapper, sandbox, { filename: "mutant-factory.js" });
    if (typeof factory !== "function") throw new Error("the mutant factory did not compile into a function");
  } else {
    factory = loaded.factory;
  }
  const t = typeof factorySource === "string" && factorySource !== ""
    ? factory(sandbox.require, undefined, sandbox.require)
    : factory(sandbox.require);
  // Installed BEFORE apply so the engine captures it as the original method -- the only
  // way to stand in for a method body the engine captured at arm time.
  if (typeof beforeApply === "function") beforeApply(ws, calls);
  t.apply(ctx);
  // `ws` is what the caller/user actually clicks through (i.e. what the ctx handed out);
  // `raw` is the plain object underneath, which is where a landed write must end up.
  const handed = ctx.uiWorkspace;
  return { t, ws: handed, raw: ws, calls, store, readout: () => t.__test.focusWrapReadout() };
}

// ---- 0. THE APP'S REAL SHAPE: ctx.uiWorkspace is a cordis traceable Proxy ---------------
//
// This is the regression the device caught (2026-10-12, user's self-check):
//     unwrapped=openSession,openWorkspace,startSession,replaceMain,clearMain
//     wrapped=0/5 · failed=…:readback-mismatch (all five)
// The wrapping itself was fine -- `ws[name] = w` lands on the Service instance and real
// clicks go through it (that is why the probe's on-device click counters incremented).
// What was wrong is the IDENTITY READ-BACK: on a traceable Proxy the property get hands
// back a fresh Proxy on every read, so `ws[name] === w` can never be true.
// The suite passed anyway because its stub handed out the bare object -- the same blind
// spot that let three boot crashes through. Hence this fixture.
{
  const s = boot(null, null, traceableProxy);
  const r = s.readout();
  if (!/wrapped=5\/5/.test(r)) fail("a cordis traceable Proxy must still wrap 5/5, got: " + r);
  if (/readback-mismatch/.test(r)) {
    fail("identity read-back must tolerate the traceable Proxy (fresh Proxy per get), got: " + r);
  }
  if (!/unwrapped=-/.test(r)) fail("with the Proxy the readout must list nothing unwrapped, got: " + r);
  if (!/proxyReadback=5\/5/.test(r)) {
    fail("the readout must say the wrap was confirmed through the own descriptor, got: " + r);
  }
  // ... and the wrapper must really be on the dispatch path (not merely "not throwing"):
  s.ws.openSession(OTHER);
  s.ws.clearMain();
  if (s.calls.openSession !== 1 || s.calls.clearMain !== 1) {
    fail("unlocked calls through the Proxy must reach the original methods");
  }
  if (s.raw.openSession === undefined) fail("fixture: the underlying object must still hold the methods");
  ok("ctx.uiWorkspace as a cordis traceable Proxy: 5/5 wrapped, identity read-back survives");
}

// ---- 0b. ... and the anti-silent-drop guard must NOT be blinded by that fix -------------
{
  // A frozen target drops `ws[name] = w` silently (the bundle is a sloppy-mode script, so
  // no TypeError). The descriptor then still holds the ORIGINAL function, which must be
  // reported -- if the descriptor fallback accepted anything, this would silently claim
  // "wrapped" for a method that never got wrapped.
  const s = boot(null, null, (w) => Object.freeze(w));
  const r = s.readout();
  if (!/readback-mismatch/.test(r)) {
    fail("a frozen target must still be reported as unwrappable, got: " + r);
  }
  if (!/wrapped=0\/5/.test(r)) fail("a frozen target must not be counted as wrapped, got: " + r);
  ok("a silently-dropped assignment is still caught (the descriptor check is not a rubber stamp)");
}

// ---- 1. the five methods are wrapped (with read-back, not "it did not throw") ------------
{
  const s = boot();
  const r = s.readout();
  if (!/lock=WRAPPED/.test(r)) fail("with no lock the engine must report lock=WRAPPED, got: " + r);
  if (!/wrapped=5\/5/.test(r)) fail("all five methods must be wrapped, got: " + r);
  if (!/unwrapped=-/.test(r)) fail("nothing may be listed as unwrapped, got: " + r);
  ok("all five methods are wrapped and the read-back confirms it");
}

// ---- 2. unlocked / expired / unreadable => PASS THROUGH -----------------------------------
{
  const unlocked = boot();
  unlocked.ws.openSession(OTHER);
  unlocked.ws.clearMain();
  if (unlocked.calls.openSession !== 1 || unlocked.calls.clearMain !== 1) fail("unlocked: nothing may be blocked");
  ok("unlocked: every call passes through");

  const expired = boot([[KEY, lockFor(ME, "session", Date.now() - 1000)]]);
  expired.ws.openSession(OTHER);
  if (expired.calls.openSession !== 1) fail("an expired lock must allow (time is the way out)");
  ok("expired lock: passes through");

  const broken = boot([[KEY, "{not json"]]);
  broken.ws.openSession(OTHER);
  if (broken.calls.openSession !== 1) fail("an unreadable lock must allow");
  ok("unreadable lock: passes through");

  // ---- 2c. a WORKSPACE-kind lock REALLY judges (targetId = the canonical path) ----------
  //
  // This block used to assert `reason === "workspace-unimplemented"` — the old, honest
  // "we do not implement workspace granularity" branch. It is now implemented, using the
  // ownership account rather than the DOM (§6.1: the sidebar is flat, so no DOM ancestor
  // relation exists). Every assertion below is a rule from §6.2/§6.3:
  //   · membership is `sessionIds`, and the compare is EXACTLY equal (a child directory is
  //     its own workspace, so a prefix test would block the wrong session)
  //   · an ungrouped session (a subagent never attaches) must stay openable
  //   · anything unreadable stays openable: better a missed block than a wrong one
  {
    // (a) the target workspace stays open
    const s = boot([[KEY, lockFor(W_WS_A, "workspace")]]);
    s.ws.openSession(ME);
    if (s.calls.openSession !== 1) fail("a session in the LOCKED workspace must still open");
    s.ws.openWorkspace("ws-a");
    if (s.calls.openWorkspace !== 1) fail("openWorkspace(workspaceId) of the locked workspace must pass");
    const own = s.t.__test.focusWrapDecide("openSession", ME);
    if (!own || own.reason !== "target-workspace") fail("a session of the locked workspace must decide target-workspace, got " + JSON.stringify(own));

    // (b) another workspace is blocked, by both spellings
    s.ws.openSession(OTHER);
    if (s.calls.openSession !== 1) fail("a session of ANOTHER workspace must be blocked");
    s.ws.openWorkspace("ws-b");
    if (s.calls.openWorkspace !== 1) fail("openWorkspace of another workspace must be blocked");
    if (!/blocked=openSessionx1/.test(s.readout())) fail("the block must be counted, got: " + s.readout());

    // (c) §6.2 — a CHILD directory is a different workspace; a prefix judge blocks it here
    s.ws.openSession(THIRD);
    if (s.calls.openSession !== 1) fail("a session of a NESTED workspace must be blocked (exact path compare, no prefix)");

    // (d) §6.3 — an ungrouped session (subagent sessions never attach) must open
    s.ws.openSession(UNGROUPED);
    if (s.calls.openSession !== 2) fail("an UNGROUPED session must stay openable while a workspace lock is on");
    const ungrouped = s.t.__test.focusWrapDecide("openSession", UNGROUPED);
    if (!ungrouped || ungrouped.allow !== true || ungrouped.reason !== "unknown-workspace") {
      fail("an ungrouped session must be allowed with reason unknown-workspace, got " + JSON.stringify(ungrouped));
    }

    // (d2) a SIBLING of the target session in the same workspace must stay open — this is the
    // whole point of a workspace-scoped lock ("同工作区内其它会话应能打开"). Revert the exact
    // compare to `!==` and this is the assertion that goes red.
    s.ws.openSession(SIBLING);
    if (s.calls.openSession !== 3) fail("a sibling session of the locked workspace must open, not be blocked");

    // (e) `startSession(undefined)` means "the CURRENT session's workspace" (host :846-853)
    const back = boot([[KEY, lockFor(W_WS_A, "workspace")]]);
    back.ws.startSession();
    if (back.calls.startSession !== 1) fail("startSession() inherits the current workspace, so it must pass");
    const otherHome = boot([[KEY, lockFor(W_WS_A, "workspace")]]);
    otherHome.ws.mainReference = { sessionId: OTHER };
    otherHome.ws.startSession();
    if (otherHome.calls.startSession !== 0) fail("startSession() from another workspace must be blocked");

    // (f) an unreadable account ⇒ everything passes (never lock the user out)
    const blind = boot([[KEY, lockFor(W_WS_A, "workspace")]], function (w) { delete w.workspaces; });
    blind.ws.openSession(OTHER);
    if (blind.calls.openSession !== 1) fail("with no ownership account at all, a workspace lock must allow (fail open)");
    const blindDecision = blind.t.__test.focusWrapDecide("openSession", OTHER);
    if (!blindDecision || blindDecision.allow !== true) fail("an unreadable account must decide allow, got " + JSON.stringify(blindDecision));

    // (g) the app's own shape: the same three outcomes through the traceable Proxy
    const proxied = boot([[KEY, lockFor(W_WS_A, "workspace")]], null, traceableProxy);
    proxied.ws.openSession(ME);
    if (proxied.calls.openSession !== 1) fail("through the traceable Proxy, a session of the locked workspace must pass");
    proxied.ws.openSession(OTHER);
    if (proxied.calls.openSession !== 1) fail("through the traceable Proxy, another workspace must be blocked");
    ok("workspace-kind lock: target + its siblings pass, other/nested workspaces and their sessions are blocked, ungrouped/unreadable pass");
  }

  const unknownKind = boot([[KEY, lockFor(ME, "nonsense")]]);
  unknownKind.ws.openSession(OTHER);
  if (unknownKind.calls.openSession !== 1) fail("an unknown lock kind must allow");
  ok("unknown lock kind: passes through");
}

// ---- 3. locked on ME: OTHER is blocked and the original is NOT called --------------------
{
  const s = boot([[KEY, lockFor(ME)]]);
  const out = s.ws.openSession(OTHER);
  if (s.calls.openSession !== 0) fail("a locked-out session must not reach the original method");
  if (out !== undefined) fail("a blocked call must return undefined, got " + String(out));
  if (!/blocked=openSessionx1/.test(s.readout())) fail("the block must be counted, got: " + s.readout());
  ok("openSession(OTHER) is blocked, returns undefined, and is counted");

  s.ws.openSession(ME);
  if (s.calls.openSession !== 1) fail("the locked session itself must open normally");
  s.ws.openSession(ME.replace(/^session-/, ""));
  if (s.calls.openSession !== 2) fail("a bare uuid must match too (sameSessionId strips the prefix once)");
  ok("the locked session opens, with or without the session- prefix");

  s.ws.openSession({ key: "session:" + OTHER });
  if (s.calls.openSession !== 2) fail("a row-key object must be read as a session id");
  s.ws.replaceMain({ sessionId: OTHER, binding: { target: () => null } });
  if (s.calls.replaceMain !== 0) fail("replaceMain with another session must be blocked");
  ok("row-key objects and session references are judged");

  // A short string is never treated as an id: guessing would block the WRONG session.
  s.ws.openSession("other");
  if (s.calls.openSession !== 3) fail("a short non-id string must be allowed (never guess)");
  ok("a short non-id string is allowed (never guess an id)");
}

// ---- 4. the re-entrancy counter is CROSS-NAME and survives await --------------------------
{
  // Two traps the probe already paid for, both silent in the app:
  //   (a) a per-method-name counter measures 0 for replaceMain while openSession's frame is the one
  //       that is raised => the internal call is judged as a second entry point and blocked;
  //   (b) the counter must STAY raised across an await, or the async continuation leaks in the same
  //       way and a legitimate chain silently does nothing.
  // The stand-in is installed BEFORE apply, because the engine captures the original at arm time,
  // and its body mirrors the host: openSession ends in this.replaceMain(...).
  let stubCalls = 0;
  let replaceCalls = 0;
  const s = boot([[KEY, lockFor(ME)]], function (ws) {
    ws.openSession = function (target) {
      stubCalls++;
      if (stubCalls > 3) throw new Error("recursion");
      return ws.replaceMain(target);                 // the host's async chain
    };
    ws.replaceMain = function () { replaceCalls++; return { then: function (ok) { ok(); } }; };
  });
  s.ws.openSession(ME);                              // an ALLOWED session: the chain must complete
  if (stubCalls !== 1) fail("the entry must run the original exactly once, got " + stubCalls);
  if (replaceCalls !== 1) fail("the internal replaceMain must run exactly once (it was double-judged or dropped), got " + replaceCalls);
  if (/blocked=[^\u00b7]*replaceMain/.test(s.readout())) {
    fail("the internal call must not be recorded as a block, got: " + s.readout());
  }

  // The same shape against a locked-out session: nothing runs, and exactly one block is counted.
  let stub2 = 0;
  let replace2 = 0;
  const s2 = boot([[KEY, lockFor(ME)]], function (ws) {
    ws.openSession = function (target) { stub2++; return ws.replaceMain(target); };
    ws.replaceMain = function () { replace2++; return undefined; };
  });
  s2.ws.openSession(OTHER);
  if (stub2 !== 0 || replace2 !== 0) fail("a locked-out entry must not run anything, got stub=" + stub2 + " replace=" + replace2);
  if (!/blocked=openSessionx1/.test(s2.readout())) fail("the outer block must be counted once, got: " + s2.readout());
  if (/blocked=[^\u00b7]*replaceMain/.test(s2.readout())) fail("a blocked entry must not double-count the inner call, got: " + s2.readout());
  ok("the counter is cross-name and holds through the entry: an allowed chain completes, a blocked one records once");
}

// ---- 5. clearMain / startSession with no target: allowed AND reported ---------------------
{
  const s = boot([[KEY, lockFor(ME)]]);
  s.ws.clearMain();
  s.ws.startSession();
  if (s.calls.clearMain !== 1) fail("clearMain has no session target, so it must be allowed");
  if (s.calls.startSession !== 1) fail("startSession has no session target, so it must be allowed");
  const r = s.readout();
  if (!/unjudgeable=.*clearMain/.test(r) || !/unjudgeable=.*startSession/.test(r)) {
    fail("an unjudgeable method must be reported honestly, got: " + r);
  }
  ok("clearMain/startSession are allowed and reported as unjudgeable (never faked)");
}

// ---- 6. the lock only applies while the user is actually inside the locked session --------
{
  // The host-written mirror is an async cache; if it goes stale it points at a session the user
  // already left. Blocking on that would lock the user out of everything, so the engine only
  // blocks when the lock actually holds for the CURRENT session.
  const s = boot([[KEY, lockFor(ME)]]);
  s.ws.mainReference = { sessionId: OTHER };
  s.ws.openSession(THIRD);
  if (s.calls.openSession !== 1) fail("outside the locked session nothing may be blocked");
  ok("outside the locked session: passes through (no permanent lockout)");
}

// ---- 7. a way out always exists ----------------------------------------------------------
{
  const s = boot([[KEY, lockFor(ME)]]);
  s.ws.openSession(OTHER);
  if (s.calls.openSession !== 0) fail("precondition: the switch must be blocked before the escape");
  s.t.__test.focusWrapEscape("test");
  s.ws.openSession(OTHER);
  if (s.calls.openSession !== 1) fail("after the escape, navigation must work again");
  let back = null;
  try { back = JSON.parse(s.store.get(KEY)); } catch (e) { back = null; }
  if (!back || back.enabled !== false) fail("the escape must also clear the local lock, got " + s.store.get(KEY));
  const r = s.readout();
  if (!/lock=NONE/.test(r) || !/escaped/.test(r)) fail("the escape must be visible in the readout, got: " + r);
  if (!/unwrapped=openSession,openWorkspace,startSession,replaceMain,clearMain/.test(r)) {
    fail("the escape must restore every method, got: " + r);
  }
  ok("the escape unwraps, clears the lock, and is visible in the readout");

  // The real unlock controls and the expiry timer must reach the same teardown.
  if (!/testHooks\.focusUnlockLocal = function \(\) \{[\s\S]{0,400}?focusWrapEscape\("focusUnlockLocal"\)/.test(code)) {
    fail("the unlock handler (header + Settings) must call the teardown");
  }
  if (!/try \{ writeLocalLock\(null\); \} catch \(e\) \{ \/\* ignore \*\/ \}\s*\n\s*try \{ focusWrapUnwrapAll\(\); \} catch \(e2\)/.test(code)) {
    fail("the expiry timer must tear the interception down as well");
  }
  ok("the header button, the Settings button and the expiry timer all reach the teardown");
}

// ---- 7b. re-locking after an escape must RE-INSTALL the interception -----------------------
//
// The device bug (2026-10-15, "关掉再打开就静默死亡"): `focusWrapUnwrapAll` restored the five
// methods but left `focusWrap.armed === true`, while `focusWrapArm` opens with
// `if (focusWrap.armed) return true;`. After ONE escape the plugin was therefore permanently
// unwrapped: no error, no notice, and clicks on other sessions simply went through.
//
// Two things are asserted here, and the second one is why the fix also re-arms from
// `lockFocusLocally`: resetting `armed` alone is NOT enough, because NOTHING re-invokes
// `focusWrapArm` after apply (grep: it is called at apply time and from the 10s retry tick only).
//
// ⚠️ The judge is `Object.getOwnPropertyDescriptor(obj, name).value` — NEVER identity
// (`ws[name] === fn` is always false on cordis's traceable Proxy, which hands out a fresh Proxy
// per read; that is the trap the fixture at the top of this file was built for).
function checkEscapeThenRelock(s) {
  const NAMES = ["openSession", "openWorkspace", "startSession", "replaceMain", "clearMain"];
  const descValue = (n) => {
    const d = Object.getOwnPropertyDescriptor(s.ws, n);
    return d === undefined ? undefined : d.value;
  };
  // ① while locked, the wrapper is on the dispatch path
  s.ws.openSession(OTHER);
  if (s.calls.openSession !== 0) throw new Error("precondition: the switch must be blocked while locked");
  // ② the escape unwraps AND disarms
  s.t.__test.focusWrapEscape("test");
  if (s.t.__test.focusWrapArmed() !== false) {
    throw new Error("after the escape (all methods restored) armed must be false, got " + String(s.t.__test.focusWrapArmed()));
  }
  const r1 = s.readout();
  if (!/unwrapped=openSession,openWorkspace,startSession,replaceMain,clearMain/.test(r1)) {
    throw new Error("after the escape every method must be back to the original, got: " + r1);
  }
  const base = {};
  for (const n of NAMES) base[n] = descValue(n);
  s.ws.openSession(OTHER);
  if (s.calls.openSession !== 1) throw new Error("after the escape navigation must work again");
  // ③ re-locking through the REAL production path must wrap all five again
  s.t.__test.focusLockFor(30);
  if (s.t.__test.focusWrapArmed() !== true) throw new Error("re-locking must arm the wrap again");
  for (const n of NAMES) {
    const v = descValue(n);
    if (typeof v !== "function") throw new Error("re-locking must leave a function on " + n + ", got " + typeof v);
    if (v === base[n]) throw new Error("re-locking must RE-WRAP " + n + " (the descriptor still holds the pre-lock original)");
  }
  const r2 = s.readout();
  if (!/lock=WRAPPED/.test(r2)) throw new Error("after re-locking the readout must say WRAPPED, got: " + r2);
  if (!/unwrapped=-/.test(r2)) throw new Error("after re-locking nothing may be reported unwrapped, got: " + r2);
  // ④ ... and it must actually intercept again
  s.ws.openSession(OTHER);
  if (s.calls.openSession !== 1) throw new Error("after re-locking, switching away must be blocked again");
}
{
  checkEscapeThenRelock(boot([[KEY, lockFor(ME)]]));
  ok("escape disarms + restores; re-locking re-wraps all five and blocks again (bare uiWorkspace)");
  checkEscapeThenRelock(boot([[KEY, lockFor(ME)]], null, traceableProxy));
  ok("... and the same holds on the real shape (cordis traceable Proxy: descriptor judge, no identity)");
}

// ---- 7c. 「一键全关」也要撤销拦截器 —— 在**真机形状**（可追踪 Proxy）上按描述符判据 -------
//
// 2026-10-16 第 4 轮：设置页新增「全部功能（一键全开 / 全关）」总开关，关之前必须先解锁所有
// 锁并撤销拦截器（需求逐字："关掉它之前先解锁所有的锁"）。这条断的是**最难伪造的那一层**：
//   · ctx.uiWorkspace 交给插件的是 cordis 的**可追踪 Proxy**（函数属性每次读取都新建一层
//     Proxy）⇒ `ws[name] === fn` **恒为 false**，身份比较在这里毫无证据力（本机踩过）；
//   · 自有属性描述符**没有** Proxy 陷阱 ⇒ `Object.getOwnPropertyDescriptor(ws, name).value`
//     就是代理目标的真实自有属性 ⇒ 用它证明"包装真的没了"。
//
// ⚠️ 实测得到的一条**反直觉事实**（写在这里免得后人再踩）：在这条真机形状上，撤销**不是**
//    把方法还原成 apply 之前那个裸函数。`focusWrapArm` 的 `orig` 取自 `ctx.uiWorkspace[name]`，
//    而可追踪 Proxy 对函数属性**每次读取都返回新建的一层 shadow Proxy** ⇒ 撤销写回去的是
//    **那个转发代理**，不是裸原函数。所以"回到同一个函数对象"在真机形状上本来就不成立
//    （这是包装内核的既有性质，不是本次改动引入的；`checkEscapeThenRelock` 因此一直拿
//    "escape 之后的读数"而不是"apply 之前的裸函数"作参照）。
//    ⇒ 这条能断且够强的是四件事：① 描述符里**不再是锁着时那个包装函数**；② 是一个函数；
//      ③ 它真的把调用**转发给原实现**（计数 +1）；④ 读数不再说 WRAPPED、armed 为假、
//      `unwrapped=` 列出全部 5 个。而"恢复到裸原函数"由 verify_features.mjs 的裸对象夹具断。
{
  const NAMES = ["openSession", "openWorkspace", "startSession", "replaceMain", "clearMain"];
  const s = boot([[KEY, lockFor(ME)]], null, traceableProxy);
  // 前提：锁着，而且包装真的装上了（否则下面的"撤销"是撤销空气）。
  if (!/lock=WRAPPED/.test(s.readout())) fail("precondition: with a lock armed and the feature on, the wrap must be WRAPPED, readout: " + s.readout());
  s.ws.openSession(OTHER);
  if (s.calls.openSession !== 0) fail("precondition: while the lock holds, switching away must be blocked");
  // 锁着时，代理目标的**自有属性就是包装函数** —— 留一份作参照物。
  const WRAPPED = {};
  for (const n of NAMES) WRAPPED[n] = Object.getOwnPropertyDescriptor(s.raw, n).value;
  const r = s.t.__test.hooks.featureMasterOff();
  if (!r || r.ok !== true) fail("the master all-off must succeed on the real shape, got " + JSON.stringify(r));
  else ok("master all-off succeeds on the traceable-Proxy shape (stage=" + r.stage + ", released=" + JSON.stringify(r.released) + ")");
  if (!(Array.isArray(r.released) && r.released.indexOf("session") !== -1)) {
    fail("the master all-off must report the session-granularity lock it released, got " + JSON.stringify(r.released));
  }
  // ★ 描述符判据：五个方法都必须**不再是锁着时那个包装函数**。
  for (const n of NAMES) {
    const d = Object.getOwnPropertyDescriptor(s.raw, n);
    if (d === undefined || typeof d.value !== "function") {
      fail("after the master all-off " + n + " must hold a function, got " + typeof (d === undefined ? undefined : d.value));
      continue;
    }
    if (d.value === WRAPPED[n]) {
      fail("the master all-off must REMOVE the wrapper on " + n + " — the descriptor still holds the locked-state wrapper (judged by Object.getOwnPropertyDescriptor(...).value, NEVER by identity: on the traceable Proxy identity is always false)");
    }
  }
  ok("all 5 descriptors no longer hold the locked-state wrapper (descriptor judge on the real Proxy target)");
  if (s.t.__test.focusWrapArmed() !== false) fail("after the master all-off the wrap must be disarmed");
  if (/lock=WRAPPED/.test(s.readout())) fail("after the master all-off the readout must not still say WRAPPED: " + s.readout());
  if (!/unwrapped=openSession,openWorkspace,startSession,replaceMain,clearMain/.test(s.readout())) {
    fail("the readout must report all five methods unwrapped after the master all-off, got: " + s.readout());
  }
  // 真的能走了：包装全撤 ⇒ 调用被转发到原实现。
  s.ws.openSession(OTHER);
  if (s.calls.openSession !== 1) fail("after the master all-off navigation must work again (the original must be dispatched)");
  else ok("navigation works again after the master all-off, and the readout names all 5 unwrapped");
}

// ---- 8. the machine-read part is pure ASCII ----------------------------------------------
{
  const s = boot([[KEY, lockFor(ME)]]);
  s.ws.openSession(OTHER);
  const line = s.readout();
  const machine = line.split(" · ").map((x) => x.trim()).filter((x) => /^[a-zA-Z]+=/.test(x));
  if (machine.length === 0) fail("the readout must contain machine-readable fields, got: " + line);
  for (const part of machine) {
    if (!/^[\x20-\x7e]+$/.test(part)) fail("a machine-read field is not ASCII: " + JSON.stringify(part));
  }
  if (!/^lock=(WRAPPED|PARTIAL|NONE)/.test(line)) fail("the lock token must be WRAPPED/PARTIAL/NONE, got: " + line);
  if (!/blocked=/.test(line) || !/unwrapped=/.test(line)) fail("blocked= and unwrapped= must be present, got: " + line);
  ok("every machine-read field is pure ASCII and carries the documented names");
}

// ---- 9. the factory-level `var inject` must ask for uiWorkspace --------------------------
{
  // ⚠️ Two different things are called "inject", and they are not interchangeable:
  //   · `package.json` -> `dsh.client.inject`  = PLUGIN package names (loading order)
  //   · `lib/client.js` -> `var inject = [...]` = CORDIS SERVICE names (what `ctx.xxx`
  //     resolves for this plugin). The framework reads `exports.inject`; the array below
  //     is what gets assigned to it.
  // Measured on the device (2026-10-12): without "uiWorkspace" in the cordis list,
  // `ctx.uiWorkspace` throws "cannot get property … without inject", the arm bails out and
  // every method silently reports as unwrapped. The probe plugin -- which DID wrap 5/5 on
  // the real app -- declares exactly this one service.
  const m = /var inject = \[([^\]]*)\]/.exec(code);
  if (!m) fail("the factory-level `var inject` array is missing");
  const names = m[1].split(",").map((x) => x.trim().replace(/^"|"$/g, "")).filter(Boolean);
  if (names.indexOf("uiWorkspace") === -1) {
    fail("the cordis inject list must contain \"uiWorkspace\", got: " + JSON.stringify(names));
  }
  if (!/exports\.inject = inject;/.test(code)) {
    fail("`var inject` must be handed to the framework via `exports.inject = inject;`");
  }
  const s = boot();
  if (!s.t.inject || s.t.inject.indexOf("uiWorkspace") === -1) {
    fail("exports.inject must carry uiWorkspace, got: " + JSON.stringify(s.t.inject));
  }
  ok("the cordis inject list (not package.json's) declares uiWorkspace and is exported");
}

// ---- 10. the workspace judge is guarded by MUTATION, not by good intentions ---------------
//
// "The suite passes" is worth exactly as much as the suite's ability to fail. Four versions
// of the bundle, each broken in one specific way, are executed through the real factory:
//   A1  no ownership account at all (the true pre-fix state: cwd/sessionIds lookups yielded "")
//   A2  membership read from `cwd` instead of the account (the tempting shortcut §6.2 forbids)
//   B   the old "workspace granularity is not implemented" branch, verbatim
//   C   the exact compare inverted (a target workspace would be blocked, another allowed)
// Every one of them MUST produce a refusal that the block-2c assertions above would catch.
const MUTATIONS = [
  { id: "A1", why: "the ownership account is unreadable (the pre-fix state)",
    from: 'var model = ctx && ctx.uiWorkspace ? ctx.uiWorkspace.workspaces : null;',
    to: 'var model = null;' },
  { id: "A2", why: "membership taken from cwd instead of the ownership account",
    from: 'if (focusWrapSessionId(ids[k]) === want) return typeof w.path === "string" ? w.path : "";',
    to: 'if (false) return typeof w.path === "string" ? w.path : "";\n              var row = ctx.sessions.list.getSnapshot().byId[want];\n              if (row && row.cwd === w.path) return w.path;' },
  // ⚠️ from 必须**唯一**：`if (lock.kind === "workspace") {` 现在在计时判定里也出现一次
  //    （任务 9），只按它匹配会让本套件在「matches more than once」上红。带上它前面那行
  //    就唯一定位到 focusWrapDecide 的这一支。
  { id: "B", why: "the old \"workspace granularity is not implemented\" branch",
    from: 'if (lock === null) return { allow: true, reason: "unlocked" };\n        if (lock.kind === "workspace") {',
    to: 'if (lock === null) return { allow: true, reason: "unlocked" };\n        if (lock.kind === "workspace") { return { allow: true, reason: "workspace-unimplemented", lock: lock }; } if (false) {' },
  { id: "C", why: "the exact path compare inverted",
    from: 'if (wsPath === lock.targetId) return { allow: true, reason: "target-workspace", target: wsPath, lock: lock };\n          return { allow: false, reason: "blocked-workspace", target: wsPath, lock: lock };',
    to: 'if (wsPath !== lock.targetId) return { allow: true, reason: "target-workspace", target: wsPath, lock: lock };\n          return { allow: false, reason: "blocked-workspace", target: wsPath, lock: lock };' }
];

/**
 * Boot a mutated copy of the bundle's factory — in the same sandbox, with the same ctx, so a
 * mutation is judged by the real kernel rather than by a re-implementation of it.
 *
 * `code` ends with `return module.exports;` (the bundle's factory body), so it can be wrapped
 * straight back into a function expression. The epilogue is exactly what the bundle's own
 * factory prologue declares — nothing is stubbed out.
 */
function bootMutant(mutantBody) {
  const s = bootCode(null, [[KEY, lockFor(W_WS_A, "workspace")]], null, undefined, mutantBody);
  const byName = {};
  for (const n of ["openSession", "openWorkspace", "startSession", "replaceMain", "clearMain"]) {
    byName[n] = Object.getOwnPropertyDescriptor(s.ws, n).value;
  }
  return { s, byName };
}

/**
 * The bundle's factory BODY: the text between `factory: (require) => {` and the matching
 * close of that arrow function, with the trailing `return module.exports;` removed.
 *
 * Brace counting rather than a regex: the body is a 346 KB program full of object literals
 * and template braces, and a lazy match would cut it at the first `}`.
 */
function factoryBodyOf(src) {
  const start = src.indexOf("factory: (require) => {");
  if (start < 0) throw new Error("the bundle's factory prologue was not found");
  const open = src.indexOf("{", start);
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) break; }
  }
  let body = src.slice(open + 1, i);
  const ret = body.lastIndexOf("return module.exports;");
  if (ret < 0) throw new Error("the bundle's factory epilogue was not found");
  return body.slice(0, ret);
}
const FACTORY_BODY = factoryBodyOf(code);

for (const m of MUTATIONS) {
  if (FACTORY_BODY.indexOf(m.from) === -1) {
    fail("mutation " + m.id + " no longer matches the bundle — the guard has drifted: " + JSON.stringify(m.from.slice(0, 70)));
  }
  if (FACTORY_BODY.split(m.from).length - 1 !== 1) {
    fail("mutation " + m.id + " matches more than once; it would no longer be a single-point mutation");
  }
  const { byName } = bootMutant(FACTORY_BODY.replace(m.from, m.to));
  // Each probe names the concrete harm, so a red result says what the guard is protecting.
  const caught = [
    ["a sibling session of the target workspace would be refused", () => byName.openSession(SIBLING) === undefined],
    ["another workspace would not be refused", () => byName.openWorkspace("ws-b") === undefined],
    ["an ungrouped session would be refused", () => byName.openSession(UNGROUPED) === undefined],
    ["a nested (child-directory) workspace would not be refused", () => byName.openSession(THIRD) === undefined]
  ].filter(([, probe]) => { try { return probe() === true; } catch (e) { return true; } });
  if (caught.length === 0) {
    fail("mutation " + m.id + " (" + m.why + ") went UNDETECTED — the workspace assertions cannot fail");
  }
  ok("mutation " + m.id + " is caught (" + m.why + "): " + caught[0][0] + (caught.length > 1 ? " (+" + (caught.length - 1) + " more)" : ""));
}

// ---- 11. MUTATION for the re-lock guard: drop the `armed` reset => the guard MUST go red ----
//
// "The suite passes" is worth what its ability to fail is worth. The mutant below is the exact
// pre-fix state (`focusWrapUnwrapAll` restores the methods but never clears `armed`), executed
// through the real factory, judged by the SAME `checkEscapeThenRelock` the guard uses — not by a
// paraphrase of it.
{
  const FROM = "try { focusWrap.armed = false; } catch (e) { ok = false; }";
  const hits = FACTORY_BODY.split(FROM).length - 1;
  if (hits !== 1) {
    fail("the armed-reset mutation no longer matches uniquely (" + hits + " hits) — the guard has drifted: " + JSON.stringify(FROM));
  }
  const s = bootCode(null, [[KEY, lockFor(ME)]], null, undefined,
    FACTORY_BODY.replace(FROM, "/* armed reset removed by the mutation */"));
  let red = null;
  try { checkEscapeThenRelock(s); } catch (e) { red = String((e && e.message) || e); }
  if (red === null) fail("mutation D (the armed reset removed) went UNDETECTED — the re-lock guard cannot fail");
  ok("mutation D is caught (the armed reset removed): " + red);
}

// ---- 12. MUTATION for the re-arm call: dropping it must ALSO go red ------------------------
//
// This one pins down WHY the fix touches two places. Resetting `armed` inside `focusWrapUnwrapAll`
// is necessary but NOT sufficient: nothing re-invokes `focusWrapArm` after apply, so without the
// re-arm in `lockFocusLocally` the "锁一次 → 解除 → 再锁" flow still cannot intercept. The mutant
// below removes that call and MUST fail the same guard.
{
  const FROM = "          try { focusWrapArm(ctx); } catch (e) { /* ignore */ }\n";
  const hits = FACTORY_BODY.split(FROM).length - 1;
  if (hits !== 1) {
    fail("the re-arm mutation no longer matches uniquely (" + hits + " hits) — the guard has drifted: " + JSON.stringify(FROM));
  }
  const s = bootCode(null, [[KEY, lockFor(ME)]], null, undefined,
    FACTORY_BODY.replace(FROM, "          /* re-arm removed by the mutation */\n"));
  let red = null;
  try { checkEscapeThenRelock(s); } catch (e) { red = String((e && e.message) || e); }
  if (red === null) fail("mutation E (the re-arm on lock removed) went UNDETECTED — the re-arm is not load-bearing");
  ok("mutation E is caught (the re-arm on lock removed): " + red);
}

console.log("\nSESSION-SWITCH INTERCEPTION CHECKS PASSED");
// This suite boots the whole bundle a dozen times, and each boot leaves the plugin's own
// 2s focus poll armed; a plain exit would keep the process alive. Success is already
// established above, so terminate deliberately.
process.exit(0);
