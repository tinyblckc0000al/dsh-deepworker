/**
 * verify_task10_notice_channel.mjs — 任务 10（2）＋**任务 11（①②）** 的断言套件。
 *
 * 【任务 10（2）】用户 2026-10-13：「内部通知也可以去掉，保留外部通知就可以了」（语境 = 专注锁）。
 *   ⇒ `showNotice(text, ev, opts)` 多了 `opts.systemOnly`：专注锁那一类**优先**走系统通知；
 *     其余用途仍是「气泡 + 系统通知」双通道（不得误伤）。
 *
 * 【任务 11 ① **修订**】用户 2026-10-13 改主意：「系统通知发不出去时必须回退画气泡」（永不静默）。
 *   ⇒ 只有 `Notification.permission === "granted"` **且** `raiseNotice(text) === true` 时，
 *     systemOnly 才不画气泡；其余任何情况（权限被拒 / 没有 Notification API / 还在 default
 *     询问态 / 设置里关掉了原生通知 / 构造器抛错）一律**回退画气泡**，且返回值 `channel`
 *     如实反映**实际**通道（`"system"` / `"bubble"` / `"system+bubble"` / `"suppressed"`）。
 *   ⚠️ 作用域过滤（`noticeAllowed`）仍然在**任何绘制/发送之前**跑：静音会话不得因为走系统通道
 *      而绕过过滤（下面有源码级顺序守卫 + 行为断言）。
 *
 * 【任务 11 ②】`readSettings()` 的**完整往返**。白名单只回读 `SETTING_DEFAULTS` 里那 3 个键，
 *   于是 `focusNativeNotice` / `noticeOnlySession` / `noticeMutedSessions` 全是「写得进、读不出」
 *   ⇒ 设置页「原生通知」开关关不掉系统通知，静音/只通知当前会话是空操作。这里把往返（含未知键
 *   不丢）与**真生效**都写成断言。
 *
 * 与既有套件同构：无参运行 PASS/FAIL；HA_CLIENT_JS 供开发期在临时副本上跑。
 */
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const code = fs.readFileSync(process.env.HA_CLIENT_JS || new URL("../lib/client.js", import.meta.url), "utf8");
const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };
const ok = (m) => console.log("  ok   " + m);
const assert = (cond, m) => { if (!cond) fail(m); };
const eq = (a, b, m) => assert(a === b, m + "（期望 " + JSON.stringify(b) + "，实际 " + JSON.stringify(a) + "）");

/* ───────────────────────── 装载 bundle（apply 期无 document，免得装一堆 DOM 监听） ───────────────── */
const req = createRequire(new URL("../", import.meta.url));
const React = req("react");
const jsxRuntime = req("react/jsx-runtime");
const primMock = { Modal: function () {}, Button: function () {}, IconListPenOutlineRegular: function () {} };
const mockRequire = (id) => id === "react" ? React
  : id === "react/jsx-runtime" ? jsxRuntime
  : id === "@deepseek-ai/dsh-client-ui-primitives" ? primMock
  : (() => { throw new Error("unexpected " + id); })();

const store = new Map();
let loaded = null;
const windowObj = { __ModuleLoader__: { load: (r) => { loaded = r; } }, innerWidth: 1400, innerHeight: 900 };
const raised = [];                       // 记录型系统通知
function installNotification(permission) {
  const ctor = function (title, opts) { raised.push({ title: title, body: opts && opts.body }); };
  ctor.permission = permission;
  windowObj.Notification = ctor;
}
installNotification("granted");

const sandbox = {
  window: windowObj,
  document: undefined,                   // apply 期没有 DOM ⇒ 所有 DOM 贡献自己短路
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  require: mockRequire, TextEncoder, TextDecoder, btoa, atob,
  // 真定时器只会拖住进程；notice 的 6s 自动关闭在这里不需要跑。
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "client.js" });
assert(loaded !== null && loaded.id === "dsh-deepworker", "bundle must register as dsh-deepworker");

/* ───────────────────────── ctx 桩（与 verify_task8 同形） ───────────────────────── */
const SESS_A = "session-aaaaaaaaaaaaaaaaaaaa";
const SESS_B = "session-bbbbbbbbbbbbbbbbbbbb";
const ctx = {
  effect: (fn) => { fn(); return () => {}; },
  locale: { register: () => {}, bind: () => (key) => key },
  slots: { inject: (n, f) => { f(); }, register: () => function () {} },
  sessions: { create: async () => "x", list: { getSnapshot: () => ({ ids: [SESS_A], byId: { [SESS_A]: { id: SESS_A, title: "A" } } }) } },
  layout: { selectPanel: () => {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
  uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => undefined }) }) },
  uiWorkspace: {
    openSession: () => {}, openWorkspace: () => {}, startSession: () => {}, replaceMain: () => {}, clearMain: () => {}, archiveSession: async () => {},
    mainReference: { sessionId: SESS_A },
    workspaces: { list: { getSnapshot: () => ({ items: [], pinnedSessionIds: [], archivedSessionIds: [], phase: "ready" }) } },
    pickDirectory: async () => "",
  },
  remote: {
    session: { prompt: async () => ({ ok: true }) },
    agentPresets: { list: async () => ({ ok: true, value: { presets: [] } }), select: async () => ({ ok: true }) },
    workspace: { create: async () => ({ ok: true }) },
  },
};
const mod = loaded.factory(mockRequire);
mod.apply(ctx);
const api = mod.__test;
assert(api && typeof api === "object", "exports.__test must exist");
assert(typeof api.showNotice === "function", "exports.__test.showNotice 必须存在（本套件靠它驱动两条通道）");
assert(typeof api.readSettings === "function" && typeof api.writeSettings === "function", "设置读写接缝必须存在");
assert(typeof api.noticeAllowed === "function", "noticeAllowed 接缝必须存在");

/* ───────────────────────── 记录型 DOM（只数气泡，不参与别的事） ───────────────────────── */
function makeDoc() {
  const created = [];
  const doc = {
    created: created,
    addEventListener() {}, removeEventListener() {},
    createElement(tag) {
      const el = {
        tagName: String(tag), attributes: {}, textContent: "", removed: false,
        style: { cssText: "", left: "", top: "" },
        setAttribute(k, v) { this.attributes[k] = String(v); },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
        hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
        remove() { this.removed = true; },
        appendChild() {}, addEventListener() {},
      };
      created.push(el);
      return el;
    },
    body: { appendChild() {} },
    head: { appendChild() {} },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return doc;
}
/** 每个场景换一份干净的 DOM：气泡计数是**这个块里新建的、带标记的**元素。 */
function newDoc() { const d = makeDoc(); sandbox.document = d; return d; }
const bubbles = (d) => d.created.filter((el) => el.hasAttribute && el.hasAttribute("data-history-actions-notice"));
const EV = { clientX: 20, clientY: 30 };

/* ───────────────────────── 设置夹具（任务 11 ②） ───────────────────────── */
const SETTING_DEFAULTS = {
  quoteProvenance: true, retryNote: true, archiveOriginal: true,
  focusNativeNotice: true, noticeOnlySession: "", noticeMutedSessions: [],
};
function resetSettings() {
  const w = api.writeSettings(JSON.parse(JSON.stringify(SETTING_DEFAULTS)));
  assert(w && w.ok === true, "reset writeSettings 必须成功：" + JSON.stringify(w));
}
function setSettings(patch) {
  const next = api.readSettings();
  for (const k in patch) next[k] = patch[k];
  const w = api.writeSettings(next);
  assert(w && w.ok === true, "writeSettings 必须成功：" + JSON.stringify(w));
  return next;
}

/* ═════════════ 0. 源码级顺序守卫（最先跑：任何「把过滤挪到绘制之后」的变异都要先在这里红） ═════════════ */
console.log("顺序守卫：作用域过滤必须在【发送/绘制】之前，systemOnly 的提前返回只能在系统通道真的可用时");
{
  const at = code.indexOf("noticeAllowed({ settings: readSettings()");
  const raise = code.indexOf("var native = raiseNotice(text);");
  const early = code.indexOf("if (systemOnly");
  const bubbleAt = code.indexOf('noticeEl = document.createElement("div")');
  assert(at !== -1, "找不到 showNotice 里的作用域过滤");
  assert(raise !== -1, "找不到 showNotice 里的 raiseNotice 调用");
  assert(early !== -1, "找不到 showNotice 里的 systemOnly 提前返回");
  assert(bubbleAt !== -1, "找不到气泡创建点");
  assert(at < raise, "作用域过滤必须在 raiseNotice 之前（静音会话不得被发系统通知）");
  assert(at < early, "作用域过滤必须在 systemOnly 提前返回之前（静音会话不得绕过过滤）");
  assert(raise < early, "raiseNotice 必须先于提前返回（先试系统通道，再决定要不要回退）");
  assert(early < bubbleAt, "提前返回必须在创建气泡之前");
  // 「系统通道可用」的判据必须是 permission === "granted"（取不到 Notification / permission 也算不可用）
  const usableAt = code.indexOf("var systemUsable = false;");
  assert(usableAt !== -1 && usableAt < raise, "systemUsable 必须在 raiseNotice 之前算出来");
  const usableBlock = code.slice(usableAt, raise);
  assert(usableBlock.indexOf('window.Notification.permission === "granted"') !== -1,
    'systemUsable 的判据必须包含 permission === "granted"（否则 denied 时不会回退）');
  assert(usableBlock.indexOf('typeof window.Notification === "function"') !== -1,
    "systemUsable 必须要求 Notification 构造器存在");
  // ⚠️ 作用域越界守卫（2026-10-13 实测出来的既有真 bug）：`showNotice` 在 **factory 作用域**，
  // 而真正的 `activeSessionId()` 在 `apply` 里。按名字直接调 ⇒ ReferenceError ⇒ 被外面那个
  // catch 吞掉 ⇒ **过滤形同不存在**（静音会话照样收到系统通知，实测 raised=1）。必须走接缝。
  const showAt = code.indexOf("function showNotice(text, ev, opts) {");
  assert(showAt !== -1, "找不到 showNotice");
  const showBlock = code.slice(showAt, code.indexOf("\n    }", showAt));
  assert(showBlock.indexOf("noticeScopeSessionId()") !== -1,
    "showNotice 必须通过 noticeScopeSessionId() 读当前会话（factory 作用域看不到 apply 的 activeSessionId）");
  assert(showBlock.indexOf("sessionId: activeSessionId()") === -1,
    "showNotice 不得直接调 apply 作用域里的 activeSessionId()（ReferenceError ⇒ 过滤被 catch 吞掉，形同不存在）");
  assert(code.indexOf("testHooks.activeSessionId = activeSessionId;") !== -1,
    "apply 必须把 activeSessionId 接到 testHooks 接缝上（factory 作用域的 showNotice 靠它读过作用域）");
  ok("noticeAllowed → systemUsable(granted?) → raiseNotice →（可用才 return）→ 建气泡：顺序正确");
  ok("跨作用域接缝：showNotice 走 noticeScopeSessionId()，apply 已把 activeSessionId 接上");
}

/* ═════════════ 1. 源码级：只有专注锁那一类带 systemOnly，共 19 处；其它用途一处都不带 ═════════════ */
console.log("源码级：只有专注锁那一类带 systemOnly，共 19 处；其它用途一处都不带");
{
  const lineOf = (marker) => {
    const at = code.indexOf(marker);
    if (at === -1) return null;
    const start = code.lastIndexOf("\n", at) + 1;
    const end = code.indexOf("\n", at);
    return code.slice(start, end === -1 ? code.length : end);
  };
  // 专注锁那一类：逐个点名（数量 + 「这一行必须带 systemOnly」）
  const focusMarkers = [
    ['showNotice(t("quote.noComposer"), { clientX: 24, clientY: 80, systemOnly: true })', 1, "requestFocus：请求写不进草稿框"],
    ['showNotice(t("focus.requested") + " " + text, { clientX: 24, clientY: 80, systemOnly: true })', 1, "requestFocus：已把专注请求放进草稿框"],
    ['showNotice(t("focus.expired"), { clientX: 24, clientY: 80, systemOnly: true })', 1, "锁到期"],
    ['showNotice(reason, { clientX: 24, clientY: 80, systemOnly: true })', 1, "installFocusClicks：点被锁的会话被拦"],
    ['showNotice(t("notice.noSession"), { clientX: 24, clientY: 80, systemOnly: true })', 2, "专注锁路径上没有当前会话（加锁 / 一键请求）"],
    ['showNotice(t(isWs ? "focus.lockedWorkspace" : "focus.lockedLocal"', 1, "加锁成功"],
    ['showNotice(t("focus.unlockedLocal"), { clientX: 24, clientY: 80, systemOnly: true })', 1, "解除专注"],
    ['showNotice(locked ? t("focus.sentUnlock") : t("focus.sentLock")', 1, "一键请求已发送"],
    ['showNotice(t("focus.sendFailed")', 2, "一键请求发送失败"],
    ['showNotice("【专注锁】文件通道："', 1, "自检：文件通道"],
    ['showNotice("【专注锁文件通道】read 抛错: "', 1, "自检：文件通道抛错"],
    ['showNotice(text, { clientX: 24, clientY: 80, systemOnly: true })', 3, "自检报告回退成气泡"],
    ['showNotice(t("focus.wrapWorkspace") + tail', 1, "服务级拦截：工作区锁"],
    ['showNotice(t("focus.wrapBlocked", { n: left }) + tail', 1, "服务级拦截：会话锁"],
    ['showNotice(unlocked ? t("focus.wrapEscaped") : t("focus.wrapEscapeFailed")', 1, "逃生口：已解除/解除失败"],
  ];
  for (const [marker, count, what] of focusMarkers) {
    const n = code.split(marker).length - 1;
    eq(n, count, "专注锁调用点数不对：" + what + " [" + marker.slice(0, 48) + "]");
    assert(lineOf(marker).indexOf("systemOnly: true") !== -1, "专注锁调用点必须带 systemOnly：" + what);
  }
  const focusCount = focusMarkers.reduce((a, m) => a + m[1], 0);
  eq(focusCount, 19, "专注锁调用点合计必须 19（与上面的总数一致）");
  // 兜底总数：任何**新增**的 systemOnly 调用点（哪怕不在上面的清单里）都必须让这条变红。
  const total = (code.match(/, systemOnly: true \}/g) || []).length;
  eq(total, 19, "带 systemOnly 的 showNotice 调用点必须恰好 19 处");

  // 其它用途：必须**不带** systemOnly（防误伤）
  const others = [
    'showNotice(t("notes.copied")',
    'showNotice(t("notes.exported")',
    'showNotice(t("resend.running")',
    'showNotice(t("resend.empty")',
    'showNotice(t("retry.noBoundary")',
    'showNotice(t("retry.noText")',
    'showNotice(copy.notFound, ev)',
    'showNotice(reason, ev)',
    'showNotice(t("quote.empty"), { clientX: 24, clientY: 96 })',
    'showNotice(t("quote.jumpFailed"), ev)',
    'showNotice(translate("quote.jumpFailed")',
    'showNotice(t("find.notInWindow")',
    'showNotice(t("digest.nothing")',
    'showNotice(t("digest.saved") + " · " + t("digest.savedTotal")',
    'showNotice(say("menu.listenerFailed")',
    'showNotice(t("notice.onlySet")',
    'showNotice(t("notice.muted")',
    'showNotice(t("notice.cleared")',
    // ⚠️ 2026-10-16：「通知哪些会话」那一族的回执补了 `{ always: true }`（**关掉「通知与气泡」
    //    时这三颗按钮仍须说话**），所以这一处 marker 从 2 参形状改成了新的 3 参形状。
    //    这里断的仍然只是"**不得**被改成 systemOnly"；"必须带 always:true"由
    //    verify_features.mjs 第 ⑥ 节（行为 + 源码级家族扫描）拥有，避免同一条属性两处各写一遍。
    'showNotice(t("notice.noSession"), { clientX: 24, clientY: 80 }, { always: true });',
    'showNotice(t("settings.applyFailures.toast")',
    'showNotice(t("notes.writeFailed")',
    'showNotice(t("resend.trace"',
    'showNotice(message, { clientX: 24, clientY: 80 })',
  ];
  for (const marker of others) {
    // 逐个 marker 的**每一行**都要检查：同一个文案在多个用途里出现（如 notice.noSession），
    // 只看第一处会给「另一处被误改」留出假绿。
    const hits = code.split("\n").filter((l) => l.indexOf(marker) !== -1);
    assert(hits.length > 0, "找不到非专注锁调用点（断言失效）：" + marker);
    for (const l of hits) {
      assert(l.indexOf("systemOnly") === -1, "非专注锁的调用点**不得**被改成 systemOnly（误伤）：" + l.trim().slice(0, 140));
    }
  }
  ok("源码：19 处专注锁带 systemOnly；" + others.length + " 类其它用途一处都没带");
}

/* ═════════════ 2. 任务 11 ②：readSettings 的完整往返（白名单只回读 3 个键 = 真 bug） ═════════════ */
console.log("② readSettings 完整往返：默认值、逐键往返、未知键不丢、静音真生效");
{
  resetSettings();
  const fresh = api.readSettings();
  eq(fresh.quoteProvenance, true, "默认 quoteProvenance=true（既有语义不得改变）");
  eq(fresh.retryNote, true, "默认 retryNote=true（既有语义不得改变）");
  eq(fresh.archiveOriginal, true, "默认 archiveOriginal=true（既有语义不得改变）");
  eq(fresh.focusNativeNotice, true, "默认 focusNativeNotice=true（原生通知默认开）");
  eq(fresh.noticeOnlySession, "", "默认 noticeOnlySession 是空串");
  assert(Array.isArray(fresh.noticeMutedSessions) && fresh.noticeMutedSessions.length === 0,
    "默认 noticeMutedSessions 是空数组，实际 " + JSON.stringify(fresh.noticeMutedSessions));
  ok("默认值齐全（6 个键）");
}
{
  resetSettings();
  setSettings({ focusNativeNotice: false });
  eq(api.readSettings().focusNativeNotice, false,
    "writeSettings({focusNativeNotice:false}) ⇒ readSettings().focusNativeNotice 必须 === false");
  setSettings({ focusNativeNotice: true });
  eq(api.readSettings().focusNativeNotice, true, "再打开 ⇒ readSettings().focusNativeNotice === true");
  ok("「原生通知」开关：false / true 都能往返（这就是它以前关不掉的原因）");
}
{
  resetSettings();
  setSettings({ noticeOnlySession: "session-x" });
  eq(api.readSettings().noticeOnlySession, "session-x", "noticeOnlySession 必须往返");
  const only = api.readSettings();
  assert(api.noticeAllowed({ settings: only, sessionId: "session-x" }).allowed === true,
    "选中的会话必须放行，实际 " + JSON.stringify(api.noticeAllowed({ settings: only, sessionId: "session-x" })));
  const other = api.noticeAllowed({ settings: only, sessionId: "session-y" });
  assert(other.allowed === false && other.reason === "not-the-chosen-session",
    "没选中的会话必须静音，实际 " + JSON.stringify(other));
  ok("只通知当前会话：往返 + 真生效");
}
{
  resetSettings();
  setSettings({ noticeMutedSessions: ["session-x"] });
  const back = api.readSettings();
  assert(JSON.stringify(back.noticeMutedSessions) === JSON.stringify(["session-x"]),
    "noticeMutedSessions 必须往返，实际 " + JSON.stringify(back.noticeMutedSessions));
  const verdict = api.noticeAllowed({ settings: back, sessionId: "session-x" });
  assert(verdict.allowed === false && verdict.reason === "muted",
    "静音必须真生效，实际 " + JSON.stringify(verdict));
  const free = api.noticeAllowed({ settings: back, sessionId: "session-y" });
  assert(free.allowed === true, "未静音的会话仍必须放行，实际 " + JSON.stringify(free));
  ok("静音真生效：readSettings().noticeMutedSessions → noticeAllowed.allowed === false");
}
{
  // 未知 / 历史键不得丢：调用方每次写盘都 `var next = readSettings(); ...; writeSettings(next)`。
  resetSettings();
  const next = api.readSettings();
  next.task11UnknownKey = { a: 1 };
  next.futureFlag = 42;
  api.writeSettings(next);
  const back = api.readSettings();
  eq(back.futureFlag, 42, "未知标量键不得被丢掉（futureFlag）");
  assert(back.task11UnknownKey !== null && typeof back.task11UnknownKey === "object" && back.task11UnknownKey.a === 1,
    "未知对象键也必须原样保留，实际 " + JSON.stringify(back.task11UnknownKey));
  eq(back.quoteProvenance, true, "未知键不得影响已有键的语义");
  ok("未知键不丢：往返保留 futureFlag=42 + task11UnknownKey={a:1}");
}
{
  // 缺失键保持默认；既有 3 个键的语义（严格布尔）不得改变；坏 JSON 回退默认
  store.set(api.SETTINGS_KEY, JSON.stringify({ quoteProvenance: false }));
  const back = api.readSettings();
  eq(back.quoteProvenance, false, "存储里的布尔必须生效");
  eq(back.archiveOriginal, true, "缺失的键必须保持默认（archiveOriginal）");
  eq(back.focusNativeNotice, true, "缺失的键必须保持默认（focusNativeNotice）");
  eq(back.noticeOnlySession, "", "缺失的键必须保持默认（noticeOnlySession）");
  store.set(api.SETTINGS_KEY, JSON.stringify({ quoteProvenance: "yes" }));
  eq(api.readSettings().quoteProvenance, true, "非布尔的已有键仍必须回退默认（既有语义不变）");
  store.set(api.SETTINGS_KEY, "{ not json");
  eq(api.readSettings().focusNativeNotice, true, "坏 JSON 必须回退默认");
  resetSettings();
  ok("缺失键 / 非布尔 / 坏 JSON：默认与既有语义都保持");
}
{
  // 源码级：SETTING_DEFAULTS 必须列全设置面会写的键
  const at = code.indexOf("var SETTING_DEFAULTS = {");
  assert(at !== -1, "找不到 SETTING_DEFAULTS");
  const end = code.indexOf("};", at);
  const block = code.slice(at, end);
  for (const key of ["quoteProvenance", "retryNote", "archiveOriginal", "focusNativeNotice", "noticeOnlySession", "noticeMutedSessions"]) {
    assert(block.indexOf(key + ":") !== -1, "SETTING_DEFAULTS 必须包含 " + key);
  }
  ok("源码：SETTING_DEFAULTS 含 6 个键（3 个原开关 + focusNativeNotice + 2 个作用域键）");
}
{
  // 端到端：写进去的静音，必须真的让 showNotice 闭嘴（读得到时真生效）
  installNotification("granted");
  const savedMain = ctx.uiWorkspace.mainReference;
  ctx.uiWorkspace.mainReference = { sessionId: SESS_A };
  resetSettings();
  setSettings({ noticeMutedSessions: [SESS_A] });
  const d = newDoc();
  raised.length = 0;
  const r = api.showNotice("专注锁：静音会话不该看到", EV, { systemOnly: true });
  eq(raised.length, 0, "静音会话不得发系统通知（granted 权限也不例外）");
  eq(bubbles(d).length, 0, "静音会话不得画气泡");
  assert(r && r.channel === "suppressed", "静音会话必须返回 suppressed，实际 " + JSON.stringify(r));
  ctx.uiWorkspace.mainReference = savedMain;
  resetSettings();
  ok("端到端：writeSettings 静音 ⇒ showNotice 真的被抑制（读得到就真生效）");
}

/* ═════════════ 3. 任务 11 ①：系统通道发不出去就回退气泡（永不静默） ═════════════ */
console.log("① granted + systemOnly：系统通道可用且真的发出去了 ⇒ 不画气泡");
{
  installNotification("granted");
  resetSettings();
  const d = newDoc();
  raised.length = 0;
  const r = api.showNotice("专注锁：锁住其它会话", EV, { systemOnly: true });
  eq(bubbles(d).length, 0, "granted 且发出去了 ⇒ 专注锁不得创建 [data-history-actions-notice] 气泡");
  eq(d.created.length, 0, "granted 且发出去了 ⇒ 不得创建任何 DOM 节点");
  eq(raised.length, 1, "系统通道必须真的发出了一次系统通知");
  eq(raised[0].body, "专注锁：锁住其它会话", "系统通知的正文必须就是提示文本");
  assert(r && r.channel === "system", "返回值必须写明走的是系统通道，实际 " + JSON.stringify(r));
  eq(r.native, true, "granted 且发出去了 ⇒ native 必须是 true");
  ok("granted + systemOnly → 0 气泡 · 1 条系统通知（body 逐字相同）· 返回 " + JSON.stringify(r));
}
console.log("其它用途（不传 opts）：气泡画回来，系统通知照旧并行");
{
  installNotification("granted");
  const d = newDoc();
  raised.length = 0;
  const r = api.showNotice("笔记已保存", EV);
  eq(bubbles(d).length, 1, "其它用途的通知仍必须画页面内气泡（防误伤）");
  eq(bubbles(d)[0].textContent, "笔记已保存", "气泡必须带原文");
  eq(raised.length, 1, "系统通知仍应与气泡并行（rides along）");
  assert(r && r.channel === "system+bubble", "返回值必须是双通道，实际 " + JSON.stringify(r));
  ok("默认通道 → 1 气泡 + 1 系统通知 · 返回 " + JSON.stringify(r));
}
console.log("①.1 权限 denied + systemOnly：**必须回退画气泡**（用户 2026-10-13 修订：永不静默）");
{
  installNotification("denied");
  resetSettings();
  const d = newDoc();
  raised.length = 0;
  const r = api.showNotice("专注锁：被拦住了", EV, { systemOnly: true });
  eq(bubbles(d).length, 1, "权限被拒 ⇒ 必须回退画气泡（绝不静默）");
  eq(bubbles(d)[0].textContent, "专注锁：被拦住了", "回退的气泡必须带原文");
  eq(raised.length, 0, "权限被拒 ⇒ 系统通知确实发不出去");
  assert(r && r.channel === "bubble" && r.native === false,
    "返回值必须**如实**说「只画了气泡、系统通道没发出去」，实际 " + JSON.stringify(r));
  ok("denied + systemOnly → 1 气泡 · 0 通知 · 返回 " + JSON.stringify(r));
}
console.log("①.1 没有 Notification API / 还在 default 询问态：同样回退气泡");
{
  installNotification("granted");
  const saved = windowObj.Notification;
  delete windowObj.Notification;
  const d = newDoc();
  raised.length = 0;
  const r = api.showNotice("专注锁：没有通知 API", EV, { systemOnly: true });
  eq(bubbles(d).length, 1, "没有 Notification API ⇒ 必须回退画气泡");
  eq(raised.length, 0, "没有 Notification API ⇒ 没有系统通知");
  assert(r && r.channel === "bubble" && r.native === false, "返回 " + JSON.stringify(r));
  windowObj.Notification = saved;
  ok("没有 Notification API + systemOnly → 1 气泡 · 返回 " + JSON.stringify(r));
}
{
  installNotification("default");           // 还在询问：系统通道不可靠
  const d = newDoc();
  raised.length = 0;
  const r = api.showNotice("专注锁：还在询问态", EV, { systemOnly: true });
  eq(bubbles(d).length, 1, 'permission === "default"（还在询问）⇒ 系统通道不可靠 ⇒ 必须回退画气泡');
  assert(r && r.channel === "system+bubble", "既发了通知也画了气泡 ⇒ channel 必须是双通道，实际 " + JSON.stringify(r));
  assert(r.native === true, "default 态下 raiseNotice 返回 true（构造器被调用过），返回值必须如实");
  installNotification("granted");
  ok('permission "default" + systemOnly → 1 气泡（不以「没抛错」当成功）· 返回 ' + JSON.stringify(r));
}
console.log("①.2 raiseNotice 返回 false（设置里关掉「原生通知」）⇒ 补画气泡");
{
  installNotification("granted");
  resetSettings();
  setSettings({ focusNativeNotice: false });
  const d = newDoc();
  raised.length = 0;
  const r = api.showNotice("专注锁：原生通知被关掉了", EV, { systemOnly: true });
  eq(raised.length, 0, "「原生通知」关掉 ⇒ 不得构造任何系统通知（② 的端到端断言）");
  eq(bubbles(d).length, 1, "系统通道返回 false ⇒ 必须补画气泡");
  assert(r && r.channel === "bubble" && r.native === false,
    "返回值必须如实说「只画了气泡」，实际 " + JSON.stringify(r));
  resetSettings();
  ok("focusNativeNotice:false + systemOnly → 0 通知 · 1 气泡 · 返回 " + JSON.stringify(r));
}
console.log("① 反面：权限被拒时，非专注锁通知仍靠气泡可见（绝不静默）");
{
  installNotification("denied");
  resetSettings();
  const d = newDoc();
  raised.length = 0;
  const r = api.showNotice("编辑重发失败", EV);
  eq(bubbles(d).length, 1, "权限被拒时，非专注锁的通知仍必须靠气泡可见（绝不静默）");
  eq(raised.length, 0, "权限被拒 ⇒ 没有系统通知");
  assert(r && r.channel === "system+bubble" && r.native === false, "返回 " + JSON.stringify(r));
  installNotification("granted");
  ok("denied + 默认通道 → 1 气泡 · 0 通知（非专注锁路径不静默）");
}
console.log("①.3 作用域过滤对两条通道都生效：静音 / 非选中会话在任何情况下都收不到");
{
  const savedMain = ctx.uiWorkspace.mainReference;
  installNotification("granted");           // 权限好好的，也一样不得发
  ctx.uiWorkspace.mainReference = { sessionId: SESS_A };
  resetSettings();
  setSettings({ noticeMutedSessions: [SESS_A] });
  const d = newDoc();
  raised.length = 0;
  const r = api.showNotice("专注锁：静音会话", EV, { systemOnly: true });
  eq(raised.length, 0, "静音会话不得发系统通知（即使权限 granted）");
  eq(bubbles(d).length, 0, "静音会话不得画气泡");
  assert(r && r.channel === "suppressed", "静音必须返回 suppressed，实际 " + JSON.stringify(r));
  const d2 = newDoc();
  const r2 = api.showNotice("笔记已保存", EV);
  eq(raised.length, 0, "静音会话的默认通道通知也不得发系统通知");
  eq(bubbles(d2).length, 0, "静音会话的默认通道通知也不得画气泡");
  assert(r2 && r2.channel === "suppressed", "静音必须返回 suppressed，实际 " + JSON.stringify(r2));

  ctx.uiWorkspace.mainReference = { sessionId: SESS_B };
  resetSettings();
  setSettings({ noticeOnlySession: SESS_A });
  const d3 = newDoc();
  raised.length = 0;
  const r3 = api.showNotice("专注锁：不是被选中的会话", EV, { systemOnly: true });
  eq(raised.length, 0, "非选中会话不得发系统通知");
  eq(bubbles(d3).length, 0, "非选中会话不得画气泡");
  assert(r3 && r3.channel === "suppressed" && api.noticeAllowed({ settings: api.readSettings(), sessionId: SESS_B }).reason === "not-the-chosen-session",
    "非选中会话必须返回 suppressed，实际 " + JSON.stringify(r3));
  ctx.uiWorkspace.mainReference = savedMain;
  resetSettings();
  ok("静音 / 只通知当前会话：两条通道都被拦截，且返回 suppressed");
}

console.log("");
console.log("PASS: focus-lock notices prefer the system channel and ALWAYS fall back to the bubble; readSettings round-trips every key");
