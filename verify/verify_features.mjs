#!/usr/bin/env node
/**
 * verify_features.mjs — 功能总开关：**行为**断言（不是文本 grep）。
 *
 * 为什么单独一个套件：开关的整个价值在"关掉之后会发生什么"。只断言"源码里有 featureEnabled"
 * 那种做法会被死代码满足（AGENTS.md 纪律 4），所以这里把 bundle 真的装进一个 DOM/存储桩里
 * **驱动**它：
 *   ① 默认全开：老用户升级后行为必须一字不变（七个键默认 true，空存储读到 true）。
 *   ② 「通知与气泡」关掉 ⇒ showNotice 真的什么都不画（用 data-history-actions-notice 计数），
 *      但**插件自己的错误**（opts.always）与**专注锁**（opts.systemOnly）必须照旧可见 ——
 *      否则"关掉通知"等于"关掉自己的报警器"（设计稿 §4.3）。
 *   ③ 专注锁关掉 ⇒（a）判定点直接放行、（b）已经包上去的拦截器被撤销并复位 armed、
 *      （c）关掉那一刻说话（失败必须可见）。
 *   ④ 每个"关掉"都有**可见反馈**：设置页那一档自己写出"已关闭"，且入口保留（组件断言在
 *      verify_render.mjs；这里断"关掉时到底读不读得到 off 状态"这一层）。
 *
 * ⚠️ 这里的 DOM 是**最小桩**：只实现套件真正读到的少数方法。它证明的是"开关接线正确"，
 * 不证明"在真机上渲染正确"——后者只能真机验（见 prepublish 的提醒）。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const pkgRoot = new URL('../', import.meta.url);
const req = createRequire(pkgRoot);
// `HA_CLIENT_JS=<file>` lets the mutation harness drive a /tmp copy (never the live file).
const clientPath = process.env.HA_CLIENT_JS || fileURLToPath(new URL('../lib/client.js', import.meta.url));
const code = fs.readFileSync(clientPath, 'utf8');
// ⚠️ 档位清单从 bundle 现算。手抄的 7 项清单在加档当天就漏掉新档，而漏掉的表现是
// 「总开关全关」这条断言**静默地测了个不完整的状态**（2026-10-16 加终端按钮即如此）。
const FEATURE_KEY_LIST = ((code.match(/var FEATURE_KEYS = \[([^\]]*)\]/) || [, ''])[1].match(/"[^"]+"/g) || []).map((x) => x.slice(1, -1));
const FEATURE_COUNT = FEATURE_KEY_LIST.length;
if (FEATURE_COUNT < 1) throw new Error('verify_features could not read FEATURE_KEYS out of the bundle');

let failures = 0;
const fail = (m) => { failures++; console.error('FAIL: ' + m); };
const ok = (m) => console.log('  ok   ' + m);
const eq = (actual, expected, what) => {
  if (actual !== expected) fail(what + ' —— expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  else ok(what);
};

/** The session every harness instance pretends to be looking at. */
const SESSION = 'session-here';

const reactMock = {
  memo: (c) => c,
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useRef: (init) => ({ current: init }),
  useEffect: () => {},
  createElement: () => null
};
const jsxRuntimeMock = { jsx: (...a) => a, jsxs: (...a) => a, Fragment: Symbol('Fragment') };
const primitivesMock = { Modal: function () {}, Button: function () {}, IconListPenOutlineRegular: function () {}, MarkdownText: function () {} };
function mockRequire(id) {
  if (id === 'react') return reactMock;
  if (id === 'react/jsx-runtime') return jsxRuntimeMock;
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitivesMock;
  throw new Error('unexpected require: ' + id);
}

// ── minimal DOM ────────────────────────────────────────────────────────────
function makeDoc() {
  const notices = [];
  const listeners = {};
  const doc = {
    head: { appendChild: () => {} },
    body: { appendChild: (el) => { if (el && el.__notice === true) notices.push(el); }, textContent: '' },
    documentElement: {},
    createElement: (tag) => {
      const el = {
        tagName: tag, style: { cssText: '' }, children: [], attributes: {},
        textContent: '',
        setAttribute(k, v) { this.attributes[k] = v; },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
        hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
        appendChild(c) { this.children.push(c); return c; },
        remove() {},
        closest() { return null; },
        querySelectorAll() { return []; },
        addEventListener() {}, removeEventListener() {}
      };
      if (tag === 'div') {
        Object.defineProperty(el, '__notice', {
          get() { return Object.prototype.hasOwnProperty.call(this.attributes, 'data-history-actions-notice'); },
          configurable: true
        });
      }
      return el;
    },
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: () => {},
    __notices: notices
  };
  return doc;
}

/** Load the bundle and apply() it against a fresh stub ctx; return the seams. */
function boot(settings, opts) {
  const options = opts || {};
  const store = new Map();
  if (settings !== undefined) store.set('dsh.deepworker.settings', JSON.stringify(settings));
  // ── 2026-10-16 第 4 轮：**存储调用序**日志 ────────────────────────────────────────
  // 「先解锁 → 再写设置」这条顺序不是靠读源码断言的：清锁走 `removeItem(FOCUS_LOCAL_KEY)`，
  // 写设置走 `setItem(SETTINGS_KEY)` ⇒ 记录这两个原语的调用序就是**对外可验证**的顺序证据。
  const opLog = [];
  let loaded = null;
  const windowObj = {
    __ModuleLoader__: { load: (reg) => { loaded = reg; } },
    innerWidth: 1400, innerHeight: 900,
    Notification: options.notification
  };
  const document = options.document === undefined ? makeDoc() : options.document;
  const sandbox = {
    window: windowObj, document, require: mockRequire,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { opLog.push({ op: 'setItem', key: k }); store.set(k, String(v)); },
      removeItem: (k) => {
        opLog.push({ op: 'removeItem', key: k });
        // Fixture switch: a storage layer that REFUSES the clear. `writeLocalLock(null)` must
        // then report false and the transaction must refuse to close the feature.
        if (options.removeItemThrows === true) throw new Error('removeItem refused (fixture)');
        store.delete(k);
      }
    },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, console, Boolean, RegExp
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'client.js' });
  const exportsObj = loaded.factory(mockRequire);

  const registered = [];
  // ── 注册台账（2026-10-16）：**真跑 apply 路径**数贡献，而不是 grep 源码 ──────────────
  // 这是"引入 / 移除开关真的接线了"的唯一证据：某一档未引入时，它对应的
  //   · `slots.inject`（槽位注入）
  //   · `shortcuts.register`（命令注册）
  //   · `ctx.effect`（监听器 / 定时器 / 全局样式）
  // 必须**一次都没被调用过**。旧套件断的是"注册了但 `resolve()` 返回 unhandled" —— 那是
  // 另一套语义（关掉但保留入口），改版后已经不成立，所以这里整段换成注册层计数。
  const injectedNames = [];
  const effectLabels = [];
  const slotConfigs = [];
  const ctx = {
    effect: (fn, label) => { effectLabels.push(String(label)); try { fn(); } catch (e) { /* contributions are isolated in the real host too */ } return () => {}; },
    locale: { register: () => {}, bind: () => (k) => k },
    shortcuts: { register: (command) => { registered.push(command); return () => {}; } },
    slots: {
      inject: (name, factory) => { injectedNames.push(name); try { factory(); } catch (e) {} },
      register: (config) => { slotConfigs.push(config); return () => {}; }
    },
    sessions: { create: async () => 'x', fork: async () => 'y' },
    // `mainReference.sessionId` is what activeSessionId() reads first (checked in lib/client.js):
    // without it "lock this session" has no session to lock and silently does nothing.
    uiWorkspace: options.uiWorkspace || {
      mainReference: { sessionId: SESSION },
      openSession: () => {}, openWorkspace: () => {}, startSession: () => {}, replaceMain: () => {}, clearMain: () => {}
    },
    layout: { selectPanel: () => {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
    remote: { session: { prompt: async () => ({ ok: true }), cancel: async () => ({ ok: true }) } }
  };
  exportsObj.apply(ctx);
  const api = exportsObj.__test;
  // The store is handed out so a case can flip ONE setting mid-flight (the real page writes it
  // the same way, through writeSettings). It is never the live profile's storage.
  api.store = store;
  // Storage-call order witness (see the opLog comment above): removeItem before setItem is
  // literally "the lock was cleared BEFORE the settings were written".
  api.opLog = opLog;
  return { api, store, document, registered, commands: registered, injectedNames, effectLabels, slotConfigs, opLog };
}

/** Count how many notice bubbles are on screen right now. */
const noticeCount = (doc) => doc.__notices.length;

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n① 默认全开：老用户升级后行为一字不变');
{
  const { api } = boot({});
  const defaults = api.readSettings();
  const FEATURES = ['featureFocusLock', 'featureNotice', 'featureFind', 'featureQuote', 'featureDigest', 'featureNotes', 'featureTurnActions'];
  for (const key of FEATURES) {
    eq(defaults[key], true, 'empty storage -> ' + key + ' defaults to true');
  }
  // 显式 false 必须被尊重，垃圾值必须回落成 true（布尔严格校验）。
  const { api: api2 } = boot({ featureFind: false, featureQuote: 'yes', featureDigest: 1 });
  eq(api2.readSettings().featureFind, false, 'an explicit false is honoured');
  eq(api2.readSettings().featureQuote, true, 'a non-boolean value falls back to the default (true), not to "off"');
  eq(api2.readSettings().featureDigest, true, 'a numeric value falls back to the default (true)');
}

console.log('\n② 「通知与气泡」关掉 ⇒ 真的不画；但自己的错误与专注锁照旧可见');
{
  // on (default)
  {
    const { api, document } = boot({});
    const before = noticeCount(document);
    api.showNotice('hello');
    eq(noticeCount(document) - before, 1, 'with the switch ON a notice draws one bubble');
  }
  // off
  {
    const { api, document } = boot({ featureNotice: false });
    const before = noticeCount(document);
    api.showNotice('hello');
    eq(noticeCount(document) - before, 0, 'with the switch OFF the same notice draws nothing');
    // the plugin's own error channel must survive
    const mid = noticeCount(document);
    api.showNotice('write failed', { clientX: 24, clientY: 24 }, { always: true });
    eq(noticeCount(document) - mid, 1, 'opts.always (the plugin\'s own error) is NOT suppressed by the switch');
    // the focus lock's interception notices must survive
    const mid2 = noticeCount(document);
    api.showNotice('blocked', { clientX: 24, clientY: 80 }, { systemOnly: true });
    eq(noticeCount(document) - mid2, 1, 'systemOnly (focus-lock interception) is NOT suppressed by the switch');
  }
}

console.log('\n③ 「专注锁」：开关是判定点上的真门（用真锁验证，不用裸调用）');
{
  const uiWorkspace = {
    mainReference: { sessionId: SESSION },
    openSession: function openSession() {}, openWorkspace: function openWorkspace() {},
    startSession: function startSession() {}, replaceMain: function replaceMain() {}, clearMain: function clearMain() {}
  };
  // ── 开关「开」+ 真的锁上一个会话 ⇒ 去别的会话必须被拦 ─────────────────────────────
  {
    const { api, document } = boot({ featureFocusLock: true }, { uiWorkspace });
    api.hooks.focusLockFor(30);                       // the same path the settings page uses
    const readoutOn = api.focusWrapReadout();
    if (!/lock=WRAPPED/.test(readoutOn)) fail('with the switch ON and a lock armed, the interception must be WRAPPED, readout: ' + readoutOn);
    else ok('switch ON + locked -> readout says ' + readoutOn.split(' · ')[0]);
    const d = api.focusWrapDecide('replaceMain', 'session-somewhere-else');
    if (d.allow !== false) fail('switch ON + locked -> switching to ANOTHER session must be blocked, got ' + JSON.stringify(d));
    else ok('switch ON + locked -> a foreign session is blocked (reason=' + d.reason + ')');
    const same = api.focusWrapDecide('replaceMain', api.hooks.activeSessionId());
    if (same.allow !== true) fail('switch ON + locked -> the LOCKED session itself must always be reachable, got ' + JSON.stringify(same));
    else ok('switch ON + locked -> the locked session itself stays reachable (the escape hatch)');

    // ── 关掉开关：一键收尾必须真的**撤销**包装、复位 armed、并说话 ─────────────────
    api.store.set('dsh.deepworker.settings', JSON.stringify({ featureFocusLock: false }));
    const before = noticeCount(document);
    const r = api.hooks.featureFocusLockOff();
    if (!r || r.ok !== true) fail('featureFocusLockOff must report ok when the unwrap succeeds, got ' + JSON.stringify(r));
    else ok('featureFocusLockOff reports ok');
    if (api.paintLockedSessions && false) { /* not needed */ }
    // The decisive assertion: the interceptor must be GONE, not merely bypassed.
    const readoutOff = api.focusWrapReadout();
    if (/lock=WRAPPED/.test(readoutOff)) fail('the unwrap did NOT stick — readout still says WRAPPED: ' + readoutOff);
    else ok('switch OFF -> the interceptors are unwrapped (readout: ' + readoutOff.split(' · ')[0] + ')');
    if (!/wrapped=0\//.test(readoutOff)) fail('after the unwrap the wrapped count must be 0, readout: ' + readoutOff);
    else ok('switch OFF -> wrapped=0/N');
    // The re-arm path must work afterwards (the 2026-10-15 armed-reset defect in
    // focusWrapUnwrapAll: it used to restore the methods without clearing `armed`, so
    // "off -> on" left the lock silently dead). Turning the switch back on and locking again
    // is exactly what the user does.
    api.store.set('dsh.deepworker.settings', JSON.stringify({ featureFocusLock: true }));
    const reArmed = api.hooks.focusLockFor(30);
    const readoutRe = api.focusWrapReadout();
    if (!/lock=WRAPPED/.test(readoutRe)) fail('after OFF then ON again the interception must re-arm (this is the "silently dead lock" regression): ' + readoutRe);
    else ok('lock OFF -> ON re-arms (no silently dead lock)');
    if (noticeCount(document) <= before) fail('turning the lock off must SAY so (no notice drawn)');
    else ok('turning the lock off speaks (a notice was drawn)');
    if (typeof r.message !== 'string' || r.message === '') fail('featureFocusLockOff must return the message it spoke, got ' + JSON.stringify(r && r.message));
    else ok('featureFocusLockOff returns the exact message it showed');
  }
  // ── 开关「关」+ 同一个锁 ⇒ 判定点直接放行（reason 必须是 feature-off）─────────────
  {
    const { api } = boot({ featureFocusLock: false }, { uiWorkspace });
    const d = api.focusWrapDecide('replaceMain', 'session-somewhere-else');
    if (d.allow !== true) fail('switch OFF must allow every switch, got ' + JSON.stringify(d));
    else ok('switch OFF -> allowed');
    eq(d.reason, 'feature-off', 'switch OFF -> the reason says feature-off (the gate is the decision point, not a bypass later on)');
    const readout = api.focusWrapReadout();
    if (/lock=WRAPPED/.test(readout)) fail('switch OFF from the start must never wrap: ' + readout);
    else ok('switch OFF from the start -> never wrapped');
  }
}

console.log('\n④ 「不引入」= 不注册：真跑 apply 路径数贡献数（关 = 0 / 开 ≥ 1）');
{
  // ⚠️ 2026-10-16 语义变更：以前这一节断的是"关掉后命令仍注册、`resolve()` 返回 unhandled
  //    （入口保留 + 说话）"。设计要求改成"**不引入 ⇒ 根本不注册**" ⇒ 那条断言已经不成立，
  //    所以整节换成**注册层计数**：未引入时对应功能的槽位 / 命令 / effect 必须一次都没被
  //    调用过。计数来自 boot() 记录的 `ctx.slots.inject` / `ctx.slots.register` /
  //    `ctx.shortcuts.register` / `ctx.effect` —— 真跑了 apply，不是 grep 源码。
  const ALL = FEATURE_KEY_LIST.slice();
  /**
   * 每一档在**注册层**留下的贡献，按"怎么数"分类：
   *   slots    —— `ctx.slots.register(config)`：同时按 `name`（必给）与 `id`（给了就必须
   *               一起对上）匹配。⚠️ 只按 id 匹配是**错的**：`history-actions` 这个 id 同时
   *               被 turnTail 槽位和**永远注册**的 `settings.section` 用着 ⇒ 只比 id 会把
   *               设置页那条算成 turnTail 的贡献（实测踩到，报出了假的 1）。
   *   commands —— `ctx.shortcuts.register(command).id`
   *   effects  —— `ctx.effect(fn, label)` 的 label
   *   armed    —— 专注锁的拦截器是否真的装上了（`hooks.focusWrapArmed()`）
   * `featureNotice` 在注册层**没有任何贡献**（它是通知通道本身，门控在 `showNotice` 里，
   * 见 ②）—— 这里如实写 `null`，而不是拿一个恒 0 的假证据充数。
   */
  const EVIDENCE = {
    featureFocusLock: { slots: [{ name: 'conversation.session.header.utilities', id: 'history-actions-focus' }], commands: [], effects: ['dsh-deepworker: focus state file', 'dsh-deepworker: focus lock clicks'], armed: true },
    featureNotes: { slots: [{ name: 'sidebar.footer.action', id: 'history-actions-notes' }, { name: 'main' }], commands: ['deepworker.notes.open', 'deepworker.notes.search'], effects: [] },
    featureFind: { slots: [{ name: 'conversation.session.header.utilities', id: 'history-actions-find' }], commands: ['deepworker.find'], effects: ['dsh-deepworker: find highlights'] },
    featureQuote: { slots: [], commands: [], effects: ['dsh-deepworker: context menu', 'dsh-deepworker: session-reference clicks'] },
    featureDigest: { slots: [{ name: 'conversation.session.header.utilities', id: 'history-actions-digest' }], commands: ['deepworker.digest'], effects: [] },
    featureTurnActions: { slots: [{ name: 'conversation.chat.turnTail', id: 'history-actions' }], commands: [], effects: [] },
    // 2026-10-16 新增：会话头部的终端按钮（一个槽位条目，内部一组按钮）。
    featureTerminal: { slots: [{ name: 'conversation.session.header.utilities', id: 'history-actions-terminal' }], commands: [], effects: [] },
    featureNotice: null
  };
  /** 数一遍这个 bundle 里属于 `key` 的注册贡献（null = 该档在注册层本来就没有贡献）。 */
  const contributionsOf = (bundle, key) => {
    const spec = EVIDENCE[key];
    if (spec === null) return null;
    let n = 0;
    for (const cfg of bundle.slotConfigs) {
      for (const want of spec.slots) {
        if (cfg.name !== want.name) continue;
        if (want.id !== undefined && cfg.id !== want.id) continue;
        n++;
      }
    }
    for (const cmd of bundle.registered) if (spec.commands.indexOf(cmd.id) !== -1) n++;
    for (const label of bundle.effectLabels) if (spec.effects.indexOf(label) !== -1) n++;
    if (spec.armed === true && typeof bundle.api.hooks.focusWrapArmed === 'function' && bundle.api.hooks.focusWrapArmed() === true) n++;
    return n;
  };
  const allOn = boot({});
  const readout = [];
  for (const key of ALL) {
    const onlyOff = {};
    for (const k of ALL) onlyOff[k] = k !== key;
    const single = boot(onlyOff);
    const offCount = contributionsOf(single, key);
    const onCount = contributionsOf(allOn, key);
    if (offCount === null) {
      ok(key + ' → 注册层无贡献（通知通道自身就是门，见 ②）');
      readout.push(key.replace('feature', '') + '=n/a');
      continue;
    }
    eq(offCount, 0, 'NOT INTRODUCED: ' + key + ' must register ZERO contributions (slots.inject / shortcuts.register / ctx.effect never called)');
    if (!(onCount >= 1)) fail('INTRODUCED: ' + key + ' must register at least ONE contribution, got ' + onCount);
    else ok(key + ' → not introduced: 0 registrations · introduced: ' + onCount + ' registration(s)');
    readout.push(key.replace('feature', '') + '=' + offCount + '/' + onCount);
    // 隔离性：只关这一档，**不许**顺手改掉别的档的注册数（一处门控写错会连带关掉别人）。
    for (const other of ALL) {
      if (other === key || EVIDENCE[other] === null) continue;
      const want = contributionsOf(allOn, other);
      const got = contributionsOf(single, other);
      if (got !== want) {
        fail('turning off ' + key + ' also changed ' + other + '\'s registration count (' + want + ' -> ' + got + ')');
        break;
      }
    }
  }
  console.log('     注册数实测（关/开）: ' + readout.join(' · '));
  // 全开 ⇒ 五条命令都在（否则"关=0"可能只是因为命令本来就坏）。
  for (const id of ['deepworker.notes.open', 'deepworker.find', 'deepworker.digest', 'deepworker.notes.search']) {
    if (!allOn.registered.some((c) => c.id === id)) fail('with every feature introduced the command must be registered: ' + id);
  }
  ok('with every feature introduced all 4 commands are registered');
  // 全开 ⇒ 六个功能槽位都在（笔记的 sidebar + main 面板算两个贡献）。
  eq(contributionsOf(allOn, 'featureNotes') >= 2, true, 'featureNotes registers BOTH its sidebar entry and its main panel when introduced');
  eq(contributionsOf(allOn, 'featureTurnActions') >= 1, true, 'featureTurnActions registers its turn-tail slot when introduced');
  // deepworker.reload was removed: there is no dead command in the command table.
}

console.log('\n⑤ 「一键全关」：**先解锁 → 再写设置 → 再提示重载**（顺序是硬要求）');
{
  // ── 为什么这一节是行为断言而不是 grep ─────────────────────────────────────────────
  // 需求逐字（用户）：「关掉它之前先解锁所有的锁」。实现约束：`installFocusClicks` 在**注册
  // 时**受 `featureFocusLock` 门控，注册之后不再看那个开关（它的判据是锁状态本身）⇒ 只把
  // 设置写成 false **不会**让人脱身。所以这里真的装一遍 bundle、真的加锁、真的调总开关，
  // 再读**存储 + 调用序 + 自有属性描述符**三样证据。
  const ALL = FEATURE_KEY_LIST.slice();
  const LOCK_KEY = 'dsh.deepworker.focusLocal';
  const SETTINGS_KEY = 'dsh.deepworker.settings';
  const W_PATH = '/Users/x/wsA';
  const NAMES = ['openSession', 'openWorkspace', 'startSession', 'replaceMain', 'clearMain'];
  /** The app's real hand-out shape is also a bare object in some hosts; identity is NOT used here. */
  const bareUi = () => ({
    mainReference: { sessionId: SESSION },
    openSession: function openSession() {}, openWorkspace: function openWorkspace() {},
    startSession: function startSession() {}, replaceMain: function replaceMain() {}, clearMain: function clearMain() {}
  });
  /** Ownership account (§6.1) so a WORKSPACE-granularity lock can actually be stored. */
  const wsUi = () => Object.assign(bareUi(), {
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-a', path: W_PATH, title: 'A', sessionIds: [SESSION], createdAt: 1, updatedAt: 2 }] }) } }
  });
  /**
   * 让「撤销包装」**必定失败**的夹具：`clearMain` 是一个 **setter 会抛错**的访问器。
   *
   * ⚠️ 这里踩过一次真实的假夹具：最初用"只有 getter、没有 setter"的访问器，结果**撤销成功**
   * —— 因为赋值被静默丢掉之后，属性读回来**仍然是原方法**（getter 返回的就是那个原方法），
   * `focusWrapReadBack` 判成 "direct"。也就是说"赋值被吞"与"赋值生效"在**撤销**这一步上
   * 不可区分（只在**包装**那一步可区分：包装写进去的是新函数，读回来还是旧的 ⇒ 报
   * readback-mismatch）。⇒ 撤销失败必须由**真的抛错**制造：setter 抛错（冻结对象在严格模式下
   * 也一样抛），这才是"宿主对象上撤不掉"的真实形状。
   */
  const unwrapFailsUi = () => {
    function clearMain() {}
    const ui = {
      mainReference: { sessionId: SESSION },
      openSession: function openSession() {}, openWorkspace: function openWorkspace() {},
      startSession: function startSession() {}, replaceMain: function replaceMain() {}
    };
    Object.defineProperty(ui, 'clearMain', {
      get: () => clearMain,
      set: () => { throw new Error('clearMain is not writable (fixture)'); },
      configurable: true,
      enumerable: true
    });
    return ui;
  };
  const storedSettings = (b) => JSON.parse(b.store.get(SETTINGS_KEY) || '{}');
  const localLock = (b) => JSON.parse(b.store.get(LOCK_KEY) || 'null');
  const descValue = (obj, name) => {
    const d = Object.getOwnPropertyDescriptor(obj, name);
    return d === undefined ? undefined : d.value;
  };

  // ── (a) 会话级锁 + 一键全关 ⇒ 7 档改了、锁被解除、拦截器被撤销 ────────────────────
  {
    const ui = bareUi();
    const base = {};
    for (const n of NAMES) base[n] = ui[n];
    const b = boot({ featureFocusLock: true }, { uiWorkspace: ui });
    b.api.hooks.focusLockFor(30);
    if (!/lock=WRAPPED/.test(b.api.focusWrapReadout())) fail('precondition: with the switch ON and a lock armed the interception must be WRAPPED, readout: ' + b.api.focusWrapReadout());
    if (localLock(b) === null || localLock(b).kind !== 'session') fail('precondition: a SESSION-granularity lock must be stored, got ' + b.store.get(LOCK_KEY));
    const before = noticeCount(b.document);
    const r = b.api.hooks.featureMasterOff();
    if (!r || r.ok !== true) fail('the master all-off must report ok, got ' + JSON.stringify(r));
    else ok('master all-off reports ok (stage=' + r.stage + ', changed=' + r.changed + ')');
    // 档数从 bundle 现算 —— 写死 7 会在加档当天变成一句假断言（2026-10-16 加第 8 档即如此）。
    eq(r.changed, FEATURE_COUNT, 'the master all-off must report that it changed all ' + FEATURE_COUNT + ' features');
    const st = storedSettings(b);
    let allWritten = true;
    for (const k of ALL) if (st[k] !== false) { allWritten = false; fail('the master all-off must write ' + k + '=false, storage has ' + JSON.stringify(st[k])); }
    if (allWritten) ok('the master all-off wrote all ' + FEATURE_COUNT + ' features to false');
    // ① 锁真的解除了（会话级）
    const afterLock = localLock(b);
    if (!(afterLock === null || afterLock.enabled !== true)) {
      fail('with a SESSION lock held, the master all-off must have released it (storage still holds ' + b.store.get(LOCK_KEY) + ') — turning the feature off must not leave the user locked in');
    } else ok('the master all-off released the session lock (storage no longer holds an armed lock)');
    if (!(Array.isArray(r.released) && r.released.indexOf('session') !== -1)) {
      fail('the master all-off must have released the session-granularity lock and REPORT it, got released=' + JSON.stringify(r.released));
    } else ok('the receipt names the granularity it released: ' + JSON.stringify(r.released));
    // ② 拦截器真的撤销了 —— **自有属性描述符判据**（ctx.uiWorkspace 是 cordis 可追踪 Proxy
    //    时身份比较恒假，本机踩过；描述符对代理目标成立，是真的判据）。
    let descOk = true;
    for (const n of NAMES) {
      if (descValue(ui, n) !== base[n]) {
        descOk = false;
        fail('the master all-off must restore ctx.uiWorkspace.' + n + ' to the original function (descriptor judge, never identity)');
      }
    }
    if (descOk) ok('all 5 interceptors are back to the originals (Object.getOwnPropertyDescriptor judge)');
    if (b.api.focusWrapArmed() !== false) fail('after the master all-off the wrap must be disarmed (armed must be false)');
    else ok('the wrap is disarmed after the master all-off');
    if (/lock=WRAPPED/.test(b.api.focusWrapReadout())) fail('the readout must not still say WRAPPED after the master all-off: ' + b.api.focusWrapReadout());
    // ③ 顺序：清锁必须**先于**写设置（存储调用序就是顺序证据）
    const clearAt = b.opLog.findIndex((e) => e.op === 'removeItem' && e.key === LOCK_KEY);
    const writeAt = b.opLog.findIndex((e) => e.op === 'setItem' && e.key === SETTINGS_KEY);
    if (!(clearAt >= 0 && writeAt >= 0 && clearAt < writeAt)) {
      fail('the master all-off must UNLOCK FIRST: the local-lock clear must come BEFORE the settings write in the storage call order (clearAt=' + clearAt + ', writeAt=' + writeAt + ', opLog=' + JSON.stringify(b.opLog) + ')');
    } else ok('order proof: removeItem(' + LOCK_KEY + ') at op#' + clearAt + ' precedes setItem(' + SETTINGS_KEY + ') at op#' + writeAt);
    // ④ 必须说话，且回执必须是"先解除了专注锁"那一句
    //    （locale 桩原样返回键名 ⇒ 按**键**断言；文案本身由 verify_render 从 bundle 现读并断）
    if (noticeCount(b.document) <= before) fail('the master all-off must SAY what it did (no notice drawn)');
    else if (r.message !== 'settings.masterOffDone') {
      fail('the master all-off receipt must be the "released the locks first" line (settings.masterOffDone), got ' + JSON.stringify(r && r.message));
    } else ok('the receipt is spoken and is the unlock-first line: ' + JSON.stringify(r.message));
  }

  // ── (b) 工作区级锁 + 一键全关 ⇒ **也要**被解除（漏一档 = 人还被锁在里面）────────────
  {
    const ui = wsUi();
    const b = boot({ featureFocusLock: true }, { uiWorkspace: ui });
    b.api.hooks.focusLockFor(30, 'workspace');
    const seeded = localLock(b);
    if (seeded === null || seeded.kind !== 'workspace') fail('precondition: a WORKSPACE-granularity lock must be stored, got ' + b.store.get(LOCK_KEY));
    const r = b.api.hooks.featureMasterOff();
    if (!(r && Array.isArray(r.released) && r.released.indexOf('workspace') !== -1)) {
      fail('the master all-off must have released the WORKSPACE-granularity lock too — release coverage must include every granularity in FOCUS_LOCK_KINDS (released=' + JSON.stringify(r && r.released) + ', failed=' + JSON.stringify(r && r.failed) + ', stage=' + (r && r.stage) + ')');
    } else ok('the workspace-granularity lock is covered (' + JSON.stringify(r.released) + ')');
    const st = storedSettings(b);
    const wantWritten = ALL.every((k) => st[k] === false);
    if (!wantWritten) fail('with a workspace lock the master all-off must still write all ' + FEATURE_COUNT + ' features, storage: ' + JSON.stringify(st));
    else ok('with a workspace lock all ' + FEATURE_COUNT + ' features were still written');
    const afterLock = localLock(b);
    if (!(afterLock === null || afterLock.enabled !== true)) fail('the workspace lock must be gone after the master all-off, storage still holds ' + b.store.get(LOCK_KEY));
    else ok('the workspace lock is gone after the master all-off');
  }

  // ── (c) 解锁**失败** ⇒ 停下来：一个设置都不许改，且必须说出来 ─────────────────────
  //    ⚠️ 两种失败模式各测一遍，因为它们走的是 `focusReleaseAllLocks` 里**两条不同的分支**：
  //       c1 撤销包装抛错（`failWrap` 分支）· c2 本地锁清不掉（storage 分支 + 复核分支）。
  //    ⚠️ 回执断言按**键名**（本套件的 locale 桩是 `bind: () => (k) => k`，`t()` 原样返回键名）。
  //       文案本身由 verify_render.mjs 从 bundle 现读并断言，两者合起来才是完整证据。
  {
    const cases = [
      ['the unwrap throws', () => boot({ featureFocusLock: true }, { uiWorkspace: unwrapFailsUi() })],
      ['the storage refuses the clear', () => boot({ featureFocusLock: true }, { uiWorkspace: bareUi(), removeItemThrows: true })]
    ];
    for (const [label, make] of cases) {
      const b = make();
      b.api.hooks.focusLockFor(30);
      if (localLock(b) === null) fail('precondition (' + label + '): a lock must be stored, got ' + b.store.get(LOCK_KEY));
      const settingsBefore = b.store.get(SETTINGS_KEY);
      const before = noticeCount(b.document);
      const r = b.api.hooks.featureMasterOff();
      if (!r || r.ok !== false) fail('when ' + label + ' the master all-off must report ok=false, got ' + JSON.stringify(r));
      else ok('unlock failure (' + label + ') makes the master all-off report ok=false');
      eq(r.stage, 'unlock', 'unlock failure (' + label + ') must stop the transaction at the UNLOCK stage');
      eq(r.changed, 0, 'unlock failure (' + label + ') must report that it changed nothing');
      if (b.store.get(SETTINGS_KEY) !== settingsBefore) {
        fail('when ' + label + ' the master all-off must write NOTHING — storage changed from ' + settingsBefore + ' to ' + b.store.get(SETTINGS_KEY));
      } else ok('storage untouched when ' + label + ' (the settings write never ran)');
      if (noticeCount(b.document) <= before) fail('a failing unlock (' + label + ') must be SAID OUT LOUD (no notice drawn) — "the lock was not released" is the worst kind of silent failure');
      else ok('the failed unlock is spoken (' + label + ')');
      if (r.message !== 'settings.masterUnlockFailed') {
        fail('the failure receipt must be the dedicated unlock-failure line, got ' + JSON.stringify(r && r.message));
      } else ok('the failure receipt uses settings.masterUnlockFailed (' + label + ')');
      if (!Array.isArray(r.failed) || r.failed.length === 0) {
        fail('the failure must REPORT WHY (failed must be non-empty), got ' + JSON.stringify(r && r.failed));
      } else ok('the failure names its cause: ' + JSON.stringify(r.failed));
    }
  }

  // ── (d) 「一键全开」：7 档写回 true；不需要解锁，所以不碰锁 ────────────────────────
  {
    const ui = bareUi();
    const b = boot({ featureFocusLock: false, featureFind: false, featureQuote: false }, { uiWorkspace: ui });
    b.api.hooks.focusLockFor(30);
    const lockBefore = b.store.get(LOCK_KEY);
    const r = b.api.hooks.featureMasterOn();
    if (!r || r.ok !== true) fail('the master all-on must report ok, got ' + JSON.stringify(r));
    eq(r.changed, FEATURE_COUNT, 'the master all-on must report ' + FEATURE_COUNT + ' changed features');
    const st = storedSettings(b);
    let allOn = true;
    for (const k of ALL) if (st[k] !== true) { allOn = false; fail('the master all-on must write ' + k + '=true, storage has ' + JSON.stringify(st[k])); }
    if (allOn) ok('the master all-on wrote all ' + FEATURE_COUNT + ' features to true');
    if (b.store.get(LOCK_KEY) !== lockBefore) {
      fail('the master all-on must NOT touch the lock (only "off" needs the unlock-first order)');
    } else ok('the master all-on left the lock alone');
  }

  // ── (e0) **没有生效锁**时一键全关 ⇒ 不许谎称"已解除专注锁"─────────────────────────
  //    `settings.masterOffDone`（"已先解除专注锁（…）"）与 `settings.masterOffNoLock`
  //    （"本机没有生效中的专注锁；…"）是**两句不同的话**：没有锁的时候说前一句就是撒谎。
  {
    const b = boot({}, { uiWorkspace: bareUi() });
    if (localLock(b) !== null) fail('precondition: no lock may be stored for this case');
    const r = b.api.hooks.featureMasterOff();
    if (!r || r.ok !== true) fail('with no active lock the master all-off must still succeed, got ' + JSON.stringify(r));
    if (!Array.isArray(r.released) || r.released.length !== 0) {
      fail('with no active lock the master all-off must report released=[] , got ' + JSON.stringify(r && r.released));
    }
    if (r.message !== 'settings.masterOffNoLock') {
      fail('with no active lock the receipt must NOT claim a lock was released (expected settings.masterOffNoLock), got ' + JSON.stringify(r && r.message));
    } else ok('with no active lock the receipt does not claim an unlock (settings.masterOffNoLock)');
    const st = storedSettings(b);
    if (!ALL.every((k) => st[k] === false)) fail('with no active lock all ' + FEATURE_COUNT + ' features must still be written false, storage: ' + JSON.stringify(st));
    else ok('with no active lock all ' + FEATURE_COUNT + ' features were still written');
  }

  // ── (e) 单档「专注锁」开关走**同一条**事务（同一个顺序、同一个失败闸门）─────────────
  {
    const ui = bareUi();
    const b = boot({ featureFocusLock: true }, { uiWorkspace: ui });
    b.api.hooks.focusLockFor(30);
    const r = b.api.hooks.featureFocusLockOff();
    if (!r || r.ok !== true) fail('turning the single 专注锁 switch off must report ok, got ' + JSON.stringify(r));
    eq(storedSettings(b).featureFocusLock, false, 'the single 专注锁 switch must write featureFocusLock=false');
    if (localLock(b) !== null && localLock(b).enabled === true) fail('the single 专注锁 switch must release the lock, storage still holds ' + b.store.get(LOCK_KEY));
    else ok('the single 专注锁 switch released the lock');
    const clearAt = b.opLog.findIndex((e) => e.op === 'removeItem' && e.key === LOCK_KEY);
    const writeAt = b.opLog.findIndex((e) => e.op === 'setItem' && e.key === SETTINGS_KEY);
    if (!(clearAt >= 0 && writeAt >= 0 && clearAt < writeAt)) {
      fail('the single 专注锁 switch must UNLOCK FIRST too (clearAt=' + clearAt + ', writeAt=' + writeAt + ')');
    } else ok('the single 专注锁 switch uses the same unlock-first order');
    // 同一条失败闸门：撤销失败 ⇒ 不写设置。
    const u2 = unwrapFailsUi();
    const b2 = boot({ featureFocusLock: true }, { uiWorkspace: u2 });
    b2.api.hooks.focusLockFor(30);
    const settingsBefore = b2.store.get(SETTINGS_KEY);
    const r2 = b2.api.hooks.featureFocusLockOff();
    if (!r2 || r2.ok !== false || r2.stage !== 'unlock') fail('the single 专注锁 switch must apply the same abort-on-unlock-failure rule, got ' + JSON.stringify(r2));
    else if (b2.store.get(SETTINGS_KEY) !== settingsBefore) fail('the single 专注锁 switch must write NOTHING when the unwrap fails');
    else ok('the single 专注锁 switch shares the abort-on-unlock-failure gate');
  }
}

console.log('\n⑥ 「通知哪些会话」三颗按钮：关掉「通知与气泡」时**仍然说话**');
{
  // ── 缺陷逐字（上一轮报告、本轮修）──────────────────────────────────────────────────
  // `testHooks.noticeOnlyCurrent / noticeMuteCurrent / noticeClearScope` 调 `showNotice(...)`
  // **不带 `always: true`**，而 `showNotice` 被 `featureNotice` 门控 ⇒ 「通知与气泡」关掉时，
  // 点这三颗按钮**会写设置但一句话都不说**（违反本机铁律"失败必须可见"）。
  //
  // ⚠️ 语义边界（**不是**要拆掉门控）：`featureNotice` 门控的是**通知通道**（"把提醒发到系统
  //    通知中心 / 画气泡"）；而"我点了按钮、设置已经改了"是**插件自己的动作回执**，与
  //    `notes.writeFailed` / `settings.applyFailures` 同类 ⇒ 属于 `opts.always` 那个例外。
  //    所以修法是给这几处加 `always: true`；门控一个字不动（通知通道仍然可关 —— 下面
  //    "打开时语义不变"那半边就是在守这一点）。
  //
  // ⚠️ 本套件的 locale 桩是 `bind: () => (k) => k` ⇒ `t()` 原样返回键名；所以下面按**键名**
  //    断言文案（文案本身由 verify_notice_text 的形状表 + verify_render 的现读自检覆盖）。
  const NO_SESSION_UI = {
    mainReference: { sessionId: '' },
    openSession: function openSession() {}, openWorkspace: function openWorkspace() {},
    startSession: function startSession() {}, replaceMain: function replaceMain() {}, clearMain: function clearMain() {}
  };
  const CASES = [
    ['只通知本会话 (noticeOnlyCurrent)', 'noticeOnlyCurrent', 'noticeOnlySession'],
    ['静音/取消静音本会话 (noticeMuteCurrent)', 'noticeMuteCurrent', 'noticeMutedSessions'],
    ['清除范围设置 (noticeClearScope)', 'noticeClearScope', null]
  ];
  for (const [label, hook, key] of CASES) {
    // ── 关掉「通知与气泡」：必须**仍然**有回执 ──────────────────────────────────────
    const off = boot({ featureNotice: false });
    const beforeOff = noticeCount(off.document);
    off.api.hooks[hook]();
    if (noticeCount(off.document) === beforeOff) {
      fail('with 「通知与气泡」 OFF the button ' + label + ' must STILL speak — it is the plugin\'s own action receipt, not a channel notification (nothing was drawn)');
    } else ok('switch OFF -> ' + label + ' still speaks');
    // 回执不是"说得比做得多"：动作必须真的写进设置。
    if (key !== null) {
      const st = off.api.readSettings();
      const wrote = key === 'noticeOnlySession'
        ? (typeof st[key] === 'string' && st[key] !== '')
        : (Array.isArray(st[key]) && st[key].length >= 1);
      if (!wrote) fail(label + ' must also really write its setting; readSettings()[' + key + '] = ' + JSON.stringify(st[key]));
      else ok('switch OFF -> ' + label + ' really wrote ' + key);
    }
    // ── 打开时语义不变：照旧说话（门控没有被拆掉）──────────────────────────────────
    const on = boot({});
    const beforeOn = noticeCount(on.document);
    on.api.hooks[hook]();
    if (noticeCount(on.document) === beforeOn) fail('with 「通知与气泡」 ON the button ' + label + ' must still speak (behaviour unchanged)');
    else ok('switch ON  -> ' + label + ' still speaks (the gate was not removed, only the exception widened)');
  }
  // ── 家族守卫那一句（`scopeIdOrComplain` 的 `notice.noSession`）也属于这一族 ──────────
  //    它是"点了按钮但没做成"的**原因**回执，不是"通知某个会话" ⇒ 同样必须不受门控影响。
  {
    const off = boot({ featureNotice: false }, { uiWorkspace: NO_SESSION_UI });
    if (typeof off.api.hooks.activeSessionId() === 'string' && off.api.hooks.activeSessionId() !== '') {
      fail('fixture: there must be NO active session for this case, got ' + JSON.stringify(off.api.hooks.activeSessionId()));
    }
    const before = noticeCount(off.document);
    off.api.hooks.noticeOnlyCurrent();
    if (noticeCount(off.document) === before) {
      fail('with 「通知与气泡」 OFF, "you pressed the button but there is no current session" must STILL be shown — a button that does nothing and says nothing is exactly the silent-failure shape');
    } else ok('switch OFF -> the no-current-session receipt still speaks');
    const on = boot({}, { uiWorkspace: NO_SESSION_UI });
    const before2 = noticeCount(on.document);
    on.api.hooks.noticeOnlyCurrent();
    if (noticeCount(on.document) === before2) fail('with the switch ON the no-current-session receipt must still speak');
    else ok('switch ON  -> the no-current-session receipt still speaks');
  }
  // ── 源码级扫描（"缺陷是类不是实例"）：这一族里**每一个** showNotice 都必须带 always:true ─
  //    只修其中一个实例的写法必须让这条红。扫描范围 = 四个函数的函数体（按大括号配平切）。
  {
    const FAMILY = ['scopeIdOrComplain', 'noticeOnlyCurrent', 'noticeMuteCurrent', 'noticeClearScope'];
    const bodyOf = (name) => {
      // 两种声明形状都要认：`function NAME(`（scopeIdOrComplain）与
      // `testHooks.NAME = function (`（那三颗按钮的 hook）。两者合计必须恰好一处。
      const sigs = ['function ' + name + '(', 'testHooks.' + name + ' = function ('];
      let at = -1;
      let hits = 0;
      for (const sig of sigs) {
        const n = code.split(sig).length - 1;
        hits += n;
        if (n > 0 && at === -1) at = code.indexOf(sig);
      }
      if (hits === 0) throw new Error('anchor missing: ' + name);
      if (hits !== 1) throw new Error('anchor ambiguous (' + hits + ' hits): ' + name);
      const open = code.indexOf('{', at);
      let depth = 0;
      for (let i = open; i < code.length; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') { depth--; if (depth === 0) return code.slice(open, i + 1); }
      }
      throw new Error('unbalanced body: ' + name);
    };
    let total = 0;
    for (const name of FAMILY) {
      const body = bodyOf(name);
      const lines = body.split('\n').filter((l) => l.indexOf('showNotice(') !== -1);
      if (lines.length === 0) fail(name + ' must call showNotice (the receipt) — none found');
      for (const l of lines) {
        total++;
        if (l.indexOf('always: true') === -1) {
          fail(name + ': every showNotice in the 「通知哪些会话」 receipt family must carry `{ always: true }` (else the button goes silent when 「通知与气泡」 is off); offending line: ' + l.trim().slice(0, 140));
        }
      }
    }
    if (total === 0) fail('the receipt-family scan found no showNotice call sites at all — the scan itself is broken');
    else ok('source scan -> all ' + total + ' showNotice call sites in the receipt family carry always:true');
  }
}

console.log(failures === 0 ? '\nFEATURE-TOGGLE BEHAVIOUR CHECKS PASSED' : '\n' + failures + ' check(s) failed');
process.exit(failures === 0 ? 0 : 1);
