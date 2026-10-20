/**
 * verify_task8_mask_timer.mjs — 任务 8（非专注工作区的掩层）的断言套件
 * ＋ **任务 10**（侧栏计时条目**已被删除**；头部倒计时必须保留）。
 *
 * 历史：本文件原名覆盖「任务 9：计时从悬浮元素改成 sidebar.footer.action 里的真条目」。
 * 2026-10-13 用户改主意 —— 「放标题栏右侧就可以了。把笔记旁边的计时去掉吧」⇒ 任务 9 的
 * 侧栏条目被整体删除，本文件里那一半断言**翻面**成「必须不存在」，而**头部倒计时**
 * （focusHeaderLabel，用户明确要保留的那一条）与**掩层**（paintLockedSessions /
 * data-ha-focus-dim，用户没有要求改）的断言原样保留。
 *
 * 覆盖：
 *   掩层  ① 目标工作区不上灰 ② 非目标工作区上灰 ③ 未分组会话不上灰 ④ 解锁后无残留
 *         ⑤ 会话锁仍只暗会话行 ⑥ 判定用归属账（path 恰好相等），不用 DOM 祖先
 *   头部  ⑦ 工作区锁下 focusHeaderLabel 必须含时间 ⑧ 未分组会话不得显示"锁在这里"
 *   任务10 ⑨ sidebar.footer.action 里**不得**再有 id=history-actions-focus-timer 的条目；
 *          「笔记」条目必须仍在（order 5）；读数接缝 focusSidebarTimer 已删；
 *          计时实现（组件/辅助函数/i18n 键/悬浮残留）一个符号都不剩；
 *          头部专注按钮与倒计时、掩层必须**仍在**
 */
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

// 套件按约定检查**线上** bundle。HA_CLIENT_JS 只是开发期的临时起点（写盘前用它在
// 临时副本上跑断言，避免对着被 HMR 监视的 bundle 做变异测试，见 AGENTS.md）。
const code = fs.readFileSync(process.env.HA_CLIENT_JS || new URL("../lib/client.js", import.meta.url), "utf8");
const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };
const ok = (m) => console.log("  ok   " + m);
const assert = (cond, m) => { if (!cond) fail(m); };

/* ── 真 React：组件渲染必须走真 hook，否则「return null」这类断言会变成空转 ── */
// 路径一律用 fileURLToPath 之外的 createRequire（本仓库工作区含中文，URL.pathname 不解码）。
const pkgRoot = new URL("../", import.meta.url);
const req = createRequire(pkgRoot);
const React = req("react");

/* ───────────────────────── 假 DOM（掩层那部分真的用到） ───────────────────────── */
class El {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this._doc = doc;
    this._attrs = new Map();
    this.style = { opacity: "", filter: "", display: "", cssText: "" };
    this.textContent = "";
    this.children = [];
    this.parentNode = null;
  }
  // id / title / textContent 都做成**属性访问器**，与 setAttribute/removeAttribute 保持同步。
  get id() { return this._attrs.has("id") ? this._attrs.get("id") : ""; }
  set id(v) { this.setAttribute("id", v); }
  get title() { return this._attrs.has("title") ? this._attrs.get("title") : ""; }
  set title(v) { if (v === "") this.removeAttribute("title"); else this.setAttribute("title", v); }
  setAttribute(k, v) { this._attrs.set(k, String(v)); }
  getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }
  removeAttribute(k) { this._attrs.delete(k); }
  hasAttribute(k) { return this._attrs.has(k); }
  appendChild(c) { c.parentNode = this; this.children.push(c); this._doc._all.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; this._doc._all = this._doc._all.filter((x) => x !== c); return c; }
  get ownerDocument() { return this._doc; }
}
function makeDoc() {
  const doc = {
    _all: [],
    body: null, documentElement: null,
    createElement(tag) { return new El(tag, doc); },
    getElementById(id) { return doc._all.find((e) => e.getAttribute("id") === String(id)) || null; },
    // ⚠️ 这个夹具第一版写错了（`filter((e) => match(e, s))` 里的 `s` 不在作用域 ⇒
    // TypeError）。插件把 `document.querySelectorAll` 包在 try/catch 里 ⇒ 异常被吞掉、
    // 掩层**一个都不画**，套件于是报「非目标工作区没上灰」—— 看着像插件坏了，其实是仪表坏了。
    // 现在按选择器直接匹配，并把「选择器不认识」当成硬错误说出来，不再静默返回空集。
    querySelectorAll(sel) {
      const selector = String(sel);
      const attrOnly = /^\[([a-zA-Z0-9_-]+)\]$/.exec(selector);
      if (attrOnly) return doc._all.filter((e) => e.hasAttribute(attrOnly[1]));
      const attrPrefix = /^\[([a-zA-Z0-9_-]+)\^="([^"]*)"\]$/.exec(selector);
      if (attrPrefix) return doc._all.filter((e) => {
        const v = e.getAttribute(attrPrefix[1]);
        return typeof v === "string" && v.indexOf(attrPrefix[2]) === 0;
      });
      // 裸属性名（`data-ha-focus-locked`）在插件里也出现过 ⇒ 一并支持。
      const attrBare = /^([a-zA-Z0-9_-]+)$/.exec(selector);
      if (attrBare) return doc._all.filter((e) => e.hasAttribute(attrBare[1]));
      const attrExact = /^\[([a-zA-Z0-9_-]+)="([^"]*)"\]$/.exec(selector);
      if (attrExact) return doc._all.filter((e) => e.getAttribute(attrExact[1]) === attrExact[2]);
      throw new Error("fake DOM: unsupported selector " + JSON.stringify(selector));
    },
  };
  doc.body = new El("body", doc); doc._all.push(doc.body);
  doc.documentElement = new El("html", doc); doc._all.push(doc.documentElement);
  return doc;
}

/* ───────────────────────── 装载 bundle ───────────────────────── */
const doc = makeDoc();
const store = new Map();
let loaded = null;
const windowObj = { __ModuleLoader__: { load: (r) => { loaded = r; } }, innerWidth: 1400, innerHeight: 900 };
const jsxRuntime = req("react/jsx-runtime");
// 任务 11 ③ 需要把头部按钮**真的渲染出来**（emoji 是渲染期产出的，只有 SSR 才能证明它没了）。
const { renderToStaticMarkup } = req("react-dom/server");
const primMock = {
  Modal: function () {}, Button: function () {},
  IconListPenOutlineRegular: (props) => React.createElement("svg", { "data-icon": "notes", "data-size": String(props && props.size) })
};
const mockRequire = (id) => id === "react" ? React
  : id === "react/jsx-runtime" ? jsxRuntime
  : id === "@deepseek-ai/dsh-client-ui-primitives" ? primMock
  : (() => { throw new Error("unexpected " + id); })();
const sandbox = {
  window: windowObj, document: doc,
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  require: mockRequire, TextEncoder, TextDecoder, btoa, atob,
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "client.js" });
assert(loaded !== null && loaded.id === "dsh-deepworker", "bundle must register as dsh-deepworker");

/* ───────────────────────── ctx 桩：归属账是权威来源 ───────────────────────── */
const WS_A = "/Users/x/work/project";       // 目标工作区（规范 path）
const WS_B = "/Users/x/other";                       // 另一个工作区
const SESS_A = "session-aaaaaaaaaaaaaaaaaaaa";       // 属于 A
const SESS_B = "session-bbbbbbbbbbbbbbbbbbbb";       // 属于 B
const SESS_LOOSE = "session-cccccccccccccccccccc";   // 未分组（子代理那种）
const items = [
  { workspaceId: "ws-a", title: "project", path: WS_A, sessionIds: [SESS_A], updatedAt: "t" },
  { workspaceId: "ws-b", title: "Other", path: WS_B, sessionIds: [SESS_B], updatedAt: "t" },
];
/** 从 bundle 源码里取出真实的 zh 词典 —— 断言要打在**真文案**上，而不是原样返回的 key。 */
const zhDict = (() => {
  const at = code.indexOf('var zh = {');
  const end = code.indexOf('\n    };', at);
  return vm.runInNewContext('(' + code.slice(code.indexOf('{', at), end + 6).replace(/;\s*$/, '') + ')');
})();
/** 同一份取法拿 en（键集必须与 zh 一致，见 verify_i18n）。 */
const enDict = (() => {
  const at = code.indexOf('var en = {');
  const end = code.indexOf('\n    };', at);
  return vm.runInNewContext('(' + code.slice(code.indexOf('{', at), end + 6).replace(/;\s*$/, '') + ')');
})();
function makeT(dict) {
  return (key, vars) => {
    let out = typeof dict[key] === "string" ? dict[key] : key;
    if (vars && typeof vars === "object") {
      for (const k of Object.keys(vars)) out = out.split("{" + k + "}").join(String(vars[k]));
    }
    return out;
  };
}
const zhT = makeT(zhDict);

/** 槽注册登记簿：注册断言直接打在真实的 register 调用上。 */
const registrations = [];
const ctx = {
  effect: (fn) => { fn(); return () => {}; },
  locale: { register: () => {}, bind: () => zhT },
  slots: {
    inject: (n, f) => { f(); },
    register: (options, component) => { registrations.push({ options, component }); return function () {}; },
  },
  sessions: { create: async () => "x", list: { getSnapshot: () => ({ ids: [SESS_A, SESS_B, SESS_LOOSE], byId: { [SESS_A]: { id: SESS_A, title: "A" }, [SESS_B]: { id: SESS_B, title: "B" }, [SESS_LOOSE]: { id: SESS_LOOSE, title: "loose" } } }) } },
  layout: { selectPanel: () => {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
  uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => undefined }) }) },
  uiWorkspace: {
    openSession: () => {}, openWorkspace: () => {}, startSession: () => {}, replaceMain: () => {}, clearMain: () => {}, archiveSession: async () => {},
    mainReference: { sessionId: SESS_A },
    workspaces: { list: { getSnapshot: () => ({ items, pinnedSessionIds: [], archivedSessionIds: [], phase: "ready" }) } },
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
for (const name of ["focusDimMarks", "focusLockedHere", "focusRemaining", "focusHeaderLabel", "paintLockedSessions"]) {
  assert(typeof api[name] === "function", "seam missing: " + name);
}

/* ───────────────────────── DOM 夹具（掩层） ───────────────────────── */
const doc2 = doc; // 同一个 document：插件在 apply 期已经持有它
function resetRows() {
  for (const e of doc2._all.slice()) if (e.hasAttribute("data-row-key") && e.parentNode) e.parentNode.removeChild(e);
}
function addRow(key) { const e = doc2.createElement("div"); e.setAttribute("data-row-key", key); doc2.body.appendChild(e); return e; }
const LOCK_KEY = "dsh.deepworker.focusLocal";
function setLock(obj) { if (obj === null) store.delete(LOCK_KEY); else store.set(LOCK_KEY, JSON.stringify(obj)); }
/** 设锁并**立刻**重算（真实 App 里每次锁状态变化都会调 paintLockedSessions）。 */
function applyLock(obj) { setLock(obj); api.paintLockedSessions(); }
const now = Date.now();
const wsLock = { enabled: true, kind: "workspace", targetId: WS_A, lockedAtMs: now, untilMs: now + 30 * 60000, cooldownMs: 0, unlocks: [] };
const sessLock = { enabled: true, kind: "session", targetId: SESS_A, lockedAtMs: now, untilMs: now + 30 * 60000, cooldownMs: 0, unlocks: [] };
/** 把 DOM 里的行按「归属」铺好：三条工作区行 + 三条会话行。 */
function buildScene() {
  resetRows();
  const r = {};
  r.wsA = addRow("workspace:ws-a");
  r.wsB = addRow("workspace:ws-b");
  r.looseWs = addRow("workspace:");           // 未分组桶（空 workspaceId）
  r.sA = addRow("session:" + SESS_A);
  r.sB = addRow("session:" + SESS_B);
  r.sLoose = addRow("session:" + SESS_LOOSE);
  return r;
}
const dimmed = (e) => e.getAttribute("data-ha-focus-dim");
const dimCount = () => doc2.querySelectorAll("[data-ha-focus-dim]").length;

console.log("掩层（非专注工作区的视觉区分）—— 用户没有要求改，断言原样保留");
{
  // ① 目标工作区 + 未分组必须正常；② 非目标工作区上灰；⑥ 判据是归属账
  applyLock(wsLock);
  buildScene();
  api.paintLockedSessions();
  const r = buildScene();
  api.paintLockedSessions();
  assert(dimmed(r.wsA) === null, "① 目标工作区行不得上灰");
  assert(dimmed(r.sA) === null, "② 目标工作区里的会话不得上灰");
  assert(dimmed(r.sB) === "session", "③ 非目标工作区的会话行必须上灰（session）");
  assert(dimmed(r.wsB) === "workspace", "④ 非目标工作区行必须上灰（workspace）");
  assert(dimmed(r.looseWs) === null, "⑤ 未分组桶（workspace:）不得上灰");
  assert(dimmed(r.sLoose) === null, "⑥ 未分组会话（含子代理）不得上灰");
  assert(r.sB.style.opacity === "0.45" && String(r.sB.style.filter).indexOf("grayscale") !== -1, "上灰必须真的写 opacity+grayscale");
  assert(dimCount() === 2, "上灰行数应恰好是 2（ws-b 行 + sB 行），实际 " + dimCount());
  ok("workspace 锁：目标工作区/未分组不上灰，非目标工作区行+会话上灰");
}
{
  // ④ 解锁后必须**完全还原**（不留残留样式）
  const r = buildScene();
  applyLock(wsLock);
  assert(dimCount() > 0, "前提：加锁后确实有掩层（否则下面的'还原'断言是空转）");
  applyLock(null);
  assert(dimCount() === 0, "解锁后不得残留任何掩层标记，实际 " + dimCount());
  assert(r.wsB.style.opacity === "" && r.wsB.style.filter === "", "解锁后必须把行内样式清空");
  assert(r.wsB.title === "", "解锁后必须把 title 清掉");
  assert(doc2.querySelectorAll("data-ha-focus-locked").length === 0, "解锁后不得残留 data-ha-focus-locked");
  ok("解锁后完全还原：无标记、无行内样式、无 title");
}
{
  // ⑤ 会话锁仍只暗会话行（工作区行不动）
  applyLock(sessLock);
  const r = buildScene();
  api.paintLockedSessions();
  assert(dimmed(r.sA) === null, "会话锁下目标会话不得上灰");
  assert(dimmed(r.sB) === "session" && dimmed(r.sLoose) === "session", "会话锁下其它**会话**行必须上灰");
  assert(dimmed(r.wsA) === null && dimmed(r.wsB) === null && dimmed(r.looseWs) === null, "会话锁不得给工作区行上灰");
  ok("会话锁：只暗会话行，工作区行不动");
}
{
  // ⚠️ 反向守卫：判定**不能**是前缀匹配（父子目录是两个工作区）
  buildScene();
  const seen = api.focusDimMarks([
    { getAttribute: (k) => (k === "data-row-key" ? "workspace:ws-a" : null) },
    { getAttribute: (k) => (k === "data-row-key" ? "session:" + SESS_A : null) },
  ], { kind: "workspace", targetId: WS_A + "/sub", untilMs: Date.now() + 60000 });
  assert(seen.length === 2, "前缀匹配会锁错：子路径目标下 ws-a 行与会话行都必须被暗，实际 " + seen.length);
  applyLock(null);
  ok("反向守卫：锁 " + WS_A + "/sub 时 " + WS_A + " 仍被判为**非目标**（恰好相等，非前缀）");
}
{
  // 过期锁 ⇒ 什么都不暗（时间就是一条出路）
  applyLock({ enabled: true, kind: "workspace", targetId: WS_A, lockedAtMs: now - 1000, untilMs: Date.now() - 1000, cooldownMs: 0, unlocks: [] });
  buildScene();
  api.paintLockedSessions();
  assert(dimCount() === 0, "过期锁不得上灰");
  applyLock(null);
  ok("过期锁：不上灰（focusLockTarget 会过滤过期）");
}

console.log("头部倒计时：用户明确要保留的那一条（「放标题栏右侧就可以了」）");
{
  applyLock(null);
  const free = api.focusHeaderLabel();
  assert(api.focusLockedHere() === false, "未锁时 focusLockedHere 必须 false");
  assert(!/\d\d:\d\d/.test(free), "未锁时头部标签不得含时间，实际 " + JSON.stringify(free));
  applyLock(wsLock);
  assert(api.focusLockedHere() === true, "工作区锁 + 当前会话属于该工作区 ⇒ focusLockedHere 必须 true");
  const label = api.focusHeaderLabel();
  assert(/\d\d:\d\d/.test(label), "⑦ 工作区锁下头部标签必须含时间（HH:MM），实际 " + JSON.stringify(label));
  assert(api.focusRemaining() > 0, "工作区锁下 focusRemaining 必须 > 0");
  ok("工作区锁：focusLockedHere=true、focusRemaining>0、标签含 HH:MM → " + JSON.stringify(label));
}
{
  // ⑧ 未分组会话在工作区锁下**放行** ⇒ 不得显示"锁在这里"
  ctx.uiWorkspace.mainReference = { sessionId: SESS_LOOSE };
  applyLock(wsLock);
  assert(api.focusLockedHere() === false, "⑧ 未分组会话在工作区锁下不得算'锁在这里'");
  const label = api.focusHeaderLabel();
  assert(!/\d\d:\d\d/.test(label), "⑧ 未分组会话的头部标签不得含时间，实际 " + JSON.stringify(label));
  ctx.uiWorkspace.mainReference = { sessionId: SESS_A };
  ok("未分组会话在工作区锁下：不显示'锁在这里'、标签无时间（与放行规则一致）");
}
{
  // 会话锁（回归）：仍然认，且只认自己
  applyLock(sessLock);
  assert(api.focusLockedHere() === true, "会话锁下当前会话命中时必须 true");
  assert(/\d\d:\d\d/.test(api.focusHeaderLabel()), "会话锁下标签也必须含时间");
  ctx.uiWorkspace.mainReference = { sessionId: SESS_B };
  assert(api.focusLockedHere() === false, "会话锁下别的会话不得算'锁在这里'");
  ctx.uiWorkspace.mainReference = { sessionId: SESS_A };
  applyLock(null);
  ok("会话锁回归：命中/未命中都对");
}

/* ═══════════ 任务 11 ③：头部专注按钮的锁 emoji 已被去掉（用户 2026-10-13） ═══════════ */
console.log("③ 头部专注按钮：文案里不得再有 🔒/🔓，但「专注」/「解除专注·HH:MM」必须仍然可读");
{
  const EMOJI = /[\u{1F512}\u{1F513}]/u;              // 🔒 U+1F512 · 🔓 U+1F513
  const focusReg = registrations.find((r) => r.options && r.options.id === "history-actions-focus");
  assert(focusReg && typeof focusReg.component === "function",
    "找不到 id=history-actions-focus 的槽注册（没有它就无法渲染按钮，下面的断言会变成空转）");
  // ① 注册的 label —— 标题栏读的就是它
  applyLock(null);
  const freeLabel = api.focusHeaderLabel();
  assert(!EMOJI.test(freeLabel), "未锁的头部 label 不得含 🔒/🔓，实际 " + JSON.stringify(freeLabel));
  assert(freeLabel.indexOf("专注") !== -1, "未锁的头部 label 必须仍含「专注」，实际 " + JSON.stringify(freeLabel));
  applyLock(sessLock);
  const lockedLabel = api.focusHeaderLabel();
  assert(!EMOJI.test(lockedLabel), "锁定态的头部 label 不得含 🔒/🔓，实际 " + JSON.stringify(lockedLabel));
  assert(lockedLabel.indexOf("解除专注") !== -1, "锁定态必须仍含「解除专注」，实际 " + JSON.stringify(lockedLabel));
  assert(/\d\d:\d\d/.test(lockedLabel), "锁定态必须仍含 HH:MM，实际 " + JSON.stringify(lockedLabel));
  // ② 组件真正渲染出来的那个按钮 —— 截图里的「🔒 专注」就是它（emoji 是渲染期产出的）
  applyLock(null);
  const htmlFree = renderToStaticMarkup(React.createElement(focusReg.component, { t: zhT }));
  assert(!EMOJI.test(htmlFree), "未锁时按钮渲染不得含 🔒/🔓，实际 " + htmlFree);
  assert(htmlFree.indexOf("专注") !== -1, "未锁时按钮仍必须显示「专注」，实际 " + htmlFree);
  applyLock(sessLock);
  const htmlLocked = renderToStaticMarkup(React.createElement(focusReg.component, { t: zhT }));
  assert(!EMOJI.test(htmlLocked), "锁定态按钮渲染不得含 🔒/🔓，实际 " + htmlLocked);
  assert(htmlLocked.indexOf("解除专注") !== -1, "锁定态按钮仍必须显示「解除专注」，实际 " + htmlLocked);
  applyLock(null);
  // ③ 范围：只有这一个按钮去掉了 emoji —— 通知正文与设置页状态行的 🔒 **保持不动**
  assert(code.indexOf('children: locked ? "🔒" : "🔓"') === -1, "按钮里不得再有硬编码的锁 emoji 字面量");
  for (const entry of [{ name: "zh", d: zhDict }, { name: "en", d: enDict }]) {
    for (const key of ["focus.wrapBlocked", "focus.wrapWorkspace", "focus.locked"]) {
      assert(entry.d[key].indexOf("🔒") !== -1,
        entry.name + " 词典 " + key + " 的 🔒 必须保持不动（系统通知正文 / 设置页状态行不在本次范围内）");
    }
  }
  ok("头部按钮：无 emoji，仍可读；通知正文与设置页状态行的 🔒 原样保留");
}

/* ═══════════ 任务 10：侧栏计时条目已被删除（用户 2026-10-13 改主意） ═══════════ */
console.log("注册：sidebar.footer.action 里**不得**再有专注计时条目");
{
  const sidebarRegs = registrations.filter((r) => r.options.name === "sidebar.footer.action");
  const dirty = sidebarRegs.filter((r) => r.options.id === "history-actions-focus-timer");
  assert(dirty.length === 0,
    "⑨ sidebar.footer.action 里不得再注册 id=history-actions-focus-timer 的条目（用户：「把笔记旁边的计时去掉吧」），实际 " + dirty.length + " 个");
  // 注册断言必须有东西可看，否则「找不到 = 通过」是假绿（注册整个没发生也会绿）。
  assert(sidebarRegs.length > 0, "前提：sidebar.footer.action 上确实有注册（否则上面的断言是空转）");
  const notesReg = sidebarRegs.find((r) => r.options.id === "history-actions-notes");
  assert(notesReg !== undefined, "⑨ 前提：「笔记」条目必须仍在（删的只是它旁边那个计时）");
  assert(notesReg.options.order === 5, "⑨ 「笔记」的 order 必须仍是 5，实际 " + String(notesReg.options.order));
  assert(sidebarRegs.length === 1, "⑨ sidebar.footer.action 上应只剩「笔记」一条，实际 " + sidebarRegs.length + " 条："
    + JSON.stringify(sidebarRegs.map((r) => r.options.id)));
  ok("sidebar.footer.action 只剩 notes（order " + notesReg.options.order + "）；全部槽注册 = "
    + JSON.stringify(registrations.map((r) => r.options.name + "#" + r.options.id)));
}

console.log("接缝 / 词表：只被计时用的东西必须一起删掉");
{
  assert(api.focusSidebarTimer === undefined, "⑨ api.focusSidebarTimer 读数接缝必须已删除（计时没了，这个接缝就没有意义）");
  for (const key of ["focus.timerSidebar", "focus.timerSidebarWs", "focus.timerSidebarShort", "focus.timerAria"]) {
    assert(!(key in zhDict), "⑨ zh 词典不得再留只被计时用的键：" + key);
    assert(!(key in enDict), "⑨ en 词典不得再留只被计时用的键：" + key);
  }
  assert(Object.keys(zhDict).length === Object.keys(enDict).length,
    "⑨ 中英键集仍必须一致（verify_i18n 也查，这里是就地守卫）");
  assert(!("focus.timerTitle" in zhDict) && !("focus.timerUnknownWorkspace" in zhDict),
    "⑨ 不得再引入新的计时专属键");
  ok("接缝已删；zh/en 各 " + Object.keys(zhDict).length + " 键，键集一致，无 focus.timer* 残留");
}

console.log("源码级守卫：计时实现一个符号都不剩；头部按钮 + 倒计时 + 掩层必须还在");
{
  const src = code;
  const banned = [
    // 注册 / 可探测标记 / 旧悬浮元素
    "history-actions-focus-timer", "data-ha-focus-timer", "dsh-ha-focus-timer",
    "focusSidebarEnsure", "refreshFocusSidebarTimer", "focusSidebarEl",
    "--dsw-specific-sidebar-width",
    // 组件与辅助函数
    "FocusTimerAction", "focusTimerView", "focusTimerResolution", "focusTimerText",
    "focusTimerCountdown", "focusTimerRead", "focusTimerWorkspace", "focusTimerNow",
    "focusTimerT(", "focusTimerAria", "focusTimerRuntime",
    // 接缝与 i18n 命名空间
    "focusSidebarTimer", "focus.timer",
  ];
  for (const b of banned) assert(src.indexOf(b) === -1, "⑨ 计时残留（必须为 0 次）：" + b);

  // 反面：用户要保留的东西必须在
  assert(src.indexOf('          label: function () { return focusHeaderLabel(); }') !== -1,
    "⑨ 头部专注按钮的 label 必须仍然接在 focusHeaderLabel() 上（那是用户要的倒计时）");
  assert(src.indexOf('id: "history-actions-focus"') !== -1, "⑨ 头部专注按钮的注册必须保留");
  assert(src.indexOf("conversation.session.header.utilities") !== -1, "⑨ 头部槽注册必须保留");
  const hdrAt = src.indexOf("function focusHeaderLabel(");
  assert(hdrAt !== -1, "⑨ focusHeaderLabel 必须保留");
  const hdr = src.slice(hdrAt, hdrAt + 1200);
  assert(hdr.indexOf("focusLockHoldsHere()") !== -1, "⑨ 头部倒计时判据必须与 focusLockHoldsHere 同源（工作区锁也算'锁在这里'）");
  assert(hdr.indexOf("focus.headerUnlockShort") !== -1, "⑨ 头部倒计时文案必须保留");
  assert(src.indexOf("data-ha-focus-dim") !== -1, "⑨ 掩层必须保留（用户没有要求改它）");
  assert(src.indexOf("function paintLockedSessions(") !== -1, "⑨ 掩层重画必须保留");

  // 掩层判定：归属账 + 恰好相等 + 未分组放行（原样保留的守卫）
  const dimAt = src.indexOf("function focusDimMarks(");
  assert(dimAt !== -1, "找不到 focusDimMarks 的函数体（源码守卫无法工作）");
  const dim = src.slice(dimAt, dimAt + 6000);
  assert(dim.indexOf("focusWrapWorkspacePathOf(sid)") !== -1, "掩层判定必须用归属账 focusWrapWorkspacePathOf");
  assert(dim.indexOf("path === targetPath") !== -1, "工作区行判定必须**恰好相等**比 path（不是前缀）");
  assert(dim.indexOf('if (mine === "" || mine === targetPath) continue;') !== -1, "未分组会话必须被放行（mine === \"\"）");
  assert(dim.indexOf('key.indexOf("workspace:") === 0') !== -1, "掩层必须按 data-row-key 的 workspace: 前缀识别工作区行");
  assert(dim.indexOf('key.indexOf("session:") !== 0') !== -1, "掩层必须按 data-row-key 的 session: 前缀识别会话行");

  // 反向：不得出现「从会话行往上找工作区」的写法（侧栏是平铺的，那种写法必然锁错）
  const forbidden = [/closest\(\s*['"][^'"]*workspace/i, /previousElementSibling[\s\S]{0,80}workspace:/i, /parentElement[\s\S]{0,60}data-row-key[\s\S]{0,40}workspace:/i];
  for (const re of forbidden) assert(!re.test(src), "掩层里出现了 DOM 祖先/前后关系写法：" + re);
  ok("源码：计时符号 0 残留；头部按钮 + 倒计时 + 掩层（归属账/恰好相等/未分组放行）都在");
}

console.log("");
console.log("PASS: task8 mask (kept) + task10 sidebar timer removed (header countdown kept)");
