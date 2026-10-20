#!/usr/bin/env node
/**
 * verify_focus_settings.mjs — 设置页「专注锁」状态行必须：
 *   ① 读**生效中的锁**（本地锁优先），而不是只读宿主文件缓存；
 *   ② 点击「锁定本会话 / 立即解锁」后**立刻刷新**（状态行不许停在旧值）；
 *   ③ 说人话：未锁定 / 已锁定 · 范围 · 剩余 N 分钟，不打印 targetId / ISO 时间；
 *   ④ 不再出现没有信息含量的 `✅`。
 *
 * 2026-10-17 用户实测：「未锁定 ✅，点了锁定也没变化」。根因是设置页只读
 * `focusFileCache`（宿主文件镜像，通常是 null / {locked:false}），而锁实际写在
 * localStorage；且按钮没有触发重新读取 ⇒ 状态行永远停在「未锁定」。
 *
 * 用法：node verify/verify_focus_settings.mjs
 *       HA_CLIENT_JS=/tmp/x.mjs node verify/verify_focus_settings.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.join(HERE, '..');
const TARGET = process.env.HA_CLIENT_JS || path.join(PKG, 'lib', 'client.js');
const src = fs.readFileSync(TARGET, 'utf8');
const where = path.relative(PKG, TARGET);

let failures = 0;
const fail = (m) => { failures++; console.error('FAIL: ' + m); };
const ok = (m) => console.log('  ok   ' + m);

/* ── minimal DOM + React stubs, enough for apply()/static registration ── */
function makeEl(tag) {
  return {
    tagName: tag, children: [], style: {}, attributes: {}, textContent: '', type: '',
    onclick: null, parentElement: null, removed: false,
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
    remove() { this.removed = true; },
    contains(node) { return node === this || this.children.indexOf(node) >= 0; },
    hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attributes, n); },
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attributes, n) ? this.attributes[n] : null; },
    setAttribute(n, v) { this.attributes[n] = String(v); },
    removeAttribute(n) { delete this.attributes[n]; },
    addEventListener() {}, removeEventListener() {},
    querySelectorAll: () => [], querySelector: () => null, closest: () => null
  };
}
const body = makeEl('body');
const docEl = makeEl('html');
const doc = {
  body, documentElement: docEl, listeners: {},
  addEventListener(t, fn) { this.listeners[t] = fn; },
  removeEventListener(t) { delete this.listeners[t]; },
  createElement: (tag) => makeEl(tag),
  querySelectorAll: () => []
};
const win = { innerWidth: 1200, innerHeight: 800 };
let loaded = null;
const windowObj = Object.assign({ __ModuleLoader__: { load: (r) => { loaded = r; } } }, win);
const reactMock = { memo: (c) => c, useState: (i) => [i, () => {}], useRef: (i) => ({ current: i }), useEffect: () => {} };
const jsxMock = { jsx: (...a) => a, jsxs: (...a) => a, Fragment: Symbol('F') };
const primitivesMock = { Modal: function () {}, Button: function () {} };
const mockRequire = (id) => id === 'react' ? reactMock
  : id === 'react/jsx-runtime' ? jsxMock
  : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitivesMock
  : (() => { throw new Error('unexpected ' + id); })();
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};
const sandbox = { window: windowObj, setTimeout, clearTimeout, document: doc, localStorage, require: mockRequire, TextEncoder, btoa, Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'client.js' });
const exportsObj = loaded.factory(mockRequire);

const ctx = {
  effect: (fn) => { fn(); return () => {}; },
  locale: { register: () => {}, bind: () => t },
  slots: { inject: (n, f) => { f(); }, register: () => {} },
  sessions: { create: async () => 'x', fork: async () => 'y' },
  uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => undefined }) }) },
  uiWorkspace: { openSession: () => {}, archiveSession: async () => {}, mainReference: { sessionId: 'sess-1' }, workspaces: { list: { getSnapshot: () => ({ items: [] }) } }, pickDirectory: async () => '' },
  remote: { session: { prompt: async () => ({ ok: true }) }, agentPresets: { list: async () => ({ ok: true, value: { presets: [] } }), select: async () => ({ ok: true }) }, workspace: { create: async () => ({ ok: true }) } }
};

const ZH = {
  'focus.unknown': '状态还没读出来',
  'focus.free': '未锁定',
  'focus.locked': '🔒 专注中',
  'focus.scopeSession': '只留当前会话',
  'focus.scopeWorkspace': '只留当前工作区',
  'focus.remaining': '剩余',
  'focus.minutes': '{n} 分钟'
};
const t = (k, params) => {
  let value = ZH[k] === undefined ? k : ZH[k];
  if (params) for (const key of Object.keys(params)) value = value.split('{' + key + '}').join(String(params[key]));
  return value;
};

try {
  exportsObj.apply(ctx);
} catch (e) {
  // apply may partially fail under the stub ctx; __test is what matters here.
}
const bridge = exportsObj.__test;
if (bridge === undefined) { console.error('FAIL: __test seam missing'); process.exit(1); }

/* ── 1. 纯函数行为：状态行说人话 ─────────────────────────────────────────── */
console.log('状态行');
const describe = bridge.hooks && bridge.hooks.describeFocusState;
if (typeof describe !== 'function') {
  fail('describeFocusState is not exposed through __test.hooks');
} else {
  const now = 1800000000000;
  const cases = [
    [{ locked: false }, '未锁定', 'unlocked'],
    [{ locked: true, kind: 'session', untilMs: now + 29 * 60000 + 1000 }, '🔒 专注中 · 只留当前会话 · 剩余 30 分钟', 'session lock, 30 min left'],
    [{ locked: true, kind: 'workspace', untilMs: now + 60000 }, '🔒 专注中 · 只留当前工作区 · 剩余 1 分钟', 'workspace lock, 1 min left'],
    [{ locked: true, kind: 'session', untilMs: now }, '未锁定', 'expired lock'],
    [null, '状态还没读出来', 'unreadable state']
  ];
  for (const [state, want, label] of cases) {
    const got = describe(state, t, now);
    if (got !== want) fail(`${label}: expected "${want}", got "${got}"`);
    else ok(`${label} -> ${got}`);
  }
}

/* ── 2. 源码接线 ─────────────────────────────────────────────────────────── */
console.log('\n接线');
function fnBody(name) {
  const at = src.indexOf(name);
  if (at < 0) return null;
  const start = src.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  return null;
}

{
  const readFocus = fnBody('testHooks.readFocus = function ()');
  if (readFocus === null) fail('testHooks.readFocus could not be located');
  else if (!/effectiveFocusState\(\)/.test(readFocus)) fail('readFocus does not read through effectiveFocusState() — the settings row will keep showing the host-file cache (usually "未锁定")');
  else ok('readFocus reads the effective lock (local lock included)');
}
{
  const line = fnBody('function focusStateLine()');
  if (line === null) fail('focusStateLine could not be located');
  else if (!/describeFocusState\(focus\[0\], t, Date\.now\(\)\)/.test(line)) fail('focusStateLine does not delegate to describeFocusState()');
  else if (/targetId|toISOString/.test(line)) fail('focusStateLine still prints internal ids / ISO timestamps');
  else ok('focusStateLine delegates to the human-readable formatter');
}
for (const [label, needle] of [
  ['lock button refreshes the row after locking', /focusLockFor\(30\);\s*\n\s*refreshFocus\(\);/],
  ['unlock button refreshes the row after unlocking', /focusUnlockLocal\(\);\s*\n\s*refreshFocus\(\);/],
  ['the row re-reads every 5 s while mounted', /setInterval\(refreshFocus,\s*5000\)/]
]) {
  if (!needle.test(src)) fail(label);
  else ok(label);
}

/* ── 3. 文案：不许再有 ✅ ────────────────────────────────────────────────── */
console.log('\n文案');
for (const [key, none] of [['focus.free', '✅'], ['focus.locked', '✅']]) {
  const m = new RegExp('"' + key.replace(/[.]/g, '\\.') + '":\\s*"([^"]*)"').exec(src);
  if (m === null) { fail(`${key} not found in the dictionaries`); continue; }
  if (m[1].includes(none)) fail(`${key} still contains ${none}: ${m[1]}`);
  else ok(`${key} = "${m[1]}" (no check mark)`);
}

if (failures > 0) {
  console.error(`\nFAIL: ${failures} check(s) failed (${where})`);
  process.exit(1);
}
console.log(`\nPASS: the focus row reads the effective lock, refreshes on click, and says something useful (${where})`);
process.exit(0);
