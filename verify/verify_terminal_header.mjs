// verify_terminal_header.mjs — 会话头部终端按钮那一组的**外观级**断言。
//
// 为什么单独一个套件：这两件事都是"用户看真机截图才发现的"，而它们各自都有**结构性**的
// 判据，能写成断言而不是靠人再看一遍：
//
//   ① **order < -10** —— 该槽位是跨插件共享的**升序 list**，`open-in-app` = -10。
//      用户原话："按钮放在【打开】前面，避免引起误会，看着像一起的"。
//      写成断言（并把邻居值写在断言里），以后有人改回 40 会立刻红。
//   ② **一组竖线** —— 用户原话："加个竖线好，因为跟专注放一起也会引起误会"。
//      竖线必须真的渲染出来（**真跑 SSR，按元素 + 样式判据**，不是文本 grep），而且必须
//      在我们**自己的条目内部**（槽位不允许往别人的条目塞东西），所以它随组出现/消失。
//
// ⚠️ 这里的 SSR 是桩渲染：它证明"组件会渲染出这根线、且用的色值能解析"，不证明真机像素。
// 用法：node verify/verify_terminal_header.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const require_ = createRequire(import.meta.url);
const React = require_('react');
const { renderToStaticMarkup } = require_('react-dom/server');

let pass = 0, fail = 0;
const assert = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.error('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
};
const SLOT = 'conversation.session.header.utilities';

const code = fs.readFileSync(path.join(PKG, 'lib', 'client.js'), 'utf8');

// ════════════════════════════════════════════════════════════════════════════════
// ① order：从源码现读注册块，断言 terminal 那一组严格小于 -10，并打印邻居值
// ════════════════════════════════════════════════════════════════════════════════
console.log('── ① 该组的 order（升序 list：越小的越靠左）');

/** 括号平衡地取出一段 `{ … }`，所以块里再嵌对象也取得全（正则到第一个 `}` 会截断）。 */
function balancedBlock(text, openIdx) {
  const open = text[openIdx];
  const close = open === '{' ? '}' : (open === '(' ? ')' : ']');
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 2; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return text.slice(openIdx, i + 1); }
  }
  return null;
}
const codeOnly = code.replace(/\/\*/g, '//').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

const rows = [];
for (const m of codeOnly.matchAll(new RegExp('slots\\.register\\(\\{', 'g'))) {
  const block = balancedBlock(codeOnly, codeOnly.indexOf('{', m.index));
  if (block === null) continue;
  const name = (/name\s*:\s*"([^"]+)"/.exec(block) || [])[1];
  if (name !== SLOT) continue;
  const id = (/id\s*:\s*"([^"]+)"/.exec(block) || [])[1];
  const orderRaw = (/order\s*:\s*(-?\d+(?:\.\d+)?)/.exec(block) || [])[1];
  rows.push({ id, order: orderRaw === undefined ? 0 : Number(orderRaw), declared: orderRaw !== undefined });
}
const terminalRows = rows.filter((r) => r.id === 'history-actions-terminal');
assert('槽位里有恰好一个 id = "history-actions-terminal" 的注册项', terminalRows.length === 1, JSON.stringify(rows));
if (terminalRows.length === 1) {
  const order = terminalRows[0].order;
  // 邻居值写进断言本身：以后有人"顺手对齐一下"就会看到这些数字。
  assert('terminal 组的 order = ' + order + ' 必须 **< -10**（open-in-app = -10；schedule-catalog = -5；未写 order = 默认 0）',
    order < -10, 'order=' + order + ' ⇒ 它会排到官方【打开】右边，又被读成同一组');
  assert('terminal 组显式写了 order（没靠默认 0 的巧合）', terminalRows[0].declared === true);
}
// 既有条目一律不许动（用户明令）
const EXPECTED_OTHERS = { 'history-actions-focus': -12, 'history-actions-find': 40, 'history-actions-digest': 50 };
for (const [id, want] of Object.entries(EXPECTED_OTHERS)) {
  const row = rows.filter((r) => r.id === id);
  assert('既有条目 ' + id + ' 的 order 仍是 ' + want + '（用户要求：只改这一组）',
    row.length === 1 && row[0].order === want, JSON.stringify(row));
}
console.log('     本插件在该槽位的 order：' + rows.slice().sort((a, b) => a.order - b.order).map((r) => r.id + '=' + r.order).join(' · '));

// ════════════════════════════════════════════════════════════════════════════════
// ② 竖线：真跑 SSR，按元素 + 样式判据（不是文本 grep）
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n── ② 竖线（真跑 SSR）');

const windowObj = { __ModuleLoader__: {}, innerWidth: 1200, innerHeight: 800 };
let loaded = null;
windowObj.__ModuleLoader__.load = (r) => { loaded = r; };
const primitivesStub = {
  Modal: function () {}, Button: function () {}, Input: function () {},
  IconListPenOutlineRegular: function () {}, MarkdownText: function () {},
  SegmentedControl: function () {}, Switch: function () {}
};
const mockRequire = (id) => id === 'react' ? React
  : id === 'react/jsx-runtime' ? require_('react/jsx-runtime')
  : id === '@deepseek-ai/dsh-client-ui-primitives' ? primitivesStub
  : (() => { throw new Error('unexpected require ' + id); })();

const store = new Map();
// 两个 cwd 各配一份：一份有命令（按钮会渲染），一份空。
store.set('dsh.deepworker.terminalButtons.v1', JSON.stringify({
  '/w/one': {
    timeout: 30,
    seq: [],
    actions: [
      { id: 'start', label: '', command: './serve.sh' },
      { id: 'stop', label: '', command: './stop.sh' }
    ]
  },
  '/w/empty': { timeout: 30, seq: [], actions: [{ id: 'start', label: '', command: '' }, { id: 'stop', label: '', command: '' }] }
}));

const sandbox = {
  window: windowObj, require: mockRequire, TextEncoder, btoa, atob, TextDecoder, console,
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  queueMicrotask: (fn) => { try { fn(); } catch (e) { /* best effort */ } },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  },
  Symbol, Object, Promise, Date, Math, String, Array, Number, Error, JSON, isFinite, RegExp,
  crypto: { randomUUID: () => 'u-1' }, AbortController
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'client.js' });
const exportsObj = loaded.factory(mockRequire);

let headerComponent = null;
const ctx = {
  effect: (fn) => { fn(); return () => {}; },
  locale: { register: () => {}, bind: () => (k) => k },
  slots: {
    inject: (name, factory) => { factory(); },
    register: (config, comp) => {
      if (config.name === SLOT && config.id === 'history-actions-terminal') headerComponent = comp;
      return () => {};
    }
  },
  sessions: { create: async () => 'x', list: { getSnapshot: () => ({ ids: [], byId: {} }) } },
  layout: { selectPanel: () => {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
  uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => undefined }) }) },
  uiWorkspace: {
    openSession: () => {}, archiveSession: async () => {}, mainReference: { sessionId: 'sess-1' },
    workspaces: { list: { getSnapshot: () => ({ items: [] }) } }, pickDirectory: async () => ''
  },
  remote: { session: { prompt: async () => ({ ok: true }) }, workspace: { create: async () => ({ ok: true }) } }
};
exportsObj.apply(ctx);
assert('已捕获该槽位的终端按钮组件', typeof headerComponent === 'function', String(typeof headerComponent));

/** 与真槽位同形：`{ t, sessionId, useSessions }`（scope="session" 的 standard binding）。 */
function renderHeader(cwd, t) {
  const byId = { 'sess-1': { id: 'sess-1', cwd: cwd } };
  const useSessions = (selector) => selector({ ids: ['sess-1'], byId: byId });
  return renderToStaticMarkup(React.createElement(headerComponent, {
    t: t || ((k, v) => {
      // 只关心几个键；其余原样返回，断言不依赖它们。
      if (k === 'term.buttonStart') return '启动';
      if (k === 'term.buttonStop') return '停止';
      return k;
    }),
    sessionId: 'sess-1',
    useSessions: useSessions
  }));
}

{
  const html = renderHeader('/w/one');
  assert('渲染出两个按钮（启动 / 停止）', html.includes('启动') && html.includes('停止'), html.slice(0, 200));
  // 竖线的机械判据：一个 aria-hidden 的 span，带我们的 data 标记。
  const sep = /<span[^>]*data-dw-terminal-separator[^>]*>/.exec(html);
  assert('那一组渲染出了一条竖线（按元素判据，不是文本 grep）', sep !== null, html.slice(0, 300));
  if (sep !== null) {
    const openTag = sep[0];
    assert('  竖线带 aria-hidden="true"（纯装饰，不进无障碍树）', /aria-hidden="true"/.test(openTag), openTag);
    // 高度：固定 16px 或 alignSelf:stretch 二者之一（用户给的两条路）
    const hasHeight = /height:16px/.test(openTag) || /align-self:stretch/.test(openTag) || /alignSelf:stretch/.test(openTag);
    assert('  竖线有高度（固定 16px 或 stretch）', hasHeight, openTag);
    // 色值必须落在**主题变量**上，且变量名是已核实的 --dsw-alias-* 形状
    const colorToken = (/background:var\((--dsw-alias-[a-z0-9-]+)\)/.exec(openTag) || [])[1];
    assert('  竖线的色值来自主题变量（background:var(--dsw-alias-…)）', colorToken !== undefined, openTag);
    if (colorToken !== undefined) {
      // 该变量必须**真的在这个 bundle 里出现过**（即已被使用/核实过的），不是现编的。
      const occurrences = (code.match(new RegExp(colorToken.replace(/[-]/g, '\\-'), 'g')) || []).length;
      assert('  变量 ' + colorToken + ' 在本 bundle 里确实被使用（出现 ' + occurrences + ' 次）', occurrences >= 1);
    }
  }
  // 竖线必须**在同一个容器里**（同组出现/消失），而不是独立注册的另一个槽位条目。
  assert('竖线与按钮在同一个容器节点内（组消失时它跟着消失）',
    /data-dw-terminal-separator/.test(html) && html.indexOf('启动') < html.indexOf('data-dw-terminal-separator'), html.slice(0, 300));
}

{
  // 没有命令时按钮变灰但仍在；竖线在（组还在，只是不可用）。
  const html = renderHeader('/w/empty');
  assert('没配命令时竖线仍在（组没有消失）', html.includes('data-dw-terminal-separator'), html.slice(0, 200));
}

console.log(fail === 0
  ? `\nTERMINAL HEADER PASSED (${pass} checks)`
  : `\n${fail} check(s) failed / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
