// Client-side half of the focus lock: parsing the state out of the transcript and deciding
// whether a navigation is allowed. Pure functions only — the wiring (click interception, the
// settings panel) is asserted separately once it exists.
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };
const ok = (m) => console.log("  ok   " + m);

const store = new Map();
const windowObj = { __ModuleLoader__: {}, innerWidth: 1200, innerHeight: 800 };
let loaded = null;
windowObj.__ModuleLoader__.load = (r) => { loaded = r; };
const reactMock = { memo: (c) => c, useState: (i) => [i, () => {}], useRef: (i) => ({ current: i }), useEffect: () => {} };
const jsxMock = { jsx: (...a) => a, jsxs: (...a) => a, Fragment: Symbol("F") };
const primitivesMock = { Modal: function () {}, Button: function () {}, IconListPenOutlineRegular: function () {} };
const mockRequire = (id) => id === "react" ? reactMock
  : id === "react/jsx-runtime" ? jsxMock
  : id === "@deepseek-ai/dsh-client-ui-primitives" ? primitivesMock
  : (() => { throw new Error("unexpected " + id); })();
const sandbox = {
  window: windowObj, document: undefined,
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  require: mockRequire, TextEncoder, btoa, atob, TextDecoder, setTimeout, clearTimeout,
  Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, console
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "client.js" });
const t = loaded.factory(mockRequire);
t.apply({
  effect: (fn) => { fn(); return () => {}; },
  locale: { register: () => {}, bind: () => (k) => k },
  slots: { inject: (n, f) => { f(); }, register: () => {} },
  sessions: { create: async () => "x", list: { getSnapshot: () => ({ ids: [], byId: {} }) } },
  layout: { selectPanel: () => {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
  uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => undefined }) }) },
  uiWorkspace: { openSession: () => {}, archiveSession: async () => {}, mainReference: { sessionId: "s" }, workspaces: { list: { getSnapshot: () => ({ items: [] }) } }, pickDirectory: async () => "" },
  remote: { session: { prompt: async () => ({ ok: true }) }, agentPresets: { list: async () => ({ ok: true, value: { presets: [] } }), select: async () => ({ ok: true }) }, workspace: { create: async () => ({ ok: true }) } }
});
const api = t.__test;
const NOW = 1700000000000;

// ---- 1. parsing: the LAST marker wins ------------------------------------
{
  const locked = "[focus-lock-state] " + JSON.stringify({ locked: true, kind: "session", targetId: "sess-A", until: new Date(NOW + 60000).toISOString(), canUnlockNow: false, waitSeconds: 600, unlocks: 2 });
  const state = api.parseFocusLockState("noise\n" + locked + "\n");
  if (state === null || state.locked !== true) fail("a valid marker must parse");
  if (state.kind !== "session" || state.targetId !== "sess-A") fail("the parsed state must carry kind and target");
  if (state.untilMs !== NOW + 60000) fail("the expiry must parse from the ISO string, got " + state.untilMs);
  if (state.unlocks !== 2) fail("the unlock count must parse");
  const two = "x\n" + locked + "\n[focus-lock-state] " + JSON.stringify({ locked: false }) + "\n";
  if (api.parseFocusLockState(two).locked !== false) fail("an unlock AFTER a lock must win");
  const reverse = "[focus-lock-state] " + JSON.stringify({ locked: false }) + "\n" + locked;
  if (api.parseFocusLockState(reverse).locked !== true) fail("a lock AFTER an unlock must win");
  if (api.parseFocusLockState("nothing here") !== null) fail("text without a marker must yield null");
  if (api.parseFocusLockState("") !== null) fail("empty text must yield null");
  if (api.parseFocusLockState(null) !== null) fail("null must yield null");
  if (api.parseFocusLockState("[focus-lock-state] {not json") !== null) fail("a corrupt marker must yield null");
  if (api.parseFocusLockState("[focus-lock-state] " + JSON.stringify({ locked: true })) !== null) fail("an armed marker without kind/target must yield null");
  // kind+target valid but the expiry missing: this is the ONLY input that reaches the expiry
  // guard, so without it that guard could be deleted and nothing would notice.
  if (api.parseFocusLockState("[focus-lock-state] " + JSON.stringify({ locked: true, kind: "session", targetId: "s" })) !== null) fail("a marker without an expiry must yield null");
  if (api.parseFocusLockState("[focus-lock-state] " + JSON.stringify({ locked: true, kind: "session", targetId: "s", until: "not a date" })) !== null) fail("a marker with an unparseable expiry must yield null");
  ok("parsing: newest marker wins, corrupt and partial input yield null");
}

// ---- 2. holding: live AND inside ----------------------------------------
{
  const armed = { locked: true, kind: "session", targetId: "sess-A", untilMs: NOW + 60000, canUnlockNow: false, waitSeconds: 600, unlocks: 0 };
  if (api.focusHolds(armed, { sessionId: "sess-A" }, NOW) !== true) fail("inside a live lock must hold");
  if (api.focusHolds(armed, { sessionId: "sess-B" }, NOW) !== false) fail("outside the lock must not hold");
  if (api.focusHolds(armed, { sessionId: "sess-A" }, NOW + 60001) !== false) fail("an EXPIRED lock must not hold — time is a way out");
  if (api.focusHolds(null, { sessionId: "sess-A" }, NOW) !== false) fail("no state must not hold");
  if (api.focusHolds({ locked: false }, { sessionId: "sess-A" }, NOW) !== false) fail("an unlocked state must not hold");
  const ws = { locked: true, kind: "workspace", targetId: "ws-1", untilMs: NOW + 60000 };
  if (api.focusHolds(ws, { workspaceId: "ws-1" }, NOW) !== true) fail("inside the locked workspace must hold");
  if (api.focusHolds(ws, { workspaceId: "ws-2" }, NOW) !== false) fail("another workspace must not hold");
  if (api.focusHolds(ws, { sessionId: "x" }, NOW) !== false) fail("an unknown workspace must not coerce into holding");
  ok("holding: live and inside, and never by accident");
}

// ---- 3. verdict: what may the user do -----------------------------------
{
  const armed = { locked: true, kind: "session", targetId: "sess-A", untilMs: NOW + 60000 };
  const here = { sessionId: "sess-A" };
  if (api.focusVerdict(armed, here, { sessionId: "sess-A" }, NOW).blocked !== false) fail("staying put must be allowed");
  const away = api.focusVerdict(armed, here, { sessionId: "sess-B" }, NOW);
  if (away.blocked !== true) fail("leaving the locked session must be blocked");
  if (!/专注锁/.test(away.reason || "")) fail("the block must explain itself, got " + JSON.stringify(away.reason));
  // An ISO instant, not a specific year: the fixture clock is an epoch value, so hard-coding
  // a year here would encode the fixture rather than the contract.
  if (!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(away.reason)) fail("the reason must carry an ISO instant, got " + JSON.stringify(away.reason));
  if (api.focusVerdict(armed, { sessionId: "sess-B" }, { sessionId: "sess-A" }, NOW).blocked !== false) {
    fail("when the lock is NOT held, navigation is unrestricted (the lock is not a leash)");
  }
  if (api.focusVerdict(armed, here, { sessionId: "sess-A" }, NOW + 60001).blocked !== false) fail("after expiry nothing is blocked");
  const wsArmed = { locked: true, kind: "workspace", targetId: "ws-1", untilMs: NOW + 60000 };
  if (api.focusVerdict(wsArmed, { workspaceId: "ws-1" }, { workspaceId: "ws-1" }, NOW).blocked !== false) fail("a sibling session in the locked workspace is allowed");
  if (api.focusVerdict(wsArmed, { workspaceId: "ws-1" }, { workspaceId: "ws-2" }, NOW).blocked !== true) fail("another workspace is blocked");
  if (api.focusVerdict(wsArmed, { workspaceId: "ws-1" }, {}, NOW).blocked !== true) fail("an unknown target is blocked while locked (fail closed on navigation)");
  ok("verdict: staying allowed, leaving explained, expiry and outside-state unrestricted");
}

// ---- 4. row keys -------------------------------------------------------
{
  const t1 = api.focusRowTarget("session:abc");
  if (!t1 || t1.sessionId !== "abc") fail("session:<id> must parse to a session target");
  const t2 = api.focusRowTarget("workspace:ws-key");
  if (!t2 || t2.workspaceId !== "ws-key") fail("workspace:<key> must parse to a workspace target");
  for (const bad of ["", "group:x", "session:", "workspace:", null, undefined, 42]) {
    if (api.focusRowTarget(bad) !== null) fail("this must not parse as a target: " + JSON.stringify(bad));
  }
  ok("row keys: session and workspace rows parse, everything else is left alone");
}

// ---- 5. the interception, driven through a minimal DOM ------------------
// Behavioural, not structural: fire a real click at the listener and watch what it does to
// the event and to the notice. Capture-phase ordering is the point — it must win before the
// sidebar's own handler navigates.
{
  const listeners = [];
  const doc = {
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
    removeEventListener: () => {}
  };
  const row = (key) => ({
    getAttribute: () => key,
    closest: (sel) => (sel === "[data-row-key]" ? rowInstance : null)
  });
  let rowInstance = null;
  // The suite starts with no document (so the plugin's DOM paths stay inert). The interceptor
  // reads the global at call time, so injecting one here is enough to exercise it.
  sandbox.document = doc;
  const notices = [];
  const state = { locked: true, kind: "session", targetId: "sess-A", untilMs: Date.now() + 60000, unlocks: 0 };
  const dispose = api.installFocusClicks({
    readState: () => state,
    current: () => ({ sessionId: "sess-A" }),
    notify: (reason) => notices.push(reason)
  });
  // apply() installs other listeners too (reference chips), so assert on OURS: the one this
  // call just added, and it must be in the capture phase or the sidebar navigates first.
  if (listeners.length === 0) fail("a click listener must be installed");
  const mine = listeners[listeners.length - 1];
  if (mine.capture !== true) fail("the focus listener MUST be in the capture phase");
  if (typeof dispose !== "function") fail("installation must return a disposer");
  const fire = (target) => {
    const ev = { target, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
    mine.fn(ev);
    return ev;
  };

  rowInstance = row("session:sess-B");
  const away = fire({ closest: () => rowInstance });
  if (!away.defaultPrevented || !away.stopped) fail("a blocked click must be cancelled AND stopped before the row handler runs");
  if (notices.length !== 1 || !/专注锁/.test(notices[0])) fail("the blocked click must be explained");

  rowInstance = row("session:sess-A");
  const stay = fire({ closest: () => rowInstance });
  if (stay.defaultPrevented || stay.stopped) fail("the LOCKED target must stay clickable — the lock is not a jail");
  rowInstance = row("group:whatever");
  const other = fire({ closest: () => rowInstance });
  if (other.defaultPrevented) fail("a row that is not a navigation target must be untouched");
  const noRow = fire({ closest: () => null });
  if (noRow.defaultPrevented) fail("a click outside any row must be untouched");
  if (notices.length !== 1) fail("an allowed click must not produce a notice");

  // Expired: nothing is blocked, so the way out is time itself.
  state.untilMs = Date.now() - 1;
  rowInstance = row("session:sess-B");
  if (fire({ closest: () => rowInstance }).defaultPrevented) fail("an expired lock must block nothing");
  state.locked = false;
  if (fire({ closest: () => rowInstance }).defaultPrevented) fail("an unlocked state must block nothing");
  if (typeof dispose === "function") dispose();
  ok("interception: blocked rows cancelled in capture phase, allowed rows untouched, expiry respected");
}

// ---- 6. the request text the UI can send --------------------------------
// The client cannot write the lock, so the composer is its channel. The wording is the
// contract between the UI and the agent, so it is asserted rather than eyeballed.
{
  const lock = api.focusRequestText("lock", "session", 45);
  if (!/专注锁/.test(lock)) fail("the request must be recognisable as a focus-lock request");
  if (!/会话/.test(lock)) fail("a session request must say so");
  if (!/45/.test(lock)) fail("the duration must be carried, got " + JSON.stringify(lock));
  if (!/冷却/.test(lock)) fail("the cooldown must be mentioned so the agent uses the default 10 minutes");
  const ws = api.focusRequestText("lock", "workspace", 30);
  if (!/工作区/.test(ws)) fail("a workspace request must say so");
  const unlock = api.focusRequestText("unlock", "session", 30);
  if (!/解锁/.test(unlock)) fail("an unlock request must say unlock");
  if (/锁上/.test(unlock)) fail("an unlock request must not also ask to lock");
  const bad = api.focusRequestText("lock", "session", -5);
  if (!/30/.test(bad)) fail("a bad duration must fall back to 30 minutes");
  ok("request text: kind, duration and cooldown are all stated");
}

// ---- 7. the wiring exists ----------------------------------------------
// The settings page is framework-rendered, so the component reaches apply scope through the
// runtime seam. Asserted by reading the source: this is the shape that has broken before.
{
  const src = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  // The seam is now a wrapper that refreshes the workspace-file cache first (the transcript is
  // only a fallback — tool output never reaches the DOM, measured).
  if (!/testHooks\.readFocus = function \(\) \{[\s\S]{0,500}?effectiveFocusState\(\)/.test(src)) fail("apply must fill the readFocus seam with the effective-state reader (local lock included), not just the host-file cache");
  // The new channel: the CLI writes the lock JSON into the session's workspace and the client
  // reads it through the workspace-file remote (content, not DOM).
  if (!/remote\.workspaceFiles/.test(src)) fail("the client must read the lock state through remote.workspaceFiles");
  // range is REQUIRED (measured: "workspaceFiles/read expected 3 business argument(s) ... got 2").
  // The range's offset is a 1-BASED line number: the host validates integerAtLeast(offset, 1)
  // and rejects 0 with gateway/bad-request (measured, and read from the host source).
  if (!/api\.read\(id, FOCUS_FILE, \{ offset: 1, limit: 100 \}\)/.test(src)) fail("the reader must pass range {offset: 1, limit: 100} — offset 0 is rejected");
  if (/api\.read\(id, FOCUS_FILE, \{ offset: 0/.test(src)) fail("offset 0 must never be sent: the host requires >= 1");
  if (!/"remote\.workspaceFiles"/.test(src)) fail("remote.workspaceFiles must be declared in inject, or the proxy is absent");
  if (!/testHooks\.requestFocus = requestFocus/.test(src)) fail("apply must fill the requestFocus seam");
  if (!/typeof testHooks\.readFocus === "function"/.test(src)) fail("the settings component must read through the seam");
  // ── 2026-10-15 改版：设置页**不再**经 requestFocus 发"请求解锁" ───────────────────────
  // 理由：宿主侧的守卫插件已从 profile 摘除，"发一条消息请求解锁"的语义已经不存在；实际
  // 行为一直是本地立即解锁。所以断言改成"文案与行为一致"，并**禁止**那个转调包装复活
  // （它曾是设置页里的死代码：定义了却一处都不调）。
  if (!/testHooks\.focusUnlockLocal/.test(src)) fail("the settings component must unlock through the local seam");
  if (!/"focus\.unlockSession": "立即解锁"/.test(src)) fail("the unlock label must say what the action does (立即解锁), not 请求解锁");
  if (/var requestFocus = function \(action, kind\)/.test(src)) fail("the dead requestFocus wrapper must not come back into the settings component");
  if (!/focus\.requested/.test(src)) fail("the request must be confirmed to the user");
  if (!/(?:t|translate)\("focus\.free"\)/.test(src) || !/(?:t|translate)\("focus\.locked"\)/.test(src)) fail("both lock states must be rendered (directly or through describeFocusState)");
  if (!/function installFocusClicks/.test(src)) fail("the click interception must exist");
  ok("wiring: the settings page reaches the live logic through the seam and renders both states");
}

// ---- 8. native notices (this suite has the live client harness) ----------
// The app window's Electron session grants every non-media permission, so a system
// notification is possible; there is no menu-bar icon to attach one to (DSH's tray is
// Windows-only and main-process-owned). The failure that matters is a notice that appears
// neither natively nor as a bubble — a lost message.
{
  const cases = [
    [{ enabled: true, supported: true, permission: "granted" }, true, false],
    [{ enabled: true, supported: true, permission: "default" }, true, false],
    [{ enabled: true, supported: true, permission: "denied" }, false, true],
    [{ enabled: false, supported: true, permission: "granted" }, false, true],
    [{ enabled: true, supported: false, permission: "granted" }, false, true],
    [{ enabled: true, supported: true, permission: "weird" }, false, true],
    [null, false, true],
    [{}, false, true]
  ];
  for (const [input, native, inPage] of cases) {
    const plan = api.notifyPlan(input);
    if (plan.native !== native || plan.inPage !== inPage) {
      fail("notifyPlan(" + JSON.stringify(input) + ") must be {" + native + "," + inPage + "}, got " + JSON.stringify(plan));
    }
    // The invariant that matters: every plan delivers the notice one way or the other.
    if (!plan.native && !plan.inPage) fail("a plan that neither goes native nor falls back loses the message");
  }
  ok("native notices: granted/default go native, everything else falls back — never silent");
}

// ---- 8. native notices (asserted here: this is the suite with a live client harness) ----
// The app window's Electron session grants every non-media permission, so a system
// notification is possible. There is no menu-bar icon to attach one to (DSH's tray is
// Windows-only and main-process-owned). The failure that matters is a notice that appears
// neither natively nor as a bubble — a lost message.
{
  if (api.notifyPlan({ enabled: true, supported: true, permission: "granted" }).native !== true) fail("granted + supported + enabled must go native");
  if (api.notifyPlan({ enabled: true, supported: true, permission: "granted" }).inPage !== false) fail("a native notice must not also draw a bubble");
  if (api.notifyPlan({ enabled: true, supported: true, permission: "default" }).native !== true) fail("Electron reports 'default'; it must still be attempted");
  if (api.notifyPlan({ enabled: true, supported: true, permission: "denied" }).inPage !== true) fail("a denied permission must fall back to the bubble");
  if (api.notifyPlan({ enabled: false, supported: true, permission: "granted" }).native !== false) fail("the setting must be able to turn it off");
  if (api.notifyPlan({ enabled: true, supported: false, permission: "granted" }).inPage !== true) fail("no Notification API must fall back");
  if (api.notifyPlan(null).inPage !== true) fail("missing input must fall back");
  const cases = [{ enabled: true, supported: true, permission: "granted" }, { enabled: true, supported: true, permission: "default" },
    { enabled: true, supported: true, permission: "denied" }, { enabled: false, supported: true, permission: "granted" },
    { enabled: true, supported: false, permission: "granted" }, null, {}, { enabled: true, supported: true, permission: "weird" }];
  for (const input of cases) {
    const plan = api.notifyPlan(input);
    // The invariant: every plan delivers the notice one way or the other.
    if (plan.native !== true && plan.inPage !== true) fail("every plan must deliver: " + JSON.stringify(input));
  }
  ok("native notices: granted/default go native, everything else falls back — never silent");
}

// ---- 9. a notice must ALWAYS draw the bubble (regression) -----------------
// The bug this guards: `if (raiseNotice(text)) return;` skipped the in-page bubble whenever
// `new Notification()` merely did not throw — which is not evidence the user saw anything.
// macOS can deny or silence it, and then EVERY notice vanished silently. The bubble is the
// guaranteed channel; the system notification only rides along.
{
  const created = [];
  const doc = {
    addEventListener: () => {}, removeEventListener: () => {},
    createElement: (tag) => { const el = { tagName: tag, style: { cssText: "", setProperty() {} }, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, removeAttribute() {}, remove() {}, appendChild() {}, addEventListener() {}, textContent: "", innerHTML: "" }; created.push(el); return el; },
    body: { appendChild: () => {} },
    querySelector: () => null, querySelectorAll: () => [], head: { appendChild: () => {} }
  };
  const sandboxDoc = sandbox.document;
  sandbox.document = doc;
  const raised = [];
  sandbox.window.Notification = function (title, opts) { raised.push({ title, body: opts && opts.body }); };
  sandbox.window.Notification.permission = "granted";
  sandbox.window.innerWidth = 1200; sandbox.window.innerHeight = 800;
  let threw = null;
  try { t.__test.showNotice("测试提示", { clientX: 10, clientY: 10 }); } catch (e) { threw = e; }
  if (threw !== null) fail("showNotice must not throw: " + threw.message);
  const bubble = created.filter((el) => el.attributes && el.attributes["data-history-actions-notice"] !== undefined);
  if (bubble.length === 0) fail("the in-page bubble MUST be drawn even when a native notification is raised (else notices vanish silently)");
  if (raised.length === 0) fail("the native notification should still be attempted alongside the bubble");
  if (bubble[0].textContent !== "测试提示") fail("the bubble must carry the text, got " + JSON.stringify(bubble[0].textContent));
  delete sandbox.window.Notification;
  sandbox.document = sandboxDoc;
  ok("a notice always draws the bubble, and the native notification rides along");
}

// ---- 10. the quote-jump menu must not appear on un-quoted turns ------------
// Reported bug: right-clicking a plain user message offered 「跳到引用出处」. Cause: the
// decision fell back to "does this turn's text contain a remembered quote's body" — and a
// message whose own text was once quoted matches itself. The marker is the honest signal.
{
  const anchored = "答复正文\n▍ 原文\n▍ ↳ 引自本轮第 3 轮 · seq 42";
  const plain = "SPM是什么";
  const twoAnchors = "a\n↳ 引自本轮第 2 轮 · seq 7\nb\n↳ 引自本轮第 5 轮 · seq 9";
  if (api.quoteJumpPlan(plain, "", []).mode !== "none") fail("a turn with no anchor and no selection must offer NO jump item");
  if (api.quoteJumpPlan(anchored, "", [{ turn: 3, seq: 42 }]).mode !== "single") fail("one anchor in the turn must offer exactly one jump item");
  if (api.quoteJumpPlan(twoAnchors, "", [{ turn: 2, seq: 7 }, { turn: 5, seq: 9 }]).mode !== "multiple") fail("two anchors must offer a choice");
  if (api.quoteJumpPlan(plain, "   ", []).mode !== "none") fail("a whitespace-only selection must not enable the jump");
  if (api.quoteJumpPlan(plain, "选中的一段字", []).mode !== "selected") fail("a real selection keeps the 'where did this come from' path");
  if (api.quoteJumpPlan(anchored, "选中", [{ turn: 3 }]).mode !== "single") fail("an anchor outranks a selection");
  if (api.quoteJumpPlan(null, null, undefined).mode !== "none") fail("missing input must not offer a jump");
  ok("quote jump: offered only for the turn's own anchor, or for a real selection");
}

// ---- 11. 「回退到此」 was DELETED on 2026-10-17 (user: it is no longer needed) ----
// The planner and its test seam must be gone with the feature. A leftover export would mean
// dead code is still shipped, and that some call path into the removed entry still exists.
// (The row/menu behaviour around the deletion is asserted in verify_turn_tail_row.mjs.)
{
  if (typeof api.rollbackPlan !== "undefined") fail("the rollback planner must be gone with the feature");
  ok("rollback: entry, handler, planner and test seam are all gone");
}

// ---- 12. session ids may differ by a `session-` prefix ---------------------
// Measured: the host's agent id is `session-<uuid>`; the client's own reference may be the
// bare uuid. A strict === made the whole UI lock silently inert.
{
  if (api.sameSessionId("session-abc", "abc") !== true) fail("the session- prefix must not defeat the comparison");
  if (api.sameSessionId("abc", "session-abc") !== true) fail("prefix on the other side must work too");
  if (api.sameSessionId("session-abc", "session-abc") !== true) fail("identical ids must match");
  if (api.sameSessionId("abc", "abd") !== false) fail("different ids must not match");
  if (api.sameSessionId("", "abc") !== false) fail("an empty id must never match");
  if (api.sameSessionId(null, null) !== false) fail("nulls must never match");
  const armed = { locked: true, kind: "session", targetId: "session-abc", untilMs: Date.now() + 60000 };
  if (api.focusHolds(armed, { sessionId: "abc" }, Date.now()) !== true) fail("holding must survive the prefix difference");
  if (api.focusVerdict(armed, { sessionId: "abc" }, { sessionId: "other" }, Date.now()).blocked !== true) fail("the click away must be blocked despite the prefix difference");
  ok("session ids: a `session-` prefix no longer defeats the lock");
}

// ---- 13. notice scope: only-this-session + mute list ------------------------
{
  const free = api.noticeAllowed({ settings: {}, sessionId: "session-a" });
  if (free.allowed !== true) fail("with no scope set every session must be notified");
  const only = api.noticeAllowed({ settings: { noticeOnlySession: "session-a" }, sessionId: "a" });
  if (only.allowed !== true) fail("the chosen session must still notify (prefix difference must not matter)");
  const other = api.noticeAllowed({ settings: { noticeOnlySession: "session-a" }, sessionId: "session-b" });
  if (other.allowed !== false || other.reason !== "not-the-chosen-session") fail("other sessions must be silenced");
  const unknown = api.noticeAllowed({ settings: { noticeOnlySession: "session-a" }, sessionId: "" });
  if (unknown.allowed !== false || unknown.reason !== "only-session-unknown") fail("an unknown session must stay quiet, not shout");
  const muted = api.noticeAllowed({ settings: { noticeMutedSessions: ["session-b"] }, sessionId: "b" });
  if (muted.allowed !== false || muted.reason !== "muted") fail("a muted session must be silenced");
  const notMuted = api.noticeAllowed({ settings: { noticeMutedSessions: ["session-b"] }, sessionId: "session-c" });
  if (notMuted.allowed !== true) fail("an unmuted session must still notify");
  if (api.noticeAllowed(null).allowed !== true) fail("missing input must not silence everything");
  ok("notice scope: only-this-session and the mute list both hold, and unknown never shouts");
}

// ---- 14. the workspace FILE carries plain JSON, not the printed marker -------------
// The bug that kept the UI lock inert: the file reader used the MARKER parser, which looks for
// `[focus-lock-state] {…}` and so returned null for the plain-JSON file every single time.
{
  const json = JSON.stringify({ enabled: true, kind: "session", targetId: "session-a0c714c4", lockedAtMs: 1, untilMs: 4e12, cooldownMs: 0, unlocks: [] });
  const fromJson = api.parseFocusLockFile(json);
  if (fromJson === null || fromJson.locked !== true) fail("plain JSON from the file must parse (this was the bug)");
  if (fromJson.targetId !== "session-a0c714c4") fail("the file's targetId must survive");
  if (fromJson.untilMs !== 4e12) fail("the file's expiry must survive");
  if (api.parseFocusLockFile(JSON.stringify({ enabled: false })).locked !== false) fail("a disarmed file must read as unlocked");
  if (api.parseFocusLockFile("not json at all") !== null) fail("garbage must yield null");
  if (api.parseFocusLockFile("") !== null) fail("empty must yield null");
  if (api.parseFocusLockFile(null) !== null) fail("null must yield null");
  if (api.parseFocusLockFile(JSON.stringify({ enabled: true, kind: "session" })) !== null) fail("an armed file without target/expiry must yield null");
  const marker = "[focus-lock-state] " + JSON.stringify({ locked: true, kind: "session", targetId: "s", until: new Date(4e12).toISOString() });
  if ((api.parseFocusLockFile(marker) || {}).locked !== true) fail("the marker form must still parse as a fallback");
  ok("parseFocusLockFile: plain JSON (the real file), disarmed, garbage, and the marker fallback");
}

// ---- 15. the rendered marker can arrive WITHOUT a newline / split by the DOM --------
// Measured: 标记在会话根=true but marker=读不到 — the marker was in the DOM, yet the
// "read to the newline then JSON.parse" path failed. The parser must brace-match instead.
{
  const state = { locked: true, kind: "session", targetId: "session-a1", until: new Date(4e12).toISOString() };
  const json = JSON.stringify(state);
  const cases = [
    "[focus-lock-state] " + json,                       // no trailing newline at all
    "[x]\n[focus-lock-state] " + json + "\n",
    "[focus-lock-state]\n  " + json,                    // whitespace before the object
    "[focus-lock-state] " + json + "\n[some other card marker]"
  ];
  for (const c of cases) {
    const p = api.parseFocusLockState(c);
    if (p === null || p.locked !== true) fail("a rendered marker must parse: " + JSON.stringify(c.slice(0, 60)));
    if (p.targetId !== "session-a1") fail("the target must survive: " + JSON.stringify(c.slice(0, 60)));
  }
  if (api.parseFocusLockState("[focus-lock-state] no json here") !== null) fail("text without an object must still yield null");
  ok("marker parsing survives a missing newline and surrounding DOM text");
}

// ---- 16. every "switch session" entry point must be covered -----------------------
// Measured in the shipped client: sidebar rows (data-row-key), the right sidebar's session
// list (data-sidebar-right-session), and the conversation header (data-conversation-session).
// Covering only the first is how the user could still leave the locked session.
{
  const src2 = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  for (const sel of ["[data-row-key]", "[data-sidebar-right-session]", "[data-conversation-session]"]) {
    if (src2.indexOf(sel) === -1) fail("the interceptor must cover " + sel);
  }
  if (!/closest\("\[data-row-key\], \[data-sidebar-right-session\], \[data-conversation-session\]"\)/.test(src2)) {
    fail("all three selectors must be searched in one closest() call");
  }
  // The alternate attributes carry a bare session id, so they must be namespaced like rows.
  if (!/key = "session:" \+ right/.test(src2)) fail("data-sidebar-right-session must be namespaced to session:");
  if (!/key = "session:" \+ head/.test(src2)) fail("data-conversation-session must be namespaced to session:");
  ok("the interceptor covers all three session-switch entry points, namespaced consistently");
}

// ---- 17. the "am I locked?" seam must consult the EFFECTIVE state --------------
// The bug that made the header keep saying "专注" after locking: focusLockedHere only looked at
// focusFileCache, which is null whenever there is no host-written mirror — i.e. always, now that
// the lock lives in localStorage.
{
  const src2 = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  const bodyOf = (anchor) => {
    const seg = src2.slice(src2.indexOf(anchor));
    const end = seg.indexOf("\n      }");
    return seg.slice(0, end === -1 ? seg.length : end);
  };
  const seam = bodyOf("testHooks.focusLockedHere = function");
  // 2026-10-13 起，这个接缝把判定委托给 focusLockHoldsHere()（这样"工作区锁下属于被锁工作区
  // 的会话也算锁在这里"只有一份实现）。所以断言从「接缝自己调 effectiveFocusState」改成
  // 「接缝 → focusLockHoldsHere → effectiveFocusState」这一条链**完整**，语义不变。
  const holds = bodyOf("function focusLockHoldsHere()");
  const target = bodyOf("function focusLockTarget()");
  if (!/focusLockHoldsHere\(\)/.test(seam)) fail("focusLockedHere must delegate to focusLockHoldsHere()");
  if (!/focusLockTarget\(\)/.test(holds)) fail("focusLockHoldsHere must read through focusLockTarget()");
  if (!/effectiveFocusState\(\)/.test(target)) fail("focusLockTarget must use effectiveFocusState()");
  if (/focusFileCache === null \|\| focusFileCache\.locked !== true\) return false/.test(src2)) {
    fail("the seam must not gate on focusFileCache alone (that was the bug)");
  }
  if (!/eff\.untilMs > Date\.now\(\)/.test(target)) fail("an expired lock must not count as locked");
  ok("the locked-here seam reads the effective state (via focusLockHoldsHere) and honours expiry");
}

console.log("\nFOCUS-LOCK CLIENT CHECKS PASSED");
